/* Drives the real Business room against a snapshot of docs/, ?noremote only, with
   seeded fake clients. Asserts the invariants (order, saved state, the accent
   while open and restored after, no sideways scroll, no console errors) and
   writes screenshots when SHOTS is set. Never touches a live profile. */
import { chromium } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync, cpSync, mkdtempSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { dirname, resolve, join, extname } from 'path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SNAP = mkdtempSync(join(tmpdir(), 'mc-biz-'))
cpSync(resolve(HERE, '..', 'docs'), SNAP, { recursive: true })
const SHOTS = process.env.SHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0].replace(/^\/mission-control/, '') || '/'
  const file = join(SNAP, path === '/' ? 'index.html' : path)
  if (!existsSync(file)) {
    if (extname(file)) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(readFileSync(join(SNAP, 'index.html'))); return
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }); res.end(readFileSync(file))
})
await new Promise((r) => server.listen(0, r))
const PORT = server.address().port
const KEY = 'mission-control-demo-v12'
const fails = []
const check = (ok, msg) => { if (!ok) fails.push(msg); console.log(ok ? 'ok  ' : 'FAIL', msg) }

const browser = await chromium.launch({ args: ['--mute-audio'] })
async function run(label, viewport) {
  const ctx = await browser.newContext({ viewport })
  await ctx.addInitScript(() => { try { window.speechSynthesis.speak = () => {} } catch { /* none */ } })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://localhost:${PORT}/mission-control/?noremote#/today`)
  await page.waitForTimeout(900)
  const now = Date.now()
  const day = (n) => { const d = new Date(now - n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  await page.evaluate(([K, d2, d9, t]) => {
    const s = JSON.parse(localStorage.getItem(K) || '{}')
    const base = { source: 'found', people: [], createdAt: t - 30 * 864e5, updatedAt: t }
    s.prospects = [
      { ...base, id: 'b1', name: 'Fake Cafe Alpha', stage: 'Acquired', touches: [{ id: 't1', step: 'work', day: d9 }], next: { text: 'Send the site feedback round', on: 'client', at: t - 9 * 864e5 } },
      { ...base, id: 'b2', name: 'Fake Studio With A Really Long Name That Must Wrap And Never Be Cut Off', stage: 'Acquired', touches: [{ id: 't2', step: 'work', day: d2 }] },
      { ...base, id: 'b3', name: 'Fake Clinic', stage: 'Meeting planned', touches: [{ id: 't3', step: 'work', day: d2 }], next: { text: 'Prepare the meeting', on: 'me', at: t - 2 * 864e5 } },
      { ...base, id: 'b4', name: 'Fake Replied', stage: 'Responded waiting', touches: [{ id: 't4', step: 'work', day: d2 }], replied: { day: d2, subject: 'Re: Your site' } },
      { ...base, id: 'b5', name: 'Fake Cold Lead', stage: 'Contacted', touches: [] },
    ]
    localStorage.setItem(K, JSON.stringify(s))
  }, [KEY, day(2), day(9), now])
  await page.reload(); await page.waitForTimeout(900)

  // Phone: the Nothing shell hands classic pages over by address; desktop uses the header switch.
  if (viewport.width < 640) { await page.evaluate(() => { location.hash = '/business' }) }
  else await page.getByRole('button', { name: 'Business', exact: true }).click()
  await page.waitForTimeout(700)
  check(await page.locator('.biz').count() === 1, `${label}: the Business room opens`)
  check((await page.evaluate(() => document.documentElement.getAttribute('data-space'))) === 'business', `${label}: its accent is on while open`)
  const names = await page.locator('.biz-row .biz-name').allInnerTexts()
  check(names.length === 4, `${label}: four live clients shown, the cold lead is not (${names.length})`)
  const active = await page.locator('.biz-sec', { hasText: 'Active clients' }).locator('.biz-row .biz-name').allInnerTexts()
  check(active[0]?.startsWith('Fake Studio'), `${label}: waiting on me first, no next step counts as mine (${active[0]})`)
  const cut = await page.evaluate(() => [...document.querySelectorAll('.biz-name')].filter((e) => e.scrollWidth > e.clientWidth + 1).length)
  check(cut === 0, `${label}: no client name is cut off`)
  check((await page.locator('.biz-quiet.is-old').count()) >= 1, `${label}: a client quiet 7+ days is flagged`)
  check(!/overdue|due /i.test(await page.locator('.biz').innerText()), `${label}: no due dates or overdue anywhere`)

  // Edit a next step, flip who it waits on, both must save.
  await page.locator('.biz-row', { hasText: 'Fake Studio' }).locator('.biz-step').click()
  await page.locator('.biz-input').fill('Book the kickoff')
  await page.locator('.biz-input').press('Enter'); await page.waitForTimeout(500)
  await page.locator('.biz-row', { hasText: 'Fake Studio' }).getByRole('button', { name: 'Client' }).click(); await page.waitForTimeout(600)
  const saved = await page.evaluate((K) => { const p = JSON.parse(localStorage.getItem(K)).prospects.find((x) => x.id === 'b2'); return p.next && `${p.next.text}|${p.next.on}` }, KEY)
  check(saved === 'Book the kickoff|client', `${label}: next step and who it waits on are saved (${saved})`)

  // Paste a transcript.
  await page.locator('#biz-client').click()
  await page.locator('.dd-option', { hasText: 'Fake Clinic' }).click()
  await page.getByRole('textbox', { name: 'Transcript' }).fill('Speaker 1: hello\nSpeaker 2: hi')
  await page.getByRole('button', { name: 'Save transcript' }).click(); await page.waitForTimeout(600)
  const note = await page.evaluate((K) => JSON.parse(localStorage.getItem(K)).notes.find((n) => n.title.startsWith('Transcript:')), KEY)
  check(!!note && /Fake Clinic/.test(note.title), `${label}: the transcript is saved as a note tagged to the client`)
  check((await page.locator('.biz-tr-row').count()) === 1, `${label}: it shows as waiting to be processed`)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  check(overflow <= 1, `${label}: no sideways scroll (${overflow}px)`)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/business-${label}.png`, fullPage: true })

  // Leave: the space accent comes back.
  if (viewport.width >= 640) {
    await page.getByRole('button', { name: 'Leave Business' }).click(); await page.waitForTimeout(500)
    check(!/business/.test(await page.evaluate(() => document.documentElement.getAttribute('data-space') ?? '')), `${label}: leaving gives the accent back`)
    check(!(await page.locator('.biz').count()), `${label}: the switch goes back to the page he came from`)
  }
  check(errors.length === 0, `${label}: no console errors ${errors.slice(0, 2).join(' | ')}`)
  await ctx.close()
}
await run('desktop', { width: 1440, height: 900 })
await run('phone', { width: 390, height: 844 })
await browser.close(); server.close()
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED')
process.exit(fails.length ? 1 : 0)
