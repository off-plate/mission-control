/* INVOICES IN SUPABASE (2026-11-01). The app keeps working from its own copy
   (the state blob, offline first, the phone shell reads it), and every invoice,
   contact, bank account and the supplier row is mirrored into its own owner-only
   table (supabase/invoices.sql). Rules:
   - the newer updatedAt wins, on both sides;
   - a delete is a deleted_at stamp, so a device that has not heard yet cannot
     bring the row back, and a row buried here is never revived by a pull;
   - a pull stamps what it took as already pushed, so nothing echoes back. */
import { useEffect, useRef } from 'react'
import { dbClient, currentAccount, onAccountChange, SUPABASE_ENABLED } from './supabase'
import { invoiceTotal } from './invoicecalc'
import type { BankAccount, Invoice, InvoiceClient, InvoiceProfile } from './types'

type Row = Record<string, unknown>
const iso = (ms: number) => new Date(ms).toISOString()
const ms = (s: unknown) => (typeof s === 'string' ? Date.parse(s) : 0)
const nul = <T>(v: T | undefined | '') => (v === undefined || v === '' ? null : v)

const invToRow = (i: Invoice): Row => ({
  id: i.id, number: i.number, status: i.status, client_id: nul(i.clientId), client: i.client, supplier: i.supplier, account_id: nul(i.accountId),
  issued: i.issued, taxable: nul(i.taxable), due: i.due, sent_on: nul(i.sentOn), paid_on: nul(i.paidOn), method: i.method, currency: i.currency,
  lang: i.lang, vs: nul(i.vs), order_no: nul(i.orderNo), lines: i.lines, note_before: nul(i.noteBefore), note_after: nul(i.noteAfter),
  footer: nul(i.footer), total: invoiceTotal(i), created_at: iso(i.createdAt), updated_at: iso(i.updatedAt), deleted_at: null,
})
const rowToInv = (r: Row): Invoice => ({
  id: String(r.id), number: String(r.number), status: r.status as Invoice['status'], clientId: (r.client_id as string) ?? undefined,
  client: r.client as Invoice['client'], supplier: r.supplier as Invoice['supplier'], accountId: (r.account_id as string) ?? undefined,
  issued: String(r.issued), taxable: (r.taxable as string) ?? String(r.issued), due: String(r.due), sentOn: (r.sent_on as string) ?? undefined,
  paidOn: (r.paid_on as string) ?? undefined, method: r.method as Invoice['method'], currency: r.currency as Invoice['currency'],
  lang: r.lang as Invoice['lang'], vs: (r.vs as string) ?? '', orderNo: (r.order_no as string) ?? undefined, lines: r.lines as Invoice['lines'],
  noteBefore: (r.note_before as string) ?? undefined, noteAfter: (r.note_after as string) ?? undefined, footer: (r.footer as string) ?? undefined,
  createdAt: ms(r.created_at), updatedAt: ms(r.updated_at),
})
const CONTACT_COLS = ['name', 'ico', 'dic', 'street', 'city', 'zip', 'country', 'email', 'phone', 'web', 'note'] as const
const contactToRow = (c: InvoiceClient): Row => ({
  id: c.id, ...Object.fromEntries(CONTACT_COLS.map((k) => [k, nul(c[k])])), name: c.name, due_days: c.dueDays ?? null,
  created_at: iso(c.createdAt), updated_at: iso(c.updatedAt), deleted_at: null,
})
const rowToContact = (r: Row): InvoiceClient => ({
  id: String(r.id), ...Object.fromEntries(CONTACT_COLS.map((k) => [k, (r[k] as string) ?? undefined])), name: String(r.name ?? ''),
  dueDays: (r.due_days as number) ?? undefined, createdAt: ms(r.created_at), updatedAt: ms(r.updated_at),
}) as InvoiceClient
const accToRow = (a: BankAccount, at: number): Row => ({
  id: a.id, label: a.label, account: nul(a.account), iban: nul(a.iban), swift: nul(a.swift), currency: a.currency ?? null,
  is_default: !!a.isDefault, updated_at: iso(at), deleted_at: null,
})
const rowToAcc = (r: Row): BankAccount => ({
  id: String(r.id), label: String(r.label ?? ''), account: (r.account as string) ?? undefined, iban: (r.iban as string) ?? undefined,
  swift: (r.swift as string) ?? undefined, currency: (r.currency as BankAccount['currency']) ?? undefined, isDefault: !!r.is_default,
})

export interface InvoiceCloudDeps {
  invoices: Invoice[]; setInvoices: (f: (prev: Invoice[]) => Invoice[]) => void
  invoiceClients: InvoiceClient[]; setInvoiceClients: (f: (prev: InvoiceClient[]) => InvoiceClient[]) => void
  invoiceProfile: InvoiceProfile[]; setInvoiceProfile: (f: (prev: InvoiceProfile[]) => InvoiceProfile[]) => void
  isBuried: (key: string) => boolean
}

/** Merge a table's rows into local rows by updatedAt. Returns the next list and the stamps it took. */
export function mergeRows<T extends { id: string; updatedAt: number }>(local: T[], remote: Row[], toLocal: (r: Row) => T, buried: (id: string) => boolean, pushed: Map<string, number>): T[] {
  const byId = new Map(local.map((x) => [x.id, x]))
  for (const r of remote) {
    const id = String(r.id), at = ms(r.updated_at), mine = byId.get(id)
    if (r.deleted_at) { if (mine && at >= mine.updatedAt) byId.delete(id); pushed.set(id, at); continue }
    if (buried(id)) continue
    if (!mine || at > mine.updatedAt) { byId.set(id, toLocal(r)); pushed.set(id, at) }
    else if (at === mine.updatedAt) pushed.set(id, at)
  }
  return [...byId.values()]
}

