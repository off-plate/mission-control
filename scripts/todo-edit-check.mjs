/* An open row menu must paint ABOVE the rows after it (his report 2026-11-09: the to-do list's menu was drawn under
   the next rows, text on top of text). Real page, real saved state, wide and phone width, Chromium and WebKit.
   Run after `npm run build`: node scripts/todo-edit-check.mjs   Shots: /tmp/mc-menu-shots/ */
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
const SHOTS = '/tmp/mc-menu-shots'; mkdirSync(SHOTS, { recursive: true })
let pass = 0, fail = 0
const step = async (n, f) => { try { await f(); pass++; console.log('PASS', n) } catch (e) { fail++; console.log('FAIL', n, '-', e.message.split('\n')[0]) } }
const day = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()

for (const [engine, size, label] of [[chromium, { width: 1440, height: 900 }, 'desktop'], [chromium, { width: 700, height: 900 }, 'narrow'], [webkit, { width: 1440, height: 900 }, 'desktop']]) {
  const tag = `${engine.name()} ${label}`
  const b = await engine.launch(engine === chromium ? { args: ['--mute-audio'] } : {})
  const page = await (await b.newContext({ viewport: size, hasTouch: false })).newPage(); page.setDefaultTimeout(8000)
  await page.goto(URL); await page.waitForTimeout(1200)
  await page.evaluate(({ K, day }) => {
    const s = JSON.parse(localStorage.getItem(K))
    const t = (i) => ({ id: `mn-${i}`, title: `Kočičí kavárna: set up thing number ${i}`, source: 'mc', estimateMin: 30, estimated: true, done: false, space: 'personal', list: 'backlog', category: 'deep', createdAt: day, addedAt: Date.now() - i })
    s.tasks = Array.from({ length: 8 }, (_, i) => t(i)); s.dailySkipped = day
    localStorage.setItem(K, JSON.stringify(s))
  }, { K: KEY, day })
  await page.reload(); await page.waitForTimeout(1500)
  /* PROVE=1: switch both fixes off, the checks must then fail. */
  if (process.env.PROVE) await page.addStyleTag({ content: '.sheet-body:has(.tagpop){overflow:auto !important} .todo-item:has(.kebab-wrap.is-open){z-index:auto !important}' })
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^\s*Plan\s*$/i.test(x.textContent)); b && b.click() })
  await page.waitForTimeout(1500)
  if (label === 'narrow') { const seg = page.locator('.seg-phone button').nth(1); if (await seg.isVisible()) { await seg.click(); await page.waitForTimeout(500) } }
  await step(`${tag}: a to-do row has a pencil that opens Edit, and no three-dot menu`, async () => {
    assert.equal(await page.locator('.todo-item .kebab').count(), 0, 'the three-dot menu is still on to-do rows')
    assert.equal(await page.locator('.todo-item .pf-edit').count(), 8, 'every to-do row has a pencil')
    await page.screenshot({ path: `${SHOTS}/${tag.replace(/ /g, '-')}.png` })
    await page.locator('.todo-item').nth(1).locator('.pf-edit').click(); await page.waitForTimeout(500)
    assert.equal(await page.locator('.sheet #et-title').inputValue(), 'Kočičí kavárna: set up thing number 1')
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  })
  await step(`${tag}: the #project suggestions in the Edit sheet are fully visible, not cut at the sheet edge`, async () => {
    await page.locator('.todo-item').nth(1).locator('.pf-edit').click(); await page.waitForTimeout(500)
    const field = page.locator('.sheet #et-title'); await field.fill('Jakub: #'); await page.waitForTimeout(400)
    const items = page.locator('.tagpop button'); const n = await items.count()
    assert.ok(n >= 2, `only ${n} suggestions`)
    for (let i = 0; i < n; i++) {
      const r = await items.nth(i).boundingBox()
      const top = await page.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); return !!el && !!el.closest('.tagpop') }, { x: r.x + r.width / 2, y: r.y + r.height / 2 })
      assert.ok(top, `suggestion ${i} is covered or clipped (y ${Math.round(r.y)})`)
    }
    await page.screenshot({ path: `${SHOTS}/${tag.replace(/ /g, '-')}-tags.png` })
  })
  await b.close()
}
console.log(`\n${pass} passed, ${fail} failed. Shots in ${SHOTS}`)
server.close(); process.exit(fail ? 1 : 0)
