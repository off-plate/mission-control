/* Reminders + the slimmer header + the all-visible floating button, on the built app (docs/), ?noremote.
   Run after `npm run build`: node scripts/reminders-check.mjs   Shots: /tmp/mc-rem-shots/ */
import { chromium, webkit } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve, join, extname } from 'path'
import assert from 'assert/strict'

const DOCS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docs')
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' }
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0].replace(/^\/mission-control/, '') || '/'
  const file = join(DOCS, path === '/' ? 'index.html' : path)
  if (!existsSync(file)) { if (extname(file)) { res.writeHead(404); res.end(); return } res.writeHead(200, { 'content-type': 'text/html' }); res.end(readFileSync(join(DOCS, 'index.html'))); return }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }); res.end(readFileSync(file))
})
await new Promise((ok) => server.listen(0, ok))
const URL = `http://localhost:${server.address().port}/mission-control/?noremote`
const KEY = 'mission-control-demo-v12'
const SHOTS = '/tmp/mc-rem-shots'
mkdirSync(SHOTS, { recursive: true })
let pass = 0, fail = 0
const step = async (name, fn) => { try { await fn(); pass++; console.log('PASS', name) } catch (e) { fail++; console.log('FAIL', name, '-', e.message.split('\n')[0]) } }

for (const [engine, size] of [[chromium, { width: 1440, height: 900 }], [chromium, { width: 1280, height: 760 }], [webkit, { width: 1440, height: 900 }]]) {
  const tag = `${engine.name()} ${size.width}x${size.height}`
  const b = await engine.launch(engine === chromium ? { args: ['--mute-audio'] } : {})
  const page = await b.newPage({ viewport: size })
  page.setDefaultTimeout(6000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()) })
  await page.goto(URL); await page.waitForTimeout(1500)
  const blob = () => page.evaluate((K) => JSON.parse(localStorage.getItem(K) ?? '{}'), KEY)

  await step(`${tag}: header keeps only Jarvis, Zone and Jar`, async () => {
    const labels = await page.locator('.topbar-right .btn-sq:visible').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
    for (const gone of ['Notes', 'Ideas', 'People', 'Bills', 'MyMind', 'Invoices']) assert.ok(!labels.includes(gone), `${gone} still in header: ${labels}`)
    for (const kept of [/Jarvis/i, /Zone/, /^Jar$/]) assert.ok(labels.some((l) => kept.test(l)), `${kept} missing: ${labels}`)
    assert.equal(labels.length, 3, `header squares: ${labels}`)
  })
  await step(`${tag}: floating button shows every page, no More, stack clear of the header`, async () => {
    await page.locator('.dock-fab').hover(); await page.waitForTimeout(500)
    if (!(await page.locator('.dock-menu').count())) { await page.locator('.dock-fab').click(); await page.waitForTimeout(500) }
    assert.equal(await page.locator('.dock-more-btn').count(), 0, 'More is still there')
    const labels = await page.locator('.dock-menu .dock-item-label').allTextContents()
    for (const want of ['Reminders', 'Notes', 'Ideas', 'Bills', 'People', 'MyMind', 'Skills', 'Watchless']) assert.ok(labels.some((l) => l.startsWith(want)), `${want} missing: ${labels}`)
    assert.ok(await page.locator('.dock-mini [aria-label^="Settings"]').count(), 'no Settings')
    const top = (await page.locator('.dock-menu').boundingBox()).y
    const hb = await page.locator('.topbar, header').first().boundingBox()
    assert.ok(top >= hb.y + hb.height - 2, `stack top ${top} under header bottom ${hb.y + hb.height}`)
    await page.screenshot({ path: `${SHOTS}/${engine.name()}-${size.width}-dock.png` })
  })
  await step(`${tag}: Reminders opens from the floating button`, async () => {
    await page.locator('.dock-item--page', { hasText: 'Reminders' }).click(); await page.waitForTimeout(800)
    await page.locator('.rem-page').waitFor()
  })
  await step(`${tag}: add to Today, it gets a time and counts`, async () => {
    await page.locator('.rem-tile', { hasText: 'Today' }).click()
    await page.locator('.rem-new input').fill('Call the dentist'); await page.keyboard.press('Enter'); await page.waitForTimeout(300)
    assert.equal(await page.locator('.rem-r', { hasText: 'Call the dentist' }).count(), 1)
    const r = (await blob()).reminders.find((x) => x.title === 'Call the dentist')
    assert.ok(r && r.remindAt && r.listId, JSON.stringify(r))
    assert.match(await page.locator('.rem-tile', { hasText: 'Today' }).locator('.rem-cnt').textContent(), /^1$/)
  })
  await step(`${tag}: flag it, it shows in Flagged`, async () => {
    await page.locator('.rem-r', { hasText: 'Call the dentist' }).locator('.rem-flag').click()
    await page.locator('.rem-tile', { hasText: 'Flagged' }).click(); await page.waitForTimeout(200)
    assert.equal(await page.locator('.rem-r', { hasText: 'Call the dentist' }).count(), 1)
  })
  await step(`${tag}: open it, set weekly repeat and a new list`, async () => {
    await page.locator('.rem-addlist').click()
    await page.locator('.rem-newlist input').fill('Errands'); await page.keyboard.press('Enter'); await page.waitForTimeout(300)
    assert.match(await page.locator('.rem-pt').textContent(), /Errands/)
    await page.locator('.rem-new input').fill('Buy batteries'); await page.keyboard.press('Enter'); await page.waitForTimeout(200)
    await page.locator('.rem-r', { hasText: 'Buy batteries' }).locator('.rem-open').click()
    await page.locator('.rem-chip', { hasText: 'Tomorrow' }).click()
    await page.locator('.rem-chip', { hasText: 'Every week' }).click()
    await page.screenshot({ path: `${SHOTS}/${engine.name()}-${size.width}-detail.png` })
    await page.locator('.rem-btn.is-primary', { hasText: 'Done' }).click(); await page.waitForTimeout(800)
    const r = (await blob()).reminders.find((x) => x.title === 'Buy batteries')
    assert.equal(r.repeat, 'weekly'); assert.ok(r.remindAt)
  })
  await step(`${tag}: ticking a repeating one completes it and makes the next`, async () => {
    await page.locator('.rem-r', { hasText: 'Buy batteries' }).first().locator('.rem-ck').click(); await page.waitForTimeout(1200)
    const rs = (await blob()).reminders.filter((x) => x.title === 'Buy batteries')
    assert.equal(rs.length, 2); assert.equal(rs.filter((x) => x.doneAt).length, 1)
    const [a, b2] = [rs.find((x) => x.doneAt).remindAt, rs.find((x) => !x.doneAt).remindAt]
    assert.equal((new Date(b2) - new Date(a)) / 864e5, 7)
  })
  await step(`${tag}: Completed shows it; survives a reload`, async () => {
    await page.reload(); await page.waitForTimeout(1500)
    await page.locator('.rem-page').waitFor()
    await page.locator('.rem-tile', { hasText: 'Completed' }).click()
    assert.ok(await page.locator('.rem-r', { hasText: 'Buy batteries' }).count() >= 1)
    await page.locator('.rem-tile', { hasText: 'Scheduled' }).click()
    await page.screenshot({ path: `${SHOTS}/${engine.name()}-${size.width}-reminders.png` })
  })
  await step(`${tag}: no console errors`, async () => { assert.deepEqual(errors, []) })
  await b.close()
}

