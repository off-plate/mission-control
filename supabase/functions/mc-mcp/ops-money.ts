/* Bills and money, as plain functions over the compass_* tables.

   NO Deno, NO network in this file. The tables are reached through `db`, any object
   shaped like a supabase-js client (the tests hand it K.fakeDb). Row-level security does
   the real scoping; every query also filters user_id = uid as a second lock.

   Every function below is a port. The app file it follows is named beside it, because
   this is his debt and his money: a subtly "improved" rewrite is how that goes wrong
   quietly. Sources:
     src/compassCalc.ts    cycle math, cycleChecklist, cycleFree, debtView, debtFreedom
     src/billspage.tsx     markPaid / undoPaid / toggleSkip and the Add sheets
     src/assistantbills.ts what the in-app assistant writes for bill / skipBill / expense / income
     src/supabase.ts       insertRow stamps user_id, deleteRow, upsertCompassProfile

   THE CYCLE. It runs from the 14th to the 14th (compassCalc.ts CYCLE_START_DAY, his
   correction 2026-09-04), keyed "YYYY-MM" by the month it starts in. The app has no
   payday_day setting: the anchor is that constant, so it is that constant here.

   THE LEDGER. compass_transactions is the one truth. "Paid" = a linked transaction exists
   (recurring_id with occurred_on inside the cycle window, planned_id, or a debt_payment
   on that debt inside the window). Un-marking = deleting that transaction. Debt balances
   are derived from it and never entered twice.

   Dates are 'YYYY-MM-DD' strings throughout, compared as strings, like the app does. */

import { McError, dateKey, isDate as isDate0, fold, pick, type Row } from './ops.ts'

/** ops.ts isDate also lets 2026-02-30 through (Date.parse rolls it over); a bill date must be a day that exists. */
const isDate = (s: unknown): s is string => isDate0(s) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s

export interface Db { from(table: string): any }

export const CYCLE_START_DAY = 14
/** PostgREST returns at most 1000 rows per request. The app reads without paging, so a
 *  ledger past that would silently drop payments and make every balance wrong. Here it
 *  is a refusal instead of a wrong number. */
export const ROW_CAP = 1000

/* ---------------- dates (src/compassCalc.ts, without the local-timezone Date) ------------- */

const p2 = (n: number) => String(n).padStart(2, '0')
/** A calendar date from year, 0-based month and day, normalised (month 12 = January next year). */
export function mk(y: number, m0: number, d: number): string {
  const x = new Date(Date.UTC(y, m0, d))
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}`
}
const parts = (s: string): [number, number, number] => { const [y, m, d] = s.split('-').map(Number); return [y, m - 1, d] }
/** compassCalc.ts clampDay */
export const clampDay = (y: number, m0: number, d: number): number => Math.min(d, new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate())
/** compassCalc.ts monthKey, of a date string */
export const monthKeyOf = (s: string): string => s.slice(0, 7)

export interface Cycle { key: string; start: string; end: string; label: string }

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dm = (s: string) => { const [, m, d] = parts(s); return `${d} ${MON[m]}` }

/** compassCalc.ts cycleForKey. end is EXCLUSIVE (the next cycle's first day). */
export function cycleForKey(key: string): Cycle {
  const [y, m] = key.split('-').map(Number)
  const start = mk(y, m - 1, clampDay(y, m - 1, CYCLE_START_DAY))
  const end = mk(y, m, clampDay(y, m, CYCLE_START_DAY))
  const sy = start.slice(0, 4), ey = end.slice(0, 4)
  const label = sy === ey ? `${dm(start)} - ${dm(end)} ${ey}` : `${dm(start)} ${sy} - ${dm(end)} ${ey}`
  return { key, start, end, label }
}
/** compassCalc.ts cycleKeyOn: before the 14th you are still in the cycle that opened last month. */
export function cycleKeyOn(day: string): string {
  const [y, m0] = parts(day)
  const anchor = mk(y, m0, clampDay(y, m0, CYCLE_START_DAY))
  return day < anchor ? monthKeyOf(mk(y, m0 - 1, 1)) : monthKeyOf(day)
}
/** compassCalc.ts addMonthsToKey */
export function addMonthsToKey(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number)
  return monthKeyOf(mk(y, m - 1 + n, 1))
}
/** compassCalc.ts activeCycleKey: the cycle Bills opens on (profile.settings.active_cycle, set by "end cycle"). */
export function activeCycleKey(profile: Row | null, today: string): string {
  const stored = profile?.settings?.active_cycle
  return typeof stored === 'string' && /^\d{4}-\d{2}$/.test(stored) ? stored : cycleKeyOn(today)
}
/** compassCalc.ts addMonths on a date string (setMonth overflow kept: 31 Jan + 1 month = 3 Mar). */
export function addMonthsTo(day: string, n: number): string {
  const [y, m0, d] = parts(day)
  const x = new Date(Date.UTC(y, m0, d))
  x.setUTCMonth(x.getUTCMonth() + n)
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}`
}

/** compassCalc.ts occurrenceInWindow: the date a day-of-month falls on inside the cycle. */
function occurrenceInWindow(c: Cycle, day: number): string | null {
  const [sy, sm] = parts(c.start), [ey, em] = parts(c.end)
  const c1 = mk(sy, sm, clampDay(sy, sm, day))
  if (c1 >= c.start && c1 < c.end) return c1
  const c2 = mk(ey, em, clampDay(ey, em, day))
  if (c2 >= c.start && c2 < c.end) return c2
  return null
}

/** compassCalc.ts recurringDueInCycle */
export function recurringDueInCycle(r: Row, c: Cycle): boolean {
  if (!r.is_active) return false
  const s = c.start, e = c.end
  if (r.start_on >= e) return false
  if (r.end_on && r.end_on < s) return false
  if (r.cadence === 'monthly') return !!occurrenceInWindow(c, r.day_of_month ?? parts(c.start)[2])
  if (r.cadence === 'weekly') return true
  if (r.cadence === 'yearly') {
    const m = (r.month_of_year ?? 1) - 1
    const day = r.day_of_month ?? 1
    const [sy] = parts(c.start), [ey] = parts(c.end)
    const o1 = mk(sy, m, clampDay(sy, m, day))
    const o2 = mk(ey, m, clampDay(ey, m, day))
    return (o1 >= s && o1 < e) || (o2 >= s && o2 < e)
  }
  return false
}

/* ---------------- the checklist (src/compassCalc.ts cycleChecklist) ----------------------- */

export interface CycleItem {
  id: string; source: 'fixed' | 'adhoc' | 'unreasonable'; name: string; amount: number
  kind: 'expense' | 'debt_payment' | 'saving'; priority: 'mandatory' | 'optional'
  dueOn: string | null; paid: boolean; paidTxId: string | null; overdue: boolean
  categoryId: string | null; debtId: string | null; goalId: string | null
  tag?: string | null; link: { recurring_id?: string; planned_id?: string }
}

export function cycleChecklist(recurring: Row[], planned: Row[], debts: Row[], tx: Row[], c: Cycle, income: number | undefined, dismissed: Set<string> = new Set()) {
  const s = c.start, e = c.end
  const inWin = (t: Row) => t.occurred_on >= s && t.occurred_on < e
  const items: CycleItem[] = []

  for (const r of recurring) {
    if (r.kind === 'income' || r.kind === 'debt_payment') continue
    if (!recurringDueInCycle(r, c)) continue
    const matches = tx.filter((t) => t.recurring_id === r.id && inWin(t))
    items.push({
      id: r.id, source: 'fixed', name: r.name, amount: r.amount, kind: r.kind,
      priority: r.priority ?? 'mandatory',
      dueOn: r.day_of_month ? (occurrenceInWindow(c, r.day_of_month) ?? c.start) : null,
      paid: matches.length > 0, paidTxId: matches[0]?.id ?? null, overdue: false,
      categoryId: r.category_id ?? null, debtId: r.debt_id ?? null, goalId: r.goal_id ?? null,
      link: { recurring_id: r.id },
    })
  }
  for (const p of planned) {
    if (!p.due_on) continue
    const matches = tx.filter((t) => t.planned_id === p.id)
    const paid = matches.length > 0
    const inThisCycle = p.due_on >= s && p.due_on < e
    const overdue = p.due_on < s && !paid
    if (!inThisCycle && !overdue) continue
    if (!inThisCycle && overdue && dismissed.has(p.id)) continue
    items.push({
      id: p.id, source: 'adhoc', name: p.name, amount: p.amount, kind: p.kind,
      priority: p.priority ?? 'mandatory', dueOn: p.due_on, paid, paidTxId: matches[0]?.id ?? null, overdue,
      categoryId: p.category_id ?? null, debtId: null, goalId: null, link: { planned_id: p.id },
    })
  }
  for (const p of planned) {
    if (p.due_on) continue
    if (!p.cycle_start || p.cycle_start < s || p.cycle_start >= e) continue
    const matches = tx.filter((t) => t.planned_id === p.id)
    items.push({
      id: p.id, source: 'unreasonable', name: p.name, amount: p.amount, kind: 'expense',
      priority: p.priority ?? 'optional', dueOn: null, paid: matches.length > 0, paidTxId: matches[0]?.id ?? null,
      overdue: false, categoryId: null, debtId: null, goalId: null, tag: p.tag ?? null, link: { planned_id: p.id },
    })
  }
  for (const d of debts) {
    if (d.status !== 'active' || d.monthly_payment <= 0) continue
    const dueOn = d.due_day != null ? (occurrenceInWindow(c, d.due_day) ?? c.start) : null
    const matches = tx.filter((t) => t.kind === 'debt_payment' && t.debt_id === d.id && inWin(t))
    items.push({
      id: `debt:${d.id}`, source: 'fixed', name: d.name, amount: d.monthly_payment, kind: 'debt_payment',
      priority: 'mandatory', dueOn, paid: matches.length > 0, paidTxId: matches[0]?.id ?? null, overdue: false,
      categoryId: null, debtId: d.id, goalId: null, link: {},
    })
  }
  items.sort((a, b) => Number(b.overdue) - Number(a.overdue) || Number(a.paid) - Number(b.paid) || (a.dueOn ?? '').localeCompare(b.dueOn ?? ''))
  const mandatoryTotal = items.filter((i) => i.priority === 'mandatory').reduce((sum, i) => sum + i.amount, 0)
  const surplusThisCycle = income != null ? income - mandatoryTotal : 0
  return { items, mandatoryTotal, surplusThisCycle }
}

