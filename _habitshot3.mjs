import { chromium } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve, join, extname } from 'path'
const HERE = dirname(fileURLToPath(import.meta.url))
const DOCS = resolve(HERE, 'docs')
const OUT = '/private/tmp/claude-501/-Users-michaelflorianrvltdigital-Claude-Helpers-Jarvis/b6bada4e-ea5d-4da2-b7b8-c483cb34e1d5/scratchpad/shots'
mkdirSync(OUT, { recursive: true })
const PORT = 8403
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
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
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const p = await ctx.newPage()
await p.goto(URL); await p.waitForTimeout(400)
await p.evaluate((K) => localStorage.removeItem(K), KEY)
await p.goto(`${URL}#/habits`); await p.reload(); await p.waitForTimeout(1200)
const cards = await p.locator('.habit-card').all()
for (let ci = 0; ci < cards.length; ci++) {
  const dots = await cards[ci].locator('.daydot:not([disabled])').all()
  for (let di = 0; di < dots.length; di++) if ((ci + di) % 3 !== 0) { try { await dots[di].click({ timeout: 700 }) } catch {} }
}
await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(500)
await p.screenshot({ path: join(OUT, 'phone-top.png') })
await p.screenshot({ path: join(OUT, 'phone-fullpage.png'), fullPage: true })
const pr = await p.evaluate(() => {
  const dot = document.querySelector('.daydot').getBoundingClientRect()
  const kebab = document.querySelector('.habit-kebab button')?.getBoundingClientRect()
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    pageH: Math.round(document.querySelector('.page').getBoundingClientRect().height),
    dot: { w: Math.round(dot.width), h: Math.round(dot.height) },
    kebab: kebab ? { w: Math.round(kebab.width), h: Math.round(kebab.height) } : null,
    card: Math.round(document.querySelector('.habit-card').getBoundingClientRect().height),
    cards: document.querySelectorAll('.habit-card').length,
    firstFold: [...document.querySelectorAll('.habit-card')].filter(c => c.getBoundingClientRect().top < 844).length,
  }
})
console.log('phone', JSON.stringify(pr))
await p.close()

// laptop: card + section crops for detail, and a full page at 1440
const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const q = await ctx2.newPage()
await q.goto(URL); await q.waitForTimeout(400)
await q.evaluate((K) => localStorage.removeItem(K), KEY)
await q.goto(`${URL}#/habits`); await q.reload(); await q.waitForTimeout(1200)
const c2 = await q.locator('.habit-card').all()
for (let ci = 0; ci < c2.length; ci++) {
  const dots = await c2[ci].locator('.daydot:not([disabled])').all()
  for (let di = 0; di < dots.length; di++) if ((ci + di) % 3 !== 0) { try { await dots[di].click({ timeout: 700 }) } catch {} }
}
await q.evaluate(() => window.scrollTo(0, 0)); await q.waitForTimeout(400)
await q.screenshot({ path: join(OUT, 'lap-top.png') })
await q.screenshot({ path: join(OUT, 'lap-full.png'), fullPage: true })
await q.locator('.habit-section').first().screenshot({ path: join(OUT, 'lap-section1.png') })
await q.locator('.habit-card').first().screenshot({ path: join(OUT, 'lap-card1.png') })
// window picker at 90 days
await q.locator('.rangepick').selectOption({ index: 2 }); await q.waitForTimeout(700)
await q.screenshot({ path: join(OUT, 'lap-window-b.png'), fullPage: true })
const opts = await q.locator('.rangepick option').allTextContents()
console.log('windows', opts)
await q.close()
await b.close(); server.close()
