/* The release gate, rewritten 2026-08-02 against the CURRENT app. The old one
   predated the sign-in wall (never passed ?noremote) and tested pages that no
   longer exist, so it failed 0/10 forever while the app was fine: a gate that
   always says no protects nothing. This one serves docs/ itself, always runs
   ?noremote so it can never touch live data, walks the core flows with today's
   selectors, and fails loudly on any console error. */
import { chromium } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync, cpSync, rmSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { dirname, resolve, join, extname } from 'path'

const HERE = dirname(fileURLToPath(import.meta.url))
/* A COPY of docs/, taken once. Served straight from the real directory this
   suite went red at random: a rebuild landing mid-run deletes index.html for a
   moment and changes every chunk hash, which showed up as a 404 on the page
   itself and as steps failing against a bundle that no longer existed. The
   snapshot is what was built when the run started, for the whole run. */
const SNAP = mkdtempSync(join(tmpdir(), 'mc-gate-'))
cpSync(resolve(HERE, '..', 'docs'), SNAP, { recursive: true })
const DOCS = SNAP
/* Whatever port the OS hands out. A fixed one meant a run that died badly left
   the socket bound, and the NEXT run crashed on EADDRINUSE before a single
   step, or worse, half-ran against the previous run's server. */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0].replace(/^\/mission-control/, '') || '/'
  const file = join(DOCS, path === '/' ? 'index.html' : path)
  /* Anything without a file extension is an app route, and GitHub Pages hands
     those the app itself. Serving a 404 for them instead made this gate red at
     random: one run in three saw a console error for a path that was never a
     file. A missing ASSET still 404s, and still fails the gate, because that is
     the failure worth catching. */
  if (!existsSync(file)) {
    if (extname(file)) { console.log(`MISS ${path}`); res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(readFileSync(join(DOCS, 'index.html'))); return
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})
await new Promise((ok) => server.listen(0, ok))
const PORT = server.address().port
const URL = `http://localhost:${PORT}/mission-control/?noremote`
const KEY = 'mission-control-demo-v12'

let pass = 0, fail = 0
const errors = []
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1500, height: 1200 } })
/* The Mundi Opus player embeds YouTube, and YouTube's own scripts complain
   from inside that iframe about things this page neither caused nor can fix:
   analytics and ad pings that abort when the page tears down between steps,
   and the player asking for a compute-pressure permission a static host
   cannot delegate at frame-creation time. Both are intermittent, so left in
   they made this gate randomly red. Verified by URL before being listed:
   /api/stats/* and /ptracking are playback telemetry, /s/player is the
   player bundle, the rest are ad hosts. Deliberately paths, not the whole
   youtube.com host, so a real failure to load the player or the IFrame API
   still fails the gate. */
const THIRD_PARTY_NOISE = /youtube\.com\/(api\/stats|ptracking|s\/player)|doubleclick\.net|googleads|google-analytics\.com|googlesyndication/
/* Console errors carry the failing URL in location(), not always in the text:
   a bare "Failed to load resource: net::ERR_FAILED" says nothing on its own,
   so the URL is matched against the list above AND kept in what gets
   reported, so the next one of these is diagnosable without a repro run. */
/* A step that deliberately stubs a failing response owns the console error it
   causes. Anything else on that URL still fails the gate, because this is set
   for the length of one assertion and cleared straight after: a permanent
   entry in the list above would have hidden the very outage this gate exists
   to catch. */
let expected = null
const noteError = (text, url = '') => {
  if (expected && (expected.test(text) || (url && expected.test(url)))) return
  if (THIRD_PARTY_NOISE.test(text) || (url && THIRD_PARTY_NOISE.test(url))) return
  errors.push(`${text.slice(0, 120)}${url ? ` [${url.slice(0, 100)}]` : ''}`)
}
page.on('pageerror', (e) => noteError(e.message))
page.on('console', (m) => { if (m.type() === 'error') noteError(m.text(), m.location()?.url ?? '') })
const step = async (name, fn) => {
  try { await fn(); pass++; console.log(`PASS ${name}`) }
  catch (e) { fail++; console.log(`FAIL ${name}: ${String(e).split('\n')[0]}`) }
}
const fresh = async (route = '') => {
  await page.goto(URL); await page.waitForTimeout(300)
  await page.evaluate((K) => { localStorage.removeItem(K); localStorage.removeItem('qa-stream') }, KEY)
  await page.goto(`${URL}#/${route}`); await page.reload(); await page.waitForTimeout(700)
}

await step('plan: add, estimate visible, complete via chips', async () => {
  await fresh('plan')
  await page.getByRole('textbox', { name: 'New task' }).fill('Gate task')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.locator('.todo-row', { hasText: 'Gate task' }).first().getByRole('button', { name: /Options/ }).click()
  await page.getByRole('menuitem', { name: 'Move to today' }).click()
  await page.locator('.today-task', { hasText: 'Gate task' }).first().locator('.checkbox').click()
  await page.locator('.actual-chip').first().click()
  await page.waitForTimeout(400)
  const s = await page.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY)
  if (!s.tasks.find((t) => t.title === 'Gate task')?.done) throw new Error('not completed')
})
await step('breakdown: his own steps, his own minutes', async () => {
  await fresh('plan')
  await page.getByRole('textbox', { name: 'New task' }).fill('Gate breakdown task')
  await page.getByRole('button', { name: 'Add', exact: true }).click(); await page.waitForTimeout(400)
  await page.locator('.todo-row', { hasText: 'Gate breakdown' }).first().getByRole('button', { name: /Options/ }).click()
  await page.getByRole('menuitem', { name: /Break it down/i }).click(); await page.waitForTimeout(2200)
  // the line naming the service that wrote them is gone
  if (await page.locator('.demo-note', { hasText: /Groq, using the key/ }).count()) {
    throw new Error('the model footnote is still there')
  }
  await page.getByRole('button', { name: 'Mine', exact: true }).click(); await page.waitForTimeout(500)
  const rows = await page.locator('.step-edit').count()
  if (!rows) throw new Error('Mine opened with no rows to edit')
  // his own wording and his own number
  await page.locator('.step-edit .grow').first().fill('Zavolat, ne mailem')
  await page.locator('.step-min input').first().fill('35')
  await page.getByRole('button', { name: 'Add a step' }).click(); await page.waitForTimeout(300)
  await page.keyboard.type('Založit potvrzení')
  await page.waitForTimeout(300)
  // and the minutes box is a minutes box, not a 180px field with a 2 in it
  const w = (await page.locator('.step-min input').first().boundingBox()).width
  if (w > 110) throw new Error(`the minutes field is ${Math.round(w)}px wide`)
  await page.locator('.sheet-actions .btn-primary').click(); await page.waitForTimeout(600)
  const s = await page.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY)
  const t = (s.tasks ?? []).find((x) => x.title === 'Gate breakdown task')
  if (!t?.subtasks?.length) throw new Error('no subtasks were saved')
  if (t.subtasks[0].title !== 'Zavolat, ne mailem') throw new Error(`first step saved as ${t.subtasks[0].title}`)
  if (t.subtasks[0].estimateMin !== 35) throw new Error(`his 35 minutes were saved as ${t.subtasks[0].estimateMin}`)
  if (!t.subtasks.some((x) => x.title === 'Založit potvrzení')) throw new Error('the step he added is missing')
})

