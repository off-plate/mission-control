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

import { McError, dateKey, isDate, fold, pick, type Row } from './ops.ts'

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
    income: { expected: v.income.amount, entries: v.income.entries.map((e) => ({ id: e.id, label: e.label ?? null, amount: e.expected_income })) },
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

/** The checklist the assistant matches a bill against: the ACTIVE cycle, no dismissed set (assistantbills.ts itemsFor). */
function activeItems(d: BillsData, today: string) {
  const cycle = cycleForKey(activeCycleKey(d.profile, today))
  const income = resolveCycleIncome(cycle, d.cycleIncome).amount
  return { cycle, items: cycleChecklist(d.recurring, d.planned, d.debts, d.transactions, cycle, income).items }
}
const pickBill = (items: CycleItem[], ref: { id?: string; title?: string }): CycleItem =>
  pick(items as unknown as Row[], ref, 'bill in this cycle', (i) => String(i.name ?? '')) as unknown as CycleItem

const lastDayOf = (c: Cycle): string => { const [y, m0, d] = parts(c.end); return mk(y, m0, d - 1) }

/** billspage.tsx markPaid. The date follows the page: today for the cycle he is in; a cycle that has
 *  already ended is dated its last day (so the payment stays inside it); one that has not started keeps
 *  the bill's due date. (assistantbills.ts always writes today, which only works while today is inside the active cycle.) */
export async function markBillPaid(db: Db, uid: string, ref: { id?: string; title?: string }, today = dateKey()): Promise<string> {
  const d = await loadBills(db, uid)
  const { cycle, items } = activeItems(d, today)
  const i = pickBill(items, ref)
  if (i.paid) throw new McError(`"${i.name}" is already paid this cycle (transaction ${i.paidTxId}). Nothing was added, so it cannot be counted twice. To undo it, use unmark_bill_paid.`)
  const occurred_on = today >= cycle.start && today < cycle.end ? today : today >= cycle.end ? lastDayOf(cycle) : (i.dueOn ?? cycle.start)
  const row = await insert(db, uid, 'compass_transactions', {
    kind: i.kind, amount: i.amount, occurred_on,
    recurring_id: i.link.recurring_id ?? null, planned_id: i.link.planned_id ?? null,
    debt_id: i.debtId, category_id: i.categoryId, goal_id: i.goalId, account_id: null,
  })
  return `Marked paid: ${i.name}, ${i.amount} CZK, dated ${occurred_on} (transaction ${row.id}).${occurred_on !== today ? ` Dated ${occurred_on}, not today, because the active cycle (${cycle.label}) does not contain today; that is what the Bills page does.` : ''}`
}

/** billspage.tsx undoPaid: deletes the linked transaction. */
export async function unmarkBillPaid(db: Db, uid: string, ref: { id?: string; title?: string }, today = dateKey()): Promise<string> {
  const d = await loadBills(db, uid)
  const { cycle, items } = activeItems(d, today)
  const i = pickBill(items, ref)
  if (!i.paid || !i.paidTxId) throw new McError(`"${i.name}" is not marked paid this cycle, so there is no payment to undo.`)
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
export async function skipBill(db: Db, uid: string, ref: { id?: string; title?: string }, on: boolean, today = dateKey()): Promise<string> {
  let d = await loadBills(db, uid)
  if (!d.profile) throw new McError('There is no compass_profile row for this account yet. Open the Bills page once so it exists, then try again.')
  const { cycle, items } = activeItems(d, today)
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
export async function addExpense(db: Db, uid: string, i: { name: string; amount: number; due_on?: string; allow_duplicate?: boolean }, today = dateKey()): Promise<string> {
  const name = label200(i.name)
  if (!name) throw new McError('Give the expense a name.')
  const amount = money(i.amount)
  if (i.due_on !== undefined && !isDate(i.due_on)) throw new McError('due_on must be a date, YYYY-MM-DD.')
  const d = await loadBills(db, uid)
  const cycle = cycleForKey(activeCycleKey(d.profile, today))
  const due_on = i.due_on ?? today
  const dupe = d.planned.find((p) => fold(p.name) === fold(name) && p.amount === amount && p.due_on === due_on && p.cycle_start === cycle.start)
  if (dupe && !i.allow_duplicate) throw new McError(`There is already a one-off "${dupe.name}" for ${amount} CZK due ${due_on} in this cycle (id ${dupe.id}). Nothing was added. Pass allow_duplicate: true only if he really means a second one.`)
  const row = await insert(db, uid, 'compass_planned', { name, amount, kind: 'expense', priority: 'mandatory', due_on, cycle_start: cycle.start })
  const outside = due_on < cycle.start ? ' It is dated before this cycle, so it shows as overdue.' : due_on >= cycle.end ? ' It is dated after this cycle ends, so it will not show on this cycle checklist until that cycle.' : ''
  return `Added to Unexpected this cycle: ${name} (${amount} Kč), due ${due_on} (planned id ${row.id}). It is a to-pay item, not a payment: use mark_bill_paid when it is paid.${outside}`
}

/** assistantbills.ts addIncome = billspage.tsx IncomeSheet Save (without the income_day setting). */
export async function addIncome(db: Db, uid: string, i: { amount: number; label?: string; allow_duplicate?: boolean }, today = dateKey()): Promise<string> {
  const amount = money(i.amount)
  const label = label200(i.label)
  const d = await loadBills(db, uid)
  const cycle = cycleForKey(activeCycleKey(d.profile, today))
  const dupe = resolveCycleIncome(cycle, d.cycleIncome).entries.find((e) => e.expected_income === amount && (e.label ?? null) === (label ?? null))
  if (dupe && !i.allow_duplicate) throw new McError(`This cycle already has an income of ${amount} CZK${label ? ` called "${label}"` : ''} (id ${dupe.id}). Nothing was added, so income is not counted twice. Pass allow_duplicate: true only if he really got it twice.`)
  const row = await insert(db, uid, 'compass_cycle_income', { label: label ?? null, expected_income: amount, cycle_start: cycle.start })
  return `Added to Income: ${amount} Kč${label ? ` (${label})` : ''} for ${cycle.label} (id ${row.id}). Income here is the expected income of the cycle; it does not create a ledger transaction.`
}
