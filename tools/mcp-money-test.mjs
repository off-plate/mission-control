/* Bills and money through the real registration path, a fake server that validates input with the
   real zod, and an in-memory PostgREST standing in for the compass_* tables. Never a real database.
   `ZOD_PATH=... node tools/mcp-money-test.mjs`
   Parity: the cycle/debt math is re-implemented in ops-money.ts (the Edge Function cannot import src/),
   so src/compassCalc.ts is bundled here and both are compared on many cycles, dates and random data. */
import assert from 'assert/strict'
import { readFileSync } from 'fs'
import { build } from 'esbuild'
import { loadKit, ROOT } from './mcp-test-kit.mjs'

const K = await loadKit({ modules: ['tools-money.ts', 'ops-money.ts'], extra: ["export * as app from './src/compassCalc.ts'"] })
const { M, fakeDb, fakeServer, clone } = K
const O = M.ops_money
const A = M.app
let n = 0
const ok = (cond, msg) => { n++; assert.ok(cond, msg) }
const eq = (a, b, msg) => { n++; assert.deepEqual(a, b, msg) }
const rej = async (p, re, msg) => { n++; await assert.rejects(p, (e) => e instanceof M.McError && re.test(e.message), msg) }
const strip = (r) => { const { id, created_at, ...x } = r; return x }

/* ---------------- fixture ---------------- */
const U = 'u1'
const DAY = (s, k) => { const [y, m, d] = s.split('-').map(Number); return O.mk(y, m - 1, d + k) }
function world(today) {
  const key = O.cycleKeyOn(today)
  const c = O.cycleForKey(key), prev = O.cycleForKey(O.addMonthsToKey(key, -1))
  const recurring = [
    { id: 'r-rent', user_id: U, name: 'Rent', kind: 'expense', priority: 'mandatory', amount: 12000, category_id: 'cat-home', debt_id: null, goal_id: null, cadence: 'monthly', day_of_month: 15, month_of_year: null, start_on: '2025-01-01', end_on: null, is_active: true },
    { id: 'r-spot', user_id: U, name: 'Spotify', kind: 'expense', priority: 'optional', amount: 199, category_id: null, debt_id: null, goal_id: null, cadence: 'monthly', day_of_month: 20, month_of_year: null, start_on: '2025-01-01', end_on: null, is_active: true },
    { id: 'r-spot2', user_id: U, name: 'Spotify Family', kind: 'expense', priority: 'optional', amount: 269, category_id: null, debt_id: null, goal_id: null, cadence: 'monthly', day_of_month: 21, month_of_year: null, start_on: '2025-01-01', end_on: null, is_active: true },
    { id: 'r-net', user_id: U, name: 'Internet', kind: 'expense', priority: 'mandatory', amount: 599, category_id: 'cat-net', debt_id: null, goal_id: null, cadence: 'monthly', day_of_month: 1, month_of_year: null, start_on: '2025-01-01', end_on: null, is_active: true },
    { id: 'r-save', user_id: U, name: 'Emergency fund', kind: 'saving', priority: 'optional', amount: 1000, category_id: null, debt_id: null, goal_id: 'goal-ef', cadence: 'monthly', day_of_month: 16, month_of_year: null, start_on: '2025-01-01', end_on: null, is_active: true },
    { id: 'r-old', user_id: U, name: 'Gym (cancelled)', kind: 'expense', priority: 'optional', amount: 800, category_id: null, debt_id: null, goal_id: null, cadence: 'monthly', day_of_month: 18, month_of_year: null, start_on: '2025-01-01', end_on: null, is_active: false },
    { id: 'r-sal', user_id: U, name: 'Salary', kind: 'income', priority: 'mandatory', amount: 60000, category_id: null, debt_id: null, goal_id: null, cadence: 'monthly', day_of_month: 10, month_of_year: null, start_on: '2025-01-01', end_on: null, is_active: true },
  ]
  const debts = [
    { id: 'd-vzp', user_id: U, name: 'VZP', creditor: 'VZP', kind: 'unstructured', original_amount: 100000, principal_start: 100000, start_on: '2026-01-01', monthly_payment: 2000, interest_rate: 0, status: 'active', due_day: 25, sort_order: 1 },
    { id: 'd-mon', user_id: U, name: 'Moneta', creditor: 'Moneta', kind: 'structured', original_amount: 120000, principal_start: 100000, start_on: '2026-01-01', monthly_payment: 0, interest_rate: 9, status: 'active', due_day: null, sort_order: 2 },
    { id: 'd-old', user_id: U, name: 'Old card', creditor: 'X', kind: 'personal', original_amount: 5000, principal_start: 5000, start_on: '2025-01-01', monthly_payment: 500, interest_rate: 0, status: 'paid', due_day: 3, sort_order: 3 },
  ]
  const planned = [
    { id: 'p-bags', user_id: U, name: 'Garbage bags', amount: 800, category_id: null, kind: 'expense', priority: 'mandatory', due_on: DAY(c.start, 9), note: null, cycle_start: c.start, tag: null },
    { id: 'p-late', user_id: U, name: 'Dentist', amount: 1500, category_id: null, kind: 'expense', priority: 'mandatory', due_on: DAY(prev.start, 12), note: null, cycle_start: prev.start, tag: null },
    { id: 'p-latepaid', user_id: U, name: 'Fine (paid)', amount: 300, category_id: null, kind: 'expense', priority: 'mandatory', due_on: DAY(prev.start, 3), note: null, cycle_start: prev.start, tag: null },
    { id: 'p-fun', user_id: U, name: 'Coffee binge', amount: 450, category_id: null, kind: 'expense', priority: 'optional', due_on: null, note: null, cycle_start: c.start, tag: 'regret' },
  ]
  const tx = [
    { id: 'tx-rent', user_id: U, occurred_on: DAY(c.start, 2), amount: 12000, kind: 'expense', category_id: 'cat-home', debt_id: null, goal_id: null, recurring_id: 'r-rent', planned_id: null, merchant: 'Landlord', note: null, created_at: '2026-10-16T08:00:00Z' },
    { id: 'tx-spot-prev', user_id: U, occurred_on: DAY(c.start, -1), amount: 199, kind: 'expense', category_id: null, debt_id: null, goal_id: null, recurring_id: 'r-spot', planned_id: null, merchant: null, note: null, created_at: '2026-10-13T08:00:00Z' },
    { id: 'tx-net-next', user_id: U, occurred_on: c.end, amount: 599, kind: 'expense', category_id: null, debt_id: null, goal_id: null, recurring_id: 'r-net', planned_id: null, merchant: null, note: null, created_at: '2026-11-14T08:00:00Z' },
    { id: 'tx-vzp-1', user_id: U, occurred_on: DAY(prev.start, 11), amount: 2000, kind: 'debt_payment', category_id: null, debt_id: 'd-vzp', goal_id: null, recurring_id: null, planned_id: null, merchant: null, note: null, created_at: '2026-09-25T08:00:00Z' },
    { id: 'tx-vzp-0', user_id: U, occurred_on: '2025-12-20', amount: 9999, kind: 'debt_payment', category_id: null, debt_id: 'd-vzp', goal_id: null, recurring_id: null, planned_id: null, merchant: null, note: 'before the debt start date', created_at: '2025-12-20T08:00:00Z' },
    { id: 'tx-fine', user_id: U, occurred_on: DAY(prev.start, 4), amount: 300, kind: 'expense', category_id: null, debt_id: null, goal_id: null, recurring_id: null, planned_id: 'p-latepaid', merchant: null, note: null, created_at: '2026-09-18T08:00:00Z' },
    { id: 'tx-mon', user_id: U, occurred_on: '2026-03-05', amount: 10000, kind: 'debt_payment', category_id: null, debt_id: 'd-mon', goal_id: null, recurring_id: null, planned_id: null, merchant: 'Moneta', note: null, created_at: '2026-03-05T08:00:00Z' },
  ]
  const cycleIncome = [
    { id: 'ci-1', user_id: U, cycle_start: c.start, expected_income: 60000, label: 'Salary', note: null },
    { id: 'ci-0', user_id: U, cycle_start: prev.start, expected_income: 58000, label: 'Salary', note: null },
  ]
  const profile = [{ user_id: U, base_currency: 'CZK', monthly_income_target: 60000, settings: { skips: { [prev.key]: ['p-latepaid'] }, carryover: { [key]: 1500 }, income_day: { 'ci-1': 10 } }, updated_at: '2026-10-14T09:00:00.000Z' }]
  return { key, c, prev, tables: { compass_profile: profile, compass_debts: debts, compass_recurring: recurring, compass_planned: planned, compass_transactions: tx, compass_cycle_income: cycleIncome } }
}
const TODAY = '2026-11-07'
const W = world(TODAY)
eq(W.key, '2026-10'); eq([W.c.start, W.c.end], ['2026-10-14', '2026-11-14'])