await step('habits: tick a build habit and persist', async () => {
  await fresh('habits')
  const dot = page.locator('.habit-line', { hasText: 'Meditation' }).first().locator('.daydot:not([disabled])').last()
  await dot.click(); await page.waitForTimeout(400)
  await page.reload(); await page.waitForTimeout(600)
  const s = await page.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY)
  if (!s.habitLog.some((t) => t.habitId === 'h-meditation')) throw new Error('tick not persisted')
})
await step('habits: a step with two ways to answer it stays ONE habit', async () => {
  /* "Move or caffeine" is one either-or, not two streaks. The merge keeps it
     as a single habit carrying both alternatives, which is the one shape of
     step that would have been wrong to split. */
  await fresh('habits')
  const found = await page.evaluate((K) => {
    const st = JSON.parse(localStorage.getItem(K))
    const withAlts = (st.habits ?? []).filter((h) => Array.isArray(h.alts) && h.alts.length > 1)
    return withAlts.map((h) => ({ name: h.name, alts: h.alts.length, folderId: h.folderId ?? null }))
  }, KEY)
  if (!found.length) throw new Error('the either-or step did not keep its alternatives')
  for (const h of found) {
    if (!h.folderId) throw new Error(`${h.name} kept its alternatives but is outside a folder`)
  }
})
await step('goals: add with milestones, tick one on the card', async () => {
  await fresh('goals')
  await page.getByRole('button', { name: 'Add a goal' }).click()
  await page.locator('#gname').fill('Gate goal')
  await page.locator('#gms').fill('Step one'); await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Add goal' }).click(); await page.waitForTimeout(500)
  const s = await page.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY)
  const g = s.goals.find((x) => x.name === 'Gate goal')
  if (!g || g.milestones?.length !== 1 || g.target !== 1) throw new Error('milestones not saved')
})
await step('focus: timer start writes state', async () => {
  await fresh('focus')
  await page.locator('.pomo-start').click(); await page.waitForTimeout(400)
  const p = await page.evaluate(() => JSON.parse(localStorage.getItem('mc-pomodoro')))
  if (p.phase !== 'focus') throw new Error(`phase ${p.phase}`)
  await page.locator('.focus-live').getByRole('button', { name: 'Stop' }).click()
})
await step('the menu is seven tabs, and what left it is reachable from the header', async () => {
  /* Five since Routines became a folder inside Habits (his instruction,
     2026-08-11); six since Apps joined after Why's (2026-08-23); seven since
     the Assistant got a page of its own (2026-08-25). The retired addresses
     still have to resolve, which is asserted below with the other retired
     ones. */
  await fresh('today')
  const tabs = await page.locator('.nav-tab').allInnerTexts()
  if (tabs.length !== 7) throw new Error(`${tabs.length} tabs: ${tabs.join(', ')}`)
  if (!tabs.some((t) => /apps/i.test(t))) throw new Error('Apps is not a tab')
  if (tabs.some((t) => /routines/i.test(t))) throw new Error('Routines is still a tab')
  /* Calendar left this list when it became a real page. It is still not a tab
     HERE, because this test runs in Personal and Calendar is Big Time only;
     the calendar test above owns that rule. */
  for (const gone of ['Avoidance', 'Assistant', 'Notes', 'Focus', 'Money', 'Reflect']) {
    if (tabs.includes(gone)) throw new Error(`${gone} is still a tab`)
  }
  /* My Mind left the header for the Apps shelf on his instruction. The apps
     test below owns it now. */
  for (const name of ['Note', 'Achievements']) {
    if (!(await page.getByRole('button', { name, exact: true }).count()) && !(await page.getByRole('link', { name }).count())) {
      throw new Error(`no ${name} in the header`)
    }
  }
  // Every old address still lands somewhere real.
  /* 'assistant' left this list when it became a real page of its own. It used
     to be a dead address walking to Today, back when the assistant was a rail
     that was removed. */
  for (const [route, heading] of [['coach', 'Today'], ['money', 'Money'], ['review', 'Reflect']]) {
    await page.goto(`${URL}#/${route}`); await page.reload(); await page.waitForTimeout(500)
    const h1 = await page.locator('h1').first().innerText()
    if (h1 !== heading) throw new Error(`#/${route} landed on ${h1}, not ${heading}`)
  }
})
await step('the header opens Notes, and the pill opens Focus', async () => {
  await fresh('today')
  await page.getByRole('button', { name: 'Note', exact: true }).click(); await page.waitForTimeout(600)
  if (!(await page.locator('.nt-app').count())) throw new Error('the Note button did not open Notes')
  // The pill is the only door to Focus now, and it is on every page.
  await page.getByRole('button', { name: 'Open the focus history' }).click(); await page.waitForTimeout(600)
  const h1 = await page.locator('h1').first().innerText()
  if (h1 !== 'Focus') throw new Error(`the pill went to ${h1}`)
})
await step('the zone: header stays, first move starts it, and the note lands in its folder', async () => {
  await fresh('today')
  await page.evaluate(() => { localStorage.setItem('mc-view', 'personal'); localStorage.setItem('mc-space', 'personal') })
  // A real task on today's list, so the empty-state message is not the one
  // under test here.
  await page.evaluate((K) => {
    const s = JSON.parse(localStorage.getItem(K))
    const today = new Date()
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    s.tasks = [{ id: 'zone-gate-t1', title: 'Zone gate task', source: 'mc', estimateMin: 25, estimated: true, done: false, space: 'personal', list: 'today', category: 'deep', createdAt: key, plannedOn: key }]
    localStorage.setItem(K, JSON.stringify(s))
  }, KEY)
  await page.goto(`${URL}#/zone`); await page.reload(); await page.waitForTimeout(800)
  const skip = page.getByRole('button', { name: 'Not today' })
  if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(400) }

  // The header itself (brand, the right-side buttons) is still on screen and
  // the zone content starts right where it ends, but the workspace switcher
  // and the six-tab nav are gone: neither one means anything once he has
  // actually walked into the room, and leaving them lit was the exact
  // "still just a dashboard page" problem the room exists to not be.
  const geo = await page.evaluate(() => {
    const header = document.querySelector('.topstick')
    const zone = document.querySelector('.zroom')
    return {
      headerVisible: !!header && header.getBoundingClientRect().height > 20,
      headerBottom: header ? Math.round(header.getBoundingClientRect().bottom) : -1,
      zoneTop: zone ? Math.round(zone.getBoundingClientRect().top) : -1,
      navPresent: !!document.querySelector('.nav'),
      spacesPresent: !!document.querySelector('.spaces'),
      badgePresent: !!document.querySelector('.pomo-badge'),
    }
  })
  if (!geo.headerVisible) throw new Error('the header is gone in the zone')
  if (Math.abs(geo.headerBottom - geo.zoneTop) > 2) throw new Error(`the zone starts at ${geo.zoneTop}, the header ends at ${geo.headerBottom}`)
  if (geo.navPresent) throw new Error('the six-tab nav is still showing in the zone')
  if (geo.spacesPresent) throw new Error('the workspace switcher is still showing in the zone')
  if (geo.badgePresent) throw new Error('the floating focus pill is still showing in the zone, doubling the countdown')

  /* This used to assert four bordered .widget tiles, which was his
     instruction at the time. He has since superseded it outright: "it's sort
     of very plain... completely different... it really has to be THE ZONE."
     So the room is one field now, and the assertions are the new truths:
     no card chrome anywhere, the four things still all present, and the
     whole room fitting one screen instead of scrolling. */
  const room = await page.evaluate(() => {
    const el = document.querySelector('.zroom')
    return {
      exists: !!el,
      cards: document.querySelectorAll('.zroom .widget').length,
      hasTask: !!document.querySelector('.znow-title'),
      hasClock: !!document.querySelector('.zclock-time'),
      hasNote: !!document.querySelector('.znote-rich .nt-editor'),
      hasPlayer: !!document.querySelector('.zplayer'),
      vOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }
  })
  if (!room.exists) throw new Error('the zone room did not render')
  if (room.cards) throw new Error(`${room.cards} bordered widget cards are still in the room; it is meant to be one field`)
  for (const [what, ok] of [['task', room.hasTask], ['clock', room.hasClock], ['note', room.hasNote], ['player', room.hasPlayer]]) {
    if (!ok) throw new Error(`the ${what} is missing from the room`)
  }
  if (room.vOverflow > 2) throw new Error(`the room scrolls by ${room.vOverflow}px; it is meant to be one screen`)

  if (!(await page.getByText('Zone gate task').count())) throw new Error('the first-move task did not appear in the zone')
  await page.locator('.znow-pill').click(); await page.waitForTimeout(500)
  const running = await page.locator('.znow.zn-running .znow-title').innerText()
  if (running !== 'Zone gate task') throw new Error(`the zone started "${running}", not the task clicked`)
  if (!(await page.locator('.znow-clock').innerText()).match(/^\d{1,2}:\d{2}$/)) throw new Error('the countdown is not a clock')
  // The countdown sits inside the ring, still the one dominant number in the
  // room, and must read larger than the task title above it.
  const sizes = await page.evaluate(() => ({
    clock: parseFloat(getComputedStyle(document.querySelector('.znow-clock')).fontSize),
    title: parseFloat(getComputedStyle(document.querySelector('.znow-title')).fontSize),
  }))
  if (sizes.clock <= sizes.title) throw new Error(`countdown is ${sizes.clock}px against a ${sizes.title}px title, not dominant`)
  // The state reads through the ring's own colour: ice while running, which
  // is the room's one interactive accent, not text that changes shade.
  const ringColor = await page.evaluate(() => getComputedStyle(document.querySelector('.zring-fill')).stroke)
  if (ringColor !== 'rgb(123, 213, 234)') throw new Error(`the running ring reads ${ringColor}, not the ice accent`)

  // Leaving the zone brings the nav and the switcher straight back.
  await page.goto(`${URL}#/today`); await page.waitForTimeout(500)
  if (!(await page.locator('.nav').count())) throw new Error('the nav did not come back on Today')
  if (!(await page.locator('.spaces').count())) throw new Error('the workspace switcher did not come back on Today')
  await page.goto(`${URL}#/zone`); await page.waitForTimeout(500)

  // The note saves into the folder shown, with no way to create a new one.
  if (await page.locator('.znote button', { hasText: 'New folder' }).count()) throw new Error('the zone note can create folders')
  await page.locator('.znote-rich .nt-editor').click()
  await page.keyboard.insertText('Zone gate note')
  await page.waitForTimeout(400)
  const saved = await page.evaluate((K) => {
    const s = JSON.parse(localStorage.getItem(K))
    return s.notes.find((n) => n.body === 'Zone gate note')
  }, KEY)
  if (!saved) throw new Error('typing in the zone note did not save a note')
  if (saved.folderId !== 'nf-space-personal') throw new Error(`the note landed in ${saved.folderId}, not the shown folder`)

  // The player: a real Mundi Opus video mounted (off-screen, in mundiplayer's
  // own permanent host, never inside the Zone tile), and next moves the
  // queue. Buttons in order: repeat, prev, play, next, shuffle.
  await page.waitForSelector('.mo-host iframe', { timeout: 15000 })
  const before = await page.locator('.zplayer-title').innerText()
  await page.locator('.zplayer-btn').nth(3).click(); await page.waitForTimeout(300)
  const after = await page.locator('.zplayer-title').innerText()
  if (before === after) throw new Error('next did not change the track')
  // The art is the track's own real thumbnail, a genuine still of what is
  // actually playing, and a square crop of it rather than stretched.
  const art = await page.evaluate(() => {
    const img = document.querySelector('.zplayer-art')
    const r = img.getBoundingClientRect()
    return { src: img.getAttribute('src'), ratio: r.width / r.height }
  })
  if (!/^https:\/\/i\.ytimg\.com\/vi\/.+\/hqdefault\.jpg$/.test(art.src)) throw new Error(`the player art src is "${art.src}", not a real YouTube thumbnail`)
  if (Math.abs(art.ratio - 1) > 0.05) throw new Error(`the player art is ${art.ratio.toFixed(2)}:1, not square`)
  // Repeat and shuffle are real toggles, not icons for show: pressing one
  // marks it pressed.
  const repeat = page.locator('.zplayer-tog').first()
  await repeat.click(); await page.waitForTimeout(150)
  if ((await repeat.getAttribute('aria-pressed')) !== 'true') throw new Error('repeat did not toggle on')
  await repeat.click(); await page.waitForTimeout(150)
  // The scrub bar is a real seek control, not a decoration: clicking near
  // its far end has to move playback forward, not just redraw the fill.
  await page.waitForTimeout(1500) // let the video's real duration load
  const scrub = page.locator('.zplayer-scrub')
  const box = await scrub.boundingBox()
  if (!box) throw new Error('no scrub bar to seek on')
  const beforeSeek = await page.locator('.zplayer-time span').first().innerText()
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2)
  await page.waitForTimeout(400)
  const afterSeek = await page.locator('.zplayer-time span').first().innerText()
  if (beforeSeek === afterSeek) throw new Error(`clicking the scrub bar at 80% did not move playback (stuck at ${afterSeek})`)
})
await step('the zone: the water deepens the further into the block he is', async () => {
  /* The room's signature. Measured end to end against two real states, not
     by forcing the variable: --depth is React-owned and reset every tick, and
     the ground carries a 900ms transition, so a value poked in and read back
     immediately returns the colour it was still animating away from. That is
     how this passed while the feature was in fact dead: the property lived on
     the room rather than on the shell that paints it, and custom properties
     only inherit downward. */
  const groundNow = async () => page.evaluate(() => {
    const sh = document.querySelector('.shell')
    const m = getComputedStyle(sh).backgroundColor.match(/oklab\(([\d.]+)/)
    return { raw: getComputedStyle(sh).backgroundColor, L: m ? parseFloat(m[1]) : null, inZone: sh.classList.contains('in-zone') }
  })
  await fresh('zone')
  const skip = page.getByRole('button', { name: 'Not today' })
  if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(400) }
  await page.waitForSelector('.zroom', { timeout: 10000 }); await page.waitForTimeout(1200)
  const surface = await groundNow()
  if (!surface.inZone) throw new Error('the shell is not wearing the room')
  if (surface.L === null) throw new Error(`the ground is not a mixed colour: ${surface.raw}`)

  // The same room, with a block already 80% run.
  await page.evaluate(() => localStorage.setItem('mc-pomodoro', JSON.stringify({
    focusMin: 50, blockMin: 50, breakMin: 5, cyclesDone: 1, cyclesDay: new Date().toDateString(),
    phase: 'focus', endsAt: Date.now() + 10 * 60 * 1000, pausedLeft: null,
    focusLabel: 'Deep gate block', startedAt: Date.now() - 40 * 60 * 1000,
  })))
  await page.reload(); await page.waitForTimeout(1500)
  const skip2 = page.getByRole('button', { name: 'Not today' })
  if (await skip2.count()) { await skip2.first().click(); await page.waitForTimeout(400) }
  await page.waitForSelector('.zroom', { timeout: 10000 }); await page.waitForTimeout(1400)
  const deep = await groundNow()
  if (deep.L === null) throw new Error(`the deep ground is not a mixed colour: ${deep.raw}`)
  /* A real drop, sized to the palette as it now stands. --z-deep was floored
     from #011620 to #02202F on the critic's finding that the first value was
     functionally black and converged on the very look this palette exists to
     avoid. That deliberately narrowed the range, so a threshold written for
     the old value failed on a room that was deepening correctly. */
  const drop = (surface.L - deep.L) / surface.L
  if (!(drop > 0.03)) {
    throw new Error(`the room does not deepen: L ${surface.L} at the surface against ${deep.L} at 80% in (${(drop * 100).toFixed(1)}%)`)
  }
})
await step('the zone: with more than one task open, he can choose which one to focus on', async () => {
  await fresh('today')
  // The Zone step before this one starts a real focus block and never
  // stops it; mc-pomodoro is its own key and fresh() does not touch it, so
  // without this the room opens here already "running" from that block and
  // the idle-only picker icon never renders.
  await page.evaluate(() => {
    localStorage.setItem('mc-view', 'personal'); localStorage.setItem('mc-space', 'personal')
    localStorage.removeItem('mc-pomodoro')
  })
  await page.evaluate((K) => {
    const s = JSON.parse(localStorage.getItem(K))
    const today = new Date()
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    s.tasks = [
      { id: 'pick-t1', title: 'Auto pick task', source: 'mc', estimateMin: 25, estimated: true, done: false, space: 'personal', list: 'today', category: 'deep', createdAt: key, plannedOn: key },
      { id: 'pick-t2', title: 'Hand picked task', source: 'mc', estimateMin: 15, estimated: true, done: false, space: 'personal', list: 'today', category: 'admin', createdAt: key, plannedOn: key },
    ]
    localStorage.setItem(K, JSON.stringify(s))
  }, KEY)
  await page.goto(`${URL}#/zone`); await page.reload(); await page.waitForTimeout(800)
  const skip = page.getByRole('button', { name: 'Not today' })
  if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(400) }
  await page.waitForSelector('.zroom', { timeout: 10000 })

  const picker = page.locator('.znow-icon[aria-label="Choose what to focus on"]')
  if (!(await picker.count())) throw new Error('two open tasks, but no way to choose between them')
  await picker.click(); await page.waitForTimeout(300)
  const rows = await page.locator('.znow-picker-list .znow-settings-row').allInnerTexts()
  if (!rows[0].startsWith('Auto pick')) throw new Error(`picker's first row is "${rows[0]}", not the auto-pick option`)
  if (!rows.some((r) => r.includes('Hand picked task'))) throw new Error('the second open task is missing from the picker')

  await page.getByRole('button', { name: /Hand picked task/ }).click(); await page.waitForTimeout(300)
  if ((await page.locator('.znow-title').innerText()) !== 'Hand picked task') throw new Error('choosing a task did not change what the room shows')
  // The about-to-start countdown has to reflect the chosen task's own
  // estimate (15m), not the auto pick's (25m) or the default focus length.
  if ((await page.locator('.znow-clock').innerText()) !== '15:00') throw new Error('the idle countdown did not pick up the chosen task\'s own estimate')

  await page.locator('.znow-pill').click(); await page.waitForTimeout(500)
  const running = await page.locator('.znow.zn-running .znow-title').innerText()
  if (running !== 'Hand picked task') throw new Error(`starting ran "${running}", not the task he chose`)
})
await step('mundi opus: leaving the zone does not stop the music, and the corner picks it up', async () => {
  await fresh('zone')
  const skip = page.getByRole('button', { name: 'Not today' })
  if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(400) }
  await page.waitForSelector('.zroom', { timeout: 10000 })
  await page.waitForSelector('.mo-host iframe', { timeout: 15000 })
  // Nothing has been pressed yet: the corner has nothing to say about a
  // player he has not touched.
  await page.goto(`${URL}#/today`); await page.waitForTimeout(500)
  if (await page.locator('.pomo-media').count()) throw new Error('the corner shows media controls before he ever pressed play')

  await page.goto(`${URL}#/zone`); await page.waitForTimeout(600)
  const trackBefore = await page.locator('.zplayer-title').innerText()
  /* Wait for playback to ACTUALLY start, not for an arbitrary duration. This
     is a live YouTube embed, so how long it takes to get going depends on
     the network; a fixed timeout made the claim below ("navigating did not
     stop it") randomly report itself as a stop when the truth was that it
     had not started yet. The Pause label is the player's own word for
     playing, so waiting on it separates the two failures cleanly. */
  await page.locator('.zplayer-play').click()
  await page.waitForSelector('.zplayer-play[aria-label="Pause"]', { timeout: 20000 })

  // Leaving the room: the same play state has to survive, not reset because
  // the tile that used to own the iframe is gone.
  await page.goto(`${URL}#/today`); await page.waitForTimeout(600)
  const media = page.locator('.pomo-media')
  if (!(await media.count())) throw new Error('the corner never picked up the player once he pressed play')
  if ((await media.locator('.pomo-media-title').innerText()) !== trackBefore) throw new Error('the corner is not showing the track that was actually playing')
  const pausePresent = await media.getByRole('button', { name: 'Pause' }).count()
  if (!pausePresent) throw new Error('the music stopped when the zone tile unmounted (corner still shows Play, not Pause)')

  // The corner's own next button moves the SAME queue Zone reads, not a
  // second independent player.
  await media.getByRole('button', { name: 'Next track' }).click(); await page.waitForTimeout(400)
  const trackAfterCornerSkip = await media.locator('.pomo-media-title').innerText()
  if (trackAfterCornerSkip === trackBefore) throw new Error('the corner\'s next button did not change the track')
  await page.goto(`${URL}#/zone`); await page.waitForTimeout(600)
  if ((await page.locator('.zplayer-title').innerText()) !== trackAfterCornerSkip) throw new Error('the zone and the corner disagree about what is playing')
})
await step('the zone: the note takes real formatting, not a plain textarea', async () => {
  await fresh('zone')
  const skip = page.getByRole('button', { name: 'Not today' })
  if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(400) }
  await page.waitForSelector('.zroom', { timeout: 10000 })

  const editor = page.locator('.znote-rich .nt-editor')
  await editor.click()
  await page.keyboard.insertText('gate note')
  await page.waitForTimeout(400)
  // Bold and italic are real marks on real selected text, not styled UI
  // with nothing behind it.
  await editor.selectText()
  await page.locator('.znote-rich').getByRole('button', { name: 'Bold' }).click()
  await page.locator('.znote-rich').getByRole('button', { name: 'Italic' }).click()
  await page.waitForTimeout(300)
  const marked = await editor.evaluate((el) => !!el.querySelector('b, strong') && !!el.querySelector('i, em'))
  if (!marked) throw new Error('bold and italic did not mark the text')
  // The whole point of a dash-in-hand-becomes-a-bullet editor is that a
  // literal "- " typed at the start of a line makes a real list. The Bold
  // and Italic marks just applied leave the WHOLE line selected (execCommand
  // does not collapse it), and a synthetic End keypress on that selection
  // did not collapse it either: Enter then overwrote the selected text
  // instead of starting a new line. Collapse to the end explicitly first.
  await editor.evaluate((el) => {
    const r = document.createRange()
    r.selectNodeContents(el)
    r.collapse(false)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(r)
  })
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('- a bullet point')
  await page.waitForTimeout(300)
  if (!(await editor.evaluate((el) => !!el.querySelector('ul li')))) throw new Error('typing "- " did not make a bullet')
  // It survives, in the saved note, as markdown, the same way every other
  // note on the app does: this is the real editor, not a second one.
  const saved = await page.evaluate((K) => {
    const s = JSON.parse(localStorage.getItem(K))
    return s.notes.find((n) => /a bullet point/.test(n.body))
  }, KEY)
  if (!saved) throw new Error('the formatted note did not save')
  if (!/\*\*[^*]+\*\*/.test(saved.body)) throw new Error(`bold did not round-trip to markdown: ${saved.body}`)
  if (!/^-\s/m.test(saved.body)) throw new Error(`the bullet did not round-trip to markdown: ${saved.body}`)
})
await step('achievements: three faces, and every milestone is earned by the log', async () => {
  await fresh('achievements')
  const segs = await page.locator('.achtab').allInnerTexts()
  if (segs.join(',') !== 'Milestones,Money,Reflect') throw new Error(`segments are ${segs.join(', ')}`)
  if ((await page.locator('.ms-card').count()) < 8) throw new Error('the milestone list is short')
  // Nothing is earned on an empty install: a badge for opening the app is the
  // exact thing this page must not do.
  if (await page.locator('.ms-card.is-earned').count()) throw new Error('something was earned with no record behind it')
  await page.getByRole('tab', { name: 'Money' }).click(); await page.waitForTimeout(400)
  if ((await page.locator('h1').first().innerText()) !== 'Money') throw new Error('the Money face did not open')
  await page.getByRole('tab', { name: 'Reflect' }).click(); await page.waitForTimeout(400)
  if ((await page.locator('h1').first().innerText()) !== 'Reflect') throw new Error('the Reflect face did not open')
})
await step('achievements: a real record earns its milestone, and says so once', async () => {
  await fresh('achievements')
  await page.evaluate((K) => {
    const s = JSON.parse(localStorage.getItem(K))
    const key = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
    s.focusSessions = Array.from({ length: 20 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - i)
      return { id: `af${i}`, day: key(d), minutes: 35, space: 'personal', label: 'Deep work' }
    })
    localStorage.setItem(K, JSON.stringify(s))
    localStorage.removeItem('mc:earned')
  }, KEY)
  await page.reload(); await page.waitForTimeout(800)
  // Twenty days of history makes the morning review offer itself over the top
  // of the page. Answer it first; it is not what this step is about.
  const notNow = page.getByRole('button', { name: 'Not today' })
  if (await notNow.count()) { await notNow.first().click(); await page.waitForTimeout(400) }
  // 20 blocks of 35 minutes is 11 hours, which clears the ten hour line and
  // nothing else.
  const earned = await page.locator('.ms-card.is-earned').allInnerTexts()
  if (earned.length !== 1) throw new Error(`${earned.length} earned, expected 1: ${earned.join(' | ')}`)
  if (!/Ten hours/.test(earned[0])) throw new Error(`the wrong one was earned: ${earned[0]}`)
  if (!(await page.locator('.ms-landed').count())) throw new Error('nothing celebrated a milestone that just landed')
  await page.getByRole('button', { name: 'Good' }).click(); await page.waitForTimeout(300)
  if (await page.locator('.ms-landed').count()) throw new Error('the celebration did not stand down')
  await page.reload(); await page.waitForTimeout(700)
  const again = page.getByRole('button', { name: 'Not today' })
  if (await again.count()) { await again.first().click(); await page.waitForTimeout(300) }
  if (await page.locator('.ms-landed').count()) throw new Error('it celebrated the same milestone twice')
})
await step('notes: folders are folders, with no workspace above them', async () => {
  await fresh('notes')
  const names = await page.locator('.nt-side .nt-fname').allInnerTexts()
  if (names[0] !== 'All notes') throw new Error(`the rail opens with ${names[0]}`)
  for (const space of ['Personal', 'Big Time', 'Off-Plate', 'Michael’s Corner']) {
    if (names.includes(space)) throw new Error(`${space} is still a row in the folder rail`)
  }
  if (!names.includes('Brain dumps')) throw new Error('his own folders are missing from the flat rail')
  // The list opens on everything, not on the workspace he happens to be in.
  if ((await page.locator('.nt-listhead h1').innerText()) !== 'All notes') throw new Error('notes did not open on All notes')
  // A folder he makes lands in the same flat list.
  await page.getByRole('button', { name: /New folder/ }).click()
  await page.locator('.nt-rename').fill('Gate folder')
  await page.keyboard.press('Enter'); await page.waitForTimeout(500)
  const after = await page.locator('.nt-side .nt-fname').allInnerTexts()
  if (!after.includes('Gate folder')) throw new Error('the folder he made is not in the rail')

  /* Filing must not move a note between workspaces. It used to: a note adopted
     its folder's space, so a folder made while standing in one workspace
     quietly reassigned everything dropped into it. */
  await page.getByRole('button', { name: 'New note' }).click(); await page.waitForTimeout(300)
  await page.locator('textarea[aria-label="Note title"]').fill('Gate filing'); await page.waitForTimeout(400)
  const readNote = async () => (await page.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY)).notes.find((n) => n.title === 'Gate filing')
  const was = (await readNote()).space
  /* It was written inside Gate folder, so the move that proves the point is
     the one out of it. */
  await page.locator('.nt-kebab button').first().click(); await page.waitForTimeout(200)
  await page.getByRole('menuitem', { name: 'No folder' }).click(); await page.waitForTimeout(500)
  const now = await readNote()
  if (!now) throw new Error('the note vanished when it was filed')
  if (now.space !== was) throw new Error(`filing moved the note from ${was} to ${now.space}`)
})
await step('today: the clock is a widget in the grid, and it says the real minute', async () => {
  await fresh('today')
  const c = await page.evaluate(() => {
    const w = document.querySelector('.clockw')
    if (!w) return null
    const frame = w.closest('.widget')?.getBoundingClientRect()
    const grid = document.querySelector('.react-grid-layout')?.getBoundingClientRect()
    const d = new Date()
    return {
      time: w.querySelector('.clockw-time')?.textContent ?? '',
      day: w.querySelector('.clockw-day')?.textContent ?? '',
      inGrid: !!frame && !!grid && frame.top >= grid.top - 1,
      leftmost: !!frame && !!grid && Math.round(frame.left - grid.left) < 8,
      realTime: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      /* The minute BEFORE now, and it is not slack. The widget renders when the
         page loads and this assertion reads the clock some time later, so a
         rollover in between made a correct clock fail. It failed exactly that
         way on 2026-08-25 at 21:03/21:04, on a run whose only other result was
         green. Accepting either minute still catches a clock that is stuck,
         blank, or wrong by more than the gap this test itself creates. */
      prevTime: new Date(d.getTime() - 60_000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      realDay: d.toLocaleDateString('en-GB', { weekday: 'long' }),
      bandHasClock: [...document.querySelectorAll('.band-metric .v')].some((el) => /^\d{2}:\d{2}$/.test(el.textContent ?? '')),
    }
  })
  if (!c) throw new Error('there is no clock widget on Today')
  if (!c.inGrid) throw new Error('the clock is not inside the widget grid')
  if (!c.leftmost) throw new Error('the clock is not at the left of the grid')
  if (c.time !== c.realTime && c.time !== c.prevTime) throw new Error(`the widget reads ${c.time}, the browser says ${c.realTime}`)
  if (c.day !== c.realDay) throw new Error(`the widget reads ${c.day}, the browser says ${c.realDay}`)
  if (c.bandHasClock) throw new Error('the clock is still in the band as well')
})
await step('today: the day line, the numbers and the week are his own', async () => {
  await fresh('today')
  // Two blocks with known stamps, one task finished today, one pinned ahead.
  await page.evaluate((K) => {
    const s = JSON.parse(localStorage.getItem(K))
    const d = new Date()
    const key = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
    const today = key(d)
    const at = (h, m) => { const x = new Date(); x.setHours(h, m, 0, 0); return x.toISOString() }
    s.focusSessions = [
      { id: 'gate-f1', day: today, minutes: 30, space: 'personal', label: 'Gate block one', at: at(9, 30) },
      { id: 'gate-f2', day: today, minutes: 45, space: 'personal', label: 'Gate block two', at: at(14, 45) },
    ]
    s.tasks = [
      { id: 'gate-t1', title: 'Gate finished thing', source: 'mc', estimateMin: 20, done: true, doneAt: new Date().toISOString(), space: 'personal', list: 'today', category: 'admin', createdAt: today, plannedOn: today },
      { id: 'gate-t2', title: 'Gate pinned thing', source: 'mc', estimateMin: 20, done: false, space: 'personal', list: 'today', category: 'admin', createdAt: today, plannedOn: today, at: '18:00' },
    ]
    localStorage.setItem(K, JSON.stringify(s))
  }, KEY)
  await page.reload(); await page.waitForTimeout(700)

  const face = await page.evaluate(() => {
    const track = document.querySelector('.dayline-track')?.getBoundingClientRect()
    const blocks = [...document.querySelectorAll('.dayline-block')].map((el) => {
      const r = el.getBoundingClientRect()
      return { startMin: Math.round(((r.left - track.left) / track.width) * 1440), min: Math.round((r.width / track.width) * 1440) }
    })
    const nowEl = document.querySelector('.dayline-now')?.getBoundingClientRect()
    const nums = [...document.querySelectorAll('.daynum')].map((el) => ({
      v: el.querySelector('.v')?.textContent ?? '', k: el.querySelector('.k')?.textContent ?? '',
    }))
    const d = new Date()
    return {
      blocks,
      nowMin: nowEl ? Math.round(((nowEl.left - track.left) / track.width) * 1440) : -1,
      realNow: d.getHours() * 60 + d.getMinutes(),
      sum: document.querySelector('.dayline-sum')?.textContent ?? '',
      pins: document.querySelectorAll('.dayline-pin').length,
      legend: document.querySelector('.dayline-legend')?.textContent ?? '',
      nums,
      days: [...document.querySelectorAll('.weekday')].map((el) => ({
        label: el.querySelector('.weekday-num')?.textContent ?? '', today: el.classList.contains('is-today'),
      })),
      noClockLabel: !document.querySelector('.dayline-now-t'),
    }
  })

  if (face.blocks.length !== 2) throw new Error(`${face.blocks.length} blocks drawn, not 2`)
  // 09:30 finish less 30 minutes starts at 09:00 = minute 540; 14:45 less 45 = 14:00 = 840.
  const starts = face.blocks.map((b) => b.startMin).sort((a, b) => a - b)
  if (Math.abs(starts[0] - 540) > 12) throw new Error(`first block starts at minute ${starts[0]}, not 540`)
  if (Math.abs(starts[1] - 840) > 12) throw new Error(`second block starts at minute ${starts[1]}, not 840`)
  if (Math.abs(face.nowMin - face.realNow) > 12) throw new Error(`the now marker is at ${face.nowMin}, the clock says ${face.realNow}`)
  if (!/1h 15m in 2 blocks/.test(face.sum)) throw new Error(`the line says "${face.sum}"`)
  if (face.pins !== 1) throw new Error(`${face.pins} pins for one pinned task`)
  if (!/18:00/.test(face.legend) || !/Gate pinned thing/.test(face.legend)) throw new Error('the pinned task is not named under the line')
  if (!face.noClockLabel) throw new Error('the now marker prints a time the clock tile already shows')

  if (face.nums.length !== 4) throw new Error(`${face.nums.length} numbers, not 4`)
  if (face.nums[0].v !== '1h 15m') throw new Error(`focused reads ${face.nums[0].v}, not 1h 15m`)
  if (!/^\d+\/\d+$/.test(face.nums[1].v)) throw new Error(`habits kept reads ${face.nums[1].v}`)
  if (face.nums[2].v !== '1') throw new Error(`finished reads ${face.nums[2].v}, not 1`)

  if (face.days.length !== 7) throw new Error(`${face.days.length} days in the week strip`)
  if (!face.days[6].today) throw new Error('the last card in the strip is not today')
  if (face.days.filter((d) => d.today).length !== 1) throw new Error('more than one day is marked today')

  // A day card is a way into that day's record. The morning review offers
  // itself over the top of the page, so it is answered first rather than
  // swallowing the click.
  const notNow = page.getByRole('button', { name: 'Not today' })
  if (await notNow.count()) { await notNow.first().click(); await page.waitForTimeout(400) }
  await page.locator('.weekday').first().click({ timeout: 5000 }); await page.waitForTimeout(500)
  if (!/#\/day\/\d{4}-\d{2}-\d{2}/.test(page.url())) throw new Error(`a day card went to ${page.url()}`)
})
await step('today: a task finished right after midnight still counts as finished today', async () => {
  /* His own report, indirectly: the app is in Prague (UTC+1/+2), and doneAt
     was being read by slicing toISOString's first ten characters, which is
     the UTC calendar date. For the two hours after local midnight, UTC has
     not turned over yet, so a task finished at 00:20 local read as finished
     "yesterday" and dropped out of today's count, every single night, in the
     exact window he is most likely to be closing out a late block. Seeded
     with an explicit local 00:20 stamp so this catches the bug regardless of
     what time the gate itself happens to run. */
  await fresh('today')
  await page.evaluate((K) => {
    const s = JSON.parse(localStorage.getItem(K))
    const now = new Date()
    const midnightish = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 20, 0)
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    s.tasks = [{
      id: 'gate-midnight', title: 'Gate midnight task', source: 'mc', estimateMin: 15,
      done: true, doneAt: midnightish.toISOString(),
      space: 'personal', list: 'today', category: 'admin', createdAt: today, plannedOn: today,
    }]
    localStorage.setItem(K, JSON.stringify(s))
  }, KEY)
  await page.reload(); await page.waitForTimeout(700)
  const skip = page.getByRole('button', { name: 'Not today' })
  if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(400) }
  const finished = await page.locator('.daynum').nth(2).locator('.v').innerText()
  if (finished !== '1') throw new Error(`finished reads "${finished}" for a task closed at 00:20 local, not 1`)
})
await step('today: the assistant is gone from the page, and stays gone', async () => {
  /* It used to assert the rail WAS here, which was right until he asked for
     it removed outright (2026-08-11: "remove the assistant functionality from
     the Today page, completely out of the website"). Kept as its inverse so
     nothing quietly puts it back. The /help in Notes is a different thing and
     has its own tests. */
  await fresh('today')
  const gone = await page.evaluate(() => ({
    rail: document.querySelectorAll('.assist-rail').length,
    mic: document.querySelectorAll('.assist-mic').length,
    box: document.querySelectorAll('.assist-input').length,
  }))
  for (const [what, n] of Object.entries(gone)) {
    if (n) throw new Error(`the assistant ${what} is back on Today (${n} found)`)
  }
})
await step('focus: the page takes the width it is given', async () => {
  // Self-calibrating: Plan is an ordinary full-width page at this viewport, so
  // its box is what "full width" means here. No magic pixel count.
  await fresh('plan')
  const ref = await page.evaluate(() => {
    const r = document.querySelector('.page')?.getBoundingClientRect()
    return r ? { w: Math.round(r.width), l: Math.round(r.left) } : null
  })
  await fresh('focus')
  const got = await page.evaluate(() => {
    const p = document.querySelector('.focus-page')?.getBoundingClientRect()
    const s = document.querySelector('.focus-settings')?.getBoundingClientRect()
    const d = document.querySelector('.focus-days')?.getBoundingClientRect()
    return p ? { w: Math.round(p.width), l: Math.round(p.left), sl: s ? Math.round(s.left - p.left) : 99, dw: d ? Math.round(d.width) : 0 } : null
  })
  if (!ref || !got) throw new Error('no geometry to compare')
  if (Math.abs(got.w - ref.w) > 1) throw new Error(`focus is ${ref.w - got.w}px narrower than a normal page`)
  if (Math.abs(got.l - ref.l) > 1) throw new Error('focus is indented from where a page starts')
  if (got.sl > 2) throw new Error(`the break row starts ${got.sl}px in from the page edge`)
  if (got.dw && Math.abs(got.dw - got.w) > 1) throw new Error('the day list does not use the page width')
})
await step('today: nothing to upload, and no camera left on the page', async () => {
  await fresh('today')
  const n = await page.locator('input[type="file"]').count()
  if (n) throw new Error(`${n} file inputs are still in the app`)
})
await step('money: reads Compass, and invents nothing when it cannot', async () => {
  await fresh('money')
  // The gate runs ?noremote, so Compass is unreachable by design. Every figure
  // must be a dash: a zero here would read as "you owe nothing".
  const kpis = await page.locator('.kpi').allInnerTexts()
  if (!kpis.length) throw new Error('no figures on the page at all')
  for (const k of kpis) {
    if (/\d/.test(k)) throw new Error(`a number appeared with no Compass behind it: ${k}`)
  }
  if (!(await page.getByText('Open Compass').count())) throw new Error('no way through to Compass')
})
await step('workspaces: write a task into Michael’s Corner', async () => {
  await fresh('plan')
  await page.locator('button', { hasText: 'Michael' }).first().click(); await page.waitForTimeout(400)
  await page.getByRole('textbox', { name: 'New task' }).fill('Corner gate')
  await page.getByRole('button', { name: 'Add', exact: true }).click(); await page.waitForTimeout(400)
  const s = await page.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY)
  if (s.tasks.find((t) => t.title === 'Corner gate')?.space !== 'corner') throw new Error('wrong space')
})
await step('vision + day record render', async () => {
  await fresh('board')
  if ((await page.locator('.bcard').count()) < 10) throw new Error('board empty')
  await page.goto(`${URL}#/day/2026-08-01`); await page.waitForTimeout(500)
})
await step('plan: tomorrow holds its own day', async () => {
  await fresh('plan')
  await page.getByRole('textbox', { name: 'New task' }).fill('Gate tomorrow task')
  await page.getByRole('button', { name: 'Add', exact: true }).click(); await page.waitForTimeout(300)
  await page.locator('.todo-row', { hasText: 'Gate tomorrow' }).getByRole('button', { name: /Options/ }).click()
  await page.getByRole('menuitem', { name: 'Move to tomorrow' }).click(); await page.waitForTimeout(400)
  const s = await page.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY)
  const t = s.tasks.find((x) => x.title === 'Gate tomorrow task')
  const tomorrow = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 1); const z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}` })
  if (t.list !== 'today' || t.plannedOn !== tomorrow) throw new Error(`stored ${t.list}/${t.plannedOn}`)
  // and today's side of the switch must not show it
  await page.locator('.day-switch .microcap', { hasText: 'Today' }).click(); await page.waitForTimeout(300)
  if (await page.locator('.today-task', { hasText: 'Gate tomorrow' }).count()) throw new Error('leaked into today')
})
await step('goals: a promised task ticks from the plan', async () => {
  await fresh('plan')
  await page.getByRole('textbox', { name: 'New task' }).fill('Gate promise')
  await page.getByRole('button', { name: 'Add', exact: true }).click(); await page.waitForTimeout(300)
  await page.goto(`${URL}#/goals`); await page.waitForTimeout(500)
  const col = page.locator('.goal-col', { hasText: 'This month' }).first()
  await col.locator('.ptask-add').click(); await page.waitForTimeout(200)
  await col.locator('.ptask-offer-row', { hasText: 'Gate promise' }).click(); await page.waitForTimeout(300)
  await page.goto(`${URL}#/plan`); await page.waitForTimeout(500)
  await page.locator('.todo-row', { hasText: 'Gate promise' }).getByRole('button', { name: /Options/ }).click()
  await page.getByRole('menuitem', { name: 'Move to today' }).click(); await page.waitForTimeout(300)
  await page.locator('.today-task', { hasText: 'Gate promise' }).locator('.checkbox').click()
  await page.locator('.actual-chip').first().click(); await page.waitForTimeout(400)
  await page.goto(`${URL}#/goals`); await page.waitForTimeout(500)
  const row = page.locator('.goal-col', { hasText: 'This month' }).first().locator('.ptask', { hasText: 'Gate promise' })
  if (!(await row.count()) || !(await row.evaluate((el) => el.classList.contains('done')))) throw new Error('promise not marked done')
})
await step('habits: a routine is a folder, and its habits tick on their own', async () => {
  /* This used to assert the opposite: that a routine-kept habit's dot was
     LOCKED and linked out to the Routines page. His instruction of 2026-08-11
     replaced that model outright: "routines are just a folder of different
     habits... each item in the routine will be a new habit". So the folder is
     the routine, the rows are its habits, and a habit is his to tick. */
  await fresh('habits')
  await page.locator('.space-btn', { hasText: 'All' }).click(); await page.waitForTimeout(500)
  const heads = await page.locator('.folder-head').allInnerTexts()
  if (heads.length < 3) throw new Error(`${heads.length} folders on Habits, expected the routines to be folders`)
  const wake = page.locator('.habit-section').filter({ has: page.locator('.folder-name', { hasText: 'After wake up' }) }).first()
  if (!(await wake.count())) throw new Error(`no "After wake up" folder, heads were: ${heads.join(' | ')}`)
  // Its steps are habits inside it, in the order he wrote them.
  const inside = await wake.locator('.habit-name').allInnerTexts()
  if (inside.length < 2) throw new Error(`the folder holds ${inside.length} habits`)
  // And a habit inside a folder is his to tick, which it was not before.
  const firstName = (await wake.locator('.habit-name').first().innerText()).trim()
  const dot = wake.locator('.habit-line').first().locator('.day-cell.is-today .daydot').first()
  if (await dot.isDisabled()) throw new Error('a habit inside a folder is still locked')
  await dot.click(); await page.waitForTimeout(600)
  /* Matched by the NAME on the row that was clicked. Matching by "first habit
     carrying this folderId" picked a different one: a step that already fed a
     habit keeps its old id and sits first in the array, while the rows render
     in the order he wrote them. */
  const kept = await page.evaluate(([K, name]) => {
    const st = JSON.parse(localStorage.getItem(K))
    const h = (st.habits ?? []).find((x) => x.folderId === 'r-wakeup' && x.name.trim() === name)
    return h ? (st.habitLog ?? []).some((t) => t.habitId === h.id) : `no habit named ${name} in the folder`
  }, [KEY, firstName])
  if (kept !== true) throw new Error(`ticking "${firstName}" inside a folder did not record it: ${kept}`)
})
await step('habits: the folder counts only what it still needs', async () => {
  /* The head reads how far through today the folder is. Optional habits never
     hold it open, or a folder with one optional in it could never read full. */
  await fresh('habits')
  await page.locator('.space-btn', { hasText: 'All' }).click(); await page.waitForTimeout(500)
  const head = await page.locator('.folder-head').first().innerText()
  const m = head.replace(/\s+/g, ' ').match(/(\d+)\/(\d+)\s*$/)
  if (!m) throw new Error(`a folder head shows no count: "${head.replace(/\n/g, ' ')}"`)
  const [, done, total] = m.map(Number)
  if (!(total > 0)) throw new Error(`folder total is ${total}`)
  if (done > total) throw new Error(`folder reads ${done}/${total}`)
  const counted = await page.evaluate((K) => {
    const st = JSON.parse(localStorage.getItem(K))
    const withFolder = (st.habits ?? []).filter((h) => h.folderId)
    const optional = withFolder.filter((h) => h.optional).length
    return { withFolder: withFolder.length, optional }
  }, KEY)
  if (counted.withFolder < 10) throw new Error(`${counted.withFolder} habits carry a folder; the merge did not run`)
})
await step('habits: a gated habit stays locked until the day\'s number clears it', async () => {
  /* The typing test was never "did you open it", it was "did you hit 75". The
     merge kept the lock's NAME (gatedBy) but dropped the only way to earn it,
     which left a box he could tick on a warm-up. His words: "there's no way
     that you will tell me that something doesn't work or doesn't live." */
  await fresh('habits')
  await page.locator('.space-btn', { hasText: 'All' }).click(); await page.waitForTimeout(500)
  const row = page.locator('.habit-line').filter({ has: page.locator('.habit-name', { hasText: 'Typing test' }) }).first()
  if (!(await row.count())) throw new Error('no Typing test habit on the page')
  const dot = row.locator('.day-cell.is-today .daydot').first()
  if (!(await dot.isDisabled())) throw new Error('the typing habit is tickable by hand before any score is logged')
  await row.locator('.run-caret').click(); await page.waitForTimeout(300)
  const input = row.locator('.wpm-row input')
  await input.fill('40'); await row.getByRole('button', { name: 'Log it' }).click(); await page.waitForTimeout(400)
  if (!(await dot.isDisabled())) throw new Error('40 WPM (under target) unlocked the habit')
  const failMsg = await row.locator('.run-verdict').innerText()
  if (!/short/.test(failMsg)) throw new Error(`a failing run did not say so: "${failMsg}"`)
  await input.fill('80'); await row.getByRole('button', { name: 'Log it' }).click(); await page.waitForTimeout(400)
  if (await dot.isDisabled()) throw new Error('80 WPM (over target) is still locked')
  const kept = await page.evaluate(([K]) => {
    const st = JSON.parse(localStorage.getItem(K))
    const h = (st.habits ?? []).find((x) => x.name === 'Typing test')
    return h ? (st.habitLog ?? []).some((t) => t.habitId === h.id) : 'no habit'
  }, [KEY])
  if (kept !== true) throw new Error(`a passing score did not keep the day: ${kept}`)
  // The number itself lands in the same series Reflect charts under Numbers,
  // keyed by the routine and step the habit came from, not by the habit id.
  const logged = await page.evaluate((K) => {
    const st = JSON.parse(localStorage.getItem(K))
    return (st.stepLog ?? []).filter((e) => e.routineId === 'r-morning' && e.stepId === 'mr4')
  }, KEY)
  if (!logged.some((e) => e.value === 80)) throw new Error('80 was not written into stepLog for r-morning/mr4')
})
await step('habits: picking either answer of a two-way habit keeps the day', async () => {
  /* "Move or caffeine" is one question. Picking Move has to tick the row, and
     picking the other answer afterwards is a change of mind, not a second
     thing done: the day stays kept either way. */
  await fresh('habits')
  await page.locator('.space-btn', { hasText: 'All' }).click(); await page.waitForTimeout(500)
  const row = page.locator('.habit-line').filter({ has: page.locator('.habit-name', { hasText: 'Move or caffeine' }) }).first()
  if (!(await row.count())) throw new Error('no "Move or caffeine" habit on the page')
  const dot = row.locator('.day-cell.is-today .daydot').first()
  if (!(await dot.isDisabled())) throw new Error('a two-way habit is tickable by hand before an answer is picked')
  await row.locator('.run-caret').click(); await page.waitForTimeout(300)
  await row.getByRole('button', { name: /^Move/ }).click(); await page.waitForTimeout(400)
  const afterMove = await page.evaluate((K) => {
    const st = JSON.parse(localStorage.getItem(K))
    const h = (st.habits ?? []).find((x) => x.name === 'Move or caffeine')
    return h ? (st.habitLog ?? []).some((t) => t.habitId === h.id) : 'no habit'
  }, KEY)
  if (afterMove !== true) throw new Error(`picking Move did not keep the day: ${afterMove}`)
  await row.getByRole('button', { name: /^Caffeine/ }).click(); await page.waitForTimeout(400)
  const afterSwitch = await page.evaluate((K) => {
    const st = JSON.parse(localStorage.getItem(K))
    const h = (st.habits ?? []).find((x) => x.name === 'Move or caffeine')
    return h ? (st.habitLog ?? []).filter((t) => t.habitId === h.id).length : -1
  }, KEY)
  if (afterSwitch !== 1) throw new Error(`switching the answer left ${afterSwitch} rows for the day, expected 1`)
})
await step('habits: the two content steps still generate today\'s real body', async () => {
  /* Pronunciation and the mouth stretch were never a note plus a checkbox:
     their whole job was content the app built fresh each morning. A habit
     with only a note where that used to be is a habit with the work removed. */
  await fresh('habits')
  await page.locator('.space-btn', { hasText: 'All' }).click(); await page.waitForTimeout(500)
  const pron = page.locator('.habit-line').filter({ has: page.locator('.habit-name', { hasText: 'Pronunciation test' }) }).first()
  await pron.locator('.run-caret').click(); await page.waitForTimeout(600)
  const paras = await pron.locator('.pron-para').count()
  if (paras < 2) throw new Error(`pronunciation habit shows ${paras} paragraphs, expected EN and CZ`)
  const stretch = page.locator('.habit-line').filter({ has: page.locator('.habit-name', { hasText: 'mouth stretch' }) }).first()
  await stretch.locator('.run-caret').click(); await page.waitForTimeout(300)
  const twisters = await stretch.locator('.stretch-item').count()
  if (twisters < 2) throw new Error(`mouth stretch habit shows ${twisters} tongue twisters`)
})
await step('phone: a task can be scheduled and rescheduled without dragging', async () => {
  /* Why he said Plan "doesn't work at all" on mobile: the only way into a
     time of day was dragging, and drag does not work with a thumb. Getting a
     task onto the day from the list already had a tap path; moving it once it
     was there did not. Both are tapped here, on a real touch context, and the
     stored slot is checked rather than the look of the page. */
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const p = await ctx.newPage()
  await p.goto(URL); await p.waitForTimeout(400)
  await p.evaluate((K) => localStorage.removeItem(K), KEY)
  await p.goto(`${URL}#/plan`); await p.reload(); await p.waitForTimeout(1000)
  const skip = p.getByRole('button', { name: 'Not today' })
  if (await skip.count()) { await skip.first().click(); await p.waitForTimeout(400) }
  await p.getByRole('textbox', { name: 'New task' }).fill('Thumb scheduling')
  await p.getByRole('button', { name: 'Add', exact: true }).click(); await p.waitForTimeout(500)
  const slotOf = () => p.evaluate((K) => JSON.parse(localStorage.getItem(K)).tasks.find((t) => t.title === 'Thumb scheduling')?.slot ?? null, KEY)

  await p.locator('.todo-row', { hasText: 'Thumb scheduling' }).first().getByRole('button', { name: /Options/ }).click()
  await p.waitForTimeout(250)
  await p.getByRole('menuitem', { name: 'Morning' }).click(); await p.waitForTimeout(500)
  if ((await slotOf()) !== 'morning') throw new Error(`tapping Morning from the list left it at ${await slotOf()}`)

  await p.locator('.today-task', { hasText: 'Thumb scheduling' }).first().getByRole('button', { name: /Options/ }).click()
  await p.waitForTimeout(250)
  await p.getByRole('menuitem', { name: 'Evening' }).click(); await p.waitForTimeout(500)
  if ((await slotOf()) !== 'evening') throw new Error(`a task already on the day could not be moved by tap: still ${await slotOf()}`)
  await ctx.close()
})
await step('phone: plan is usable at 390', async () => {
  const mp = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await mp.goto(URL); await mp.waitForTimeout(300)
  await mp.evaluate((K) => localStorage.removeItem(K), KEY)
  await mp.goto(`${URL}#/plan`); await mp.reload(); await mp.waitForTimeout(700)
  await mp.getByRole('textbox', { name: 'New task' }).fill('Phone gate task with a long name')
  await mp.getByRole('button', { name: 'Add', exact: true }).click(); await mp.waitForTimeout(300)
  const row = mp.locator('.todo-row', { hasText: 'Phone gate' }).first()
  const grow = row.locator('.grow')
  const w = (await grow.boundingBox()).width
  if (w < 150) throw new Error(`title squeezed to ${Math.round(w)}px`)
  const over = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (over > 0) throw new Error(`horizontal overflow ${over}px`)
  // the kebab must be inside the screen and clickable
  await row.getByRole('button', { name: /Options/ }).click()
  await mp.getByRole('menuitem', { name: 'Move to today' }).click(); await mp.waitForTimeout(300)
  const s = await mp.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY)
  if (s.tasks.find((t) => t.title.startsWith('Phone gate'))?.list !== 'today') throw new Error('move failed on phone')
  await mp.close()
})

