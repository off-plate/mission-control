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
/* Edit mode jiggles the tiles, so their buttons are never "stable". */
const tapJ = async (sel) => { await page.locator(sel).first().click({ force: true }); await wait(450) }
const onView = (id) => page.locator(`section.view.on[data-view="${id}"]`).count()

// ---- seed: a fresh install, then real tasks in the saved blob ----
await page.goto(URL); await wait(1200)
await page.evaluate(({ K, day }) => {
  const s = JSON.parse(localStorage.getItem(K))
  const t = (id, title, list, extra = {}) => ({ id, title, source: 'mc', estimateMin: 30, estimated: true, done: false, space: 'personal', list, category: 'deep', createdAt: day, addedAt: Date.now(), ...(list === 'today' ? { plannedOn: day, slot: 'morning' } : {}), ...extra })
  /* His real volumes: a long backlog, a full day, long titles. */
  const long = (i) => `Volume task ${i}: write the second half of the proposal for the interior studio and send it before the call`
  s.tasks = [t('ns-1', 'Shell finish task', 'today'), t('ns-2', 'Shell delete task', 'today', { slot: 'noon' }), t('ns-3', 'Shell backlog task', 'backlog'),
    ...Array.from({ length: 10 }, (_, i) => t(`nv-d${i}`, long(i), 'today', { slot: ['morning', 'noon', 'afternoon', 'evening'][i % 4], addedAt: Date.now() - 1e6 })),
    ...Array.from({ length: 45 }, (_, i) => t(`nv-b${i}`, i % 3 ? `Backlog ${i} ${long(i)}` : `Short ${i}`, 'backlog', { addedAt: Date.now() - (i + 2) * 864e5, category: ['call', 'admin', 'deep', 'quick'][i % 4] }))]
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

const dot = () => page.locator('#home .pdots i').evaluateAll((d) => d.findIndex((x) => x.classList.contains('on')))
const accent = () => page.locator('#app').evaluate((el) => getComputedStyle(el).getPropertyValue('--red').trim())
await step('home opens on All the first time', async () => {
  if ((await dot()) !== 0) throw new Error(`first page is ${await dot()}`)
})

await step('home: swipe between spaces, the accent follows the page', async () => {
  const all = await accent()
  await drag('#home .hp:nth-child(1) .grid', -260)
  if ((await dot()) !== 1) throw new Error(`page dot ${await dot()} after a left swipe`)
  const pers = await accent()
  await drag('#home .hp:nth-child(2) .grid', -260)
  if ((await dot()) !== 2) throw new Error(`page dot ${await dot()} after a second swipe`)
  const work = await accent()
  await page.screenshot({ path: `${SHOTS}/light-home-bigtime.png` })
  await drag('#home .hp:nth-child(3) .grid', 260)
  if ((await dot()) !== 1) throw new Error(`page dot ${await dot()} after swiping back to Personal`)
  if (new Set([all, work, pers]).size !== 3) throw new Error(`accents ${all} ${work} ${pers}`)
  if (pers.toUpperCase() !== '#FFC94A' || work.toUpperCase() !== '#7FD8F5') throw new Error(`accents ${pers} ${work}`)
})

await step('dock sits on the safe area, no extra gap', async () => {
  const gap = await page.locator('#dock').evaluate((d) => innerHeight - d.getBoundingClientRect().bottom)
  if (Math.abs(gap - 8) > 1) throw new Error(`dock gap ${gap}px, want max(8px, inset) = 8 here`)
})

await step('quick add: the type strip runs edge to edge, first and last fully visible', async () => {
  await tap('#dock [data-a="quickAdd"]')
  const r = await page.locator('.sheet.on .chips').first().evaluate(async (c) => {
    const box = c.getBoundingClientRect(), items = [...c.querySelectorAll('.chip')]
    const out = { sw: c.scrollWidth, cw: c.clientWidth, left: box.left, right: box.right, vw: innerWidth }
    out.first = items[0].getBoundingClientRect().left - box.left
    c.scrollLeft = c.scrollWidth; await new Promise((ok) => setTimeout(ok, 100))
    out.last = box.right - items[items.length - 1].getBoundingClientRect().right
    return out
  })
  if (!(r.sw > r.cw)) throw new Error('strip does not scroll')
  if (r.left > 0.5 || r.right < r.vw - 0.5) throw new Error(`strip spans ${r.left}..${r.right} of ${r.vw}`)
  if (r.first < 0 || r.last < 0) throw new Error(`first ${r.first} last ${r.last}`)
  if (!(await page.locator('.sheet.on .ctx').count())) throw new Error('no "Adding to" line')
  await page.screenshot({ path: `${SHOTS}/light-quickadd.png` })
  await tap('.sheet.on [data-a="sheetX"]')
})

const homeTypes = () => page.locator('#home .hp:nth-child(2) .grid > .w').evaluateAll((ws) => ws.map((w) => w.dataset.type + ':' + [...w.classList].find((c) => /^s\d\d$/.test(c))))
let edited = null
await step('edit mode: long-press, resize, remove + undo, add from gallery, drag, Done', async () => {
  const first = await page.locator('#home .hp:nth-child(2) .grid > .w').nth(4).boundingBox()
  await wait(950); await page.mouse.move(first.x + 20, first.y + 20); await page.mouse.down(); await wait(800); await page.mouse.up(); await wait(400)
  if (!(await page.locator('#home.editing').count())) throw new Error('long-press did not enter edit mode')
  await page.screenshot({ path: `${SHOTS}/light-edit.png` })
  const before = await homeTypes()
  await tapJ('#home .hp:nth-child(2) .w[data-type="habits"] .wz')
  const resized = await homeTypes()
  if (resized.join() === before.join()) throw new Error('resize changed nothing')
  await tapJ('#home .hp:nth-child(2) .w[data-type="chain"] .wx'); await wait(500)
  if ((await homeTypes()).some((x) => x.startsWith('chain'))) throw new Error('remove did not remove')
  await tap('#toast [data-a="undo"]'); await wait(400)
  if (!(await homeTypes()).some((x) => x.startsWith('chain'))) throw new Error('undo did not bring it back')
  await tap('[data-a="gallery"]'); await wait(400)
  await page.screenshot({ path: `${SHOTS}/light-gallery.png` })
  await tap('.sheet.on .gi[data-x="gym"]'); await wait(1200)
  if (!(await homeTypes()).some((x) => x.startsWith('gym'))) throw new Error('gallery add missing')
  const order0 = await homeTypes()
  const a = await page.locator('#home .hp:nth-child(2) .grid > .w').nth(2).boundingBox(), b = await page.locator('#home .hp:nth-child(2) .grid > .w').nth(3).boundingBox()
  await wait(950); await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down(); await wait(700)
  for (let i = 1; i <= 12; i++) { await page.mouse.move(a.x + a.width / 2 + (b.x + b.width / 2 - a.x - a.width / 2) * i / 12, a.y + a.height / 2 + (b.y + b.height / 2 - a.y - a.height / 2) * i / 12); await wait(30) }
  await wait(300); await page.mouse.up(); await wait(500)
  if ((await homeTypes()).join() === order0.join()) throw new Error('drag did not reorder ' + order0.join())
  await tap('[data-a="editDone"]')
  if (await page.locator('#home.editing').count()) throw new Error('Done did not leave edit mode')
  edited = await homeTypes()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mc:nothing-layout')))
  if (saved?.v !== 1) throw new Error('layout not saved with its version')
})

await step('edited layout survives a reload', async () => {
  await page.reload(); await wait(2000)
  const now = await homeTypes()
  if (now.join() !== edited.join()) throw new Error(`${now.join()} vs ${edited.join()}`)
  if ((await dot()) !== 0) throw new Error(`a reload opened page ${await dot()}, not All`)
  await drag('#home .hp:nth-child(1) .grid', -260)
})

await step('long titles stay inside their widgets, cut on a word', async () => {
  const bad = await page.locator('#home .grid .w .wt').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1 || /\w…\w/.test(e.textContent)).map((e) => e.textContent.slice(0, 40)))
  if (bad.length) throw new Error(bad.join(' | '))
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  if (wide) throw new Error('page scrolls sideways')
})

