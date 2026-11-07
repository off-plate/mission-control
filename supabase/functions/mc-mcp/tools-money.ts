/* Bills and money. These tables are NOT the state blob: the compass_* Postgres tables are read
   and written directly through r.db (his token, row-level security). Every rule is a port,
   named in ops-money.ts. Everything the Bills page can do with data is here: recurring bills, one-offs,
   unreasonable expenses, income (and the day it lands), debts, paying and un-paying in any cycle, skipping,
   ending a cycle, and individual ledger transactions. Nothing in the state blob is touched, so there is nothing to
   merge, bury or cascade. What is NOT here: compass_accounts, compass_categories and compass_goals, which the
   Bills page never reads or writes (it always saves account_id null and only carries category and goal ids along). */
import * as m from './ops-money.ts'
import type { Reg } from './reg.ts'

export function register(r: Reg): void {
  const { z, ann, safe, db, uid } = r
  const ref = r.s.ref
  const offset = z.number().int().min(-12).max(12).optional().describe('0 = the cycle Bills opens on (default); -1 last cycle; 1 next cycle.')
  const day = (what: string) => z.number().int().min(1).max(31).describe(what)
  const kindDebt = z.enum(['structured', 'unstructured', 'personal', 'tax']).describe('structured = loan, unstructured = overdue, personal, tax')
  const priority = z.enum(['mandatory', 'optional']).describe('mandatory = must pay, optional')
  const date = z.string().describe('YYYY-MM-DD')

  /* ---------------- reads ---------------- */
  r.tool('get_bills', {
    title: 'Bills this cycle',
    description: 'The Bills page checklist for a cycle (default: the one he is in; cycles run 14th to 14th): every recurring bill, debt payment, one-off ("unexpected") and unreasonable expense due, with amount, due date, paid/open, overdue and skipped. Same math as the app. Use it before marking anything paid. Item ids are what mark_bill_paid, unmark_bill_paid and skip_bill accept; use cycle_offset for an older or later cycle. Recurring bills that are stopped, and one-offs of other cycles, are in list_recurring_bills and list_one_offs.',
    inputSchema: z.object({ show: z.enum(['all', 'open', 'paid']).optional(), cycle_offset: offset }), annotations: ann.RO,
  }, ({ show, cycle_offset }) => safe(async () => m.getBills(await m.loadBills(db, uid), { show, offset: cycle_offset })))

  r.tool('get_cycle_summary', {
    title: 'Cycle summary',
    description: 'The money picture of a cycle: expected income (each entry with its id and the day it lands), paid so far, still to pay (recurring, debt payments, unexpected, unreasonable), carryover and free to spend. Skipped items are excluded, exactly like the Bills page.',
    inputSchema: z.object({ cycle_offset: offset }), annotations: ann.RO,
  }, ({ cycle_offset }) => safe(async () => m.cycleSummary(await m.loadBills(db, uid), { offset: cycle_offset })))

  r.tool('list_debts', {
    title: 'Debts',
    description: 'Every debt with what is paid and what remains, DERIVED from the ledger (debt_payment transactions since the debt start date), plus the total, progress and the date he is debt free at the current payments. The remaining balance is never stored: change it with edit_debt (the balance owed), import_debts (what is owed today), or by recording payments with add_transaction. Default: active debts only.',
    inputSchema: z.object({ status: z.enum(['active', 'paid', 'paused', 'all']).optional() }), annotations: ann.RO,
  }, ({ status }) => safe(async () => m.listDebts(await m.loadBills(db, uid), { status })))

  r.tool('list_transactions', {
    title: 'Transactions',
    description: 'The ledger (compass_transactions), newest first. Filter by from/to date (YYYY-MM-DD, inclusive), kind (income, expense, debt_payment, saving, transfer) and words in the merchant, note or the name of the bill/debt it is linked to. Capped at 200 rows; totals cover every match. Row ids are what edit_transaction and delete_transaction take.',
    inputSchema: z.object({ from: z.string().optional(), to: z.string().optional(), kind: z.enum(['income', 'expense', 'debt_payment', 'saving', 'transfer']).optional(), query: z.string().optional(), limit: z.number().int().min(1).max(200).optional() }), annotations: ann.RO,
  }, (i) => safe(async () => m.listTransactions(await m.loadBills(db, uid), i)))

  r.tool('list_recurring_bills', {
    title: 'Recurring bills',
    description: 'Every recurring item (compass_recurring) with cadence, day, month (yearly), priority, start and end dates and whether it is active. status: active (default), stopped (deleted in the app) or all. Income and savings rows are included with their kind. Ids go to edit_recurring_bill and delete_recurring_bill.',
    inputSchema: z.object({ status: z.enum(['active', 'stopped', 'all']).optional() }), annotations: ann.RO,
  }, ({ status }) => safe(async () => m.listRecurring(await m.loadBills(db, uid), { status })))

  r.tool('list_one_offs', {
    title: 'One-offs and unreasonable expenses',
    description: 'Every planned one-off in all cycles (compass_planned): "unexpected" ones with a due date, and "unreasonable" ones without, with amount, priority, due date, cycle, regret/needed tag and whether a payment is linked. Newest first, 200 at most. Ids go to the edit_ and delete_ tools for expenses.',
    inputSchema: z.object({ kind: z.enum(['unexpected', 'unreasonable', 'all']).optional() }), annotations: ann.RO,
  }, ({ kind }) => safe(async () => m.listOneOffs(await m.loadBills(db, uid), { kind })))

  /* ---------------- paying ---------------- */
  r.tool('mark_bill_paid', {
    title: 'Mark a bill paid',
    description: 'Mark one item paid by adding the ledger transaction the Bills page adds (same kind, links). Find it by id (from get_bills) or words in its name; several matches or none is a refusal that lists them. cycle_offset pays an item of an older or later cycle: dated that cycle\'s last day (earlier cycle) or its due date (later cycle), exactly like the page. Optional amount records what was really paid when it differs from the listed amount (a partial or different payment); optional paid_on dates it (inside the cycle for a bill or debt payment). The Bills page counts any linked payment as the item paid IN FULL, so a smaller amount still reads paid there, while the ledger and a debt balance use the amount you gave. Refuses an item already paid, so nothing is counted twice; for a second or extra payment use add_transaction. Undo with unmark_bill_paid.',
    inputSchema: z.object({ ...ref, cycle_offset: offset, amount: z.number().positive().max(1e8).optional().describe('CZK actually paid, if not the listed amount'), paid_on: date.optional() }), annotations: ann.W,
  }, ({ id, title, cycle_offset, amount, paid_on }) => safe(() => m.markBillPaid(db, uid, { id, title }, undefined, { offset: cycle_offset, amount, paid_on })))

  r.tool('unmark_bill_paid', {
    title: 'Undo a paid bill',
    description: 'Undo "paid" on an item by deleting its linked ledger transaction (what the Bills page Undo does), in the current cycle or, with cycle_offset, an older or later one. Deletes exactly one transaction, the newest linked one. Refuses if the item is not paid. This removes a ledger row, so confirm with the user unless they asked for the undo.',
    inputSchema: z.object({ ...ref, cycle_offset: offset }), annotations: ann.D,
  }, ({ id, title, cycle_offset }) => safe(() => m.unmarkBillPaid(db, uid, { id, title }, undefined, { offset: cycle_offset })))

  r.tool('skip_bill', {
    title: 'Skip a bill in a cycle',
    description: 'Skip an item for a cycle (it stops counting in "still to pay" and free to spend), or on: false to bring it back. Sets, does not toggle, so asking twice is safe. Default cycle: the current one; cycle_offset picks another. Writes only the skip list in his Bills settings; it pays nothing and deletes nothing.',
    inputSchema: z.object({ ...ref, on: z.boolean().optional().describe('default true; false unskips'), cycle_offset: offset }), annotations: ann.WI,
  }, ({ id, title, on, cycle_offset }) => safe(() => m.skipBill(db, uid, { id, title }, on !== false, undefined, { offset: cycle_offset })))

  r.tool('end_cycle', {
    title: 'End the cycle',
    description: 'The Bills page "End cycle": moves Bills to the next cycle and carries money_left (what he actually has left right now, CZK, negative if short) in as "From last cycle". Anything still unpaid shows as overdue in the new cycle; nothing is deleted. There is no undo in the app, so ask for the figure instead of guessing it (get_cycle_summary free_to_spend is what the page suggests).',
    inputSchema: z.object({ money_left: z.number().min(-1e9).max(1e9).describe('CZK he really has left now') }), annotations: ann.W,
  }, ({ money_left }) => safe(() => m.endCycle(db, uid, { money_left })))

  /* ---------------- one-offs ---------------- */
  r.tool('add_expense', {
    title: 'Add a one-off expense to pay',
    description: 'Add a one-off cost under "Unexpected" (the Bills page "Add a one-off"): a must-pay item due on due_on (default today), amount in CZK, in the current cycle or the one cycle_offset names. It is something TO PAY, not a payment: it does not touch the ledger until mark_bill_paid. Refuses an identical item already in the cycle unless allow_duplicate. For impulse spending use add_unreasonable_expense.',
    inputSchema: z.object({ name: z.string(), amount: z.number().min(1).max(1e8), due_on: date.optional(), cycle_offset: offset, allow_duplicate: z.boolean().optional() }), annotations: ann.W,
  }, (i) => safe(() => m.addExpense(db, uid, i)))

  r.tool('edit_expense', {
    title: 'Edit a one-off',
    description: 'Change an "Unexpected" one-off (what the Bills page Edit one-off sheet saves): name, amount, priority or due_on. Moving it to another cycle means giving a due_on inside that cycle; with cycle_offset it also files it under that cycle, and a due_on outside the cycle is refused. Find it by id or words in its name (list_one_offs shows all cycles). An existing payment linked to it is not changed.',
    inputSchema: z.object({ ...ref, name: z.string().optional(), amount: z.number().positive().max(1e8).optional(), priority: priority.optional(), due_on: date.optional(), cycle_offset: offset }), annotations: ann.WI,
  }, ({ id, title, ...i }) => safe(() => m.editExpense(db, uid, { id, title }, i)))

  r.tool('delete_expense', {
    title: 'Delete a one-off',
    description: 'Delete an "Unexpected" one-off (the Bills page Delete). Only the one-off row goes; a payment already recorded for it stays in the ledger (the app does the same) and is listed in the answer so it can be removed with delete_transaction. Confirm with the user unless they asked for it.',
    inputSchema: z.object(ref), annotations: ann.D,
  }, ({ id, title }) => safe(() => m.deletePlanned(db, uid, { id, title }, 'unexpected')))

  r.tool('add_unreasonable_expense', {
    title: 'Log an unreasonable expense',
    description: 'Log an impulse buy under "Unreasonable" (the Bills page "Log one"): name, amount and a tag, functional ("needed it", default) or regret. It counts against the cycle right away and never rolls into the next. Current cycle, or cycle_offset. Refuses an identical entry unless allow_duplicate.',
    inputSchema: z.object({ name: z.string(), amount: z.number().positive().max(1e8), tag: z.enum(['functional', 'regret']).optional(), cycle_offset: offset, allow_duplicate: z.boolean().optional() }), annotations: ann.W,
  }, (i) => safe(() => m.addUnreasonable(db, uid, i)))

  r.tool('edit_unreasonable_expense', {
    title: 'Edit an unreasonable expense',
    description: 'Change an unreasonable expense: name, amount, tag (functional or regret, the page\'s tag chip) or the cycle it belongs to (cycle_offset moves it to that cycle). Find it by id or words in its name.',
    inputSchema: z.object({ ...ref, name: z.string().optional(), amount: z.number().positive().max(1e8).optional(), tag: z.enum(['functional', 'regret']).optional(), cycle_offset: offset }), annotations: ann.WI,
  }, ({ id, title, ...i }) => safe(() => m.editUnreasonable(db, uid, { id, title }, i)))

  r.tool('delete_unreasonable_expense', {
    title: 'Delete an unreasonable expense',
    description: 'Delete an unreasonable expense (the Bills page Delete). Only that row goes; a payment linked to it stays in the ledger and is listed in the answer. Confirm with the user unless they asked for it.',
    inputSchema: z.object(ref), annotations: ann.D,
  }, ({ id, title }) => safe(() => m.deletePlanned(db, uid, { id, title }, 'unreasonable')))

  /* ---------------- income ---------------- */
  r.tool('add_income', {
    title: 'Add expected income',
    description: 'Add money he receives or expects to Income (the Bills page Income sheet): amount in CZK, an optional label such as "Salary" and the optional day of the month it lands (puts it on the timeline). Current cycle, or the one cycle_offset names. It sets the expected income the cycle math uses; it is not a ledger transaction. Refuses an identical entry already in the cycle unless allow_duplicate.',
    inputSchema: z.object({ amount: z.number().min(1).max(1e8), label: z.string().optional(), day: day('Day of the month it lands, 1-31').optional(), cycle_offset: offset, allow_duplicate: z.boolean().optional() }), annotations: ann.W,
  }, (i) => safe(() => m.addIncome(db, uid, i)))

  r.tool('edit_income', {
    title: 'Edit expected income',
    description: 'Change an income entry (the Bills page Income sheet): label, amount (the expected income of that cycle), and the day of the month it lands (day: null clears it). Find it by id (get_cycle_summary lists them with ids) or by words in its label within the cycle cycle_offset names (default current).',
    inputSchema: z.object({ ...ref, label: z.string().optional(), amount: z.number().positive().max(1e8).optional(), day: day('Day of the month it lands, 1-31').nullable().optional(), cycle_offset: offset }), annotations: ann.WI,
  }, ({ id, title, ...i }) => safe(() => m.editIncome(db, uid, { id, title }, i)))

  r.tool('delete_income', {
    title: 'Delete an income entry',
    description: 'Delete an income entry (the Bills page Delete). The expected income of that cycle drops by its amount; no ledger transaction is touched. Find it by id or words in its label within the cycle cycle_offset names. Confirm with the user unless they asked for it.',
    inputSchema: z.object({ ...ref, cycle_offset: offset }), annotations: ann.D,
  }, ({ id, title, cycle_offset }) => safe(() => m.deleteIncome(db, uid, { id, title }, { cycle_offset })))

  /* ---------------- recurring bills ---------------- */
  const recurringFields = {
    cadence: z.enum(['weekly', 'monthly', 'yearly']).optional(),
    day_of_month: day('Day of the month, 1-31 (not for weekly)').optional(),
    month_of_year: z.number().int().min(1).max(12).optional().describe('Month 1-12, required for yearly'),
    priority: priority.optional(),
    start_on: date.optional().describe('First day it counts; default today'),
  }
  r.tool('add_recurring_bill', {
    title: 'Add a recurring bill',
    description: 'Add a recurring bill (the Bills page "Add a bill"): name, amount in CZK, cadence weekly / monthly / yearly, the day of the month (monthly and yearly; a yearly bill also needs month_of_year, because the app would otherwise put it in January), priority (default must pay), start_on (default today) and an optional end_on. Always an expense; savings and debt payments are not added here (debts have add_debt). Refuses a second active bill with the same name unless allow_duplicate.',
    inputSchema: z.object({ name: z.string(), amount: z.number().positive().max(1e8), ...recurringFields, cadence: z.enum(['weekly', 'monthly', 'yearly']), end_on: date.optional().describe('Last day it counts'), allow_duplicate: z.boolean().optional() }), annotations: ann.W,
  }, (i) => safe(() => m.addRecurring(db, uid, i)))

  r.tool('edit_recurring_bill', {
    title: 'Edit a recurring bill',
    description: 'Change a recurring bill (the Bills page Edit bill sheet): name, amount, cadence, day, month (yearly), priority, start_on, end_on (null clears; it stops counting after that day), or active: true to bring back a stopped one. Only what you pass changes. Changing the amount changes every future cycle; past payments keep their own amount. Find it by id or words in its name (list_recurring_bills). The row\'s kind is never changed.',
    inputSchema: z.object({ ...ref, name: z.string().optional(), amount: z.number().positive().max(1e8).optional(), ...recurringFields, end_on: date.nullable().optional(), active: z.boolean().optional() }), annotations: ann.WI,
  }, ({ id, title, ...i }) => safe(() => m.editRecurring(db, uid, { id, title }, i)))

  r.tool('delete_recurring_bill', {
    title: 'Delete a recurring bill',
    description: 'Delete a recurring bill (the Bills page Delete this bill). Like the app it switches the bill off (is_active false) rather than removing the row, so it disappears from every cycle but its past payments stay in the ledger; edit_recurring_bill with active: true brings it back. Confirm with the user unless they asked for it.',
    inputSchema: z.object(ref), annotations: ann.D,
  }, ({ id, title }) => safe(() => m.deleteRecurring(db, uid, { id, title })))

  /* ---------------- debts ---------------- */
  const debtFields = {
    creditor: z.string().nullable().optional().describe('Lender, null clears'),
    kind: kindDebt.optional(),
    started_at_amount: z.number().min(0).optional().describe('What it was before anything was paid; every "% free" is measured from here. Below the balance it falls back to the balance'),
    monthly_payment: z.number().min(0).max(1e9).optional().describe('0 = no payment plan yet'),
    interest_rate: z.number().min(0).max(1000).optional().describe('Percent per year'),
    due_day: day('Day of month the payment is due').nullable().optional(),
  }
  r.tool('add_debt', {
    title: 'Add a debt',
    description: 'Add a debt (the Bills page "Add a debt"): name, balance owed now (must be above 0), optional lender, type (default loan), monthly payment (0 = no plan yet), interest percent a year, due day and the "started at" amount. It starts as active and payments count from today. Refuses a second active debt with the same name unless allow_duplicate. To set several balances at once use import_debts.',
    inputSchema: z.object({ name: z.string(), balance: z.number().positive().max(1e10), ...debtFields, allow_duplicate: z.boolean().optional() }), annotations: ann.W,
  }, (i) => safe(() => m.addDebt(db, uid, i)))

  r.tool('edit_debt', {
    title: 'Edit a debt',
    description: 'Change a debt (the Bills page debt sheet): name, lender, type, balance owed (principal), started-at amount, monthly payment (0 = none), interest percent, due day, and status active / paid / paused (paid closes it: it leaves the totals and the checklist; the history stays). Only what you pass changes. The remaining balance is the balance minus debt payments since the debt start date, so changing the balance changes it directly. Find it by id or words in its name (list_debts, any status).',
    inputSchema: z.object({ ...ref, name: z.string().optional(), balance: z.number().positive().max(1e10).optional(), ...debtFields, status: z.enum(['active', 'paid', 'paused']).optional() }), annotations: ann.WI,
  }, ({ id, title, ...i }) => safe(() => m.editDebt(db, uid, { id, title }, i)))

  r.tool('delete_debt', {
    title: 'Delete a debt',
    description: 'Delete a debt row (the Bills page Delete this debt). Payments and recurring items that pointed at it are not deleted (the app does not either) and are counted in the answer. To close a debt but keep its history, use edit_debt with status paid instead. Confirm with the user unless they asked for it.',
    inputSchema: z.object(ref), annotations: ann.D,
  }, ({ id, title }) => safe(() => m.deleteDebt(db, uid, { id, title })))

  r.tool('import_debts', {
    title: 'Set debt balances in bulk',
    description: 'The Bills page "Paste a list": one entry per debt with name and amount owed now. A name matching an ACTIVE debt updates it (balance, started-at amount and type, and the debt start date moves to today, so older payments stop counting: the figure is what is owed now); a new name adds a debt with no payment plan. Amounts are whole crowns. Use it to reset what is owed today; use edit_debt for a payment plan or interest.',
    inputSchema: z.object({ debts: z.array(z.object({ name: z.string(), amount: z.number().positive().max(1e10), kind: kindDebt.optional() })).min(1).max(40) }), annotations: ann.WI,
  }, ({ debts }) => safe(() => m.importDebts(db, uid, debts)))

  /* ---------------- the ledger ---------------- */
  r.tool('add_transaction', {
    title: 'Add a ledger transaction',
    description: 'Record a transaction in the ledger: kind income, expense, saving, transfer or debt_payment, amount in CZK, date (default today), optional merchant and note. A debt_payment names the debt (debt_id or debt_title) and lowers its remaining balance by that amount: this is how an extra payment toward a debt is recorded. Note the Bills page counts any debt payment inside a cycle as that cycle\'s monthly payment, so one dated inside a cycle makes the monthly item read paid. It is not linked to a bill; to pay a listed bill use mark_bill_paid. Refuses an identical entry unless allow_duplicate. It does not set a category, goal or account.',
    inputSchema: z.object({ kind: z.enum(['income', 'expense', 'debt_payment', 'saving', 'transfer']), amount: z.number().positive().max(1e8), date: date.optional(), merchant: z.string().optional(), note: z.string().optional(), debt_id: z.string().optional(), debt_title: z.string().optional(), allow_duplicate: z.boolean().optional() }), annotations: ann.W,
  }, ({ debt_id, debt_title, ...i }) => safe(() => m.addTransaction(db, uid, { ...i, debt: { id: debt_id, title: debt_title } })))

  r.tool('edit_transaction', {
    title: 'Edit a ledger transaction',
    description: 'Correct one ledger row by its id (from list_transactions): amount, date, merchant, note (null clears), or for a debt payment the debt. Kind and the link to a bill are not changed here. Moving a bill\'s or debt\'s payment into another cycle changes in which cycle it counts as paid; the answer says so.',
    inputSchema: z.object({ id: z.string(), amount: z.number().positive().max(1e8).optional(), date: date.optional(), merchant: z.string().nullable().optional(), note: z.string().nullable().optional(), debt_id: z.string().optional(), debt_title: z.string().optional() }), annotations: ann.WI,
  }, ({ id, debt_id, debt_title, ...i }) => safe(() => m.editTransaction(db, uid, id, { ...i, debt: { id: debt_id, title: debt_title } })))

  r.tool('delete_transaction', {
    title: 'Delete a ledger transaction',
    description: 'Delete one ledger row by its id (from list_transactions). If it was the payment that made a bill or debt payment read paid, that item reads open again; a debt balance goes back up by the amount. For simply un-paying a listed bill unmark_bill_paid is simpler. Confirm with the user unless they asked for it.',
    inputSchema: z.object({ id: z.string() }), annotations: ann.D,
  }, ({ id }) => safe(() => m.deleteTransaction(db, uid, id)))
}
