/* The release gate, rewritten 2026-08-02 against the CURRENT app. The old one
   predated the sign-in wall (never passed ?noremote) and tested pages that no
   longer exist, so it failed 0/10 forever while the app was fine: a gate that
   always says no protects nothing. This one serves docs/ itself, always runs
   ?noremote so it can never touch live data, walks the core flows with today's
   selectors, and fails loudly on any console error. */
import { chromium } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve, join, extname } from 'path'

const HERE = dirname(fileURLToPath(import.meta.url))
const DOCS = resolve(HERE, '..', 'docs')
const PORT = 8321
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0].replace(/^\/mission-control/, '') || '/'
  const file = join(DOCS, path === '/' ? 'index.html' : path)
  if (!existsSync(file)) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})
await new Promise((ok) => server.listen(PORT, ok))
const URL = `http://localhost:${PORT}/mission-control/?noremote`
const KEY = 'mission-control-demo-v12'

let pass = 0, fail = 0
const errors = []
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1500, height: 1200 } })
page.on('pageerror', (e) => errors.push(e.message.slice(0, 120)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)) })
const step = async (name, fn) => {
  try { await fn(); pass++; console.log(`PASS ${name}`) }
  catch (e) { fail++; console.log(`FAIL ${name}: ${String(e).split('\n')[0]}`) }
}
const fresh = async (route = '') => {
  await page.goto(URL); await page.waitForTimeout(300)
  await page.evaluate((K) => localStorage.removeItem(K), KEY)
  await page.goto(`${URL}#/${route}`); await page.reload(); await page.waitForTimeout(700)
}