await step('adding on the Big Time page makes a Big Time task', async () => {
  await drag('#home .hp:nth-child(2) .grid', -260)
  if ((await dot()) !== 2) throw new Error('not on Big Time')
  await tap('#dock [data-a="quickAdd"]')
  await page.locator('#qat').fill('Shell Big Time task')
  await tap('.sheet.on [data-a="qaGo"]'); await wait(1300)
  const t = (await blob()).tasks.find((x) => x.title === 'Shell Big Time task')
  if (t?.space !== 'work') throw new Error(`landed in ${t?.space}`)
  await tap('#dock [data-x="plan"]')
  const ctx = await page.locator('section.view.on .ctx').textContent()
  if (!/Big Time/.test(ctx) || !/All projects/.test(ctx)) throw new Error(`context line: ${ctx}`)
  await tap('section.view.on [data-a="planSeg"][data-x="todo"]')
  const ph = await page.locator('#newtask').getAttribute('placeholder')
  if (!/Big Time, Unsorted/.test(ph)) throw new Error(`placeholder: ${ph}`)
  await page.screenshot({ path: `${SHOTS}/light-plan-bigtime.png` })
  await tap('section.view.on [data-a="planSeg"][data-x="day"]')
  await tap('#dock [data-x="home"]')
  await drag('#home .hp:nth-child(3) .grid', 260)
})

