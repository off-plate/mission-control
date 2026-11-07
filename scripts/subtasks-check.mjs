/* Sub tasks on the Plan page, in the line view and the list view, on the real page and real saved state.
   Run after `npm run build`: node scripts/subtasks-check.mjs   Shots: /tmp/mc-sub-shots/ */
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
const SHOTS = '/tmp/mc-sub-shots'; mkdirSync(SHOTS, { recursive: true })
let pass = 0, fail = 0
const step = async (n, f) => { try { await f(); pass++; console.log('PASS', n) } catch (e) { fail++; console.log('FAIL', n, '-', e.message.split('\n')[0]) } }
const day = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()

for (const engine of [chromium, webkit]) {
  const tag = engine.name()
  const b = await engine.launch(engine === chromium ? { args: ['--mute-audio'] } : {})
  const page = await (await b.newContext({ viewport: { width: 1440, height: 1100 } })).newPage(); page.setDefaultTimeout(8000)
  const errors = []; page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(URL); await page.waitForTimeout(1200)
  await page.evaluate(({ K, day }) => {
    const s = JSON.parse(localStorage.getItem(K))
    const t = (id, title, at, min, extra = {}) => ({ id, title, source: 'mc', estimateMin: min, estimated: true, done: false, space: 'personal', list: 'today', plannedOn: day, at, category: 'deep', createdAt: day, addedAt: Date.now(), ...extra })
    s.tasks = [t('sb-1', 'Write the proposal', '20:00', 60), t('sb-2', 'Already has steps', '21:30', 45, { subtasks: [{ id: 'x1', title: 'Outline', estimateMin: 15, done: true }, { id: 'x2', title: 'Draft', estimateMin: 30, done: false }] })]
    s.dailySkipped = day
    localStorage.setItem(K, JSON.stringify(s)); localStorage.setItem('mc:plan-view', 'line')
  }, { K: KEY, day })
  await page.reload(); await page.waitForTimeout(1500)
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^\s*Plan\s*$/i.test(x.textContent)); b && b.click() })
  await page.locator('.pl').waitFor(); await page.waitForTimeout(1500)
  const blob = () => page.evaluate((K) => JSON.parse(localStorage.getItem(K)).tasks, KEY)
  const card = (title) => page.locator('.pl-task').filter({ has: page.getByText(title, { exact: true }) })

  await step(`${tag} line: a task with steps shows "1 of 2 steps", one without offers "Add steps"`, async () => {
    assert.match(await card('Already has steps').locator('.pf-steps').textContent(), /1 of 2 steps/)
    assert.match(await card('Write the proposal').locator('.pf-steps').textContent(), /Add steps/)
  })
  await step(`${tag} line: open a task, add steps, the task becomes their sum, saved`, async () => {
    const c = card('Write the proposal'); const h0 = (await c.locator('.pl-bar').boundingBox()).height
    await c.locator('.pf-steps').click()
    await c.locator('.step-add-title').fill('Outline it'); await c.locator('.step-add-min').fill('20'); await c.locator('.step-add-go').click()
    await c.locator('.step-add-title').fill('Write the draft'); await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    const t = (await blob()).find((x) => x.id === 'sb-1')
    assert.deepEqual(t.subtasks.map((s) => [s.title, s.estimateMin]), [['Outline it', 20], ['Write the draft', 15]])
    assert.equal(t.estimateMin, 35)
    assert.ok((await card('Write the proposal').locator('.pf-steps').textContent()).includes('0 of 2 steps'))
    assert.equal(await c.locator('.subtask-wrap').count(), 2)
    assert.ok((await c.locator('.pl-bar').boundingBox()).height < h0, 'bar should follow the new total (35 < 60)')
    await page.screenshot({ path: `${SHOTS}/${tag}-line-open.png` })
  })
  await step(`${tag} line: tick a step (log it), it counts and persists`, async () => {
    const c = card('Write the proposal')
    await c.locator('.subtask', { hasText: 'Outline it' }).click()
    await c.locator('.actual-chip').first().click(); await page.waitForTimeout(500)
    const t = (await blob()).find((x) => x.id === 'sb-1')
    assert.equal(t.subtasks[0].done, true)
    assert.ok((await card('Write the proposal').locator('.pf-steps').textContent()).includes('1 of 2 steps'))
  })
  await step(`${tag} line: remove a step`, async () => {
    const c = card('Write the proposal')
    await c.locator('.subtask-wrap', { hasText: 'Write the draft' }).getByRole('button', { name: /Remove step/ }).click(); await page.waitForTimeout(400)
    assert.equal((await blob()).find((x) => x.id === 'sb-1').subtasks.length, 1)
  })
  await step(`${tag} line: the "now" line stays on its bar when steps are open`, async () => {
    const live = page.locator('.pl-task.is-live')
    if (await live.count()) { const r = await live.locator('.pl-now').evaluate((e) => parseFloat(e.style.top)); assert.ok(r >= 0) }
  })
  await step(`${tag} line: survives a reload`, async () => {
    await page.reload(); await page.waitForTimeout(1500)
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^\s*Plan\s*$/i.test(x.textContent)); b && b.click() })
    await page.locator('.pl').waitFor(); await page.waitForTimeout(1200)
    assert.match(await card('Write the proposal').locator('.pf-steps').textContent(), /1 of 1 steps/)
  })
  await step(`${tag} list view: same, open the list and add a step to a task`, async () => {
    await page.evaluate(() => localStorage.setItem('mc:plan-view', 'list'))
    await page.reload(); await page.waitForTimeout(1500)
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^\s*Plan\s*$/i.test(x.textContent)); b && b.click() })
    await page.waitForTimeout(1500)
    const row = page.locator('.today-item', { hasText: 'Already has steps' })
    await row.locator('.pf-steps').click()
    await row.locator('.step-add-title').fill('Review'); await page.keyboard.press('Enter'); await page.waitForTimeout(500)
    const t = (await blob()).find((x) => x.id === 'sb-2')
    assert.equal(t.subtasks.length, 3); assert.equal(t.estimateMin, 60)
    await page.screenshot({ path: `${SHOTS}/${tag}-list-open.png` })
  })
  await step(`${tag}: no console errors`, async () => assert.deepEqual(errors, []))
  await b.close()
}
console.log(`\n${pass} passed, ${fail} failed. Shots in ${SHOTS}`)
server.close(); process.exit(fail ? 1 : 0)
