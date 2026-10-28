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
page.on('pageerror', (e) => { if (!/Transition was skipped/.test(e.message)) errors.push(e.message) })
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

/* SHELL_ONLY=<regex> runs only the steps whose name matches (plus the ones marked always: the mount). Steps build on each other's
   state (seeded data, the layout edit, the Jarvis thread, the open review), so a step lists what it needs and a filtered run warns
   when one of those was skipped. Each line carries its own seconds. */
const ONLY = process.env.SHELL_ONLY ? new RegExp(process.env.SHELL_ONLY, 'i') : null
let pass = 0, fail = 0
const skipped = new Set()
const EDIT = 'edit mode: long-press, resize, remove + undo, add from gallery, drag, Done'
const NEEDS = {
  'edited layout survives a reload': [EDIT],
  'Jarvis: a suggestion sends, the face thinks, an action lands as a chip and in the real store': ['Jarvis: with no key the thread says so, with a way to Settings'],
  'Jarvis: the input is 16px, nothing overflows at 375 and 390': ['Jarvis: a suggestion sends, the face thinks, an action lands as a chip and in the real store'],
  'Jarvis: the conversation is still there after closing and reopening': ['Jarvis: a suggestion sends, the face thinks, an action lands as a chip and in the real store'],
  'Ideas: tapping a card opens the whole text, readable and scrollable': ['Ideas: the list shows two lines of body under the title'],
  'Ideas: edit title and body, the real card is updated and survives a reload': ['Ideas: tapping a card opens the whole text, readable and scrollable'],
  'Ideas: done, make it a task, delete and undo': ['Ideas: edit title and body, the real card is updated and survives a reload'],
  'daily review: swipe and quick taps leave no transform behind; back = previous, X = close': ['daily review: full screen at 390x844 and 430x932, one card at rest, nothing below the frame'],
  'daily review: each kind of goal has its own control and writes the real store': ['daily review: swipe and quick taps leave no transform behind; back = previous, X = close'],
  'daily review: Quitting buttons fit and write the slip; Start the day closes it': ['daily review: each kind of goal has its own control and writes the real store'],
  'adding on the Big Time page makes a Big Time task': ['home: swipe between spaces, the accent follows the page'],
  'Plan: delete, then undo, restores the real task': ['Plan: swipe to complete, How long, the real task is done'],
  'Habits: tab chip': [],
}
const step = async (name, fn, o = {}) => {
  if (ONLY && !o.always && !ONLY.test(name)) { skipped.add(name); return }
  for (const n of o.needs ?? NEEDS[name] ?? []) if (skipped.has(n)) console.log(`WARN  "${name}" builds on "${n}", which SHELL_ONLY skipped`)
  const t0 = Date.now(), secs = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`
  try { await fn(); pass++; console.log(`PASS ${secs()} ${name}`) } catch (e) { fail++; console.log(`FAIL ${secs()} ${name}: ${e.message.split('\n').slice(0, 12).join(' / ')}`) }
}
const blob = () => page.evaluate((K) => JSON.parse(localStorage.getItem(K) ?? '{}'), KEY)
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const wait = (ms) => page.waitForTimeout(ms)
const raf2 = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const click = (sel) => page.evaluate((q) => { const e = document.querySelector('.nshell').shadowRoot.querySelector(q); if (!e) throw new Error('missing ' + q); e.click() }, sel)
const viewReady = (id) => page.waitForFunction((v) => { const x = document.querySelector('.nshell').shadowRoot.querySelector(`section.view.on[data-view="${v}"]`); return !!x && !x.querySelector('.skel') && !x.querySelector('.morphclone') }, id, { timeout: 5000 })
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
/* The weather is a network call. Fixed here, so a slow connection never changes which widgets the home shows. */
await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ current: { time: '2026-10-27T12:00', temperature_2m: 9, apparent_temperature: 7, weather_code: 1 }, daily: { temperature_2m_max: [12], temperature_2m_min: [5], precipitation_probability_max: [20] }, hourly: { time: Array.from({ length: 48 }, (_, i) => `2026-10-27T${String(i % 24).padStart(2, '0')}:00`), temperature_2m: Array(48).fill(9), precipitation_probability: Array(48).fill(10), weather_code: Array(48).fill(1) } }) }))
/* ---- Jarvis: the prototype's view, driven by the real assistant. The model is ALWAYS stubbed here, never reached. ---- */
const sse = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
let jvReply = () => ({ say: 'All good.', show: [] }), jvDelay = 0
await page.route('https://api.groq.com/**', async (route) => {
  const req = route.request().postDataJSON()
  const asked = String(req.messages[req.messages.length - 1]?.content ?? '')
  if (jvDelay) await new Promise((r) => setTimeout(r, jvDelay))
  await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(JSON.stringify(jvReply(asked))) })
})

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
  {
    const d = new Date(), dom = d.getDate(), ymd = (n) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`
    const nowMin = d.getHours() * 60 + d.getMinutes(), b = dom > 1 ? dom - 1 : dom + 1, c = dom > 3 ? dom - 3 : dom + 3
    const ev = (n, title, start, end, extra) => ({ uid: `t-${n}-${title}`, day: ymd(n), start, end, title, where: 'Office', allDay: false, people: [], ...extra })
    localStorage.setItem('mc-shell-test-calendar', JSON.stringify([
      ev(dom, 'Standup, Big Time', 5, 15), ev(dom, 'Interior studio call', Math.max(0, nowMin - 10), Math.min(1439, nowMin + 50)),
      ev(b, 'Offsite day', null, null, { allDay: true, where: '' }),
      ev(c, 'Retail sync', 540, 600), ev(c, 'Design review', 660, 720), ev(c, 'Lunch with Petra', 750, 810), ev(c, 'Gym, push day', 1110, 1180),
    ]))
  }
  const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  const g = (id, name, extra) => ({ id, space: 'personal', name, current: 0, target: 1, unit: 'steps', note: '', timeframe: 'quarter', category: 'life', ...extra })
  s.habits = [...s.habits, { id: 'h-quit-seed', space: 'personal', name: 'Late-night scrolling', kind: 'break', quitSince: ago(10), days: [false, false, false, false, false, false, false], paused: false, frequency: 'daily' }]
  s.goals = [
    g('g-steps', 'Every debt on a written plan, with a title long enough to need two lines on a phone', { current: 1, target: 5, milestones: ['Map all debt', 'Real tax number confirmed', 'Insurance plan form filed', 'Bank payment plan requested', 'Bank plan agreed'].map((t, i) => ({ id: 'ms' + i, label: t, done: i === 0 })) }),
    g('g-yes', 'Tax return filed', { target: 1, unit: 'filed' }),
    g('g-amt', 'Italy fund', { current: 42000, target: 100000, unit: 'CZK' }),
    g('g-cnt', 'Gym sessions', { current: 3, target: 4, unit: 'sessions' }),
    g('g-hab', 'Bed before 1 AM', { target: 7, unit: 'nights', habitId: s.habits[0].id }),
  ]
  /* The Gym: a Hevy history on this device (it lives in localStorage), the workout habit, and a target for every metric. */
  localStorage.setItem('mc-hevy-key', 'hevy_shelltest'); localStorage.setItem('mc-hevy-last-sync', String(Date.now() - 864e5))
  localStorage.setItem('mc-hevy-stats', JSON.stringify({ [ago(9)]: { minutes: 62, volumeKg: 9800 }, [ago(2)]: { minutes: 70, volumeKg: 11240 } }))
  localStorage.setItem('mc-hevy-exercises', JSON.stringify({
    'Bench Press (Barbell)': [{ day: ago(9), e1rm: 70, weight: 60, reps: 5, repTotal: 15, isPR: true }, { day: ago(2), e1rm: 78.4, weight: 66, reps: 6, repTotal: 18, isPR: true }],
    'Pull Up': [{ day: ago(2), e1rm: 0, weight: 0, reps: 8, repTotal: 21, isPR: false }],
  }))
  s.habits = [...s.habits, { id: 'h-gym-seed', space: 'personal', name: 'Workout / Gym / Fitness', kind: 'build', days: [false, false, false, false, false, false, false], paused: false, frequency: 'times-per-week', targetPerWeek: 4 }]
  const gg = (id, name, extra) => ({ id, name, goal: 1, unit: 'kg', metric: 'e1rm', createdAt: Date.now(), updatedAt: Date.now(), ...extra })
  s.gymGoals = [
    gg('gg-bench', 'Bench e1RM', { goal: 100, exerciseName: 'Bench Press (Barbell)' }),
    gg('gg-pull', 'Pull-up day total', { goal: 30, unit: 'reps', metric: 'repTotal', exerciseName: 'Pull Up' }),
    gg('gg-sess', 'Sessions logged', { goal: 20, unit: 'sessions', metric: 'sessions' }),
    gg('gg-bw', 'Bodyweight', { goal: 91, metric: 'manual', current: 96, lowerIsBetter: true }),
  ]
  const longBody = Array.from({ length: 9 }, (_, i) => `Line ${i + 1}: the interior studio wants the site in Czech first, with the three room demos, a price table per item and one question on the last slide.`).join('\n') + '\nLAST LINE MARKER'
  s.ideaBoard = [{ id: 'idea-seed', title: 'Seed idea', body: longBody, color: 'amber', x: 40, y: 40, createdAt: Date.now() - 5 * 864e5, updatedAt: Date.now() - 864e5 }, { id: 'idea-two', title: 'Short idea', body: '', color: 'blue', x: 280, y: 40, createdAt: Date.now() - 864e5, updatedAt: Date.now() - 864e5 }]
  s.prompts = [{ id: 'prompt-seed', project: 'Mission Control', session: 'General', kind: 'Update', text: 'Prompt seed text for the sheet', createdAt: Date.now() - 864e5, updatedAt: Date.now() - 864e5 }]
  localStorage.setItem(K, JSON.stringify(s))
  localStorage.setItem('mc-view', 'personal'); localStorage.setItem('mc-space', 'personal')
}, { K: KEY, day: today() })
await page.goto(`${URL}#/settings`); await page.reload(); await wait(1500)

