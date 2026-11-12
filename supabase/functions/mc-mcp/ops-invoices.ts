/* Invoices (the Fakturoid rebuild), as plain functions. NO network here: tools-invoices.ts reads
   and writes the tables. Ports, with the app's file named beside each:
   - rows <-> invoices      src/invoicecloud.ts invToRow / rowToInv / contactToRow / rowToContact / rowToAcc
   - combine                src/invoicecloud.ts mergeRows: the newer updatedAt wins, a deleted_at row or a
                            buried key never comes back
   - numbering, totals, status, IBAN   src/invoicecalc.ts (nextNumber, vsFromNumber, totals, shownStatus,
                            pickAccount, accountsOf, czIban)
   - a new invoice          src/invoicespage.tsx InvoiceForm's first draft + draftFinal + supplierOf
   - status changes         the page's menu: Mark as sent, Record payment, Mark as unpaid, Cancel, Restore
   - overview               the page's status cards (inFilter) and Statistics (periodBuckets, VAT limit)

   Where the tables live: supabase/invoices.sql. The app pulls them on load and on every change
   (realtime), so a write here shows on every device within seconds. */
import { McError, dateKey, fold, isDate, type Row } from './ops.ts'

export type Inv = Row
const iso = (ms: number) => new Date(ms).toISOString()
const ms = (s: unknown) => (typeof s === 'string' ? Date.parse(s) : 0)
const nul = <T>(v: T | undefined | '') => (v === undefined || v === '' ? null : v)

/* ---------- src/invoicecalc.ts ---------- */
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
export function totals(lines: Row[], vatPayer: boolean) {
  const rates = new Map<number, { base: number }>()
  for (const l of lines) {
    const base = r2((Number(l.qty) || 0) * (Number(l.price) || 0))
    const rate = vatPayer ? Number(l.vat) || 0 : 0
    const cur = rates.get(rate) ?? { base: 0 }
    cur.base = r2(cur.base + base); rates.set(rate, cur)
  }
  const byRate = [...rates.entries()].map(([rate, v]) => ({ rate, base: v.base, vat: r2(v.base * rate / 100) })).sort((a, b) => b.rate - a.rate)
  const base = r2(byRate.reduce((s, r) => s + r.base, 0)); const vat = r2(byRate.reduce((s, r) => s + r.vat, 0))
  return { base, vat, total: r2(base + vat), byRate }
}
export const invoiceTotal = (i: Inv): number => totals(i.lines ?? [], !!i.supplier?.vatPayer).total
export function shownStatus(i: Inv, today = dateKey()): string {
  if (i.status === 'paid' || i.status === 'cancelled') return i.status
  return i.due < today ? 'overdue' : i.status
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export function nextNumber(invoices: Inv[], format: string, issued: string): string {
  const [y, m] = issued.split('-')
  const f = (format || 'YYYY-NNNN').replace(/YYYY/g, y).replace(/YY/g, y.slice(2)).replace(/MM/g, m)
  const run = f.match(/N+/)
  if (!run) return f
  const pre = f.slice(0, run.index); const post = f.slice((run.index ?? 0) + run[0].length); const width = run[0].length
  const re = new RegExp(`^${esc(pre)}(\\d+)${esc(post)}$`)
  const top = invoices.reduce((n, i) => { const mm = String(i.number).match(re); return mm ? Math.max(n, Number(mm[1])) : n }, 0)
  return `${pre}${String(top + 1).padStart(width, '0')}${post}`
}
export const vsFromNumber = (n: string): string => n.replace(/\D/g, '').slice(-10)
export const addDays = (d: string, n: number): string => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000)
function mod97(digits: string): number { let r = 0; for (const ch of digits) r = (r * 10 + Number(ch)) % 97; return r }
export function czIban(account: string): string {
  const m = account.replace(/\s/g, '').match(/^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/)
  if (!m) return ''
  const bban = m[3] + (m[1] ?? '').padStart(6, '0') + m[2].padStart(10, '0')
  return `CZ${String(98 - mod97(bban + '123500')).padStart(2, '0')}${bban}`
}
export function accountsOf(p: Row | undefined): Row[] {
  if (p?.accounts?.length) return p.accounts
  if (p?.account || p?.iban) return [{ id: 'acc-main', label: 'Main account', account: p.account, iban: p.iban, swift: p.swift, isDefault: true }]
  return []
}
export function pickAccount(accounts: Row[], currency: string): Row | undefined {
  return accounts.find((a) => a.currency === currency && a.isDefault) ?? accounts.find((a) => a.currency === currency) ?? accounts.find((a) => a.isDefault) ?? accounts[0]
}
const PARTY = ['name', 'ico', 'dic', 'street', 'city', 'zip', 'country', 'email', 'phone', 'web'] as const
/** src/invoicespage.tsx partyOf: the printed fields only, empty ones left out. */
export const partyOf = (c: Row): Row => Object.fromEntries(PARTY.filter((k) => c[k] !== undefined && c[k] !== null && c[k] !== '').map((k) => [k, c[k]]))
/** src/invoicespage.tsx supplierOf. */
export function supplierOf(p: Row, a?: Row): Row {
  return { ...partyOf(p), account: a?.account, iban: a?.iban || czIban(a?.account ?? '') || undefined, swift: a?.swift, vatPayer: !!p.vatPayer, regNote: p.regNote }
}

