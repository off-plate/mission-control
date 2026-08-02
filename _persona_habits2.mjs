import { chromium } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync } from 'fs'
import { join, extname, resolve } from 'path'
const DOCS = resolve(process.cwd(), 'docs')
const OUT = '/private/tmp/claude-501/-Users-michaelflorianrvltdigital-Claude-Helpers-Jarvis/b6bada4e-ea5d-4da2-b7b8-c483cb34e1d5/scratchpad/shots'
const PORT = 8401
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
const page = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
page.on('pageerror', e => console.log('PAGEERROR', e.message.slice(0,150)))
await page.goto(`${URL}#/habits`); await page.waitForTimeout(1000)

// how many day dots are disabled today
const info = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.habit-card')]
  return cards.map(c => {
    const name = c.querySelector('.habit-name')?.textContent
    const dots = [...c.querySelectorAll('.daydot')]
    const btns = dots.filter(d => d.tagName === 'BUTTON')
    const disabled = btns.filter(d => d.disabled).length
    return { name, dots: dots.length, buttons: btns.length, disabled, clickableToday: btns.length ? !btns[6].disabled : false }
  })
})
console.log(JSON.stringify(info, null, 1))

// try clicking today's dot on Meditation (routine-driven?)
const tryClick = async (habit) => {
  const card = page.locator('.habit-card', { hasText: habit }).first()
  const before = await card.innerText()
  const dots = card.locator('.daydot')
  const n = await dots.count()
  if (n === 0) { console.log(habit, 'NO DOTS'); return }
  try { await dots.nth(6).click({ timeout: 1500, force: false }) } catch (e) { console.log(habit, 'today dot NOT clickable:', String(e).split('\n')[0].slice(0,80)) }
  await page.waitForTimeout(400)
  const after = await card.innerText()
  console.log(`--- ${habit}: changed=${before !== after}`)
  if (before !== after) console.log('  after:', after.replace(/\n/g,' | '))
}
for (const h of ['Meditation', 'Take creatine', 'Before work routine', 'Out Brain Rot', 'Before bed routine']) await tryClick(h)

// header number after ticks
console.log('HEADER', await page.locator('.page').first().innerText().then(t => t.split('\n').slice(0,6).join(' / ')))

// switch window to 30 days
await page.selectOption('.rangepick', '30'); await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/laptop-30days.png`, fullPage: false })
const t30 = await page.evaluate(() => [...document.querySelectorAll('.habit-card')].slice(0,3).map(c=>c.innerText.replace(/\n/g,' | ')))
console.log('30d cards:', JSON.stringify(t30, null, 1))

// what does the "Personal" writeto do
await page.selectOption('.rangepick', '7'); await page.waitForTimeout(300)
const beforeCount = await page.locator('.habit-card').count()
await page.selectOption('.writeto', 'work').catch(()=>{})
await page.waitForTimeout(500)
const afterCount = await page.locator('.habit-card').count()
console.log('writeto change: cards', beforeCount, '->', afterCount)
await page.screenshot({ path: `${OUT}/laptop-writeto.png` })

await b.close(); server.close()
