import { type ReactNode } from 'react'
import { addDays, invoiceTotal, money, shownStatus } from '../invoicecalc'
import type { Invoice, InvoiceCurrency, InvoiceParty, PaymentMethod } from '../types'

export const METHODS: { id: PaymentMethod; label: string }[] = [
  { id: 'bank', label: 'Bank' }, { id: 'card', label: 'Card' }, { id: 'cash', label: 'Cash' }, { id: 'cod', label: 'Cash on delivery' },
]

export const CURRENCIES: { value: InvoiceCurrency; label: string }[] = [{ value: 'CZK', label: 'CZK' }, { value: 'EUR', label: 'EUR' }, { value: 'USD', label: 'USD' }]

export const fmtDate = (iso?: string) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('cs-CZ') : '')

export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export const partyOf = (c: InvoiceParty): InvoiceParty => ({
  name: c.name, ico: c.ico, dic: c.dic, street: c.street, city: c.city, zip: c.zip, country: c.country, email: c.email, phone: c.phone, web: c.web,
})

/** Sums per currency, CZK first: "12 500 Kč + 400 €". */
export function sumText(rows: Invoice[]): string {
  const by = new Map<InvoiceCurrency, number>()
  for (const i of rows) by.set(i.currency, (by.get(i.currency) ?? 0) + invoiceTotal(i))
  if (!by.size) return money(0, 'CZK', 0)
  return [...by.entries()].sort(([a], [b]) => (a === 'CZK' ? -1 : b === 'CZK' ? 1 : a.localeCompare(b)))
    .map(([c, n]) => money(n, c, 0)).join(' + ')
}

/* ---------- the list: status cards that filter, then rows ---------- */

export type Filter = 'all' | 'unpaid' | 'overdue' | 'paid' | 'cancelled'

export function inFilter(i: Invoice, f: Filter, today: string): boolean {
  const s = shownStatus(i, today)
  const yearAgo = addDays(today, -365)
  if (f === 'unpaid') return s === 'open' || s === 'sent' || s === 'overdue'
  if (f === 'overdue') return s === 'overdue'
  if (f === 'paid') return s === 'paid' && (i.paidOn ?? i.issued) >= yearAgo
  if (f === 'cancelled') return s === 'cancelled' && i.issued >= yearAgo
  return i.issued >= yearAgo && s !== 'cancelled'
}

/** Bars per period: what was invoiced, how much of it is paid. CZK only. */
export type Period = 'months' | 'quarters' | 'years'

export function periodBuckets(invoices: Invoice[], year: string, period: Period): { key: string; name: string; paid: number; unpaid: number; count: number }[] {
  const live = invoices.filter((i) => i.status !== 'cancelled' && i.currency === 'CZK')
  const sum = (rows: Invoice[]) => {
    const paid = rows.filter((i) => i.status === 'paid').reduce((s, i) => s + invoiceTotal(i), 0)
    return { paid, unpaid: rows.reduce((s, i) => s + invoiceTotal(i), 0) - paid, count: rows.length }
  }
  if (period === 'years') {
    const ys = [...new Set(live.map((i) => i.issued.slice(0, 4)))].sort().slice(-6)
    return ys.map((y) => ({ key: y, name: y, ...sum(live.filter((i) => i.issued.startsWith(y))) }))
  }
  if (period === 'quarters') {
    return [1, 2, 3, 4].map((q) => ({ key: `${year}-Q${q}`, name: `Q${q}`, ...sum(live.filter((i) => i.issued.startsWith(year) && Math.ceil(Number(i.issued.slice(5, 7)) / 3) === q)) }))
  }
  return Array.from({ length: 12 }, (_, m) => {
    const key = `${year}-${String(m + 1).padStart(2, '0')}`
    return { key, name: new Date(Number(year), m, 1).toLocaleDateString('en-GB', { month: 'long' }), ...sum(live.filter((i) => i.issued.startsWith(key))) }
  })
}

/* ---------- overview: Fakturoid's Přehled ---------- */

export const QUIET_DAYS = 45

export function IconAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return <button type="button" className="iv-iact" onClick={onClick}>{icon}<span>{label}</span></button>
}