/** compassCalc.ts resolveCycleIncome */
export function resolveCycleIncome(c: Cycle, cycleIncome: Row[]) {
  const entries = cycleIncome.filter((ci) => ci.cycle_start >= c.start && ci.cycle_start < c.end)
  return { amount: entries.reduce((sum, ci) => sum + (ci.expected_income || 0), 0), entries }
}

/** compassCalc.ts cycleFree */
export function cycleFree(recurring: Row[], planned: Row[], debts: Row[], tx: Row[], c: Cycle, income: number, skips: string[] = [], dismissed: Set<string> = new Set(), carryover = 0) {
  const chk = cycleChecklist(recurring, planned, debts, tx, c, income, dismissed)
  const live = chk.items.filter((i) => !skips.includes(i.id))
  const sum = (f: (i: CycleItem) => boolean) => live.filter(f).reduce((acc, i) => acc + i.amount, 0)
  const paidTotal = sum((i) => i.paid)
  const recurringOut = sum((i) => i.source === 'fixed' && i.kind !== 'debt_payment' && !i.paid)
  const debtOut = sum((i) => i.kind === 'debt_payment' && !i.paid)
  const unexpectedOut = sum((i) => i.source === 'adhoc' && !i.paid)
  const unreasonableOut = sum((i) => i.source === 'unreasonable' && !i.paid)
  const comingIn = income - paidTotal
  const committed = recurringOut + debtOut + unexpectedOut + unreasonableOut
  return { income, comingIn, paidTotal, recurringOut, debtOut, unexpectedOut, unreasonableOut, carryover, committed, free: comingIn + carryover - committed }
}

/* ---------------- debts (src/compassCalc.ts) --------------------------------------------- */

/** compassCalc.ts payoffMonths */
export function payoffMonths(balance: number, monthlyPayment: number, annualRatePct = 0): number {
  if (balance <= 0) return 0
  if (monthlyPayment <= 0) return Infinity
  const r = annualRatePct / 100 / 12
  if (r === 0) return Math.ceil(balance / monthlyPayment)
  if (monthlyPayment <= balance * r) return Infinity
  return Math.ceil(Math.log(monthlyPayment / (monthlyPayment - balance * r)) / Math.log(1 + r))
}

/** compassCalc.ts debtView: paid is derived from the ledger, never stored. */
export function debtView(debt: Row, tx: Row[], today: string) {
  const paid = tx.filter((t) => t.kind === 'debt_payment' && t.debt_id === debt.id && t.occurred_on >= debt.start_on).reduce((s, t) => s + t.amount, 0)
  const remaining = Math.max(0, debt.principal_start - paid)
  const start = debt.principal_start || 1
  const progress = Math.min(1, paid / start)
  const monthsLeft = remaining <= 0 ? 0 : payoffMonths(remaining, debt.monthly_payment, debt.interest_rate)
  const payoffDate = monthsLeft === Infinity || remaining <= 0 ? null : addMonthsTo(today, monthsLeft)
  return { debt, paid, remaining, progress, monthsLeft, payoffDate }
}
/** compassCalc.ts totalDebt */
export const totalDebt = (debts: Row[], tx: Row[], today: string): number => debts.filter((d) => d.status === 'active').reduce((s, d) => s + debtView(d, tx, today).remaining, 0)
/** compassCalc.ts debtFreedom */
export function debtFreedom(debts: Row[], tx: Row[], today: string) {
  const baseline = debts.filter((d) => d.status === 'active').reduce((s, d) => s + (d.original_amount ?? d.principal_start), 0)
  const owed = totalDebt(debts, tx, today)
  const paid = Math.max(0, baseline - owed)
  return { baseline, paid, owed, pct: baseline > 0 ? paid / baseline : 1 }
}
/** compassCalc.ts debtFreeView */
export function debtFreeView(debts: Row[], tx: Row[], today: string) {
  const open = debts.filter((d) => d.status === 'active').map((d) => ({ debt: d, view: debtView(d, tx, today) })).filter((x) => x.view.remaining > 0)
  if (!open.length) return { freeDate: null as string | null, freeMonths: 0, stalled: [] as Row[] }
  const stalled = open.filter((x) => x.view.monthsLeft === Infinity).map((x) => x.debt)
  if (stalled.length) return { freeDate: null, freeMonths: Infinity, stalled }
  let freeMonths = 0, freeDate: string | null = null
  for (const x of open) if (x.view.monthsLeft > freeMonths) { freeMonths = x.view.monthsLeft; freeDate = x.view.payoffDate }
  return { freeDate, freeMonths, stalled: [] }
}

/* ---------------- loading (billspage.tsx refreshBills: six tables, select *) -------------- */

export interface BillsData { profile: Row | null; debts: Row[]; recurring: Row[]; transactions: Row[]; planned: Row[]; cycleIncome: Row[] }

async function rows(db: Db, table: string, uid: string): Promise<Row[]> {
  const { data, error } = await db.from(table).select('*').eq('user_id', uid)
  if (error) throw new McError(`Could not read ${table}: ${error.message}`)
  const out = (data ?? []) as Row[]
  if (out.length >= ROW_CAP) throw new McError(`${table} has ${out.length} rows, which is the API's per-request limit, so a read could silently miss some and every balance would be wrong. Nothing was changed. Use the Bills page, or ask for this to be paged.`)
  return out
}

export async function loadBills(db: Db, uid: string): Promise<BillsData> {
  const [profile, debts, recurring, transactions, planned, cycleIncome] = await Promise.all(
    ['compass_profile', 'compass_debts', 'compass_recurring', 'compass_transactions', 'compass_planned', 'compass_cycle_income'].map((t) => rows(db, t, uid)),
  )
  return { profile: profile[0] ?? null, debts, recurring, transactions, planned, cycleIncome }
}

const skipsOf = (d: BillsData): Record<string, string[]> => d.profile?.settings?.skips ?? {}
const settingsOf = (d: BillsData): Row => (d.profile?.settings && typeof d.profile.settings === 'object' ? d.profile.settings : {})
/** Every item ever skipped, in any cycle: Bills hides a skipped overdue one-off from later cycles (billspage.tsx `dismissed`). */
const dismissedOf = (d: BillsData): Set<string> => new Set(Object.values(skipsOf(d)).flat())

/* ---------------- reads ------------------------------------------------------------------ */

const itemOut = (i: CycleItem, skipped: boolean) => ({
  id: i.id, name: i.name, amount: i.amount, kind: i.kind, source: i.source === 'fixed' ? (i.kind === 'debt_payment' ? 'debt payment' : 'recurring') : i.source === 'adhoc' ? 'unexpected' : 'unreasonable',
  priority: i.priority, due_on: i.dueOn, status: i.paid ? 'paid' : 'open', overdue: i.overdue, skipped,
  ...(i.paidTxId ? { paid_transaction_id: i.paidTxId } : {}),
})

function viewOf(d: BillsData, offset: number, today: string) {
  const cycle = cycleForKey(addMonthsToKey(activeCycleKey(d.profile, today), offset))
  const skips = skipsOf(d)[cycle.key] ?? []
  const dismissed = dismissedOf(d)
  const income = resolveCycleIncome(cycle, d.cycleIncome)
  const chk = cycleChecklist(d.recurring, d.planned, d.debts, d.transactions, cycle, income.amount, dismissed)
  const carry = d.profile?.settings?.carryover?.[cycle.key] ?? 0
  const free = cycleFree(d.recurring, d.planned, d.debts, d.transactions, cycle, income.amount, skips, dismissed, carry)
  return { cycle, skips, income, chk, free, carry }
}
const cycleHead = (c: Cycle, today: string) => ({ key: c.key, label: c.label, from: c.start, until_exclusive: c.end, today })