await step('the launch screen lets go once the app is up, and leaves nothing behind', async () => {
  await page.waitForFunction(() => !document.getElementById('mc-splash'), null, { timeout: 8000 })
})

await step('a phone opens the Nothing app by itself, Light by default', async () => {
  await wait(500)
  if (!(await page.locator('.nshell').count())) throw new Error('no shell host')
  if ((await page.locator('#home .hp').count()) !== 3) throw new Error('home has not three pages')
  if (await page.locator('.topbar').count()) throw new Error('the classic header is still there')
  await page.screenshot({ path: `${SHOTS}/light-home.png` })
}, { always: true })

const dot = () => page.locator('#home .pdots i').evaluateAll((d) => d.findIndex((x) => x.classList.contains('on')))
const accent = () => page.locator('#app').evaluate((el) => getComputedStyle(el).getPropertyValue('--red').trim())
await step('home opens on All the first time', async () => {
  if ((await dot()) !== 0) throw new Error(`first page is ${await dot()}`)
})

await step('home tiles: Ideas counts ideas (not prompts), text tiles are centred with equal padding', async () => {
  const r = await page.evaluate(() => {
    const R = document.querySelector('.nshell').shadowRoot, tile = (t) => R.querySelector(`#home .hp[data-page="all"] .w[data-type="${t}"]`)
    const ideas = tile('ideas'), out = { ideas: ideas ? ideas.textContent.trim() : null, badge: !!(ideas && ideas.querySelector('.wbd')) }
    const gaps = (t) => {
      const w = tile(t); if (!w) return null
      const b = w.getBoundingClientRect(), kids = [...w.querySelector('.wi').children].filter((c) => c.getBoundingClientRect().height)
      const u = kids.reduce((a, c) => { const q = c.getBoundingClientRect(); return { t: Math.min(a.t, q.top), b: Math.max(a.b, q.bottom), l: Math.min(a.l, q.left) } }, { t: 1e9, b: -1e9, l: 1e9 })
      return { top: u.t - b.top, bottom: b.bottom - u.b, left: u.l - b.left }
    }
    out.why = gaps('why'); out.notes = gaps('notes'); return out
  })
  if (!/2 IDEAS/i.test(r.ideas || '') || /prompt/i.test(r.ideas)) throw new Error(`Ideas widget says "${r.ideas}"`)
  if (!r.badge) throw new Error('no badge for the waiting prompt')
  for (const t of ['why', 'notes']) { const g = r[t]; if (!g) throw new Error(`no ${t} tile`); if (Math.abs(g.top - g.bottom) > 3 || g.left < 14 || g.top < 10) throw new Error(`${t} tile gaps ${JSON.stringify(g)}`) }
  await page.screenshot({ path: `${SHOTS}/light-home-tiles.png` })
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
  if (all.toUpperCase() !== '#D71921' || pers.toUpperCase() !== '#00874A' || work.toUpperCase() !== '#2453E6') throw new Error(`accents ${all} ${pers} ${work}`)
})

await step('mid-swipe each page shows its own accent', async () => {
  await drag('#home .hp:nth-child(2) .grid', 260)
  if ((await dot()) !== 0) throw new Error('not back on All')
  const box = await page.locator('#home .hp:nth-child(1) .grid').boundingBox()
  await wait(950); await page.mouse.move(box.x + 300, box.y + 60); await page.mouse.down()
  for (let i = 1; i <= 6; i++) { await page.mouse.move(box.x + 300 - i * 25, box.y + 60); await wait(16) }
  const acc = await page.evaluate(() => { const r = document.querySelector('.nshell').shadowRoot, g = (p) => getComputedStyle(r.querySelector(`.hp[data-page="${p}"]`)).getPropertyValue('--red').trim().toUpperCase(); return { all: g('all'), personal: g('personal') } })
  await page.screenshot({ path: `${SHOTS}/light-midswipe.png` })
  await page.mouse.move(box.x + 300, box.y + 60); await page.mouse.up(); await wait(500)
  if (acc.all !== '#D71921' || acc.personal !== '#00874A') throw new Error(JSON.stringify(acc))
  await drag('#home .hp:nth-child(1) .grid', -260)
  if ((await dot()) !== 1) throw new Error('not on Personal again')
})