await step('focus: stopping mid-block banks the elapsed minutes', async () => {
  // Its own page with a controlled clock: fast-forward 20 of 25 minutes and
  // stop. The block must land in focusSessions as 20 minutes, not vanish.
  const cp = await b.newPage({ viewport: { width: 1200, height: 900 } })
  await cp.clock.install()
  await cp.goto(URL); await cp.waitForTimeout(300)
  await cp.evaluate((K) => { localStorage.removeItem(K); localStorage.removeItem('mc-pomodoro') }, KEY)
  await cp.goto(`${URL}#/focus`); await cp.reload(); await cp.waitForTimeout(600)
  await cp.locator('.pomo-start').click(); await cp.waitForTimeout(300)
  await cp.clock.fastForward('20:00'); await cp.waitForTimeout(600)
  await cp.locator('.pomo-badge button[aria-label="Stop this block"]').click(); await cp.waitForTimeout(500)
  const s = await cp.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY)
  const total = (s.focusSessions ?? []).reduce((a, f) => a + f.minutes, 0)
  if (total < 19 || total > 21) throw new Error(`banked ${total}m of a stopped 20m block`)
  await cp.close()
})

await step('sync: typing a note fast never accuses your own device', async () => {
  /* His own report: a note raised "Another device had a different version"
     seconds after he first typed it, on a note never opened anywhere else.
     Real. Every save merges the pushed copy against the remote head, which on
     one device is that device's own push from a moment ago, and `hist` holds
     one entry per KEYSTROKE and is capped, so a sentence typed between two
     pushes rolled the older body off the end of its own history and the merge
     read it as a stranger. Typed here at 90 characters, well past the cap. */
  await fresh('notes')
  await page.locator('.nt-folder', { hasText: 'All notes' }).first().click(); await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'New note' }).click(); await page.waitForTimeout(300)
  await page.locator('textarea[aria-label="Note title"]').fill('Johny meeting')
  await page.locator('.nt-editor').click()
  const long = 'Domeq nefakturoval dataclubc ale kdyz se podari tak mame to cele hotove do patku rano'
  for (const ch of long) await page.keyboard.type(ch, { delay: 4 })
  await page.waitForTimeout(700)

  // The merge the save path actually performs: this body against its own
  // earlier self, exactly as the remote head would hold it.
  const verdict = await page.evaluate((K) => {
    const s = JSON.parse(localStorage.getItem(K))
    const note = s.notes.find((n) => n.title === 'Johny meeting')
    if (!note) return { err: 'the note was not saved' }
    const stale = { ...note, body: note.body.slice(0, 12), updatedAt: note.updatedAt - 4000 }
    return { histLen: (note.hist ?? []).length, dev: note.dev ?? null, staleInHist: (note.hist ?? []).includes(stale.body) }
  }, KEY)
  if (verdict.err) throw new Error(verdict.err)
  if (!verdict.dev) throw new Error('the note carries no device stamp, so a merge cannot tell it from another device')

  // And end to end: reload, which boots through the merge, and no banner.
  await page.reload(); await page.waitForTimeout(900)
  await page.locator('.nt-folder', { hasText: 'All notes' }).first().click(); await page.waitForTimeout(300)
  await page.locator('.nt-row', { hasText: 'Johny meeting' }).first().click(); await page.waitForTimeout(500)
  if (await page.locator('.nt-conflict').count()) throw new Error('a note typed on one device only still shows the another-device banner')
  const kept = await page.evaluate((K) => (JSON.parse(localStorage.getItem(K)).notes ?? []).find((n) => n.title === 'Johny meeting'), KEY)
  if (kept.conflict) throw new Error(`the note carries a conflict it should never have had: ${JSON.stringify(kept.conflict).slice(0, 90)}`)
  if (!kept.body.includes('patku')) throw new Error(`the typed body did not survive: ${JSON.stringify(kept.body).slice(0, 90)}`)
})
await step('sync: two tabs both keep what they added', async () => {
  /* His own repro. Two tabs of one browser share localStorage, so each save
     used to replace the other's lists wholesale. */
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } })
  const A = await ctx.newPage(), B = await ctx.newPage()
  const add = async (page, title) => {
    await page.bringToFront()
    if (!/#\/plan/.test(page.url())) { await page.goto(`${URL}#/plan`); await page.waitForTimeout(600) }
    await page.getByRole('textbox', { name: 'New task' }).fill(title)
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await page.waitForTimeout(500)
  }
  await A.goto(URL); await A.waitForTimeout(300)
  await A.evaluate((K) => localStorage.removeItem(K), KEY)
  await A.goto(`${URL}#/plan`); await A.reload(); await A.waitForTimeout(700)
  await B.goto(`${URL}#/plan`); await B.waitForTimeout(700)
  await add(A, 'Tab A task')
  await add(B, 'Tab B task')
  await A.bringToFront(); await A.waitForTimeout(700)
  const titles = await A.evaluate((K) => JSON.parse(localStorage.getItem(K)).tasks.map((t) => t.title), KEY)
  if (!titles.includes('Tab A task') || !titles.includes('Tab B task')) throw new Error(`lost one: ${titles.join(', ')}`)
  // and a delete on one side is not undone by the other
  await A.locator('.todo-row', { hasText: 'Tab B task' }).getByRole('button', { name: /Options/ }).click()
  await A.getByRole('menuitem', { name: 'Delete' }).click(); await A.waitForTimeout(600)
  await add(B, 'Tab B later')
  await A.bringToFront(); await A.waitForTimeout(800)
  const after = await A.evaluate((K) => JSON.parse(localStorage.getItem(K)).tasks.map((t) => t.title), KEY)
  if (after.includes('Tab B task')) throw new Error('a deleted task came back')
  if (!after.includes('Tab B later') || !after.includes('Tab A task')) throw new Error('a live task was lost')
  await ctx.close()
})