/** billspage.tsx's checklist for a cycle. offset 0 = the cycle Bills opens on. */
export function getBills(d: BillsData, o: { offset?: number; show?: 'all' | 'open' | 'paid' } = {}, today = dateKey()) {
  const v = viewOf(d, o.offset ?? 0, today)
  const items = v.chk.items.filter((i) => (o.show === 'open' ? !i.paid : o.show === 'paid' ? i.paid : true)).map((i) => itemOut(i, v.skips.includes(i.id)))
  const live = v.chk.items.filter((i) => !v.skips.includes(i.id))
  return {
    cycle: cycleHead(v.cycle, today), currency: 'CZK',
    counts: { total: v.chk.items.length, paid: v.chk.items.filter((i) => i.paid).length, open: v.chk.items.filter((i) => !i.paid).length, open_not_skipped: live.filter((i) => !i.paid).length, skipped: v.chk.items.filter((i) => v.skips.includes(i.id)).length },
    items,
  }
}

/** The numbers under the Bills page's header: income, paid, still to pay, free to spend. */
export function cycleSummary(d: BillsData, o: { offset?: number } = {}, today = dateKey()) {
  const v = viewOf(d, o.offset ?? 0, today)
  return {
    cycle: cycleHead(v.cycle, today), currency: 'CZK',
    income: { expected: v.income.amount, entries: v.income.entries.map((e) => ({ id: e.id, label: e.label ?? null, amount: e.expected_income, day: d.profile?.settings?.income_day?.[e.id] ?? null })) },
    paid: v.free.paidTotal,
    still_to_pay: { recurring: v.free.recurringOut, debt_payments: v.free.debtOut, unexpected: v.free.unexpectedOut, unreasonable: v.free.unreasonableOut, total: v.free.committed },
    coming_in: v.free.comingIn, carryover_in: v.free.carryover, free_to_spend: v.free.free,
    mandatory_total: v.chk.mandatoryTotal, surplus_after_mandatory: v.chk.surplusThisCycle,
    skipped_item_ids: v.skips,
    note: 'Same arithmetic as the Bills page: skipped items are left out of still_to_pay and free_to_spend. Cycles run from the 14th to the 14th.',
  }
}

/** compassCalc.ts debtView / debtFreedom / debtFreeView over the ledger. */
export function listDebts(d: BillsData, o: { status?: 'active' | 'paid' | 'paused' | 'all' } = {}, today = dateKey()) {
  const want = o.status ?? 'active'
  const list = d.debts.filter((x) => want === 'all' || x.status === want).map((x) => ({ x, v: debtView(x, d.transactions, today) })).sort((a, b) => b.v.remaining - a.v.remaining)
  const fv = debtFreeView(d.debts, d.transactions, today)
  const f = debtFreedom(d.debts, d.transactions, today)
  return {
    currency: 'CZK', note: 'paid and remaining are derived from debt_payment transactions on/after the debt start date; nothing is stored twice.',
    total_remaining_active: f.owed, baseline_active: f.baseline, paid_active: f.paid, progress_active: Math.round(f.pct * 1000) / 10,
    debt_free_by: fv.freeMonths === Infinity ? null : fv.freeDate, debt_free_stalled_on: fv.stalled.map((s) => s.name),
    debts: list.map(({ x, v }) => ({
      id: x.id, name: x.name, creditor: x.creditor ?? null, kind: x.kind, status: x.status,
      principal_start: x.principal_start, original_amount: x.original_amount ?? null, start_on: x.start_on,
      monthly_payment: x.monthly_payment, interest_rate: x.interest_rate, due_day: x.due_day ?? null,
      paid: v.paid, remaining: v.remaining, progress_pct: Math.round(v.progress * 1000) / 10,
      months_left: v.monthsLeft === Infinity ? null : v.monthsLeft, payoff_by: v.payoffDate,
      ...(v.monthsLeft === Infinity ? { stalled: 'the monthly payment does not cover the interest (or is 0), so it never pays off at this rate' } : {}),
    })),
  }
}

export interface TxQuery { from?: string; to?: string; kind?: string; query?: string; limit?: number }
export function listTransactions(d: BillsData, q: TxQuery) {
  for (const k of ['from', 'to'] as const) if (q[k] !== undefined && !isDate(q[k])) throw new McError(`${k} must be a date, YYYY-MM-DD.`)
  const name = new Map<string, string>()
  for (const r of d.recurring) name.set(`r:${r.id}`, r.name)
  for (const p of d.planned) name.set(`p:${p.id}`, p.name)
  for (const x of d.debts) name.set(`d:${x.id}`, x.name)
  const label = (t: Row) => (t.recurring_id && name.get(`r:${t.recurring_id}`)) || (t.planned_id && name.get(`p:${t.planned_id}`)) || (t.debt_id && name.get(`d:${t.debt_id}`)) || null
  const words = fold(q.query ?? '')
  const hit = d.transactions.filter((t) =>
    (!q.from || t.occurred_on >= q.from) && (!q.to || t.occurred_on <= q.to) && (!q.kind || t.kind === q.kind)
    && (!words || fold([t.merchant, t.note, label(t)].filter(Boolean).join(' ')).includes(words)))
    .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
  const cap = Math.min(Math.max(q.limit ?? 50, 1), 200)
  const byKind: Record<string, number> = {}
  for (const t of hit) byKind[t.kind] = Math.round(((byKind[t.kind] ?? 0) + t.amount) * 100) / 100
  return {
    currency: 'CZK', matched: hit.length, shown: Math.min(hit.length, cap), totals_by_kind_all_matched: byKind,
    transactions: hit.slice(0, cap).map((t) => ({ id: t.id, date: t.occurred_on, kind: t.kind, amount: t.amount, for: label(t), merchant: t.merchant ?? null, note: t.note ?? null, recurring_id: t.recurring_id ?? null, planned_id: t.planned_id ?? null, debt_id: t.debt_id ?? null })),
  }
}

/* ---------------- writes ----------------------------------------------------------------- */

const insert = async (db: Db, uid: string, table: string, row: Row): Promise<Row> => {
  /* supabase.ts insertRow: the row plus user_id, then select().single() */
  const { data, error } = await db.from(table).insert({ ...row, user_id: uid }).select().single()
  if (error || !data) throw new McError(`Could not save to ${table}: ${error?.message ?? 'no row came back'}. Nothing was changed.`)
  return data
}

/** The checklist of the cycle the Bills page shows: the ACTIVE cycle moved by `offset` (billspage.tsx cycleOffset),
 *  with the dismissed set the page passes (offset 0 = what assistantbills.ts itemsFor matches, which has none; a skipped
 *  overdue one-off only differs there). */
function activeItems(d: BillsData, today: string, offset = 0) {
  const cycle = cycleForKey(addMonthsToKey(activeCycleKey(d.profile, today), offset))
  const income = resolveCycleIncome(cycle, d.cycleIncome).amount
  return { cycle, items: cycleChecklist(d.recurring, d.planned, d.debts, d.transactions, cycle, income, dismissedOf(d)).items }
}
const pickBill = (items: CycleItem[], ref: { id?: string; title?: string }): CycleItem =>
  pick(items as unknown as Row[], ref, 'bill in this cycle', (i) => String(i.name ?? '')) as unknown as CycleItem

const lastDayOf = (c: Cycle): string => { const [y, m0, d] = parts(c.end); return mk(y, m0, d - 1) }

/** billspage.tsx markPaid. The date follows the page: today for the cycle he is in; a cycle that has
 *  already ended is dated its last day (so the payment stays inside it); one that has not started keeps
 *  the bill's due date. (assistantbills.ts always writes today, which only works while today is inside the active cycle.)
 *  `offset` is the page's cycleOffset: 0 keeps the rule above; below 0 is dated the cycle's last day, above 0 its due date.
 *  `amount` and `paid_on` are NOT on the page (it always writes the listed amount): they record what really happened. */
export async function markBillPaid(db: Db, uid: string, ref: { id?: string; title?: string }, today = dateKey(), o: { offset?: number; amount?: number; paid_on?: string } = {}): Promise<string> {
  const d = await loadBills(db, uid)
  const off = o.offset ?? 0
  const { cycle, items } = activeItems(d, today, off)
  const i = pickBill(items, ref)
  if (i.paid) throw new McError(`"${i.name}" is already paid in ${cycle.label} (transaction ${i.paidTxId}). Nothing was added, so it cannot be counted twice. To undo it, use unmark_bill_paid${off ? ' with the same cycle_offset' : ''}. For an extra or second payment use add_transaction.`)
  const amount = o.amount === undefined ? i.amount : amountOf(o.amount)
  let occurred_on: string
  if (o.paid_on !== undefined) {
    if (!isDate(o.paid_on)) throw new McError('paid_on must be a date, YYYY-MM-DD.')
    /* "Paid" for a recurring bill or a debt payment is a payment dated INSIDE the cycle window (cycleChecklist), so a date outside it would be recorded but never show as paid. */
    if (!i.link.planned_id && (o.paid_on < cycle.start || o.paid_on >= cycle.end)) throw new McError(`paid_on ${o.paid_on} is outside ${cycle.label} (${cycle.start} to the day before ${cycle.end}). A recurring bill or debt payment only counts as paid in that cycle when the payment is dated inside it. Nothing was added.`)
    occurred_on = o.paid_on
  } else occurred_on = off === 0 ? (today >= cycle.start && today < cycle.end ? today : today >= cycle.end ? lastDayOf(cycle) : (i.dueOn ?? cycle.start)) : off < 0 ? lastDayOf(cycle) : (i.dueOn ?? cycle.start)
  const row = await insert(db, uid, 'compass_transactions', {
    kind: i.kind, amount, occurred_on,
    recurring_id: i.link.recurring_id ?? null, planned_id: i.link.planned_id ?? null,
    debt_id: i.debtId, category_id: i.categoryId, goal_id: i.goalId, account_id: null,
  })
  const diff = amount !== i.amount ? ` The listed amount is ${i.amount} CZK; the ledger now holds ${amount}. The Bills page treats any linked payment as the item paid in full (it counts the listed amount), while the ledger${i.kind === 'debt_payment' ? ' and the debt balance use' : ' uses'} ${amount}.` : ''
  const why = o.paid_on !== undefined ? '' : off === 0 ? (occurred_on !== today ? ` Dated ${occurred_on}, not today, because the active cycle (${cycle.label}) does not contain today; that is what the Bills page does.` : '') : ` Dated ${occurred_on} because it is paid in ${cycle.label}; that is what the Bills page does for ${off < 0 ? 'an earlier' : 'a later'} cycle.`
  return `Marked paid: ${i.name}, ${amount} CZK, dated ${occurred_on} (transaction ${row.id}).${why}${diff}`
}