/* ---------- src/invoicecloud.ts mapping ---------- */
export const invToRow = (i: Inv): Row => ({
  id: i.id, number: i.number, status: i.status, client_id: nul(i.clientId), client: i.client, supplier: i.supplier, account_id: nul(i.accountId),
  issued: i.issued, taxable: nul(i.taxable), due: i.due, sent_on: nul(i.sentOn), paid_on: nul(i.paidOn), method: i.method, currency: i.currency,
  lang: i.lang, vs: nul(i.vs), order_no: nul(i.orderNo), lines: i.lines, note_before: nul(i.noteBefore), note_after: nul(i.noteAfter),
  footer: nul(i.footer), total: invoiceTotal(i), created_at: iso(i.createdAt), updated_at: iso(i.updatedAt), deleted_at: null,
})
export const rowToInv = (r: Row): Inv => ({
  id: String(r.id), number: String(r.number), status: r.status, clientId: r.client_id ?? undefined,
  client: r.client, supplier: r.supplier, accountId: r.account_id ?? undefined,
  issued: String(r.issued), taxable: r.taxable ?? String(r.issued), due: String(r.due), sentOn: r.sent_on ?? undefined,
  paidOn: r.paid_on ?? undefined, method: r.method, currency: r.currency,
  lang: r.lang, vs: r.vs ?? '', orderNo: r.order_no ?? undefined, lines: r.lines,
  noteBefore: r.note_before ?? undefined, noteAfter: r.note_after ?? undefined, footer: r.footer ?? undefined,
  createdAt: ms(r.created_at), updatedAt: ms(r.updated_at),
})
const CONTACT_COLS = ['name', 'ico', 'dic', 'street', 'city', 'zip', 'country', 'email', 'phone', 'web', 'note'] as const
export const contactToRow = (c: Row): Row => ({
  id: c.id, ...Object.fromEntries(CONTACT_COLS.map((k) => [k, nul(c[k])])), name: c.name, due_days: c.dueDays ?? null,
  created_at: iso(c.createdAt), updated_at: iso(c.updatedAt), deleted_at: null,
})
export const rowToContact = (r: Row): Row => ({
  id: String(r.id), ...Object.fromEntries(CONTACT_COLS.map((k) => [k, r[k] ?? undefined])), name: String(r.name ?? ''),
  dueDays: r.due_days ?? undefined, createdAt: ms(r.created_at), updatedAt: ms(r.updated_at),
})
export const rowToAcc = (r: Row): Row => ({
  id: String(r.id), label: String(r.label ?? ''), account: r.account ?? undefined, iban: r.iban ?? undefined,
  swift: r.swift ?? undefined, currency: r.currency ?? undefined, isDefault: !!r.is_default,
})