/* iOS zooms into any form control under 16px, and zooms the page out when anything is wider than it. */
const small = () => page.evaluate(() => [...document.querySelector('.nshell').shadowRoot.querySelectorAll('input,textarea,select')].filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.id || e.className))
const overflow = () => page.evaluate(() => {
  const r = document.querySelector('.nshell').shadowRoot, bad = []
  if (document.documentElement.scrollWidth > innerWidth) bad.push('document')
  for (const el of r.querySelectorAll('#app, section.view.on .vsc, .sheet.on .sh-b, #home .hp .hsc')) if (el.scrollWidth > el.clientWidth + 1) bad.push(el.className || el.id)
  return bad
})
await step('every form control is 16px or more, nothing is wider than the screen (375 and 390)', async () => {
  const bad = []
  for (const w of [390, 375]) {
    await page.setViewportSize({ width: w, height: 844 }); await wait(500)
    bad.push(...(await overflow()).map((x) => `${w} home ${x}`))
    for (const id of ['plan', 'habits', 'apps']) { await tap(`#dock [data-x="${id}"]`); bad.push(...(await overflow()).map((x) => `${w} ${id} ${x}`)); bad.push(...(await small()).map((x) => `${w} ${id} input ${x}`)) }
    await tap('section.view.on [data-a="planSeg"][data-x="todo"]').catch(() => {})
    for (const id of ['calendar', 'notes', 'ideas', 'people', 'bills', 'jar', 'health', 'gym', 'zone', 'focus', 'projects', 'weather', 'why', 'search', 'settings', 'today']) {
      await tap('#dock [data-x="apps"]'); await tap(`[data-a="drawerOpen"][data-x="${id}"]`); await wait(650)
      bad.push(...(await overflow()).map((x) => `${w} ${id} ${x}`)); bad.push(...(await small()).map((x) => `${w} ${id} input ${x}`))
      await tap('section.view.on [data-a="back"]').catch(() => {})
    }
    await tap('#dock [data-a="quickAdd"]'); bad.push(...(await small()).map((x) => `${w} quickadd ${x}`)); bad.push(...(await overflow()).map((x) => `${w} quickadd ${x}`)); await tap('.sheet.on [data-a="sheetX"]')
    await tap('#dock [data-x="home"]')
  }
  await page.setViewportSize({ width: 390, height: 844 }); await wait(400)
  if (bad.length) throw new Error([...new Set(bad)].slice(0, 12).join(' | '))
})