/** billspage.tsx undoPaid: deletes the linked transaction. */
export async function unmarkBillPaid(db: Db, uid: string, ref: { id?: string; title?: string }, today = dateKey(), o: { offset?: number } = {}): Promise<string> {
  const d = await loadBills(db, uid)
  const { cycle, items } = activeItems(d, today, o.offset ?? 0)
  const i = pickBill(items, ref)
  if (!i.paid || !i.paidTxId) throw new McError(`"${i.name}" is not marked paid in ${cycle.label}, so there is no payment to undo.`)
  /* i.paidTxId is the first match in table order, which is arbitrary; undo the newest, like an undo should. */
  const linked = d.transactions.filter((t) => (i.link.recurring_id ? t.recurring_id === i.link.recurring_id && t.occurred_on >= cycle.start && t.occurred_on < cycle.end
    : i.link.planned_id ? t.planned_id === i.link.planned_id
    : t.kind === 'debt_payment' && t.debt_id === i.debtId && t.occurred_on >= cycle.start && t.occurred_on < cycle.end))
    .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
  const victim = linked[0] ?? { id: i.paidTxId }
  const { data, error } = await db.from('compass_transactions').delete().eq('id', victim.id).eq('user_id', uid).select('id')
  if (error) throw new McError(`Could not undo: ${error.message}. Nothing was changed.`)
  if (!Array.isArray(data) || data.length !== 1) throw new McError('The payment could not be removed (nothing was deleted). Use the Bills page.')
  const left = linked.length - 1
  return `Marked unpaid: ${i.name} (deleted transaction ${victim.id}).${left > 0 ? ` It still shows paid: ${left} more linked payment(s) exist for this cycle (${linked.slice(1).map((t) => t.id).join(', ')}). Run unmark_bill_paid again to remove the next one.` : ''}`
}

/** billspage.tsx toggleSkip / assistantbills.ts setSkip: SET, not toggled. Writes profile.settings.skips[cycle]. */
export async function skipBill(db: Db, uid: string, ref: { id?: string; title?: string }, on: boolean, today = dateKey(), o: { offset?: number } = {}): Promise<string> {
  let d = await loadBills(db, uid)
  if (!d.profile) throw new McError('There is no compass_profile row for this account yet. Open the Bills page once so it exists, then try again.')
  const { cycle, items } = activeItems(d, today, o.offset ?? 0)
  const i = pickBill(items, ref)
  for (let n = 0; n < 4; n++) {
    const profile = n === 0 ? d.profile! : (await rows(db, 'compass_profile', uid))[0]
    if (!profile) throw new McError('The profile row disappeared. Nothing was changed.')
    const settings = (profile.settings && typeof profile.settings === 'object' ? profile.settings : {}) as Row
    const map: Record<string, string[]> = { ...(settings.skips ?? {}) }
    const set = new Set(map[cycle.key] ?? [])
    if (set.has(i.id) === on) return `${i.name} was already ${on ? 'skipped' : 'not skipped'} this cycle. Nothing changed.`
    if (on) set.add(i.id); else set.delete(i.id)
    map[cycle.key] = [...set]
    /* upsertCompassProfile merges one level deep against the caller's copy; this re-reads and only writes if
       the row is still the one read, so a concurrent settings write is never overwritten. */
    let q = db.from('compass_profile').update({ settings: { ...settings, skips: map }, updated_at: new Date().toISOString() }).eq('user_id', uid)
    if (profile.updated_at != null) q = q.eq('updated_at', profile.updated_at)
    const { data, error } = await q.select('user_id')
    if (error) throw new McError(`Could not save: ${error.message}. Nothing was changed.`)
    if (Array.isArray(data) && data.length === 1) return `${on ? 'Skipped this cycle' : 'Unskipped'}: ${i.name} (${cycle.label}).`
  }
  throw new McError('Your settings were changing at the same moment. Nothing was changed. Try again.')
}

const money = (n: unknown): number => {
  const x = typeof n === 'string' && n.trim() ? Number(n) : n
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 1 || x > 1e8) throw new McError('amount must be a number from 1 to 100,000,000 (CZK).')
  return Math.round(x * 100) / 100
}
const label200 = (s: unknown): string | undefined => (typeof s === 'string' && s.trim() ? s.trim().slice(0, 200) : undefined)

/** assistantbills.ts addExpense = billspage.tsx PlannedSheet "Add a one-off": a compass_planned row, NOT a transaction. */
export async function addExpense(db: Db, uid: string, i: { name: string; amount: number; due_on?: string; allow_duplicate?: boolean; cycle_offset?: number }, today = dateKey()): Promise<string> {
  const name = label200(i.name)
  if (!name) throw new McError('Give the expense a name.')
  const amount = money(i.amount)
  if (i.due_on !== undefined && !isDate(i.due_on)) throw new McError('due_on must be a date, YYYY-MM-DD.')
  const d = await loadBills(db, uid)
  const cycle = cycleForKey(addMonthsToKey(activeCycleKey(d.profile, today), i.cycle_offset ?? 0)) // PlannedSheet saves the VIEWED cycle's start
  const due_on = i.due_on ?? today
  const dupe = d.planned.find((p) => fold(p.name) === fold(name) && p.amount === amount && p.due_on === due_on && p.cycle_start === cycle.start)
  if (dupe && !i.allow_duplicate) throw new McError(`There is already a one-off "${dupe.name}" for ${amount} CZK due ${due_on} in this cycle (id ${dupe.id}). Nothing was added. Pass allow_duplicate: true only if he really means a second one.`)
  const row = await insert(db, uid, 'compass_planned', { name, amount, kind: 'expense', priority: 'mandatory', due_on, cycle_start: cycle.start })
  const outside = due_on < cycle.start ? ' It is dated before this cycle, so it shows as overdue.' : due_on >= cycle.end ? ' It is dated after this cycle ends, so it will not show on this cycle checklist until that cycle.' : ''
  return `Added to Unexpected this cycle: ${name} (${amount} Kč), due ${due_on} (planned id ${row.id}). It is a to-pay item, not a payment: use mark_bill_paid when it is paid.${outside}`
}

/** assistantbills.ts addIncome = billspage.tsx IncomeSheet Save (without the income_day setting). */
export async function addIncome(db: Db, uid: string, i: { amount: number; label?: string; allow_duplicate?: boolean; cycle_offset?: number; day?: number }, today = dateKey()): Promise<string> {
  const amount = money(i.amount)
  const label = label200(i.label)
  const day = i.day === undefined ? undefined : dayOfMonth(i.day, 'day')
  const d = await loadBills(db, uid)
  if (day !== undefined && !d.profile) throw new McError('There is no compass_profile row for this account yet (the day it lands is kept there). Open the Bills page once so it exists, then try again. Nothing was added.')
  const cycle = cycleForKey(addMonthsToKey(activeCycleKey(d.profile, today), i.cycle_offset ?? 0)) // IncomeSheet saves the VIEWED cycle's start
  const dupe = resolveCycleIncome(cycle, d.cycleIncome).entries.find((e) => e.expected_income === amount && (e.label ?? null) === (label ?? null))
  if (dupe && !i.allow_duplicate) throw new McError(`This cycle already has an income of ${amount} CZK${label ? ` called "${label}"` : ''} (id ${dupe.id}). Nothing was added, so income is not counted twice. Pass allow_duplicate: true only if he really got it twice.`)
  const row = await insert(db, uid, 'compass_cycle_income', { label: label ?? null, expected_income: amount, cycle_start: cycle.start })
  if (day !== undefined) await changeSettings(db, uid, d.profile, (s) => ({ income_day: { ...(s.income_day ?? {}), [row.id]: day } }))
  return `Added to Income: ${amount} Kč${label ? ` (${label})` : ''} for ${cycle.label} (id ${row.id})${day !== undefined ? `, landing on day ${day}` : ''}. Income here is the expected income of the cycle; it does not create a ledger transaction.`
}

/* ======================================================================================
   EVERYTHING ELSE THE BILLS PAGE CAN WRITE (round 3). Each function names the app code it ports.
   billspage.tsx: RecurringSheet, PlannedSheet, UnreasonableSheet, IncomeSheet, DebtSheet,
   DebtImportSheet, toggleTag, endCycle. Updates go by id, like supabase.ts updateRow/deleteRow, with
   user_id as a second lock behind RLS and a check that exactly one row changed.
   ====================================================================================== */

