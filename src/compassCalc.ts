/* THE BILLS PAGE, ported from Compass (the same Supabase project his other
   apps already use -- see supabase.ts's readRows). This file is the domain
   logic ONLY, transplanted from Compass's src/store/selectors.ts, src/lib/
   calc.ts and src/lib/format.ts as close to verbatim as this codebase's own
   conventions allow, because this runs against his real financial data and a
   subtly "improved" rewrite is exactly how that goes wrong quietly.

   Two deliberate departures from Compass, both already reviewed with him
   from the artifact: Savings and Goals are not ported in this first pass,
   and the UI groups by full-width section rather than Compass's own mobile
   single-column list -- neither changes any of the math below. */

export type TxKind = 'income' | 'expense' | 'debt_payment' | 'saving' | 'transfer'
export type Cadence = 'weekly' | 'monthly' | 'yearly'

export interface CompassProfile {
  user_id: string
  base_currency: string
  monthly_income_target: number
  settings: Record<string, unknown>
}

export type DebtKind = 'structured' | 'unstructured' | 'personal' | 'tax'

export interface CompassDebt {
  id: string
  user_id: string
  name: string
  creditor: string | null
  kind: DebtKind
  original_amount: number | null
  principal_start: number
  start_on: string
  monthly_payment: number
  interest_rate: number
  status: 'active' | 'paid' | 'paused'
  due_day: number | null
  sort_order: number
}

export interface CompassRecurring {
  id: string
  user_id: string
  name: string
  kind: 'income' | 'expense' | 'debt_payment' | 'saving'
  priority: 'mandatory' | 'optional'
  amount: number
  category_id: string | null
  debt_id: string | null
  goal_id: string | null
  cadence: Cadence
  day_of_month: number | null
  month_of_year: number | null
  start_on: string
  end_on: string | null
  is_active: boolean
  is_subscription: boolean
  sort_order: number
}

export interface CompassTransaction {
  id: string
  user_id: string
  occurred_on: string
  amount: number
  kind: TxKind
  category_id: string | null
  debt_id: string | null
  goal_id: string | null
  recurring_id: string | null
  planned_id: string | null
  merchant: string | null
  note: string | null
  created_at: string
}

export interface CompassPlanned {
  id: string
  user_id: string
  name: string
  amount: number
  category_id: string | null
  kind: 'expense' | 'debt_payment' | 'saving'
  priority: 'mandatory' | 'optional'
  due_on: string | null
  note: string | null
  cycle_start: string
  tag?: 'functional' | 'regret' | null
  created_at: string
}

export interface CompassCycleIncome {
  id: string
  user_id: string
  cycle_start: string
  expected_income: number
  label: string | null
  note: string | null
}

/* -------------------------- date helpers -------------------------- */

/** Local calendar YYYY-MM-DD, not UTC -- Compass's own comment: "String
 *  YYYY-MM-DD comparisons throughout to avoid timezone drift." Every cycle
 *  boundary check in this file compares strings built this way; swapping in
 *  toISOString().slice(0,10) anywhere below would reintroduce that drift. */
export const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const todayISO = (): string => iso(new Date())

export function addMonths(d: Date, n: number): Date {
  const r = new Date(d)
  r.setMonth(r.getMonth() + n)
  return r
}

export function clampDay(year: number, month: number, day: number): number {
  const last = new Date(year, month + 1, 0).getDate()
  return Math.min(day, last)
}

export function relativeDay(isoDate: string): string {
  const today = new Date()
  const d = new Date(isoDate)
  const diff = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000,
  )
  if (diff === 0) return 'Today'
  if (diff === -1) return 'Yesterday'
  if (diff === 1) return 'Tomorrow'
  return new Date(isoDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/* -------------------------- cycle (calendar month) -------------------------- */

export interface Cycle { start: Date; end: Date; label: string; key: string }

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function cycleForKey(key: string): Cycle {
  const [y, m] = key.split('-').map(Number)
  const start = new Date(y, m - 1, 1)
  const end = new Date(y, m, 1)
  return { start, end, key, label: start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) }
}

export function addMonthsToKey(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number)
  return monthKey(new Date(y, m - 1 + n, 1))
}

export function activeCycleKey(profile: CompassProfile | null): string {
  const stored = (profile?.settings as Record<string, unknown> | undefined)?.active_cycle
  return typeof stored === 'string' && /^\d{4}-\d{2}$/.test(stored) ? stored : monthKey(new Date())
}

function occurrenceInWindow(c: Cycle, day: number): Date | null {
  const c1 = new Date(c.start.getFullYear(), c.start.getMonth(), clampDay(c.start.getFullYear(), c.start.getMonth(), day))
  if (iso(c1) >= iso(c.start) && iso(c1) < iso(c.end)) return c1
  const c2 = new Date(c.end.getFullYear(), c.end.getMonth(), clampDay(c.end.getFullYear(), c.end.getMonth(), day))
  if (iso(c2) >= iso(c.start) && iso(c2) < iso(c.end)) return c2
  return null
}

