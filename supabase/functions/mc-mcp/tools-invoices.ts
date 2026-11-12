/* Invoices (the Invoices page, Fakturoid rebuilt). Logic: ops-invoices.ts.
   Reads and writes the owner-only tables (supabase/invoices.sql) as HIS session, which the app pulls on
   load and on every change (realtime). Reads also take the app's own copy in the state blob, so an
   invoice saved on a device a second ago is not missed. A delete is a deleted_at stamp in the table AND a
   buried key in the blob, so no device can bring it back. */
import type { Reg } from './reg.ts'
import { McError, arr, bury, rowKey, type Row } from './ops.ts'
import { commit, readState } from './commit.ts'
import * as I from './ops-invoices.ts'

export function register(r: Reg): void {
  const { z, ann, s } = r
  const db = r.db as any
  const must = <T>(res: { data: T; error: { message: string } | null }, what: string): T => {
    if (res.error) throw new McError(`Could not read ${what}: ${res.error.message}`)
    return res.data
  }

  async function load(): Promise<I.Ctx> {
    const [b, inv, con, acc, set] = await Promise.all([
      readState(r.db, r.uid).catch(() => ({} as Row)),
      db.from('mc_invoices').select('*'), db.from('mc_invoice_contacts').select('*'),
      db.from('mc_invoice_accounts').select('*'), db.from('mc_invoice_settings').select('*'),
    ])
    const buried = new Set(arr(b, 'graveyard').map((g) => String(g.k)))
    const invoices = I.combine(must(inv, 'the invoices') ?? [], arr(b, 'invoices'), I.rowToInv, buried, 'invoices')
    const contacts = I.combine(must(con, 'the invoice contacts') ?? [], arr(b, 'invoiceClients'), I.rowToContact, buried, 'invoiceClients')
    const srow = (must(set, 'his invoice settings') ?? [])[0]
    const accounts = (must(acc, 'his bank accounts') ?? []).filter((x: Row) => !x.deleted_at).map(I.rowToAcc)
    const local = arr(b, 'invoiceProfile')[0]
    const remoteAt = srow ? Date.parse(srow.updated_at) : 0
    const profile = srow && (!local || remoteAt >= (Number(local.updatedAt) || 0))
      ? { ...srow.profile, accounts: accounts.length ? accounts : local?.accounts }
      : local ? { ...local, accounts: local.accounts?.length ? local.accounts : accounts } : undefined
    return { invoices, contacts, profile }
  }
  const find = (ctx: I.Ctx, ref: string): Row => {
    const hit = ctx.invoices.find((x) => x.id === ref) ?? ctx.invoices.find((x) => x.number === ref.trim())
    if (hit) return hit
    const near = ctx.invoices.filter((x) => String(x.number).includes(ref.trim()))
    throw new McError(near.length === 1 ? `No invoice "${ref}". Did you mean ${near[0].number}?` : `No invoice has the number or id "${ref}". Use list_invoices.`)
  }
  async function save(inv: Row): Promise<void> {
    const { error } = await db.from('mc_invoices').upsert(I.invToRow(inv), { onConflict: 'id' })
    if (error) throw new McError(/duplicate|unique/i.test(error.message) ? `${inv.number} is already used by another invoice. Nothing was saved.` : `The invoice could not be saved (${error.message}). Nothing changed.`)
  }

  const line = z.object({
    name: z.string().min(1).max(300).describe('What was delivered'),
    qty: z.number().positive().optional().describe('Default 1'),
    unit: z.string().max(20).optional().describe('e.g. h, ks'),
    price: z.number().describe('Per unit, before VAT'),
    vat: z.number().min(0).max(100).optional().describe('Percent; ignored unless he is a VAT payer (default 21)'),
  })
  const party = z.object({ name: z.string().max(200).optional(), ico: z.string().max(20).optional(), dic: z.string().max(20).optional(), street: z.string().max(200).optional(), city: z.string().max(100).optional(), zip: z.string().max(20).optional(), country: z.string().max(100).optional(), email: z.string().max(200).optional(), phone: z.string().max(50).optional(), web: z.string().max(200).optional() })
  const draft = {
    contact: z.string().optional().describe('Invoice contact id or name (list_invoice_contacts)'),
    client: party.optional().describe('Client details instead of a saved contact (a one-off client)'),
    lines: z.array(line).min(1).max(60).optional(),
    issued: s.date.optional(), due: s.date.optional(), due_days: z.number().int().min(0).max(365).optional().describe('Due this many days after issue (default: the contact\'s, else his setting)'),
    currency: z.enum(['CZK', 'EUR', 'USD']).optional(), account: z.string().optional().describe('Which bank account (its label, e.g. "Fio"); default picks by currency'),
    method: z.enum(['bank', 'cash', 'card', 'cod']).optional(), lang: z.enum(['cs', 'en']).optional().describe('Language of the printed invoice (default cs)'),
    number: z.string().max(40).optional().describe('Only to override the next number'), order_no: z.string().max(60).optional(),
    note_before: z.string().max(2000).optional(), note_after: z.string().max(2000).optional(), footer: z.string().max(2000).optional(),
  }

  r.tool('invoice_overview', {
    title: 'Invoices overview',
    description: 'The Invoices page at a glance: unpaid (count and sum per currency), overdue with the oldest ones, paid in the last 12 months, issued in the last 12 months, unpaid per client, this year\'s turnover against the 2 000 000 Kč VAT limit (and last year\'s), month by month this year (total, paid, unpaid), and the next invoice number. Start here for any question about invoices or what clients owe him.',
    inputSchema: z.object({}), annotations: ann.RO,
  }, () => r.safe(async () => { const ctx = await load(); return I.invoiceOverview(ctx.invoices, ctx.profile) }))

  r.tool('list_invoices', {
    title: 'List invoices',
    description: 'Invoices newest first, with number, client, status (open, sent, overdue, paid, cancelled), total, issue and due dates, days late. Filters: status (unpaid = open + sent + overdue), client (part of the name), from/to (issue date), search (number, client or item text). Totals per currency for what matched.',
    inputSchema: z.object({ status: z.enum(I.STATUSES).optional(), client: z.string().optional(), from: s.date.optional(), to: s.date.optional(), search: z.string().max(100).optional(), limit: z.number().int().min(1).max(200).optional() }),
    annotations: ann.RO,
  }, (i) => r.safe(async () => I.listInvoices((await load()).invoices, i)))

  r.tool('get_invoice', {
    title: 'Invoice detail',
    description: 'One invoice in full, by number (e.g. PM377) or id: client and supplier as printed, bank account, every line, base, VAT, total, variable symbol, dates, notes, status and when it was sent or paid.',
    inputSchema: z.object({ invoice: z.string().describe('Invoice number or id') }), annotations: ann.RO,
  }, ({ invoice }) => r.safe(async () => I.invoiceDetail(find(await load(), invoice))))

  r.tool('create_invoice', {
    title: 'Create an invoice',
    description: 'Issue a new invoice exactly as the Invoices form does: next number in his format, variable symbol from it, issued today unless given, due after the contact\'s or his default days, his current supplier details, the bank account for the currency (or the one named), status open. Bill a saved contact (contact) or a one-off client (client details). lines: name, price per unit, optional qty (default 1), unit, vat. He is not a VAT payer unless his settings say so, then VAT applies. Read back what he will bill (client, items, total, due) and get his yes before creating. It shows on every device within seconds; sending it to the client is still his step.',
    inputSchema: z.object(draft), annotations: ann.W,
  }, (i) => r.safe(async () => {
    const ctx = await load()
    const inv = I.buildInvoice(ctx, i)
    await save(inv)
    return { created: true, text: `Invoice ${inv.number} created for ${inv.client.name}: ${I.invoiceTotal(inv)} ${inv.currency}, due ${inv.due}. Status open (not sent yet).`, invoice: I.invoiceDetail(inv) }
  }))

  r.tool('update_invoice', {
    title: 'Edit an invoice',
    description: 'Change an existing invoice (by number or id), only the fields passed: client or contact, lines (replaces ALL lines, pass the full list), dates, currency, account, method, language, number, notes. As in the app, a sent or paid invoice keeps the supplier details the client received unless the account changes; an open one takes his current details. For status use set_invoice_status. Confirm with him before editing a sent or paid invoice.',
    inputSchema: z.object({ invoice: z.string().describe('Invoice number or id'), ...draft }), annotations: ann.WI,
  }, ({ invoice, ...d }) => r.safe(async () => {
    const ctx = await load()
    const ex = find(ctx, invoice)
    const next = I.editInvoice(ctx, ex, d)
    await save(next)
    return { text: `Invoice ${next.number} saved.`, invoice: I.invoiceDetail(next) }
  }))

  r.tool('set_invoice_status', {
    title: 'Mark an invoice sent, paid, unpaid, cancelled',
    description: 'The Invoices menu actions: sent (Mark as sent, open invoices only), paid (Record payment, with the day it arrived; default today), unpaid (undo a payment), cancel (stays in the list as cancelled), restore (undo a cancel). date = the day it was sent or paid, YYYY-MM-DD, not in the future. Only record a payment he confirmed actually arrived.',
    inputSchema: z.object({ invoice: z.string().describe('Invoice number or id'), action: z.enum(['sent', 'paid', 'unpaid', 'cancel', 'restore']), date: s.date.optional() }),
    annotations: ann.WI,
  }, ({ invoice, action, date }) => r.safe(async () => {
    const ctx = await load()
    const { inv, text } = I.changeStatus(find(ctx, invoice), action, date)
    await save(inv)
    return text
  }))

  r.tool('delete_invoice', {
    title: 'Delete an invoice',
    description: 'Delete an invoice for good (by number or id), as the app\'s delete does. Prefer set_invoice_status cancel for an invoice that was sent: a cancelled one stays on record. Always confirm with him first.',
    inputSchema: z.object({ invoice: z.string().describe('Invoice number or id') }), annotations: ann.D,
  }, ({ invoice }) => r.safe(async () => {
    const ctx = await load()
    const ex = find(ctx, invoice)
    await commit(r.db, r.uid, (b) => {
      b.invoices = arr(b, 'invoices').filter((x) => x.id !== ex.id)
      bury(b, rowKey('invoices', { id: ex.id }))
      return { text: '' }
    })
    const now = new Date().toISOString()
    const { error } = await db.from('mc_invoices').update({ deleted_at: now, updated_at: now }).eq('id', ex.id)
    if (error) throw new McError(`The invoice was removed from the app but the invoice table refused (${error.message}). Tell Michael; it may come back on the next sync.`)
    return `Invoice ${ex.number} (${ex.client?.name}, ${I.invoiceTotal(ex)} ${ex.currency}) deleted.`
  }))

  r.tool('list_invoice_contacts', {
    title: 'Invoice contacts and bank accounts',
    description: 'The companies and people he invoices (id, name, IČO, DIČ, address, email, own due days, note) with how many invoices each has and what is unpaid, plus his bank accounts for invoices (label, currency, default) and his default due days and number format.',
    inputSchema: z.object({ search: z.string().max(100).optional() }), annotations: ann.RO,
  }, ({ search }) => r.safe(async () => {
    const ctx = await load()
    const q = (search ?? '').toLowerCase()
    return {
      contacts: ctx.contacts.filter((c) => !q || String(c.name).toLowerCase().includes(q) || String(c.ico ?? '') === q).sort((a, b) => String(a.name).localeCompare(String(b.name))).map((c) => {
        const mine = ctx.invoices.filter((x) => x.clientId === c.id)
        const unpaid = mine.filter((x) => ['open', 'sent', 'overdue'].includes(I.shownStatus(x)))
        return { id: c.id, name: c.name, ...Object.fromEntries(['ico', 'dic', 'street', 'city', 'zip', 'country', 'email', 'phone', 'web', 'note'].filter((k) => c[k]).map((k) => [k, c[k]])), ...(c.dueDays != null ? { dueDays: c.dueDays } : {}), invoices: mine.length, unpaid: unpaid.length, unpaidTotal: unpaid.reduce((a, x) => a + I.invoiceTotal(x), 0) }
      }),
      accounts: I.accountsOf(ctx.profile).map((a) => ({ id: a.id, label: a.label, ...(a.currency ? { currency: a.currency } : {}), ...(a.isDefault ? { default: true } : {}) })),
      settings: ctx.profile ? { supplier: ctx.profile.name, vatPayer: !!ctx.profile.vatPayer, dueDays: ctx.profile.dueDays, numberFormat: ctx.profile.numberFormat } : null,
    }
  }))

  r.tool('save_invoice_contact', {
    title: 'Add or edit an invoice contact',
    description: 'Save a company or person he invoices. Without id: a new contact (name required; refuses a duplicate name). With id: change only the fields passed. due_days overrides his default due days for this client (null clears it). Existing invoices keep the client details they were issued with, as in the app.',
    inputSchema: z.object({ id: z.string().optional(), ...party.shape, note: z.string().max(1000).optional(), due_days: z.number().int().min(0).max(365).nullable().optional() }),
    annotations: ann.W,
  }, (i) => r.safe(async () => {
    const ctx = await load()
    const { row, created } = I.saveContact(ctx.contacts, i)
    const { error } = await db.from('mc_invoice_contacts').upsert(I.contactToRow(row), { onConflict: 'id' })
    if (error) throw new McError(`The contact could not be saved (${error.message}).`)
    return `${created ? 'Added' : 'Saved'} invoice contact "${row.name}" (id ${row.id}).`
  }))
}