/** A strictly positive CZK amount (no 1 Kč floor: a ledger can hold a 0.50 correction). */
const amountOf = (n: unknown, label = 'amount'): number => {
  const x = typeof n === 'string' && n.trim() ? Number(n) : n
  if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0 || x > 1e8) throw new McError(`${label} must be a number above 0 and up to 100,000,000 (CZK).`)
  return Math.round(x * 100) / 100
}
const nonNeg = (n: unknown, label: string): number => {
  const x = typeof n === 'string' && n.trim() ? Number(n) : n
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1e9) throw new McError(`${label} must be a number from 0 up.`)
  return Math.round(x * 100) / 100
}
/** The pages clamp a day to 1..31 (Math.min(31, Math.max(1, n))). A non-integer or out-of-range value is refused here instead of silently clamped. */
const dayOfMonth = (n: unknown, label: string): number => {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 31) throw new McError(`${label} must be a whole day of the month, 1 to 31.`)
  return n
}
const nameOf1 = (s: unknown): string => { const t = label200(s); if (!t) throw new McError('Give it a name.'); return t }

async function patchRow(db: Db, uid: string, table: string, id: string, patch: Row): Promise<Row> {
  const { data, error } = await db.from(table).update(patch).eq('id', id).eq('user_id', uid).select()
  if (error) throw new McError(`Could not save to ${table}: ${error.message}. Nothing was changed.`)
  if (!Array.isArray(data) || data.length !== 1) throw new McError(`The row ${id} in ${table} could not be updated (nothing changed). It may have been deleted in the meantime.`)
  return data[0]
}
async function removeRow(db: Db, uid: string, table: string, id: string): Promise<void> {
  const { data, error } = await db.from(table).delete().eq('id', id).eq('user_id', uid).select('id')
  if (error) throw new McError(`Could not delete from ${table}: ${error.message}. Nothing was changed.`)
  if (!Array.isArray(data) || data.length !== 1) throw new McError(`The row ${id} in ${table} could not be deleted (nothing changed). It may already be gone.`)
}

/** supabase.ts upsertCompassProfile: settings merged one level deep. Done as a compare-and-swap on updated_at against a fresh
 *  read, so a settings write from the app at the same moment is never overwritten. `make` gets the CURRENT settings and returns
 *  the top-level keys to set, or null for "already so". */
async function changeSettings(db: Db, uid: string, first: Row | null, make: (settings: Row) => Row | null): Promise<'done' | 'same'> {
  for (let n = 0; n < 4; n++) {
    const profile = n === 0 ? first : (await rows(db, 'compass_profile', uid))[0]
    if (!profile) throw new McError('There is no compass_profile row for this account yet. Open the Bills page once so it exists, then try again. Nothing was changed.')
    const settings = (profile.settings && typeof profile.settings === 'object' ? profile.settings : {}) as Row
    const patch = make(settings)
    if (patch === null) return 'same'
    let q = db.from('compass_profile').update({ settings: { ...settings, ...patch }, updated_at: new Date().toISOString() }).eq('user_id', uid)
    if (profile.updated_at != null) q = q.eq('updated_at', profile.updated_at)
    const { data, error } = await q.select('user_id')
    if (error) throw new McError(`Could not save: ${error.message}. Nothing was changed.`)
    if (Array.isArray(data) && data.length === 1) return 'done'
  }
  throw new McError('Your settings were changing at the same moment. Nothing was changed. Try again.')
}

const cycleAt = (d: BillsData, today: string, offset = 0): Cycle => cycleForKey(addMonthsToKey(activeCycleKey(d.profile, today), offset))
const crowns = (n: number) => `${n} Kč`

/* ---------------- recurring bills: RecurringSheet ---------------- */

export interface RecurringIn { name?: string; amount?: number; cadence?: 'weekly' | 'monthly' | 'yearly'; priority?: 'mandatory' | 'optional'; day_of_month?: number; month_of_year?: number; start_on?: string; end_on?: string | null }

function recurringShape(cadence: string, day: number | null | undefined, month: number | null | undefined) {
  /* RecurringSheet: weekly has no day (day_of_month null); the others a day 1..31. The sheet's default day "1" is not
     assumed here: a missing day is a refusal. The sheet never sets month_of_year, so a yearly bill landed in January
     (compassCalc recurringDueInCycle: month_of_year ?? 1): here the month must be said. */
  if (cadence === 'weekly') return { day_of_month: null as number | null }
  if (day == null) throw new McError(`A ${cadence} bill needs day_of_month (1 to 31).`)
  if (cadence === 'yearly' && month == null) throw new McError('A yearly bill needs month_of_year (1 to 12): the app would otherwise put it in January.')
  return { day_of_month: dayOfMonth(day, 'day_of_month') }
}
const monthOf = (n: unknown): number => { if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 12) throw new McError('month_of_year must be 1 to 12.'); return n }

/** RecurringSheet Save, new: insert {name, amount, kind:'expense', cadence, priority, day_of_month, start_on: today, is_active:true}. */
export async function addRecurring(db: Db, uid: string, i: RecurringIn & { name: string; amount: number; cadence: 'weekly' | 'monthly' | 'yearly'; allow_duplicate?: boolean }, today = dateKey()): Promise<string> {
  const name = nameOf1(i.name), amount = amountOf(i.amount)
  const shape = recurringShape(i.cadence, i.day_of_month, i.month_of_year)
  const start_on = i.start_on ?? today
  if (!isDate(start_on)) throw new McError('start_on must be a date, YYYY-MM-DD.')
  if (i.end_on != null && (!isDate(i.end_on) || i.end_on < start_on)) throw new McError('end_on must be a date, YYYY-MM-DD, not before start_on.')
  const d = await loadBills(db, uid)
  const dupe = d.recurring.find((r) => r.is_active && fold(r.name) === fold(name))
  if (dupe && !i.allow_duplicate) throw new McError(`There is already an active recurring item "${dupe.name}" (id ${dupe.id}, ${dupe.amount} CZK). Nothing was added. Edit that one, or pass allow_duplicate: true if this is a different bill.`)
  const row = await insert(db, uid, 'compass_recurring', {
    name, amount, kind: 'expense', cadence: i.cadence, priority: i.priority ?? 'mandatory', ...shape,
    ...(i.cadence === 'yearly' ? { month_of_year: monthOf(i.month_of_year) } : {}), start_on, ...(i.end_on ? { end_on: i.end_on } : {}), is_active: true,
  })
  return `Added recurring bill: ${name}, ${crowns(amount)}, ${i.cadence}${shape.day_of_month ? ` on day ${shape.day_of_month}` : ''}, ${i.priority ?? 'mandatory'} (id ${row.id}), counting from ${start_on}.`
}

const pickRecurring = (d: BillsData, ref: { id?: string; title?: string }, activeOnly: boolean): Row =>
  pick(d.recurring.filter((r) => !activeOnly || r.is_active), ref, 'recurring bill', (r) => String(r.name ?? ''))

/** RecurringSheet Save, edit: updateRow with {name, amount, cadence, priority, day_of_month, start_on kept, is_active:true}. The sheet also
 *  writes kind:'expense'; that is NOT written here, so a saving or income row keeps its kind. start_on/end_on/month_of_year are columns
 *  compassCalc.recurringDueInCycle reads; the sheet only keeps or sets start_on. */
export async function editRecurring(db: Db, uid: string, ref: { id?: string; title?: string }, i: RecurringIn & { active?: boolean }): Promise<string> {
  const d = await loadBills(db, uid)
  const r = pickRecurring(d, ref, false)
  if (!r.is_active && i.active !== true) throw new McError(`"${r.name}" is stopped (deleted in the app). Pass active: true to bring it back with this edit. Nothing was changed.`)
  const name = i.name !== undefined ? nameOf1(i.name) : r.name
  const amount = i.amount !== undefined ? amountOf(i.amount) : r.amount
  const cadence = i.cadence ?? r.cadence
  const month = i.month_of_year !== undefined ? monthOf(i.month_of_year) : r.month_of_year
  const shape = recurringShape(cadence, i.day_of_month !== undefined ? i.day_of_month : r.day_of_month, month)
  const start_on = i.start_on ?? r.start_on
  const end_on = i.end_on === undefined ? r.end_on : i.end_on
  if (!isDate(start_on)) throw new McError('start_on must be a date, YYYY-MM-DD.')
  if (end_on != null && (!isDate(end_on) || end_on < start_on)) throw new McError('end_on must be a date, YYYY-MM-DD, not before start_on.')
  const patch: Row = { name, amount, cadence, priority: i.priority ?? r.priority ?? 'mandatory', ...shape, start_on, is_active: i.active ?? true }
  if (i.month_of_year !== undefined) patch.month_of_year = month
  if (i.end_on !== undefined) patch.end_on = end_on
  const row = await patchRow(db, uid, 'compass_recurring', r.id, patch)
  return `Saved recurring bill: ${row.name}, ${crowns(row.amount)}, ${row.cadence}${row.day_of_month ? ` on day ${row.day_of_month}` : ''}, ${row.priority}${row.end_on ? `, ends ${row.end_on}` : ''}${row.is_active ? '' : ', STOPPED'} (id ${row.id}).`
}