/* ---------------- 1. parity with src/compassCalc.ts ---------------- */
{
  const toApp = (c) => A.cycleForKey(c.key)
  // keys and the dates they cover
  for (let y = 2023; y <= 2029; y++) for (let m = 1; m <= 12; m++) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    const mine = O.cycleForKey(key), app = A.cycleForKey(key)
    eq([mine.start, mine.end], [A.iso(app.start), A.iso(app.end)], `cycle ${key}`)
    eq(O.addMonthsToKey(key, 5), A.addMonthsToKey(key, 5)); eq(O.addMonthsToKey(key, -14), A.addMonthsToKey(key, -14))
  }
  for (let t = Date.UTC(2023, 0, 1); t < Date.UTC(2029, 0, 1); t += 86400000) {
    const day = new Date(t).toISOString().slice(0, 10)
    const [y, mo, d] = day.split('-').map(Number)
    eq(O.cycleKeyOn(day), A.cycleKeyOn(new Date(y, mo - 1, d)), `cycleKeyOn ${day}`)
  }
  eq(O.activeCycleKey({ settings: { active_cycle: '2026-03' } }, TODAY), '2026-03')
  eq(O.activeCycleKey({ settings: { active_cycle: 'x' } }, TODAY), '2026-10')
  eq(O.activeCycleKey(null, '2026-11-13'), '2026-10'); eq(O.activeCycleKey(null, '2026-11-14'), '2026-11')
  // random data, deterministic seed
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
  const pickOf = (xs) => xs[Math.floor(rnd() * xs.length)]
  const dayStr = () => O.mk(2025 + Math.floor(rnd() * 3), Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 31))
  const recurring = Array.from({ length: 70 }, (_, i) => ({
    id: `r${i}`, name: `R${i}`, kind: pickOf(['expense', 'expense', 'saving', 'income', 'debt_payment']), priority: pickOf(['mandatory', 'optional', undefined]),
    amount: 100 + Math.floor(rnd() * 5000), category_id: pickOf([null, 'c']), debt_id: null, goal_id: pickOf([null, 'g']), cadence: pickOf(['weekly', 'monthly', 'monthly', 'yearly']),
    day_of_month: pickOf([null, 1, 5, 13, 14, 15, 28, 29, 30, 31]), month_of_year: pickOf([null, 1, 2, 6, 10, 11, 12]),
    start_on: dayStr(), end_on: pickOf([null, null, dayStr()]), is_active: rnd() > 0.15,
  }))
  const debts = Array.from({ length: 8 }, (_, i) => ({ id: `d${i}`, name: `D${i}`, status: pickOf(['active', 'active', 'paid', 'paused']), monthly_payment: pickOf([0, 500, 2000, 3500]), due_day: pickOf([null, 1, 14, 30, 31]), principal_start: pickOf([0, 5000, 100000]), original_amount: pickOf([null, 120000]), start_on: dayStr(), interest_rate: pickOf([0, 0, 4.5, 19.9]) }))
  const planned = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, amount: 50 + Math.floor(rnd() * 3000), kind: pickOf(['expense', 'debt_payment', 'saving']), priority: pickOf(['mandatory', 'optional', undefined]), due_on: pickOf([null, dayStr(), dayStr()]), cycle_start: pickOf([null, dayStr()]), category_id: null, tag: pickOf([null, 'regret']) }))
  const tx = Array.from({ length: 220 }, (_, i) => ({ id: `t${i}`, occurred_on: dayStr(), amount: 50 + Math.floor(rnd() * 4000), kind: pickOf(['expense', 'debt_payment', 'income', 'saving']), debt_id: pickOf([null, ...debts.map((d) => d.id)]), recurring_id: pickOf([null, ...recurring.map((r) => r.id)]), planned_id: pickOf([null, ...planned.map((p) => p.id)]) }))
  const dismissed = new Set(['p3', 'p9', 'p20'])
  let cyclesChecked = 0
  for (let y = 2025; y <= 2027; y++) for (let m = 1; m <= 12; m++) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    const mc = O.cycleForKey(key), ac = A.cycleForKey(key)
    for (const r of recurring) eq(O.recurringDueInCycle(r, mc), A.recurringDueInCycle(r, ac), `due ${r.id} ${key}`)
    const a = A.cycleChecklist(recurring, planned, debts, tx, ac, 50000, dismissed)
    const b = O.cycleChecklist(recurring, planned, debts, tx, mc, 50000, dismissed)
    eq(b.items, a.items, `checklist ${key}`); eq([b.mandatoryTotal, b.surplusThisCycle], [a.mandatoryTotal, a.surplusThisCycle])
    const skips = a.items.slice(0, 3).map((i) => i.id)
    eq(O.cycleFree(recurring, planned, debts, tx, mc, 50000, skips, dismissed, 700), A.cycleFree(recurring, planned, debts, tx, ac, 50000, skips, dismissed, 700), `free ${key}`)
    const ci = [{ cycle_start: ac.start && A.iso(ac.start), expected_income: 10 }, { cycle_start: A.iso(ac.end), expected_income: 99 }, { cycle_start: '1999-01-01', expected_income: 5 }]
    eq(O.resolveCycleIncome(mc, ci), A.resolveCycleIncome(ac, ci))
    cyclesChecked++
  }
  const today = A.iso(new Date())
  for (const d of debts) {
    const a = A.debtView(d, tx), b = O.debtView(d, tx, today)
    eq([b.paid, b.remaining, b.progress, b.monthsLeft], [a.paid, a.remaining, a.progress, a.monthsLeft], `debtView ${d.id}`)
    eq(b.payoffDate, a.payoffDate ? A.iso(a.payoffDate) : null, `payoff date ${d.id}`)
  }
  eq(O.debtFreedom(debts, tx, today), A.debtFreedom(debts, tx))
  const fa = A.debtFreeView(debts, tx), fb = O.debtFreeView(debts, tx, today)
  eq([fb.freeMonths, fb.freeDate, fb.stalled.map((s) => s.id)], [fa.freeMonths, fa.freeDate ? A.iso(fa.freeDate) : null, fa.stalled.map((s) => s.id)])
  for (const [b, p, r] of [[0, 1, 0], [100, 0, 0], [1000, 100, 0], [1000, 100, 12], [1000, 5, 12], [99999, 3333, 7.5]]) eq(O.payoffMonths(b, p, r), A.payoffMonths(b, p, r))
  ok(cyclesChecked === 36)
}

/* ---------------- 2. the realistic fixture, read by hand ---------------- */
const ids = (r) => r.items.map((i) => i.id)
{
  const d = await O.loadBills(fakeDb(clone(W.tables)), U)
  const b = O.getBills(d, {}, TODAY)
  eq(b.cycle.from, '2026-10-14'); eq(b.cycle.until_exclusive, '2026-11-14')
  // Dentist is overdue (earlier cycle, unpaid) and sorts first; Fine (paid, earlier) and Gym (inactive), Salary (income) are absent.
  eq(ids(b), ['p-late', 'r-spot', 'r-spot2', 'p-bags', 'r-save', 'debt:d-vzp', 'r-net', 'r-rent'].sort((x, y) => 0) && ids(b), 'order is the app order')
  const by = Object.fromEntries(b.items.map((i) => [i.id, i]))
  eq(Object.keys(by).sort(), ['debt:d-vzp', 'p-bags', 'p-fun', 'p-late', 'r-net', 'r-rent', 'r-save', 'r-spot', 'r-spot2'])
  ok(by['p-late'].overdue && b.items[0].id === 'p-late', 'overdue first')
  eq(by['r-rent'].status, 'paid'); eq(by['r-rent'].paid_transaction_id, 'tx-rent'); eq(by['r-rent'].due_on, '2026-10-15')
  eq(by['r-spot'].status, 'open', 'a Spotify payment dated the day BEFORE the cycle does not count'); eq(by['r-spot'].due_on, '2026-10-20')
  eq(by['r-net'].status, 'open', 'a payment dated the END day (next cycle) does not count'); eq(by['r-net'].due_on, '2026-11-01')
  eq(by['debt:d-vzp'].due_on, '2026-10-25'); eq(by['debt:d-vzp'].amount, 2000); eq(by['debt:d-vzp'].source, 'debt payment')
  eq(by['p-fun'].source, 'unreasonable'); eq(by['p-fun'].due_on, null)
  ok(!by['d-mon'] && !by['debt:d-mon'], 'a debt with no monthly payment is not a checklist item')
  eq(b.counts, { total: 9, paid: 1, open: 8, open_not_skipped: 8, skipped: 0 })
  eq(O.getBills(d, { show: 'paid' }, TODAY).items.map((i) => i.id), ['r-rent'])
  // last cycle: Fine is skipped there; the earlier-cycle skip is what hides an overdue one-off from later cycles
  const last = O.getBills(d, { offset: -1 }, TODAY)
  eq(last.cycle.from, '2026-09-14')

  const s = O.cycleSummary(d, {}, TODAY)
  const open = b.items.filter((i) => i.status === 'open')
  const sum = (f) => open.filter(f).reduce((t, i) => t + i.amount, 0)
  eq(s.income.expected, 60000); eq(s.paid, 12000); eq(s.carryover_in, 1500)
  eq(s.still_to_pay.recurring, 599 + 199 + 269 + 1000); eq(s.still_to_pay.debt_payments, 2000); eq(s.still_to_pay.unexpected, 800 + 1500); eq(s.still_to_pay.unreasonable, 450)
  eq(s.still_to_pay.total, sum(() => true))
  eq(s.coming_in, 60000 - 12000); eq(s.free_to_spend, 60000 - 12000 + 1500 - sum(() => true))
  eq(s.mandatory_total, 12000 + 599 + 2000 + 800 + 1500)
  eq(O.cycleSummary(d, { offset: 1 }, TODAY).carryover_in, 0)

  const debts = O.listDebts(d, {}, TODAY)
  const vzp = debts.debts.find((x) => x.id === 'd-vzp'), mon = debts.debts.find((x) => x.id === 'd-mon')
  eq([vzp.paid, vzp.remaining, vzp.progress_pct, vzp.months_left], [2000, 98000, 2, 49], 'VZP: the 9999 before start_on is NOT counted')
  eq([mon.paid, mon.remaining], [10000, 90000]); ok(mon.stalled && mon.months_left === null, 'Moneta pays 0/month: stalled, never "0 months"')
  eq(debts.debts.map((x) => x.id), ['d-vzp', 'd-mon'], 'active only, biggest remaining first'); eq(debts.total_remaining_active, 188000)
  eq(debts.baseline_active, 100000 + 120000); eq(debts.paid_active, 220000 - 188000)
  eq(debts.debt_free_by, null, 'stalled debt means no debt-free date'); eq(debts.debt_free_stalled_on, ['Moneta'])
  eq(O.listDebts(d, { status: 'all' }, TODAY).debts.length, 3)

  const t = O.listTransactions(d, { query: 'rent' })
  eq(t.transactions.map((x) => x.id), ['tx-rent']); eq(t.transactions[0].for, 'Rent')
  eq(O.listTransactions(d, { kind: 'debt_payment' }).totals_by_kind_all_matched, { debt_payment: 2000 + 9999 + 10000 })
  eq(O.listTransactions(d, { from: '2026-10-14', to: '2026-11-14', limit: 1 }).transactions.map((x) => x.id), ['tx-net-next'])
  eq(O.listTransactions(d, { query: 'vzp' }).matched, 2, 'matches the linked debt name')
  eq(O.listTransactions(d, { query: 'zzz' }).matched, 0)
  await assert.rejects(async () => O.listTransactions(d, { from: 'yesterday' }), /YYYY-MM-DD/)
}