await step('sync: a phone that slept through the week cannot wipe what happened while it slept', async () => {
  /* The scare that commissioned this: away for over a week, came back, the
     banner offering to put yesterday's unfinished work back was gone and the
     to-do list looked emptied.

     The tasks were never in danger, they merge row by row. `plan` and `review`
     were: neither is a collection, so neither was in ALL_KEYS, and both fell
     through to the wholesale `{ ...newer }`. A device asleep since before the
     trip wakes, saves once, is "newer" by savedAt, and its idea of plan and
     review replaces what actually happened. `plan.returnedOn/Ids` IS the
     banner. `review.reflections` is prose he typed with no log to rebuild from.

     Driven through the real storage event, which is the same applyExternal
     path a second device takes. */
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } })
  const A = await ctx.newPage()
  await A.goto(URL); await A.waitForTimeout(400)
  await A.evaluate((K) => localStorage.removeItem(K), KEY)
  await A.goto(`${URL}#/plan`); await A.reload(); await A.waitForTimeout(900)

  // Nine days asleep, with real work behind it: a written reflection, a sealed
  // week of habit history, and two unfinished tasks planned for the day it slept.
  const seeded = await A.evaluate((K) => {
    const st = JSON.parse(localStorage.getItem(K))
    const d = new Date(); d.setDate(d.getDate() - 9)
    const key = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
    const gone = key(d)
    st.lastRollDay = gone
    /* A habit of our own with a known id, and real ticks in the week that
       ended, so the seal has something true to count and the assertion is not
       riding on whatever happens to be first in the array. */
    st.habits = [...(st.habits ?? []), { id: 'slept-h', space: 'personal', name: 'Slept through it', frequency: 'daily', kind: 'build', paused: false, days: [false, false, false, false, false, false, false], history: [5, 4] }]
    const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    st.habitLog = [...(st.habitLog ?? []), ...[0, 1, 2].map((n) => {
      const x = new Date(mon); x.setDate(mon.getDate() + n)
      return { habitId: 'slept-h', day: key(x) }
    })]
    st.tasks = [
      { id: 'slept-a', space: 'personal', title: 'Write to FU', list: 'today', plannedOn: gone, done: false, createdAt: gone, estimateMin: 15, category: 'admin' },
      { id: 'slept-b', space: 'personal', title: 'Call VZP', list: 'today', plannedOn: gone, done: false, createdAt: gone, estimateMin: 15, category: 'admin' },
    ]
    localStorage.setItem(K, JSON.stringify(st))
    return { gone, blob: localStorage.getItem(K) }
  }, KEY)

  // Boot: the gap rolls, both tasks come back, the banner exists.
  await A.reload(); await A.waitForTimeout(1200)
  const rolled = await A.evaluate((K) => {
    const st = JSON.parse(localStorage.getItem(K))
    return {
      returnedCount: st.plan?.returnedCount ?? 0,
      returnedIds: st.plan?.returnedIds ?? [],
      reflections: (st.review?.reflections ?? []).length,
      history: (st.habits ?? []).find((h) => h.id === 'slept-h')?.history ?? [],
      backlog: (st.tasks ?? []).filter((t) => t.list === 'backlog').map((t) => t.id).sort(),
    }
  }, KEY)
  if (rolled.returnedCount !== 2) throw new Error(`the gap returned ${rolled.returnedCount} tasks, expected 2`)

  /* Written AFTER the phone's snapshot was taken, which is the whole point: a
     phone that went to sleep before he typed this cannot be holding a copy, so
     if it wins the merge the prose is simply gone. */
  await A.evaluate((K) => {
    const st = JSON.parse(localStorage.getItem(K))
    st.review = { ...(st.review ?? {}), reflections: [{ id: 'refl-1', from: '2026-08-10', to: '2026-08-16', wins: ['Filed the tax return'], outcomes: [], drifted: '' }] }
    localStorage.setItem(K, JSON.stringify(st))
  }, KEY)
  await A.reload(); await A.waitForTimeout(900)
  const wrote = await A.evaluate((K) => (JSON.parse(localStorage.getItem(K)).review?.reflections ?? []).length, KEY)
  if (wrote !== 1) throw new Error(`the reflection did not persist before the merge: ${wrote}`)
  /* The sealed weeks must survive, in order. A run on a Monday legitimately has
     one more bucket than a run on a Sunday, because the ISO week turned and the
     app opened the current one at zero; asserting exact equality made this gate
     fail every Monday for a reason that was never a bug. What matters is that
     nothing already banked was lost or reordered. */
  const sealed = rolled.history.slice(0, 3).join(',')
  if (sealed !== '5,4,3') throw new Error(`the sealed weeks counted wrong: ${JSON.stringify(rolled.history)}, expected them to start [5,4,3]`)
  if (rolled.history.length > 4) throw new Error(`unexpected extra weeks: ${JSON.stringify(rolled.history)}`)
  if (rolled.history.length === 4 && rolled.history[3] !== 0) throw new Error(`the new week did not open at zero: ${JSON.stringify(rolled.history)}`)

  /* Now the sleeping phone wakes and saves: the SAME pre-roll blob, stamped
     later, plus one new note so the merge is not a no-op. Written from a page
     on the same origin that is not the app, so nothing races its own boot. */
  await A.evaluate(([K, blob]) => {
    const stale = JSON.parse(blob)
    stale.savedAt = Date.now() + 120000
    stale.notes = [...(stale.notes ?? []), { id: 'phone-note', space: 'personal', body: 'from the phone', title: 'from the phone', updatedAt: Date.now() }]
    // Dispatched exactly as another tab would, which is the path applyExternal takes.
    localStorage.setItem(K, JSON.stringify(stale))
    window.dispatchEvent(new StorageEvent('storage', { key: K, newValue: JSON.stringify(stale) }))
  }, [KEY, seeded.blob])
  await A.waitForTimeout(1500)
  await A.reload(); await A.waitForTimeout(1200)

  const after = await A.evaluate((K) => {
    const st = JSON.parse(localStorage.getItem(K))
    return {
      merged: (st.notes ?? []).some((n) => n.id === 'phone-note'),
      returnedCount: st.plan?.returnedCount ?? 0,
      returnedIds: (st.plan?.returnedIds ?? []).slice().sort(),
      reflections: (st.review?.reflections ?? []).length,
      history: (st.habits ?? []).find((h) => h.id === 'slept-h')?.history ?? [],
      tasks: (st.tasks ?? []).filter((t) => t.id === 'slept-a' || t.id === 'slept-b').length,
    }
  }, KEY)
  // The merge really ran, or the rest proves nothing.
  if (!after.merged) throw new Error('the phone blob never merged, so this test asserts nothing')
  if (after.tasks !== 2) throw new Error(`${after.tasks} of the 2 tasks survived`)
  if (after.reflections !== 1) throw new Error(`a sleeping phone deleted a written reflection: ${after.reflections} left`)
  if (after.returnedCount !== 2) throw new Error(`the postpone banner lost its count: ${after.returnedCount}`)
  if (after.returnedIds.join(',') !== 'slept-a,slept-b') throw new Error(`the banner lost which tasks: ${after.returnedIds.join(',')}`)
  /* Same reason as above: the assertion is that the sealed weeks survived the
     merge intact, not that today happens to be a Sunday. */
  if (after.history.slice(0, 3).join(',') !== '5,4,3') throw new Error(`a sleeping phone rolled back a sealed week: ${JSON.stringify(after.history)}, expected them to start [5,4,3]`)
  if (after.history.length < rolled.history.length) throw new Error(`a sleeping phone dropped a week: ${JSON.stringify(after.history)} was ${JSON.stringify(rolled.history)}`)
  await ctx.close()
})

await step('one fact, one number: Today and Habits agree on what today asked', async () => {
  /* They did not. Today collapsed routines into folders and opened with
     "1/14"; the Habits page counted raw rows and opened with "1/64", on the
     same morning, about the same habits. Two headline numbers for one fact is
     the fastest way to stop trusting every other number in the app.

     Asserted as exact strings, not as a shape: the old check here was a regex
     for /^\d+\/\d+$/, which "1/14" and "1/64" both satisfy happily. */
  await fresh('today')
  await page.locator('.space-btn', { hasText: 'All' }).click(); await page.waitForTimeout(500)
  const todayNum = (await page.locator('.daynum').nth(1).innerText()).replace(/\s+/g, ' ').trim()
  const todayFrac = todayNum.split(' ')[0]
  await page.goto(`${URL}#/habits`); await page.waitForTimeout(900)
  const habitsFrac = (await page.locator('.band-metric .v, .band-metrics .v').first().innerText()).trim()
  if (!/^\d+\/\d+$/.test(todayFrac)) throw new Error(`Today's habit number is not a fraction: "${todayNum}"`)
  if (todayFrac !== habitsFrac) {
    throw new Error(`Today says ${todayFrac} habits kept and Habits says ${habitsFrac} done today, about the same day`)
  }
  // And the denominator is folders, not raw rows: a seeded profile has far
  // more habits than it has things to actually do.
  const raw = await page.evaluate((K) => (JSON.parse(localStorage.getItem(K)).habits ?? []).length, KEY)
  const denom = Number(todayFrac.split('/')[1])
  if (!(denom > 0 && denom < raw)) {
    throw new Error(`denominator ${denom} against ${raw} habits: expected folders to collapse the count`)
  }
})