await step('Plan, Habits and Apps: header row as high as Home (iPhone 15 Pro inset), title centred, at rest and scrolled', async () => {
  await page.evaluate(() => document.querySelector('.nshell').style.setProperty('--sat', '59px')); await wait(300)
  const R = (sel) => page.locator(sel).first().evaluate((e) => { const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, mid: b.left + b.width / 2 } })
  const home = await R('#home .hp:nth-child(2) .htop')
  await page.screenshot({ path: `${SHOTS}/light-home-inset.png` })
  const bad = [], vw = await page.evaluate(() => innerWidth)
  for (const id of ['plan', 'habits', 'apps']) {
    await tap(`#dock [data-x="${id}"]`); await wait(300)
    for (const scroll of [0, 600]) {
      await page.locator('section.view.on .vsc').evaluate((e, y) => { e.scrollTop = y }, scroll); await wait(350)
      const row = await R('section.view.on .vtop > :first-child'), top = await R('section.view.on .vtop'), title = await R('section.view.on .vtt')
      if (Math.abs(row.top - (home.top + 2)) > 2 && Math.abs(row.top - home.top) > 2) bad.push(`${id}@${scroll} row ${row.top} vs home ${home.top}`)
      if (top.bottom - row.bottom > 8) bad.push(`${id}@${scroll} header block ends ${top.bottom - row.bottom}px below its row`)
      if (Math.abs(title.mid - vw / 2) > 1) bad.push(`${id}@${scroll} title centre ${title.mid} vs ${vw / 2}`)
      await page.screenshot({ path: `${SHOTS}/light-${id}-${scroll ? 'scrolled' : 'top'}.png` })
    }
    await page.locator('section.view.on .vsc').evaluate((e) => { e.scrollTop = 0 })
  }
  await tap('#dock [data-x="home"]')
  await page.evaluate(() => document.querySelector('.nshell').style.removeProperty('--sat'))
  if (bad.length) throw new Error(bad.join(' | '))
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

const overflowNow = () => page.evaluate(() => {
  const r = document.querySelector('.nshell').shadowRoot, bad = []
  if (document.documentElement.scrollWidth > innerWidth) bad.push('document')
  for (const el of r.querySelectorAll('#app, section.view.on .vsc, .sheet.on .sh-b, #home .hp .hsc')) if (el.scrollWidth > el.clientWidth + 1) bad.push(el.className || el.id)
  return bad
})
const goHome = async (i) => { for (let n = 0; n < 4 && (await dot()) !== i; n++) await drag(`#home .hp:nth-child(${(await dot()) + 1}) .grid`, (await dot()) > i ? 260 : -260) }
const inJarvis = () => page.locator('section.view.on[data-view="jarvis"]').count()
const closeJarvis = async () => { await tap('section.view.on [data-a="back"]'); await wait(500) }
const msgs = () => page.locator('section.view.on .thread .msg').count()

await step('Jarvis opens from the home widget as the shell view, not the classic page', async () => {
  await goHome(0)
  await tap('#home .hp:nth-child(1) [data-type="jarvis"]'); await wait(700)
  if (!(await inJarvis())) throw new Error('no Jarvis view')
  if (await page.locator('.topbar').count()) throw new Error('the classic page opened')
  if (!(await page.locator('section.view.on .jface svg.face').count())) throw new Error('no face')
  await page.screenshot({ path: `${SHOTS}/light-jarvis-empty.png` })
  await closeJarvis()
})

await step('Jarvis opens from the dock + long-press and from the Apps drawer', async () => {
  const box = await page.locator('#dock .qa').boundingBox()
  await wait(950); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await wait(750); await page.mouse.up(); await wait(900)
  if (!(await inJarvis())) throw new Error('long-press did not open Jarvis')
  await closeJarvis()
  await tap('#dock [data-x="apps"]'); await tap('[data-a="drawerOpen"][data-x="jarvis"]'); await wait(700)
  if (!(await inJarvis())) throw new Error('Apps tile did not open Jarvis')
  if (await page.locator('.topbar').count()) throw new Error('the Apps tile opened the classic page')
})

await step('Jarvis: with no key the thread says so, with a way to Settings', async () => {
  await page.locator('#jvq').fill('hello there'); await tap('#jvsend'); await wait(900)
  const err = await page.locator('section.view.on .msg.err').textContent()
  if (!/key/i.test(err) || !/Settings/.test(err)) throw new Error(`err: ${err}`)
  if (!(await page.locator('section.view.on .msg.err [data-a="openClassic"]').count())) throw new Error('no Settings button')
  await page.screenshot({ path: `${SHOTS}/light-jarvis-nokey.png` })
})

await step('Jarvis: a suggestion sends, the face thinks, an action lands as a chip and in the real store', async () => {
  await page.evaluate(() => localStorage.setItem('mc-groq-key', 'gsk_shelltest'))
  jvDelay = 1600
  jvReply = (asked) => /Plan my evening/.test(asked) ? { say: 'Gym at 18:30, then the evening is yours.', show: [{ kind: 'today' }] } : { say: 'Putting it on noon.', show: [{ kind: 'today' }], do: [{ kind: 'add', title: 'Jarvis stub task', list: 'today', slot: 'noon' }] }
  await tap('#jvchips .chip[data-l="Plan my evening"]'); await wait(500)
  const mode = await page.locator('#jvface').getAttribute('class')
  if (!/think/.test(mode)) throw new Error(`face is "${mode}" while the model works`)
  await page.screenshot({ path: `${SHOTS}/light-jarvis-thinking.png` })
  await page.waitForSelector('section.view.on .msg.it .jvcard', { timeout: 8000 })
  jvDelay = 0
  await page.locator('#jvq').fill('add a task called Jarvis stub task to noon'); await tap('#jvsend')
  await page.waitForSelector('section.view.on .msg.it .did:not(.no)', { timeout: 8000 }); await wait(900)
  const line = await page.locator('section.view.on .msg .did').first().textContent()
  if (!/Jarvis stub task/.test(line)) throw new Error(`chip: ${line}`)
  const t = (await blob()).tasks.find((x) => x.title === 'Jarvis stub task')
  if (!t || t.slot !== 'noon' || t.list !== 'today') throw new Error(`store: ${JSON.stringify(t && { slot: t.slot, list: t.list })}`)
  await page.screenshot({ path: `${SHOTS}/light-jarvis-thread.png` })
})

await step('Jarvis: the input is 16px, nothing overflows at 375 and 390', async () => {
  const bad = []
  for (const w of [390, 375]) {
    await page.setViewportSize({ width: w, height: 844 }); await wait(500)
    bad.push(...(await overflowNow()).map((x) => `${w} ${x}`))
    const fs = await page.locator('#jvq').evaluate((e) => parseFloat(getComputedStyle(e).fontSize))
    if (fs < 16) bad.push(`input ${fs}px`)
  }
  await page.setViewportSize({ width: 390, height: 844 }); await wait(300)
  if (bad.length) throw new Error(bad.join(' | '))
})

await step('Jarvis: the conversation is still there after closing and reopening', async () => {
  const before = await msgs()
  await closeJarvis()
  await tap('#dock [data-x="apps"]'); await tap('[data-a="drawerOpen"][data-x="jarvis"]'); await wait(700)
  if ((await msgs()) !== before) throw new Error(`${before} messages before, ${await msgs()} after`)
  await closeJarvis()
  await tap('#dock [data-x="apps"]'); await tap('[data-a="drawerOpen"][data-x="settings"]'); await wait(500)
  await tap('section.view.on [data-a="openClassic"][data-x="settings"]'); await wait(1200)
  /* The shell stays mounted but hidden behind a classic page, so back lands exactly where it was. */
  if (!(await page.evaluate(() => document.querySelector('.nshell')?.style.display === 'none'))) throw new Error('the shell still shows over the classic Settings')
  if (!(await page.locator('.phonehead').count())) throw new Error('the classic page has no standard header')
  const off = await page.evaluate(() => { const t = document.querySelector('.phonehead h1').getBoundingClientRect(); return Math.abs(t.left + t.width / 2 - innerWidth / 2) })
  if (off > 1) throw new Error(`the classic page title is ${off}px off centre`)
  if (await page.evaluate(() => getComputedStyle(document.querySelector('.topstick')).display !== 'none')) throw new Error('the classic header is still showing')
  await page.goBack(); await wait(1800)
  if (await page.evaluate(() => document.querySelector('.nshell')?.style.display === 'none')) throw new Error('the shell did not come back on back')
  if (!(await page.locator('section.view.on[data-view="settings"]').count())) throw new Error('the shell did not keep its place: Settings view is gone')
  await tap('section.view.on [data-a="back"]'); await wait(500)
  await tap('#dock [data-x="home"]'); await wait(600)
  await goHome(0)
  await tap('#home .hp:nth-child(1) [data-type="jarvis"]'); await wait(800)
  if ((await msgs()) !== before) throw new Error(`after Settings: ${await msgs()} vs ${before}`)
  await closeJarvis()
  await goHome(1)
})

const card = async (id) => (await blob()).ideaBoard.find((c) => c.id === id)
const closeSheetX = () => tap('.sheet.on [data-a="sheetX"]')
await step('Ideas: the list shows two lines of body under the title', async () => {
  await tap('#dock [data-x="apps"]'); await tap('[data-a="drawerOpen"][data-x="ideas"]'); await wait(900)
  const r = await page.locator('section.view.on .idea[data-x="idea-seed"] .idprev').evaluate((e) => ({ h: e.clientHeight, lh: parseFloat(getComputedStyle(e).lineHeight), t: e.textContent.length }))
  if (!(r.t > 100) || r.h > r.lh * 2 + 2) throw new Error(`preview ${JSON.stringify(r)}`)
  await page.screenshot({ path: `${SHOTS}/light-ideas.png` })
})

await step('Ideas: tapping a card opens the whole text, readable and scrollable', async () => {
  await tap('section.view.on .idea[data-x="idea-seed"]'); await wait(700)
  const r = await page.evaluate(() => {
    const R = document.querySelector('.nshell').shadowRoot, ta = R.querySelector('.sheet.on .idbody'), sb = R.querySelector('.sheet.on .sh-b')
    sb.scrollTop = sb.scrollHeight
    const tr = ta.getBoundingClientRect(), br = sb.getBoundingClientRect()
    return { len: ta.value.length, lines: ta.value.split('\n').length, grown: ta.scrollHeight <= ta.clientHeight + 2, scrollable: sb.scrollHeight > sb.clientHeight, fs: parseFloat(getComputedStyle(ta).fontSize), tfs: parseFloat(getComputedStyle(R.querySelector('.sheet.on #idt')).fontSize), lastVisible: tr.bottom <= br.bottom + 1 }
  })
  if (r.len < 600 || r.lines < 5) throw new Error(`body ${r.len} chars, ${r.lines} lines`)
  if (!r.grown || !r.scrollable || !r.lastVisible) throw new Error(JSON.stringify(r))
  if (r.fs < 16 || r.tfs < 16) throw new Error(`font ${r.fs}/${r.tfs}`)
  await page.screenshot({ path: `${SHOTS}/light-idea-sheet.png` })
})

await step('Ideas: edit title and body, the real card is updated and survives a reload', async () => {
  await page.locator('.sheet.on #idt').fill('Edited idea title')
  await page.locator('.sheet.on .idbody').fill('Edited body line one\nEdited body line two')
  await wait(1100)
  const c = await card('idea-seed')
  if (c.title !== 'Edited idea title' || !/line two/.test(c.body)) throw new Error(JSON.stringify(c))
  /* closing right after typing must not lose it */
  await page.locator('.sheet.on .idbody').fill('Quick close marker body')
  await closeSheetX(); await wait(900)
  if (!/Quick close marker/.test((await card('idea-seed')).body)) throw new Error('lost text closed mid-typing')
  await page.reload(); await wait(2000)
  const c2 = await card('idea-seed')
  if (c2.title !== 'Edited idea title' || !/Quick close marker/.test(c2.body)) throw new Error('not kept after reload')
})

await step('Ideas: done, make it a task, delete and undo', async () => {
  await tap('#dock [data-x="apps"]'); await tap('[data-a="drawerOpen"][data-x="ideas"]'); await wait(900)
  await tap('section.view.on .idea[data-x="idea-seed"]'); await wait(600)
  await tap('#idtgl'); await wait(1000)
  if (!(await card('idea-seed')).doneAt) throw new Error('not done')
  await tap('#idtgl'); await wait(1000)
  if ((await card('idea-seed')).doneAt) throw new Error('not reopened')
  await tap('.sheet.on [data-a="ideaTask"]'); await wait(1000)
  if (!(await blob()).tasks.some((t) => t.title === 'Edited idea title')) throw new Error('no task made')
  if (!(await page.locator('#toast [data-a="seeTask"]').count())) throw new Error('no See it')
  await tap('.sheet.on [data-a="ideaDel"]'); await wait(1000)
  if (await card('idea-seed')) throw new Error('not deleted')
  await tap('#toast [data-a="undo"]'); await wait(1000)
  if (!(await card('idea-seed'))) throw new Error('undo did not bring it back')
})

await step('Ideas: a new idea is saved from the empty sheet', async () => {
  await tap('section.view.on [data-a="ideaAdd"]'); await wait(600)
  await page.locator('.sheet.on #idt').fill('Brand new idea'); await page.locator('.sheet.on .idbody').fill('A body for the new one\nsecond line')
  await closeSheetX(); await wait(1000)
  const c = (await blob()).ideaBoard.find((x) => x.title === 'Brand new idea')
  if (!c || !/second line/.test(c.body)) throw new Error(JSON.stringify(c))
})

await step('Prompts: tapping one opens its sheet and edits the real prompt', async () => {
  await tap('section.view.on [data-a="iface"][data-x="prompts"]'); await wait(500)
  await tap('section.view.on [data-a="promptOpen"]'); await wait(600)
  await page.locator('.sheet.on .idbody').fill('Prompt edited in the sheet'); await closeSheetX(); await wait(900)
  if (!(await blob()).prompts.some((p) => p.id === 'prompt-seed' && p.text === 'Prompt edited in the sheet')) throw new Error('prompt not updated')
  await closeJarvis(); await tap('#dock [data-x="home"]'); await wait(300); await goHome(1)
})

/* ---- The daily review: a full-screen takeover, with a control that fits every kind of goal ---- */
const sizeOk = async (tag) => {
  const m = await page.evaluate(() => {
    const R = document.querySelector('.nshell').shadowRoot, rect = (e) => { const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right } }
    const frame = rect(R.querySelector('.dvstack')), ctl = rect(R.querySelector('.dvctl')), cards = [...R.querySelectorAll('.dv-card')].map((c) => ({ ...rect(c), op: getComputedStyle(c).opacity, tf: getComputedStyle(c).transform, k: c.dataset.k }))
    return { frame, ctl, cards, vh: innerHeight }
  })
  const bad = [], vis = m.cards.filter((c) => +c.op > 0.01), sab = 34
  if (m.ctl.t - m.frame.b > 12 || m.ctl.t - m.frame.b < 0) bad.push(`${tag} card area ends ${m.ctl.t - m.frame.b}px above the controls`)
  if (m.vh - m.ctl.b > sab + 24 || m.vh - m.ctl.b < 14) bad.push(`${tag} controls sit ${m.vh - m.ctl.b}px from the bottom`)
  if (vis.length !== 1) bad.push(`${tag} ${vis.length} cards visible at rest`)
  else { const c = vis[0]; if (['t', 'b', 'l', 'r'].some((k) => Math.abs(c[k] - m.frame[k]) > 1.5)) bad.push(`${tag} card ${JSON.stringify(c)} vs frame ${JSON.stringify(m.frame)}`); if (c.tf !== 'none') bad.push(`${tag} transform ${c.tf}`) }
  if (m.cards.some((c) => c.b > m.frame.b + 1 || c.b > m.ctl.t)) bad.push(`${tag} a card reaches below the frame`)
  if (m.frame.t < 100) bad.push(`${tag} frame starts at ${m.frame.t}`)
  return bad
}
const stepDaily = async (n) => { for (let i = 0; i < n; i++) { await page.locator('section.view.on [data-a="dvNext"]').click(); await wait(750) } }
await step('daily review: full screen at 390x844 and 430x932, one card at rest, nothing below the frame', async () => {
  const bad = []
  for (const [w, h] of [[390, 844], [430, 932]]) {
    await page.setViewportSize({ width: w, height: h }); await wait(400)
    await page.evaluate(() => { const n = document.querySelector('.nshell'); n.style.setProperty('--sat', '59px'); n.style.setProperty('--sab', '34px') }); await wait(300)
    await tap('#dock [data-x="plan"]'); await tap('section.view.on [data-a="openDaily"]'); await wait(900)
    for (let k = 0; k < 6; k++) {
      bad.push(...(await sizeOk(`${w} card ${k}`)))
      if (w === 390) await page.screenshot({ path: `${SHOTS}/light-daily-${k}.png` })
      if (k < 5) await stepDaily(1)
    }
    await tap('section.view.on [data-a="dvClose"]'); await wait(600)
    await tap('#dock [data-x="home"]')
  }
  await page.setViewportSize({ width: 390, height: 844 }); await wait(300)
  if (bad.length) throw new Error(bad.slice(0, 6).join(' | '))
})

