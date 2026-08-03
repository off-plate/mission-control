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

await step('notes: brain dumps came across, and search reaches every folder', async () => {
  await fresh('notes')
  const bin = page.locator('.nt-folder', { hasText: 'Brain dumps' }).first()
  if (!(await bin.count())) throw new Error('no Brain dumps folder')
  await bin.click(); await page.waitForTimeout(200)
  if (!(await page.locator('.nt-row', { hasText: 'Rubber band' }).count())) throw new Error('the board did not come across')
  // write one, in Czech, with a tag
  await page.getByRole('button', { name: 'New note' }).click()
  await page.locator('textarea[aria-label="Note text"]').fill('Zavolat na úkol #vzp\nDruhý řádek s detailem')
  await page.getByRole('button', { name: 'Done', exact: true }).click(); await page.waitForTimeout(400)
  const saved = await page.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY)
  const mine = (saved.notes ?? []).find((n) => n.title.startsWith('Zavolat'))
  if (!mine) throw new Error('the note was not saved')
  if (mine.folderId !== 'nf-braindump-personal') throw new Error(`landed in ${mine.folderId}`)
  // stand somewhere else, then search without the accents
  await page.locator('.nt-folder.nt-top').first().click(); await page.waitForTimeout(200)
  await page.locator('input[aria-label="Search notes"]').fill('ukol'); await page.waitForTimeout(300)
  if (!(await page.locator('.nt-row', { hasText: 'Zavolat' }).count())) throw new Error('accent-blind search missed it')
  await page.locator('input[aria-label="Search notes"]').fill(''); await page.waitForTimeout(200)
  await page.locator('.note-chip', { hasText: '#vzp' }).first().click(); await page.waitForTimeout(300)
  const rows = await page.locator('.nt-row').count()
  if (rows !== 1) throw new Error(`the tag filter showed ${rows} notes`)
})

await step('notes: a folder he made, and its notes surviving its deletion', async () => {
  await fresh('notes')
  await page.locator('.nt-group').first().locator('.nt-addfolder').click()
  await page.locator('input[aria-label^="New folder in"]').fill('Taxes')
  await page.keyboard.press('Enter'); await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'New note' }).click()
  await page.locator('textarea[aria-label="Note text"]').fill('Do not lose me')
  await page.getByRole('button', { name: 'Done', exact: true }).click(); await page.waitForTimeout(400)
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
  await page.locator('.nt-folder.nt-top').first().click(); await page.waitForTimeout(200)
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
  await mp.getByRole('button', { name: 'New note' }).click(); await mp.waitForTimeout(300)
  await mp.locator('textarea[aria-label="Note text"]').fill('Telefonní poznámka #test')
  await mp.getByRole('button', { name: 'Done', exact: true }).click(); await mp.waitForTimeout(400)
  over = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (over > 0) throw new Error(`horizontal overflow ${over}px with a note open`)
  // the open note has the screen to itself: the rail must not still be taking width
  const noteW = (await mp.locator('.nt-note').boundingBox()).width
  if (noteW < 300) throw new Error(`the open note is only ${Math.round(noteW)}px wide`)
  const s = await mp.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY)
  if (!(s.notes ?? []).some((n) => n.title.startsWith('Telefonní'))) throw new Error('the phone note was not saved')
  await mp.close()
})

await b.close(); server.close()
if (errors.length) console.log(`CONSOLE ERRORS (${errors.length}): ${errors[0]}`)
console.log(`${pass} pass, ${fail} fail${errors.length ? `, ${errors.length} console errors` : ', 0 console errors'}`)
process.exit(fail || errors.length ? 1 : 0)
