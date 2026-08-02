import { chromium } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve, join, extname } from 'path'

const HERE = dirname(fileURLToPath(import.meta.url))
const DOCS = resolve(HERE, 'docs')
const OUT = '/private/tmp/claude-501/-Users-michaelflorianrvltdigital-Claude-Helpers-Jarvis/b6bada4e-ea5d-4da2-b7b8-c483cb34e1d5/scratchpad/shots'
mkdirSync(OUT, { recursive: true })
const PORT = 8399
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' }
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0].replace(/^\/mission-control/, '') || '/'
  const file = join(DOCS, path === '/' ? 'index.html' : path)
  if (!existsSync(file)) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})
await new Promise((ok) => server.listen(PORT, ok))
const URL = `http://localhost:${PORT}/mission-control/?noremote`
const KEY = 'mission-control-demo-v12'

const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 2560, height: 1400 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(e.message.slice(0, 160)))
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)) })

await page.goto(URL); await page.waitForTimeout(400)
await page.evaluate((K) => localStorage.removeItem(K), KEY)
await page.goto(`${URL}#/habits`); await page.reload(); await page.waitForTimeout(900)

// tick a realistic scatter of past days through the UI
const cards = await page.locator('.habit-card').all()
console.log('cards:', cards.length)
for (let ci = 0; ci < cards.length; ci++) {
  const dots = await cards[ci].locator('.daydot:not([disabled])').all()
  for (let di = 0; di < dots.length; di++) {
    if ((ci + di) % 3 !== 0) { try { await dots[di].click({ timeout: 800 }) } catch {} }
  }
}
await page.waitForTimeout(600)

const shot = async (name, w, h, dark, extra) => {
  await ctx.addInitScript(() => {})
  const p = await ctx.newPage()
  await p.setViewportSize({ width: w, height: h })
  await p.goto(`${URL}#/habits`); await p.waitForTimeout(900)
  if (dark !== undefined) {
    await p.evaluate((d) => { document.documentElement.dataset.theme = d ? 'dark' : 'light'; localStorage.setItem('mc-theme', d ? 'dark' : 'light') }, dark)
    await p.waitForTimeout(300)
  }
  if (extra) await extra(p)
  await p.screenshot({ path: join(OUT, name + '.png'), fullPage: true })
  await p.close()
}
await page.screenshot({ path: join(OUT, 'habits-2560-viewport.png') })
await page.screenshot({ path: join(OUT, 'habits-2560-full.png'), fullPage: true })
await shot('habits-1440', 1440, 900)
await shot('habits-390', 390, 844)
await shot('habits-2560-dark', 2560, 1400, true)
// comparison pages
for (const [route, name] of [['plan', 'plan'], ['routines', 'routines'], ['goals', 'goals']]) {
  const p = await ctx.newPage()
  await p.setViewportSize({ width: 1440, height: 900 })
  await p.goto(`${URL}#/${route}`); await p.waitForTimeout(900)
  await p.screenshot({ path: join(OUT, `${name}-1440.png`), fullPage: true })
  await p.close()
}
// 30d / 90d window on habits
for (const w of ['30', '90', '365']) {
  const p = await ctx.newPage()
  await p.setViewportSize({ width: 2560, height: 1400 })
  await p.goto(`${URL}#/habits`); await p.waitForTimeout(900)
  try {
    await p.locator('.rangepick').selectOption(w); await p.waitForTimeout(600)
    await p.screenshot({ path: join(OUT, `habits-2560-${w}d.png`), fullPage: true })
  } catch (e) { console.log('window', w, String(e).split('\n')[0]) }
  await p.close()
}
console.log('errors:', errs.slice(0, 8))
await b.close(); server.close()