/* Phone: the classic More sheet and the Nothing Apps grid both reach Reminders. */
{
  const b = await chromium.launch({ args: ['--mute-audio'] })
  const page = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  page.setDefaultTimeout(6000)
  await page.goto(URL); await page.waitForTimeout(1500)
  await step('phone: Reminders reachable from the phone menu and readable at 390', async () => {
    const nothing = await page.locator('.nshell').count()
    if (nothing) {
      await page.locator('#dock [data-x="apps"]').first().click(); await page.waitForTimeout(400)
      await page.locator('[data-a="drawerOpen"][data-x="reminders"]').first().click(); await page.waitForTimeout(900)
    } else {
      await page.locator('.tabbar-tab', { hasText: /More|Apps/ }).click(); await page.waitForTimeout(300)
      await page.locator('.tabsheet-tile', { hasText: 'Reminders' }).click(); await page.waitForTimeout(900)
    }
    await page.locator('.rem-page').waitFor()
    await page.locator('.rem-tile', { hasText: 'All' }).click(); await page.waitForTimeout(300)
    assert.ok(await page.locator('.rem-pane').isVisible(), 'list screen did not open')
    const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    assert.ok(!over, 'horizontal overflow')
    await page.screenshot({ path: `${SHOTS}/phone-reminders.png` })
  })
  await b.close()
}

console.log(`\n${pass} passed, ${fail} failed. Shots in ${SHOTS}`)
server.close()
process.exit(fail ? 1 : 0)
