/* Bills and money. These tables are NOT the state blob: the compass_* Postgres tables are read
   and written directly through r.db (his token, row-level security). Every rule is a port,
   named in ops-money.ts. What the app can do that this cannot is refused or left out on purpose:
   see each description. */
import * as m from './ops-money.ts'
import type { Reg } from './reg.ts'

export function register(r: Reg): void {
  const { z, ann, safe, db, uid } = r
  const ref = r.s.ref
  const offset = z.number().int().min(-12).max(12).optional().describe('0 = the cycle Bills opens on (default); -1 last cycle; 1 next cycle. Read only.')

  /* ---------------- reads ---------------- */
  r.tool('get_bills', {
    title: 'Bills this cycle',
    description: 'The Bills page checklist for the cycle he is in (cycles run 14th to 14th): every recurring bill, debt payment, one-off ("unexpected") and unreasonable expense due, with amount, due date, paid/open, overdue and skipped. Same math as the app. Use it before marking anything paid. Item ids are what mark_bill_paid accepts. Does not edit recurring bills or debts: that is the Bills page.',
    inputSchema: z.object({ show: z.enum(['all', 'open', 'paid']).optional(), cycle_offset: offset }), annotations: ann.RO,
  }, ({ show, cycle_offset }) => safe(async () => m.getBills(await m.loadBills(db, uid), { show, offset: cycle_offset })))

  r.tool('get_cycle_summary', {
    title: 'Cycle summary',
    description: 'The money picture of a cycle: expected income, paid so far, still to pay (recurring, debt payments, unexpected, unreasonable), carryover and free to spend. Skipped items are excluded, exactly like the Bills page.',
    inputSchema: z.object({ cycle_offset: offset }), annotations: ann.RO,
  }, ({ cycle_offset }) => safe(async () => m.cycleSummary(await m.loadBills(db, uid), { offset: cycle_offset })))

  r.tool('list_debts', {
    title: 'Debts',
    description: 'Every debt with what is paid and what remains, DERIVED from the ledger (debt_payment transactions since the debt start date), plus the total, progress and the date he is debt free at the current payments. Balances are never typed in anywhere, so there is no tool to set one. Default: active debts only.',
    inputSchema: z.object({ status: z.enum(['active', 'paid', 'paused', 'all']).optional() }), annotations: ann.RO,
  }, ({ status }) => safe(async () => m.listDebts(await m.loadBills(db, uid), { status })))

  r.tool('list_transactions', {
    title: 'Transactions',
    description: 'The ledger (compass_transactions), newest first. Filter by from/to date (YYYY-MM-DD, inclusive), kind (income, expense, debt_payment, saving, transfer) and words in the merchant, note or the name of the bill/debt it is linked to. Capped at 200 rows; totals cover every match.',
    inputSchema: z.object({ from: z.string().optional(), to: z.string().optional(), kind: z.enum(['income', 'expense', 'debt_payment', 'saving', 'transfer']).optional(), query: z.string().optional(), limit: z.number().int().min(1).max(200).optional() }), annotations: ann.RO,
  }, (i) => safe(async () => m.listTransactions(await m.loadBills(db, uid), i)))

  /* ---------------- writes ---------------- */
  r.tool('mark_bill_paid', {
    title: 'Mark a bill paid',
    description: 'Mark one item of the CURRENT cycle paid by adding the ledger transaction the Bills page adds (same kind, amount, links; dated today). Find it by id (from get_bills) or words in its name; several matches or none is a refusal that lists them. Refuses an item that is already paid, so nothing is counted twice. Pays the listed amount only: it cannot record a different amount, a partial payment, or pay an old cycle (use the Bills page). Undo with unmark_bill_paid.',
    inputSchema: z.object(ref), annotations: ann.W,
  }, ({ id, title }) => safe(() => m.markBillPaid(db, uid, { id, title })))

  r.tool('unmark_bill_paid', {
    title: 'Undo a paid bill',
    description: 'Undo "paid" on an item of the current cycle by deleting its linked ledger transaction (what the Bills page Undo does). Deletes exactly one transaction, the newest linked one. Refuses if the item is not paid. This removes a ledger row, so confirm with the user unless they asked for the undo.',
    inputSchema: z.object(ref), annotations: ann.D,
  }, ({ id, title }) => safe(() => m.unmarkBillPaid(db, uid, { id, title })))

  r.tool('skip_bill', {
    title: 'Skip a bill this cycle',
    description: 'Skip an item for the current cycle (it stops counting in "still to pay" and free to spend), or on: false to bring it back. Sets, does not toggle, so asking twice is safe. Writes only the skip list in his Bills settings; it pays nothing and deletes nothing.',
    inputSchema: z.object({ ...ref, on: z.boolean().optional().describe('default true; false unskips') }), annotations: ann.WI,
  }, ({ id, title, on }) => safe(() => m.skipBill(db, uid, { id, title }, on !== false)))

  r.tool('add_expense', {
    title: 'Add a one-off expense to pay',
    description: 'Add a one-off cost under "Unexpected" for the current cycle (the Bills page "Add a one-off"): a must-pay item due on due_on (default today), amount in CZK. It is something TO PAY, not a payment: it does not touch the ledger until mark_bill_paid. Refuses an identical item already in the cycle unless allow_duplicate. Cannot add recurring bills, debts, or unreasonable expenses, or edit or delete any: that is the Bills page.',
    inputSchema: z.object({ name: z.string(), amount: z.number().min(1).max(1e8), due_on: z.string().optional().describe('YYYY-MM-DD'), allow_duplicate: z.boolean().optional() }), annotations: ann.W,
  }, (i) => safe(() => m.addExpense(db, uid, i)))

  r.tool('add_income', {
    title: 'Add expected income',
    description: 'Add money he receives or expects this cycle to Income (the Bills page Income sheet): amount in CZK and an optional label such as "Salary". It sets the expected income the cycle math uses; it is not a ledger transaction. Refuses an identical entry already in the cycle unless allow_duplicate. Cannot set the day it lands, edit or delete income: that is the Bills page.',
    inputSchema: z.object({ amount: z.number().min(1).max(1e8), label: z.string().optional(), allow_duplicate: z.boolean().optional() }), annotations: ann.W,
  }, (i) => safe(() => m.addIncome(db, uid, i)))
}