/** src/invoicecloud.ts mergeRows, both ways: the table and the app's own copy in the state blob. */
export function combine(tableRows: Row[], blobRows: Row[], toLocal: (r: Row) => Row, buried: Set<string>, field: string): Row[] {
  const byId = new Map<string, Row>()
  const dead = new Set<string>()
  for (const r of tableRows) {
    const id = String(r.id)
    if (r.deleted_at) { dead.add(id); continue }
    if (!buried.has(`${field}:${id}`)) byId.set(id, toLocal(r))
  }
  for (const x of blobRows) {
    const id = String(x.id)
    if (dead.has(id) || buried.has(`${field}:${id}`)) continue
    const t = byId.get(id)
    if (!t || (Number(x.updatedAt) || 0) > (Number(t.updatedAt) || 0)) byId.set(id, x)
  }
  return [...byId.values()]
}

/* ---------- reading ---------- */
const money = (n: number, cur = 'CZK') => `${new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)} ${cur === 'CZK' ? 'Kč' : cur}`
export const STATUSES = ['all', 'unpaid', 'open', 'sent', 'overdue', 'paid', 'cancelled'] as const

export function brief(i: Inv, today = dateKey()): Row {
  const s = shownStatus(i, today)
  const late = s === 'overdue' ? daysBetween(i.due, today) : 0
  return {
    id: i.id, number: i.number, client: i.client?.name ?? '', status: s, total: invoiceTotal(i), currency: i.currency,
    issued: i.issued, due: i.due, ...(late ? { daysLate: late } : {}), ...(i.sentOn ? { sentOn: i.sentOn } : {}), ...(i.paidOn ? { paidOn: i.paidOn } : {}),
  }
}

export interface ListInput { status?: typeof STATUSES[number]; client?: string; from?: string; to?: string; search?: string; limit?: number }
export function listInvoices(all: Inv[], i: ListInput, today = dateKey()): Row {
  const q = fold(i.search ?? ''); const c = fold(i.client ?? '')
  const st = i.status ?? 'all'
  const rows = all.filter((x) => {
    const s = shownStatus(x, today)
    if (st === 'unpaid' && !(s === 'open' || s === 'sent' || s === 'overdue')) return false
    if (st !== 'all' && st !== 'unpaid' && s !== st) return false
    if (c && !fold(x.client?.name ?? '').includes(c)) return false
    if (i.from && x.issued < i.from) return false
    if (i.to && x.issued > i.to) return false
    if (q && !fold(`${x.number} ${x.client?.name ?? ''} ${(x.lines ?? []).map((l: Row) => l.name).join(' ')}`).includes(q)) return false
    return true
  }).sort((a, b) => (a.issued === b.issued ? String(b.number).localeCompare(String(a.number)) : String(b.issued).localeCompare(String(a.issued))))
  const limit = Math.min(Math.max(1, i.limit ?? 50), 200)
  const byCur = new Map<string, number>()
  for (const x of rows) byCur.set(x.currency, r2((byCur.get(x.currency) ?? 0) + invoiceTotal(x)))
  return {
    status: st, count: rows.length, totals: [...byCur.entries()].map(([cur, sum]) => ({ currency: cur, total: sum, text: money(sum, cur) })),
    ...(rows.length > limit ? { shown: limit, note: `Newest ${limit} of ${rows.length}; narrow with from/to or client.` } : {}),
    invoices: rows.slice(0, limit).map((x) => brief(x, today)),
  }
}

export function invoiceDetail(i: Inv, today = dateKey()): Row {
  const t = totals(i.lines ?? [], !!i.supplier?.vatPayer)
  return {
    ...brief(i, today), clientDetails: i.client, ...(i.clientId ? { contactId: i.clientId } : {}),
    supplier: i.supplier, ...(i.accountId ? { accountId: i.accountId } : {}),
    taxable: i.taxable, method: i.method, lang: i.lang, vs: i.vs, ...(i.orderNo ? { orderNo: i.orderNo } : {}),
    lines: (i.lines ?? []).map((l: Row) => ({ id: l.id, name: l.name, qty: l.qty, unit: l.unit, price: l.price, ...(i.supplier?.vatPayer ? { vat: l.vat } : {}), sum: r2((Number(l.qty) || 0) * (Number(l.price) || 0)) })),
    base: t.base, vat: t.vat, totalText: money(t.total, i.currency),
    ...(i.noteBefore ? { noteBefore: i.noteBefore } : {}), ...(i.noteAfter ? { noteAfter: i.noteAfter } : {}), ...(i.footer ? { footer: i.footer } : {}),
    createdAt: i.createdAt ? iso(i.createdAt) : null, updatedAt: i.updatedAt ? iso(i.updatedAt) : null,
  }
}