/** RecurringSheet del: updateRow({ is_active:false }). The app never removes the row, and neither does this: payments already
 *  recorded stay in the ledger. Bring it back with edit_recurring_bill active: true. */
export async function deleteRecurring(db: Db, uid: string, ref: { id?: string; title?: string }): Promise<string> {
  const d = await loadBills(db, uid)
  const r = pickRecurring(d, ref, true)
  await patchRow(db, uid, 'compass_recurring', r.id, { is_active: false })
  const paid = d.transactions.filter((t) => t.recurring_id === r.id).length
  return `Deleted recurring bill: ${r.name} (id ${r.id}). The Bills page does this by switching it off (is_active false), so it stops appearing on every cycle; ${paid} past payment(s) stay in the ledger. Bring it back with edit_recurring_bill and active: true.`
}

export function listRecurring(d: BillsData, o: { status?: 'active' | 'stopped' | 'all' } = {}) {
  const want = o.status ?? 'active'
  const list = d.recurring.filter((r) => want === 'all' || (want === 'active' ? r.is_active : !r.is_active))
  return {
    currency: 'CZK', note: 'Income-kind rows and savings are listed too; the Bills checklist only shows expense-like items. "stopped" = deleted in the app (is_active false).',
    recurring: list.map((r) => ({ id: r.id, name: r.name, kind: r.kind, amount: r.amount, cadence: r.cadence, day_of_month: r.day_of_month ?? null, month_of_year: r.month_of_year ?? null, priority: r.priority ?? 'mandatory', start_on: r.start_on, end_on: r.end_on ?? null, active: !!r.is_active, debt_id: r.debt_id ?? null, goal_id: r.goal_id ?? null })),
  }
}

/* ---------------- one-offs: PlannedSheet (Unexpected) and UnreasonableSheet ---------------- */

type PlannedClass = 'unexpected' | 'unreasonable'
function pickPlanned(d: BillsData, ref: { id?: string; title?: string }, cls: PlannedClass): Row {
  const isCls = (p: Row) => (cls === 'unexpected' ? !!p.due_on : !p.due_on)
  if (ref.id) {
    const other = d.planned.find((p) => p.id === ref.id && !isCls(p))
    if (other) throw new McError(`"${other.name}" is ${cls === 'unexpected' ? 'an unreasonable expense (no due date)' : 'an unexpected one-off (has a due date)'}, not ${cls === 'unexpected' ? 'an unexpected' : 'an unreasonable'} one. Use the ${cls === 'unexpected' ? 'unreasonable' : 'expense'} tool.`)
  }
  return pick(d.planned.filter(isCls), ref, cls === 'unexpected' ? 'one-off' : 'unreasonable expense', (p) => String(p.name ?? ''))
}
const cycleStartOf = (c: Cycle) => c.start

/** PlannedSheet Save, edit: updateRow({ name, amount, kind:'expense', priority, due_on, cycle_start }). The sheet writes the VIEWED cycle's start as
 *  cycle_start; pass cycle_offset (0 = the cycle Bills opens on) to do the same, otherwise it is left as it is. A one-off shows in the cycle its
 *  due_on falls in (cycleChecklist), so moving it to another cycle means a due_on inside that cycle. */
export async function editExpense(db: Db, uid: string, ref: { id?: string; title?: string }, i: { name?: string; amount?: number; priority?: 'mandatory' | 'optional'; due_on?: string; cycle_offset?: number }, today = dateKey()): Promise<string> {
  const d = await loadBills(db, uid)
  const p = pickPlanned(d, ref, 'unexpected')
  const name = i.name !== undefined ? nameOf1(i.name) : p.name
  const amount = i.amount !== undefined ? amountOf(i.amount) : p.amount
  const due_on = i.due_on ?? p.due_on
  if (!isDate(due_on)) throw new McError('due_on must be a date, YYYY-MM-DD.')
  const patch: Row = { name, amount, priority: i.priority ?? p.priority ?? 'mandatory', due_on }
  if (i.cycle_offset !== undefined) {
    const c = cycleAt(d, today, i.cycle_offset)
    if (due_on < c.start || due_on >= c.end) throw new McError(`To put "${p.name}" in ${c.label} its due_on must fall inside it (${c.start} to the day before ${c.end}); it is ${due_on}. Pass a due_on in that cycle. Nothing was changed.`)
    patch.cycle_start = cycleStartOf(c)
  }
  const row = await patchRow(db, uid, 'compass_planned', p.id, patch)
  const paid = d.transactions.some((t) => t.planned_id === p.id)
  return `Saved one-off: ${row.name}, ${crowns(row.amount)}, due ${row.due_on}, ${row.priority} (id ${row.id}).${paid ? ' It already has a payment recorded; that payment is not changed.' : ''}`
}

/** PlannedSheet del / UnreasonableSheet del: deleteRow('compass_planned', id). Ledger rows that point at it are not touched by the app either. */
export async function deletePlanned(db: Db, uid: string, ref: { id?: string; title?: string }, cls: PlannedClass): Promise<string> {
  const d = await loadBills(db, uid)
  const p = pickPlanned(d, ref, cls)
  const linked = d.transactions.filter((t) => t.planned_id === p.id)
  await removeRow(db, uid, 'compass_planned', p.id)
  return `Deleted ${cls === 'unexpected' ? 'one-off' : 'unreasonable expense'}: ${p.name}, ${crowns(p.amount)} (id ${p.id}).${linked.length ? ` ${linked.length} payment(s) in the ledger were linked to it (${linked.map((t) => t.id).join(', ')}); the app leaves those rows alone, and so does this. Delete them with delete_transaction if they were wrong.` : ''}`
}

/** UnreasonableSheet Save, new: insert {name, amount, kind:'expense', priority:'optional', due_on:null, cycle_start, tag}. Tag starts 'functional' like the sheet. */
export async function addUnreasonable(db: Db, uid: string, i: { name: string; amount: number; tag?: 'functional' | 'regret'; cycle_offset?: number; allow_duplicate?: boolean }, today = dateKey()): Promise<string> {
  const name = nameOf1(i.name), amount = amountOf(i.amount)
  const d = await loadBills(db, uid)
  const cycle = cycleAt(d, today, i.cycle_offset ?? 0)
  const dupe = d.planned.find((p) => !p.due_on && fold(p.name) === fold(name) && p.amount === amount && p.cycle_start === cycle.start)
  if (dupe && !i.allow_duplicate) throw new McError(`There is already an unreasonable expense "${dupe.name}" for ${amount} CZK in this cycle (id ${dupe.id}). Nothing was added. Pass allow_duplicate: true only if it really happened twice.`)
  const row = await insert(db, uid, 'compass_planned', { name, amount, kind: 'expense', priority: 'optional', due_on: null, cycle_start: cycle.start, tag: i.tag ?? 'functional' })
  return `Logged unreasonable expense: ${name}, ${crowns(amount)}, tagged ${row.tag} in ${cycle.label} (id ${row.id}). It counts against the cycle right away and does not roll into the next one.`
}

/** UnreasonableSheet Save, edit (and toggleTag, which is updateRow({ tag })). cycle_offset moves it to that cycle: its cycle_start is what
 *  decides which cycle an unreasonable expense belongs to (cycleChecklist). */
export async function editUnreasonable(db: Db, uid: string, ref: { id?: string; title?: string }, i: { name?: string; amount?: number; tag?: 'functional' | 'regret'; cycle_offset?: number }, today = dateKey()): Promise<string> {
  const d = await loadBills(db, uid)
  const p = pickPlanned(d, ref, 'unreasonable')
  const patch: Row = { name: i.name !== undefined ? nameOf1(i.name) : p.name, amount: i.amount !== undefined ? amountOf(i.amount) : p.amount, kind: 'expense', priority: 'optional', due_on: null, tag: i.tag ?? p.tag ?? 'functional' }
  if (i.cycle_offset !== undefined) patch.cycle_start = cycleStartOf(cycleAt(d, today, i.cycle_offset))
  const row = await patchRow(db, uid, 'compass_planned', p.id, patch)
  return `Saved unreasonable expense: ${row.name}, ${crowns(row.amount)}, ${row.tag}${i.cycle_offset !== undefined ? `, now in the cycle starting ${row.cycle_start}` : ''} (id ${row.id}).`
}

export function listOneOffs(d: BillsData, o: { kind?: PlannedClass | 'all'; from_cycle?: string } = {}) {
  const want = o.kind ?? 'all'
  const list = d.planned.filter((p) => want === 'all' || (want === 'unexpected' ? p.due_on : !p.due_on)).sort((a, b) => String(b.due_on ?? b.cycle_start ?? '').localeCompare(String(a.due_on ?? a.cycle_start ?? '')))
  return {
    currency: 'CZK', note: 'Every one-off in the table, all cycles. "unexpected" has a due date; "unreasonable" has none and belongs to the cycle in cycle_start. paid = a ledger payment is linked to it.',
    one_offs: list.slice(0, 200).map((p) => ({ id: p.id, name: p.name, amount: p.amount, class: p.due_on ? 'unexpected' : 'unreasonable', priority: p.priority ?? null, due_on: p.due_on ?? null, cycle_start: p.cycle_start ?? null, tag: p.tag ?? null, paid: d.transactions.some((t) => t.planned_id === p.id) })),
    shown: Math.min(list.length, 200), matched: list.length,
  }
}