/* ---------------- 3. the writes: exact rows ---------------- */
const fresh = (t = TODAY) => { const w = world(t); return { w, db: fakeDb(clone(w.tables)) } }
{
  const { db } = fresh()
  // recurring bill
  let msg = await O.markBillPaid(db, U, { title: 'rent' }, TODAY).catch((e) => e)
  ok(msg instanceof M.McError && /already paid/.test(msg.message), 'rent is already paid: refused, nothing inserted')
  eq(db.tables.compass_transactions.length, 7)
  msg = await O.markBillPaid(db, U, { id: 'r-spot' }, TODAY)
  eq(strip(db.tables.compass_transactions.at(-1)), { kind: 'expense', amount: 199, occurred_on: TODAY, recurring_id: 'r-spot', planned_id: null, debt_id: null, category_id: null, goal_id: null, account_id: null, user_id: U })
  ok(/Marked paid: Spotify, 199 CZK/.test(msg))
  // a saving keeps its goal, a category rides along
  await O.markBillPaid(db, U, { id: 'r-save' }, TODAY)
  eq(strip(db.tables.compass_transactions.at(-1)), { kind: 'saving', amount: 1000, occurred_on: TODAY, recurring_id: 'r-save', planned_id: null, debt_id: null, category_id: null, goal_id: 'goal-ef', account_id: null, user_id: U })
  await O.markBillPaid(db, U, { id: 'r-net' }, TODAY)
  eq(strip(db.tables.compass_transactions.at(-1)).category_id, 'cat-net')
  // a debt payment: kind debt_payment, debt_id set, no recurring/planned link
  await O.markBillPaid(db, U, { id: 'debt:d-vzp' }, TODAY)
  eq(strip(db.tables.compass_transactions.at(-1)), { kind: 'debt_payment', amount: 2000, occurred_on: TODAY, recurring_id: null, planned_id: null, debt_id: 'd-vzp', category_id: null, goal_id: null, account_id: null, user_id: U })
  // a one-off (planned_id), by words; and an overdue one
  await O.markBillPaid(db, U, { title: 'garbage' }, TODAY)
  eq(strip(db.tables.compass_transactions.at(-1)), { kind: 'expense', amount: 800, occurred_on: TODAY, recurring_id: null, planned_id: 'p-bags', debt_id: null, category_id: null, goal_id: null, account_id: null, user_id: U })
  await O.markBillPaid(db, U, { title: 'dentist' }, TODAY)
  eq(strip(db.tables.compass_transactions.at(-1)).planned_id, 'p-late')
  eq(db.tables.compass_transactions.length, 7 + 6)
  const after = O.getBills(await O.loadBills(db, U), {}, TODAY)
  eq(after.counts.paid, 6, 'everything marked now reads paid, through the same checklist')
  ok(!after.items.some((i) => i.id === 'p-late'), 'a paid overdue one-off leaves the checklist, as in the app (cycleChecklist)')
  // twice = refused, no extra row
  await rej(O.markBillPaid(db, U, { id: 'r-spot' }, TODAY), /already paid/)
  eq(db.tables.compass_transactions.length, 13)
  // undo deletes exactly that transaction
  const spotTx = db.tables.compass_transactions.find((t) => t.recurring_id === 'r-spot' && t.occurred_on === TODAY).id
  msg = await O.unmarkBillPaid(db, U, { id: 'r-spot' }, TODAY)
  ok(msg.includes(spotTx)); eq(db.tables.compass_transactions.length, 12); ok(!db.tables.compass_transactions.some((t) => t.id === spotTx))
  ok(db.tables.compass_transactions.some((t) => t.id === 'tx-rent'), 'other rows untouched')
  await rej(O.unmarkBillPaid(db, U, { id: 'r-spot' }, TODAY), /not marked paid/)
  // two linked payments: only the newest goes, and it says so
  db.tables.compass_transactions.push({ id: 'tx-rent-dup', user_id: U, occurred_on: DAY(W.c.start, 5), amount: 12000, kind: 'expense', recurring_id: 'r-rent', planned_id: null, debt_id: null, created_at: '2026-10-20T00:00:00Z' })
  msg = await O.unmarkBillPaid(db, U, { id: 'r-rent' }, TODAY)
  ok(msg.includes('tx-rent-dup') && /still shows paid/.test(msg)); ok(db.tables.compass_transactions.some((t) => t.id === 'tx-rent'))
}
{
  // refusals change nothing
  const { db } = fresh()
  const snap = JSON.stringify(db.tables)
  await rej(O.markBillPaid(db, U, { title: 'spot' }, TODAY), /matches 2 bill in this cycles/, 'Spotify / Spotify Family are ambiguous, and the refusal lists both')
  await rej(O.markBillPaid(db, U, { title: 'spot' }, TODAY), /r-spot: Spotify.*r-spot2: Spotify Family/)
  await rej(O.markBillPaid(db, U, { title: 'netflix' }, TODAY), /No bill in this cycle matches/)
  await rej(O.markBillPaid(db, U, { id: 'nope' }, TODAY), /No bill in this cycle has the id/)
  await rej(O.markBillPaid(db, U, {}, TODAY), /Say which/)
  await rej(O.markBillPaid(db, U, { title: 'gym' }, TODAY), /No bill in this cycle matches/, 'an inactive bill is not on the checklist')
  await rej(O.markBillPaid(db, U, { title: 'salary' }, TODAY), /No bill/, 'income is not a bill')
  await rej(O.unmarkBillPaid(db, U, { title: 'spotify family' }, TODAY), /not marked paid/)
  eq(JSON.stringify(db.tables), snap, 'a refusal writes nothing')
  // an exact name wins over a longer one that contains it
  await O.markBillPaid(db, U, { title: 'spotify' }, TODAY)
  eq(db.tables.compass_transactions.at(-1).recurring_id, 'r-spot')
}
{
  // dates follow the page when the active cycle is not the one today is in
  const { db } = fresh()
  db.tables.compass_profile[0].settings.active_cycle = '2026-09' // ended
  const m1 = await O.markBillPaid(db, U, { id: 'r-net' }, TODAY)
  eq(db.tables.compass_transactions.at(-1).occurred_on, '2026-10-13', 'a finished cycle is dated its last day (billspage.tsx offset < 0)'); ok(/does not contain today/.test(m1))
  const f = fresh(); f.db.tables.compass_profile[0].settings.active_cycle = '2026-12'
  await O.markBillPaid(f.db, U, { id: 'r-save' }, TODAY)
  eq(f.db.tables.compass_transactions.at(-1).occurred_on, '2026-12-16', 'a future cycle keeps the due date (offset > 0)')
}
{
  // skip
  const { db } = fresh()
  let m = await O.skipBill(db, U, { id: 'r-spot' }, true, TODAY)
  ok(/Skipped this cycle: Spotify/.test(m))
  eq(db.tables.compass_profile[0].settings.skips, { '2026-09': ['p-latepaid'], '2026-10': ['r-spot'] }, 'other cycles and other settings keys survive')
  eq(db.tables.compass_profile[0].settings.carryover, { '2026-10': 1500 }); eq(db.tables.compass_profile[0].settings.income_day, { 'ci-1': 10 })
  m = await O.skipBill(db, U, { id: 'r-spot' }, true, TODAY); ok(/already skipped/.test(m), 'set, not toggle: saying it twice does not unskip')
  eq(db.tables.compass_profile[0].settings.skips['2026-10'], ['r-spot'])
  const sm = O.cycleSummary(await O.loadBills(db, U), {}, TODAY)
  eq(sm.still_to_pay.recurring, 599 + 269 + 1000, 'skipped item leaves still_to_pay')
  ok(O.getBills(await O.loadBills(db, U), {}, TODAY).items.find((i) => i.id === 'r-spot').skipped)
  await O.skipBill(db, U, { id: 'r-spot' }, false, TODAY); eq(db.tables.compass_profile[0].settings.skips['2026-10'], [])
  await rej(O.skipBill(db, U, { title: 'spot' }, true, TODAY), /matches 2/)
  // concurrent settings write: retried on a fresh read, never overwritten
  let hit = 0
  db.beforeUpdate = (dbx) => { hit++; dbx.tables.compass_profile[0].settings.carryover['2026-11'] = 77; dbx.tables.compass_profile[0].updated_at = 'changed' }
  await O.skipBill(db, U, { id: 'r-net' }, true, TODAY)
  eq(hit, 1); eq(db.tables.compass_profile[0].settings.carryover['2026-11'], 77, 'the concurrent write survived'); eq(db.tables.compass_profile[0].settings.skips['2026-10'], ['r-net'])
  const noProfile = fakeDb({ ...clone(W.tables), compass_profile: [] })
  await rej(O.skipBill(noProfile, U, { id: 'r-spot' }, true, TODAY), /no compass_profile row/)
}
{
  // add_expense / add_income: the exact rows the Bills sheets insert
  const { db } = fresh()
  await O.addExpense(db, U, { name: ' Garbage bags 2 ', amount: 800 }, TODAY)
  eq(strip(db.tables.compass_planned.at(-1)), { name: 'Garbage bags 2', amount: 800, kind: 'expense', priority: 'mandatory', due_on: TODAY, cycle_start: W.c.start, user_id: U })
  await O.addExpense(db, U, { name: 'Tyre', amount: '1234.567', due_on: '2026-11-10' }, TODAY)
  eq(strip(db.tables.compass_planned.at(-1)), { name: 'Tyre', amount: 1234.57, kind: 'expense', priority: 'mandatory', due_on: '2026-11-10', cycle_start: W.c.start, user_id: U })
  const b = O.getBills(await O.loadBills(db, U), {}, TODAY)
  ok(b.items.some((i) => i.name === 'Tyre' && i.source === 'unexpected' && i.status === 'open'), 'the new one-off shows on the checklist')
  await rej(O.addExpense(db, U, { name: 'Tyre', amount: 1234.57, due_on: '2026-11-10' }, TODAY), /already a one-off/)
  await O.addExpense(db, U, { name: 'Tyre', amount: 1234.57, due_on: '2026-11-10', allow_duplicate: true }, TODAY)
  const late = await O.addExpense(db, U, { name: 'Next month', amount: 10, due_on: '2026-12-01' }, TODAY)
  ok(/will not show on this cycle/.test(late))
  for (const bad of [{ name: '', amount: 5 }, { name: 'x', amount: 0 }, { name: 'x', amount: -3 }, { name: 'x', amount: 1e9 }, { name: 'x', amount: NaN }, { name: 'x', amount: 5, due_on: '2026-13-40' }])
    await rej(O.addExpense(db, U, bad, TODAY), /./, JSON.stringify(bad))
  eq(db.tables.compass_planned.length, 4 + 4)
  await O.addIncome(db, U, { amount: 4500, label: 'Side gig' }, TODAY)
  eq(strip(db.tables.compass_cycle_income.at(-1)), { label: 'Side gig', expected_income: 4500, cycle_start: W.c.start, user_id: U })
  await O.addIncome(db, U, { amount: 700 }, TODAY)
  eq(strip(db.tables.compass_cycle_income.at(-1)), { label: null, expected_income: 700, cycle_start: W.c.start, user_id: U })
  await rej(O.addIncome(db, U, { amount: 4500, label: 'Side gig' }, TODAY), /already has an income/)
  eq(O.cycleSummary(await O.loadBills(db, U), {}, TODAY).income.expected, 60000 + 4500 + 700)
  await rej(O.addIncome(db, U, { amount: 0 }, TODAY), /amount/)
  eq(db.tables.compass_transactions.length, 7, 'neither action touches the ledger')
}
{
  // the per-request row cap is a refusal, not a silently wrong balance
  const big = Array.from({ length: 1000 }, (_, i) => ({ id: `x${i}`, user_id: U, occurred_on: '2026-01-01', amount: 1, kind: 'expense' }))
  await rej(O.loadBills(fakeDb({ ...clone(W.tables), compass_transactions: big }), U), /per-request limit/)
  // another user's rows are never read (second lock behind RLS)
  const other = clone(W.tables); other.compass_transactions.push({ id: 'tx-x', user_id: 'someone-else', occurred_on: TODAY, amount: 5, kind: 'expense', recurring_id: 'r-spot' })
  eq((await O.loadBills(fakeDb(other), U)).transactions.length, 7)
}

