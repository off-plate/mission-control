/* Look at the Zone's task list with a broken-down task in it. Same reason as
   scripts/hpshot.mjs: a panel is not reviewable as source. */
import { chromium } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve, join, extname } from 'path'

const HERE = dirname(fileURLToPath(import.meta.url))
const DOCS = resolve(HERE, '..', 'docs')
const OUT = resolve(HERE, '..', '.z-shots')
mkdirSync(OUT, { recursive: true })
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
const KEY = 'mission-control-demo-v12'

/* LOCAL date, not UTC. At 00:21 in Prague toISOString() still says yesterday,
   so every seeded task was planned for a day the Zone was not showing. */
const now = new Date()
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
const seed = {
  tasks: [
    { id: 't1', title: 'MC website: Start Here page, define and build it', list: 'today', plannedOn: today, done: false, space: 'personal', estimateMin: 300, estimated: true,
      subtasks: [
        { id: 't1s0', title: 'Decide what the page is actually for', estimateMin: 45, done: true },
        { id: 't1s1', title: 'Draft the copy end to end', estimateMin: 120, done: false },
        { id: 't1s2', title: 'Build it', estimateMin: 90, done: false },
        { id: 't1s3', title: 'Link it from the nav', estimateMin: 45, done: false },
      ] },
    { id: 't2', title: 'MC website: Restructure the prompt library', list: 'today', plannedOn: today, done: false, space: 'personal', estimateMin: 360, estimated: true,
      subtasks: [
        { id: 't2s0', title: 'Group the prompts by job', estimateMin: 180, done: false },
        { id: 't2s1', title: 'Rewrite the category blurbs', estimateMin: 180, done: false },
      ] },
    { id: 't3', title: 'MC website: Copy removals across the site', list: 'today', plannedOn: today, done: false, space: 'personal', estimateMin: 55, estimated: true },
    { id: 't4', title: 'MC website: Review the home page', list: 'today', plannedOn: today, done: false, space: 'personal', slot: 'morning', estimateMin: 90, estimated: true },
  ],
}

const b = await chromium.launch()
const errors = []
const page = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 })
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)) })
await page.goto(URL); await page.waitForTimeout(300)
/* Boot the app on a real page first so the store writes its own blob, then
   mutate that blob. Writing the key before the store has initialised just gets
   overwritten, which is why the first two attempts came back empty. */
await page.evaluate(() => {
  localStorage.setItem('mc-view', 'personal'); localStorage.setItem('mc-space', 'personal')
  localStorage.removeItem('mc-pomodoro')
})
await page.goto(`${URL}#/today`); await page.reload(); await page.waitForTimeout(900)
await page.evaluate(([K, s]) => {
  const cur = JSON.parse(localStorage.getItem(K))
  cur.tasks = s.tasks
  localStorage.setItem(K, JSON.stringify(cur))
}, [KEY, seed])
await page.goto(`${URL}#/zone`); await page.reload(); await page.waitForTimeout(1000)
const skip = page.getByRole('button', { name: 'Not today' })
if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(400) }
await page.waitForSelector('.zroom', { timeout: 10000 })
await page.screenshot({ path: join(OUT, 'zone.png') })

const steps = await page.locator('.zsteps .zsub').count()
console.log(`steps visible on load: ${steps}`)
const toggle = page.locator('.zrow-steps').nth(1)
if (await toggle.count()) {
  await toggle.click(); await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, 'zone-open.png') })
  console.log(`after opening the second task: ${await page.locator('.zsteps .zsub').count()}`)
}
await b.close(); server.close()
console.log(errors.length ? `CONSOLE ERRORS:\n${errors.slice(0, 6).join('\n')}` : 'no console errors')