export function useInvoiceCloud(d: InvoiceCloudDeps): void {
  const ref = useRef(d); ref.current = d
  const pushed = useRef({ inv: new Map<string, number>(), con: new Map<string, number>(), acc: new Map<string, number>(), set: 0 })
  const known = useRef({ inv: new Set<string>(), con: new Set<string>(), acc: new Set<string>() })
  const ready = useRef(false)

  /* Pull: on sign-in, on load, and whenever another device writes. */
  useEffect(() => {
    if (!SUPABASE_ENABLED) return
    let live = true
    let channel: { unsubscribe: () => unknown } | null = null
    const pull = async () => {
      const c = dbClient(); const me = await currentAccount()
      if (!c || !me || !live) return
      const [inv, con, acc, set] = await Promise.all([
        c.from('mc_invoices').select('*'), c.from('mc_invoice_contacts').select('*'),
        c.from('mc_invoice_accounts').select('*'), c.from('mc_invoice_settings').select('*'),
      ])
      if (!live || inv.error || con.error || acc.error || set.error) {
        if (inv.error || con.error) console.warn('[invoices] cloud read failed', inv.error?.message ?? con.error?.message)
        return
      }
      const p = pushed.current, x = ref.current
      x.setInvoices((prev) => mergeRows(prev, inv.data ?? [], rowToInv, (id) => x.isBuried(`invoices:${id}`), p.inv))
      x.setInvoiceClients((prev) => mergeRows(prev, con.data ?? [], rowToContact, (id) => x.isBuried(`invoiceClients:${id}`), p.con))
      const srow = (set.data ?? [])[0] as Row | undefined
      const accRows = (acc.data ?? []) as Row[]
      x.setInvoiceProfile((prev) => {
        const mine = prev[0]
        const remoteAt = srow ? ms(srow.updated_at) : 0
        const accounts = accRows.filter((r) => !r.deleted_at).map(rowToAcc)
        accRows.forEach((r) => p.acc.set(String(r.id), ms(r.updated_at)))
        if (srow && (!mine || remoteAt > mine.updatedAt)) {
          p.set = remoteAt
          return [{ ...(srow.profile as InvoiceProfile), id: 'me', accounts: accounts.length ? accounts : mine?.accounts, updatedAt: remoteAt }]
        }
        if (srow && mine && remoteAt === mine.updatedAt) p.set = remoteAt
        return prev
      })
      ready.current = true
    }
    void pull()
    const c = dbClient()
    if (c) {
      const ch = c.channel('mc-invoices-live')
      for (const t of ['mc_invoices', 'mc_invoice_contacts', 'mc_invoice_accounts', 'mc_invoice_settings']) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => { void pull() })
      }
      channel = ch.subscribe()
    }
    const off = onAccountChange((a) => { if (a) void pull() })
    return () => { live = false; off(); void channel?.unsubscribe() }
  }, [])

  /* Push: rows newer than what the server last had, deletes as deleted_at. */
  useEffect(() => {
    if (!SUPABASE_ENABLED || !ready.current) return
    const t = window.setTimeout(async () => {
      const c = dbClient(); if (!c || !(await currentAccount())) return
      const p = pushed.current, k = known.current, x = ref.current
      const now = new Date().toISOString()
      const send = async (table: string, rows: Row[]) => {
        if (!rows.length) return true
        const { error } = await c.from(table).upsert(rows, { onConflict: 'id' })
        if (error) console.warn('[invoices] cloud write failed', table, error.message)
        return !error
      }
      const gone = async (table: string, ids: string[]) => {
        if (!ids.length) return
        const { error } = await c.from(table).update({ deleted_at: now, updated_at: now }).in('id', ids)
        if (error) console.warn('[invoices] cloud delete failed', table, error.message)
      }
      const invNew = x.invoices.filter((i) => (p.inv.get(i.id) ?? -1) < i.updatedAt)
      if (await send('mc_invoices', invNew.map(invToRow))) invNew.forEach((i) => p.inv.set(i.id, i.updatedAt))
      const conNew = x.invoiceClients.filter((r) => (p.con.get(r.id) ?? -1) < r.updatedAt)
      if (await send('mc_invoice_contacts', conNew.map(contactToRow))) conNew.forEach((r) => p.con.set(r.id, r.updatedAt))
      const prof = x.invoiceProfile[0]
      if (prof && prof.updatedAt > p.set) {
        const { accounts, id: _id, updatedAt, ...rest } = prof
        void _id
        const { error } = await c.from('mc_invoice_settings').upsert({ profile: rest, updated_at: iso(updatedAt) }, { onConflict: 'owner' })
        if (!error) {
          p.set = updatedAt
          const accs = accounts ?? []
          if (await send('mc_invoice_accounts', accs.map((a) => accToRow(a, updatedAt)))) accs.forEach((a) => p.acc.set(a.id, updatedAt))
        } else console.warn('[invoices] cloud write failed', 'mc_invoice_settings', error.message)
      }
      /* What was here last time and is gone now was deleted on this device. */
      const ids = { inv: new Set(x.invoices.map((i) => i.id)), con: new Set(x.invoiceClients.map((r) => r.id)), acc: new Set((prof?.accounts ?? []).map((a) => a.id)) }
      await gone('mc_invoices', [...k.inv].filter((id) => !ids.inv.has(id)))
      await gone('mc_invoice_contacts', [...k.con].filter((id) => !ids.con.has(id)))
      await gone('mc_invoice_accounts', [...k.acc].filter((id) => !ids.acc.has(id)))
      known.current = ids
    }, 1200)
    return () => window.clearTimeout(t)
  }, [d.invoices, d.invoiceClients, d.invoiceProfile])
}