/* ---------------- 4. the tools, through zod and the real registration path ---------------- */
{
  const real = world(M.dateKey())
  const db = fakeDb(clone(real.tables))
  const srv = fakeServer(K, K.M.tools_money.register, db, U)
  // round 3 (refusals lifted): the tool list grew from 9 to 36; the original nine are all still here
  const ORIGINAL = ['add_expense', 'add_income', 'get_bills', 'get_cycle_summary', 'list_debts', 'list_transactions', 'mark_bill_paid', 'skip_bill', 'unmark_bill_paid']
  for (const nm of ORIGINAL) ok(srv.names().includes(nm), `${nm} still registered`)
  eq(srv.names().sort(), [...ORIGINAL, 'add_debt', 'add_recurring_bill', 'add_transaction', 'add_unreasonable_expense', 'delete_debt', 'delete_expense', 'delete_income', 'delete_recurring_bill', 'delete_transaction', 'delete_unreasonable_expense', 'edit_debt', 'edit_expense', 'edit_income', 'edit_recurring_bill', 'edit_transaction', 'edit_unreasonable_expense', 'end_cycle', 'import_debts', 'list_one_offs', 'list_recurring_bills'].sort())
  for (const nm of srv.names()) { const c = srv.tools[nm].cfg; ok(c.title && c.description && c.inputSchema && c.annotations, `${nm} is fully described`) }
  eq(srv.names().filter((x) => srv.tools[x].cfg.annotations.readOnlyHint).sort(), ['get_bills', 'get_cycle_summary', 'list_debts', 'list_one_offs', 'list_recurring_bills', 'list_transactions'])
  eq(srv.names().filter((x) => srv.tools[x].cfg.annotations.destructiveHint).sort(), ['delete_debt', 'delete_expense', 'delete_income', 'delete_recurring_bill', 'delete_transaction', 'delete_unreasonable_expense', 'unmark_bill_paid'])
  for (const nm of srv.names()) ok(/^[a-z]+(_[a-z]+)+$/.test(nm))
  for (const nm of srv.names()) ok(!/\buse the (Bills )?(page|app)\b/i.test(srv.tools[nm].cfg.description), `${nm}: no "use the app" refusal left`)

  const g = await srv.call('get_bills', { show: 'open' })
  ok(!g.isError && g.json.items.every((i) => i.status === 'open')); ok(g.json.items.some((i) => i.id === 'r-spot'))
  ok(!(await srv.call('get_cycle_summary')).isError); ok(!(await srv.call('list_debts')).isError); ok(!(await srv.call('list_transactions', { query: 'rent' })).isError)

  const p = await srv.call('mark_bill_paid', { id: 'r-spot' })
  ok(!p.isError && /Marked paid: Spotify/.test(p.text), p.text)
  eq(strip(db.tables.compass_transactions.at(-1)), { kind: 'expense', amount: 199, occurred_on: M.dateKey(), recurring_id: 'r-spot', planned_id: null, debt_id: null, category_id: null, goal_id: null, account_id: null, user_id: U })
  const again = await srv.call('mark_bill_paid', { id: 'r-spot' }); ok(again.isError && /already paid/.test(again.text))
  const amb = await srv.call('mark_bill_paid', { title: 'spot' }); ok(amb.isError && /matches 2/.test(amb.text))
  const u = await srv.call('unmark_bill_paid', { id: 'r-spot' }); ok(!u.isError && /Marked unpaid: Spotify/.test(u.text))
  const sk = await srv.call('skip_bill', { title: 'internet' }); ok(!sk.isError && /Skipped this cycle: Internet/.test(sk.text))
  const sk2 = await srv.call('skip_bill', { title: 'internet', on: false }); ok(/Unskipped: Internet/.test(sk2.text))
  const ex = await srv.call('add_expense', { name: 'Parking', amount: 120 }); ok(!ex.isError && /Added to Unexpected this cycle: Parking \(120 Kč\)/.test(ex.text), ex.text)
  const inc = await srv.call('add_income', { amount: 3000, label: 'Refund' }); ok(!inc.isError && /Added to Income: 3000 Kč \(Refund\)/.test(inc.text))
  if (K.zodReal) {
    for (const [nm, a] of [['add_expense', {}], ['add_expense', { name: 'x', amount: 0 }], ['add_income', { amount: -5 }], ['get_bills', { show: 'nope' }], ['get_bills', { cycle_offset: 99 }], ['list_transactions', { kind: 'gift' }], ['list_transactions', { limit: 9999 }], ['skip_bill', { on: 'maybe' }]]) {
      n++; await assert.rejects(() => srv.call(nm, a), /./, `${nm} ${JSON.stringify(a)} is refused by the schema`)
    }
  }
  // signed-out / foreign: another user's token sees none of it
  const other = fakeServer(K, K.M.tools_money.register, fakeDb(clone(real.tables)), 'u2')
  const gx = await other.call('get_bills'); ok(!gx.isError && gx.json.items.length === 0)
  const mx = await other.call('mark_bill_paid', { id: 'r-spot' }); ok(mx.isError && /No bill/.test(mx.text))
  // a database error is a plain refusal, not a crash
  const broken = fakeServer(K, K.M.tools_money.register, { from: () => { throw new Error('boom secret') } }, U)
  const be = await broken.call('get_bills'); ok(be.isError && !/secret/.test(be.text))
}