const VAT_LIMIT = 2_000_000
const VAT_HARD = 2_536_000
/** The page's status cards and Statistics. */
export function invoiceOverview(all: Inv[], profile: Row | undefined, today = dateKey()): Row {
  const yearAgo = addDays(today, -365)
  const sumBy = (rows: Inv[]) => {
    const m = new Map<string, number>()
    for (const x of rows) m.set(x.currency, r2((m.get(x.currency) ?? 0) + invoiceTotal(x)))
    return [...m.entries()].map(([currency, total]) => ({ currency, total, text: money(total, currency) }))
  }
  const card = (rows: Inv[]) => ({ count: rows.length, totals: sumBy(rows) })
  const s = (x: Inv) => shownStatus(x, today)
  const unpaid = all.filter((x) => ['open', 'sent', 'overdue'].includes(s(x)))
  const overdue = all.filter((x) => s(x) === 'overdue')
  const paid12 = all.filter((x) => s(x) === 'paid' && (x.paidOn ?? x.issued) >= yearAgo)
  const issued12 = all.filter((x) => x.issued >= yearAgo && s(x) !== 'cancelled')
  const year = today.slice(0, 4)
  const live = all.filter((x) => x.status !== 'cancelled' && x.currency === 'CZK')
  const yearSum = r2(live.filter((x) => x.issued.startsWith(year)).reduce((a, x) => a + invoiceTotal(x), 0))
  const prevSum = r2(live.filter((x) => x.issued.startsWith(String(Number(year) - 1))).reduce((a, x) => a + invoiceTotal(x), 0))
  const months = Array.from({ length: 12 }, (_, k) => {
    const key = `${year}-${String(k + 1).padStart(2, '0')}`
    const rows = live.filter((x) => x.issued.startsWith(key))
    const paid = r2(rows.filter((x) => x.status === 'paid').reduce((a, x) => a + invoiceTotal(x), 0))
    const total = r2(rows.reduce((a, x) => a + invoiceTotal(x), 0))
    return { month: key, invoices: rows.length, total, paid, unpaid: r2(total - paid) }
  }).filter((m) => m.invoices || m.month <= today.slice(0, 7))
  const byClient = new Map<string, { count: number; unpaid: number }>()
  for (const x of unpaid.filter((y) => y.currency === 'CZK')) { const k = x.client?.name ?? '?'; const v = byClient.get(k) ?? { count: 0, unpaid: 0 }; v.count++; v.unpaid = r2(v.unpaid + invoiceTotal(x)); byClient.set(k, v) }
  return {
    today,
    unpaid: card(unpaid), overdue: { ...card(overdue), oldest: overdue.slice().sort((a, b) => a.due.localeCompare(b.due)).slice(0, 5).map((x) => brief(x, today)) },
    paidLast12Months: card(paid12), issuedLast12Months: card(issued12),
    unpaidByClient: [...byClient.entries()].sort((a, b) => b[1].unpaid - a[1].unpaid).map(([client, v]) => ({ client, ...v, text: money(v.unpaid) })),
    vat: {
      vatPayer: !!profile?.vatPayer, year, turnoverCZK: yearSum, text: money(yearSum), shareOfLimitPct: Math.round(Math.min(1, yearSum / VAT_LIMIT) * 100),
      limit: VAT_LIMIT, hardLimit: VAT_HARD, previousYearCZK: prevSum,
      note: 'Over 2 000 000 Kč in a calendar year makes him a VAT payer from the next year; over 2 536 000 Kč, from the day after crossing it. CZK invoices by issue date, cancelled left out (the Statistics tab).',
    },
    months,
    nextNumber: nextNumber(all, profile?.numberFormat ?? 'YYYY-NNNN', today),
    note: 'Overdue = unpaid past its due date. Paid is counted by payment date over the last 12 months. Whether a client really paid is only known once he records it.',
  }
}

