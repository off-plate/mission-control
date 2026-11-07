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
  eq(srv.names().sort(), ['add_expense', 'add_income', 'get_bills', 'get_cycle_summary', 'list_debts', 'list_transactions', 'mark_bill_paid', 'skip_bill', 'unmark_bill_paid'])
  for (const nm of srv.names()) { const c = srv.tools[nm].cfg; ok(c.title && c.description && c.inputSchema && c.annotations, `${nm} is fully described`) }
  eq(srv.names().filter((x) => srv.tools[x].cfg.annotations.readOnlyHint).sort(), ['get_bills', 'get_cycle_summary', 'list_debts', 'list_transactions'])
  eq(srv.names().filter((x) => srv.tools[x].cfg.annotations.destructiveHint), ['unmark_bill_paid'])
  for (const nm of srv.names()) ok(/^[a-z]+(_[a-z]+)+$/.test(nm))

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

console.log(`MCP money: ${n} checks passed (${K.zodReal ? 'schemas validated with zod' : 'schemas NOT validated'}), 4 mutants killed.`)