await step('daily review: swipe and quick taps leave no transform behind; back = previous, X = close', async () => {
  await tap('#dock [data-x="plan"]'); await tap('section.view.on [data-a="openDaily"]'); await wait(900)
  await drag('.dv-card[data-k="0"]', -260); await wait(500)
  if (!(await page.locator('.dvdots i').evaluateAll((d) => d.findIndex((x) => x.classList.contains('on')) === 1))) throw new Error('swipe did not advance')
  await drag('.dv-card[data-k="1"]', 260); await wait(500)
  await page.locator('section.view.on [data-a="dvNext"]').click(); await page.locator('section.view.on [data-a="dvNext"]').click(); await page.locator('section.view.on [data-a="dvPrev"]').first().click(); await wait(800)
  const bad = await sizeOk('after taps'); if (bad.length) throw new Error(bad.join(' | '))
  const first = await page.locator('section.view.on .dvdots i.on').evaluateAll((d) => d.length)
  await page.locator('section.view.on .vtop [data-a="dvPrev"]').click(); await wait(600)
  if (!(await page.locator('section.view.on[data-view="daily"]').count())) throw new Error('the header back closed the review instead of going back a card')
})

await step('daily review: each kind of goal has its own control and writes the real store', async () => {
  await page.evaluate(() => { const n = document.querySelector('.nshell'); n.style.removeProperty('--sat'); n.style.removeProperty('--sab') })
  while ((await page.locator('.dvdots i').evaluateAll((d) => d.findIndex((x) => x.classList.contains('on')))) < 3) await stepDaily(1)
  await page.screenshot({ path: `${SHOTS}/light-daily-goals.png` })
  const goal = async (id) => (await blob()).goals.find((g) => g.id === id)
  const title = await page.locator('.dv-card[data-k="3"] .dvg .rt').first().evaluate((e) => ({ full: e.textContent, clipped: e.scrollHeight > e.clientHeight + 1 }))
  if (title.clipped) throw new Error('goal title is cut off')
  /* steps */
  if ((await page.locator('.dvms .row').count()) !== 5) throw new Error('no five-step checklist')
  await tap('[data-a="dvMs"][data-x="g-steps:ms1"]'); await wait(1100)
  if (!(await goal('g-steps')).milestones.find((m) => m.id === 'ms1').done) throw new Error('milestone not ticked in the store')
  /* yes / no */
  await tap('[data-a="dvYes"][data-x="g-yes:yes"]'); await wait(1100)
  if ((await goal('g-yes')).current !== 1) throw new Error('yes did not reach the store')
  await tap('[data-a="dvYes"][data-x="g-yes:no"]'); await wait(1100)
  if ((await goal('g-yes')).current !== 0) throw new Error('not yet did not reach the store')
  /* amount: presets scale to the target, custom amount with a note, undo */
  const pre = await page.locator('.dvpre .chip').allTextContents()
  if (pre.map((t) => t.replace(/\s|\u00a0/g, '')).join() !== '+1000,+5000,+10000') throw new Error(`presets ${pre.join(' / ')}`)
  await tap('[data-a="dvAmt"][data-x="g-amt:5000"]'); await wait(1100)
  if ((await goal('g-amt')).current !== 47000) throw new Error(`amount ${(await goal('g-amt')).current}`)
  await page.locator('.dvamt').fill('2500'); await page.locator('.dvnote').fill('from the bonus')
  const shown = await page.locator('.dvamt').inputValue(); const fs = await page.locator('.dvamt').evaluate((e) => parseFloat(getComputedStyle(e).fontSize))
  if (fs < 16) throw new Error(`amount field ${fs}px`)
  await tap('[data-a="dvAmt"][data-x="g-amt:custom"]'); await wait(1100)
  const a1 = await goal('g-amt'); if (a1.current !== 49500 || !(a1.entries || []).some((e) => e.note === 'from the bonus')) throw new Error(`custom ${JSON.stringify(a1.entries)}`)
  await tap('[data-a="dvAmtUndo"][data-x="g-amt"]'); await wait(1100)
  if ((await goal('g-amt')).current !== 47000) throw new Error(`undo left ${(await goal('g-amt')).current}`)
  if (!(await page.locator('.dvg', { hasText: '47' }).count())) throw new Error('amount progress line missing')
  /* counter */
  await tap('[data-a="dvStep"][data-x="g-cnt:1"]'); await wait(1100)
  if ((await goal('g-cnt')).current !== 4) throw new Error('counter + did not reach the store')
  await tap('[data-a="dvStep"][data-x="g-cnt:-1"]'); await wait(1100)
  if ((await goal('g-cnt')).current !== 3) throw new Error('counter - did not reach the store')
  /* habit-linked: read only */
  const hab = await page.locator('.dvg', { hasText: 'Bed before 1 AM' }).textContent()
  if (!/fills from/i.test(hab)) throw new Error('habit goal is not read only')
  if (await page.locator('.dvg', { hasText: 'Bed before 1 AM' }).locator('button,input').count()) throw new Error('habit goal has controls')
  await page.screenshot({ path: `${SHOTS}/light-daily-goals-done.png` })
})

await step('daily review: Quitting buttons fit and write the slip; Start the day closes it', async () => {
  await stepDaily(1)
  const fits = await page.evaluate(() => { const R = document.querySelector('.nshell').shadowRoot, f = R.querySelector('.dvstack').getBoundingClientRect(); return [...R.querySelectorAll('.dv-card[data-k="4"] .dvacts .key')].every((b) => { const r = b.getBoundingClientRect(); return r.left >= f.left && r.right <= f.right && r.bottom <= f.bottom }) })
  if (!fits) throw new Error('Quitting buttons stick out')
  await tap('[data-a="dvQuit"][data-x="0:slip"]'); await wait(1100)
  const y = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })
  if (!(await blob()).slips.some((x) => x.habitId === 'h-quit-seed' && x.day === y)) throw new Error('slip not written')
  await stepDaily(1)
  await tap('section.view.on [data-a="dvDone"]'); await wait(700)
  if (await page.locator('section.view.on[data-view="daily"]').count()) throw new Error('review still open')
  await tap('#dock [data-x="home"]'); await wait(300); await goHome(1)
})

