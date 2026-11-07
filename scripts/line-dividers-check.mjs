/* The Plan page's line view draws a labelled divider for each part of the day (Morning, Noon, Afternoon,
   Evening), at 12:00, 14:00 and 18:00, even through a free stretch. Real page, real saved state.
   Run after `npm run build`: node scripts/line-dividers-check.mjs   Shot: /tmp/mc-line-shots/ */
import { chromium, webkit } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve, join, extname } from 'path'
import assert from 'assert/strict'

const DOCS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docs')
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' }
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0].replace(/^\/mission-control/, '') || '/'
  const file = join(DOCS, path === '/' ? 'index.html' : path)
  if (!existsSync(file)) { if (extname(file)) { res.writeHead(404); res.end(); return } res.writeHead(200, { 'content-type': 'text/html' }); res.end(readFileSync(join(DOCS, 'index.html'))); return }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }); res.end(readFileSync(file))
})
await new Promise((ok) => server.listen(0, ok))
const URL = `http://localhost:${server.address().port}/mission-control/?noremote`
const KEY = 'mission-control-demo-v12'
const SHOTS = '/tmp/mc-line-shots'; mkdirSync(SHOTS, { recursive: true })
let pass = 0, fail = 0
const step = async (n, f) => { try { await f(); pass++; console.log('PASS', n) } catch (e) { fail++; console.log('FAIL', n, '-', e.message.split('\n')[0]) } }
const day = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()

for (const engine of [chromium, webkit]) {
  const b = await engine.launch(engine === chromium ? { args: ['--mute-audio'] } : {})
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage(); page.setDefaultTimeout(8000)
  const errors = []; page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(URL); await page.waitForTimeout(1200)
  await page.evaluate(({ K, day }) => {
    const s = JSON.parse(localStorage.getItem(K))
    const t = (id, title, at, min) => ({ id, title, source: 'mc', estimateMin: min, estimated: true, done: false, space: 'personal', list: 'today', plannedOn: day, at, category: 'deep', createdAt: day, addedAt: Date.now() })
    s.tasks = [t('ln-1', 'Morning task', '08:00', 30), t('ln-2', 'Noon task', '13:30', 60), t('ln-3', 'Afternoon task', '15:00', 30), t('ln-4', 'Evening task', '19:00', 20)]
    s.dailySkipped = day
    localStorage.setItem(K, JSON.stringify(s))
  }, { K: KEY, day })
  await page.reload(); await page.waitForTimeout(1500)
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^\s*Plan\s*$/i.test(x.textContent)); b && b.click() })
  await page.locator('.pl').waitFor(); await page.waitForTimeout(1500)
  await step(`${engine.name()}: the Line is the only Plan view, no List switch anywhere`, async () => {
    assert.equal(await page.locator('.pl-vsw').count(), 0, 'view switch still there')
    assert.equal(await page.locator('.pf-list').count(), 0, 'list view still drawn')
    assert.equal(await page.getByRole('button', { name: /^List$/ }).count(), 0, 'a List button is still on the page')
  })
  await step(`${engine.name()}: one divider per part of the day, in order`, async () => {
    const labels = await page.locator('.pl-slot b').allTextContents()
    assert.deepEqual(labels, ['Morning', 'Noon', 'Afternoon', 'Evening'], `got ${labels}`)
  })
  await step(`${engine.name()}: each divider sits above its own tasks and below the earlier ones`, async () => {
    /* Exact text, not substring: 'Noon' is inside 'Afternoon', 'Noon task' inside 'Afternoon task'. */
    const task = (t) => page.locator('.pl-task').filter({ has: page.getByText(t, { exact: true }) }).first().boundingBox().then((r) => r.y)
    const sl = (n) => page.locator('.pl-slot b').getByText(n, { exact: true }).boundingBox().then((r) => r.y)
    assert.ok((await sl('Morning')) < (await task('Morning task')))
    assert.ok((await task('Morning task')) < (await sl('Noon')) && (await sl('Noon')) < (await task('Noon task')))
    assert.ok((await task('Noon task')) < (await sl('Afternoon')) && (await sl('Afternoon')) < (await task('Afternoon task')))
    assert.ok((await task('Afternoon task')) < (await sl('Evening')) && (await sl('Evening')) < (await task('Evening task')))
  })
  await step(`${engine.name()}: a free stretch across 18:00 is cut, so Evening sits at 18:00 and not at the next task`, async () => {
    /* Noon task ends 14:30, Afternoon starts 15:00: the 30 min between is one piece and Afternoon is above it? No:
       what matters is the divider is not buried under a gap that crosses 18:00 (Afternoon task ends 15:30, Evening task is 19:00). */
    const gapsBetween = await page.evaluate(() => {
      const kids = [...document.querySelector('.pl').children]
      const iEv = kids.findIndex((k) => k.classList.contains('pl-slot') && /Evening/.test(k.textContent))
      const iAf = kids.findIndex((k) => k.classList.contains('pl-task') && /Afternoon task/.test(k.textContent))
      /* Free time already gone today is drawn without a range (it is not offered), so only count real ones. */
      return kids.slice(iAf + 1, iEv).filter((k) => k.dataset.s).map((k) => k.dataset.s + '-' + k.dataset.e)
    })
    assert.ok(gapsBetween.every((g) => Number(g.split('-')[1]) <= 18 * 60), `gap crosses 18:00: ${gapsBetween}`)
  })
  await page.screenshot({ path: `${SHOTS}/${engine.name()}.png` })
  await step(`${engine.name()}: no console errors`, async () => assert.deepEqual(errors, []))
  await b.close()
}
console.log(`\n${pass} passed, ${fail} failed. Shots in ${SHOTS}`)
server.close(); process.exit(fail ? 1 : 0)