/* ---------- writing ---------- */
export interface LineIn { name: string; qty?: number; unit?: string; price: number; vat?: number }
export interface DraftIn {
  contact?: string; client?: Row; lines?: LineIn[]; issued?: string; due?: string; due_days?: number; currency?: 'CZK' | 'EUR' | 'USD'
  account?: string; method?: 'bank' | 'cash' | 'card' | 'cod'; lang?: 'cs' | 'en'; number?: string; order_no?: string
  note_before?: string; note_after?: string; footer?: string
}
export interface Ctx { invoices: Inv[]; contacts: Row[]; profile: Row | undefined }

let seq = 0
const lineId = () => `ln-${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`
export const newInvId = () => `inv-${Date.now().toString(36)}${(seq++).toString(36)}`
export const newContactId = () => `ivc-${Date.now().toString(36)}${(seq++).toString(36)}`

export function findContact(contacts: Row[], ref: string): Row {
  const byId = contacts.find((c) => c.id === ref)
  if (byId) return byId
  const q = fold(ref)
  const exact = contacts.filter((c) => fold(c.name) === q)
  const hits = exact.length ? exact : contacts.filter((c) => fold(c.name).includes(q) || (c.ico && String(c.ico) === ref.trim()))
  if (hits.length === 1) return hits[0]
  if (!hits.length) throw new McError(`No invoice contact matches "${ref}". List them with list_invoice_contacts, or pass client details to bill someone new (or save_invoice_contact first).`)
  throw new McError(`"${ref}" matches ${hits.length} contacts (${hits.slice(0, 6).map((c) => `${c.id}: ${c.name}`).join(' | ')}). Pass the id.`)
}
function findAccount(accounts: Row[], ref: string): Row {
  const q = fold(ref)
  const hit = accounts.filter((a) => a.id === ref || fold(a.label) === q || fold(a.label).includes(q) || (a.account && String(a.account).replace(/\s/g, '') === ref.replace(/\s/g, '')))
  if (hit.length === 1) return hit[0]
  throw new McError(hit.length ? `"${ref}" matches several accounts (${hit.map((a) => a.label).join(', ')}).` : `No bank account matches "${ref}". His accounts: ${accounts.map((a) => `${a.label}${a.currency ? ` (${a.currency})` : ''}`).join(', ') || 'none set up'}.`)
}
function cleanLines(lines: LineIn[] | undefined, vatDefault = 21): Row[] {
  if (!Array.isArray(lines) || !lines.length) throw new McError('Describe at least one item (lines: name and price; qty defaults to 1).')
  const out = lines.filter((l) => String(l.name ?? '').trim()).map((l) => {
    const price = Number(l.price); const qty = l.qty === undefined ? 1 : Number(l.qty)
    if (!Number.isFinite(price)) throw new McError(`"${l.name}": price must be a number (per unit, before VAT).`)
    if (!Number.isFinite(qty) || qty <= 0) throw new McError(`"${l.name}": qty must be more than 0.`)
    return { id: lineId(), name: String(l.name).trim().slice(0, 300), qty, unit: String(l.unit ?? '').trim().slice(0, 20), price, vat: l.vat === undefined ? vatDefault : Number(l.vat) || 0 }
  })
  if (!out.length) throw new McError('Describe at least one item: every line needs a name.')
  return out
}
function checkDates(issued: string, due: string): void {
  if (!isDate(issued)) throw new McError(`issued must be YYYY-MM-DD, got "${issued}".`)
  if (!isDate(due)) throw new McError(`due must be YYYY-MM-DD, got "${due}".`)
  if (due < issued) throw new McError('The due date is before the issue date.')
}
const txt = (s: string | undefined, n = 2000) => (s === undefined ? undefined : s.trim().slice(0, n))