/* ---- Calendar: a month grid, then the day ---- */
const calSnap = (days = []) => page.evaluate((days) => {
  const R = document.querySelector('.nshell').shadowRoot, v = R.querySelector('section.view.on'), cur = v.querySelector('.calm.cur'), cells = [...cur.querySelectorAll('.cday')]
  const first = cells.find((c) => !c.classList.contains('out')), r = first.getBoundingClientRect(), today = cur.querySelector('.cday.today')
  const ind = {}; for (const iso of days) { const c = cur.querySelector(`.cday[data-iso="${iso}"]`); ind[iso] = c ? { dots: c.querySelectorAll('.cind i').length, plus: !!c.querySelector('.cind u'), bar: !!c.querySelector('.cbar') } : null }
  return {
    month: v.querySelector('#calmonth').textContent.trim(), cells: cells.length, weekdays: cur.querySelectorAll('.cwd').length, weeks: cur.querySelectorAll('.cwk').length,
    radius: parseFloat(getComputedStyle(first).borderTopLeftRadius), side: r.width, today: today ? { bg: getComputedStyle(today).backgroundColor, fg: getComputedStyle(today.querySelector('.cn')).color } : null,
    accent: getComputedStyle(R.querySelector('#app')).getPropertyValue('--red').trim(), rows: [...v.querySelectorAll('#calrows .row')].map((x) => ({ t: x.querySelector('.rt').textContent, now: !!x.querySelector('.nowtag'), past: x.classList.contains('past'), allDay: /all day/i.test(x.querySelector('.ctm').textContent), write: !!x.querySelector('[data-a="writeUp"]') })),
    empty: !!v.querySelector('#calrows .empty'), chip: !!v.querySelector('.vtop .ctxchip'), note: v.querySelector('.calnote').textContent.trim(), ind,
    sel: (cur.querySelector('.cday.on') || {}).dataset ? cur.querySelector('.cday.on').dataset.iso : null, title: v.querySelector('.vtt').getBoundingClientRect(), vw: innerWidth,
  }}, days)