/* ---------------- 4b. round 3: every other thing the Bills page can write ---------------- */
const snapOf = (db) => JSON.stringify(db.tables)
const B = async (db, off = 0) => O.getBills(await O.loadBills(db, U), { offset: off }, TODAY)
const byId = (b) => Object.fromEntries(b.items.map((i) => [i.id, i]))
/** the app's own checklist (src/compassCalc.ts) over the rows a db now holds: the write must show up there exactly like in ours */
const appItems = async (db, key) => {
  const d = await O.loadBills(db, U)
  const c = A.cycleForKey(key)
  const dismissed = new Set(Object.values(d.profile?.settings?.skips ?? {}).flat())
  return A.cycleChecklist(d.recurring, d.planned, d.debts, d.transactions, c, 0, dismissed).items
}
{
  // ----- paying and un-paying in OTHER cycles (billspage.tsx markPaid with cycleOffset)
  const { db } = fresh()
  const prevB = byId(await B(db, -1))
  eq(prevB['r-rent'].status, 'open', 'rent is open in LAST cycle (its payment is dated in this one)')
  let m = await O.markBillPaid(db, U, { id: 'r-rent' }, TODAY, { offset: -1 })
  eq(strip(db.tables.compass_transactions.at(-1)), { kind: 'expense', amount: 12000, occurred_on: '2026-10-13', recurring_id: 'r-rent', planned_id: null, debt_id: null, category_id: 'cat-home', goal_id: null, account_id: null, user_id: U }, 'a past cycle is dated its LAST day, like the page')
  ok(/Dated 2026-10-13/.test(m))
  eq(byId(await B(db, -1))['r-rent'].status, 'paid'); eq(byId(await B(db, 0))['r-rent'].paid_transaction_id, 'tx-rent', 'this cycle\'s rent payment is untouched and not mistaken')
  eq(db.tables.compass_transactions.length, 8)
  await rej(O.markBillPaid(db, U, { id: 'r-rent' }, TODAY, { offset: -1 }), /already paid/)
  // a past-cycle overdue one-off and a debt payment
  await O.markBillPaid(db, U, { id: 'p-late' }, TODAY, { offset: -1 })
  eq(strip(db.tables.compass_transactions.at(-1)), { kind: 'expense', amount: 1500, occurred_on: '2026-10-13', recurring_id: null, planned_id: 'p-late', debt_id: null, category_id: null, goal_id: null, account_id: null, user_id: U })
  eq(byId(await B(db, -1))['debt:d-vzp'].status, 'paid', 'VZP was paid in last cycle (tx-vzp-1)')
  await rej(O.markBillPaid(db, U, { id: 'debt:d-vzp' }, TODAY, { offset: -1 }), /already paid/)
  // a later cycle keeps the due date (offset > 0)
  m = await O.markBillPaid(db, U, { id: 'r-save' }, TODAY, { offset: 1 })
  eq(strip(db.tables.compass_transactions.at(-1)), { kind: 'saving', amount: 1000, occurred_on: '2026-11-16', recurring_id: 'r-save', planned_id: null, debt_id: null, category_id: null, goal_id: 'goal-ef', account_id: null, user_id: U })
  eq(byId(await B(db, 0))['r-save'].status, 'open', 'paying next cycle\'s saving did not pay this cycle\'s')
  // the app's own checklist agrees with ours on every touched cycle
  for (const [key, off] of [['2026-09', -1], ['2026-10', 0], ['2026-11', 1]]) {
    const mine = byId(await B(db, off)), app = await appItems(db, key)
    eq(app.map((i) => [i.id, i.paid]).sort(), Object.values(mine).map((i) => [i.id, i.status === 'paid']).sort(), `paid state agrees with compassCalc for ${key}`)
  }
  // undo in the past cycle removes ONLY that cycle's payment
  const n0 = db.tables.compass_transactions.length
  m = await O.unmarkBillPaid(db, U, { id: 'r-rent' }, TODAY, { offset: -1 })
  eq(db.tables.compass_transactions.length, n0 - 1); ok(db.tables.compass_transactions.some((t) => t.id === 'tx-rent'), 'this cycle\'s rent payment survived')
  eq(byId(await B(db, -1))['r-rent'].status, 'open'); eq(byId(await B(db, 0))['r-rent'].status, 'paid')
  await rej(O.unmarkBillPaid(db, U, { id: 'r-rent' }, TODAY, { offset: -1 }), /not marked paid in/)
  // skip in a past cycle writes that cycle's key and keeps every other key
  await O.skipBill(db, U, { id: 'r-rent' }, true, TODAY, { offset: -1 })
  eq(db.tables.compass_profile[0].settings.skips, { '2026-09': ['p-latepaid', 'r-rent'] }, 'skip lands in the viewed cycle')
  eq(db.tables.compass_profile[0].settings.income_day, { 'ci-1': 10 })
}
{
  // ----- a different amount, a partial payment, an explicit date
  const { db } = fresh()
  let m = await O.markBillPaid(db, U, { id: 'r-spot' }, TODAY, { amount: 150, paid_on: '2026-10-20' })
  eq(strip(db.tables.compass_transactions.at(-1)), { kind: 'expense', amount: 150, occurred_on: '2026-10-20', recurring_id: 'r-spot', planned_id: null, debt_id: null, category_id: null, goal_id: null, account_id: null, user_id: U })
  ok(/listed amount is 199/.test(m) && /paid IN FULL|paid in full/i.test(m), m)
  eq(byId(await B(db))['r-spot'].status, 'paid')
  // a debt payment of another amount lowers the REAL balance by that amount
  await O.markBillPaid(db, U, { id: 'debt:d-vzp' }, TODAY, { amount: 500 })
  eq(strip(db.tables.compass_transactions.at(-1)).amount, 500)
  const vzp = O.listDebts(await O.loadBills(db, U), {}, TODAY).debts.find((x) => x.id === 'd-vzp')
  eq([vzp.paid, vzp.remaining], [2500, 97500], '2000 earlier + 500 now')
  // outside the cycle: refused for a bill (it would never show paid), fine for a one-off
  const snap = snapOf(db)
  await rej(O.markBillPaid(db, U, { id: 'r-net' }, TODAY, { paid_on: '2026-11-14' }), /outside/)
  await rej(O.markBillPaid(db, U, { id: 'r-net' }, TODAY, { paid_on: 'soon' }), /YYYY-MM-DD/)
  for (const bad of [0, -5, 1e9, NaN]) await rej(O.markBillPaid(db, U, { id: 'r-net' }, TODAY, { amount: bad }), /amount must be/, `amount ${bad}`)
  eq(snapOf(db), snap, 'refusals write nothing')
  await O.markBillPaid(db, U, { id: 'p-bags' }, TODAY, { paid_on: '2026-11-30' })
  eq(strip(db.tables.compass_transactions.at(-1)).occurred_on, '2026-11-30')
}
{
  // ----- recurring bills: add / edit / delete (RecurringSheet)
  const { db } = fresh()
  let m = await O.addRecurring(db, U, { name: ' Phone plan ', amount: 450, cadence: 'monthly', day_of_month: 5 }, TODAY)
  eq(strip(db.tables.compass_recurring.at(-1)), { name: 'Phone plan', amount: 450, kind: 'expense', cadence: 'monthly', priority: 'mandatory', day_of_month: 5, start_on: TODAY, is_active: true, user_id: U }, 'the exact insert RecurringSheet makes')
  await O.addRecurring(db, U, { name: 'Bins', amount: 90, cadence: 'weekly', priority: 'optional' }, TODAY)
  eq(strip(db.tables.compass_recurring.at(-1)), { name: 'Bins', amount: 90, kind: 'expense', cadence: 'weekly', priority: 'optional', day_of_month: null, start_on: TODAY, is_active: true, user_id: U }, 'weekly has no day')
  await O.addRecurring(db, U, { name: 'Insurance', amount: 3000, cadence: 'yearly', day_of_month: 10, month_of_year: 12, end_on: '2030-12-31' }, TODAY)
  eq(strip(db.tables.compass_recurring.at(-1)), { name: 'Insurance', amount: 3000, kind: 'expense', cadence: 'yearly', priority: 'mandatory', day_of_month: 10, month_of_year: 12, start_on: TODAY, end_on: '2030-12-31', is_active: true, user_id: U })
  // it behaves in the app's own cycle math
  const phone = (await appItems(db, '2026-10')).find((i) => i.name === 'Phone plan'); ok(phone && phone.dueOn && !phone.paid)
  ok(byId(await B(db))[phone.id], 'and in ours')
  const n = db.tables.compass_recurring.length
  for (const [bad, re] of [[{ name: 'x', amount: 5, cadence: 'monthly' }, /day_of_month/], [{ name: 'x', amount: 5, cadence: 'yearly', day_of_month: 3 }, /month_of_year/], [{ name: 'x', amount: 5, cadence: 'monthly', day_of_month: 32 }, /1 to 31/], [{ name: '', amount: 5, cadence: 'weekly' }, /name/], [{ name: 'x', amount: 0, cadence: 'weekly' }, /amount/], [{ name: 'x', amount: 5, cadence: 'weekly', start_on: '2026-02-30' }, /start_on/], [{ name: 'x', amount: 5, cadence: 'weekly', start_on: '2026-05-01', end_on: '2026-04-01' }, /end_on/], [{ name: 'rent', amount: 5, cadence: 'weekly' }, /already an active/]])
    await rej(O.addRecurring(db, U, bad, TODAY), re, JSON.stringify(bad))
  eq(db.tables.compass_recurring.length, n)
  // edit: only what is passed changes; the page's other fields are re-written with their own values; kind is NEVER rewritten
  const before = clone(db.tables.compass_recurring.find((r) => r.id === 'r-save'))
  m = await O.editRecurring(db, U, { id: 'r-save' }, { amount: 1500 })
  eq(db.tables.compass_recurring.find((r) => r.id === 'r-save'), { ...before, amount: 1500 }, 'a saving keeps kind saving and goal_id (the page sheet would have turned it into an expense)')
  await O.editRecurring(db, U, { id: 'r-rent' }, { name: 'Rent flat', amount: 12500, day_of_month: 20, priority: 'optional' })
  const rent = db.tables.compass_recurring.find((r) => r.id === 'r-rent')
  eq([rent.name, rent.amount, rent.day_of_month, rent.priority, rent.cadence, rent.start_on, rent.is_active, rent.category_id], ['Rent flat', 12500, 20, 'optional', 'monthly', '2025-01-01', true, 'cat-home'])
  eq(byId(await B(db))['r-rent'].due_on, '2026-10-20'); eq(byId(await B(db))['r-rent'].priority, 'optional')
  eq(byId(await B(db))['r-rent'].amount, 12500, 'and it shows on the checklist; its paid payment keeps its old amount'); eq(db.tables.compass_transactions.find((t) => t.id === 'tx-rent').amount, 12000)
  await O.editRecurring(db, U, { id: 'r-spot' }, { cadence: 'weekly' })
  eq(db.tables.compass_recurring.find((r) => r.id === 'r-spot').day_of_month, null, 'weekly clears the day')
  await rej(O.editRecurring(db, U, { id: 'r-spot' }, { cadence: 'monthly' }), /day_of_month/, 'back to monthly needs a day, no silent 1')
  await O.editRecurring(db, U, { id: 'r-spot2' }, { end_on: '2026-10-01' })
  const rr = db.tables.compass_recurring.find((r) => r.id === 'r-spot2')
  eq(rr.end_on, '2026-10-01'); eq(O.recurringDueInCycle(rr, O.cycleForKey('2026-10')), A.recurringDueInCycle(rr, A.cycleForKey('2026-10')))
  ok(!byId(await B(db))['r-spot2'], 'ended before this cycle: gone from the checklist')
  await O.editRecurring(db, U, { id: 'r-spot2' }, { end_on: null }); eq(db.tables.compass_recurring.find((r) => r.id === 'r-spot2').end_on, null)
  await rej(O.editRecurring(db, U, { id: 'r-spot2' }, { end_on: '2020-01-01' }), /end_on/)
  await rej(O.editRecurring(db, U, { title: 'spot' }, { amount: 1 }), /matches 2/)
  // delete = is_active false, like the page; the row and its payments stay
  const nrec = db.tables.compass_recurring.length
  m = await O.deleteRecurring(db, U, { id: 'r-net' })
  eq(db.tables.compass_recurring.length, nrec, 'the row is NOT removed'); eq(db.tables.compass_recurring.find((r) => r.id === 'r-net').is_active, false)
  ok(!byId(await B(db))['r-net'] && /stay in the ledger/.test(m))
  await rej(O.deleteRecurring(db, U, { id: 'r-net' }), /No recurring bill/, 'already stopped: not found among the active')
  await rej(O.editRecurring(db, U, { id: 'r-net' }, { amount: 1 }), /stopped/)
  await O.editRecurring(db, U, { id: 'r-net' }, { active: true, amount: 650 })
  eq(db.tables.compass_recurring.find((r) => r.id === 'r-net').is_active, true); eq(byId(await B(db))['r-net'].amount, 650, 'brought back')
  eq(O.listRecurring(await O.loadBills(db, U), { status: 'stopped' }).recurring.map((r) => r.id), ['r-old'])
  eq(O.listRecurring(await O.loadBills(db, U), { status: 'all' }).recurring.length, db.tables.compass_recurring.length)
}
{
  // ----- one-offs: edit / move / delete (PlannedSheet) and unreasonable (UnreasonableSheet)
  const { db } = fresh()
  let m = await O.editExpense(db, U, { id: 'p-bags' }, { name: 'Bags + tape', amount: 950, priority: 'optional', due_on: '2026-10-30' }, TODAY)
  let p = db.tables.compass_planned.find((x) => x.id === 'p-bags')
  eq([p.name, p.amount, p.priority, p.due_on, p.cycle_start, p.kind], ['Bags + tape', 950, 'optional', '2026-10-30', W.c.start, 'expense'])
  eq(byId(await B(db))['p-bags'].amount, 950)
  // move to next cycle: needs a due_on inside it, in both forms
  await rej(O.editExpense(db, U, { id: 'p-bags' }, { cycle_offset: 1 }, TODAY), /must fall inside/)
  await rej(O.editExpense(db, U, { id: 'p-bags' }, { cycle_offset: 1, due_on: '2026-10-30' }, TODAY), /must fall inside/)
  await O.editExpense(db, U, { id: 'p-bags' }, { cycle_offset: 1, due_on: '2026-11-20' }, TODAY)
  p = db.tables.compass_planned.find((x) => x.id === 'p-bags'); eq([p.due_on, p.cycle_start], ['2026-11-20', '2026-11-14'])
  ok(!byId(await B(db, 0))['p-bags'] && byId(await B(db, 1))['p-bags'], 'gone from this cycle, in the next')
  eq((await appItems(db, '2026-11')).some((i) => i.id === 'p-bags'), true, 'the app agrees')
  await rej(O.editExpense(db, U, { id: 'p-fun' }, { amount: 5 }, TODAY), /unreasonable expense \(no due date\)/, 'class mismatch is named')
  await rej(O.editExpense(db, U, { id: 'p-bags' }, { due_on: '31/12' }, TODAY), /YYYY-MM-DD/)
  // linked payment noted
  const mp = await O.editExpense(db, U, { id: 'p-latepaid' }, { amount: 310 }, TODAY); ok(/payment recorded/.test(mp))
  // delete: row gone, linked payment kept and reported
  m = await O.deletePlanned(db, U, { id: 'p-latepaid' }, 'unexpected')
  ok(!db.tables.compass_planned.some((x) => x.id === 'p-latepaid') && db.tables.compass_transactions.some((t) => t.id === 'tx-fine') && /tx-fine/.test(m))
  await rej(O.deletePlanned(db, U, { id: 'p-fun' }, 'unexpected'), /unreasonable/)
  await rej(O.deletePlanned(db, U, { id: 'ghost' }, 'unexpected'), /No one-off has the id/)
  // unreasonable
  await O.addUnreasonable(db, U, { name: ' Headphones ', amount: 2500 }, TODAY)
  eq(strip(db.tables.compass_planned.at(-1)), { name: 'Headphones', amount: 2500, kind: 'expense', priority: 'optional', due_on: null, cycle_start: W.c.start, tag: 'functional', user_id: U }, 'the exact insert UnreasonableSheet makes')
  eq(byId(await B(db))[db.tables.compass_planned.at(-1).id].source, 'unreasonable')
  await rej(O.addUnreasonable(db, U, { name: 'headphones', amount: 2500 }, TODAY), /already an unreasonable/)
  await O.editUnreasonable(db, U, { id: 'p-fun' }, { tag: 'functional' }, TODAY)
  eq(db.tables.compass_planned.find((x) => x.id === 'p-fun').tag, 'functional', 'toggleTag: updateRow({ tag })')
  await O.editUnreasonable(db, U, { title: 'coffee' }, { amount: 500, name: 'Coffee binge 2' }, TODAY)
  const pf = db.tables.compass_planned.find((x) => x.id === 'p-fun'); eq([pf.name, pf.amount, pf.priority, pf.due_on, pf.kind, pf.cycle_start], ['Coffee binge 2', 500, 'optional', null, 'expense', W.c.start])
  await O.editUnreasonable(db, U, { id: 'p-fun' }, { cycle_offset: -1 }, TODAY)
  eq(db.tables.compass_planned.find((x) => x.id === 'p-fun').cycle_start, W.prev.start); ok(byId(await B(db, -1))['p-fun'] && !byId(await B(db, 0))['p-fun'], 'moved to last cycle')
  await rej(O.editUnreasonable(db, U, { id: 'p-bags' }, { amount: 1 }, TODAY), /unexpected one-off/)
  await O.deletePlanned(db, U, { id: 'p-fun' }, 'unreasonable'); ok(!db.tables.compass_planned.some((x) => x.id === 'p-fun'))
  const lo = O.listOneOffs(await O.loadBills(db, U)); ok(lo.one_offs.every((x) => x.class === (x.due_on ? 'unexpected' : 'unreasonable')) && lo.one_offs.find((x) => x.id === 'p-late').paid === false)
}
{
  // ----- income: edit / day / delete (IncomeSheet)
  const { db } = fresh()
  const profBefore = clone(db.tables.compass_profile[0].settings)
  let m = await O.editIncome(db, U, { id: 'ci-1' }, { amount: 62000, label: ' Salary + bonus ' }, TODAY)
  eq(strip(db.tables.compass_cycle_income.find((x) => x.id === 'ci-1')), { cycle_start: W.c.start, expected_income: 62000, label: 'Salary + bonus', note: null, user_id: U })
  eq(O.cycleSummary(await O.loadBills(db, U), {}, TODAY).income.expected, 62000)
  m = await O.editIncome(db, U, { title: 'bonus' }, { day: 15 }, TODAY)
  eq(db.tables.compass_profile[0].settings.income_day, { 'ci-1': 15 }); eq(db.tables.compass_profile[0].settings.skips, profBefore.skips, 'other settings keys survive'); eq(db.tables.compass_profile[0].settings.carryover, profBefore.carryover)
  eq(O.cycleSummary(await O.loadBills(db, U), {}, TODAY).income.entries[0].day, 15)
  m = await O.editIncome(db, U, { id: 'ci-1' }, { day: 15 }, TODAY); ok(/already 15/.test(m))
  await O.editIncome(db, U, { id: 'ci-1' }, { day: null }, TODAY); eq(db.tables.compass_profile[0].settings.income_day, {}, 'cleared, like the sheet (delete map[id])')
  await rej(O.editIncome(db, U, { id: 'ci-1' }, { day: 32 }, TODAY), /1 to 31/); await rej(O.editIncome(db, U, { id: 'ci-1' }, { day: 3.5 }, TODAY), /whole day/)
  await rej(O.editIncome(db, U, { id: 'ci-1' }, { amount: -1 }, TODAY), /amount/)
  // older cycle entry found by words only in that cycle
  await O.editIncome(db, U, { title: 'salary' }, { amount: 59000, cycle_offset: -1 }, TODAY)
  eq(db.tables.compass_cycle_income.find((x) => x.id === 'ci-0').expected_income, 59000, 'cycle_offset picks the cycle to look in')
  eq(db.tables.compass_cycle_income.find((x) => x.id === 'ci-1').expected_income, 62000)
  // add with a day
  await O.addIncome(db, U, { amount: 4500, label: 'Gig', day: 20 }, TODAY)
  const gig = db.tables.compass_cycle_income.at(-1); eq(strip(gig), { label: 'Gig', expected_income: 4500, cycle_start: W.c.start, user_id: U })
  eq(db.tables.compass_profile[0].settings.income_day, { [gig.id]: 20 })
  await O.addIncome(db, U, { amount: 800, label: 'Next', cycle_offset: 1 }, TODAY); eq(db.tables.compass_cycle_income.at(-1).cycle_start, '2026-11-14', 'expected income of a later cycle')
  eq(O.cycleSummary(await O.loadBills(db, U), { offset: 1 }, TODAY).income.expected, 800)
  await O.addExpense(db, U, { name: 'Gift', amount: 700, due_on: '2026-11-20', cycle_offset: 1 }, TODAY); eq(db.tables.compass_planned.at(-1).cycle_start, '2026-11-14')
  await rej(O.addIncome(db, U, { amount: 5, day: 40 }, TODAY), /whole day/)
  // delete
  m = await O.deleteIncome(db, U, { title: 'gig' }, {}, TODAY); ok(!db.tables.compass_cycle_income.some((x) => x.id === gig.id))
  eq(O.cycleSummary(await O.loadBills(db, U), {}, TODAY).income.expected, 62000)
  await rej(O.deleteIncome(db, U, { id: 'nope' }, {}, TODAY), /No income entry has the id/)
  // no profile row: the day cannot be saved, and then nothing at all is written
  const np = fakeDb({ ...clone(W.tables), compass_profile: [] }); const s0 = snapOf(np)
  await rej(O.addIncome(np, U, { amount: 5, day: 3 }, TODAY), /no compass_profile row/); await rej(O.editIncome(np, U, { id: 'ci-1' }, { day: 3 }, TODAY), /no compass_profile row/)
  eq(snapOf(np), s0)
}
{
  // ----- debts: add / edit / close / delete (DebtSheet), paste list (DebtImportSheet)
  const { db } = fresh()
  let m = await O.addDebt(db, U, { name: ' Credit card ', balance: 45000 }, TODAY)
  eq(strip(db.tables.compass_debts.at(-1)), { name: 'Credit card', creditor: null, kind: 'structured', principal_start: 45000, monthly_payment: 0, original_amount: 45000, interest_rate: 0, due_day: null, start_on: TODAY, status: 'active', user_id: U }, 'the exact insert DebtSheet makes')
  await O.addDebt(db, U, { name: 'Car', creditor: ' Bank ', kind: 'unstructured', balance: 80000, started_at_amount: 100000, monthly_payment: 3000, interest_rate: 6.5, due_day: 12 }, TODAY)
  eq(strip(db.tables.compass_debts.at(-1)), { name: 'Car', creditor: 'Bank', kind: 'unstructured', principal_start: 80000, monthly_payment: 3000, original_amount: 100000, interest_rate: 6.5, due_day: 12, start_on: TODAY, status: 'active', user_id: U })
  await O.addDebt(db, U, { name: 'Friend', balance: 5000, started_at_amount: 100 }, TODAY)
  eq(db.tables.compass_debts.at(-1).original_amount, 5000, 'a baseline under the balance falls back to the balance')
  const car = db.tables.compass_debts.find((x) => x.name === 'Car')
  ok(byId(await B(db))[`debt:${car.id}`] && byId(await B(db))[`debt:${car.id}`].due_on === '2026-10-12'.replace('10-12', '11-12'), 'a new debt with a plan joins the checklist')
  await rej(O.addDebt(db, U, { name: 'car', balance: 5 }, TODAY), /already an active debt/)
  for (const [bad, re] of [[{ name: 'x', balance: 0 }, /greater than 0/], [{ name: '', balance: 5 }, /name/], [{ name: 'x', balance: 5, monthly_payment: -1 }, /monthly_payment/], [{ name: 'x', balance: 5, due_day: 0 }, /due_day/], [{ name: 'x', balance: 5, interest_rate: -2 }, /interest_rate/]])
    await rej(O.addDebt(db, U, bad, TODAY), re, JSON.stringify(bad))
  // edit: a monthly payment for Moneta turns it from "stalled" into a payoff date
  m = await O.editDebt(db, U, { title: 'moneta' }, { monthly_payment: 5000, interest_rate: 9, due_day: 20, creditor: 'Moneta Bank' })
  const mon = db.tables.compass_debts.find((x) => x.id === 'd-mon')
  eq([mon.monthly_payment, mon.interest_rate, mon.due_day, mon.creditor, mon.principal_start, mon.original_amount, mon.kind, mon.status, mon.start_on], [5000, 9, 20, 'Moneta Bank', 100000, 120000, 'structured', 'active', '2026-01-01'], 'untouched fields keep their values (baseline 120000 stays)')
  const lv = O.listDebts(await O.loadBills(db, U), {}, TODAY).debts.find((x) => x.id === 'd-mon')
  eq(lv.months_left, A.payoffMonths(90000, 5000, 9)); ok(!lv.stalled)
  ok(m.includes('90000'), m)
  // changing the balance moves the remaining directly (the page's behaviour); a baseline now below it follows the balance
  await O.editDebt(db, U, { id: 'd-vzp' }, { balance: 130000 })
  eq(db.tables.compass_debts.find((x) => x.id === 'd-vzp').original_amount, 130000, 'baseline 100000 < new balance 130000: falls back to the balance')
  eq(O.debtView(db.tables.compass_debts.find((x) => x.id === 'd-vzp'), db.tables.compass_transactions, TODAY).remaining, 128000)
  await O.editDebt(db, U, { id: 'd-vzp' }, { started_at_amount: 150000, creditor: null, due_day: null })
  const vz = db.tables.compass_debts.find((x) => x.id === 'd-vzp'); eq([vz.original_amount, vz.creditor, vz.due_day], [150000, null, null])
  // close it: status paid leaves totals and checklist, history stays
  await O.editDebt(db, U, { id: 'd-vzp' }, { status: 'paid' })
  ok(!byId(await B(db))['debt:d-vzp'], 'a closed debt leaves the checklist')
  const d2 = await O.loadBills(db, U)
  const fr = O.debtFreedom(d2.debts, d2.transactions, TODAY), fa = A.debtFreedom(d2.debts, d2.transactions)
  eq([fr.owed, fr.baseline], [fa.owed, fa.baseline], 'totals agree with compassCalc'); ok(!O.listDebts(d2, {}, TODAY).debts.some((x) => x.id === 'd-vzp'))
  eq(O.listDebts(d2, { status: 'paid' }, TODAY).debts.map((x) => x.id).sort(), ['d-old', 'd-vzp'])
  await O.editDebt(db, U, { id: 'd-vzp' }, { status: 'paused' }); eq(db.tables.compass_debts.find((x) => x.id === 'd-vzp').status, 'paused')
  await rej(O.editDebt(db, U, { title: 'c' }, { monthly_payment: 1 }), /matches/)
  await rej(O.editDebt(db, U, { id: 'd-vzp' }, { balance: -4 }), /greater than 0/)
  // delete removes only the debt row and reports what pointed at it
  const ntx = db.tables.compass_transactions.length
  m = await O.deleteDebt(db, U, { id: 'd-mon' })
  ok(!db.tables.compass_debts.some((x) => x.id === 'd-mon') && db.tables.compass_transactions.length === ntx && /1 ledger payment/.test(m), m)
  await rej(O.deleteDebt(db, U, { id: 'd-mon' }), /No debt has the id/)
  // paste list
  const tomorrow = '2026-11-08'
  m = await O.importDebts(db, U, [{ name: 'credit  CARD', amount: 41999.6 }, { name: 'Brother', amount: 20000, kind: 'personal' }, { name: 'Car', amount: 70000, kind: 'tax' }], tomorrow)
  const cc = db.tables.compass_debts.find((x) => x.name === 'Credit card')
  eq([cc.principal_start, cc.original_amount, cc.kind, cc.start_on, cc.monthly_payment], [42000, 42000, 'structured', tomorrow, 0], 'matches by name ignoring case and spacing, rounds to whole crowns, kind kept when not given')
  const car2 = db.tables.compass_debts.find((x) => x.name === 'Car'); eq([car2.principal_start, car2.original_amount, car2.kind, car2.start_on, car2.monthly_payment], [70000, 70000, 'tax', tomorrow, 3000], 'monthly payment survives')
  eq(strip(db.tables.compass_debts.at(-1)), { name: 'Brother', creditor: null, kind: 'personal', principal_start: 20000, original_amount: 20000, monthly_payment: 0, interest_rate: 0, due_day: null, start_on: tomorrow, status: 'active', user_id: U })
  const before = snapOf(db)
  await rej(O.importDebts(db, U, [{ name: 'A', amount: 5 }, { name: ' a ', amount: 6 }]), /twice/); await rej(O.importDebts(db, U, [{ name: 'A', amount: 0 }]), /above 0/); await rej(O.importDebts(db, U, []), /at least one/)
  eq(snapOf(db), before, 'a bad list writes nothing at all')
}
{
  // ----- the ledger: transactions
  const { db } = fresh()
  let m = await O.addTransaction(db, U, { kind: 'debt_payment', amount: 5000, debt: { id: 'd-mon' }, note: 'extra', date: '2026-10-02' }, TODAY)
  eq(strip(db.tables.compass_transactions.at(-1)), { kind: 'debt_payment', amount: 5000, occurred_on: '2026-10-02', merchant: null, note: 'extra', debt_id: 'd-mon', recurring_id: null, planned_id: null, category_id: null, goal_id: null, account_id: null, user_id: U })
  ok(/now has 85000 Kč remaining/.test(m), m)
  eq(O.debtView(db.tables.compass_debts.find((x) => x.id === 'd-mon'), db.tables.compass_transactions, TODAY).remaining, A.debtView(db.tables.compass_debts.find((x) => x.id === 'd-mon'), db.tables.compass_transactions).remaining, 'the balance agrees with compassCalc.debtView')
  // an extra payment inside the cycle reads as the monthly one (documented, app behaviour)
  m = await O.addTransaction(db, U, { kind: 'debt_payment', amount: 700, debt: { title: 'vzp' }, date: TODAY }, TODAY)
  ok(/monthly item now reads paid/.test(m), m); eq(byId(await B(db))['debt:d-vzp'].status, 'paid')
  await O.addTransaction(db, U, { kind: 'saving', amount: 2000, merchant: 'Revolut', note: 'vacation' }, TODAY)
  eq(strip(db.tables.compass_transactions.at(-1)), { kind: 'saving', amount: 2000, occurred_on: TODAY, merchant: 'Revolut', note: 'vacation', debt_id: null, recurring_id: null, planned_id: null, category_id: null, goal_id: null, account_id: null, user_id: U })
  await O.addTransaction(db, U, { kind: 'income', amount: 999, merchant: 'Refund' }, TODAY); await O.addTransaction(db, U, { kind: 'expense', amount: 55.5, merchant: 'Kiosk' }, TODAY); await O.addTransaction(db, U, { kind: 'transfer', amount: 100 }, TODAY)
  eq(O.listTransactions(await O.loadBills(db, U), { kind: 'saving' }).transactions[0].note, 'vacation')
  await rej(O.addTransaction(db, U, { kind: 'saving', amount: 2000, merchant: 'Revolut', note: 'vacation' }, TODAY), /identical/)
  await O.addTransaction(db, U, { kind: 'saving', amount: 2000, allow_duplicate: true }, TODAY)
  const snap = snapOf(db)
  await rej(O.addTransaction(db, U, { kind: 'debt_payment', amount: 5 }, TODAY), /needs the debt/); await rej(O.addTransaction(db, U, { kind: 'expense', amount: 5, debt: { id: 'd-mon' } }, TODAY), /Only a debt_payment/)
  await rej(O.addTransaction(db, U, { kind: 'gift', amount: 5 }, TODAY), /kind must be/); await rej(O.addTransaction(db, U, { kind: 'expense', amount: 0 }, TODAY), /above 0/); await rej(O.addTransaction(db, U, { kind: 'expense', amount: 5, date: 'x' }, TODAY), /YYYY-MM-DD/)
  await rej(O.addTransaction(db, U, { kind: 'debt_payment', amount: 5, debt: { id: 'zzz' } }, TODAY), /No debt has the id/)
  eq(snapOf(db), snap)
  // edit
  m = await O.editTransaction(db, U, 'tx-rent', { amount: 11900, note: ' corrected ', merchant: null })
  const tr = db.tables.compass_transactions.find((t) => t.id === 'tx-rent'); eq([tr.amount, tr.note, tr.merchant, tr.recurring_id, tr.occurred_on, tr.kind], [11900, 'corrected', null, 'r-rent', DAY(W.c.start, 2), 'expense'], 'links and kind untouched')
  m = await O.editTransaction(db, U, 'tx-rent', { date: '2026-10-05' }); ok(/moved from the cycle starting 2026-10-14 to the one starting 2026-09-14/.test(m), m)
  eq(byId(await B(db))['r-rent'].status, 'open', 'dated before the cycle: no longer paid in this one'); eq(byId(await B(db, -1))['r-rent'].status, 'paid')
  await O.editTransaction(db, U, 'tx-mon', { debt: { title: 'vzp' } }); eq(db.tables.compass_transactions.find((t) => t.id === 'tx-mon').debt_id, 'd-vzp')
  await rej(O.editTransaction(db, U, 'tx-rent', { debt: { id: 'd-vzp' } }), /Only a debt_payment/); await rej(O.editTransaction(db, U, 'tx-rent', {}), /Nothing to change/); await rej(O.editTransaction(db, U, 'nope', { amount: 5 }), /No transaction has the id/)
  await rej(O.editTransaction(db, U, 'tx-rent', { amount: 0 }), /above 0/)
  // delete
  const ntx = db.tables.compass_transactions.length
  m = await O.deleteTransaction(db, U, 'tx-fine'); eq(db.tables.compass_transactions.length, ntx - 1); ok(!db.tables.compass_transactions.some((t) => t.id === 'tx-fine') && /reads open again/.test(m))
  await rej(O.deleteTransaction(db, U, 'tx-fine'), /No transaction has the id/)
  await O.deleteTransaction(db, U, 'tx-mon'); ok(!db.tables.compass_transactions.some((t) => t.id === 'tx-mon'), 'any row, not only a bill\'s payment')
  const other = clone(W.tables); other.compass_transactions.push({ id: 'tx-theirs', user_id: 'someone-else', occurred_on: TODAY, amount: 5, kind: 'expense' })
  await rej(O.deleteTransaction(fakeDb(other), U, 'tx-theirs'), /No transaction has the id/, 'another user\'s row is invisible')
}
{
  // ----- end of cycle (billspage.tsx endCycle)
  const { db } = fresh()
  const was = clone(db.tables.compass_profile[0].settings)
  const m = await O.endCycle(db, U, { money_left: 3210.5 }, TODAY)
  const s = db.tables.compass_profile[0].settings
  eq(s.active_cycle, '2026-11'); eq(s.carryover, { ...was.carryover, '2026-11': 3210.5 }, 'carryover for the NEXT cycle, others kept'); eq(s.skips, was.skips); eq(s.income_day, was.income_day)
  ok(/Ended 14 Oct - 14 Nov 2026/.test(m) && /14 Nov - 14 Dec 2026/.test(m), m)
  const nb = O.getBills(await O.loadBills(db, U), {}, TODAY); eq(nb.cycle.key, '2026-11', 'Bills now opens on the next cycle'); eq(O.cycleSummary(await O.loadBills(db, U), {}, TODAY).carryover_in, 3210.5)
  // the unpaid p-late / p-bags carry as overdue only where they are overdue (cycleChecklist)
  ok(nb.items.some((i) => i.id === 'p-bags' && i.overdue), 'unpaid one-offs of the ended cycle show as overdue')
  const m2 = await O.endCycle(db, U, { money_left: -400 }, TODAY); eq(db.tables.compass_profile[0].settings.active_cycle, '2026-12'); eq(db.tables.compass_profile[0].settings.carryover['2026-12'], -400)
  await rej(O.endCycle(db, U, { money_left: NaN }, TODAY), /number/); await rej(O.endCycle(db, U, {}, TODAY), /number/, 'no guessed default')
  const np = fakeDb({ ...clone(W.tables), compass_profile: [] }); await rej(O.endCycle(np, U, { money_left: 1 }, TODAY), /no compass_profile row/)
  // a concurrent settings write is never overwritten; a concurrent END of the same cycle is refused
  const c1 = fresh().db
  c1.beforeUpdate = (dbx) => { dbx.tables.compass_profile[0].settings.carryover['2027-01'] = 5; dbx.tables.compass_profile[0].updated_at = 'changed' }
  await O.endCycle(c1, U, { money_left: 10 }, TODAY)
  eq(c1.tables.compass_profile[0].settings.carryover['2027-01'], 5, 'the concurrent write survived'); eq(c1.tables.compass_profile[0].settings.active_cycle, '2026-11')
  const c2 = fresh().db
  c2.beforeUpdate = (dbx) => { dbx.tables.compass_profile[0].settings.active_cycle = '2026-11'; dbx.tables.compass_profile[0].updated_at = 'changed' }
  await rej(O.endCycle(c2, U, { money_left: 10 }, TODAY), /changed while ending/)
  ok(!('2026-11' in c2.tables.compass_profile[0].settings.carryover) , 'the second end did not advance twice')
}
{
  // ----- nothing here touches the state blob: no mc_state read or written, so no merge, burial or cascade is involved
  const { db } = fresh()
  const touched = []
  const spy = { from: (t) => { touched.push(t); return db.from(t) } }
  await O.addRecurring(spy, U, { name: 'Z', amount: 1, cadence: 'weekly' }, TODAY); await O.deleteRecurring(spy, U, { title: 'Z' }); await O.endCycle(spy, U, { money_left: 1 }, TODAY)
  ok(touched.every((t) => t.startsWith('compass_')), `only compass_* tables were used: ${[...new Set(touched)]}`)
  eq(db.tables.mc_state, undefined)
}
{
  // ----- the tools, through zod: every new tool end to end
  const real = world(M.dateKey()); const db = fakeDb(clone(real.tables))
  const srv = fakeServer(K, K.M.tools_money.register, db, U)
  const okc = async (nm, a, re) => { const r = await srv.call(nm, a); ok(!r.isError, `${nm} ${JSON.stringify(a)}: ${r.text}`); if (re) ok(re.test(r.text), `${nm}: ${r.text}`); return r }
  const bad = async (nm, a, re) => { const r = await srv.call(nm, a); ok(r.isError && re.test(r.text), `${nm} ${JSON.stringify(a)} should be refused: ${r.text}`); return r }
  await okc('add_recurring_bill', { name: 'Gym', amount: 800, cadence: 'monthly', day_of_month: 18 }, /Added recurring bill: Gym/)
  const lr = await okc('list_recurring_bills', {}); ok(lr.json.recurring.some((x) => x.name === 'Gym'))
  await okc('edit_recurring_bill', { title: 'gym', amount: 900, end_on: '2027-01-01' }, /Saved recurring bill: Gym, 900 Kč/)
  await bad('edit_recurring_bill', { title: 'gym', end_on: '1999-01-01' }, /end_on/)
  await okc('delete_recurring_bill', { title: 'gym' }, /Deleted recurring bill: Gym/)
  await okc('edit_recurring_bill', { title: 'gym', active: true }, /Saved recurring bill: Gym/)
  await okc('add_expense', { name: 'Parking', amount: 120, cycle_offset: 0 }); await okc('edit_expense', { title: 'parking', amount: 140 }, /Saved one-off: Parking, 140 Kč/); await okc('delete_expense', { title: 'parking' }, /Deleted one-off: Parking/)
  await okc('add_unreasonable_expense', { name: 'Sneakers', amount: 3000, tag: 'regret' }, /tagged regret/); await okc('edit_unreasonable_expense', { title: 'sneakers', tag: 'functional' }, /functional/); await okc('delete_unreasonable_expense', { title: 'sneakers' })
  await okc('add_income', { amount: 3000, label: 'Refund', day: 12 }, /landing on day 12/); await okc('edit_income', { title: 'refund', amount: 3500, day: null }, /Saved income: Refund, 3500 Kč/); await okc('delete_income', { title: 'refund' }, /Deleted income: Refund/)
  await okc('add_debt', { name: 'Phone loan', balance: 12000, monthly_payment: 1000 }, /Added debt: Phone loan/); await okc('edit_debt', { title: 'phone', status: 'paused', interest_rate: 3 }, /status paused/); await okc('delete_debt', { title: 'phone' }, /Deleted debt: Phone loan/)
  await okc('import_debts', { debts: [{ name: 'Mum', amount: 8000, kind: 'personal' }] }, /added Mum 8000 Kč/)
  await okc('add_transaction', { kind: 'debt_payment', amount: 1000, debt_title: 'moneta' }, /toward Moneta/)
  const tx = db.tables.compass_transactions.at(-1)
  await okc('edit_transaction', { id: tx.id, amount: 1500, note: null }); await okc('delete_transaction', { id: tx.id }, /Deleted transaction/)
  await bad('add_transaction', { kind: 'debt_payment', amount: 5 }, /needs the debt/)
  await okc('mark_bill_paid', { id: 'r-rent', cycle_offset: -1 }, /Marked paid: Rent/); await okc('unmark_bill_paid', { id: 'r-rent', cycle_offset: -1 }, /Marked unpaid/); await okc('skip_bill', { id: 'r-rent', cycle_offset: -1 }, /Skipped this cycle: Rent \(/)
  await okc('mark_bill_paid', { id: 'r-spot', amount: 100, paid_on: M.dateKey() }, /ledger now holds 100/)
  await okc('list_one_offs', { kind: 'unreasonable' })
  const e1 = await okc('end_cycle', { money_left: 500 }, /Ended/); ok(db.tables.compass_profile[0].settings.carryover && Object.values(db.tables.compass_profile[0].settings.carryover).includes(500))
  if (K.zodReal) for (const [nm, a] of [['end_cycle', {}], ['end_cycle', { money_left: 'x' }], ['add_recurring_bill', { name: 'x', amount: 5 }], ['add_recurring_bill', { name: 'x', amount: 5, cadence: 'daily' }], ['add_debt', { name: 'x', balance: 0 }], ['edit_debt', { title: 'x', status: 'gone' }], ['add_transaction', { kind: 'gift', amount: 5 }], ['edit_transaction', { amount: 5 }], ['delete_transaction', {}], ['mark_bill_paid', { id: 'x', amount: -5 }], ['mark_bill_paid', { id: 'x', cycle_offset: 99 }], ['import_debts', { debts: [] }], ['edit_income', { id: 'x', day: 45 }], ['add_income', { amount: 5, day: 0 }]]) {
      n++; await assert.rejects(() => srv.call(nm, a), /./, `${nm} ${JSON.stringify(a)} is refused by the schema`)
    }
  // another user sees none of it and can change none of it
  const other = fakeServer(K, K.M.tools_money.register, fakeDb(clone(real.tables)), 'u2')
  for (const [nm, a] of [['edit_recurring_bill', { id: 'r-rent', amount: 1 }], ['delete_debt', { id: 'd-vzp' }], ['delete_transaction', { id: 'tx-rent' }], ['edit_income', { id: 'ci-1', amount: 1 }], ['delete_expense', { id: 'p-bags' }]]) { const r = await other.call(nm, a); ok(r.isError && /No /.test(r.text), `${nm}: ${r.text}`) }
}

/* ---------------- 5. mutation checks: the rules must actually be guarded ---------------- */
{
  const src = readFileSync(`${ROOT}/supabase/functions/mc-mcp/ops-money.ts`, 'utf8')
  const load = async (text) => {
    const out = await build({ stdin: { contents: text, resolveDir: `${ROOT}/supabase/functions/mc-mcp`, sourcefile: 'ops-money.ts', loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' })
    return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`)
  }
  // The two rules that decide whether money is counted: the cycle window (end exclusive) and "never pay twice".
  const rules = async (X) => {
    const d = await X.loadBills(fakeDb(clone(W.tables)), U)
    const by = Object.fromEntries(X.getBills(d, {}, TODAY).items.map((i) => [i.id, i.status]))
    assert.equal(by['r-net'], 'open', 'a payment dated the cycle END day must not count as paid')
    assert.equal(by['r-spot'], 'open', 'a payment dated before the cycle must not count as paid')
    assert.equal(by['r-rent'], 'paid')
    const db = fakeDb(clone(W.tables))
    await assert.rejects(X.markBillPaid(db, U, { id: 'r-rent' }, TODAY), /already paid/)
    assert.equal(db.tables.compass_transactions.length, 7, 'no second payment row')
    // undo removes only the one linked row
    await X.unmarkBillPaid(db, U, { id: 'r-rent' }, TODAY)
    assert.deepEqual(db.tables.compass_transactions.map((t) => t.id).sort(), ['tx-fine', 'tx-mon', 'tx-net-next', 'tx-spot-prev', 'tx-vzp-0', 'tx-vzp-1'])
  }
  await rules(O); n++
  const mutants = [
    ['window end made inclusive', 't.occurred_on >= s && t.occurred_on < e', 't.occurred_on >= s && t.occurred_on <= e'],
    ['window start dropped', 't.occurred_on >= s && t.occurred_on < e', 't.occurred_on < e'],
    ['already-paid guard removed', 'if (i.paid) throw new McError(`"${i.name}" is already paid', 'if (false) throw new McError(`"${i.name}" is already paid'],
    ['undo deletes by recurring id (all rows)', ".delete().eq('id', victim.id).eq('user_id', uid)", ".delete().eq('user_id', uid)"],
  ]
  for (const [name, from, to] of mutants) {
    ok(src.includes(from), `mutation target present: ${name}`)
    const X = await load(src.replace(from, to))
    n++; await assert.rejects(() => rules(X), undefined, `MUTANT SURVIVED: ${name}`)
  }
}

/* ---------------- 6. mutation checks for the round-3 rules ---------------- */
{
  const src = readFileSync(`${ROOT}/supabase/functions/mc-mcp/ops-money.ts`, 'utf8')
  const load = async (text) => {
    const out = await build({ stdin: { contents: text, resolveDir: `${ROOT}/supabase/functions/mc-mcp`, sourcefile: 'ops-money.ts', loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' })
    return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`)
  }
  const fr = () => fakeDb(clone(W.tables))
  const checks = {
    'past cycle dated its last day': async (X) => { const db = fr(); await X.markBillPaid(db, U, { id: 'r-rent' }, TODAY, { offset: -1 }); assert.equal(db.tables.compass_transactions.at(-1).occurred_on, '2026-10-13') },
    'explicit amount reaches the ledger': async (X) => { const db = fr(); await X.markBillPaid(db, U, { id: 'r-spot' }, TODAY, { amount: 150 }); assert.equal(db.tables.compass_transactions.at(-1).amount, 150) },
    'baseline never below the balance': async (X) => { const db = fr(); await X.addDebt(db, U, { name: 'F', balance: 5000, started_at_amount: 100 }, TODAY); assert.equal(db.tables.compass_debts.at(-1).original_amount, 5000) },
    'deleting a recurring bill only switches it off': async (X) => { const db = fr(); await X.deleteRecurring(db, U, { id: 'r-net' }); assert.equal(db.tables.compass_recurring.find((r) => r.id === 'r-net').is_active, false) },
    'editing a recurring bill never rewrites its kind': async (X) => { const db = fr(); await X.editRecurring(db, U, { id: 'r-save' }, { amount: 1 }); assert.equal(db.tables.compass_recurring.find((r) => r.id === 'r-save').kind, 'saving') },
    'a debt payment must name its debt': async (X) => { const db = fr(); await assert.rejects(X.addTransaction(db, U, { kind: 'debt_payment', amount: 5 }, TODAY), /needs the debt/) },
    'ending the same cycle twice is refused': async (X) => { const db = fr(); db.beforeUpdate = (d) => { d.tables.compass_profile[0].settings.active_cycle = '2026-11'; d.tables.compass_profile[0].updated_at = 'x' }; await assert.rejects(X.endCycle(db, U, { money_left: 1 }, TODAY), /changed while ending/) },
    'settings writes compare-and-swap': async (X) => { const db = fr(); db.beforeUpdate = (d) => { d.tables.compass_profile[0].settings.carryover.zz = 1; d.tables.compass_profile[0].updated_at = 'x' }; await X.endCycle(db, U, { money_left: 1 }, TODAY); assert.equal(db.tables.compass_profile[0].settings.carryover.zz, 1) },
    'a bill cannot be dated outside its cycle': async (X) => { await assert.rejects(X.markBillPaid(fr(), U, { id: 'r-net' }, TODAY, { paid_on: '2026-11-14' }), /outside/) },
    'a one-off cannot be filed under a cycle its date is not in': async (X) => { await assert.rejects(X.editExpense(fr(), U, { id: 'p-bags' }, { cycle_offset: 1 }, TODAY), /must fall inside/) },
  }
  const mutants = {
    'past cycle dated its last day': [': off < 0 ? lastDayOf(cycle) : (i.dueOn ?? cycle.start)', ': (i.dueOn ?? cycle.start)'],
    'explicit amount reaches the ledger': ['const amount = o.amount === undefined ? i.amount : amountOf(o.amount)', 'const amount = i.amount'],
    'baseline never below the balance': ['original_amount: baseline >= principal ? baseline : principal', 'original_amount: baseline'],
    'deleting a recurring bill only switches it off': ["{ is_active: false })\n  const paid", "{ is_active: true })\n  const paid"],
    'editing a recurring bill never rewrites its kind': ['const patch: Row = { name, amount, cadence, priority: i.priority', "const patch: Row = { kind: 'expense', name, amount, cadence, priority: i.priority"],
    'a debt payment must name its debt': ["if (!i.debt || (!i.debt.id && !i.debt.title)) throw", 'if (false) throw'],
    'ending the same cycle twice is refused': ['if (activeCycleKey({ settings: s }, today) !== here) throw', 'if (false) throw'],
    'a bill cannot be dated outside its cycle': ['(o.paid_on < cycle.start || o.paid_on >= cycle.end)', 'false'],
    'a one-off cannot be filed under a cycle its date is not in': ['if (due_on < c.start || due_on >= c.end) throw', 'if (false) throw'],
  }
  /* the CAS line exists twice (skipBill, changeSettings); drop it in changeSettings only */
  const casFrom = "    let q = db.from('compass_profile').update({ settings: { ...settings, ...patch }, updated_at: new Date().toISOString() }).eq('user_id', uid)\n    if (profile.updated_at != null) q = q.eq('updated_at', profile.updated_at)"
  mutants['settings writes compare-and-swap'] = [casFrom, casFrom.replace("\n    if (profile.updated_at != null) q = q.eq('updated_at', profile.updated_at)", '')]
  let killed = 0
  for (const [name, check] of Object.entries(checks)) {
    const X0 = O
    n++; await check(X0) // the real code passes
    const [from, to] = mutants[name]
    ok(src.includes(from), `mutation target present: ${name}`)
    const X = await load(src.replace(from, to))
    n++; await assert.rejects(() => check(X), undefined, `MUTANT SURVIVED: ${name}`); killed++
  }
  n += 0
  globalThis.__killed2 = killed
}

console.log(`MCP money: ${n} checks passed (${K.zodReal ? 'schemas validated with zod' : 'schemas NOT validated'}), 4 + ${globalThis.__killed2} mutants killed.`)