/** InvoiceForm's first draft for a new invoice, then draftFinal. */
export function buildInvoice(ctx: Ctx, d: DraftIn, now = Date.now()): Inv {
  const p = ctx.profile
  if (!p?.name) throw new McError('His supplier details are not set up (Invoices > Settings in the app), so an invoice would print without a supplier. Nothing was created.')
  const today = dateKey(new Date(now))
  let clientId: string | undefined; let client: Row; let contactDue: number | undefined
  if (d.contact) { const c = findContact(ctx.contacts, d.contact); clientId = c.id; client = partyOf(c); contactDue = c.dueDays }
  else if (d.client?.name && String(d.client.name).trim()) client = partyOf({ ...d.client, name: String(d.client.name).trim() })
  else throw new McError('Who is the invoice for? Pass contact (id or name from list_invoice_contacts) or client details (at least a name).')
  const issued = d.issued ?? today
  if (!isDate(issued)) throw new McError(`issued must be YYYY-MM-DD, got "${d.issued}".`)
  const days = d.due_days ?? contactDue ?? p.dueDays ?? 14
  const due = d.due ?? addDays(issued, days)
  checkDates(issued, due)
  const currency = d.currency ?? 'CZK'
  const accounts = accountsOf(p)
  const account = d.account ? findAccount(accounts, d.account) : pickAccount(accounts, currency)
  const method = d.method ?? 'bank'
  if (method === 'bank' && !account) throw new McError('No bank account is set up for invoices, so the customer would have nowhere to pay. Add one in Invoices > Settings, or pass method cash/card.')
  const number = (d.number ?? nextNumber(ctx.invoices, p.numberFormat, issued)).trim()
  if (!number) throw new McError('The invoice needs a number.')
  if (ctx.invoices.some((i) => i.number === number)) throw new McError(`${number} is already used.`)
  const footer = txt(d.footer) ?? p.footer ?? ''
  return {
    id: newInvId(), number, vs: vsFromNumber(number), issued, taxable: issued, due,
    ...(clientId ? { clientId } : {}), client, supplier: supplierOf(p, account), ...(account ? { accountId: account.id } : {}),
    method, currency, lang: d.lang ?? 'cs', lines: cleanLines(d.lines),
    noteBefore: txt(d.note_before) ?? '', noteAfter: txt(d.note_after) ?? '', footer, orderNo: txt(d.order_no, 60) ?? '',
    status: 'open', createdAt: now, updatedAt: now,
  }
}

/** Editing an existing invoice: draftFinal's rules. A sent or paid invoice keeps the supplier copy the
 *  customer received unless the account changes; an open one takes his current details. */
export function editInvoice(ctx: Ctx, ex: Inv, d: DraftIn, now = Date.now()): Inv {
  const p = ctx.profile ?? {}
  const next: Inv = structuredClone(ex)
  if (d.contact) { const c = findContact(ctx.contacts, d.contact); next.clientId = c.id; next.client = partyOf(c) }
  else if (d.client) { if (!String(d.client.name ?? ex.client?.name ?? '').trim()) throw new McError('The client needs a name.'); next.client = partyOf({ ...ex.client, ...d.client }); delete next.clientId }
  if (d.issued) next.issued = d.issued
  if (d.due) next.due = d.due
  else if (d.due_days !== undefined) next.due = addDays(next.issued, d.due_days)
  else if (d.issued) next.due = addDays(d.issued, daysBetween(ex.issued, ex.due))
  checkDates(next.issued, next.due)
  if (d.issued && ex.taxable === ex.issued) next.taxable = d.issued
  if (d.currency) next.currency = d.currency
  if (d.method) next.method = d.method
  if (d.lang) next.lang = d.lang
  if (d.lines) next.lines = cleanLines(d.lines)
  if (d.number !== undefined) {
    const n = d.number.trim()
    if (!n) throw new McError('The invoice needs a number.')
    if (ctx.invoices.some((i) => i.number === n && i.id !== ex.id)) throw new McError(`${n} is already used.`)
    next.vs = next.vs === vsFromNumber(ex.number) ? vsFromNumber(n) : next.vs
    next.number = n
  }
  if (d.order_no !== undefined) next.orderNo = txt(d.order_no, 60)
  if (d.note_before !== undefined) next.noteBefore = txt(d.note_before)
  if (d.note_after !== undefined) next.noteAfter = txt(d.note_after)
  if (d.footer !== undefined) next.footer = txt(d.footer)
  const accounts = accountsOf(p)
  if (d.account) next.accountId = findAccount(accounts, d.account).id
  else if (d.currency && d.currency !== ex.currency) next.accountId = pickAccount(accounts, d.currency)?.id ?? next.accountId
  const account = accounts.find((a) => a.id === next.accountId)
  next.supplier = ex.status !== 'open' && ex.accountId === next.accountId ? ex.supplier : (p.name ? supplierOf(p, account) : ex.supplier)
  next.updatedAt = Math.max(now, (Number(ex.updatedAt) || 0) + 1)
  return next
}