let calSeed = null
const calDays = () => page.evaluate(() => { const d = new Date(), dom = d.getDate(), y = (n) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`; return { today: y(dom), allDay: y(dom > 1 ? dom - 1 : dom + 1), busy: y(dom > 3 ? dom - 3 : dom + 3), quiet: y(dom > 15 ? 5 : 20) } })
await step('calendar: a month grid with today in the accent, event dots, and the selected day under it', async () => {
  await click('#dock [data-x="apps"]'); await wait(400)
  await click('[data-a="drawerOpen"][data-x="calendar"]'); await viewReady('calendar'); await wait(450)
  const d = await calDays(), sn = await calSnap([d.today, d.allDay, d.busy, d.quiet]), rgb = (h) => 'rgb(' + [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ') + ')'
  if (sn.cells !== 42 || sn.weekdays !== 7 || sn.weeks !== 6) throw new Error(`grid ${sn.cells} cells, ${sn.weekdays} weekdays, ${sn.weeks} week numbers`)
  if (!(sn.radius > 6 && sn.radius < sn.side / 2 - 6)) throw new Error(`cell radius ${sn.radius} on a ${sn.side}px cell`)
  if (!sn.today || sn.today.bg !== rgb(sn.accent) || sn.today.fg !== 'rgb(255, 255, 255)') throw new Error(`today cell ${JSON.stringify(sn.today)} vs accent ${sn.accent}`)
  if (sn.ind[d.today].dots !== 2) throw new Error(`today dots ${JSON.stringify(sn.ind[d.today])}`)
  if (!sn.ind[d.allDay].bar) throw new Error('no bar for the all-day event')
  const busy = sn.ind[d.busy]; if (busy.dots !== 3 || !busy.plus) throw new Error(`four events should be three dots and a plus: ${JSON.stringify(busy)}`)
  if (sn.ind[d.quiet].dots !== 0) throw new Error('a quiet day has dots')
  if (Math.abs(sn.title.left + sn.title.width / 2 - sn.vw / 2) > 1) throw new Error('title off centre')
  if (sn.chip) throw new Error('the Today chip shows while on today')
  if (!/feed covers/i.test(sn.note)) throw new Error(`note: ${sn.note}`)
  if (sn.rows.length !== 2 || !sn.rows.every((r) => r.write)) throw new Error(`today rows ${JSON.stringify(sn.rows)}`)
  if (!sn.rows.some((r) => r.now)) throw new Error('no NOW tag on the live event')
  await wait(500); await page.screenshot({ path: `${SHOTS}/light-calendar.png` })
  /* tapping days swaps the agenda in place */
  await click(`.calm.cur .cday[data-iso="${d.allDay}"]`); await wait(300)
  let a = await calSnap(); if (a.rows.length !== 1 || !a.rows[0].allDay || a.sel !== d.allDay) throw new Error(`all-day agenda ${JSON.stringify(a.rows)}`)
  if (!a.chip) throw new Error('no Today chip off today')
  await click(`.calm.cur .cday[data-iso="${d.busy}"]`); await wait(300)
  a = await calSnap(); if (a.rows.length !== 4) throw new Error(`busy day shows ${a.rows.length} rows`)
  if (!a.rows.every((r) => r.past || d.busy > d.today)) throw new Error('past rows are not dimmed')
  await click(`.calm.cur .cday[data-iso="${d.quiet}"]`); await wait(300)
  a = await calSnap(); if (!a.empty) throw new Error('an empty day has no empty state')
  await page.screenshot({ path: `${SHOTS}/light-calendar-empty-day.png` })
  await click('section.view.on [data-a="calToday"]'); await wait(400)
  a = await calSnap(); if (a.chip || a.sel !== d.today || a.rows.length !== 2) throw new Error('the Today chip did not bring today back')
})

await step('calendar: swipe and arrows change the month, ends are held, Today returns', async () => {
  const label = async () => (await calSnap()).month
  const start = await label()
  const info = await page.evaluate(() => ({ next: !document.querySelector('.nshell').shadowRoot.querySelector('section.view.on [data-a="calNext"]').disabled, prev: !document.querySelector('.nshell').shadowRoot.querySelector('section.view.on [data-a="calPrev"]').disabled }))
  if (info.prev) throw new Error('can go before the feed')
  await drag('.calvp', 260); await wait(300)
  if ((await label()) !== start) throw new Error('swiped back past the start of the feed')
  await drag('.calvp', -260); await wait(500)
  const after = await label()
  if (info.next) {
    if (after === start) throw new Error('swipe did not change the month')
    await page.screenshot({ path: `${SHOTS}/light-calendar-next.png` })
    if (!(await calSnap()).chip) throw new Error('no Today chip in another month')
    await click('section.view.on [data-a="calToday"]'); await wait(600)
    if ((await label()) !== start || (await calSnap()).chip) throw new Error('Today did not bring the month back')
    await click('section.view.on [data-a="calNext"]'); await wait(500)
    if ((await label()) !== after) throw new Error('the arrow did not move the month')
    await click('section.view.on [data-a="calPrev"]'); await wait(500)
    if ((await label()) !== start) throw new Error('the back arrow did not return')
    await click('section.view.on [data-a="calNext"]'); await click('section.view.on [data-a="calNext"]'); await wait(600)
    if ((await label()) !== after) throw new Error('arrows are not held at the end of the feed')
    await click('section.view.on [data-a="calToday"]'); await wait(600)
  } else if (after !== start) throw new Error('the month moved though the feed ends this month')
})

await step('calendar: not connected still shows the empty month with today marked, and says so', async () => {
  calSeed = await page.evaluate(() => { const v = localStorage.getItem('mc-shell-test-calendar'); localStorage.removeItem('mc-shell-test-calendar'); return v }); await page.reload(); await wait(2200)
  await click('#dock [data-x="apps"]'); await wait(400); await click('[data-a="drawerOpen"][data-x="calendar"]'); await viewReady('calendar'); await wait(450)
  const sn = await calSnap()
  if (sn.cells !== 42 || !sn.today || !/not connected/i.test(sn.note) || !sn.empty) throw new Error(`${sn.cells} cells, today ${!!sn.today}, note "${sn.note}"`)
  await page.screenshot({ path: `${SHOTS}/light-calendar-off.png` })
})

const shellUp = () => page.evaluate(() => { const h = document.querySelector('.nshell'); return !!h && h.style.display !== 'none' })
await step('Bills: every door goes straight to the real Bills page', async () => {
  if (calSeed) await page.evaluate((v) => localStorage.setItem('mc-shell-test-calendar', v), calSeed)
  await page.reload(); await wait(2200)
  await click('#dock [data-x="apps"]'); await wait(400)
  await click('[data-a="drawerOpen"][data-x="bills"]'); await wait(1200)
  if (await shellUp()) throw new Error('the Apps tile stayed in the shell')
  if (!/bills/.test(await page.evaluate(() => location.hash))) throw new Error(`hash ${await page.evaluate(() => location.hash)}`)
  await page.evaluate(() => { location.hash = '#/today' }); await wait(1800)
  if (!(await shellUp())) throw new Error('the shell did not come back')
  await click('#dock [data-x="home"]'); await wait(500)
  await goHome(0)
  const t = await page.locator('#home .hp:nth-child(1) [data-type="bills"]').count() ? '#home .hp:nth-child(1) [data-type="bills"]' : null
  if (t) { await click(t); await wait(1200); if (await shellUp()) throw new Error('the Bills widget stayed in the shell'); await page.evaluate(() => { location.hash = '#/today' }); await wait(1800) }
  await click('#dock [data-x="home"]'); await wait(500)
  if (!(await page.evaluate(() => !document.querySelector('.nshell').shadowRoot.querySelector('section[data-view="bills"]')))) throw new Error('a shell Bills view still exists')
  await goHome(1)
})

/* ---- Gym: the same numbers as the classic page, editable targets, a Hevy sync that moves them ---- */
const gymReadShell = () => page.evaluate(() => { const R = document.querySelector('.nshell').shadowRoot; return Object.fromEntries([...R.querySelectorAll('section.view.on .gtgt')].map((c) => [c.querySelector('.rt').textContent.trim(), c.querySelector('.dm') ? c.querySelector('.dm').getAttribute('aria-label') : null])) })
const openGym = async () => { await click('#dock [data-x="apps"]'); await wait(400); await click('[data-a="drawerOpen"][data-x="jar"]'); await viewReady('jar'); await wait(450); await click('section.view.on [data-a="jarGo"][data-x="gym"]'); await viewReady('gym'); await wait(500) }
await step('gym: every target is worked out from the Hevy data, the same as the classic Gym page', async () => {
  await openGym()
  const shell = await gymReadShell()
  const want = { 'Bench e1RM': '78.4', 'Pull-up day total': '21', 'Sessions logged': '2', 'Bodyweight': '96' }
  for (const [k, v] of Object.entries(want)) if (shell[k] !== v) throw new Error(`${k}: shell says ${shell[k]}, expected ${v} (${JSON.stringify(shell)})`)
  const rows = await page.locator('section.view.on .row .rs').allTextContents()
  if (rows.length !== 2 || !rows.every((r) => /1 PR/.test(r))) throw new Error(`sessions ${JSON.stringify(rows)}`)
  const wk = await page.locator('section.view.on .cd.k .dm').first().getAttribute('aria-label'); if (wk !== '0/4') throw new Error(`week ${wk}`)
  await page.screenshot({ path: `${SHOTS}/light-gym.png` })
  /* the classic page, same seed: a desktop window shows Classic, a phone redirects into the shell */
  await page.setViewportSize({ width: 1280, height: 860 }); await page.evaluate(() => { location.hash = '#/gym' }); await page.reload(); await wait(2600)
  const classic = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.gp-goal')].map((g) => [g.querySelector('.gp-goal-name').textContent.trim(), g.querySelector('.gp-goal-current').textContent.trim()])))
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => { location.hash = '#/today' }); await page.reload(); await wait(2600)
  for (const [k, v] of Object.entries(shell)) if (classic[k] !== v) throw new Error(`${k}: shell ${v} vs classic ${classic[k]}`)
  await goHome(1)
})

await step('gym: tap a target to edit it in a sheet, add one, delete and undo, all through the store', async () => {
  const gg = async (id) => ((await blob()).gymGoals || []).find((g) => g.id === id)
  await openGym()
  await click('section.view.on .gtgt[data-x="gg-bench"]'); await page.waitForSelector('.sheet.on'); await wait(500)
  await page.screenshot({ path: `${SHOTS}/light-gym-sheet.png` })
  const fs = await page.locator('.sheet.on input').evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)))
  if (fs.some((f) => f < 16)) throw new Error(`sheet inputs ${fs}`)
  await page.locator('.sheet.on [data-gf="goal"]').fill('120'); await wait(1000)
  if ((await gg('gg-bench')).goal !== 120) throw new Error('goal not saved')
  await page.locator('.sheet.on [data-gf="name"]').fill('Bench, new name'); await tap('.sheet.on [data-a="sheetX"]'); await wait(900)
  if ((await gg('gg-bench')).name !== 'Bench, new name') throw new Error('name not saved on close')
  if (!/Bench, new name/.test(Object.keys(await gymReadShell()).join())) throw new Error('the page did not re-read at once')
  /* manual target: current by hand */
  await click('section.view.on .gtgt[data-x="gg-bw"]'); await page.waitForSelector('.sheet.on'); await wait(500)
  await page.locator('.sheet.on [data-gf="cur"]').fill('94'); await wait(1000)
  if ((await gg('gg-bw')).current !== 94) throw new Error('manual current not saved')
  await tap('.sheet.on [data-a="sheetX"]'); await wait(500)
  if ((await gymReadShell())['Bodyweight'] !== '94') throw new Error('the manual number did not move on the page')
  /* a new target on an exercise picked from the history */
  await click('section.view.on [data-a="gymNew"]'); await page.waitForSelector('.sheet.on'); await wait(500)
  await page.locator('.sheet.on [data-gf="name"]').fill('Pull-up best'); await page.locator('.sheet.on [data-gf="goal"]').fill('30'); await page.locator('.sheet.on [data-gf="unit"]').fill('reps')
  await tap('.sheet.on [data-a="gtMetric"][data-x="repTotal"]'); await tap('.sheet.on [data-a="gtEx"][data-x="Pull Up"]'); await tap('.sheet.on [data-a="sheetX"]'); await wait(1000)
  const made = ((await blob()).gymGoals || []).find((g) => g.name === 'Pull-up best')
  if (!made || made.metric !== 'repTotal' || made.exerciseName !== 'Pull Up' || made.goal !== 30) throw new Error(`new target ${JSON.stringify(made)}`)
  if ((await gymReadShell())['Pull-up best'] !== '21') throw new Error('the new target has no computed number')
  /* delete and undo */
  await click('section.view.on .gtgt[data-x="gg-sess"]'); await page.waitForSelector('.sheet.on'); await wait(500)
  await tap('.sheet.on [data-a="gtDel"]'); await wait(1000)
  if (await gg('gg-sess')) throw new Error('not deleted')
  await tap('#toast [data-a="undo"]'); await wait(1000)
  if (!(await gg('gg-sess'))) throw new Error('undo did not bring it back')
})

await step('gym: syncing Hevy brings the new sessions into the numbers', async () => {
  const today = await page.evaluate(() => new Date().toISOString())
  await page.route('https://api.hevyapp.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ page_count: 1, workouts: [{ start_time: today, end_time: new Date(Date.now() + 3600e3).toISOString(), exercises: [{ title: 'Bench Press (Barbell)', sets: [{ weight_kg: 100, reps: 3 }] }] }] }) }))
  if ((await gymReadShell())['Bench, new name'] !== '78.4') throw new Error('not starting from the seeded number')
  await click('section.view.on [data-a="hevySync"]'); await page.waitForFunction(() => { const R = document.querySelector('.nshell').shadowRoot; return [...R.querySelectorAll('section.view.on .gtgt')].some((c) => c.querySelector('.dm') && c.querySelector('.dm').getAttribute('aria-label') === '110.0') }, null, { timeout: 8000 })
  const rows = await page.locator('section.view.on .row .rs').allTextContents()
  if (rows.length !== 1) throw new Error(`${rows.length} sessions after the sync`)
  await page.screenshot({ path: `${SHOTS}/light-gym-synced.png` })
  await page.unroute('https://api.hevyapp.com/**')
  await click('section.view.on [data-a="back"]'); await wait(450)
  await goHome(1)
})

/* ---- Back is the browser's back: the stack follows history, so the iOS swipe lands where it came from ---- */
const topViews = () => page.evaluate(() => [...document.querySelector('.nshell').shadowRoot.querySelectorAll('section.view.on')].map((v) => v.dataset.view).join())
const sheetOpen = () => page.evaluate(() => !!document.querySelector('.nshell').shadowRoot.querySelector('.sheet.on'))
const toApps = async () => { await click('#dock [data-x="apps"]'); await wait(400) }
await step('swipe back: a view opened from Apps goes back to Apps, forward does nothing', async () => {
  await toApps()
  await click('[data-a="drawerOpen"][data-x="notes"]'); await viewReady('notes'); await wait(450)
  await page.goBack(); await wait(750)
  if ((await topViews()) !== 'apps') throw new Error(`back from Notes landed on ${await topViews()}`)
  await page.goForward(); await wait(750)
  if ((await topViews()) !== 'apps') throw new Error(`forward moved the app to ${await topViews()}`)
  await click('[data-a="drawerOpen"][data-x="notes"]'); await viewReady('notes'); await wait(450)
  await page.goBack(); await wait(750)
  if ((await topViews()) !== 'apps') throw new Error('back after a forward did not return to Apps')
})

await step('swipe back: a sheet closes first, then the page behind it, and nested views unwind one by one', async () => {
  await click('[data-a="drawerOpen"][data-x="ideas"]'); await viewReady('ideas'); await wait(900)
  await click('section.view.on .idea[data-x="idea-seed"]'); await page.waitForSelector('.sheet.on'); await wait(500)
  await page.goBack(); await wait(700)
  if (await sheetOpen()) throw new Error('the sheet is still open after back')
  if ((await topViews()) !== 'ideas') throw new Error(`the page behind closed too: ${await topViews()}`)
  await page.goBack(); await wait(750)
  if ((await topViews()) !== 'apps') throw new Error(`second back landed on ${await topViews()}`)
  /* two views deep */
  await click('[data-a="drawerOpen"][data-x="notes"]'); await viewReady('notes'); await wait(450)
  await click('section.view.on [data-a="newNote"]'); await viewReady('note'); await wait(450)
  await page.goBack(); await wait(750)
  if ((await topViews()) !== 'notes') throw new Error(`back from a note landed on ${await topViews()}`)
  await page.goBack(); await wait(750)
  if ((await topViews()) !== 'apps') throw new Error(`back from Notes landed on ${await topViews()}`)
})

await step('swipe back: a view opened from a widget returns to Home with the tile', async () => {
  await click('#dock [data-x="home"]'); await wait(400)
  await page.evaluate(() => document.querySelector('.nshell').shadowRoot.querySelector('#home .hp:nth-child(1) [data-a="wtap"][data-wid]').click()); await wait(900)
  if ((await topViews()) === 'home') throw new Error('the tile did not open a view')
  await page.goBack()
  const morph = await page.evaluate(async () => {
    const sr = document.querySelector('.nshell').shadowRoot
    for (let i = 0; i < 20; i++) {
      if (sr.getAnimations().some((a) => a.effect && a.effect.getKeyframes().some((k) => k.clipPath))) return true
      await new Promise((r) => setTimeout(r, 25))
    }
    return false
  })
  await wait(650)
  if ((await topViews()) !== 'home') throw new Error(`back landed on ${await topViews()}`)
  if (!morph) throw new Error('no morph animation on the way back')
  if (await page.evaluate(() => !!document.querySelector('.nshell').shadowRoot.querySelector('#home .w.hidden'))) throw new Error('the tile stayed hidden')
})

await step('swipe back: 30 open and close cycles do not grow the history', async () => {
  await toApps()
  const before = await page.evaluate(() => history.length)
  for (let i = 0; i < 30; i++) {
    await click('#dock [data-a="quickAdd"]'); await wait(160); await click('.sheet.on [data-a="sheetX"]'); await wait(160)
    await click('[data-a="drawerOpen"][data-x="weather"]'); await wait(450)
    if (i % 2) await page.goBack(); else await click('section.view.on [data-a="back"]')
    await wait(420)
  }
  await wait(500)
  const after = await page.evaluate(() => history.length)
  if (after > before + 2) throw new Error(`history grew from ${before} to ${after}`)
  if ((await topViews()) !== 'apps') throw new Error(`ended on ${await topViews()}`)
  await click('#dock [data-x="home"]'); await wait(300); await goHome(1)
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
  const ctx = await page.locator('section.view.on .ctxchip').textContent()
  if (!/Big Time/.test(ctx) || !/All projects/.test(ctx)) throw new Error(`context line: ${ctx}`)
  await tap('section.view.on [data-a="planSeg"][data-x="todo"]')
  const ph = await page.locator('#newtask').getAttribute('placeholder')
  if (!/Big Time, Unsorted/.test(ph)) throw new Error(`placeholder: ${ph}`)
  await page.screenshot({ path: `${SHOTS}/light-plan-bigtime.png` })
  await tap('section.view.on [data-a="planSeg"][data-x="day"]')
  await tap('#dock [data-x="home"]')
  await drag('#home .hp:nth-child(3) .grid', 260)
})

/* iOS zooms into any form control under 16px, and zooms the page out when anything is wider than it.
   One pass: each view is opened once with a synthetic click inside the shell (no actionability waits), audited at 390, resized to 375 while
   it is still open and audited again. The only fixed waits left are the slide/morph animation's own 430 ms. */
const small = () => page.evaluate(() => [...document.querySelector('.nshell').shadowRoot.querySelectorAll('input,textarea,select')].filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.id || e.className))
const overflow = () => page.evaluate(() => {
  const r = document.querySelector('.nshell').shadowRoot, bad = []
  if (document.documentElement.scrollWidth > innerWidth) bad.push('document')
  for (const el of r.querySelectorAll('#app, section.view.on .vsc, .sheet.on .sh-b, #home .hp .hsc')) if (el.scrollWidth > el.clientWidth + 1) bad.push(el.className || el.id)
  return bad
})
await step('every form control is 16px or more, nothing is wider than the screen (375 and 390), on every view', async () => {
  const bad = []
  const audit = async (tag) => {
    for (const w of [390, 375]) {
      if (w === 375) { await page.setViewportSize({ width: 375, height: 844 }); await raf2() }
      bad.push(...(await overflow()).map((x) => `${w} ${tag} ${x}`), ...(await small()).map((x) => `${w} ${tag} input ${x}`))
    }
    await page.setViewportSize({ width: 390, height: 844 }); await raf2()
  }
  await audit('home')
  for (const id of ['plan', 'habits', 'apps']) { await click(`#dock [data-x="${id}"]`); await wait(300); await audit(id) }
  /* from Plan: its own two doors */
  await click('#dock [data-x="plan"]'); await wait(300)
  for (const id of ['projects', 'search']) { await click(`section.view.on [data-a="open"][data-x="${id}"]`); await viewReady(id); await wait(430); await audit(id); await click('section.view.on [data-a="back"]'); await wait(400) }
  await click('#dock [data-x="apps"]'); await wait(300)
  const drawer = ['calendar', 'notes', 'ideas', 'people', 'jar', 'zone', 'focus', 'jarvis', 'weather', 'settings']
  for (const id of drawer) {
    await click(`[data-a="drawerOpen"][data-x="${id}"]`); await viewReady(id); await wait(430); await audit(id)
    if (id === 'jar') for (const j of ['health', 'gym', 'why']) { await click(`section.view.on [data-a="jarGo"][data-x="${j}"]`); await viewReady(j); await raf2(); await audit(j) }
    await click('section.view.on [data-a="back"]'); await wait(400)
  }
  await click('#dock [data-a="quickAdd"]'); await page.waitForSelector('.sheet.on'); await wait(450); await audit('quickadd'); await click('.sheet.on [data-a="sheetX"]'); await wait(450)
  await click('#dock [data-x="home"]'); await wait(300)
  await click('#home .hp:nth-child(2) [data-type="clock"]'); await viewReady('today'); await wait(430); await audit('today'); await click('section.view.on [data-a="back"]'); await wait(450)
  await page.setViewportSize({ width: 390, height: 844 }); await raf2()
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
  await page.locator('.sw[data-id="ns-2"]').evaluate((e) => e.scrollIntoView({ block: 'center' })); await wait(300)
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
  /* every tap shows at once, and the current project and all three spaces stay in their rows */
  const on = () => page.locator('.sheet.on .chip.on').allTextContents().then((a) => a.map((x) => x.trim().toLowerCase()))
  await tap('.sheet.on [data-a="taskSlot"][data-x="ns-2:morning"]'); await wait(900)
  let chips = await on(); if (!chips.includes('morning') || !chips.includes('today')) throw new Error(`slot/day not lit at once: ${chips}`)
  const spaces = (await page.locator('.sheet.on [data-a="taskSpace"]').allTextContents()).map((x) => x.trim())
  if (spaces.length !== 3) throw new Error(`spaces ${spaces}`)
  const projBtn = page.locator('.sheet.on [data-a="taskProj"]:not([data-x$=":"])').first()
  if (await projBtn.count()) {
    const label = (await projBtn.textContent()).trim().toLowerCase(); await projBtn.evaluate((e) => e.click()); await wait(900)
    chips = await on(); if (!chips.includes(label)) throw new Error(`project ${label} not lit, row: ${chips}`)
    if (chips.includes('unsorted')) throw new Error('Unsorted still lit')
  }
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
  await tap('#toast [data-a="seeTask"]'); await wait(900)
  if (!(await page.locator('section.view.on[data-view="plan"]').count())) throw new Error('See it did not open Plan')
  const pill = await page.locator('section.view.on .dpill').evaluateAll((ps) => ps.findIndex((p) => p.classList.contains('on')))
  if (pill !== 1) throw new Error(`day pill ${pill} selected, want tomorrow`)
  const row = page.locator(`section.view.on .sw[data-id="${t2.id}"]`)
  if (!(await row.count())) throw new Error('the task row is not on screen (slot shut or wrong filter)')
  const vis = await row.evaluate((r) => { const b = r.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight })
  if (!vis || !(await row.evaluate((r) => r.classList.contains('flash')))) throw new Error(`row visible ${vis}, flashed ${await row.evaluate((r) => r.classList.contains('flash'))}`)
  await page.screenshot({ path: `${SHOTS}/light-seeit.png` })
  const pc = await page.locator('section.view.on .dpill.on').evaluate((e) => getComputedStyle(e).backgroundColor)
  const ac = await page.locator('#app').evaluate((e) => getComputedStyle(e).getPropertyValue('--red').trim())
  const hex = (c) => '#' + c.match(/\d+/g).slice(0, 3).map((n) => (+n).toString(16).padStart(2, '0')).join('').toUpperCase()
  if (hex(pc) !== ac.toUpperCase()) throw new Error(`selected day pill ${hex(pc)}, accent ${ac}`)
  await tap('section.view.on [data-a="ctxPick"]'); await tap('.sheet.on [data-a="ctxProj"][data-x=""]'); await wait(300)
  await tap('#dock [data-x="home"]')
  await tap('#dock [data-a="quickAdd"]')
  await page.locator('#qat').fill('Shell no date task')
  await tap('.sheet.on [data-a="qaDay"][data-x="none"]')
  await tap('.sheet.on [data-a="qaGo"]'); await wait(1300)
  const t3 = (await blob()).tasks.find((x) => x.title === 'Shell no date task')
  if (t3?.list !== 'backlog') throw new Error(`no date should go to the list, got ${t3?.list}`)
})

