import { chromium } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync } from 'fs'
import { join, extname, resolve } from 'path'
const DOCS = resolve(process.cwd(), 'docs')
const PORT = 8403
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }
const server = createServer((req, res) => {
  const p = (req.url ?? '/').split('?')[0].replace(/^\/mission-control/, '') || '/'
  const f = join(DOCS, p === '/' ? 'index.html' : p)
  if (!existsSync(f)) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f))
})
await new Promise(ok => server.listen(PORT, ok))
const URL = `http://localhost:${PORT}/mission-control/?noremote`
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await page.goto(`${URL}#/habits`); await page.waitForTimeout(1000)
const m = await page.evaluate(() => {
  const dot = document.querySelector('.daydot')
  const r = dot?.getBoundingClientRect()
  const fab = document.querySelector('.pomo-fab, [class*="fab"], [class*="pomo"]')
  const fr = fab?.getBoundingClientRect()
  const card2 = document.querySelectorAll('.habit-card')[1]?.getBoundingClientRect()
  return {
    dot: r && { w: Math.round(r.width), h: Math.round(r.height) },
    fabClass: fab?.className, fab: fr && { x: Math.round(fr.x), y: Math.round(fr.y), w: Math.round(fr.width), h: Math.round(fr.height) },
    card2: card2 && { x: Math.round(card2.x), y: Math.round(card2.y), w: Math.round(card2.width), h: Math.round(card2.height) },
    scrollH: document.body.scrollHeight,
  }
})
console.log(JSON.stringify(m, null, 1))
// tap a clickable dot
const card = page.locator('.habit-card', { hasText: 'Meditation' }).first()
await card.scrollIntoViewIfNeeded()
await card.locator('.daydot').nth(6).tap()
await page.waitForTimeout(400)
console.log('after tap:', (await card.innerText()).replace(/\n/g,' | '))
// back button behaviour after tapping
await page.goBack(); await page.waitForTimeout(500)
console.log('after back, url hash:', page.url())
await b.close(); server.close()
