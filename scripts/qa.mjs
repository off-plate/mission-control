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

await b.close(); server.close()
if (errors.length) console.log(`CONSOLE ERRORS (${errors.length}): ${errors[0]}`)
console.log(`${pass} pass, ${fail} fail${errors.length ? `, ${errors.length} console errors` : ', 0 console errors'}`)
process.exit(fail || errors.length ? 1 : 0)