await step('Habits: a picker in the header switches Habits, Goals and Quitting, in sync with the segmented control', async () => {
  await tap('#dock [data-x="habits"]'); await wait(500)
  const read = () => page.evaluate(() => { const R = document.querySelector('.nshell').shadowRoot, v = R.querySelector('section.view.on'), t = v.querySelector('.vtt').getBoundingClientRect(), c = v.querySelector('.vtop .ctxchip').getBoundingClientRect(); return { chip: v.querySelector('.vtop .ctxchip').textContent.trim(), title: v.querySelector('.vtt').textContent.trim(), seg: v.querySelector('.seg button.on').textContent.trim(), mid: t.left + t.width / 2, vw: innerWidth, chipRight: c.right, titleLeft: t.left } })
  for (const [id, label] of [['goals', 'Goals'], ['quit', 'Quitting'], ['habits', 'Habits']]) {
    await tap('section.view.on .vtop .ctxchip'); await wait(450)
    if (id === 'goals') await page.screenshot({ path: `${SHOTS}/light-habits-picker.png` })
    await tap(`.sheet.on [data-a="hPicked"][data-x="${id}"]`); await wait(500)
    const r = await read()
    if (![r.chip, r.title, r.seg].every((x) => x.toLowerCase().startsWith(label.toLowerCase()))) throw new Error(`${label}: ${JSON.stringify(r)}`)
    if (Math.abs(r.mid - r.vw / 2) > 1 || r.chipRight > r.titleLeft) throw new Error(`header geometry ${JSON.stringify(r)}`)
  }
  await tap('section.view.on .seg button[data-x="goals"]'); await wait(400)
  if (!/^goals/i.test((await read()).chip)) throw new Error('the segmented control did not move the chip')
  /* + follows the section */
  await tap('section.view.on [data-a="addHabitMenu"]'); await wait(500)
  await page.locator('.sheet.on #gnm').fill('Chip goal'); await page.locator('.sheet.on #gtg').fill('5'); await page.locator('.sheet.on #gun').fill('books')
  await tap('.sheet.on [data-a="goalSave"]'); await wait(1100)
  if (!(await blob()).goals.some((g) => g.name === 'Chip goal' && g.target === 5 && g.unit === 'books')) throw new Error('goal not saved')
  await tap('section.view.on .seg button[data-x="quit"]'); await wait(400)
  await tap('section.view.on [data-a="addHabitMenu"]'); await wait(500)
  if (!/^quit/i.test(await page.locator('.sheet.on .seg button.on').first().textContent())) throw new Error('+ on Quitting did not open a quit sheet')
  await tap('.sheet.on [data-a="sheetX"]'); await wait(400)
  await tap('section.view.on .seg button[data-x="habits"]'); await wait(400)
})