export type StatusAction = 'sent' | 'paid' | 'unpaid' | 'cancel' | 'restore'
/** The page's menu, one action each. */
export function changeStatus(ex: Inv, action: StatusAction, day: string | undefined, now = Date.now()): { inv: Inv; text: string } {
  const today = dateKey(new Date(now))
  const on = day ?? today
  if (!isDate(on)) throw new McError(`date must be YYYY-MM-DD, got "${day}".`)
  if (on > today) throw new McError('That date has not happened yet.')
  const s = shownStatus(ex, today)
  const next: Inv = { ...ex }
  let text: string
  switch (action) {
    case 'sent':
      if (ex.status !== 'open') throw new McError(`${ex.number} is ${s}, not open, so it cannot be marked as sent.`)
      next.status = 'sent'; next.sentOn = on; text = `${ex.number} marked as sent on ${on}.`; break
    case 'paid':
      if (s === 'paid' || s === 'cancelled') throw new McError(`${ex.number} is already ${s}.`)
      next.status = 'paid'; next.paidOn = on; text = `Payment recorded: ${ex.number} (${money(invoiceTotal(ex), ex.currency)}) paid on ${on}.`; break
    case 'unpaid':
      if (ex.status !== 'paid') throw new McError(`${ex.number} is not paid.`)
      next.status = ex.sentOn ? 'sent' : 'open'; delete next.paidOn; text = `${ex.number} is unpaid again (${next.status}).`; break
    case 'cancel':
      if (ex.status === 'cancelled') throw new McError(`${ex.number} is already cancelled.`)
      next.status = 'cancelled'; text = `${ex.number} cancelled. It stays in the list; restore brings it back.`; break
    case 'restore':
      if (ex.status !== 'cancelled') throw new McError(`${ex.number} is not cancelled.`)
      next.status = ex.paidOn ? 'paid' : ex.sentOn ? 'sent' : 'open'; text = `${ex.number} restored (${next.status}).`; break
  }
  next.updatedAt = Math.max(now, (Number(ex.updatedAt) || 0) + 1)
  return { inv: next, text }
}

export interface ContactIn { id?: string; name?: string; ico?: string; dic?: string; street?: string; city?: string; zip?: string; country?: string; email?: string; phone?: string; web?: string; note?: string; due_days?: number | null }
export function saveContact(contacts: Row[], c: ContactIn, now = Date.now()): { row: Row; created: boolean } {
  const ex = c.id ? contacts.find((x) => x.id === c.id) : undefined
  if (c.id && !ex) throw new McError(`No invoice contact has the id "${c.id}".`)
  const name = (c.name ?? ex?.name ?? '').trim()
  if (!name) throw new McError('A contact needs a name.')
  if (!ex && contacts.some((x) => fold(x.name) === fold(name))) throw new McError(`A contact named "${name}" already exists. Pass its id to change it.`)
  const fields: Row = {}
  for (const k of CONTACT_COLS) if (k !== 'name' && c[k as keyof ContactIn] !== undefined) fields[k] = String(c[k as keyof ContactIn] ?? '').trim() || undefined
  const row: Row = { ...(ex ?? { id: newContactId(), createdAt: now }), ...fields, name, updatedAt: Math.max(now, (Number(ex?.updatedAt) || 0) + 1) }
  if (c.due_days !== undefined) { if (c.due_days === null) delete row.dueDays; else row.dueDays = Math.max(0, Math.round(c.due_days)) }
  return { row, created: !ex }
}