/* ---------------- income: IncomeSheet ---------------- */

function pickIncome(d: BillsData, ref: { id?: string; title?: string }, c: Cycle): Row {
  const inCycle = resolveCycleIncome(c, d.cycleIncome).entries
  return pick(ref.id ? d.cycleIncome : inCycle, ref, 'income entry', (e) => String(e.label || 'Income'))
}

/** IncomeSheet Save, edit: updateRow({ label: trim||null, expected_income, cycle_start }) then, only if the day changed, the income_day map in
 *  profile.settings (keyed by the income row id; day = whole number 1..31, null clears it). cycle_start is the row's own (the sheet always saves the
 *  cycle the row is listed in); cycle_offset only says which cycle to look in when finding it by words. */
export async function editIncome(db: Db, uid: string, ref: { id?: string; title?: string }, i: { label?: string; amount?: number; day?: number | null; cycle_offset?: number }, today = dateKey()): Promise<string> {
  const d = await loadBills(db, uid)
  const e = pickIncome(d, ref, cycleAt(d, today, i.cycle_offset ?? 0))
  if (i.day !== undefined && i.day !== null) dayOfMonth(i.day, 'day')
  if (i.day !== undefined && !d.profile) throw new McError('There is no compass_profile row for this account yet (the day it lands is kept there). Open the Bills page once so it exists, then try again. Nothing was changed.')
  const patch: Row = { label: i.label !== undefined ? (label200(i.label) ?? null) : (e.label ?? null), expected_income: i.amount !== undefined ? amountOf(i.amount) : e.expected_income, cycle_start: e.cycle_start }
  const row = await patchRow(db, uid, 'compass_cycle_income', e.id, patch)
  let dayNote = ''
  if (i.day !== undefined) {
    const next = i.day === null ? undefined : i.day
    const r = await changeSettings(db, uid, d.profile, (s) => {
      const days = { ...(s.income_day ?? {}) } as Record<string, number>
      if (days[e.id] === next) return null
      if (next === undefined) delete days[e.id]; else days[e.id] = next
      return { income_day: days }
    })
    dayNote = next === undefined ? ' Day it lands: cleared (it sits under "any time this cycle").' : r === 'same' ? ` Day it lands is already ${next}.` : ` Day it lands: ${next}.`
  }
  return `Saved income: ${row.label ?? 'Income'}, ${crowns(row.expected_income)} (id ${row.id}).${dayNote}`
}

/** IncomeSheet del: deleteRow('compass_cycle_income', id). The sheet leaves the income_day entry in the settings; so does this. */
export async function deleteIncome(db: Db, uid: string, ref: { id?: string; title?: string }, o: { cycle_offset?: number } = {}, today = dateKey()): Promise<string> {
  const d = await loadBills(db, uid)
  const e = pickIncome(d, ref, cycleAt(d, today, o.cycle_offset ?? 0))
  await removeRow(db, uid, 'compass_cycle_income', e.id)
  return `Deleted income: ${e.label ?? 'Income'}, ${crowns(e.expected_income)} (id ${e.id}). The expected income of that cycle dropped by that amount; no ledger transaction was touched.`
}

/* ---------------- debts: DebtSheet, DebtImportSheet ---------------- */

const pickDebt = (d: BillsData, ref: { id?: string; title?: string }): Row => pick(d.debts, ref, 'debt', (x) => String(x.name ?? ''))
export type DebtKindIn = 'structured' | 'unstructured' | 'personal' | 'tax'
export interface DebtIn { name?: string; creditor?: string | null; kind?: DebtKindIn; balance?: number; started_at_amount?: number; monthly_payment?: number; interest_rate?: number; due_day?: number | null }

/** DebtSheet's patch. original_amount: a baseline under the balance would read as negative progress, so it falls back to the balance. */
function debtPatch(base: Row | null, i: DebtIn): Row {
  const name = i.name !== undefined ? nameOf1(i.name) : base?.name
  if (!name) throw new McError('Give the debt a name.')
  const principal = i.balance !== undefined ? Number(i.balance) : base?.principal_start
  if (typeof principal !== 'number' || !Number.isFinite(principal) || principal <= 0 || principal > 1e10) throw new McError('balance (the amount owed) must be greater than 0.')
  const baseline = i.started_at_amount !== undefined ? Number(i.started_at_amount) : (base ? (base.original_amount ?? base.principal_start) : 0)
  if (!Number.isFinite(baseline) || baseline < 0) throw new McError('started_at_amount must be a number from 0 up.')
  const due = i.due_day === undefined ? (base?.due_day ?? null) : i.due_day
  return {
    name, creditor: i.creditor !== undefined ? (label200(i.creditor) ?? null) : (base?.creditor ?? null), kind: i.kind ?? base?.kind ?? 'structured',
    principal_start: principal, monthly_payment: i.monthly_payment !== undefined ? nonNeg(i.monthly_payment, 'monthly_payment') : (base?.monthly_payment ?? 0),
    original_amount: baseline >= principal ? baseline : principal,
    interest_rate: i.interest_rate !== undefined ? nonNeg(i.interest_rate, 'interest_rate') : (base?.interest_rate ?? 0),
    due_day: due === null ? null : dayOfMonth(due, 'due_day'),
  }
}

/** DebtSheet Save, new: insertRow({ ...patch, start_on: today, status:'active' }). */
export async function addDebt(db: Db, uid: string, i: DebtIn & { name: string; balance: number; allow_duplicate?: boolean }, today = dateKey()): Promise<string> {
  const patch = debtPatch(null, i)
  const d = await loadBills(db, uid)
  const dupe = d.debts.find((x) => fold(x.name) === fold(patch.name) && x.status === 'active')
  if (dupe && !i.allow_duplicate) throw new McError(`There is already an active debt "${dupe.name}" (id ${dupe.id}). Nothing was added. Edit that one, or pass allow_duplicate: true.`)
  const row = await insert(db, uid, 'compass_debts', { ...patch, start_on: today, status: 'active' })
  return `Added debt: ${row.name}${row.creditor ? ` (${row.creditor})` : ''}, owed ${crowns(row.principal_start)}, started at ${crowns(row.original_amount)}, ${row.monthly_payment > 0 ? `${crowns(row.monthly_payment)}/month` : 'no payment plan yet'} (id ${row.id}). Payments count from ${today}.`
}

/** DebtSheet Save, edit: updateRow({ name, creditor, kind, principal_start, monthly_payment, original_amount, interest_rate, due_day }), every field
 *  resolved against the current row. `status` (active, paid, paused) is a column compassCalc filters on (the sheet never sets it). The remaining
 *  balance is never a field: it is balance minus debt_payment transactions since start_on. */
export async function editDebt(db: Db, uid: string, ref: { id?: string; title?: string }, i: DebtIn & { status?: 'active' | 'paid' | 'paused' }): Promise<string> {
  const d = await loadBills(db, uid)
  const x = pickDebt(d, ref)
  const patch = debtPatch(x, i)
  if (i.status !== undefined) patch.status = i.status
  const row = await patchRow(db, uid, 'compass_debts', x.id, patch)
  const v = debtView(row, d.transactions, dateKey())
  return `Saved debt: ${row.name}, balance entered ${crowns(row.principal_start)}, ${row.monthly_payment > 0 ? `${crowns(row.monthly_payment)}/month` : 'no payment plan yet'}, ${row.interest_rate}% a year, status ${row.status} (id ${row.id}). Remaining now: ${crowns(v.remaining)} (balance minus ${crowns(v.paid)} paid since ${row.start_on}).`
}

/** DebtSheet del: deleteRow('compass_debts', id). */
export async function deleteDebt(db: Db, uid: string, ref: { id?: string; title?: string }): Promise<string> {
  const d = await loadBills(db, uid)
  const x = pickDebt(d, ref)
  const tx = d.transactions.filter((t) => t.debt_id === x.id).length
  const rec = d.recurring.filter((r) => r.debt_id === x.id).length
  await removeRow(db, uid, 'compass_debts', x.id)
  return `Deleted debt: ${x.name} (id ${x.id}). ${tx} ledger payment(s) and ${rec} recurring item(s) referenced it; the app deletes only the debt row, and so does this. To keep the history instead, set status paid with edit_debt.`
}

const normName = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** DebtImportSheet Save: a name that matches an ACTIVE debt updates it ({ principal_start, original_amount, kind, start_on: today }), otherwise a new
 *  debt is inserted with no payment plan. Amounts are whole crowns (debtimport.ts parseAmount rounds). Moving start_on to today means older payments
 *  stop counting, because the figure is what is owed now. */