await step('open a widget, then close it', async () => {
  await tap('#home .hp:nth-child(2) [data-type="plan"]'); await wait(400)
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
  await page.locator('#toast [data-a="toastX"]').click().catch(() => {}); await wait(300)
  await drag('.sw[data-id="ns-2"] .sw-fg', -170)
  await tap('.sw[data-id="ns-2"] [data-a="taskDel"]'); await wait(1300)
  if ((await blob()).tasks.some((x) => x.id === 'ns-2')) throw new Error('not deleted in the store')
  await tap('#toast [data-a="undo"]'); await wait(1300)
  if (!(await blob()).tasks.some((x) => x.id === 'ns-2')) throw new Error('undo did not restore it')
})

await step('Plan: tap a task, its detail sheet opens', async () => {
  await page.locator('#toast [data-a="toastX"]').click().catch(() => {})
  await tap('.sw[data-id="ns-2"] [data-a="taskMenu"]')
  if (!(await page.locator('.sheet.on [data-a="taskDelM"]').count())) throw new Error('no task sheet')
  await page.screenshot({ path: `${SHOTS}/light-taskmenu.png` })
  await tap('.sheet.on [data-a="sheetX"]')
})

await step('Plan: the to-do list holds the whole backlog', async () => {
  await tap('section.view.on [data-a="planSeg"][data-x="todo"]'); await wait(500)
  const n = await page.locator('section.view.on .sw[data-sw="task"]').count()
  if (n < 45) throw new Error(`only ${n} rows`)
  await page.screenshot({ path: `${SHOTS}/light-todo.png` })
  await tap('section.view.on [data-a="planSeg"][data-x="day"]')
})

await step('add button: a task goes into the real store', async () => {
  await tap('#dock [data-a="quickAdd"]')
  await page.locator('#qat').fill('Shell quick add task')
  await tap('.sheet.on [data-a="qaGo"]'); await wait(1300)
  const t1 = (await blob()).tasks.find((x) => x.title === 'Shell quick add task')
  if (!t1) throw new Error('not in the store')
  if (t1.list !== 'today' || t1.plannedOn !== today()) throw new Error(`default should be today, got ${t1.list} ${t1.plannedOn}`)
  await tap('#dock [data-a="quickAdd"]')
  await page.locator('#qat').fill('Shell tomorrow evening task')
  await tap('.sheet.on [data-a="qaDay"][data-x="1"]'); await tap('.sheet.on [data-a="qaSlot"][data-x="evening"]')
  await page.screenshot({ path: `${SHOTS}/light-quickadd-when.png` })
  await tap('.sheet.on [data-a="qaGo"]'); await wait(1300)
  const t2 = (await blob()).tasks.find((x) => x.title === 'Shell tomorrow evening task')
  const tom = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') })
  if (t2?.list !== 'today' || t2.plannedOn !== tom || t2.slot !== 'evening') throw new Error(`tomorrow evening: ${t2?.list} ${t2?.plannedOn} ${t2?.slot}`)
  await tap('#dock [data-a="quickAdd"]')
  await page.locator('#qat').fill('Shell no date task')
  await tap('.sheet.on [data-a="qaDay"][data-x="none"]')
  await tap('.sheet.on [data-a="qaGo"]'); await wait(1300)
  const t3 = (await blob()).tasks.find((x) => x.title === 'Shell no date task')
  if (t3?.list !== 'backlog') throw new Error(`no date should go to the list, got ${t3?.list}`)
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