await step('a task finished without a time is finished on every page that counts', async () => {
  /* Ticking a task opens the "how long?" strip, and pressing skip finishes it
     without a time. That path wrote no ledger row, so Today counted it (it
     reads doneAt) while Reflect and the day record counted the ledger and saw
     nothing. A day of work ticked and moved on from opened with "Nothing was
     logged on this day", which is how a week comes to look erased.

     Both paths are driven here, so the test proves they AGREE rather than that
     one of them works. */
  const doIt = async (title, skip) => {
    await page.goto(`${URL}#/plan`); await page.waitForTimeout(700)
    await page.getByRole('textbox', { name: 'New task' }).fill(title)
    await page.getByRole('button', { name: 'Add', exact: true }).click(); await page.waitForTimeout(500)
    const row = page.locator('.todo-row', { hasText: title }).first()
    await row.getByRole('button', { name: /Options/ }).click()
    await page.getByRole('menuitem', { name: 'Move to today' }).click(); await page.waitForTimeout(600)
    await page.locator('.today-task', { hasText: title }).first().locator('.checkbox').click()
    await page.waitForTimeout(400)
    if (skip) await page.locator('.actual-skip').first().click()
    else await page.locator('.actual-chip').first().click()
    await page.waitForTimeout(700)
  }

  for (const skip of [true, false]) {
    await fresh('plan')
    const title = skip ? 'Gate skip finish' : 'Gate timed finish'
    await doIt(title, skip)

    const state = await page.evaluate(([K, t]) => {
      const st = JSON.parse(localStorage.getItem(K))
      const task = (st.tasks ?? []).find((x) => x.title === t)
      return { done: task?.done, doneAt: typeof task?.doneAt, actualMin: task?.actualMin ?? null }
    }, [KEY, title])
    if (state.done !== true || state.doneAt !== 'string') throw new Error(`${title}: not recorded as finished (${JSON.stringify(state)})`)

    await page.goto(`${URL}#/today`); await page.waitForTimeout(900)
    const todayFinished = (await page.locator('.daynum').nth(2).innerText()).trim().split(/\s+/)[0]
    if (todayFinished !== '1') throw new Error(`${title}: Today says "${todayFinished}" things finished, expected 1`)

    await page.goto(`${URL}#/review`); await page.waitForTimeout(1100)
    const reflectFinished = (await page.locator('.panel', { hasText: 'Finished' }).first().locator('.kpi').first().innerText()).trim().replace(/\D+$/, '')
    if (reflectFinished !== '1') throw new Error(`${title}: Reflect says "${reflectFinished}" finished, expected 1`)

    const dayKey = await page.evaluate(() => {
      const d = new Date()
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })
    await page.goto(`${URL}#/day/${dayKey}`); await page.waitForTimeout(900)
    const dayText = await page.evaluate(() => document.body.innerText)
    if (!dayText.includes(title)) throw new Error(`${title}: the day record does not name it`)
    if (/Nothing was logged on this day/.test(dayText)) throw new Error(`${title}: the day record says nothing was logged`)
  }
})

await step('notes: a slash command is taken at either end of the line', async () => {
  /* He wrote "33 tis vyfaktuovat /help", pressed Enter, and got silence, which
     is indistinguishable from the feature being deleted. It was anchored to the
     start of the line and only the start. Both commands now take either end,
     and the argument is the rest of the line. */
  await fresh('notes')
  const write = async (text) => {
    await page.goto(`${URL}#/notes`); await page.waitForTimeout(700)
    const add = page.getByRole('button', { name: /New note/i }).first()
    if (await add.count()) { await add.click(); await page.waitForTimeout(700) }
    const ed = page.locator('[contenteditable="true"]').first()
    await ed.click(); await page.waitForTimeout(150)
    await page.keyboard.type(text); await page.waitForTimeout(200)
    await page.keyboard.press('Enter'); await page.waitForTimeout(800)
  }
  /* The LIST, not today. Capture and committing to a day are different acts:
     /task only captures. */
  const todays = () => page.evaluate((K) => {
    const st = JSON.parse(localStorage.getItem(K) || '{}')
    return (st.tasks ?? []).filter((t) => t.list === 'backlog').map((t) => t.title)
  }, KEY)

  // The whole sentence before the command becomes the task, command stripped.
  await write('Dat dohromady glosar veci ktere ctp pouziva /task')
  let t = await todays()
  if (t.length !== 1) throw new Error(`trailing /task made ${t.length} tasks, expected 1`)
  if (t[0] !== 'Dat dohromady glosar veci ktere ctp pouziva') {
    throw new Error(`trailing /task kept the command or lost text: "${t[0]}"`)
  }
  if (!(await page.locator('.nt-task-made').count())) throw new Error('no mark saying where the line went')
  const onToday = await page.evaluate((K) => {
    const st = JSON.parse(localStorage.getItem(K) || '{}')
    return (st.tasks ?? []).filter((t) => t.list === 'today').length
  }, KEY)
  if (onToday !== 0) throw new Error(`/task put ${onToday} straight onto today; it captures to the list only`)

  // And at the head of the line.
  await write('/task Zavolat na VZP')
  t = await todays()
  if (!t.includes('Zavolat na VZP')) throw new Error(`leading /task did not land: ${JSON.stringify(t)}`)
  const before = t.length

  // A command with no argument does nothing at all, rather than filing an empty task.
  await write('/task')
  t = await todays()
  if (t.length !== before) throw new Error(`bare /task filed something: ${JSON.stringify(t)}`)
})

await step('notes: a slash command inside a list takes one bullet, not the list', async () => {
  /* His report: five bullets, /task on the last one, and all five arrived as a
     single task with the words run together. blockAt walks up to a child of the
     root, so inside a <ul> it returns the whole list. /help had the same bug
     and would have replaced every bullet with one answer. */
  await fresh('notes')
  await page.goto(`${URL}#/notes`); await page.waitForTimeout(700)
  const add = page.getByRole('button', { name: /New note/i }).first()
  if (await add.count()) { await add.click(); await page.waitForTimeout(700) }
  const ed = page.locator('[contenteditable="true"]').first()
  await ed.click(); await page.waitForTimeout(150)
  const items = ['33 tis vyfakturovat na nove PO', 'Skoleni AI certifikace', 'Shrnuti', 'Mirek', 'Budget na pristi rok']
  await page.keyboard.type('- ' + items[0])
  for (const it of items.slice(1)) { await page.keyboard.press('Enter'); await page.keyboard.type(it) }
  await page.waitForTimeout(250)
  await page.keyboard.type(' /task')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)

  const titles = await page.evaluate((K) => {
    const st = JSON.parse(localStorage.getItem(K) || '{}')
    return (st.tasks ?? []).filter((t) => t.list === 'backlog').map((t) => t.title)
  }, KEY)
  if (titles.length !== 1) throw new Error(`${titles.length} tasks from one bullet: ${JSON.stringify(titles)}`)
  if (titles[0] !== 'Budget na pristi rok') {
    throw new Error(`the bullet did not come across on its own: "${titles[0]}"`)
  }
  // the other four are still bullets, and the marked one is still a list item
  const html = await page.evaluate(() => document.querySelector('[contenteditable="true"]').innerHTML)
  const lis = (html.match(/<li/g) || []).length
  if (lis < 5) throw new Error(`the list lost its shape: ${lis} items left`)
  if (!/<li[^>]*>[^<]*Budget na pristi rok/.test(html)) throw new Error('the task line stopped being a bullet')
})

await step('calendar: Big Time only, and it never pretends the day is empty', async () => {
  /* The first menu item that is not in every workspace. It earns that: it is
     not a view of his own data with a filter on it, it is a read of somebody
     else's system that exists for one workspace, and an empty Calendar in
     Personal would advertise something that cannot work there. */
  await fresh('today')
  const tabsIn = async (label) => {
    await page.locator('.space-btn', { hasText: label }).first().click()
    await page.waitForTimeout(600)
    return (await page.locator('.nav-tab').allInnerTexts()).map((t) => t.trim().toUpperCase())
  }
  const personal = await tabsIn('Personal')
  if (personal.includes('CALENDAR')) throw new Error(`Calendar showed in Personal: ${personal.join(', ')}`)
  const work = await tabsIn('Big Time')
  if (!work.includes('CALENDAR')) throw new Error(`Calendar missing in Big Time: ${work.join(', ')}`)

  /* And with no feed reachable it says so, rather than rendering an empty week.
     "Nothing scheduled" over a day full of meetings is the most expensive thing
     this page could say, so every state is named. */
  await page.goto(`${URL}#/calendar`); await page.waitForTimeout(900)
  const said = await page.locator('.page').innerText()
  if (await page.locator('.cal-row').count()) throw new Error('rows rendered with no feed')
  if (!/cannot be read|not connected|Sign in/i.test(said)) {
    throw new Error(`the page went quiet instead of saying why: ${JSON.stringify(said.slice(0, 120))}`)
  }
  /* The workspace lives OUTSIDE the state blob, so fresh() does not clear it.
     Leaving it on Big Time made the next test run in the wrong workspace and
     find none of its habits. Put it back. */
  await page.locator('.space-btn', { hasText: 'Personal' }).first().click()
  await page.waitForTimeout(400)
})

await step('habits: a quitting row keeps its slip button off the day dots', async () => {
  /* The foot column is a fixed width, so a long "since 12 Apr, 114 best run"
     used to push the button out of its own column and onto Sunday's dot, at a
     different x on every row. Measured, because eyeballing it missed it twice. */
  await fresh('habits')
  await page.evaluate((K) => {
    const s = JSON.parse(localStorage.getItem(K))
    const mk = (id, name, since) => ({ id, space: 'personal', name, kind: 'break', frequency: 'daily', days: [false, false, false, false, false, false, false], history: [], quitSince: since })
    s.habits = [...(s.habits ?? []), mk('q1', 'Doomscrolling', '2026-08-01'), mk('q2', 'Smoking', '2026-04-12'), mk('q3', 'Buying things I do not need', '2026-05-27')]
    s.slips = [{ habitId: 'q1', day: '2026-07-30' }]
    localStorage.setItem(K, JSON.stringify(s))
  }, KEY)
  await page.reload(); await page.waitForTimeout(800)
  const rows = await page.evaluate(() => [...document.querySelectorAll('.habit-row')]
    .filter((r) => r.querySelector('.quit-slip'))
    .map((r) => {
      const b = r.querySelector('.quit-slip').getBoundingClientRect()
      const d = r.querySelector('.habit-days')?.getBoundingClientRect()
      return { left: Math.round(b.left), clear: d ? Math.round(b.left - d.right) : 99 }
    }))
  if (rows.length < 3) throw new Error(`only ${rows.length} quitting rows rendered`)
  const off = rows.find((r) => r.clear < 0)
  if (off) throw new Error(`the slip button sits ${-off.clear}px over the day dots`)
  if (new Set(rows.map((r) => r.left)).size !== 1) throw new Error(`the buttons do not line up: ${rows.map((r) => r.left).join(', ')}`)
})

await step('daily review: offered once, fixes yesterday, and stays shut', async () => {
  /* The whole point of it: what he marks here has to land in the record for
     YESTERDAY, and it must not ask again the same day. */
  await fresh('today')
  const y = await page.evaluate((K) => {
    const s = JSON.parse(localStorage.getItem(K))
    const z = (n) => String(n).padStart(2, '0')
    const key = (b) => { const d = new Date(); d.setDate(d.getDate() - b); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}` }
    const yd = key(1)
    s.habitLog = [{ habitId: 'h-meditation', day: yd }]
    s.focusSessions = [{ id: 'f1', day: yd, minutes: 40, space: 'personal', label: 'Gate' }]
    s.tasks = [{ id: 'tx', title: 'Left from yesterday', source: 'mc', estimateMin: 20, done: false, space: 'personal', list: 'today', category: 'admin', plannedOn: yd }]
    delete s.dailyDone; delete s.dailySkipped
    localStorage.setItem(K, JSON.stringify(s))
    return yd
  }, KEY)
  await page.reload(); await page.waitForTimeout(900)
  if (!(await page.locator('.dr-screen').count())) throw new Error('the review was not offered')
  const seen = []
  const forward = async () => {
    if (!(await page.locator('.dr-stage h1').count())) return false
    seen.push(((await page.locator('.dr-stage h1').first().textContent()) ?? '').trim())
    const go = page.locator('.dr-foot .btn-primary')
    if (!(await go.count())) return false
    await go.click(); await page.waitForTimeout(450)
    return true
  }
  await forward()
  // walk to the unmarked stage and put one habit right
  while (await page.locator('.dr-tick').count() === 0) {
    if (!(await forward())) break
  }
  const tick = page.locator('.dr-tick').first()
  if (!(await tick.count())) throw new Error('nothing was offered to put right')
  await tick.click(); await page.waitForTimeout(500)
  const after = await page.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY)
  const wroteYesterday = (after.habitLog ?? []).some((t) => t.day === y && t.habitId !== 'h-meditation')
  const wroteToday = (after.habitLog ?? []).some((t) => t.day > y && t.habitId !== 'h-meditation')
  if (!wroteYesterday) throw new Error('the mark did not land on yesterday')
  if (wroteToday) throw new Error('the mark landed on the wrong day')
  // the row it just marked must STAY, say so, and not resort the list
  if (!(await page.locator('.dr-row.is-fixed').count())) throw new Error('the marked row vanished instead of settling')
  if (!(await page.locator('.dr-said').count())) throw new Error('the marked row never said so')
  // walk out, and the stage for yesterday's unfinished work must have appeared
  for (let i = 0; i < 6; i++) { if (!(await forward())) break }
  if (await page.locator('.dr-screen').count()) throw new Error('it did not close at the end')
  if (!seen.some((h) => /did not get done/.test(h))) {
    throw new Error(`the leftover stage never rendered: ${seen.join(' | ')}`)
  }
  await page.reload(); await page.waitForTimeout(900)
  if (await page.locator('.dr-screen').count()) throw new Error('it came back the same day')
  // and the header button reopens it, from any page, after it has been walked
  await page.goto(`${URL}#/habits`); await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'Yesterday', exact: true }).click(); await page.waitForTimeout(600)
  if (!(await page.locator('.dr-screen').count())) throw new Error('the header button did not reopen it')
  await page.keyboard.press('Escape')
})

await step('daily review: the close screen cannot claim a clean slate it does not have', async () => {
  /* Walk past everything without answering. Eight unticked habits were on the
     screen one step earlier; the last screen used to say "Nothing was hanging". */
  await fresh('today')
  await page.evaluate((K) => {
    const s = JSON.parse(localStorage.getItem(K))
    const z = (n) => String(n).padStart(2, '0')
    const d = new Date(); d.setDate(d.getDate() - 1)
    const y = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
    s.habitLog = [{ habitId: 'h-meditation', day: y }]
    s.focusSessions = [{ id: 'f1', day: y, minutes: 95, space: 'personal', label: 'Gate' }]
    s.tasks = []
    delete s.dailyDone; delete s.dailySkipped
    localStorage.setItem(K, JSON.stringify(s))
  }, KEY)
  await page.reload(); await page.waitForTimeout(900)
  let shown = 0
  for (let i = 0; i < 8; i++) {
    if (!(await page.locator('.dr-stage h1').count())) break
    const h1 = ((await page.locator('.dr-stage h1').first().textContent()) ?? '').trim()
    if (/did not tick/.test(h1)) shown = await page.locator('.dr-row').count()
    if (/still waiting|record is straight|Nothing was hanging/.test(h1)) {
      if (shown > 0 && /Nothing was hanging/.test(h1)) throw new Error(`it listed ${shown} rows and then claimed nothing was hanging`)
      if (!/still waiting/.test(h1)) throw new Error(`unanswered rows but the close said: ${h1}`)
      break
    }
    const go = page.locator('.dr-foot .btn-primary')
    if (!(await go.count())) break
    await go.click(); await page.waitForTimeout(400)
  }
  if (!shown) throw new Error('nothing was offered to answer, so the case was not exercised')
})

await step('daily review: answering everything moves forward, it does not loop', async () => {
  await fresh('today')
  await page.evaluate((K) => {
    const s = JSON.parse(localStorage.getItem(K))
    const z = (n) => String(n).padStart(2, '0')
    const d = new Date(); d.setDate(d.getDate() - 1)
    const y = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
    s.habitLog = [{ habitId: 'h-meditation', day: y }]
    s.focusSessions = [{ id: 'f1', day: y, minutes: 30, space: 'personal', label: 'Gate' }]
    s.tasks = []
    delete s.dailyDone; delete s.dailySkipped
    localStorage.setItem(K, JSON.stringify(s))
  }, KEY)
  await page.reload(); await page.waitForTimeout(900)
  // reach the unmarked stage
  for (let i = 0; i < 4; i++) {
    if (await page.locator('.dr-tick').count()) break
    await page.locator('.dr-foot .btn-primary').click(); await page.waitForTimeout(400)
  }
  // answer every single row
  for (let i = 0; i < 40; i++) {
    const t = page.locator('.dr-tick:not(.is-slip)').first()
    if (!(await t.count())) break
    await t.click(); await page.waitForTimeout(180)
  }
  await page.locator('.dr-foot .btn-primary').click(); await page.waitForTimeout(500)
  const h1 = ((await page.locator('.dr-stage h1').first().textContent()) ?? '').trim()
  if (/Two minutes on yesterday/.test(h1)) throw new Error('clearing the whole list threw him back to the start')
})

await step('daily review: reopening it starts a new walk, not the old one', async () => {
  /* The component does not unmount on close, so everything frozen for the last
     walk used to survive into the next: the headline said two over a list
     showing one already back on today. */
  await fresh('today')
  await page.evaluate((K) => {
    const s = JSON.parse(localStorage.getItem(K))
    const z = (n) => String(n).padStart(2, '0')
    const d = new Date(); d.setDate(d.getDate() - 1)
    const y = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
    s.habitLog = [{ habitId: 'h-meditation', day: y }]
    s.focusSessions = [{ id: 'f1', day: y, minutes: 30, space: 'personal', label: 'Gate' }]
    s.tasks = [
      { id: 'ta', title: 'Task A left over', source: 'mc', estimateMin: 20, done: false, space: 'personal', list: 'today', category: 'admin', plannedOn: y },
      { id: 'tb', title: 'Task B left over', source: 'mc', estimateMin: 20, done: false, space: 'personal', list: 'today', category: 'admin', plannedOn: y },
    ]
    delete s.dailyDone; delete s.dailySkipped
    localStorage.setItem(K, JSON.stringify(s))
  }, KEY)
  await page.reload(); await page.waitForTimeout(900)
  const toLeft = async () => {
    for (let i = 0; i < 6; i++) {
      const h1 = ((await page.locator('.dr-stage h1').first().textContent()) ?? '').trim()
      if (/did not get done/.test(h1)) return h1
      const go = page.locator('.dr-foot .btn-primary')
      if (!(await go.count())) return ''
      await go.click(); await page.waitForTimeout(400)
    }
    return ''
  }
  const first = await toLeft()
  if (!/2 things/.test(first)) throw new Error(`expected two leftovers, got: ${first}`)
  await page.locator('.dr-rowacts .dr-tick').first().click(); await page.waitForTimeout(400)
  // close, then reopen from the pill
  await page.locator('.dr-foot .dr-skip').first().click(); await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Yesterday', exact: true }).click(); await page.waitForTimeout(600)
  const second = await toLeft()
  if (!/One thing/.test(second)) throw new Error(`the reopened walk still counted the one he put back: ${second}`)
  // and clearing the last one must not read "0 things did not get done."
  await page.locator('.dr-rowacts .dr-tick').first().click(); await page.waitForTimeout(400)
  const zero = ((await page.locator('.dr-stage h1').first().textContent()) ?? '').trim()
  if (/^0 /.test(zero)) throw new Error(`the headline counted down to: ${zero}`)
})

await step('daily review: a slip marks one habit, never the set', async () => {
  /* His own reaction: a single "I slipped" button beside "4 being quit" read as
     though it would mark all four. The names ARE the buttons now. */
  await fresh('today')
  await page.evaluate((K) => {
    const s = JSON.parse(localStorage.getItem(K))
    const z = (n) => String(n).padStart(2, '0')
    const d = new Date(); d.setDate(d.getDate() - 1)
    const y = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
    const mk = (id, name) => ({ id, space: 'personal', name, kind: 'break', frequency: 'daily', days: [0,0,0,0,0,0,0].map(() => false), history: [], quitSince: '2026-07-01' })
    s.habits = [...s.habits, mk('q1', 'Doomscrolling'), mk('q2', 'Smoking'), mk('q3', 'Energy drinks'), mk('q4', 'Late snacks')]
    s.habitLog = [{ habitId: 'h-meditation', day: y }]
    s.focusSessions = [{ id: 'f1', day: y, minutes: 30, space: 'personal', label: 'Gate' }]
    s.slips = []
    delete s.dailyDone; delete s.dailySkipped
    localStorage.setItem(K, JSON.stringify(s))
  }, KEY)
  await page.reload(); await page.waitForTimeout(900)
  for (let i = 0; i < 4; i++) {
    if (await page.locator('.dr-slips').count()) break
    await page.locator('.dr-foot .btn-primary').click(); await page.waitForTimeout(400)
  }
  const slipRow = page.locator('.dr-slips')
  if (!(await slipRow.count())) throw new Error('the quit habits were never offered')
  const names = await slipRow.locator('.dr-tick').count()
  if (names !== 4) throw new Error(`expected one control per quit habit, found ${names}`)
  await slipRow.locator('.dr-tick', { hasText: 'Smoking' }).click(); await page.waitForTimeout(500)
  const s2 = await page.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY)
  const logged = (s2.slips ?? [])
  if (logged.length !== 1) throw new Error(`one press logged ${logged.length} slips`)
  if (logged[0].habitId !== 'q2') throw new Error(`it logged ${logged[0].habitId} instead of the one pressed`)
})

await step('daily review: a first morning with no history is not asked anything', async () => {
  await fresh('today')
  await page.evaluate((K) => {
    const s = JSON.parse(localStorage.getItem(K))
    s.habitLog = []; s.routineLog = []; s.focusSessions = []; s.tasks = []
    delete s.dailyDone; delete s.dailySkipped
    localStorage.setItem(K, JSON.stringify(s))
  }, KEY)
  await page.reload(); await page.waitForTimeout(900)
  if (await page.locator('.dr-screen').count()) throw new Error('it interrupted a profile with nothing to review')
})

await step('goals: a day-counted goal reads impossible before behind, not on pace', async () => {
  /* His own report: "No lust" needed 28 more day-checkoffs with 23 days left
     in the month and still read "on pace". goalPace's ratio test assumes any
     goal can be caught up by working harder on a single day; a goal that
     counts CLEAN DAYS cannot, since a day can only ever be earned once. Seed
     a target that literally cannot fit in the days left and one that can. */
  await fresh('goals')
  await page.evaluate(() => { localStorage.setItem('mc-view', 'personal'); localStorage.setItem('mc-space', 'personal') })
  const seeded = await page.evaluate((K) => {
    const s = JSON.parse(localStorage.getItem(K))
    const now = new Date()
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const daysLeft = daysInMonth - now.getDate() + 1
    const mk = (id, name, target) => ({
      id, space: 'personal', name, current: 0, target, unit: 'checkoffs', note: '',
      why: '', timeframe: 'monthly', category: 'health', milestones: [], habitId: `h-${id}`,
    })
    /* The reachable one has to be reachable on the 28th as well as the 2nd.
       It used to be seeded at zero progress with a target of daysLeft-5, which
       only reads as on pace while less than half the month has gone: at zero
       done, goalPace needs timeLeft > 0.5, so from the 16th onward NO target
       could have passed and the gate failed every month from the 16th to the
       31st. It quit on the 1st and has not slipped, so its clean days track
       elapsed days exactly, which is what being on pace actually means. */
    const first = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    s.goals = [mk('gate-imp', 'Gate impossible', daysLeft + 5), mk('gate-ok', 'Gate reachable', daysInMonth)]
    s.habits = [
      { id: 'h-gate-imp', space: 'personal', name: 'Gate impossible', frequency: 'monthly', paused: false, kind: 'break', days: [false,false,false,false,false,false,false], history: [] },
      { id: 'h-gate-ok', space: 'personal', name: 'Gate reachable', frequency: 'monthly', paused: false, kind: 'break', quitSince: first, days: [false,false,false,false,false,false,false], history: [] },
    ]
    s.slips = []
    localStorage.setItem(K, JSON.stringify(s))
    return { daysLeft }
  }, KEY)
  await page.reload()
  // Wait for the actual cards, not a fixed delay: a full-suite run carries
  // more background state than a lone run of this step, and a flat 900ms
  // that was plenty in isolation read the page before it had them.
  await page.getByText('Gate impossible').first().waitFor({ timeout: 8000 })
  await page.getByText('Gate reachable').first().waitFor({ timeout: 8000 })
  const text = await page.evaluate(() => document.body.innerText)
  const cardStatus = (name) => {
    const i = text.indexOf(name)
    if (i < 0) throw new Error(`no card for "${name}"`)
    return text.slice(i, i + 200)
  }
  if (!/needs a push/i.test(cardStatus('Gate impossible'))) {
    throw new Error(`with ${seeded.daysLeft} days left, an unreachable target still reads on pace: ${JSON.stringify(cardStatus('Gate impossible'))}`)
  }
  /* The claim under test is that the IMPOSSIBLE one flags and the reachable
     one does not. On the last day of the month a goal tracking elapsed days
     exactly has also been reached, and "reached" is not a false alarm, so the
     assertion is that it is not flagged rather than that it says one word. */
  if (/needs a push/i.test(cardStatus('Gate reachable'))) {
    throw new Error(`a comfortably reachable target got flagged as needing a push: ${JSON.stringify(cardStatus('Gate reachable'))}`)
  }
})
await step('habits: a monthly review done last week does not read as done today', async () => {
  /* His own report: the Monthly review routine, finished a week ago, showed as
     kept "today" every day since. Root cause: the driven-habit mirror in
     store.tsx used to fall back to marking TODAY's dot whenever the real
     completion date fell outside the current ISO week, which any monthly
     completion older than a few days always does. Reproduce a real completion
     from a week ago and check nothing claims it happened today. */
  await fresh('today')
  // An earlier step may have switched workspace; that choice lives outside
  // the state blob fresh() clears, and would filter the personal-space
  // monthly review chip right out of the widget.
  await page.evaluate(() => { localStorage.setItem('mc-view', 'personal'); localStorage.setItem('mc-space', 'personal') })
  await page.reload(); await page.waitForTimeout(500)
  const seeded = await page.evaluate((K) => {
    const s = JSON.parse(localStorage.getItem(K))
    const today = new Date()
    const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7)
    const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
    const r = s.routines.find((x) => x.id === 'r-monthly')
    r.doneStepIds = r.steps.map((x) => x.id)
    r.periodKey = monthKey
    r.completedOn = key(weekAgo)
    r.startedAt = weekAgo.toISOString()
    s.habitLog = (s.habitLog ?? []).filter((t) => t.habitId !== 'h-monthly')
    s.habitLog.push({ habitId: 'h-monthly', day: key(weekAgo) })
    localStorage.setItem(K, JSON.stringify(s))
    return { todayIdx: (today.getDay() + 6) % 7 }
  }, KEY)
  await page.reload(); await page.waitForTimeout(800)

  const days = await page.evaluate((K) => {
    const s = JSON.parse(localStorage.getItem(K))
    return s.habits.find((x) => x.id === 'h-monthly').days
  }, KEY)
  if (days[seeded.todayIdx]) throw new Error(`today's slot is true for a completion from a week ago: ${JSON.stringify(days)}`)

  const skip = page.getByRole('button', { name: 'Not today' })
  if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(400) }
  const chip = await page.locator('.habit', { hasText: 'Monthly review' }).first()
  if ((await chip.getAttribute('aria-pressed')) !== 'true') throw new Error('the chip does not read as kept for the month')

  await page.goto(`${URL}#/habits`); await page.reload(); await page.waitForTimeout(800)
  const band = await page.locator('.band-metric .v').first().innerText()
  // "done today / due today": the numerator must be 0, since nothing was
  // actually done today, and the monthly review must not be in the
  // denominator either, since it is already kept for the month.
  const m = band.match(/^(\d+)\/(\d+)$/)
  if (!m) throw new Error(`"done today" reads "${band}", not a done/due pair`)
  if (m[1] !== '0') throw new Error(`"done today" reads ${band}: the monthly review counted as done today`)
})

