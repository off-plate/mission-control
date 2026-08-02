import { chromium } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync } from 'fs'
import { join, extname, resolve } from 'path'
const DOCS = resolve(process.cwd(), 'docs')
const OUT = '/private/tmp/claude-501/-Users-michaelflorianrvltdigital-Claude-Helpers-Jarvis/b6bada4e-ea5d-4da2-b7b8-c483cb34e1d5/scratchpad/shots'
const PORT = 8399
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0].replace(/^\/mission-control/, '') || '/'
  const file = join(DOCS, path === '/' ? 'index.html' : path)
  if (!existsSync(file)) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})
await new Promise((ok) => server.listen(PORT, ok))
const URL = `http://localhost:${PORT}/mission-control/?noremote`
const b = await chromium.launch()
const errs = []
for (const [name, vp, mob] of [['laptop', { width: 1440, height: 900 }, false], ['phone', { width: 390, height: 844 }, true]]) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: mob, hasTouch: mob })
  const page = await ctx.newPage()
  page.on('pageerror', e => errs.push(`${name} pageerror ${e.message.slice(0,150)}`))
  page.on('console', m => { if (m.type() === 'error') errs.push(`${name} console ${m.text().slice(0,150)}`) })
  await page.goto(`${URL}#/habits`); await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT}/${name}-fold.png` })
  await page.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: true })
  const h = await page.evaluate(() => document.body.scrollHeight)
  console.log(name, 'scrollHeight', h, 'vp', vp.height, 'folds', (h/vp.height).toFixed(2))
  // dump visible text
  const txt = await page.evaluate(() => document.querySelector('main')?.innerText || document.body.innerText)
  console.log('=== TEXT', name, '===\n' + txt)
  await ctx.close()
}
console.log('ERRORS', JSON.stringify(errs, null, 1))
await b.close(); server.close()
