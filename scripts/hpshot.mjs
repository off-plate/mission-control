/* Look at the Health page with his real rows in it.
   Serves docs/, injects `mc-health-fixture`, and photographs the page at the
   widths he actually uses. Exists because this page shipped twice on a code
   read alone; a chart is not reviewable as source. */
import { chromium } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve, join, extname } from 'path'

const HERE = dirname(fileURLToPath(import.meta.url))
const DOCS = resolve(HERE, '..', 'docs')
const OUT = resolve(HERE, '..', '.hp-shots')
mkdirSync(OUT, { recursive: true })
const FIXTURE = readFileSync(process.env.FIXTURE ?? '/tmp/hpfx/fixture.json', 'utf8')

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0].replace(/^\/mission-control/, '') || '/'
  const file = join(DOCS, path === '/' ? 'index.html' : path)
  if (!existsSync(file)) {
    if (extname(file)) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(readFileSync(join(DOCS, 'index.html'))); return
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})
await new Promise((ok) => server.listen(0, ok))
const URL = `http://localhost:${server.address().port}/mission-control/?noremote`

const b = await chromium.launch()
const errors = []
for (const w of [1500, 1180, 430]) {
  const page = await b.newPage({ viewport: { width: w, height: 1000 }, deviceScaleFactor: 2 })
  page.on('pageerror', (e) => errors.push(`[${w}] ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${w}] ${m.text().slice(0, 140)}`) })
  await page.goto(URL); await page.waitForTimeout(300)
  await page.evaluate((f) => localStorage.setItem('mc-health-fixture', f), FIXTURE)
  await page.goto(`${URL}#/health`); await page.reload(); await page.waitForTimeout(1400)
  await page.screenshot({ path: join(OUT, `health-${w}.png`), fullPage: true })

  if (w === 1500) {
    /* The complaint that keeps coming back: the multi-part days say
       "5 sessions" and will not open. Prove it opens, in a picture. */
    const row = page.locator('.hp-day.is-openable').first()
    if (await row.count()) {
      await row.locator('.hp-day-main').click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: join(OUT, 'health-expanded.png'), fullPage: true })
      const parts = await page.locator('.hp-day.is-open .hp-parts li, .hp-day.is-open .hp-part').count()
      console.log(`expanded parts visible: ${parts}`)
    } else {
      console.log('NO multi-session row found to expand')
    }
  }
  await page.close()
}
await b.close()
server.close()
console.log(errors.length ? `CONSOLE ERRORS:\n${errors.slice(0, 10).join('\n')}` : 'no console errors')
console.log(`shots in ${OUT}`)