export function recurringDueInCycle(r: CompassRecurring, c: Cycle): boolean {
  if (!r.is_active) return false
  const s = iso(c.start), e = iso(c.end)
  if (r.start_on >= e) return false
  if (r.end_on && r.end_on < s) return false
  if (r.cadence === 'monthly') return !!occurrenceInWindow(c, r.day_of_month ?? c.start.getDate())
  if (r.cadence === 'weekly') return true
  if (r.cadence === 'yearly') {
    const m = (r.month_of_year ?? 1) - 1
    const day = r.day_of_month ?? 1
    const o1 = new Date(c.start.getFullYear(), m, clampDay(c.start.getFullYear(), m, day))
    const o2 = new Date(c.end.getFullYear(), m, clampDay(c.end.getFullYear(), m, day))
    return (iso(o1) >= s && iso(o1) < e) || (iso(o2) >= s && iso(o2) < e)
  }
  return false
}

/* -------------------------- cycle checklist -------------------------- */

export interface CycleItem {
  id: string
  source: 'fixed' | 'adhoc' | 'unreasonable'
  name: string
  amount: number
  kind: 'expense' | 'debt_payment' | 'saving'
  priority: 'mandatory' | 'optional'
  dueOn: string | null
  paid: boolean
  paidTxId: string | null
  overdue: boolean
  categoryId: string | null
  debtId: string | null
  goalId: string | null
  tag?: 'functional' | 'regret' | null
  link: { recurring_id?: string; planned_id?: string }
}

