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
  const longBody = Array.from({ length: 9 }, (_, i) => `Line ${i + 1}: the interior studio wants the site in Czech first, with the three room demos, a price table per item and one question on the last slide.`).join('\n') + '\nLAST LINE MARKER'
  s.ideaBoard = [{ id: 'idea-seed', title: 'Seed idea', body: longBody, color: 'amber', x: 40, y: 40, createdAt: Date.now() - 5 * 864e5, updatedAt: Date.now() - 864e5 }, { id: 'idea-two', title: 'Short idea', body: '', color: 'blue', x: 280, y: 40, createdAt: Date.now() - 864e5, updatedAt: Date.now() - 864e5 }]
  s.prompts = [{ id: 'prompt-seed', project: 'Mission Control', session: 'General', kind: 'Update', text: 'Prompt seed text for the sheet', createdAt: Date.now() - 864e5, updatedAt: Date.now() - 864e5 }]
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
  if (await page.locator('.nshell').count()) throw new Error('Settings did not leave the shell')
  await page.evaluate(() => { location.hash = '#/today' }); await wait(1800)
  if (!(await page.locator('.nshell').count())) throw new Error('the shell did not come back')
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
  await page.locator('section.view.on .vsc').evaluate((e) => { e.scrollTop = 600 }); await wait(300); await page.screenshot({ path: `${SHOTS}/dark-habits-scrolled.png` })
  await tap('#dock [data-x="apps"]'); await page.screenshot({ path: `${SHOTS}/dark-apps.png` })
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
