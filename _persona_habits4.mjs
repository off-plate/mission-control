import { chromium } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync } from 'fs'
import { join, extname, resolve } from 'path'
const DOCS = resolve(process.cwd(), 'docs')
const PORT = 8405
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
const server = createServer((req, res) => {
  const p = (req.url ?? '/').split('?')[0].replace(/^\/mission-control/, '') || '/'
  const f = join(DOCS, p === '/' ? 'index.html' : p)
  if (!existsSync(f)) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f))
})
await new Promise(ok => server.listen(PORT, ok))
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(`http://localhost:${PORT}/mission-control/?noremote#/habits`); await page.waitForTimeout(1000)
const r = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.habit-card')]
  const counts = cards.map(c => ({ n: c.querySelector('.habit-name')?.textContent, c: c.querySelector('.habit-count')?.textContent }))
  const sum = counts.reduce((a,x)=>{ const m = x.c?.match(/^(\d+)\/(\d+)/); return a + (m ? Number(m[2]) : 0) }, 0)
  return { counts, sumOfVisibleDenominators: sum, header: document.querySelector('.band-metric, .metric, [class*=metric]')?.textContent }
})
console.log(JSON.stringify(r, null, 1))
await b.close(); server.close()