export function cycleChecklist(
  recurring: CompassRecurring[],
  planned: CompassPlanned[],
  debts: CompassDebt[],
  tx: CompassTransaction[],
  c: Cycle,
  income: number | undefined,
  dismissed: Set<string> = new Set(),
) {
  const s = iso(c.start), e = iso(c.end)
  const inWin = (t: CompassTransaction) => t.occurred_on >= s && t.occurred_on < e
  const items: CycleItem[] = []

  for (const r of recurring) {
    if (r.kind === 'income' || r.kind === 'debt_payment') continue
    if (!recurringDueInCycle(r, c)) continue
    const matches = tx.filter((t) => t.recurring_id === r.id && inWin(t))
    items.push({
      id: r.id, source: 'fixed', name: r.name, amount: r.amount, kind: r.kind as CycleItem['kind'],
      priority: r.priority ?? 'mandatory',
      dueOn: r.day_of_month ? iso(occurrenceInWindow(c, r.day_of_month) ?? c.start) : null,
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
    if ((p.cycle_start || '').slice(0, 7) !== c.key) continue
    const matches = tx.filter((t) => t.planned_id === p.id)
    items.push({
      id: p.id, source: 'unreasonable', name: p.name, amount: p.amount, kind: 'expense',
      priority: p.priority ?? 'optional', dueOn: null, paid: matches.length > 0, paidTxId: matches[0]?.id ?? null,
      overdue: false, categoryId: null, debtId: null, goalId: null, tag: p.tag ?? null, link: { planned_id: p.id },
    })
  }

  for (const d of debts) {
    if (d.status !== 'active' || d.monthly_payment <= 0) continue
    const dueOn = d.due_day != null ? iso(occurrenceInWindow(c, d.due_day) ?? c.start) : null
    const matches = tx.filter((t) => t.kind === 'debt_payment' && t.debt_id === d.id && inWin(t))
    items.push({
      id: `debt:${d.id}`, source: 'fixed', name: d.name, amount: d.monthly_payment, kind: 'debt_payment',
      priority: 'mandatory', dueOn, paid: matches.length > 0, paidTxId: matches[0]?.id ?? null, overdue: false,
      categoryId: null, debtId: d.id, goalId: null, link: {},
    })
  }

  items.sort((a, b) =>
    Number(b.overdue) - Number(a.overdue) || Number(a.paid) - Number(b.paid) || (a.dueOn ?? '').localeCompare(b.dueOn ?? ''))

  const mandatory = items.filter((i) => i.priority === 'mandatory')
  const mandatoryTotal = mandatory.reduce((sum, i) => sum + i.amount, 0)
  const surplusThisCycle = income != null ? income - mandatoryTotal : 0
  return { items, mandatoryTotal, surplusThisCycle }
}

export function resolveCycleIncome(cycle: Cycle, cycleIncome: CompassCycleIncome[]) {
  const s = iso(cycle.start), e = iso(cycle.end)
  const entries = cycleIncome.filter((ci) => ci.cycle_start >= s && ci.cycle_start < e)
  const amount = entries.reduce((sum, ci) => sum + (ci.expected_income || 0), 0)
  return { amount, entries }
}

/* -------------------------- free to spend -------------------------- */

export interface CycleFree {
  income: number; comingIn: number; paidTotal: number
  recurringOut: number; debtOut: number; unexpectedOut: number; unreasonableOut: number
  carryover: number; committed: number; free: number
}

export function cycleFree(
  recurring: CompassRecurring[], planned: CompassPlanned[], debts: CompassDebt[], transactions: CompassTransaction[],
  cycle: Cycle, income: number, skips: string[] = [], dismissed: Set<string> = new Set(), carryover = 0,
): CycleFree {
  const chk = cycleChecklist(recurring, planned, debts, transactions, cycle, income, dismissed)
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

/* -------------------------- debt freedom -------------------------- */

export function payoffMonths(balance: number, monthlyPayment: number, annualRatePct = 0): number {
  if (balance <= 0) return 0
  if (monthlyPayment <= 0) return Infinity
  const r = annualRatePct / 100 / 12
  if (r === 0) return Math.ceil(balance / monthlyPayment)
  if (monthlyPayment <= balance * r) return Infinity
  const n = Math.log(monthlyPayment / (monthlyPayment - balance * r)) / Math.log(1 + r)
  return Math.ceil(n)
}

export interface DebtView { debt: CompassDebt; paid: number; remaining: number; progress: number; monthsLeft: number; payoffDate: Date | null }

export function debtView(debt: CompassDebt, tx: CompassTransaction[]): DebtView {
  const paid = tx.filter((t) => t.kind === 'debt_payment' && t.debt_id === debt.id && t.occurred_on >= debt.start_on)
    .reduce((s, t) => s + t.amount, 0)
  const remaining = Math.max(0, debt.principal_start - paid)
  const start = debt.principal_start || 1
  const progress = Math.min(1, paid / start)
  const monthsLeft = remaining <= 0 ? 0 : payoffMonths(remaining, debt.monthly_payment, debt.interest_rate)
  const payoffDate = monthsLeft === Infinity || remaining <= 0 ? null : addMonths(new Date(), monthsLeft)
  return { debt, paid, remaining, progress, monthsLeft, payoffDate }
}

export interface DebtFreeView { freeDate: Date | null; freeMonths: number; stalled: CompassDebt[] }

export function debtFreeView(debts: CompassDebt[], tx: CompassTransaction[]): DebtFreeView {
  const active = debts.filter((d) => d.status === 'active')
  const open = active.map((d) => ({ debt: d, view: debtView(d, tx) })).filter((x) => x.view.remaining > 0)
  if (open.length === 0) return { freeDate: null, freeMonths: 0, stalled: [] }
  const stalled = open.filter((x) => x.view.monthsLeft === Infinity).map((x) => x.debt)
  if (stalled.length > 0) return { freeDate: null, freeMonths: Infinity, stalled }
  let freeMonths = 0
  let freeDate: Date | null = null
  for (const x of open) {
    if (x.view.monthsLeft > freeMonths) { freeMonths = x.view.monthsLeft; freeDate = x.view.payoffDate }
  }
  return { freeDate, freeMonths, stalled: [] }
}

export function totalDebt(debts: CompassDebt[], tx: CompassTransaction[]): number {
  return debts.filter((d) => d.status === 'active').reduce((s, d) => s + debtView(d, tx).remaining, 0)
}

export function debtFreedom(debts: CompassDebt[], tx: CompassTransaction[]) {
  const baseline = debts.filter((d) => d.status === 'active').reduce((s, d) => s + (d.original_amount ?? d.principal_start), 0)
  const owed = totalDebt(debts, tx)
  const paid = Math.max(0, baseline - owed)
  const pct = baseline > 0 ? paid / baseline : 1
  return { baseline, paid, owed, pct }
}

export interface RunwayMilestone { monthIndex: number; date: Date; debtId: string; debtName: string; freed: number; totalAfter: number }

export function debtRunway(debts: CompassDebt[], tx: CompassTransaction[]) {
  const open = debts.filter((d) => d.status === 'active').map((d) => ({ d, view: debtView(d, tx) })).filter((x) => x.view.remaining > 0)
  const paying = open.filter((x) => x.d.monthly_payment > 0)
  const startTotal = paying.reduce((s, x) => s + x.d.monthly_payment, 0)
  if (open.length === 0) return { milestones: [] as RunwayMilestone[], startTotal: 0, debtFreeMonth: null as number | null, debtFreeDate: null as Date | null }
  const finishes = paying
    .map((x) => ({ debtId: x.d.id, debtName: x.d.name, freed: x.d.monthly_payment, month: x.view.monthsLeft }))
    .filter((f) => f.month !== Infinity && f.month > 0)
    .sort((a, b) => a.month - b.month)
  let total = startTotal
  const milestones: RunwayMilestone[] = finishes.map((f) => {
    total = Math.max(0, total - f.freed)
    return { monthIndex: f.month, date: addMonths(new Date(), f.month), debtId: f.debtId, debtName: f.debtName, freed: f.freed, totalAfter: total }
  })
  const allPayable = finishes.length === open.length
  const last = milestones[milestones.length - 1]
  return {
    milestones, startTotal,
    debtFreeMonth: allPayable ? last?.monthIndex ?? null : null,
    debtFreeDate: allPayable ? last?.date ?? null : null,
  }
}