await step('Habits: tick a habit, the real habitLog changes', async () => {
  await tap('#dock [data-x="habits"]'); await wait(500)
  await page.screenshot({ path: `${SHOTS}/light-habits.png` })
  const id = await page.locator('[data-a="habitTick"]:not([data-x="h-gym-seed"])').first().getAttribute('data-x')
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

await step('Apps drawer keeps its 14 tiles in a tidy grid; Jar carries Health, Gym, Longevity and The wall; Settings has Embedded apps', async () => {
  await click('#dock [data-x="apps"]'); await wait(500)
  const want = ['calendar', 'notes', 'ideas', 'people', 'bills', 'mymind', 'jar', 'zone', 'focus', 'jarvis', 'skills', 'watchless', 'weather', 'settings']
  const tiles = await page.locator('section.view.on .dapp').evaluateAll((ts) => ts.map((t) => t.dataset.x))
  if (tiles.join() !== want.join()) throw new Error(`tiles ${tiles.join()}`)
  if (await page.locator('section.view.on [data-a="openClassic"]').count()) throw new Error('a wide bar is still under the drawer')
  const g = await page.locator('section.view.on .drawer').evaluate((d) => ({ cols: getComputedStyle(d).gridTemplateColumns.split(' ').length, pos: [...d.children].map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)] }) }))
  const rows = new Set(g.pos.map((p) => p[1])).size
  if (g.cols !== 3 || rows !== 5 || g.pos.slice(0, 12).some((p, i) => p[0] !== g.pos[i % 3][0])) throw new Error(`grid ${JSON.stringify(g)}`)
  await page.screenshot({ path: `${SHOTS}/light-apps-14.png` })
  await click('[data-a="drawerOpen"][data-x="jar"]'); await viewReady('jar'); await wait(450)
  const links = await page.locator('section.view.on .jarlinks .chip').allTextContents()
  if (links.join().toLowerCase() !== 'health,gym,longevity,the wall') throw new Error(`jar links ${links.join()}`)
  await page.screenshot({ path: `${SHOTS}/light-jar-links.png` })
  await click('section.view.on [data-a="jarGo"][data-x="health"]'); await wait(500)
  if (!(await page.locator('section.view.on[data-view="health"]').count())) throw new Error('Health link did not open Health')
  await click('section.view.on [data-a="back"]'); await wait(450)
  await click('[data-a="drawerOpen"][data-x="settings"]'); await viewReady('settings'); await wait(450)
  if (!(await page.locator('section.view.on [data-a="openClassic"][data-x="apps"]').count())) throw new Error('Settings has no Embedded apps row')
  await click('section.view.on [data-a="back"]'); await wait(450)
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
  await page.locator('section.view.on .vsc').evaluate((e) => { e.scrollTop = 600 }); await wait(300); await page.screenshot({ path: `${SHOTS}/dark-habits-scrolled.png` })
  await tap('#dock [data-x="habits"]'); await tap('section.view.on .vtop .ctxchip'); await wait(450); await page.screenshot({ path: `${SHOTS}/dark-habits-picker.png` }); await tap('.sheet.on [data-a="sheetX"]'); await wait(400)
  await tap('#dock [data-x="apps"]'); await page.screenshot({ path: `${SHOTS}/dark-apps.png` })
  await click('[data-a="drawerOpen"][data-x="calendar"]'); await viewReady('calendar'); await wait(600); await page.screenshot({ path: `${SHOTS}/dark-calendar.png` }); await click('section.view.on [data-a="back"]'); await wait(450)
  await tap('[data-a="drawerOpen"][data-x="jarvis"]'); await wait(900)
  await page.screenshot({ path: `${SHOTS}/dark-jarvis.png` })
  await tap('section.view.on [data-a="back"]'); await wait(500)
  await tap('[data-a="drawerOpen"][data-x="ideas"]'); await wait(900)
  await tap('section.view.on .idea[data-x="idea-seed"]'); await wait(700)
  await page.screenshot({ path: `${SHOTS}/dark-idea-sheet.png` })
  await tap('.sheet.on [data-a="sheetX"]'); await wait(400)
  await tap('section.view.on [data-a="back"]'); await wait(500)
  await tap('#dock [data-x="plan"]'); await tap('section.view.on [data-a="openDaily"]'); await wait(900)
  for (let k = 0; k < 6; k++) { await page.screenshot({ path: `${SHOTS}/dark-daily-${k}.png` }); if (k < 5) await stepDaily(1) }
  await tap('section.view.on [data-a="dvClose"]'); await wait(600)
})

await step('a classic page the shell has its own version of (People) opens the shell view, history does not pile up', async () => {
  const h0 = await page.evaluate(() => history.length)
  await page.evaluate(() => { location.hash = '#/people' }); await wait(1500)
  if (!(await page.locator('section.view.on[data-view="people"]').count())) throw new Error('People did not open in the shell')
  if (await page.evaluate(() => document.querySelector('.nshell').style.display === 'none')) throw new Error('the shell is hidden')
  if ((await page.evaluate(() => history.length)) > h0 + 2) throw new Error('history grew by the redirect')
  if ((await page.evaluate(() => location.hash)) !== '#/today') throw new Error('hash is not #/today')
  await tap('section.view.on [data-a="back"]'); await wait(500)
})

await step('Jar: a Videos button under the links opens the reels page, back returns to Jar', async () => {
  await tap('#dock [data-x="apps"]'); await tap('[data-a="drawerOpen"][data-x="jar"]'); await wait(700)
  if (!(await page.locator('section.view.on[data-view="jar"] [data-a="jarVideos"]').count())) throw new Error('no Videos button on Jar')
  await tap('section.view.on [data-a="jarVideos"]'); await wait(1500)
  if ((await page.evaluate(() => location.hash)) !== '#/timeline') throw new Error('Videos did not open the reels page')
  await page.goBack(); await wait(1500)
  if (!(await page.locator('section.view.on[data-view="jar"]').count())) throw new Error('back from the reels did not return to Jar')
  await tap('section.view.on [data-a="back"]'); await wait(500)
})

await step('Settings > Look offers only Light and Dark, no Classic and no Night', async () => {
  await tap('#dock [data-x="apps"]'); await tap('[data-a="drawerOpen"][data-x="settings"]')
  const looks = await page.locator('[data-a="skinPick"]').evaluateAll((els) => els.map((e) => e.dataset.x))
  if (looks.join() !== 'nothing-light,nothing-dark') throw new Error(`looks offered: ${looks.join()}`)
  const t = (await blob()).tasks.find((x) => x.id === 'ns-1')
  if (!t?.done) throw new Error('lost the finished task')
})

await step('reload: state persists', async () => {
  await page.reload(); await wait(1500)
  const s = await blob()
  if (!s.tasks.find((x) => x.id === 'ns-1')?.done || !s.tasks.some((x) => x.id === 'ns-2') || !s.tasks.some((x) => x.title === 'Shell quick add task')) throw new Error('state did not survive the reload')
})

await step('no page errors', async () => { if (errors.length) throw new Error(errors.slice(0, 3).join(' | ')) })

if (skipped.size) console.log(`\nSHELL_ONLY skipped ${skipped.size} step${skipped.size === 1 ? '' : 's'}; state they build (seeded data, layout edits, the Jarvis thread, an open review) may be missing for the ones that ran.`)
console.log(`\n${pass} passed, ${fail} failed. Shots in ${SHOTS}`)
await b.close(); server.close()
process.exit(fail ? 1 : 0)