await step('plan: add, estimate visible, complete via chips', async () => {
  await fresh('plan')
  await page.locator('input[placeholder="Add something to the list"]').fill('Gate task')
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
  await page.locator('input[placeholder="Add something to the list"]').fill('Gate breakdown task')
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
await step('routines: choice step ticks and starts the routine', async () => {
  await fresh('routines')
  // Cards are shut by default now: open the one being run first.
  await page.locator('.routine-card', { hasText: 'Out Brain Rot' }).first().locator('.routine-open').click()
  await page.waitForTimeout(300)
  await page.locator('.routine-card', { hasText: 'Out Brain Rot' }).first().locator('.alt-opt', { hasText: 'Move' }).click()
  await page.waitForTimeout(400)
  const s = await page.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY)
  const r = s.routines.find((x) => x.id === 'r-brainrot')
  if (!r.doneStepIds.includes('br1') || !r.startedAt) throw new Error('choice did not tick/start')
  // and it leaves a DATED row, which is the only thing that survives rollover
  if (!(s.stepTicks ?? []).some((t) => t.routineId === 'r-brainrot' && t.stepId === 'br1')) {
    throw new Error('ticking a step left no dated row')
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
await step('calendar: month nav and day pick', async () => {
  await fresh('calendar')
  await page.getByRole('button', { name: 'Next month' }).click()
  await page.getByRole('button', { name: 'Now' }).click()
  await page.locator('.cal-day').first().click()
})
await step('workspaces: write a task into Michael’s Corner', async () => {
  await fresh('plan')
  await page.locator('button', { hasText: 'Michael' }).first().click(); await page.waitForTimeout(400)
  await page.locator('input[placeholder="Add something to the list"]').fill('Corner gate')
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
  await page.locator('input[placeholder="Add something to the list"]').fill('Gate tomorrow task')
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
  await page.locator('input[placeholder="Add something to the list"]').fill('Gate promise')
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
await step('habits: routine-kept rows lock today and link out', async () => {
  await fresh('habits')
  // The view survives outside the demo blob, and an earlier step stands in
  // Michael's Corner. This step needs the whole flat.
  await page.locator('.space-btn', { hasText: 'All' }).click(); await page.waitForTimeout(400)
  const line = page.locator('.habit-line', { hasText: 'After wake up' }).first()
  await line.waitFor({ timeout: 5000 }).catch(async () => {
    await page.screenshot({ path: '/tmp/qa-habits-fail.png', fullPage: true })
    throw new Error('no After wake up line, see /tmp/qa-habits-fail.png')
  })
  const dis = await line.locator('.day-cell.is-today .daydot').first().isDisabled({ timeout: 5000 })
  if (dis !== true) throw new Error('today dot pressable on a routine-kept habit')
  await line.locator('.habit-auto').click(); await page.waitForTimeout(400)
  if (!(await page.locator('.routine-card', { hasText: 'After wake up' }).count())) throw new Error('link did not open Routines')
})
await step('phone: plan is usable at 390', async () => {
  const mp = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await mp.goto(URL); await mp.waitForTimeout(300)
  await mp.evaluate((K) => localStorage.removeItem(K), KEY)
  await mp.goto(`${URL}#/plan`); await mp.reload(); await mp.waitForTimeout(700)
  await mp.locator('input[placeholder="Add something to the list"]').fill('Phone gate task with a long name')
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
  await cp.locator('.pomo-badge button[aria-label="Stop"]').click(); await cp.waitForTimeout(500)
  const s = await cp.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY)
  const total = (s.focusSessions ?? []).reduce((a, f) => a + f.minutes, 0)
  if (total < 19 || total > 21) throw new Error(`banked ${total}m of a stopped 20m block`)
  await cp.close()
})

await step('sync: two tabs both keep what they added', async () => {
  /* His own repro. Two tabs of one browser share localStorage, so each save
     used to replace the other's lists wholesale. */
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } })
  const A = await ctx.newPage(), B = await ctx.newPage()
  const add = async (page, title) => {
    await page.bringToFront()
    if (!/#\/plan/.test(page.url())) { await page.goto(`${URL}#/plan`); await page.waitForTimeout(600) }
    await page.locator('input[placeholder="Add something to the list"]').fill(title)
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
  await page.getByRole('button', { name: /Walk yesterday/ }).click(); await page.waitForTimeout(600)
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
  await page.getByRole('button', { name: /Walk yesterday/ }).click(); await page.waitForTimeout(600)
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

await step('habits: a routine left half done still reads half done tomorrow', async () => {
  /* His own report: partial routines only ever showed on today's dot, because
     the routine's doneStepIds is wiped at rollover and nothing dated survived
     it. Seed two of Morning Preparation's steps on an earlier weekday and the
     dot for that day must fill. */
  await fresh('habits')
  const yday = await page.evaluate((K) => {
    const s = JSON.parse(localStorage.getItem(K))
    const r = s.routines.find((x) => x.id === 'r-morning')
    // an earlier day of THIS week, so it is on the seven-day strip
    const d = new Date()
    const back = d.getDay() === 1 ? 0 : 1
    d.setDate(d.getDate() - back)
    const z = (n) => String(n).padStart(2, '0')
    const day = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
    s.stepTicks = r.steps.slice(0, 2).map((st) => ({ routineId: 'r-morning', stepId: st.id, day }))
    localStorage.setItem(K, JSON.stringify(s))
    return day
  }, KEY)
  await page.reload(); await page.waitForTimeout(800)
  const row = page.locator('.habit-line', { hasText: 'Morning Preparation' }).first()
  const partials = await row.locator('.daydot.partial').count()
  if (partials < 1) throw new Error(`no partial dot for ${yday}`)
  // and the fill is a real fraction, not 0 and not full
  const fill = await row.locator('.daydot.partial').first().evaluate((el) => el.style.getPropertyValue('--fill'))
  const n = parseInt(fill, 10)
  if (!(n > 0 && n < 100)) throw new Error(`fill reads ${fill}`)
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
  await page.locator('.nt-folder', { hasText: 'Personal' }).first().click(); await page.waitForTimeout(200)
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
  if (m.rows < 5) throw new Error('the folder panel did not render')
  if (m.heights.length !== 1) throw new Error(`folder rows are ${m.heights.join(', ')}px tall`)
  if (m.heights[0] < 38) throw new Error(`folder rows are only ${m.heights[0]}px tall`)
  if (m.sizes.length !== 1 || m.families.length !== 1) throw new Error(`mixed type in the folder list: ${m.sizes.join(', ')} / ${m.families.join(' | ')}`)
  if (m.adders !== 1) throw new Error(`${m.adders} New folder controls`)
})

await step('notes: a folder he made, and its notes surviving its deletion', async () => {
  await fresh('notes')
  // the first group is All notes now; the workspace groups start after it
  // one New folder control at the foot; it lands in the workspace he is in
  await page.locator('.nt-folder', { hasText: 'Personal' }).first().click(); await page.waitForTimeout(300)
  await page.locator('.nt-newfolder').click()
  await page.locator('input[aria-label^="New folder in"]').fill('Taxes')
  await page.keyboard.press('Enter'); await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'New note' }).click(); await page.waitForTimeout(300)
  await page.locator('textarea[aria-label="Note title"]').fill('Do not lose me'); await page.waitForTimeout(400)
  let s = await page.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY)
  const f = (s.noteFolders ?? []).find((x) => x.name === 'Taxes')
  if (!f) throw new Error('the folder was not created')
  if (f.parentId !== 'nf-space-personal') throw new Error(`nested under ${f.parentId}`)
  const wrote = (s.notes ?? []).find((n) => n.title === 'Do not lose me')
  if (wrote?.folderId !== f.id) throw new Error('the note did not land in the new folder')
  // deleting the shelf must not burn the books
  await page.locator('.nt-folder-row', { hasText: 'Taxes' }).getByRole('button', { name: /options/i }).click()
  await page.getByRole('menuitem', { name: /Delete folder/ }).click(); await page.waitForTimeout(500)
  s = await page.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY)
  if ((s.noteFolders ?? []).some((x) => x.id === f.id)) throw new Error('the folder is still there')
  const after = (s.notes ?? []).find((n) => n.title === 'Do not lose me')
  if (!after) throw new Error('the note went with the folder')
  if (after.folderId !== 'nf-space-personal') throw new Error(`the note ended up in ${after.folderId}`)
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
  await page.locator('.nt-folder', { hasText: 'Personal' }).first().click(); await page.waitForTimeout(200)
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
  await page.locator('.nt-folder', { hasText: 'Personal' }).first().click(); await page.waitForTimeout(300)
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
  await page.locator('.nt-folder', { hasText: 'Personal' }).first().click(); await page.waitForTimeout(400)
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
  await page.locator('.nt-folder', { hasText: 'Personal' }).first().click(); await page.waitForTimeout(400)
  await page.locator('.nt-row', { hasText: 'Formatting' }).first().click(); await page.waitForTimeout(400)
  if (!(await page.locator('.nt-editor li > ul li').count())) throw new Error('the nesting did not come back after a reload')
})

await step('notes: three dashes make a divider, and a table he sized himself', async () => {
  await fresh('notes')
  await page.locator('.nt-folder', { hasText: 'Personal' }).first().click(); await page.waitForTimeout(300)
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
  await page.locator('.nt-folder', { hasText: 'Personal' }).first().click(); await page.waitForTimeout(300)
  await page.locator('.nt-row', { hasText: 'Divider and table' }).first().click(); await page.waitForTimeout(400)
  if (!(await page.locator('.nt-editor hr').count())) throw new Error('the divider did not come back')
  if ((await page.locator('.nt-editor table tr').count()) < 4) throw new Error('the table did not come back whole')
})

await step('routines: before bed reviews Compass', async () => {
  await fresh('routines')
  const s = await page.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY)
  const step8 = (s.routines ?? []).find((r) => r.id === 'r-evening')?.steps?.find((x) => x.id === 'be8')
  if (!step8) throw new Error('the Compass step is not in the routine')
  if (step8.link !== 'https://compass-money.netlify.app') throw new Error(`links to ${step8.link}`)
  await page.locator('.routine-card', { hasText: 'Before bed routine' }).first().locator('.routine-open').click()
  await page.waitForTimeout(400)
  const row = page.locator('.routine-card', { hasText: 'Before bed routine' }).first()
  if (!(await row.getByText('Review Compass finances').count())) throw new Error('the step does not render')
  if (!(await row.getByRole('link', { name: /Compass/ }).count())) throw new Error('no link under it')
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
  await page.locator('.nt-folder', { hasText: 'Personal' }).first().click(); await page.waitForTimeout(400)
  await page.locator('.nt-pane').getByRole('button', { name: 'Note options' }).click(); await page.waitForTimeout(300)
  if (!(await page.locator('.nt-pane .kebab-menu').count())) throw new Error('the menu did not open')
  const m = await page.locator('.nt-pane .kebab-menu').boundingBox()
  if (m.x + m.width > 1502) throw new Error('the menu runs off the right edge')
  if (!(await page.getByRole('menuitem', { name: 'Make it a task' }).isVisible())) throw new Error('its items are not visible')
  await page.keyboard.press('Escape')
})

await b.close(); server.close()
if (errors.length) console.log(`CONSOLE ERRORS (${errors.length}): ${errors[0]}`)
console.log(`${pass} pass, ${fail} fail${errors.length ? `, ${errors.length} console errors` : ', 0 console errors'}`)
process.exit(fail || errors.length ? 1 : 0)
