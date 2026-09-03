/* THE 14th-TO-14th CYCLE, TESTED.

   Bills used to run on calendar months. It does not: his money turns over on
   the 14th, and on a month boundary the rent and the salary that pays it fell
   into different cycles, so every "this cycle" figure was answering a question
   about a month he does not live in.

   Moving the boundary is arithmetic no screenshot can check. A window that is
   off by one day, or a key that names the wrong month, produces a page that
   looks entirely normal and quietly files a payment under the wrong fortnight.
   The cases that matter are the boundary itself (the 14th belongs to the cycle
   it OPENS, not the one it closes), the year rollover, February, and the fact
   that a day-of-month lookup now has two months to search.

   Pure module, no browser, no fixed date. Run with `node tools/cycle-test.mjs`.
*/
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const dir = mkdtempSync(join(tmpdir(), 'cyc-'))
await build({ entryPoints: [new URL('../src/compassCalc.ts', import.meta.url).pathname], bundle: true, format: 'esm', outfile: join(dir, 'c.mjs') })
const C = await import(join(dir, 'c.mjs'))

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++ } catch (e) { fail++; console.log('FAIL ' + name + ': ' + e.message) } }
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m ?? ''} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`) }
const D = (y, m, d) => new Date(y, m - 1, d)

t('a cycle opens on the 14th and closes on the next 14th', () => {
  const c = C.cycleForKey('2026-09')
  eq(C.iso(c.start), '2026-09-14', 'start')
  eq(C.iso(c.end), '2026-10-14', 'end')
})

t('the key names the month the cycle STARTS in', () => {
  eq(C.cycleForKey('2026-09').key, '2026-09')
  eq(C.iso(C.cycleForKey('2026-12').end), '2027-01-14', 'december rolls the year')
})

/* The boundary. A payment on the 14th belongs to the cycle that opens that
   day; the previous cycle ends the moment it begins. */
t('the 14th opens a cycle rather than closing one', () => {
  eq(C.cycleKeyOn(D(2026, 9, 14)), '2026-09')
  eq(C.cycleKeyOn(D(2026, 9, 13)), '2026-08')
})
t('before the 14th you are still in last month’s cycle', () => {
  eq(C.cycleKeyOn(D(2026, 9, 1)), '2026-08')
  eq(C.cycleKeyOn(D(2026, 9, 4)), '2026-08')
})
t('after the 14th you are in this month’s', () => {
  eq(C.cycleKeyOn(D(2026, 9, 15)), '2026-09')
  eq(C.cycleKeyOn(D(2026, 9, 30)), '2026-09')
})
t('the 1st of January belongs to December’s cycle', () => {
  eq(C.cycleKeyOn(D(2027, 1, 3)), '2026-12')
})
t('February is a shorter cycle, not a broken one', () => {
  const c = C.cycleForKey('2026-02')
  eq(C.iso(c.start), '2026-02-14')
  eq(C.iso(c.end), '2026-03-14')
})

t('every day of the cycle is covered exactly once, with no gap at the seam', () => {
  for (const key of ['2026-01', '2026-02', '2026-09', '2026-12']) {
    const c = C.cycleForKey(key)
    const next = C.cycleForKey(C.addMonthsToKey(key, 1))
    eq(C.iso(c.end), C.iso(next.start), `${key} ends where the next begins`)
    for (const d of [c.start, new Date(c.end.getTime() - 86400000)]) {
      eq(C.cycleKeyOn(d), key, `${C.iso(d)} is inside ${key}`)
    }
    eq(C.cycleKeyOn(next.start), next.key, 'the next start is not in this one')
  }
})

/* The reason the window may span two months at all: a bill on the 1st and a
   bill on the 20th are both in a 14th-to-14th cycle, in different months. */
t('a day-of-month lands whichever month the window covers', () => {
  const c = C.cycleForKey('2026-09')
  const items = C.cycleChecklist(
    [
      { id: 'r1', name: 'Rent', kind: 'expense', priority: 'mandatory', amount: 100, cadence: 'monthly', day_of_month: 1, start_on: '2026-01-01', end_on: null, is_active: true, category_id: null, debt_id: null, goal_id: null, month_of_year: null, is_subscription: false, sort_order: 0, user_id: 'u' },
      { id: 'r2', name: 'Phone', kind: 'expense', priority: 'optional', amount: 50, cadence: 'monthly', day_of_month: 20, start_on: '2026-01-01', end_on: null, is_active: true, category_id: null, debt_id: null, goal_id: null, month_of_year: null, is_subscription: false, sort_order: 0, user_id: 'u' },
    ], [], [], [], c, 0).items
  eq(items.find((i) => i.name === 'Rent')?.dueOn, '2026-10-01', 'the 1st falls in the closing month')
  eq(items.find((i) => i.name === 'Phone')?.dueOn, '2026-09-20', 'the 20th falls in the opening month')
})

t('a bill on the 14th itself lands on the day the cycle opens', () => {
  const c = C.cycleForKey('2026-09')
  const items = C.cycleChecklist(
    [{ id: 'r1', name: 'Loan', kind: 'expense', priority: 'mandatory', amount: 100, cadence: 'monthly', day_of_month: 14, start_on: '2026-01-01', end_on: null, is_active: true, category_id: null, debt_id: null, goal_id: null, month_of_year: null, is_subscription: false, sort_order: 0, user_id: 'u' }],
    [], [], [], c, 0).items
  eq(items.length, 1, 'it is in the cycle exactly once')
  eq(items[0].dueOn, '2026-09-14')
})

t('income is resolved by the window, not by the month', () => {
  const c = C.cycleForKey('2026-09')
  const rows = [
    { id: 'a', cycle_start: '2026-09-14', expected_income: 60000, label: null, note: null, user_id: 'u' },
    { id: 'b', cycle_start: '2026-10-01', expected_income: 5000, label: null, note: null, user_id: 'u' },
    { id: 'c', cycle_start: '2026-10-14', expected_income: 999, label: null, note: null, user_id: 'u' },
    { id: 'd', cycle_start: '2026-09-01', expected_income: 111, label: null, note: null, user_id: 'u' },
  ]
  const r = C.resolveCycleIncome(c, rows)
  eq(r.amount, 65000, 'the two inside the window, and only those')
  eq(r.entries.map((x) => x.id).sort().join(''), 'ab')
})

/* Unreasonable rows carry no due date and used to be matched on a month
   prefix, which cannot describe a window spanning two months. */
t('a dateless expense is filed by the window it was logged in', () => {
  const c = C.cycleForKey('2026-09')
  const planned = [
    { id: 'p1', name: 'In', amount: 500, kind: 'expense', priority: 'optional', due_on: null, cycle_start: '2026-09-14', tag: 'regret', category_id: null, note: null, created_at: '', user_id: 'u' },
    { id: 'p2', name: 'Next', amount: 700, kind: 'expense', priority: 'optional', due_on: null, cycle_start: '2026-10-14', tag: null, category_id: null, note: null, created_at: '', user_id: 'u' },
    { id: 'p3', name: 'Legacy', amount: 300, kind: 'expense', priority: 'optional', due_on: null, cycle_start: '2026-10-01', tag: null, category_id: null, note: null, created_at: '', user_id: 'u' },
  ]
  const names = C.cycleChecklist([], planned, [], [], c, 0).items.filter((i) => i.source === 'unreasonable').map((i) => i.name).sort()
  eq(names.join(','), 'In,Legacy', 'the one in the next window stays out')
})

console.log(`${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
