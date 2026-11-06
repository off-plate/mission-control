/* Drives the real Business mode against a snapshot of docs/, ?noremote only, with
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
      { ...base, id: 'b5', name: 'Fake Cold Lead', stage: 'Contacted', touches: [{ id: 't5', step: 'work', day: d2 }] },
      { ...base, id: 'b6', name: 'Fake Audited', stage: 'Audited', touches: [] },
      { ...base, id: 'b7', name: 'Fake Lost', stage: 'Lost', touches: [] },
    ]
    localStorage.setItem(K, JSON.stringify(s))
  }, [KEY, day(2), day(9), now])
  await page.reload(); await page.waitForTimeout(900)
  const phone = viewport.width < 640
  const space = () => page.evaluate(() => document.documentElement.getAttribute('data-space'))

  /* Desktop: the header switch. Phone: the Nothing app's drawer opens the Business page, which turns the mode on. */
  if (phone) {
    await page.evaluate(() => { location.hash = '/business' })
  } else await page.locator('.mode-switch').first().getByRole('button', { name: 'Business' }).click()
  await page.waitForTimeout(800)
  check((await space()) === 'business', `${label}: the switch puts the business accent on`)
  const menu = phone
    ? (await page.locator('.tabbar.is-biz .tabbar-tab span').allInnerTexts()).join('|')
    : (await page.locator('nav.nav').first().locator('button, a').allInnerTexts()).map((s) => s.trim()).filter(Boolean).join('|')
  check(phone ? menu.toLowerCase() === 'today|clients|meetings|outreach|invoices|life' : /Today.*Clients.*Meetings.*Outreach.*Plan.*Invoices/i.test(menu), `${label}: the menu is the business menu (${menu})`)
  check(await page.locator('.biz').count() === 1, `${label}: Business Today opens`)
  const mine = await page.locator('.biz-sec[aria-label="Waiting on you"] .biz-clink').allInnerTexts()
  check(mine.length === 3 && mine.some((m) => m.startsWith('Fake Studio')) && mine.includes('Fake Replied') && !mine.includes('Fake Cafe Alpha'), `${label}: waiting on you holds the clients with no step or a step on me, not the one on the client (${mine.join(' / ')})`)
  check(!/overdue|due /i.test(await page.locator('.biz').innerText()), `${label}: no due dates anywhere`)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/mode-${label}-today.png` })

  // Clients board
  await page.evaluate(() => { location.hash = '/clients' }); await page.waitForTimeout(600)
  const cols = await page.locator('.biz-colh').allInnerTexts()
  check(cols.map((c) => c.replace(/\s+/g, ' ')).join('|').toLowerCase() === 'outreach 1|contacted 1|in conversation 2|active 2|done 0', `${label}: five columns over the Sheet statuses, Lost left out (${cols.map((c) => c.replace(/\s+/g, ' ')).join('|')})`)
  const cut = await page.evaluate(() => [...document.querySelectorAll('.biz-name')].filter((e) => e.scrollWidth > e.clientWidth + 1).length)
  check(cut === 0, `${label}: no client name is cut off`)
  if (!phone) {
    await page.locator('.biz-card', { hasText: 'Fake Cold Lead' }).dragTo(page.locator('.biz-colm', { hasText: 'In conversation' }))
    await page.waitForTimeout(500)
    const st = await page.evaluate((K) => JSON.parse(localStorage.getItem(K)).prospects.find((x) => x.id === 'b5').stage, KEY)
    check(st === 'Responded waiting', `${label}: dragging a card moves its stage (${st})`)
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/mode-${label}-clients.png` })
  await page.locator('.biz-card', { hasText: 'Fake Clinic' }).click(); await page.waitForTimeout(500)
  check((await page.locator('.biz-title').innerText()).toLowerCase() === 'fake clinic', `${label}: a card opens the client`)
  await page.locator('.biz-nextin').fill('Send the offer'); await page.locator('.biz-nextin').press('Enter'); await page.waitForTimeout(400)
  await page.locator('.biz-nextcard').getByRole('button', { name: 'Client' }).click(); await page.waitForTimeout(500)
  await page.locator('.biz-stages').getByRole('button', { name: 'Done' }).click(); await page.waitForTimeout(500)
  const c3 = await page.evaluate((K) => { const p = JSON.parse(localStorage.getItem(K)).prospects.find((x) => x.id === 'b3'); return `${p.next?.text}|${p.next?.on}|${p.stage}|${!!p.closed}` }, KEY)
  check(c3 === 'Send the offer|client|Acquired|true', `${label}: next step, who it waits on and Done all save (${c3})`)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/mode-${label}-client.png`, fullPage: !phone })

  // Transcript from the client page
  await page.locator('.biz-links').getByRole('button', { name: 'Paste a transcript' }).click(); await page.waitForTimeout(300)
  check((await page.locator('.biz-pick button[aria-pressed="true"]').innerText()).toLowerCase() === 'fake clinic', `${label}: the transcript sheet opens on this client`)
  await page.getByRole('textbox', { name: 'Transcript' }).fill('Speaker 1: hello')
  await page.getByRole('button', { name: 'Save transcript' }).click(); await page.waitForTimeout(500)
  const note = await page.evaluate((K) => JSON.parse(localStorage.getItem(K)).notes.find((n) => n.title.startsWith('Transcript:'))?.title, KEY)
  check(/Fake Clinic/.test(note ?? ''), `${label}: the transcript is saved as a note (${note})`)

  for (const [hash, want] of [['meetings', 'Meetings'], ['outreach', 'Outreach']]) {
    await page.evaluate((h) => { location.hash = '/' + h }, hash); await page.waitForTimeout(700)
    const h1 = (await page.locator('h1').first().innerText()).trim()
    check(h1.toLowerCase().includes(want.toLowerCase()), `${label}: ${want} opens (${h1})`)
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    check(ov <= 1, `${label}: ${want} has no sideways scroll (${ov}px)`)
  }
  if (!phone) {
    await page.getByRole('button', { name: 'Plan', exact: true }).first().click().catch(() => {}); await page.waitForTimeout(600)
    check((await space()) === 'business' && /plan/.test(await page.evaluate(() => location.hash)), `${label}: Plan opens and keeps business mode`)
  }

  if (phone) await page.getByRole('button', { name: 'Switch to Life' }).click()
  else await page.locator('.mode-switch').first().getByRole('button', { name: 'Life' }).click()
  await page.waitForTimeout(700)
  check((await space()) !== 'business', `${label}: Life gives the space accent back (${await space()})`)
  check(!(await page.locator('.biz').count()), `${label}: Life leaves the business pages`)
  const stored = await page.evaluate(() => localStorage.getItem('mc:mode'))
  check(stored === 'life', `${label}: the mode is remembered on this device (${stored})`)
  check(errors.length === 0, `${label}: no console errors ${errors.slice(0, 2).join(' | ')}`)
  await ctx.close()
}
await run('desktop', { width: 1440, height: 900 })
await run('phone', { width: 390, height: 844 })
await browser.close(); server.close()
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED')
process.exit(fails.length ? 1 : 0)