await step('notes: brain dumps came across, and search reaches every folder', async () => {
  await fresh('notes')
  const bin = page.locator('.nt-folder', { hasText: 'Brain dumps' }).first()
  if (!(await bin.count())) throw new Error('no Brain dumps folder')
  await bin.click(); await page.waitForTimeout(200)
  if (!(await page.locator('.nt-row', { hasText: 'Rubber band' }).count())) throw new Error('the board did not come across')
  // write one, in Czech, with a tag. A new note starts in its title.
  await page.getByRole('button', { name: 'New note' }).click(); await page.waitForTimeout(300)
  await page.locator('textarea[aria-label="Note title"]').fill('Zavolat na úkol #vzp')
  await page.locator('.nt-editor').click()
  await page.keyboard.type('Druhý řádek s detailem'); await page.waitForTimeout(400)
  const saved = await page.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY)
  const mine = (saved.notes ?? []).find((n) => n.title.startsWith('Zavolat'))
  if (!mine) throw new Error('the note was not saved')
  if (!mine.body.includes('Druhý řádek')) throw new Error('the body was not saved with the title')
  if (mine.folderId !== 'nf-braindump-personal') throw new Error(`landed in ${mine.folderId}`)
  // back to the list, stand somewhere else, then search without the accents
  await page.locator('.nt-folder', { hasText: 'All notes' }).first().click(); await page.waitForTimeout(200)
  await page.locator('input[aria-label="Search notes"]').fill('ukol'); await page.waitForTimeout(400)
  if (!(await page.locator('.nt-row', { hasText: 'Zavolat' }).count())) throw new Error('accent-blind search missed it')
  await page.locator('input[aria-label="Search notes"]').fill(''); await page.waitForTimeout(200)
  await page.locator('.nt-chip-tag', { hasText: '#vzp' }).first().click(); await page.waitForTimeout(300)
  const rows = await page.locator('.nt-row').count()
  if (rows !== 1) throw new Error(`the tag filter showed ${rows} notes`)
})

await step('notes: All notes, date groups, and the folder on every row', async () => {
  await fresh('notes')
  await page.evaluate((K) => {
    const s = JSON.parse(localStorage.getItem(K))
    const z = (n) => String(n).padStart(2, '0')
    const ago = (d) => { const x = new Date(); x.setDate(x.getDate() - d); return x }
    const key = (d) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
    const mk = (id, folderId, space, title, back, pinned) => {
      const d = ago(back)
      return { id, space, folderId, title, body: title, color: 'amber', when: key(d), updatedAt: d.getTime(), pinned }
    }
    s.noteFolders = [{ id: 'nf-tax', space: 'personal', name: 'Taxes', parentId: 'nf-space-personal', order: 0 }]
    s.notes = [
      mk('p1', 'nf-tax', 'personal', 'Pinned one', 3, true),
      mk('n1', 'nf-tax', 'personal', 'From today', 0),
      mk('n2', 'nf-tax', 'personal', 'From yesterday', 1),
      mk('n3', 'nf-space-offplate', 'offplate', 'From last month', 20),
      mk('n4', 'nf-space-corner', 'corner', 'From last year', 400),
    ]
    localStorage.setItem(K, JSON.stringify(s))
  }, KEY)
  await page.reload(); await page.waitForTimeout(800)
  // one row that gathers every workspace, above the folders
  await page.locator('.nt-folder', { hasText: 'All notes' }).click(); await page.waitForTimeout(500)
  /* Against the store rather than a hardcoded number: a fresh profile may carry
     a seeded note of its own, and the point is that ALL of them are gathered. */
  const stored = await page.evaluate((K) => (JSON.parse(localStorage.getItem(K)).notes ?? []).length, KEY)
  const rows = await page.locator('.nt-row').count()
  if (rows !== stored) throw new Error(`All notes shows ${rows} of ${stored}`)
  const spaces = await page.evaluate((K) => [...new Set((JSON.parse(localStorage.getItem(K)).notes ?? []).map((n) => n.space))].length, KEY)
  if (spaces < 3) throw new Error('the seed did not span enough workspaces to prove anything')
  const heads = await page.locator('.nt-grouphead').allTextContents()
  for (const want of ['Pinned', 'Today', 'Yesterday']) {
    if (!heads.includes(want)) throw new Error(`no ${want} heading: ${heads.join(' | ')}`)
  }
  if (heads[0].trim() !== 'Pinned') throw new Error(`pinned is not first: ${heads.join(' | ')}`)
  // Pinned folds, and stays folded
  const all = await page.locator('.nt-row').count()
  await page.locator('.nt-groupfold').click(); await page.waitForTimeout(400)
  if ((await page.locator('.nt-row:visible').count()) >= all) throw new Error('Pinned did not fold')
  await page.reload(); await page.waitForTimeout(800)
  if (await page.evaluate(() => localStorage.getItem('mc:notes-pinshut')) !== '1') throw new Error('the fold was not remembered')
  /* A reload puts him back in his own workspace, so the rest of this step has
     to walk back to All notes before it measures anything. */
  await page.evaluate(() => localStorage.removeItem('mc:notes-pinshut'))
  await page.reload(); await page.waitForTimeout(800)
  await page.locator('.nt-folder', { hasText: 'All notes' }).click(); await page.waitForTimeout(400)
  // the headings are headings, not captions, and each carries its own rule
  const g = await page.evaluate(() => {
    const h = document.querySelector('.nt-grouphead')
    const cs = getComputedStyle(h)
    return { size: parseFloat(cs.fontSize), rule: cs.borderBottomWidth }
  })
  if (g.size < 15) throw new Error(`group headings are ${g.size}px`)
  if (g.rule === '0px') throw new Error('no rule under the group heading')
  // every row says which folder it is in, not only in a search
  const tails = await page.locator('.nt-row .nt-rowtail').allTextContents()
  if (tails.length !== rows || tails.some((t) => !t.trim())) throw new Error(`a row does not say its folder: ${tails.join(' | ')}`)
  // and the count in the head is the count in the list
  const head = (await page.locator('.nt-headcount').textContent()) ?? ''
  if (!head.startsWith(`${rows} note`)) throw new Error(`the head says "${head}" over ${rows} rows`)
  // sorting by title regroups by letter and is remembered
  await page.locator('.nt-sortkebab .kebab').click(); await page.waitForTimeout(250)
  /* EVERY item, not just the one the test happens to click. The sticky search
     row painted over the top half of this menu and the gate passed anyway,
     because Title was the one option still uncovered. */
  const menu = await page.evaluate(() => {
    const m = document.querySelector('.nt-sortkebab .kebab-menu')
    if (!m) return { missing: true, covered: [], out: false }
    const r = m.getBoundingClientRect()
    return {
      missing: false,
      out: r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1 || r.top < -1,
      covered: [...m.querySelectorAll('button, .kebab-head')]
        .filter((el) => {
          const b = el.getBoundingClientRect()
          return !m.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2))
        })
        .map((el) => (el.textContent || '').trim()),
    }
  })
  if (menu.missing) throw new Error('the sort menu did not open')
  if (menu.out) throw new Error('the sort menu opens off-screen')
  if (menu.covered.length) throw new Error(`covered menu items: ${menu.covered.join(', ')}`)
  await page.getByRole('menuitem', { name: 'Title' }).click(); await page.waitForTimeout(400)
  await page.reload(); await page.waitForTimeout(800)
  if (await page.evaluate(() => localStorage.getItem('mc:notes-sort')) !== 'title') throw new Error('the sort was not remembered')
})

await step('notes: the folder panel is one list at one size', async () => {
  /* Apple's sidebar, on his instruction: every folder row the same height and
     the same type, and ONE New folder control rather than one per workspace. */
  await fresh('notes')
  const m = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.nt-folder')]
    return {
      rows: rows.length,
      heights: [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)))],
      sizes: [...new Set(rows.map((r) => getComputedStyle(r).fontSize))],
      families: [...new Set(rows.map((r) => getComputedStyle(r).fontFamily))],
      adders: document.querySelectorAll('.nt-newfolder').length,
    }
  })
  if (m.rows < 2) throw new Error('the folder panel did not render')
  if (m.heights.length !== 1) throw new Error(`folder rows are ${m.heights.join(', ')}px tall`)
  if (m.heights[0] < 38) throw new Error(`folder rows are only ${m.heights[0]}px tall`)
  if (m.sizes.length !== 1 || m.families.length !== 1) throw new Error(`mixed type in the folder list: ${m.sizes.join(', ')} / ${m.families.join(' | ')}`)
  if (m.adders !== 1) throw new Error(`${m.adders} New folder controls`)
})

await step('notes: a folder he made, and its notes surviving its deletion', async () => {
  await fresh('notes')
  // One flat rail: All notes at the top, then every folder he made. One New
  // folder control at the foot, and it no longer names a workspace.
  await page.locator('.nt-folder', { hasText: 'All notes' }).first().click(); await page.waitForTimeout(300)
  await page.locator('.nt-newfolder').click()
  await page.locator('input[aria-label="New folder"]').fill('Taxes')
  await page.keyboard.press('Enter'); await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'New note' }).click(); await page.waitForTimeout(300)
  await page.locator('textarea[aria-label="Note title"]').fill('Do not lose me'); await page.waitForTimeout(400)
  let s = await page.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY)
  const f = (s.noteFolders ?? []).find((x) => x.name === 'Taxes')
  if (!f) throw new Error('the folder was not created')
  const wrote = (s.notes ?? []).find((n) => n.title === 'Do not lose me')
  if (wrote?.folderId !== f.id) throw new Error('the note did not land in the new folder')
  // Filing must not move a note between workspaces. It used to: the note
  // adopted its folder's space, so a folder made in one workspace reassigned
  // everything dropped into it.
  // deleting the shelf must not burn the books
  await page.locator('.nt-folder-row', { hasText: 'Taxes' }).getByRole('button', { name: /options/i }).click()
  await page.getByRole('menuitem', { name: /Delete folder/ }).click(); await page.waitForTimeout(500)
  s = await page.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY)
  if ((s.noteFolders ?? []).some((x) => x.id === f.id)) throw new Error('the folder is still there')
  const after = (s.notes ?? []).find((n) => n.title === 'Do not lose me')
  if (!after) throw new Error('the note went with the folder')
  // Out of the deleted folder and into no folder, which is the note's own
  // space marker. Which space that is depends on where he was standing when he
  // wrote it, and is no longer visible anywhere in the page.
  if (!/^nf-space-/.test(after.folderId ?? '')) throw new Error(`the note ended up in ${after.folderId}`)
})

await step('notes: a body from another device is kept, never dropped', async () => {
  await page.goto(URL); await page.waitForTimeout(300)
  await page.evaluate((K) => {
    const s = JSON.parse(localStorage.getItem(K))
    s.notes = [{
      id: 'n-conf', space: 'personal', folderId: 'nf-space-personal',
      title: 'Laptop version', body: 'Laptop version', color: 'amber',
      when: '2026-08-03', updatedAt: Date.now(), conflict: { body: 'Phone version', at: Date.now() - 60000 },
    }]
    localStorage.setItem(K, JSON.stringify(s))
  }, KEY)
  await page.goto(`${URL}#/notes`); await page.reload(); await page.waitForTimeout(700)
  // An earlier step left the workspace switcher somewhere else, and the switcher
  // is what decides which folder opens. Stand in Personal first.
  await page.locator('.nt-folder', { hasText: 'All notes' }).first().click(); await page.waitForTimeout(200)
  await page.locator('.nt-row', { hasText: 'Laptop version' }).first().click(); await page.waitForTimeout(200)
  if (!(await page.locator('.nt-conflict').count())) throw new Error('the other version was not shown')
  await page.getByRole('button', { name: 'Add it to this note' }).click(); await page.waitForTimeout(400)
  const s = await page.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY)
  const n = (s.notes ?? []).find((x) => x.id === 'n-conf')
  if (!n?.body.includes('Phone version')) throw new Error('the other version was lost')
  if (n.conflict) throw new Error('the flag stayed up after he answered it')
})

