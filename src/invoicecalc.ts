/* The invoice arithmetic, kept pure so it can be checked without the page:
   numbering, totals, status, the Czech account to IBAN conversion, and the
   QR Platba (SPAYD) string. */
import type { BankAccount, Invoice, InvoiceCurrency, InvoiceLine, InvoiceProfile } from './types'

export const DEFAULT_PROFILE: Omit<InvoiceProfile, 'id' | 'updatedAt'> = {
  name: '', country: 'Česká republika', vatPayer: false, dueDays: 14, numberFormat: 'YYYY-NNNN',
  regNote: 'Fyzická osoba zapsaná v živnostenském rejstříku.',
}

/** His accounts, with the single account of the first version carried over as the first one. */
export function accountsOf(p: Pick<InvoiceProfile, 'accounts' | 'account' | 'iban' | 'swift'> | undefined): BankAccount[] {
  if (p?.accounts?.length) return p.accounts
  if (p?.account || p?.iban) return [{ id: 'acc-main', label: 'Main account', account: p.account, iban: p.iban, swift: p.swift, isDefault: true }]
  return []
}
/** The account an invoice in this currency goes to by itself: one in that currency, else the default. */
export function pickAccount(accounts: BankAccount[], currency: InvoiceCurrency): BankAccount | undefined {
  return accounts.find((a) => a.currency === currency && a.isDefault) ?? accounts.find((a) => a.currency === currency)
    ?? accounts.find((a) => a.isDefault) ?? accounts[0]
}

export const isoDay = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return isoDay(d)
}
export const daysBetween = (a: string, b: string): number =>
  Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86400000)

/* ---------- numbering ---------- */

function formatParts(format: string, issued: string): { pre: string; post: string; width: number } {
  const [y, m] = issued.split('-')
  const f = format.replace(/YYYY/g, y).replace(/YY/g, y.slice(2)).replace(/MM/g, m)
  const run = f.match(/N+/)
  if (!run) return { pre: f, post: '', width: 0 }
  return { pre: f.slice(0, run.index), post: f.slice((run.index ?? 0) + run[0].length), width: run[0].length }
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The next free number in this format for the issue date's period. */
export function nextNumber(invoices: Pick<Invoice, 'number'>[], format: string, issued: string): string {
  const { pre, post, width } = formatParts(format || 'YYYY-NNNN', issued)
  if (!width) return pre
  const re = new RegExp(`^${esc(pre)}(\\d+)${esc(post)}$`)
  const top = invoices.reduce((n, i) => { const m = i.number.match(re); return m ? Math.max(n, Number(m[1])) : n }, 0)
  return `${pre}${String(top + 1).padStart(width, '0')}${post}`
}
export const vsFromNumber = (n: string): string => n.replace(/\D/g, '').slice(-10)

/* ---------- totals ---------- */

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
export interface Totals { base: number; vat: number; total: number; byRate: { rate: number; base: number; vat: number }[] }
export function totals(lines: InvoiceLine[], vatPayer: boolean): Totals {
  const rates = new Map<number, { base: number; vat: number }>()
  for (const l of lines) {
    const base = r2((Number(l.qty) || 0) * (Number(l.price) || 0))
    const rate = vatPayer ? Number(l.vat) || 0 : 0
    const cur = rates.get(rate) ?? { base: 0, vat: 0 }
    cur.base = r2(cur.base + base)
    rates.set(rate, cur)
  }
  const byRate = [...rates.entries()].map(([rate, v]) => ({ rate, base: v.base, vat: r2(v.base * rate / 100) })).sort((a, b) => b.rate - a.rate)
  const base = r2(byRate.reduce((s, r) => s + r.base, 0))
  const vat = r2(byRate.reduce((s, r) => s + r.vat, 0))
  return { base, vat, total: r2(base + vat), byRate }
}
export const invoiceTotal = (i: Pick<Invoice, 'lines' | 'supplier'>): number => totals(i.lines, i.supplier.vatPayer).total

/* ---------- status ---------- */

export type ShownStatus = 'open' | 'sent' | 'overdue' | 'paid' | 'cancelled'
export function shownStatus(i: Pick<Invoice, 'status' | 'due'>, today = isoDay()): ShownStatus {
  if (i.status === 'paid' || i.status === 'cancelled') return i.status
  return i.due < today ? 'overdue' : i.status
}
export const STATUS_LABEL: Record<ShownStatus, string> = { open: 'Open', sent: 'Sent', overdue: 'Overdue', paid: 'Paid', cancelled: 'Cancelled' }

export function money(n: number, cur: InvoiceCurrency = 'CZK', decimals = 2): string {
  return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: cur, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n)
}

/* ---------- bank ---------- */

function mod97(digits: string): number {
  let r = 0
  for (const ch of digits) r = (r * 10 + Number(ch)) % 97
  return r
}
/** "19-2000145399/0800" -> "CZ65 0800 0000 1920 0014 5399" without spaces. Empty if it does not parse. */
export function czIban(account: string): string {
  const m = account.replace(/\s/g, '').match(/^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/)
  if (!m) return ''
  const bban = m[3] + (m[1] ?? '').padStart(6, '0') + m[2].padStart(10, '0')
  const check = 98 - mod97(bban + '123500') // C=12 Z=35, then 00
  return `CZ${String(check).padStart(2, '0')}${bban}`
}
export const ibanSpaced = (iban: string): string => iban.replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim()

/** QR Platba (SPAYD 1.0). Needs an IBAN; CZK or EUR only. */
export function spayd(i: Invoice): string {
  const iban = (i.supplier.iban || czIban(i.supplier.account ?? '')).replace(/\s/g, '').toUpperCase()
  if (!iban || (i.currency !== 'CZK' && i.currency !== 'EUR')) return ''
  const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[*]/g, ' ').replace(/[^\x20-\x7e]/g, '')
  const acc = i.supplier.swift ? `${iban}+${i.supplier.swift.replace(/\s/g, '').toUpperCase()}` : iban
  const parts = [`SPD*1.0*ACC:${acc}`, `AM:${invoiceTotal(i).toFixed(2)}`, `CC:${i.currency}`]
  if (i.due) parts.push(`DT:${i.due.replace(/-/g, '')}`)
  if (i.vs) parts.push(`X-VS:${i.vs.replace(/\D/g, '').slice(0, 10)}`)
  parts.push(`MSG:${ascii(`Faktura ${i.number}`).slice(0, 60)}`)
  return parts.join('*')
}