export async function importDebts(db: Db, uid: string, lines: { name: string; amount: number; kind?: DebtKindIn }[], today = dateKey()): Promise<string> {
  if (!lines.length) throw new McError('Give at least one debt.')
  const seen = new Set<string>()
  const clean = lines.map((l) => {
    const name = nameOf1(l.name)
    if (typeof l.amount !== 'number' || !Number.isFinite(l.amount) || Math.round(l.amount) <= 0) throw new McError(`"${name}": the amount must be above 0.`)
    if (seen.has(normName(name))) throw new McError(`"${name}" appears twice in the list. Nothing was changed.`)
    seen.add(normName(name))
    return { name, amount: Math.round(l.amount), kind: l.kind }
  })
  const d = await loadBills(db, uid)
  const byName = new Map<string, Row>()
  for (const x of d.debts) if (x.status === 'active') byName.set(normName(x.name), x)
  const done: string[] = []
  for (const l of clean) {
    const match = byName.get(normName(l.name))
    if (match) {
      await patchRow(db, uid, 'compass_debts', match.id, { principal_start: l.amount, original_amount: l.amount, kind: l.kind ?? match.kind, start_on: today })
      done.push(`updated ${match.name} to ${crowns(l.amount)}`)
    } else {
      await insert(db, uid, 'compass_debts', { name: l.name, creditor: null, kind: l.kind ?? 'unstructured', principal_start: l.amount, original_amount: l.amount, monthly_payment: 0, interest_rate: 0, due_day: null, start_on: today, status: 'active' })
      done.push(`added ${l.name} ${crowns(l.amount)}`)
    }
  }
  return `Saved ${done.length} debt(s), counting from ${today}: ${done.join('; ')}. Monthly payments stay as they were (0 for new debts).`
}

/* ---------------- the ledger: individual transactions ---------------- */
/* The Bills page itself only inserts a payment (markPaid) and deletes one (undoPaid). These work on the same compass_transactions rows, in the
   same column shape as markPaid's insert plus merchant and note, which the ledger list already shows. */

const TX_KINDS = ['income', 'expense', 'debt_payment', 'saving', 'transfer'] as const
export type TxKindIn = typeof TX_KINDS[number]
const txLabel = (d: BillsData, t: Row): string => (t.recurring_id && d.recurring.find((r) => r.id === t.recurring_id)?.name) || (t.planned_id && d.planned.find((p) => p.id === t.planned_id)?.name) || (t.debt_id && d.debts.find((x) => x.id === t.debt_id)?.name) || t.merchant || t.kind

/** markPaid's insert shape with a free kind, amount and date. A debt_payment needs the debt; any other kind must not name one. */
export async function addTransaction(db: Db, uid: string, i: { kind: TxKindIn; amount: number; date?: string; merchant?: string; note?: string; debt?: { id?: string; title?: string }; allow_duplicate?: boolean }, today = dateKey()): Promise<string> {
  if (!TX_KINDS.includes(i.kind)) throw new McError(`kind must be one of ${TX_KINDS.join(', ')}.`)
  const amount = amountOf(i.amount)
  const occurred_on = i.date ?? today
  if (!isDate(occurred_on)) throw new McError('date must be a date, YYYY-MM-DD.')
  const d = await loadBills(db, uid)
  let debt: Row | null = null
  if (i.kind === 'debt_payment') {
    if (!i.debt || (!i.debt.id && !i.debt.title)) throw new McError('A debt_payment needs the debt it pays: pass debt_id or debt_title.')
    debt = pickDebt(d, i.debt)
  } else if (i.debt && (i.debt.id || i.debt.title)) throw new McError('Only a debt_payment can name a debt.')
  const merchant = label200(i.merchant) ?? null, note = label200(i.note) ?? null
  const dupe = d.transactions.find((t) => t.kind === i.kind && t.amount === amount && t.occurred_on === occurred_on && (t.debt_id ?? null) === (debt?.id ?? null) && !t.recurring_id && !t.planned_id)
  if (dupe && !i.allow_duplicate) throw new McError(`An identical ${i.kind} of ${amount} CZK on ${occurred_on} already exists (id ${dupe.id}). Nothing was added, so it is not counted twice. Pass allow_duplicate: true only if it really happened twice.`)
  const row = await insert(db, uid, 'compass_transactions', { kind: i.kind, amount, occurred_on, merchant, note, debt_id: debt?.id ?? null, recurring_id: null, planned_id: null, category_id: null, goal_id: null, account_id: null })
  let extra = ''
  if (debt) {
    const c = cycleForKey(cycleKeyOn(occurred_on))
    const monthly = debt.status === 'active' && debt.monthly_payment > 0
    const had = d.transactions.some((t) => t.kind === 'debt_payment' && t.debt_id === debt!.id && t.occurred_on >= c.start && t.occurred_on < c.end)
    if (monthly && !had) extra = ` Note: it is dated inside ${c.label}, and the Bills page counts any debt payment to ${debt.name} in a cycle as that month's payment, so the monthly item now reads paid.`
    const v = debtView(debt, [...d.transactions, row], dateKey())
    extra += ` ${debt.name} now has ${crowns(v.remaining)} remaining.`
  }
  return `Recorded ${i.kind}: ${crowns(amount)} on ${occurred_on}${debt ? ` toward ${debt.name}` : ''}${merchant ? ` (${merchant})` : ''} (transaction ${row.id}).${extra}`
}

/** Change a ledger row by id: amount, date, merchant, note, or (debt payments) the debt. Kind and bill links are not changed here: delete and re-add, or use mark_bill_paid. */
export async function editTransaction(db: Db, uid: string, id: string, i: { amount?: number; date?: string; merchant?: string | null; note?: string | null; debt?: { id?: string; title?: string } }): Promise<string> {
  const d = await loadBills(db, uid)
  const t = d.transactions.find((x) => x.id === id)
  if (!t) throw new McError(`No transaction has the id "${id}". List transactions first to get a real id.`)
  const patch: Row = {}
  if (i.amount !== undefined) patch.amount = amountOf(i.amount)
  if (i.date !== undefined) { if (!isDate(i.date)) throw new McError('date must be a date, YYYY-MM-DD.'); patch.occurred_on = i.date }
  if (i.merchant !== undefined) patch.merchant = i.merchant === null ? null : (label200(i.merchant) ?? null)
  if (i.note !== undefined) patch.note = i.note === null ? null : (label200(i.note) ?? null)
  if (i.debt && (i.debt.id || i.debt.title)) {
    if (t.kind !== 'debt_payment') throw new McError('Only a debt_payment can name a debt.')
    patch.debt_id = pickDebt(d, i.debt).id
  }
  if (!Object.keys(patch).length) throw new McError('Nothing to change: pass at least one of amount, date, merchant, note, debt.')
  const row = await patchRow(db, uid, 'compass_transactions', id, patch)
  const was = txLabel(d, t)
  let warn = ''
  if (patch.occurred_on && (t.recurring_id || t.kind === 'debt_payment') && cycleKeyOn(t.occurred_on) !== cycleKeyOn(row.occurred_on)) warn = ` It moved from the cycle starting ${cycleForKey(cycleKeyOn(t.occurred_on)).start} to the one starting ${cycleForKey(cycleKeyOn(row.occurred_on)).start}: a bill or debt payment counts as paid only in the cycle its payment is dated in.`
  return `Saved transaction ${row.id}: ${row.kind} ${crowns(row.amount)} on ${row.occurred_on} (${was}).${warn}`
}

/** supabase.ts deleteRow on compass_transactions (what Undo does), for any row. */
export async function deleteTransaction(db: Db, uid: string, id: string): Promise<string> {
  const d = await loadBills(db, uid)
  const t = d.transactions.find((x) => x.id === id)
  if (!t) throw new McError(`No transaction has the id "${id}". List transactions first to get a real id.`)
  await removeRow(db, uid, 'compass_transactions', id)
  const was = txLabel(d, t)
  const unpays = t.recurring_id || t.planned_id || t.kind === 'debt_payment'
  return `Deleted transaction ${id}: ${t.kind} ${crowns(t.amount)} on ${t.occurred_on} (${was}).${unpays ? ' If it was the only payment for that bill or debt in its cycle, the item reads open again; a debt balance goes back up by this amount.' : ''}`
}

/* ---------------- end of cycle: billspage.tsx endCycle ---------------- */

/** endCycle(actualLeft): nextKey = addMonthsToKey(activeCycleKey, 1); settings.carryover[nextKey] = actualLeft; settings.active_cycle = nextKey.
 *  Nothing is deleted; anything unpaid carries over as overdue (cycleChecklist). The page asks the person for the money left; there is no
 *  default here, because a wrong figure rolls into next cycle's free-to-spend. */
export async function endCycle(db: Db, uid: string, i: { money_left: number }, today = dateKey()): Promise<string> {
  if (typeof i.money_left !== 'number' || !Number.isFinite(i.money_left) || Math.abs(i.money_left) > 1e9) throw new McError('money_left must be a number (CZK); it can be negative if you are short.')
  const d = await loadBills(db, uid)
  if (!d.profile) throw new McError('There is no compass_profile row for this account yet. Open the Bills page once so it exists, then try again. Nothing was changed.')
  const here = activeCycleKey(d.profile, today)
  const next = addMonthsToKey(here, 1)
  const left = Math.round(i.money_left * 100) / 100 // typed value as is, like the page (Number(v) || 0)
  await changeSettings(db, uid, d.profile, (s) => {
    if (activeCycleKey({ settings: s }, today) !== here) throw new McError('The active cycle changed while ending it (another device ended it). Nothing was changed.')
    return { carryover: { ...(s.carryover ?? {}), [next]: left }, active_cycle: next }
  })
  return `Ended ${cycleForKey(here).label}. Bills now opens on ${cycleForKey(next).label}, with ${crowns(left)} carried in as "From last cycle". Anything still unpaid shows as overdue there; nothing was deleted.`
}
