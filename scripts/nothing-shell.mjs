/* The Nothing phone shell, end to end on the built app (docs/), phone size,
   touch, ?noremote so it can never reach his live data. Every assertion reads
   the REAL saved state (localStorage), not the shell's own screen.
   Screenshots go to /tmp/mc-nshell-shots/. Run: node scripts/nothing-shell.mjs */
import { chromium } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve, join, extname } from 'path'

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
const SHOTS = '/tmp/mc-nshell-shots'
mkdirSync(SHOTS, { recursive: true })

const b = await chromium.launch({ args: ['--mute-audio'] })
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.setDefaultTimeout(6000)
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

let pass = 0, fail = 0
const step = async (name, fn) => {
  try { await fn(); pass++; console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message.split('\n').slice(0, 12).join(' / ')}`) }
}
const blob = () => page.evaluate((K) => JSON.parse(localStorage.getItem(K) ?? '{}'), KEY)
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const wait = (ms) => page.waitForTimeout(ms)
/* The gesture layer takes mouse drags the same way it takes touch. */
const drag = async (sel, dx, dy = 0) => {
  const box = await page.locator(sel).first().boundingBox()
  if (!box) throw new Error(`nothing at ${sel}`)
  const x = box.x + Math.min(box.width / 2, 60), y = box.y + box.height / 2
  await page.waitForTimeout(950) // the shell ignores mouse right after a touch
  await page.mouse.move(x, y); await page.mouse.down()
  for (let i = 1; i <= 8; i++) { await page.mouse.move(x + dx * i / 8, y + dy * i / 8); await wait(16) }
  await page.mouse.up(); await wait(500)
}
const tap = async (sel) => { await page.locator(sel).first().click(); await wait(450) }
const onView = (id) => page.locator(`section.view.on[data-view="${id}"]`).count()

// ---- seed: a fresh install, then real tasks in the saved blob ----
await page.goto(URL); await wait(1200)
await page.evaluate(({ K, day }) => {
  const s = JSON.parse(localStorage.getItem(K))
  const t = (id, title, list, extra = {}) => ({ id, title, source: 'mc', estimateMin: 30, estimated: true, done: false, space: 'personal', list, category: 'deep', createdAt: day, addedAt: Date.now(), ...(list === 'today' ? { plannedOn: day, slot: 'morning' } : {}), ...extra })
  s.tasks = [t('ns-1', 'Shell finish task', 'today'), t('ns-2', 'Shell delete task', 'today', { slot: 'noon' }), t('ns-3', 'Shell backlog task', 'backlog')]
  s.dailySkipped = day
  localStorage.setItem(K, JSON.stringify(s))
  localStorage.setItem('mc-view', 'personal'); localStorage.setItem('mc-space', 'personal')
}, { K: KEY, day: today() })
await page.goto(`${URL}#/settings`); await page.reload(); await wait(1500)

await step('pick Nothing Light in Settings, the shell mounts', async () => {
  await page.getByRole('radio', { name: 'Nothing Light' }).or(page.getByRole('button', { name: 'Nothing Light' })).first().click()
  await wait(1500)
  if (!(await page.locator('.nshell').count())) throw new Error('no shell host')
  if ((await page.locator('#home .hp').count()) !== 3) throw new Error('home has not three pages')
  if (await page.locator('.topbar').count()) throw new Error('the classic header is still there')
  await page.screenshot({ path: `${SHOTS}/light-home.png` })
})

await step('home: swipe between spaces', async () => {
  await drag('#home .hp:nth-child(1) .grid', -260)
  const on = await page.locator('#home .pdots i').evaluateAll((d) => d.findIndex((x) => x.classList.contains('on')))
  if (on !== 1) throw new Error(`page dot ${on} after a left swipe`)
  await page.screenshot({ path: `${SHOTS}/light-home-bigtime.png` })
  await drag('#home .hp:nth-child(2) .grid', 260)
  const back = await page.locator('#home .pdots i').evaluateAll((d) => d.findIndex((x) => x.classList.contains('on')))
  if (back !== 0) throw new Error(`page dot ${back} after a right swipe`)
})

await step('open a widget, then close it', async () => {
  await tap('#home .hp:nth-child(1) [data-type="plan"]'); await wait(400)
  if (!(await onView('plan'))) throw new Error('Plan did not open from its tile')
  await page.screenshot({ path: `${SHOTS}/light-plan.png` })
  await tap('section.view.on [data-a="back"]'); await wait(400)
  if (await onView('plan')) throw new Error('Plan did not close')
})

await step('Plan: swipe to complete, How long, the real task is done', async () => {
  await tap('#dock [data-x="plan"]'); await wait(300)
  await drag('.sw[data-id="ns-1"] .sw-fg', 170)
  await page.screenshot({ path: `${SHOTS}/light-howlong.png` })
  await tap('.sheet.on [data-a="logActual"]')
  await wait(1500)
  const t = (await blob()).tasks.find((x) => x.id === 'ns-1')
  if (!t?.done || !t.actualMin) throw new Error(`stored task: ${JSON.stringify(t && { done: t.done, actualMin: t.actualMin })}`)
})

await step('Plan: delete, then undo, restores the real task', async () => {
  await drag('.sw[data-id="ns-2"] .sw-fg', -170)
  await tap('.sw[data-id="ns-2"] [data-a="taskDel"]'); await wait(1300)
  if ((await blob()).tasks.some((x) => x.id === 'ns-2')) throw new Error('not deleted in the store')
  await tap('#toast [data-a="undo"]'); await wait(1300)
  if (!(await blob()).tasks.some((x) => x.id === 'ns-2')) throw new Error('undo did not restore it')
})

await step('Plan: tap a task, its detail sheet opens', async () => {
  await tap('.sw[data-id="ns-2"] [data-a="taskMenu"]')
  if (!(await page.locator('.sheet.on [data-a="taskDelM"]').count())) throw new Error('no task sheet')
  await page.screenshot({ path: `${SHOTS}/light-taskmenu.png` })
  await tap('.sheet.on [data-a="sheetX"]')
})

await step('add button: a task goes into the real store', async () => {
  await tap('#dock [data-a="quickAdd"]')
  await page.locator('#qat').fill('Shell quick add task')
  await tap('.sheet.on [data-a="qaGo"]'); await wait(1300)
  if (!(await blob()).tasks.some((x) => x.title === 'Shell quick add task')) throw new Error('not in the store')
})

await step('Habits: tick a habit, the real habitLog changes', async () => {
  await tap('#dock [data-x="habits"]'); await wait(500)
  await page.screenshot({ path: `${SHOTS}/light-habits.png` })
  const id = await page.locator('[data-a="habitTick"]').first().getAttribute('data-x')
  await tap(`[data-a="habitTick"][data-x="${id}"]`); await wait(1300)
  if (!(await blob()).habitLog.some((x) => x.habitId === id && x.day === today())) throw new Error(`no log row for ${id}`)
})

await step('habit sheet: rises on tap, a past day toggles the real log', async () => {
  const id = await page.locator('section.view.on [data-a="habitSheet"]').first().getAttribute('data-x')
  await tap(`section.view.on [data-a="habitSheet"][data-x="${id}"]`); await wait(500)
  await page.screenshot({ path: `${SHOTS}/light-habitsheet.png` })
  const day = await page.locator('.sheet.on [data-a="hsDay"]').first()
  const x = await day.getAttribute('data-x'); const before = (await blob()).habitLog.filter((t) => t.habitId === id).length
  await day.click(); await wait(1300)
  const after = (await blob()).habitLog.filter((t) => t.habitId === id).length
  if (after === before) throw new Error(`habitLog for ${id} unchanged after ${x}`)
  await tap('.sheet.on [data-a="sheetX"]')
})

await step('routine sheet: opens from the card, a step tick persists', async () => {
  await tap('section.view.on .rtc[data-a="routineSheet"]'); await wait(500)
  await page.screenshot({ path: `${SHOTS}/light-routinesheet.png` })
  const before = (await blob()).habitLog.filter((x) => x.day === today()).length
  const ck = page.locator('.sheet.on [data-a="rsStep"]:not(.on)').first()
  await ck.click(); await wait(1300)
  const after = (await blob()).habitLog.filter((x) => x.day === today()).length
  if (after === before) throw new Error('no log row from the sheet')
  await tap('.sheet.on [data-a="sheetX"]')
})

await step('routine runner: a step tick persists', async () => {
  await tap('section.view.on [data-a="openRunner"]'); await wait(600)
  await page.screenshot({ path: `${SHOTS}/light-runner.png` })
  const before = (await blob()).habitLog.filter((x) => x.day === today()).length
  const next = page.locator('section.view.on [data-a="runNext"]')
  if (await next.isDisabled()) await tap('section.view.on [data-a="runSkip"]')
  await tap('section.view.on [data-a="runNext"]'); await wait(1300)
  const after = (await blob()).habitLog.filter((x) => x.day === today()).length
  if (after <= before) throw new Error(`habitLog today ${before} -> ${after}`)
  await tap('section.view.on [data-a="back"]').catch(() => {})
})

await step('Apps drawer shows badges, and Settings opens', async () => {
  await tap('#dock [data-x="apps"]'); await wait(400)
  await page.screenshot({ path: `${SHOTS}/light-apps.png` })
  await tap('[data-a="drawerOpen"][data-x="settings"]'); await wait(500)
  if (!(await onView('settings'))) throw new Error('Settings did not open')
})

await step('dark: the Nothing Dark look', async () => {
  await page.screenshot({ path: `${SHOTS}/light-settings.png` })
  await tap('section.view.on [data-a="themeTgl"]'); await wait(1200)
  if ((await page.evaluate(() => localStorage.getItem('mc:skin'))) !== 'nothing-dark') throw new Error('skin not switched')
  await tap('section.view.on [data-a="back"]'); await wait(300)
  await tap('#dock [data-x="home"]'); await wait(600)
  await page.screenshot({ path: `${SHOTS}/dark-home.png` })
  await tap('#dock [data-x="plan"]'); await page.screenshot({ path: `${SHOTS}/dark-plan.png` })
  await tap('#dock [data-x="habits"]'); await page.screenshot({ path: `${SHOTS}/dark-habits.png` })
})

await step('switch back to Classic, the classic app returns with the same data', async () => {
  await tap('#dock [data-x="apps"]'); await tap('[data-a="drawerOpen"][data-x="settings"]')
  await tap('[data-a="skinPick"][data-x="classic"]'); await wait(1200)
  if (await page.locator('.nshell').count()) throw new Error('shell still mounted')
  if (!(await page.locator('.shell').count())) throw new Error('no classic shell')
  const t = (await blob()).tasks.find((x) => x.id === 'ns-1')
  if (!t?.done) throw new Error('lost the finished task')
})

await step('reload: state persists', async () => {
  await page.reload(); await wait(1500)
  const s = await blob()
  if (!s.tasks.find((x) => x.id === 'ns-1')?.done || !s.tasks.some((x) => x.id === 'ns-2') || !s.tasks.some((x) => x.title === 'Shell quick add task')) throw new Error('state did not survive the reload')
})

await step('no page errors', async () => { if (errors.length) throw new Error(errors.slice(0, 3).join(' | ')) })

console.log(`\n${pass} passed, ${fail} failed. Shots in ${SHOTS}`)
await b.close(); server.close()
process.exit(fail ? 1 : 0)