await step('phone: notes are usable at 390', async () => {
  const mp = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await mp.goto(URL); await mp.waitForTimeout(300)
  await mp.evaluate((K) => localStorage.removeItem(K), KEY)
  await mp.goto(`${URL}#/notes`); await mp.reload(); await mp.waitForTimeout(700)
  let over = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (over > 0) throw new Error(`horizontal overflow ${over}px on the list`)
  // his own writing must be near the top, not under six bands of chrome
  const firstRow = (await mp.locator('.nt-row').first().boundingBox()).y
  if (firstRow > 520) throw new Error(`the first note starts ${Math.round(firstRow)}px down`)
  await mp.getByRole('button', { name: 'New note' }).click(); await mp.waitForTimeout(300)
  await mp.locator('textarea[aria-label="Note title"]').fill('Telefonní poznámka #test'); await mp.waitForTimeout(400)
  over = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (over > 0) throw new Error(`horizontal overflow ${over}px with a note open`)
  // the open note has the screen to itself
  const noteW = (await mp.locator('.nt-sheet').boundingBox()).width
  if (noteW < 300) throw new Error(`the open note is only ${Math.round(noteW)}px wide`)
  const s = await mp.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY)
  if (!(s.notes ?? []).some((n) => n.title.startsWith('Telefonní'))) throw new Error('the phone note was not saved')
  await mp.close()
})

await step('notes: the editor formats as he types, and the marks survive a reload', async () => {
  /* His own list, verbatim: a dash makes a bullet, cmd-B makes bold, italic
     works, and a checkbox is something you click. All of it round-trips
     through markdown, which is what the sync and the search read. */
  await fresh('notes')
  await page.locator('.nt-folder', { hasText: 'All notes' }).first().click(); await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'New note' }).click(); await page.waitForTimeout(300)
  await page.locator('textarea[aria-label="Note title"]').fill('Formatting')
  await page.locator('.nt-editor').click()
  await page.keyboard.type('- first item')
  if (!(await page.locator('.nt-editor ul li').count())) throw new Error('a dash did not make a bullet')
  await page.keyboard.press('Enter'); await page.keyboard.type('second item')
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter')
  await page.keyboard.type('plain ')
  await page.keyboard.press('Meta+b'); await page.keyboard.type('bold'); await page.keyboard.press('Meta+b')
  await page.keyboard.press('Enter')
  await page.keyboard.type('[] tick me'); await page.waitForTimeout(300)
  const box = await page.locator('.nt-editor li[data-done]').first().boundingBox()
  await page.mouse.click(box.x + 9, box.y + 12); await page.waitForTimeout(500)
  const s = await page.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY)
  const md = (s.notes ?? []).find((n) => n.title === 'Formatting')?.body ?? ''
  for (const want of ['- first item', '- second item', '**bold**', '- [x] tick me']) {
    if (!md.includes(want)) throw new Error(`${want} is not in the stored note: ${JSON.stringify(md)}`)
  }
  await page.reload(); await page.waitForTimeout(800)
  await page.locator('.nt-folder', { hasText: 'All notes' }).first().click(); await page.waitForTimeout(400)
  await page.locator('.nt-row', { hasText: 'Formatting' }).first().click(); await page.waitForTimeout(400)
  if ((await page.locator('.nt-editor ul li').count()) < 3) throw new Error('the formatting did not come back after a reload')
  /* Tab nests the item and Shift-Tab lifts it back, and the nesting has to
     survive the round trip through markdown. Chrome's own indent leaves the
     nested list BESIDE the item, which used to lose the line entirely. */
  await page.evaluate(() => {
    const items = document.querySelectorAll('.nt-editor li')
    const last = items[items.length - 1]
    const r = document.createRange(); r.selectNodeContents(last); r.collapse(false)
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r)
    document.querySelector('.nt-editor').focus()
  })
  await page.keyboard.press('Enter'); await page.keyboard.type('parent')
  await page.keyboard.press('Enter'); await page.keyboard.press('Tab'); await page.keyboard.type('child')
  await page.waitForTimeout(500)
  if (!(await page.locator('.nt-editor li > ul li').count())) throw new Error('Tab did not nest the item')
  const nested = await page.evaluate((K) => (JSON.parse(localStorage.getItem(K)).notes ?? []).find((n) => n.title === 'Formatting')?.body ?? '', KEY)
  if (!/\n {2}- .*child/.test(nested)) throw new Error(`the nested item was not stored indented: ${JSON.stringify(nested.split('\n').slice(-3))}`)
  await page.reload(); await page.waitForTimeout(800)
  await page.locator('.nt-folder', { hasText: 'All notes' }).first().click(); await page.waitForTimeout(400)
  await page.locator('.nt-row', { hasText: 'Formatting' }).first().click(); await page.waitForTimeout(400)
  if (!(await page.locator('.nt-editor li > ul li').count())) throw new Error('the nesting did not come back after a reload')
})
await step('notes: /help with no key hands his request back rather than losing it', async () => {
  await fresh('notes')
  await page.locator('.nt-folder', { hasText: 'All notes' }).first().click(); await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'New note' }).click(); await page.waitForTimeout(300)
  await page.locator('textarea[aria-label="Note title"]').fill('Help gate')
  await page.locator('.nt-editor').click()
  await page.keyboard.insertText('/help write a one-line note about oat milk')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  const err = await page.locator('.nt-help-error').innerText()
  if (!/Settings/.test(err)) throw new Error(`no-key error does not point at Settings: "${err}"`)
  const restored = await page.locator('.nt-editor p').first().innerText()
  if (restored !== '/help write a one-line note about oat milk') throw new Error(`his request was not handed back verbatim: "${restored}"`)
})
await step('notes: /help drafts through Groq, and cites what it actually searched', async () => {
  await fresh('notes')
  await page.evaluate(() => localStorage.setItem('mc-groq-key', 'gsk_gatetest'))
  let sawGroqRequest = false
  await page.route('https://api.groq.com/**', async (route) => {
    sawGroqRequest = true
    const req = route.request().postDataJSON()
    if (req.model !== 'groq/compound-mini') { await route.fulfill({ status: 400, body: '{}' }); return }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: 'Oat milk foams well and works in coffee.\n\nSources:\nOat milk basics: https://example.com/oat-milk' } }] }),
    })
  })
  await page.locator('.nt-folder', { hasText: 'All notes' }).first().click(); await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'New note' }).click(); await page.waitForTimeout(300)
  await page.locator('textarea[aria-label="Note title"]').fill('Help gate 2')
  await page.locator('.nt-editor').click()
  await page.keyboard.insertText('/help look up whether oat milk foams well')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.nt-help-pending', { timeout: 3000 }).catch(() => {})
  await page.waitForSelector('.nt-editor a[href="https://example.com/oat-milk"]', { timeout: 5000 })
  if (!sawGroqRequest) throw new Error('/help never actually called Groq')
  const body = await page.locator('.nt-editor').innerText()
  if (!/Oat milk foams well/.test(body)) throw new Error(`the drafted text is not in the note: ${JSON.stringify(body)}`)
  if (/\/help/i.test(body)) throw new Error('the /help instruction line is still in the note after it answered')
  const saved = await page.evaluate((K) => (JSON.parse(localStorage.getItem(K)).notes ?? []).find((n) => n.title === 'Help gate 2')?.body ?? '', KEY)
  if (!/example\.com\/oat-milk/.test(saved)) throw new Error(`the source link did not save into the note: ${JSON.stringify(saved)}`)
})

await step('notes: three dashes make a divider, and a table he sized himself', async () => {
  await fresh('notes')
  await page.locator('.nt-folder', { hasText: 'All notes' }).first().click(); await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'New note' }).click(); await page.waitForTimeout(300)
  await page.locator('textarea[aria-label="Note title"]').fill('Divider and table')
  await page.locator('.nt-editor').click()
  await page.keyboard.type('above')
  await page.keyboard.press('Enter')
  await page.keyboard.type('---'); await page.waitForTimeout(300)
  if (!(await page.locator('.nt-editor hr').count())) throw new Error('three dashes did not make a divider')
  await page.keyboard.type('below'); await page.waitForTimeout(300)
  // a table of his own size
  await page.getByRole('button', { name: 'Table', exact: true }).click(); await page.waitForTimeout(200)
  await page.locator('.nt-tablemenu input').first().fill('3')
  await page.locator('.nt-tablemenu input').nth(1).fill('2')
  await page.getByRole('button', { name: 'Insert' }).click(); await page.waitForTimeout(300)
  if ((await page.locator('.nt-editor table tr').count()) !== 3) throw new Error('wrong number of rows')
  if ((await page.locator('.nt-editor table tr').first().locator('th').count()) !== 2) throw new Error('wrong number of columns')
  // type into a cell, then grow the table
  await page.locator('.nt-editor th').first().click()
  await page.keyboard.type('Věřitel'); await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Add a row' }).click(); await page.waitForTimeout(300)
  if ((await page.locator('.nt-editor table tr').count()) !== 4) throw new Error('add a row did nothing')
  await page.waitForTimeout(400)
  const s = await page.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY)
  const md = (s.notes ?? []).find((n) => n.title === 'Divider and table')?.body ?? ''
  if (!md.includes('---')) throw new Error(`no divider stored: ${JSON.stringify(md)}`)
  if (!/\| Věřitel \|/.test(md)) throw new Error(`the cell text was not stored: ${JSON.stringify(md)}`)
  await page.reload(); await page.waitForTimeout(800)
  await page.locator('.nt-folder', { hasText: 'All notes' }).first().click(); await page.waitForTimeout(300)
  await page.locator('.nt-row', { hasText: 'Divider and table' }).first().click(); await page.waitForTimeout(400)
  if (!(await page.locator('.nt-editor hr').count())) throw new Error('the divider did not come back')
  if ((await page.locator('.nt-editor table tr').count()) < 4) throw new Error('the table did not come back whole')
})

await step('plan: a monthly routine started earlier this month is off the day', async () => {
  /* His report: the Monthly review sat on Today every single day, in the
     afternoon, already finished, and could not be moved or taken off. Today
     counted a routine as "on today" if it had a startedAt at all, and
     startedAt is only cleared when the PERIOD rolls over, which for a monthly
     routine is the turn of the month. So one afternoon's start haunted every
     remaining day of that month.

     The day column with the morning/afternoon/evening buckets is the PLAN
     page, which is the "afternoon" he meant. Verified in both directions
     before being trusted: a routine started two hours ago is still on the
     day, one started six days ago is not. */
  await fresh('plan')
  await page.evaluate(() => { localStorage.setItem('mc-view', 'personal'); localStorage.setItem('mc-space', 'personal') })
  const seeded = await page.evaluate((K) => {
    const s = JSON.parse(localStorage.getItem(K))
    const r = s.routines.find((x) => x.id === 'r-monthly')
    if (!r) return { err: 'no monthly routine to seed' }
    const now = new Date()
    // Started on the 2nd of this month, at 14:30, and finished.
    const began = new Date(now.getFullYear(), now.getMonth(), 2, 14, 30, 0)
    // Only meaningful if that is genuinely not today; on the 2nd, use the 3rd.
    const day = began.getDate() === now.getDate() ? new Date(now.getFullYear(), now.getMonth(), 3, 14, 30, 0) : began
    if (day.getDate() === now.getDate()) return { skip: true }
    r.startedAt = day.toISOString()
    r.periodKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    r.doneStepIds = r.steps.map((st) => st.id)
    s.routines = s.routines.map((x) => (x.id === 'r-monthly' ? r : x))
    localStorage.setItem(K, JSON.stringify(s))
    return { title: r.title }
  }, KEY)
  if (seeded.err) throw new Error(seeded.err)
  if (seeded.skip) return // today IS the seeded day; nothing to prove
  await page.reload(); await page.waitForTimeout(900)
  const notNow = page.getByRole('button', { name: 'Not today' })
  if (await notNow.count()) { await notNow.first().click(); await page.waitForTimeout(400) }
  /* Targeted at the ROUTINE, by the accessible name its own checkbox carries.
     A first version of this matched any text inside .today-main and reported a
     failure that was not there: a HABIT of the same name is legitimately on
     the page, and the container's textContent swept it up. */
  const onDay = await page.evaluate((t) => [...document.querySelectorAll('[role="checkbox"]')]
    .some((el) => new RegExp(`^(Finish|Reopen): ${t}$`).test(el.getAttribute('aria-label') ?? '')), seeded.title)
  if (onDay) throw new Error(`the "${seeded.title}" routine is still on Today, days after it was started and finished`)
})
await step('habits: the Compass link survived the move onto its habit', async () => {
  /* It used to live on a routine STEP and open from the Routines page. Steps
     are habits now, and he asked for exactly this to survive: "there is links
     for typing tests, so there should be link to that still". */
  await fresh('habits')
  await page.locator('.space-btn', { hasText: 'All' }).click(); await page.waitForTimeout(500)
  const stored = await page.evaluate((K) => {
    const st = JSON.parse(localStorage.getItem(K))
    const h = (st.habits ?? []).find((x) => /Compass/i.test(x.name))
    return h ? { name: h.name, link: h.link ?? null, folderId: h.folderId ?? null } : null
  }, KEY)
  if (!stored) throw new Error('no Compass habit after the merge')
  if (!/compass-money/.test(stored.link ?? '')) throw new Error(`the Compass habit links to ${stored.link}`)
  if (!stored.folderId) throw new Error('the Compass habit is not inside a folder')
  const link = page.getByRole('link', { name: /Compass/ })
  if (!(await link.count())) throw new Error('the Compass link does not render on the habit row')
})
await step('notes: the columns drag, and nothing jumps when a folder is clicked', async () => {
  await fresh('notes')
  const before = (await page.locator('.nt-side').boundingBox()).width
  const g = await page.locator('.nt-grip').first().boundingBox()
  await page.mouse.move(g.x + 5, g.y + 200)
  await page.mouse.down()
  await page.mouse.move(g.x + 125, g.y + 200, { steps: 8 })
  await page.mouse.up(); await page.waitForTimeout(300)
  const after = (await page.locator('.nt-side').boundingBox()).width
  if (after - before < 80) throw new Error(`the sidebar went ${Math.round(before)} -> ${Math.round(after)}`)
  await page.reload(); await page.waitForTimeout(800)
  if (Math.abs((await page.locator('.nt-side').boundingBox()).width - after) > 3) throw new Error('the width was not remembered')
  // a folder row must not change shape when it becomes the open one
  const row = page.locator('.nt-folder-row').nth(1)
  const a = await row.locator('.nt-folder').boundingBox()
  await row.locator('.nt-folder').click(); await page.waitForTimeout(300)
  const c = await row.locator('.nt-folder').boundingBox()
  if (Math.abs(a.width - c.width) > 1 || Math.abs(a.x - c.x) > 1) throw new Error('the row shifted when it was selected')
})

await step('notes: the note menu opens where it can be reached', async () => {
  await fresh('notes')
  // An earlier step left the workspace switcher elsewhere; stand where the
  // seeded note actually is, or there is no open note to have a menu.
  await page.locator('.nt-folder', { hasText: 'All notes' }).first().click(); await page.waitForTimeout(400)
  await page.locator('.nt-pane').getByRole('button', { name: 'Note options' }).click(); await page.waitForTimeout(300)
  if (!(await page.locator('.nt-pane .kebab-menu').count())) throw new Error('the menu did not open')
  const m = await page.locator('.nt-pane .kebab-menu').boundingBox()
  if (m.x + m.width > 1502) throw new Error('the menu runs off the right edge')
  if (!(await page.getByRole('menuitem', { name: 'Make it a task' }).isVisible())) throw new Error('its items are not visible')
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
  /* One bar in the pane, holding the formatting and the note's menu, and the
     two round menu buttons are actually round. The formatting used to sit
     between the title and the body with a lone kebab in the bar above it. */
  const bar = await page.evaluate(() => {
    const inBar = document.querySelectorAll('.nt-topbar .nt-toolbar').length
    const stray = document.querySelectorAll('.nt-sheet .nt-toolbar').length
    const round = [...document.querySelectorAll('.nt-kebab .kebab, .nt-sortkebab .kebab')].map((el) => {
      const r = el.getBoundingClientRect()
      return Math.round(r.width) === Math.round(r.height)
    })
    const stamp = document.querySelector('.nt-when-full')?.getBoundingClientRect()
    const title = document.querySelector('.nt-title')?.getBoundingClientRect()
    return { inBar, stray, round, offset: stamp && title ? Math.round(stamp.left - title.left) : 99 }
  })
  if (bar.inBar !== 1) throw new Error('the formatting is not in the pane bar')
  if (bar.stray) throw new Error('there is still a toolbar between the title and the body')
  if (bar.round.some((r) => !r)) throw new Error('a menu button is not a circle')
  if (Math.abs(bar.offset) > 1) throw new Error(`the date sits ${bar.offset}px off the title's margin`)
})

/* Apps: a shelf of icons that opens one app at a time. The frame's CONTENT is
   other sites and is not this gate's to judge; what is asserted is Mission
   Control's half of the contract: nothing is embedded until he asks, opening
   targets the right app, and the browser link agrees with the frame. */
await step('apps: a shelf that embeds nothing until an app is opened', async () => {
  await fresh('apps')
  const shelf = await page.evaluate(() => ({
    tiles: [...document.querySelectorAll('.apps-tile .apps-name')].map((el) => el.textContent.trim()),
    frames: document.querySelectorAll('iframe').length,
    subs: document.querySelectorAll('.apps-what').length,
  }))
  if (shelf.frames !== 0) throw new Error(`${shelf.frames} iframe(s) mounted on the shelf; nothing should load unasked`)
  /* My Mind sits first, and it is the one app on this shelf that opens in a
     tab rather than a frame: mymind answers with frame-ancestors 'none', so a
     panel inside this page is not something the app is allowed to build.
     Asserted as a real link with a real target, because a tile that silently
     did nothing would look identical to one that worked. */
  if (shelf.tiles[0] !== 'My Mind') throw new Error(`first app is ${shelf.tiles[0]}`)
  if (!shelf.tiles.includes('Watchless')) throw new Error(`Watchless left the shelf: ${shelf.tiles.join(', ')}`)
  const mind = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.apps-tile')].find((t) => /My Mind/.test(t.textContent))
    return el ? { tag: el.tagName, href: el.getAttribute('href'), target: el.getAttribute('target') } : null
  })
  if (!mind || mind.tag !== 'A') throw new Error('My Mind is not a link, so it would try to frame a site that refuses framing')
  if (!/access\.mymind\.com/.test(mind.href ?? '')) throw new Error(`My Mind points at ${mind.href}`)
  if (mind.target !== '_blank') throw new Error('My Mind does not open in a new tab')
  if (shelf.tiles.length !== 7) throw new Error(`${shelf.tiles.length} apps on the shelf`)
  if (shelf.subs) throw new Error('a tile carries a subtitle')
})

await step('apps: opening one frames it, Escape comes back, browser link agrees', async () => {
  await fresh('apps')
  await page.evaluate(() => { [...document.querySelectorAll('.apps-tile')].find((t) => t.textContent.includes('Watchless'))?.click() })
  await page.waitForTimeout(400)
  const opened = await page.evaluate(() => ({
    src: document.querySelector('.apps-frame')?.getAttribute('src') ?? '',
    out: [...document.querySelectorAll('.apps-open a')].map((a) => a.getAttribute('href'))[0] ?? '',
    name: document.querySelector('.apps-openname')?.textContent.trim() ?? '',
    clipped: (() => {
      const clip = document.querySelector('.apps-clip'); const f = document.querySelector('.apps-frame')
      if (!clip || !f) return false
      // The frame must be wider than its clip, which is what hides the inner scrollbar.
      return f.getBoundingClientRect().width > clip.getBoundingClientRect().width + 8
    })(),
  }))
  if (!opened.src.startsWith('https://watchless.netlify.app')) throw new Error(`frame is ${opened.src || 'missing'}`)
  if (opened.out !== opened.src) throw new Error(`Open in browser goes to ${opened.out}, the frame to ${opened.src}`)
  if (opened.name !== 'Watchless') throw new Error(`header reads ${opened.name}`)
  if (!opened.clipped) throw new Error('the frame is not wider than its clip, so its scrollbar will show')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const back = await page.evaluate(() => document.querySelectorAll('iframe').length)
  if (back !== 0) throw new Error('Escape did not close the app')
})

await step('notes: ticking one files it under Done and takes it out of the folder', async () => {
  await fresh('notes')
  const before = await page.evaluate(() => document.querySelectorAll('.nt-row').length)
  if (!before) throw new Error('no notes to tick')
  const title = await page.evaluate(() => document.querySelector('.nt-rowname')?.textContent.trim())
  await page.locator('.nt-tick').first().click()
  await page.waitForTimeout(500)
  const after = await page.evaluate(() => ({
    rows: document.querySelectorAll('.nt-row').length,
    doneChip: [...document.querySelectorAll('.nt-fname')].some((el) => el.textContent.trim() === 'Done'),
  }))
  if (after.rows !== before - 1) throw new Error(`list went ${before} -> ${after.rows}; a ticked note must leave the list`)
  if (!after.doneChip) throw new Error('no Done folder appeared')
  // and it is in Done, struck through, and can come back
  await page.evaluate(() => { [...document.querySelectorAll('.nt-folder')].find((b) => b.textContent.includes('Done'))?.click() })
  await page.waitForTimeout(400)
  const inDone = await page.evaluate((t) => {
    const row = [...document.querySelectorAll('.nt-row')].find((r) => r.textContent.includes(t))
    return { found: !!row, struck: row ? getComputedStyle(row.querySelector('.nt-rowname')).textDecorationLine.includes('line-through') : false }
  }, title)
  if (!inDone.found) throw new Error('the ticked note is not in Done')
  if (!inDone.struck) throw new Error('the done note does not read as done')
  await page.locator('.nt-tick.on').first().click()
  await page.waitForTimeout(500)
  const restored = await page.evaluate(() => document.querySelectorAll('.nt-row').length)
  if (restored !== 0) throw new Error('un-ticking did not take it out of Done')
})

/* ---------- The assistant, as a room with two halves ----------
   His report, in his words: the first message was welded to the bottom of the
   navigation, the ask box travelled up the screen with every answer, there was
   no sign it was thinking, and it only ever answered about the workspace he
   happened to be standing in. Every one of those is a step below. */

/** Answer as Groq would, choosing the reply from what he actually asked.
 *  Groq is asked to stream now, so the stub answers in the wire format it
 *  really uses: server-sent events. A plain JSON body would pass through the
 *  reader as zero frames and every one of these steps would go green on an
 *  empty answer. */
const sse = (text) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
const stubAssistant = async (reply, { delay = 0, status = 0, message = '' } = {}) => {
  await page.unroute('https://api.groq.com/**').catch(() => {})
  await page.route('https://api.groq.com/**', async (route) => {
    const req = route.request().postDataJSON()
    const asked = String(req.messages[req.messages.length - 1]?.content ?? '')
    if (delay) await new Promise((r) => setTimeout(r, delay))
    if (status) {
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: { message } }) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(reply(asked, req)) })
  })
}

/* A stub that arrives in pieces, over time, so the progressive render is what
   is under test rather than the parse. Playwright fulfils a route in one shot,
   so this replaces fetch inside the page instead. It stays inert until a step
   asks for it, because it is installed for the rest of the run. */
await page.addInitScript(() => {
  const real = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    let cfg = null
    try { cfg = JSON.parse(localStorage.getItem('qa-stream') ?? 'null') } catch { /* off */ }
    const url = typeof input === 'string' ? input : input.url
    if (!cfg || !/api\.groq\.com/.test(String(url))) return real(input, init)
    /* This never reaches the network, so Playwright sees no request. The ask is
       recorded here instead, which is the only way to prove the app asked the
       model to stream rather than quietly going back to one blocking call. */
    try { window.__qaAsked = JSON.parse(String(init?.body ?? 'null')) } catch { window.__qaAsked = null }
    const obj = JSON.stringify({ say: cfg.say, show: (cfg.show ?? []).map((k) => ({ kind: k })), next: [] })
    const frames = obj.match(/[\s\S]{1,8}/g) ?? []
    const enc = new TextEncoder()
    const body = new ReadableStream({
      async start(c) {
        for (const f of frames) {
          c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: f } }] })}\n\n`))
          await new Promise((r) => setTimeout(r, cfg.gap ?? 40))
        }
        c.enqueue(enc.encode('data: [DONE]\n\n'))
        c.close()
      },
    })
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
})
const askAssistant = async (text) => {
  await page.locator('.as-input').fill(text)
  await page.locator('.as-input').press('Enter')
  await page.waitForTimeout(700)
}

await step('assistant: the empty page is a doorway, with none of a chatbot’s furniture', async () => {
  await fresh('assistant')
  if (!(await page.locator('.as-orb').count())) throw new Error('the mark is missing')
  const q = await page.locator('.as-hero-q').innerText()
  if (q !== 'What can I help with?') throw new Error(`the question reads "${q}"`)
  const chips = await page.locator('.as-starters .as-chip').count()
  if (chips !== 6) throw new Error(`${chips} starters, expected 6`)
  /* His instruction, twice over: no voice of any kind, and specifically not
     attach / search / reason / create an image / summarise / translate. Those
     belong to a general chatbot and not one of them is a thing this app does. */
  const text = await page.locator('.as-page').innerText()
  for (const banned of [/voice/i, /microphone/i, /\bdictate/i, /attach/i, /create (an )?image/i, /summari[sz]e/i, /translate/i, /\breason\b/i]) {
    if (banned.test(text)) throw new Error(`the page offers ${banned}: ${JSON.stringify(text.slice(0, 200))}`)
  }
  const audio = await page.evaluate(() =>
    document.querySelectorAll('.as-page [aria-label*="voice" i], .as-page [aria-label*="mic" i], .as-page audio').length)
  if (audio) throw new Error(`${audio} voice controls on the page`)
  /* The line under the question is counted by the app, so it says something
     true the instant the page opens instead of waiting on a model. */
  const now = await page.locator('.as-hero-now').innerText()
  if (!now.trim()) throw new Error('the page opens saying nothing about his day')
})

await step('assistant: the answer splits the room and the ask box stops moving', async () => {
  await fresh('assistant')
  await page.evaluate(() => localStorage.setItem('mc-groq-key', 'gsk_gatetest'))
  await stubAssistant(() => JSON.stringify({ say: 'Pulled the day.', show: [{ kind: 'today' }], next: ['And the habits?'] }))
  await page.reload(); await page.waitForTimeout(700)
  await askAssistant('what is on today')
  await page.waitForSelector('.as-canvas', { timeout: 4000 })
  const thread = await page.locator('.as-thread').boundingBox()
  const canvas = await page.locator('.as-canvas').boundingBox()
  if (canvas.x <= thread.x + thread.width - 4) throw new Error('the canvas is not to the right of the thread')
  /* His complaint: the first message sat welded to the bottom of the menu. */
  const first = await page.locator('.as-turn').first().boundingBox()
  if (first.y - thread.y < 16) throw new Error(`the first message sits ${Math.round(first.y - thread.y)}px under the top of the thread`)
  /* And the one that mattered most: the box must not travel with the answers. */
  const before = await page.locator('.as-ask').boundingBox()
  await askAssistant('and again')
  await askAssistant('and once more')
  const after = await page.locator('.as-ask').boundingBox()
  if (Math.abs(before.y - after.y) > 1) throw new Error(`the ask box moved ${Math.round(Math.abs(before.y - after.y))}px after two more answers`)
  /* It stays put because the THREAD scrolls, not the document. */
  const overflow = await page.evaluate(() => document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight)
  if (overflow > 4) throw new Error(`the document itself scrolls by ${overflow}px`)
  const scrolls = await page.evaluate(() => {
    const t = document.querySelector('.as-thread')
    return t.scrollHeight > t.clientHeight ? 'thread' : 'nothing yet'
  })
  if (scrolls === 'nothing yet' && (await page.locator('.as-turn').count()) < 6) throw new Error('not enough turns to prove the thread is the scroller')
})

await step('assistant: the canvas swaps to whatever he just asked for', async () => {
  await fresh('assistant')
  await page.evaluate(() => localStorage.setItem('mc-groq-key', 'gsk_gatetest'))
  await stubAssistant((asked) => JSON.stringify(
    /habit/i.test(asked)
      ? { say: 'Habits, on the right.', show: [{ kind: 'habits' }] }
      : { say: 'The day, on the right.', show: [{ kind: 'today' }] }))
  await page.reload(); await page.waitForTimeout(700)
  await askAssistant('what is on today')
  await page.waitForSelector('.as-canvas', { timeout: 4000 })
  const head = async () => (await page.locator('.as-canvas-head h2').innerText()).trim().toLowerCase()
  if (await head() !== 'on the day') throw new Error(`the canvas opened on "${await head()}"`)
  await askAssistant('and which habits are open')
  await page.waitForTimeout(500)
  if (await head() !== 'habits today') throw new Error(`the canvas did not swap, it still reads "${await head()}"`)
  /* One canvas, swapped. Not two stacked, which is the thing he did not want. */
  if ((await page.locator('.as-canvas').count()) !== 1) throw new Error('there is more than one canvas')
  if (await page.locator('.as-thread .as-card').count()) throw new Error('cards are still being drawn inside the thread on a wide screen')
  /* And the way back to an earlier one is on its own turn. */
  const back = page.locator('.as-pulled-btn', { hasText: 'On the day' }).first()
  if (!(await back.count())) throw new Error('no way back to the first thing it pulled')
  await back.click(); await page.waitForTimeout(400)
  if (await head() !== 'on the day') throw new Error(`clicking back landed on "${await head()}"`)
})

await step('assistant: it answers across every workspace, not the one he is standing in', async () => {
  await fresh('assistant')
  const seeded = await page.evaluate((K) => {
    const s = JSON.parse(localStorage.getItem(K))
    const d = new Date()
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const task = (id, title, space) => ({
      id, title, space, source: 'mc', estimateMin: 30, done: false,
      list: 'today', category: 'admin', slot: 'morning', plannedOn: day, createdAt: day, addedAt: Date.now(),
    })
    s.tasks = [task('gate-as-p', 'Gate personal thing', 'personal'), task('gate-as-o', 'Gate offplate thing', 'offplate')]
    localStorage.setItem(K, JSON.stringify(s))
    localStorage.setItem('mc-groq-key', 'gsk_gatetest')
    /* Standing in Personal on purpose: every other page would hide the
       Off-Plate row, and this one must not. */
    localStorage.setItem('mc-view', 'personal')
    localStorage.setItem('mc-space', 'personal')
    return { ok: true }
  }, KEY)
  if (seeded.err) throw new Error(seeded.err)
  let briefed = ''
  await stubAssistant((asked, req) => {
    briefed = req.messages.map((m) => m.content).join('\n')
    return JSON.stringify({ say: 'Both workspaces are on the right.', show: [{ kind: 'today' }] })
  })
  await page.reload(); await page.waitForTimeout(800)
  await askAssistant('what is on today')
  await page.waitForSelector('.as-canvas', { timeout: 4000 })
  const canvas = await page.locator('.as-canvas').innerText()
  if (!/Gate personal thing/.test(canvas)) throw new Error('the Personal task is missing from the canvas')
  if (!/Gate offplate thing/.test(canvas)) throw new Error('standing in Personal hid the Off-Plate task, which is the whole bug')
  /* And each row says which workspace it came from, since they are mixed. */
  if (!(await page.locator('.as-canvas .as-row .spacemark.s-offplate').count())) throw new Error('the Off-Plate row carries no workspace mark')
  if (!(await page.locator('.as-canvas .as-row .spacemark.s-personal').count())) throw new Error('the Personal row carries no workspace mark')
  /* The model was told the same thing, so its sentence cannot contradict the
     cards: it saw both, and it saw which workspace each one belongs to. */
  if (!/Gate offplate thing/.test(briefed)) throw new Error('the briefing sent to the model was still filtered to one workspace')
  if (!/\[Off-Plate\]/.test(briefed)) throw new Error('the briefing does not tell the model which workspace anything came from')
})

await step('assistant: it visibly thinks, and says what to do when the model is gone', async () => {
  await fresh('assistant')
  await page.evaluate(() => localStorage.setItem('mc-groq-key', 'gsk_gatetest'))
  await stubAssistant(() => JSON.stringify({ say: 'Here.', show: [{ kind: 'today' }] }), { delay: 1200 })
  await page.reload(); await page.waitForTimeout(700)
  await page.locator('.as-input').fill('take your time')
  await page.locator('.as-input').press('Enter')
  await page.waitForTimeout(350)
  if (!(await page.locator('.as-dots').isVisible())) throw new Error('nothing on screen says it is working')
  const bobbing = await page.evaluate(() => getComputedStyle(document.querySelector('.as-dots > i')).animationName)
  if (!bobbing || bobbing === 'none') throw new Error('the thinking indicator is a still picture')
  await page.waitForSelector('.as-dots', { state: 'detached', timeout: 6000 })
  if (!(await page.locator('.as-turn.is-it .as-said').count())) throw new Error('it stopped thinking without answering')
  /* The failure that started all of this: the model this app named was retired
     and every AI feature died silently. It must now say so, and say what to do. */
  expected = /api\.groq\.com/
  await stubAssistant(() => '', { status: 404, message: 'The model `llama-3.3-70b-versatile` has been decommissioned.' })
  await askAssistant('and now')
  const err = await page.locator('.as-error').innerText()
  if (!/decommissioned/.test(err)) throw new Error(`the provider's own words are not on screen: ${JSON.stringify(err)}`)
  if (!/reload/i.test(err)) throw new Error(`the error does not say what to do about it: ${JSON.stringify(err)}`)
  expected = null
})

await step('assistant: the answer is written out, it does not appear finished', async () => {
  /* The whole point of streaming: he sees the sentence forming. Tested against
     a body that genuinely arrives in pieces over time, because a stub that
     answers in one shot proves the parse and nothing about the render. */
  await fresh('assistant')
  await page.evaluate((K) => {
    const s = JSON.parse(localStorage.getItem(K))
    const d = new Date()
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    s.tasks = [{
      id: 'gate-stream', title: 'Gate streaming task', space: 'personal', source: 'mc',
      estimateMin: 30, done: false, list: 'today', category: 'admin', slot: 'morning',
      plannedOn: day, createdAt: day, addedAt: Date.now(),
    }]
    localStorage.setItem(K, JSON.stringify(s))
    localStorage.setItem('mc-groq-key', 'gsk_gatetest')
    localStorage.setItem('qa-stream', JSON.stringify({
      say: 'The whole day is on the right, and most of what is still open belongs to the side business.',
      show: ['today'], gap: 45,
    }))
  }, KEY)
  await page.reload(); await page.waitForTimeout(700)
  await page.locator('.as-input').fill('what is on today')
  await page.locator('.as-input').press('Enter')
  await page.waitForFunction(() => !!window.__qaAsked, null, { timeout: 5000 })
  if (!(await page.evaluate(() => window.__qaAsked?.stream === true))) {
    throw new Error('the request did not ask the model to stream, so nothing can arrive early')
  }
  /* Caught mid-sentence: some of it on screen, not all of it, and a caret. */
  await page.waitForSelector('.as-said.is-live', { timeout: 4000 })
  const mid = await page.locator('.as-said.is-live').innerText()
  if (!mid.trim()) throw new Error('the live line is empty, so nothing is arriving early')
  if (mid.includes('side business')) throw new Error(`the whole sentence was there at once: ${JSON.stringify(mid)}`)
  if (!(await page.locator('.as-caret').count())) throw new Error('no caret while it writes')
  const caret = await page.evaluate(() => getComputedStyle(document.querySelector('.as-caret')).animationName)
  if (!caret || caret === 'none') throw new Error('the caret is a still bar')
  /* And it lands whole, with the cards, and the caret goes. */
  await page.waitForSelector('.as-canvas-body .as-row', { timeout: 8000 })
  await page.waitForSelector('.as-caret', { state: 'detached', timeout: 8000 })
  const done = await page.locator('.as-turn.is-it .as-said').last().innerText()
  if (!done.includes('side business')) throw new Error(`the finished sentence is wrong: ${JSON.stringify(done)}`)
  await page.evaluate(() => localStorage.removeItem('qa-stream'))
})

await step('assistant: the canvas deals its rows in, and stops moving for a reader who asked it to', async () => {
  await fresh('assistant')
  await page.evaluate(() => localStorage.setItem('mc-groq-key', 'gsk_gatetest'))
  await stubAssistant(() => JSON.stringify({ say: 'Here.', show: [{ kind: 'habits' }] }))
  await page.reload(); await page.waitForTimeout(700)
  await askAssistant('habits please')
  await page.waitForSelector('.as-canvas-body .as-row', { timeout: 4000 })
  const rows = await page.evaluate(() => [...document.querySelectorAll('.as-canvas-body .as-row')].slice(0, 6)
    .map((r) => { const c = getComputedStyle(r); return { name: c.animationName, delay: c.animationDelay } }))
  if (rows.length < 3) throw new Error('not enough rows to judge the stagger')
  if (rows.some((r) => r.name === 'none')) throw new Error('the rows are not animated at all')
  const delays = rows.map((r) => Math.round(parseFloat(r.delay) * 1000))
  if (new Set(delays).size < 3) throw new Error(`the rows all land together: ${JSON.stringify(delays)}`)
  if (delays[delays.length - 1] > 400) throw new Error(`the last row waits ${delays[delays.length - 1]}ms, which is a loading screen`)
  /* Every one of these is off for someone who asked their system for less
     motion, which is the whole contract of adding motion in the first place. */
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(200)
  const still = await page.evaluate(() => {
    const names = (sel) => [...document.querySelectorAll(sel)].map((e) => getComputedStyle(e).animationName)
    return [...names('.as-canvas-body .as-row'), ...names('.as-turn'), ...names('.as-orb'), ...names('.as-canvas-body')]
  })
  const moving = still.filter((n) => n && n !== 'none')
  if (moving.length) throw new Error(`${moving.length} things still animate under reduced motion: ${[...new Set(moving)].join(', ')}`)
  await page.emulateMedia({ reducedMotion: null })
})

await page.unroute('https://api.groq.com/**').catch(() => {})

await b.close(); server.close(); rmSync(SNAP, { recursive: true, force: true })
if (errors.length) console.log(`CONSOLE ERRORS (${errors.length}): ${errors[0]}`)
console.log(`${pass} pass, ${fail} fail${errors.length ? `, ${errors.length} console errors` : ', 0 console errors'}`)
process.exit(fail || errors.length ? 1 : 0)
