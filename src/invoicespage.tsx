/* INVOICES (2026-11-01, his ask): Fakturoid's core, rebuilt here so invoicing
   lives next to everything else. Reached from the header, beside Ideas.

   Laid out the way Fakturoid is, studied from its own help screenshots after he
   rejected a first version built from memory: a full-width page, underlined
   sections, status cards that ARE the filters, a plain list with a menu per
   row, an invoice page with its actions along the top, and a label-left form
   that ends in one big Create button. On a phone the Nothing app shows status
   only (shells/nothing, V.invoices): nothing is created there.

   Stored in the app state like Prospects: three synced lists, offline first,
   merged by row, deletions buried and undoable. An invoice carries a copy of
   both parties, so editing a contact later never rewrites one already sent. */
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from './store'
import { Sheet } from './modals'
import { Dropdown, Segmented, Select } from './ui'
import * as Icon from './icons'
import { qrMatrix, qrSvgPath } from './qr'
import {
  DEFAULT_PROFILE, STATUS_LABEL, accountsOf, addDays, pickAccount, czIban, daysBetween, ibanSpaced, invoiceTotal, isoDay, money, nextNumber,
  shownStatus, spayd, totals, vsFromNumber, type ShownStatus,
} from './invoicecalc'
import type { BankAccount, Invoice, InvoiceCurrency, InvoiceLang, InvoiceLine, InvoiceParty, InvoiceProfile, PaymentMethod } from './types'
import type { InvoiceClientDraft, InvoiceDraft } from './store/invoices'

type Tab = 'overview' | 'invoices' | 'contacts' | 'stats' | 'settings'
type View =
  | { kind: 'list' }
  | { kind: 'invoice'; id: string }
  | { kind: 'edit'; id?: string; copyOf?: string; clientId?: string }
  | { kind: 'contact'; id: string }

const TAB_KEY = 'mc-invoices-tab'
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'invoices', label: 'Invoices' }, { id: 'contacts', label: 'Contacts' },
  { id: 'stats', label: 'Statistics' }, { id: 'settings', label: 'Settings' },
]
const METHODS: { id: PaymentMethod; label: string }[] = [
  { id: 'bank', label: 'Bank' }, { id: 'card', label: 'Card' }, { id: 'cash', label: 'Cash' }, { id: 'cod', label: 'Cash on delivery' },
]
const CURRENCIES: { value: InvoiceCurrency; label: string }[] = [{ value: 'CZK', label: 'CZK' }, { value: 'EUR', label: 'EUR' }, { value: 'USD', label: 'USD' }]
const LANGS: { value: InvoiceLang; label: string }[] = [{ value: 'cs', label: 'Czech' }, { value: 'en', label: 'English' }]
const DUE_PRESETS = [0, 7, 10, 14, 21, 30, 60]

const fmtDate = (iso?: string) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('cs-CZ') : '')
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const lineId = () => `ln-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const partyOf = (c: InvoiceParty): InvoiceParty => ({
  name: c.name, ico: c.ico, dic: c.dic, street: c.street, city: c.city, zip: c.zip, country: c.country, email: c.email, phone: c.phone, web: c.web,
})

/** Sums per currency, CZK first: "12 500 Kč + 400 €". */
function sumText(rows: Invoice[]): string {
  const by = new Map<InvoiceCurrency, number>()
  for (const i of rows) by.set(i.currency, (by.get(i.currency) ?? 0) + invoiceTotal(i))
  if (!by.size) return money(0, 'CZK', 0)
  return [...by.entries()].sort(([a], [b]) => (a === 'CZK' ? -1 : b === 'CZK' ? 1 : a.localeCompare(b)))
    .map(([c, n]) => money(n, c, 0)).join(' + ')
}

/* ---------- the page ---------- */

export function InvoicesPage() {
  const { invoiceSupplier } = useStore()
  const [tab, setTabRaw] = useState<Tab>(() => {
    try { const t = localStorage.getItem(TAB_KEY) as Tab | null; return t && TABS.some((x) => x.id === t) ? t : 'overview' } catch { return 'overview' }
  })
  const [view, setView] = useState<View>({ kind: 'list' })
  const [filter, setFilter] = useState<Filter>('all')
  const [contactEdit, setContactEdit] = useState<{ id?: string } | null>(null)
  const setTab = (t: Tab) => { setTabRaw(t); setView({ kind: 'list' }); try { localStorage.setItem(TAB_KEY, t) } catch { /* private mode */ } }
  const openInvoice = (id: string) => { setTabRaw('invoices'); setView({ kind: 'invoice', id }) }
  const newInvoice = (clientId?: string) => { setTabRaw('invoices'); setView({ kind: 'edit', clientId }) }
  const openContact = (id: string) => { setTabRaw('contacts'); setView({ kind: 'contact', id }) }
  const openList = (f: Filter) => { setFilter(f); setTab('invoices') }
  useEffect(() => { window.scrollTo({ top: 0 }) }, [tab, view])

  return (
    <div className="iv-page">
      {/* Fakturoid's second row: sections as soft pills on the left, the one
          action on the right. The app header above stays Mission Control's. */}
      <div className="iv-subnav">
        <nav className="iv-tabs" aria-label="Invoices sections">
          {TABS.map((t) => (
            <button key={t.id} type="button" className="iv-tab" aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </nav>
        {view.kind !== 'edit' && (tab === 'contacts' && view.kind === 'list'
          ? <button className="iv-outline" type="button" onClick={() => setContactEdit({})}><Icon.Plus size={16} />New contact</button>
          : <button className="iv-outline" type="button" onClick={() => newInvoice()}><Icon.Plus size={16} />New invoice</button>)}
      </div>

      {!invoiceSupplier?.name && tab !== 'settings' && (
        <div className="iv-notice">
          <span>Your name, IČO, address and bank account go on every invoice.</span>
          <button className="iv-outline" type="button" onClick={() => setTab('settings')}>Fill in your details</button>
        </div>
      )}

      <div className="iv-body">
        {tab === 'overview' && <Overview onOpen={openInvoice} onList={openList} onContact={openContact} />}
        {tab === 'invoices' && view.kind === 'list' && <InvoiceList filter={filter} setFilter={setFilter} onOpen={openInvoice} onNew={() => newInvoice()} />}
        {tab === 'invoices' && view.kind === 'invoice' && (
          <InvoiceDetail id={view.id} onBack={() => setView({ kind: 'list' })} onEdit={(id) => setView({ kind: 'edit', id })}
            onCopy={(id) => setView({ kind: 'edit', copyOf: id })} onContact={openContact} />
        )}
        {tab === 'invoices' && view.kind === 'edit' && (
          <InvoiceForm
            key={`${view.id ?? ''}${view.copyOf ?? ''}${view.clientId ?? ''}`}
            id={view.id} copyOf={view.copyOf} clientId={view.clientId}
            onDone={(id) => setView(id ? { kind: 'invoice', id } : { kind: 'list' })}
          />
        )}
        {tab === 'contacts' && view.kind === 'list' && <ContactList onOpen={openContact} onAdd={() => setContactEdit({})} />}
        {tab === 'contacts' && view.kind === 'contact' && (
          <ContactDetail id={view.id} onBack={() => setView({ kind: 'list' })} onEdit={() => setContactEdit({ id: view.id })}
            onOpen={openInvoice} onNew={newInvoice} />
        )}
        {tab === 'stats' && <Statistics />}
        {tab === 'settings' && <SettingsForm />}
      </div>

      {contactEdit && (
        <ContactSheet id={contactEdit.id} onClose={() => setContactEdit(null)}
          onSaved={(id) => { setContactEdit(null); openContact(id) }} />
      )}
    </div>
  )
}

/* ---------- the list: status cards that filter, then rows ---------- */

type Filter = 'all' | 'unpaid' | 'overdue' | 'paid' | 'cancelled'
const CARDS: { id: Filter; label: string; icon: ReactNode; scope: string }[] = [
  { id: 'all', label: 'All', icon: <Icon.DockInvoice size={26} />, scope: 'last 12 months' },
  { id: 'unpaid', label: 'Unpaid', icon: <Icon.Clock size={26} />, scope: 'incl. overdue' },
  { id: 'overdue', label: 'Overdue', icon: <Icon.Flag size={26} />, scope: 'all time' },
  { id: 'paid', label: 'Paid', icon: <Icon.CheckRing size={26} />, scope: 'last 12 months' },
]

function inFilter(i: Invoice, f: Filter, today: string): boolean {
  const s = shownStatus(i, today)
  const yearAgo = addDays(today, -365)
  if (f === 'unpaid') return s === 'open' || s === 'sent' || s === 'overdue'
  if (f === 'overdue') return s === 'overdue'
  if (f === 'paid') return s === 'paid' && (i.paidOn ?? i.issued) >= yearAgo
  if (f === 'cancelled') return s === 'cancelled' && i.issued >= yearAgo
  return i.issued >= yearAgo && s !== 'cancelled'
}

function InvoiceList({ filter, setFilter, onOpen, onNew }: { filter: Filter; setFilter: (f: Filter) => void; onOpen: (id: string) => void; onNew: () => void }) {
  const { invoices } = useStore()
  const today = isoDay()
  const [q, setQ] = useState('')
  const [order, setOrder] = useState<'new' | 'old'>('new')
  const shown = invoices
    .filter((i) => (q.trim() ? true : inFilter(i, filter, today)))
    .filter((i) => !q.trim() || fold(q.trim()).split(/\s+/).every((w) => fold([i.number, i.client.name, i.client.ico, ...i.lines.map((l) => l.name)].join(' ')).includes(w)))
    .sort((a, b) => (order === 'new' ? 1 : -1) * (b.issued.localeCompare(a.issued) || b.number.localeCompare(a.number)))

  if (!invoices.length) {
    return (
      <div className="iv-card iv-empty">
        <p>Every invoice you issue lives here, with what is paid, what is waiting and what is late.</p>
        <button className="iv-yellow" type="button" onClick={onNew}>Create the first invoice</button>
      </div>
    )
  }
  return (
    <div className="iv-card">
      <div className="iv-cards" role="group" aria-label="Show invoices">
        {CARDS.map((c) => {
          const rows = invoices.filter((i) => inFilter(i, c.id, today))
          return (
            <button key={c.id} type="button" className={`iv-scard is-${c.id}`} aria-pressed={!q.trim() && filter === c.id} onClick={() => { setFilter(c.id); setQ('') }}>
              <span className="iv-scard-ico" aria-hidden="true">{c.icon}</span>
              <span className="iv-scard-body">
                <b className="iv-scard-name">{c.label}</b>
                <span className="iv-scard-sum">{sumText(rows)}</span>
                <small>{plural(rows.length, 'invoice', 'invoices')}, {c.scope}</small>
              </span>
            </button>
          )
        })}
      </div>
      <div className="iv-listbar">
        <label className="iv-search">
          <Icon.Search size={16} />
          <input type="search" value={q} placeholder="Number, client or item" aria-label="Search invoices" onChange={(e) => setQ(e.target.value)} />
        </label>
        <Segmented size="sm" label="Order" value={order} onPick={setOrder} options={[{ id: 'new', label: 'Newest' }, { id: 'old', label: 'Oldest' }]} className="iv-seg-soft" />
      </div>
      {shown.length === 0
        ? <p className="iv-quiet iv-pad">{q.trim() ? 'Nothing matches that search.' : 'No invoices here.'}</p>
        : <InvoiceRows rows={shown} onOpen={onOpen} />}
    </div>
  )
}

/** Fakturoid's row: number, status word, the date (or how late it is), client, amount, menu. */
function InvoiceRows({ rows, onOpen, hideClient }: { rows: Invoice[]; onOpen: (id: string) => void; hideClient?: boolean }) {
  const { patchInvoice } = useStore()
  const today = isoDay()
  return (
    <ul className={`iv-rows${hideClient ? ' no-client' : ''}`}>
      <li className="iv-row is-head" aria-hidden="true">
        <span>Number</span><span>Status</span><span>Issued</span><span>Due</span>{!hideClient && <span>Client</span>}<span className="is-n">Amount</span><span />
      </li>
      {rows.map((i) => {
        const s = shownStatus(i, today)
        const d = daysBetween(today, i.due)
        const due = s === 'paid' ? `Paid ${fmtShort(i.paidOn ?? i.due)}` : s === 'cancelled' ? '' : d < 0 ? `${plural(-d, 'day', 'days')} late` : d === 0 ? 'Today' : `In ${plural(d, 'day', 'days')}`
        return (
          <li key={i.id} className={`iv-row is-${s}`} onClick={() => onOpen(i.id)}>
            <button type="button" className="iv-num" onClick={(e) => { e.stopPropagation(); onOpen(i.id) }}>{i.number}</button>
            <span><span className={`iv-st is-${s}`}>{STATUS_LABEL[s]}</span></span>
            <span className="iv-row-date">{fmtShort(i.issued)}</span>
            <span className={`iv-row-due is-${s}`}>{due}</span>
            {!hideClient && <span className="iv-row-client">{i.client.name}</span>}
            <span className="iv-row-amt">{money(invoiceTotal(i), i.currency)}</span>
            <span className="iv-row-menu" onClick={(e) => e.stopPropagation()}>
              <Dropdown label={`Options for ${i.number}`}>
                {s !== 'paid' && s !== 'cancelled' && <button role="menuitem" onClick={() => patchInvoice(i.id, { status: 'paid', paidOn: today })}>Record payment today</button>}
                {i.status === 'open' && <button role="menuitem" onClick={() => patchInvoice(i.id, { status: 'sent', sentOn: today })}>Mark as sent</button>}
                {s === 'paid' && <button role="menuitem" onClick={() => patchInvoice(i.id, { status: i.sentOn ? 'sent' : 'open', paidOn: undefined })}>Mark as unpaid</button>}
                <button role="menuitem" onClick={() => onOpen(i.id)}>Open</button>
              </Dropdown>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** "31. 10. 26", Fakturoid's short date in lists. */
const fmtShort = (iso: string) => { const [y, m, d] = iso.split('-'); return `${Number(d)}. ${Number(m)}. ${y.slice(2)}` }

/** Bars per period: what was invoiced, how much of it is paid. CZK only. */
type Period = 'months' | 'quarters' | 'years'
function periodBuckets(invoices: Invoice[], year: string, period: Period): { key: string; name: string; paid: number; unpaid: number; count: number }[] {
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

function BarChart({ data, height = 260 }: { data: ReturnType<typeof periodBuckets>; height?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const top = Math.max(1, ...data.map((m) => m.paid + m.unpaid))
  const step = niceStep(top)
  const ceil = Math.ceil(top / step) * step
  const ticks = Array.from({ length: Math.round(ceil / step) + 1 }, (_, k) => ceil - k * step)
  return (
    <div className="iv-chart" style={{ height }}>
      <div className="iv-axis" aria-hidden="true">{ticks.map((v) => <span key={v}>{money(v, 'CZK')}</span>)}</div>
      <div className="iv-plot" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }} onMouseLeave={() => setHover(null)}>
        <div className="iv-gridlines" aria-hidden="true">{ticks.map((_, k) => <i key={k} style={{ top: `${(k / (ticks.length - 1)) * 100}%` }} />)}</div>
        {data.map((m, k) => (
          <div key={m.key} className={`iv-col${hover === k ? ' is-on' : ''}`} onMouseEnter={() => setHover(k)}>
            <div className="iv-stack" style={{ height: `${((m.paid + m.unpaid) / ceil) * 100}%` }}>
              {m.unpaid > 0 && <span className="iv-bar-unpaid" style={{ flexGrow: m.unpaid }} />}
              {m.paid > 0 && <span className="iv-bar-paid" style={{ flexGrow: m.paid }} />}
            </div>
            <span className="iv-col-k">{data.length > 6 ? m.name.slice(0, 3) : m.name}</span>
            {hover === k && m.count > 0 && (
              <div className={`iv-tip${k > data.length * 0.6 ? ' is-left' : ''}`} role="status">
                <b>{m.name}</b>
                <div><span><i className="is-inv" />Invoiced</span><b>{money(m.paid + m.unpaid, 'CZK')}</b></div>
                <div><span><i className="is-paid" />Paid</span><span>{money(m.paid, 'CZK')}</span></div>
                <div><span><i className="is-unpaid" />Not paid yet</span><span>{money(m.unpaid, 'CZK')}</span></div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function niceStep(max: number): number {
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? mag * 10
}

/* ---------- overview: Fakturoid's Přehled ---------- */

const QUIET_DAYS = 45

function Overview({ onOpen, onList, onContact }: { onOpen: (id: string) => void; onList: (f: Filter) => void; onContact: (id: string) => void }) {
  const { invoices, invoiceClients } = useStore()
  const today = isoDay()
  const [period, setPeriod] = useState<Period>('months')
  const year = today.slice(0, 4)
  const unpaid = invoices.filter((i) => inFilter(i, 'unpaid', today))
  const late = invoices.filter((i) => inFilter(i, 'overdue', today))
  const newest = [...invoices].sort((a, b) => b.issued.localeCompare(a.issued) || b.number.localeCompare(a.number)).slice(0, 6)
  /* Fakturoid's "Dlouho nefakturovaní": clients he has billed before and not lately. */
  const quiet = invoiceClients.map((c) => {
    const last = invoices.filter((i) => i.clientId === c.id && i.status !== 'cancelled').map((i) => i.issued).sort().at(-1)
    return { c, last, days: last ? daysBetween(last, today) : -1 }
  }).filter((x) => x.days >= QUIET_DAYS).sort((a, b) => b.days - a.days).slice(0, 5)

  if (!invoices.length) return <div className="iv-card iv-empty"><p>Nothing invoiced yet. Once you issue invoices, this shows what came in each month, what is unpaid and what is late.</p></div>

  return (
    <div className="iv-card">
      <section className="iv-sec">
        <div className="iv-sec-tools">
          <Segmented size="sm" label="Period" value={period} onPick={setPeriod} className="iv-seg-soft"
            options={[{ id: 'months', label: 'Months' }, { id: 'quarters', label: 'Quarters' }, { id: 'years', label: 'Years' }]} />
        </div>
        <BarChart data={periodBuckets(invoices, year, period)} />
      </section>

      <section className="iv-sec iv-split">
        <div>
          <h2 className="iv-h2 is-center">Invoices</h2>
          <dl className="iv-sumlines">
            <dt><button type="button" className="iv-a" onClick={() => onList('unpaid')}>Unpaid</button></dt><dd className="is-wait">{sumText(unpaid)}</dd>
            <dt><button type="button" className="iv-a" onClick={() => onList('overdue')}>Overdue</button></dt><dd className={late.length ? 'is-red' : ''}>{sumText(late)}</dd>
          </dl>
        </div>
        <div>
          <h2 className="iv-h2 is-center">Not invoiced lately</h2>
          {quiet.length ? (
            <dl className="iv-sumlines">
              {quiet.map((x) => (
                <Fragment key={x.c.id}><dt><button type="button" className="iv-a" onClick={() => onContact(x.c.id)}>{x.c.name}</button></dt><dd className="iv-quiet">{x.days} days ago</dd></Fragment>
              ))}
            </dl>
          ) : <p className="iv-quiet is-center">Everyone you bill was invoiced in the last {QUIET_DAYS} days.</p>}
        </div>
      </section>

      <section className="iv-sec is-flush">
        <h2 className="iv-h2 is-center">Newest invoices</h2>
        <InvoiceRows rows={newest} onOpen={onOpen} />
        <div className="is-center iv-pad"><button type="button" className="iv-a is-quiet" onClick={() => onList('all')}>All invoices</button></div>
      </section>
    </div>
  )
}

/* ---------- statistics: Fakturoid's Statistiky, with the VAT limit ---------- */

const VAT_LIMIT = 2_000_000
const VAT_HARD = 2_536_000

function Statistics() {
  const { invoices, invoiceSupplier } = useStore()
  const today = isoDay()
  const years = [...new Set([today.slice(0, 4), ...invoices.map((i) => i.issued.slice(0, 4))])].sort()
  const [year, setYear] = useState(today.slice(0, 4))
  const [period, setPeriod] = useState<Period>('months')
  const data = periodBuckets(invoices, year, period === 'years' ? 'months' : period)
  const rows = period === 'years' ? periodBuckets(invoices, year, 'years') : data
  const total = (r: { paid: number; unpaid: number }) => r.paid + r.unpaid
  const yearSum = data.reduce((s, r) => s + total(r), 0)
  const prevYear = periodBuckets(invoices, String(Number(year) - 1), 'months').reduce((s, r) => s + total(r), 0)
  const yi = years.indexOf(year)
  const vatShare = Math.min(1, yearSum / VAT_LIMIT)
  return (
    <div className="iv-card">
      <section className="iv-sec">
        <div className="iv-sec-tools is-split">
          <div className="iv-yearstep">
            <button type="button" aria-label="Previous year" disabled={yi <= 0} onClick={() => setYear(years[yi - 1])}><Icon.ChevronLeft size={16} /></button>
            <b>{year}</b>
            <button type="button" aria-label="Next year" disabled={yi >= years.length - 1} onClick={() => setYear(years[yi + 1])}><Icon.ChevronRight size={16} /></button>
          </div>
          <Segmented size="sm" label="Period" value={period} onPick={setPeriod} className="iv-seg-soft"
            options={[{ id: 'months', label: 'Months' }, { id: 'quarters', label: 'Quarters' }, { id: 'years', label: 'Years' }]} />
        </div>
        <BarChart data={rows} />
      </section>
      <section className="iv-sec">
        <table className="iv-stat">
          <thead><tr><th /><th>Invoiced</th><th /><th>Paid</th><th>Not paid yet</th></tr></thead>
          <tbody>
            {rows.map((r, k) => {
              const prev = k > 0 ? total(rows[k - 1]) : 0
              const ch = prev ? ((total(r) - prev) / prev) * 100 : null
              return (
                <tr key={r.key}>
                  <th scope="row">{r.name}</th>
                  <td>{money(total(r), 'CZK')}</td>
                  <td className={`iv-ch${ch != null && ch < 0 ? ' is-down' : ''}`}>{ch == null ? '' : `${ch > 0 ? '+' : ''}${ch.toFixed(1).replace('.', ',')} %`}</td>
                  <td>{money(r.paid, 'CZK')}</td>
                  <td>{money(r.unpaid, 'CZK')}</td>
                </tr>
              )
            })}
          </tbody>
          {period !== 'years' && (
            <tfoot><tr><th scope="row">{year}</th><td>{money(yearSum, 'CZK')}</td>
              <td className={`iv-ch${prevYear && yearSum < prevYear ? ' is-down' : ''}`}>{prevYear ? `${yearSum >= prevYear ? '+' : ''}${(((yearSum - prevYear) / prevYear) * 100).toFixed(1).replace('.', ',')} %` : ''}</td>
              <td>{money(data.reduce((s, r) => s + r.paid, 0), 'CZK')}</td><td>{money(data.reduce((s, r) => s + r.unpaid, 0), 'CZK')}</td></tr></tfoot>
          )}
        </table>
      </section>
      {!invoiceSupplier?.vatPayer && (
        <section className="iv-sec">
          <h2 className="iv-h2">Turnover towards compulsory VAT registration</h2>
          <p className="iv-vatline">Turnover in {year} is <mark>{money(yearSum, 'CZK')}</mark>, {Math.round(vatShare * 100)} % of {money(VAT_LIMIT, 'CZK', 0)}.</p>
          <div className="iv-vatbar" aria-hidden="true"><i style={{ transform: `scaleX(${vatShare})` }} /></div>
          <p className="iv-quiet">Over {money(VAT_LIMIT, 'CZK', 0)} in a calendar year makes you a VAT payer from the start of the next year. Over {money(VAT_HARD, 'CZK', 0)}, from the day after you cross it. CZK invoices only, by issue date.</p>
        </section>
      )}
    </div>
  )
}

/* ---------- one invoice: Fakturoid's page, the app's own view of it ---------- */

function InvoiceDetail({ id, onBack, onEdit, onCopy, onContact }: {
  id: string; onBack: () => void; onEdit: (id: string) => void; onCopy: (id: string) => void; onContact: (id: string) => void
}) {
  const { invoices, invoiceClients, patchInvoice, deleteInvoice } = useStore()
  const inv = invoices.find((i) => i.id === id)
  const today = isoDay()
  const [paying, setPaying] = useState(false)
  const [pdf, setPdf] = useState(false)
  if (!inv) return <div className="iv-card iv-empty"><p>This invoice was deleted.</p><button className="iv-outline" type="button" onClick={onBack}>Back to invoices</button></div>
  const s = shownStatus(inv, today)
  const d = daysBetween(today, inv.due)
  const t = totals(inv.lines, inv.supplier.vatPayer)
  const contact = inv.clientId ? invoiceClients.find((c) => c.id === inv.clientId) : undefined
  const pill = s === 'paid' ? `Paid ${fmtDate(inv.paidOn)}` : s === 'cancelled' ? 'Cancelled' : s === 'overdue' ? `Overdue ${plural(-d, 'day', 'days')}` : s === 'sent' ? `Sent ${fmtDate(inv.sentOn)}` : `Issued ${fmtDate(inv.issued)}`
  const due = s === 'paid' || s === 'cancelled' ? '' : s === 'overdue' ? `Was due ${fmtDate(inv.due)}` : d === 0 ? 'Due today' : `Due in ${plural(d, 'day', 'days')}`

  return (
    <div className="iv-card">
      <header className="iv-dhead">
        <div>
          <h2 className="iv-dtitle">Invoice {inv.number}</h2>
          <div className="iv-dstate"><span className={`iv-pill is-${s}`}>{pill}</span>{due && <span>{due}</span>}</div>
        </div>
        <div className="iv-dactions" role="toolbar" aria-label="Invoice actions">
          <IconAction icon={<Icon.DockInvoice size={24} />} label="PDF" onClick={() => setPdf(true)} />
          {s !== 'paid' && s !== 'cancelled' && <IconAction icon={<Icon.CheckRing size={24} />} label="Record payment" onClick={() => setPaying(true)} />}
          <IconAction icon={<Icon.Edit size={24} />} label="Edit" onClick={() => onEdit(inv.id)} />
          <IconAction icon={<Icon.Copy size={24} />} label="Duplicate" onClick={() => onCopy(inv.id)} />
          <Dropdown label="More actions" className="iv-more" trigger={({ onClick, open }) => (
            <button type="button" className="iv-iact" aria-expanded={open} onClick={onClick}><Icon.More size={24} /><span>More</span></button>
          )}>
            {inv.status === 'open' && <button role="menuitem" onClick={() => patchInvoice(inv.id, { status: 'sent', sentOn: today })}>Mark as sent</button>}
            {inv.status === 'paid' && <button role="menuitem" onClick={() => patchInvoice(inv.id, { status: inv.sentOn ? 'sent' : 'open', paidOn: undefined })}>Mark as unpaid</button>}
            {inv.status === 'cancelled'
              ? <button role="menuitem" onClick={() => patchInvoice(inv.id, { status: inv.paidOn ? 'paid' : inv.sentOn ? 'sent' : 'open' })}>Restore</button>
              : <button role="menuitem" onClick={() => patchInvoice(inv.id, { status: 'cancelled' })}>Cancel invoice</button>}
            <button role="menuitem" className="danger" onClick={() => { deleteInvoice(inv.id); onBack() }}>Delete</button>
          </Dropdown>
        </div>
      </header>

      <div className="iv-dbody">
        <div className="iv-dfacts">
          <div className="iv-dclient">
            {contact ? <button type="button" className="iv-a is-big" onClick={() => onContact(contact.id)}>{inv.client.name}</button> : <b>{inv.client.name}</b>}
            {inv.client.street && <span>{inv.client.street}</span>}
            {(inv.client.zip || inv.client.city) && <span>{[inv.client.zip, inv.client.city].filter(Boolean).join(' ')}</span>}
            {(inv.client.ico || inv.client.dic) && (
              <dl className="iv-ids">{inv.client.ico && <><dt>IČO</dt><dd>{inv.client.ico}</dd></>}{inv.client.dic && <><dt>DIČ</dt><dd>{inv.client.dic}</dd></>}</dl>
            )}
          </div>
          <dl className="iv-kv">
            <dt>Issued</dt><dd>{fmtDate(inv.issued)}</dd>
            <dt>Due</dt><dd>{fmtDate(inv.due)}</dd>
            {inv.supplier.vatPayer && <><dt>Taxable supply</dt><dd>{fmtDate(inv.taxable)}</dd></>}
          </dl>
          <dl className="iv-kv">
            <dt>Variable symbol</dt><dd>{inv.vs}</dd>
            <dt>Payment</dt><dd>{METHODS.find((m) => m.id === inv.method)?.label}</dd>
            {inv.method === 'bank' && (inv.supplier.account || inv.supplier.iban) && <><dt>Account</dt><dd>{inv.supplier.account || ibanSpaced(inv.supplier.iban ?? '')}</dd></>}
            {inv.orderNo && <><dt>Order</dt><dd>{inv.orderNo}</dd></>}
          </dl>
        </div>

        {inv.noteBefore && <div className="iv-note"><span>Text above the items</span><p>{inv.noteBefore}</p></div>}
        <table className="iv-items-view">
          <thead><tr><th colSpan={3} /><th>Unit price</th>{inv.supplier.vatPayer && <th>VAT</th>}<th>Total</th></tr></thead>
          <tbody>
            {inv.lines.map((l) => {
              const base = (Number(l.qty) || 0) * (Number(l.price) || 0)
              return (
                <tr key={l.id}>
                  <td className="is-qty">{String(l.qty).replace('.', ',')}</td><td className="is-unit">{l.unit}</td><td>{l.name}</td>
                  <td className="is-soft">{money(l.price, inv.currency)}</td>
                  {inv.supplier.vatPayer && <td className="is-soft">{l.vat} %</td>}
                  <td className="is-sum">{money(inv.supplier.vatPayer ? base * (1 + l.vat / 100) : base, inv.currency)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="iv-total"><b>{money(t.total, inv.currency)}</b></div>
        {inv.noteAfter && <div className="iv-note"><span>Text below the items</span><p>{inv.noteAfter}</p></div>}
      </div>

      <footer className="iv-dfoot">
        <div><Icon.DockInvoice size={20} /><b>Print outputs</b><button type="button" className="iv-a" onClick={() => setPdf(true)}>Invoice PDF</button></div>
        <div className="iv-quiet">Created {new Date(inv.createdAt).toLocaleDateString('cs-CZ')}{inv.sentOn ? `, sent ${fmtDate(inv.sentOn)}` : ''}{inv.paidOn ? `, paid ${fmtDate(inv.paidOn)}` : ''}</div>
      </footer>

      {paying && <PaymentSheet inv={inv} onClose={() => setPaying(false)} onPaid={(day) => { patchInvoice(inv.id, { status: 'paid', paidOn: day }); setPaying(false) }} />}
      {pdf && <PdfSheet inv={inv} onClose={() => setPdf(false)} />}
    </div>
  )
}

function IconAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return <button type="button" className="iv-iact" onClick={onClick}>{icon}<span>{label}</span></button>
}

/** The A4 sheet the customer gets, behind the PDF action as in Fakturoid. Printing uses a copy of the
 *  sheet in its own root straight under <body> (everything else is hidden by the print stylesheet), so
 *  the page is A4 with real margins and a white background, whatever the app looks like around it. */
export function PdfSheet({ inv, onClose }: { inv: Invoice; onClose: () => void }) {
  const name = `${inv.lang === 'en' ? 'Invoice' : 'Faktura'} ${inv.number}`
  const print = () => {
    /* The browser names the saved PDF after the page title. */
    const was = document.title
    document.title = name
    const done = () => { document.title = was; window.removeEventListener('afterprint', done) }
    window.addEventListener('afterprint', done)
    window.print()
  }
  return (
    <>
      <Sheet title={name} onClose={onClose} wide>
        <div className="iv-pdf">
          <div className="iv-pdf-bar"><button className="iv-yellow" type="button" onClick={print}>Print or save as PDF</button></div>
          <FitPaper inv={inv} />
        </div>
      </Sheet>
      {createPortal(<div className="iv-print-root"><InvoicePaper inv={inv} /></div>, document.body)}
    </>
  )
}

function PaymentSheet({ inv, onClose, onPaid }: { inv: Invoice; onClose: () => void; onPaid: (day: string) => void }) {
  const [day, setDay] = useState(isoDay())
  return (
    <Sheet title={`Record payment for ${inv.number}`} onClose={onClose}>
      <div className="iv-paysheet">
        <div className="iv-pay-amt">{money(invoiceTotal(inv), inv.currency)}<span>from {inv.client.name}</span></div>
        <label className="iv-flabel">Paid on<input className="iv-input" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
        <div className="iv-sheet-foot">
          <button className="iv-outline" type="button" onClick={onClose}>Cancel</button>
          <button className="iv-yellow" type="button" disabled={!day} onClick={() => onPaid(day)}>Record payment</button>
        </div>
      </div>
    </Sheet>
  )
}

/* ---------- the form: Fakturoid's, labels on the left, one Create at the end ---------- */

function InvoiceForm({ id, copyOf, clientId, onDone }: { id?: string; copyOf?: string; clientId?: string; onDone: (id?: string) => void }) {
  const { invoices, invoiceClients, invoiceSupplier, saveInvoice } = useStore()
  const profile: Omit<InvoiceProfile, 'id' | 'updatedAt'> = invoiceSupplier ?? DEFAULT_PROFILE
  const existing = id ? invoices.find((i) => i.id === id) : undefined
  const source = existing ?? (copyOf ? invoices.find((i) => i.id === copyOf) : undefined)
  const today = isoDay()

  const [d, setD] = useState<InvoiceDraft>(() => {
    if (existing) return { ...existing }
    const c = invoiceClients.find((x) => x.id === (clientId ?? source?.clientId))
    const days = c?.dueDays ?? profile.dueDays ?? 14
    const number = nextNumber(invoices, profile.numberFormat, today)
    return {
      number, vs: vsFromNumber(number), issued: today, taxable: today, due: addDays(today, days),
      clientId: c?.id ?? source?.clientId, client: c ? partyOf(c) : source?.client ?? { name: '' },
      supplier: supplierOf(profile, pickAccount(accountsOf(profile), source?.currency ?? 'CZK')),
      accountId: source?.accountId ?? pickAccount(accountsOf(profile), source?.currency ?? 'CZK')?.id,
      method: source?.method ?? 'bank', currency: source?.currency ?? 'CZK', lang: source?.lang ?? 'cs',
      lines: source ? source.lines.map((l) => ({ ...l, id: lineId() })) : [{ id: lineId(), name: '', qty: 1, unit: '', price: 0, vat: 21 }],
      noteBefore: source?.noteBefore ?? '', noteAfter: source?.noteAfter ?? '', footer: profile.footer ?? '', orderNo: '',
      status: 'open',
    }
  })
  const [editNumber, setEditNumber] = useState(false)
  const [newContact, setNewContact] = useState(false)
  const [preview, setPreview] = useState(false)
  const [tried, setTried] = useState(false)
  const set = <K extends keyof InvoiceDraft>(k: K, v: InvoiceDraft[K]) => setD((p) => ({ ...p, [k]: v }))
  const setLine = (lid: string, patch: Partial<InvoiceLine>) => setD((p) => ({ ...p, lines: p.lines.map((l) => (l.id === lid ? { ...l, ...patch } : l)) }))
  const dueDays = daysBetween(d.issued, d.due)
  const vatPayer = existing ? d.supplier.vatPayer : profile.vatPayer
  const tot = totals(d.lines, vatPayer)
  const accounts = accountsOf(profile)
  const account = accounts.find((a) => a.id === d.accountId)
  /* A currency change brings the account for that currency along, as long as he hasn't picked one by hand. */
  const [pickedByHand, setPickedByHand] = useState(!!existing)
  const setCurrency = (cur: InvoiceCurrency) => setD((p) => ({ ...p, currency: cur, accountId: pickedByHand ? p.accountId : pickAccount(accounts, cur)?.id ?? p.accountId }))
  const clash = invoices.some((i) => i.number === d.number.trim() && i.id !== id)
  const err = {
    client: !d.client.name.trim() ? 'Pick who the invoice is for.' : '',
    number: !d.number.trim() ? 'The invoice needs a number.' : clash ? `${d.number} is already used.` : '',
    lines: !d.lines.some((l) => l.name.trim()) ? 'Describe at least one item.' : '',
    due: d.due < d.issued ? 'The due date is before the issue date.' : '',
  }
  const bad = Object.values(err).some(Boolean)

  const pickClient = (cid: string) => {
    const c = invoiceClients.find((x) => x.id === cid)
    if (c) setD((p) => ({ ...p, clientId: c.id, client: partyOf(c), due: c.dueDays != null ? addDays(p.issued, c.dueDays) : p.due }))
  }
  const draftFinal = (): InvoiceDraft => ({
    ...d, number: d.number.trim(),
    lines: d.lines.filter((l) => l.name.trim()).map((l) => ({ ...l, name: l.name.trim(), qty: Number(l.qty) || 0, price: Number(l.price) || 0, vat: Number(l.vat) || 0 })),
    /* Re-saving takes his current details, except on an invoice already sent
       or paid: that one stays exactly as the customer received it. */
    supplier: existing && existing.status !== 'open' && existing.accountId === d.accountId ? existing.supplier : supplierOf(profile, account),
    ...(existing ? { id: existing.id } : {}),
  })
  const save = () => { setTried(true); if (!bad) onDone(saveInvoice(draftFinal())) }
  const dueOptions = [...new Set([...DUE_PRESETS, dueDays])].filter((n) => n >= 0).sort((a, b) => a - b)

  return (
    <div className="iv-form">
      <div className="iv-card iv-form-panel">
        <header className="iv-form-head">
          <h2>{existing ? `Edit invoice ${existing.number}` : copyOf ? 'New invoice from a copy' : 'New invoice'}</h2>
          <button className="iv-outline is-sm" type="button" onClick={() => onDone(existing?.id)}><Icon.ChevronLeft size={14} />Back</button>
        </header>
        <div className="iv-fgrid">
          <div className="iv-fcol">
            <FRow label="Customer" error={tried ? err.client : ''}>
              <Select className="iv-select" ariaLabel="Customer" value={d.clientId ?? ''} onChange={pickClient}
                options={[{ value: '', label: invoiceClients.length ? 'Choose a customer' : 'No contacts yet' },
                  ...[...invoiceClients].sort((a, b) => a.name.localeCompare(b.name, 'cs')).map((c) => ({ value: c.id, label: c.name }))]} />
              <div className="iv-inline is-tight">
                {d.client.name && <span className="iv-hint">{[d.client.street, [d.client.zip, d.client.city].filter(Boolean).join(' '), d.client.ico && `IČO ${d.client.ico}`].filter(Boolean).join(', ')}</span>}
                <button type="button" className="iv-a iv-plus" onClick={() => setNewContact(true)}><Icon.Plus size={16} />New customer</button>
              </div>
            </FRow>
            <FRow label="Invoice number" error={tried ? err.number : ''}>
              {editNumber
                ? <input className="iv-input iv-w-md" autoFocus value={d.number} onChange={(e) => { const v = e.target.value; setD((p) => ({ ...p, number: v, vs: p.vs === vsFromNumber(p.number) ? vsFromNumber(v) : p.vs })) }} />
                : <div className="iv-inline"><b className="iv-static">{d.number}</b><button type="button" className="iv-a is-quiet" onClick={() => setEditNumber(true)}>Change</button></div>}
            </FRow>
            <FRow label="Issue date">
              <input className="iv-input iv-w-date" type="date" value={d.issued}
                onChange={(e) => { const v = e.target.value; if (v) setD((p) => ({ ...p, issued: v, taxable: p.taxable === p.issued ? v : p.taxable, due: addDays(v, daysBetween(p.issued, p.due)) })) }} />
            </FRow>
            {vatPayer && (
              <FRow label="Taxable supply">
                <input className="iv-input iv-w-date" type="date" value={d.taxable} onChange={(e) => e.target.value && set('taxable', e.target.value)} />
              </FRow>
            )}
            <FRow label="Due" error={tried ? err.due : ''}>
              <div className="iv-inline">
                <Select className="iv-select iv-w-md" ariaLabel="Due in" value={dueDays} onChange={(n) => set('due', addDays(d.issued, n))}
                  options={dueOptions.map((n) => ({ value: n, label: n === 0 ? 'On issue' : plural(n, 'day', 'days') }))} />
                <span className="iv-hint">lands on <b>{fmtDate(d.due)}</b></span>
              </div>
            </FRow>
          </div>

          <div className="iv-fcol">
            <FRow label="Payment method">
              <Segmented size="sm" label="Payment method" value={d.method} onPick={(v) => set('method', v)} options={METHODS} className="iv-paymethod" />
            </FRow>
            <FRow label="Currency">
              <Select className="iv-select iv-w-sm" ariaLabel="Currency" value={d.currency} onChange={setCurrency} options={CURRENCIES} />
            </FRow>
            {d.method === 'bank' && (
              <FRow label="Bank account">
                {accounts.length
                  ? <Select className="iv-select" ariaLabel="Bank account" value={d.accountId ?? ''} onChange={(v) => { setPickedByHand(true); set('accountId', v) }}
                      options={accounts.map((a) => ({ value: a.id, label: `${a.label}${a.account ? `, ${a.account}` : a.iban ? `, ${ibanSpaced(a.iban)}` : ''}` }))} />
                  : <span className="iv-hint">No bank account yet. Add one under Settings.</span>}
              </FRow>
            )}
            <FRow label="Language"><Select className="iv-select iv-w-md" ariaLabel="Language" value={d.lang} onChange={(v) => set('lang', v)} options={LANGS} /></FRow>
            <FRow label="Variable symbol"><input className="iv-input iv-w-md" inputMode="numeric" value={d.vs} onChange={(e) => set('vs', e.target.value.replace(/\D/g, '').slice(0, 10))} /></FRow>
            <FRow label="Order number"><input className="iv-input iv-w-md" value={d.orderNo ?? ''} onChange={(e) => set('orderNo', e.target.value)} /></FRow>
          </div>

          <div className="iv-fnotes">
            <label className="iv-flabel">Text above items<textarea className="iv-input" rows={2} value={d.noteBefore ?? ''} onChange={(e) => set('noteBefore', e.target.value)} /></label>
            <label className="iv-flabel">Text below items<textarea className="iv-input" rows={2} value={d.noteAfter ?? ''} onChange={(e) => set('noteAfter', e.target.value)} /></label>
            <label className="iv-flabel">Footer<textarea className="iv-input" rows={2} value={d.footer ?? ''} onChange={(e) => set('footer', e.target.value)} /></label>
          </div>
        </div>

        <div className={`iv-items${vatPayer ? ' has-vat' : ''}`}>
          <div className="iv-item is-head" aria-hidden="true">
            <span>Qty</span><span>Unit</span><span>Description</span><span className="is-n">Unit price</span>{vatPayer && <span>VAT %</span>}<span className="is-n">Total</span><span />
          </div>
          {d.lines.map((l) => {
            const base = (Number(l.qty) || 0) * (Number(l.price) || 0)
            return (
              <div className="iv-item" key={l.id}>
                <input className="iv-input" aria-label="Quantity" type="number" step="any" value={l.qty} onChange={(e) => setLine(l.id, { qty: e.target.value === '' ? ('' as unknown as number) : Number(e.target.value) })} />
                <input className="iv-input" aria-label="Unit" placeholder="h, ks" value={l.unit} onChange={(e) => setLine(l.id, { unit: e.target.value })} />
                <input className="iv-input" aria-label="Description" placeholder="What you did" value={l.name} onChange={(e) => setLine(l.id, { name: e.target.value })} />
                <input className="iv-input is-n" aria-label="Unit price" type="number" step="any" value={l.price} onChange={(e) => setLine(l.id, { price: e.target.value === '' ? ('' as unknown as number) : Number(e.target.value) })} />
                {vatPayer && <Select className="iv-select" ariaLabel="VAT rate" value={Number(l.vat) || 0} onChange={(v) => setLine(l.id, { vat: v })} options={[21, 12, 0].map((r) => ({ value: r, label: `${r} %` }))} />}
                <span className="iv-item-sum">{money(vatPayer ? base * (1 + (Number(l.vat) || 0) / 100) : base, d.currency)}</span>
                <button className="iv-x" type="button" aria-label="Remove item" disabled={d.lines.length === 1}
                  onClick={() => setD((p) => ({ ...p, lines: p.lines.filter((x) => x.id !== l.id) }))}><Icon.Close size={15} /></button>
              </div>
            )
          })}
          {tried && err.lines && <p className="iv-err">{err.lines}</p>}
          <button className="iv-outline iv-additem" type="button"
            onClick={() => setD((p) => ({ ...p, lines: [...p.lines, { id: lineId(), name: '', qty: 1, unit: p.lines.at(-1)?.unit ?? '', price: 0, vat: p.lines.at(-1)?.vat ?? 21 }] }))}>
            <Icon.Plus size={15} />Add item
          </button>
        </div>

        <div className="iv-sumband">
          {vatPayer && (
            <table className="iv-vat">
              <thead><tr><th>Rate</th><th>Base</th><th>VAT</th></tr></thead>
              <tbody>{tot.byRate.map((r) => <tr key={r.rate}><td>{r.rate} %</td><td>{money(r.base, d.currency)}</td><td>{money(r.vat, d.currency)}</td></tr>)}</tbody>
            </table>
          )}
          <div className="iv-grand"><span>Total</span><b>{money(tot.total, d.currency)}</b></div>
        </div>

        <div className="iv-form-foot">
          <button type="button" className="iv-a is-quiet" onClick={() => onDone(existing?.id)}>Discard</button>
          <button type="button" className="iv-a is-quiet" onClick={() => setPreview(true)}>Preview</button>
          <button type="button" className="iv-yellow iv-create" onClick={save}>{existing ? 'Save invoice' : 'Create invoice'}</button>
        </div>
      </div>

      {newContact && (
        <ContactSheet onClose={() => setNewContact(false)}
          onSaved={(cid, c) => { setNewContact(false); setD((p) => ({ ...p, clientId: cid, client: partyOf(c), due: c.dueDays != null ? addDays(p.issued, c.dueDays) : p.due })) }} />
      )}
      {preview && (
        <Sheet title="Preview" onClose={() => setPreview(false)} wide>
          <FitPaper inv={{ ...draftFinal(), id: 'preview', createdAt: 0, updatedAt: 0 } as Invoice} />
        </Sheet>
      )}
    </div>
  )
}

function FRow({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <div className={`iv-frow${error ? ' has-err' : ''}`}>
      <span className="iv-flab">{label}</span>
      <div className="iv-fctl">{children}{error && <p className="iv-err">{error}</p>}</div>
    </div>
  )
}

/* ---------- contacts: Fakturoid's A to Z list and contact page ---------- */

function ContactList({ onOpen, onAdd }: { onOpen: (id: string) => void; onAdd: () => void }) {
  const { invoiceClients, invoices } = useStore()
  const today = isoDay()
  const [q, setQ] = useState('')
  const [mode, setMode] = useState<'all' | 'quiet'>('all')
  const lastOf = (cid: string) => invoices.filter((i) => i.clientId === cid && i.status !== 'cancelled').map((i) => i.issued).sort().at(-1)
  const rows = invoiceClients
    .filter((c) => !q.trim() || fold([c.name, c.ico, c.dic, c.city, c.email].join(' ')).includes(fold(q.trim())))
    .filter((c) => { if (mode === 'all') return true; const l = lastOf(c.id); return !!l && daysBetween(l, today) >= QUIET_DAYS })
    .sort((a, b) => a.name.localeCompare(b.name, 'cs'))
  const groups = rows.reduce((m, c) => { const k = c.name.trim()[0]?.toUpperCase() ?? '#'; (m[k] ??= []).push(c); return m }, {} as Record<string, typeof rows>)
  if (!invoiceClients.length) {
    return (
      <div className="iv-card iv-empty">
        <p>Everyone you invoice. Type an IČO and the name and address come from ARES.</p>
        <button className="iv-yellow" type="button" onClick={onAdd}>Add the first contact</button>
      </div>
    )
  }
  return (
    <div className="iv-card">
      <div className="iv-cbar">
        <label className="iv-search is-big">
          <Icon.Search size={20} />
          <input type="search" value={q} placeholder="Name, IČO or email" aria-label="Search contacts" onChange={(e) => setQ(e.target.value)} />
        </label>
        <Segmented size="sm" label="Show" value={mode} onPick={setMode} className="iv-seg-soft"
          options={[{ id: 'all', label: 'All contacts' }, { id: 'quiet', label: 'Not invoiced lately' }]} />
      </div>
      {rows.length === 0 && <p className="iv-quiet iv-pad">{mode === 'quiet' ? `Everyone was invoiced in the last ${QUIET_DAYS} days.` : 'Nobody matches that search.'}</p>}
      {Object.entries(groups).map(([letter, list]) => (
        <section key={letter} className="iv-cgroup">
          <h3>{letter}</h3>
          <ul>
            {list.map((c) => {
              const l = lastOf(c.id)
              const unpaid = invoices.filter((i) => i.clientId === c.id && inFilter(i, 'unpaid', today))
              return (
                <li key={c.id} onClick={() => onOpen(c.id)}>
                  <button type="button" className="iv-a is-plain" onClick={(e) => { e.stopPropagation(); onOpen(c.id) }}>{c.name}</button>
                  <span className="iv-cids">{c.ico && <span>IČO: <b>{c.ico}</b></span>}{c.dic && <span>DIČ: <b>{c.dic}</b></span>}</span>
                  <span className="iv-quiet">{c.email}</span>
                  <span className={unpaid.length ? 'iv-cunpaid' : 'iv-quiet'}>{unpaid.length ? `${sumText(unpaid)} unpaid` : l ? `Last invoice ${fmtDate(l)}` : 'Not invoiced yet'}</span>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

function ContactDetail({ id, onBack, onEdit, onOpen, onNew }: { id: string; onBack: () => void; onEdit: () => void; onOpen: (id: string) => void; onNew: (cid: string) => void }) {
  const { invoiceClients, invoices, deleteInvoiceClient } = useStore()
  const today = isoDay()
  const c = invoiceClients.find((x) => x.id === id)
  const theirs = invoices.filter((i) => i.clientId === id)
  const years = [...new Set([today.slice(0, 4), ...theirs.map((i) => i.issued.slice(0, 4))])].sort()
  const [year, setYear] = useState(today.slice(0, 4))
  const [more, setMore] = useState(false)
  if (!c) return <div className="iv-card iv-empty"><p>This contact was deleted.</p><button className="iv-outline" type="button" onClick={onBack}>Back to contacts</button></div>
  const inYear = theirs.filter((i) => i.issued.startsWith(year) && i.status !== 'cancelled')
  const unpaid = theirs.filter((i) => inFilter(i, 'unpaid', today)).sort((a, b) => a.due.localeCompare(b.due))
  const yi = years.indexOf(year)
  /* Fakturoid's Události: what happened to this client's invoices, newest first. */
  const events = theirs.flatMap((i) => [
    { day: i.issued, text: 'Issued', i },
    ...(i.sentOn ? [{ day: i.sentOn, text: 'Sent', i }] : []),
    ...(i.paidOn ? [{ day: i.paidOn, text: 'Paid', i }] : []),
    ...(i.status !== 'paid' && i.status !== 'cancelled' && i.due < today ? [{ day: addDays(i.due, 1), text: 'Overdue', i }] : []),
  ]).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 8)
  return (
    <div className="iv-card">
      <header className="iv-dhead is-white">
        <div>
          <h2 className="iv-dtitle">{c.name}</h2>
          <div className="iv-dstate"><span className="iv-caps">Customer</span>{c.ico && <span>IČO {c.ico}</span>}</div>
        </div>
        <div className="iv-dactions" role="toolbar" aria-label="Contact actions">
          <IconAction icon={<Icon.Plus size={24} />} label="Invoice" onClick={() => onNew(c.id)} />
          <IconAction icon={<Icon.Edit size={24} />} label="Edit" onClick={onEdit} />
          <Dropdown label="More actions" className="iv-more" trigger={({ onClick, open }) => (
            <button type="button" className="iv-iact" aria-expanded={open} onClick={onClick}><Icon.More size={24} /><span>More</span></button>
          )}>
            <button role="menuitem" className="danger" onClick={() => { deleteInvoiceClient(c.id); onBack() }}>Delete contact</button>
          </Dropdown>
        </div>
      </header>
      <div className="is-center iv-moreline">
        <button type="button" className="iv-chipbtn" aria-expanded={more} onClick={() => setMore((v) => !v)}>Address and details <Icon.ChevronDown size={14} /></button>
      </div>
      {more && (
        <dl className="iv-kv iv-pad">
          {c.street && <><dt>Address</dt><dd>{[c.street, [c.zip, c.city].filter(Boolean).join(' '), c.country].filter(Boolean).join(', ')}</dd></>}
          {c.dic && <><dt>DIČ</dt><dd>{c.dic}</dd></>}
          {c.email && <><dt>Email</dt><dd>{c.email}</dd></>}
          {c.phone && <><dt>Phone</dt><dd>{c.phone}</dd></>}
          {c.dueDays != null && <><dt>Due in</dt><dd>{plural(c.dueDays, 'day', 'days')}</dd></>}
        </dl>
      )}

      <section className="iv-sec iv-cchart">
        <div>
          <BarChart data={periodBuckets(theirs, year, 'months')} height={200} />
          <div className="iv-yearstep is-center">
            <button type="button" aria-label="Previous year" disabled={yi <= 0} onClick={() => setYear(years[yi - 1])}><Icon.ChevronLeft size={16} /></button>
            <b>{year}</b>
            <button type="button" aria-label="Next year" disabled={yi >= years.length - 1} onClick={() => setYear(years[yi + 1])}><Icon.ChevronRight size={16} /></button>
          </div>
        </div>
        <div className="iv-cstat">
          <span className="iv-caps">{plural(inYear.length, 'invoice', 'invoices')} in {year}</span>
          <b>{sumText(inYear)}</b>
        </div>
      </section>

      <section className="iv-sec is-flush is-grey">
        <div className="iv-rowhead"><span className="iv-caps">Unpaid invoices</span><span>{unpaid.length ? sumText(unpaid) : ''}</span></div>
        {unpaid.length ? <InvoiceRows rows={unpaid} onOpen={onOpen} hideClient /> : <p className="iv-quiet iv-pad">Everything from {c.name} is paid.</p>}
      </section>

      {events.length > 0 && (
        <section className="iv-sec is-flush iv-events">
          <h2 className="iv-h2 iv-pad-x">Events</h2>
          <ul className="iv-evrows">
            <li className="iv-evrow is-head" aria-hidden="true"><span>Date</span><span>Event</span><span>Invoice</span><span className="is-n">Amount</span></li>
            {events.map((e, k) => (
              <li key={k} className="iv-evrow" onClick={() => onOpen(e.i.id)}>
                <span className="iv-row-date">{fmtDate(e.day)}</span>
                <span><span className={`iv-st is-ev-${e.text.toLowerCase()}`}>{e.text}</span></span>
                <button type="button" className="iv-num" onClick={(ev) => { ev.stopPropagation(); onOpen(e.i.id) }}>{e.i.number}</button>
                <span className="iv-row-amt">{money(invoiceTotal(e.i), e.i.currency)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

const EMPTY_CONTACT: InvoiceClientDraft = { name: '', ico: '', dic: '', street: '', city: '', zip: '', country: 'Česká republika', email: '', phone: '', web: '', note: '' }

function ContactSheet({ id, onClose, onSaved }: { id?: string; onClose: () => void; onSaved: (id: string, c: InvoiceClientDraft) => void }) {
  const { invoiceClients, saveInvoiceClient } = useStore()
  const existing = id ? invoiceClients.find((c) => c.id === id) : undefined
  const [c, setC] = useState<InvoiceClientDraft>(() => (existing ? { ...existing } : { ...EMPTY_CONTACT }))
  const save = () => { if (c.name.trim()) onSaved(saveInvoiceClient({ ...c, ...(existing ? { id: existing.id } : {}) }), c) }
  return (
    <Sheet title={existing ? `Edit ${existing.name}` : 'New contact'} onClose={onClose}>
      <div className="iv-csheet">
        <PartyFields value={c} onChange={(p) => setC((x) => ({ ...x, ...p }))} />
        <label className="iv-flabel">Due in days for this customer
          <input className="iv-input iv-w-sm" type="number" min={0} value={c.dueDays ?? ''} placeholder="Default"
            onChange={(e) => setC((x) => ({ ...x, dueDays: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) }))} />
        </label>
        <div className="iv-sheet-foot">
          <button className="iv-outline" type="button" onClick={onClose}>Cancel</button>
          <button className="iv-yellow" type="button" disabled={!c.name.trim()} onClick={save}>{existing ? 'Save contact' : 'Add contact'}</button>
        </div>
      </div>
    </Sheet>
  )
}

/** IČO with the ARES button first (it fills the rest), then name, tax id, address, contact lines. */
function PartyFields({ value, onChange }: { value: InvoiceParty; onChange: (p: Partial<InvoiceParty>) => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const lookup = async () => {
    setBusy(true); setErr('')
    try { onChange(await aresLookup(value.ico ?? '')) } catch (e) { setErr(e instanceof Error ? e.message : 'ARES lookup failed.') }
    setBusy(false)
  }
  const f = (k: keyof InvoiceParty) => ({ className: 'iv-input', value: value[k] ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange({ [k]: e.target.value }) })
  return (
    <div className="iv-party">
      <label className="iv-flabel">IČO
        <span className="iv-inline">
          <input {...f('ico')} className="iv-input iv-w-md" inputMode="numeric" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void lookup() } }} />
          <button className="iv-outline" type="button" disabled={busy || !(value.ico ?? '').replace(/\D/g, '')} onClick={() => void lookup()}>{busy ? 'Looking up' : 'Fill from ARES'}</button>
        </span>
        {err && <span className="iv-err">{err}</span>}
      </label>
      <label className="iv-flabel">Name<input {...f('name')} /></label>
      <div className="iv-two">
        <label className="iv-flabel">DIČ<input {...f('dic')} /></label>
        <label className="iv-flabel">Email<input {...f('email')} type="email" /></label>
      </div>
      <label className="iv-flabel">Street<input {...f('street')} /></label>
      <div className="iv-zipcity">
        <label className="iv-flabel">ZIP<input {...f('zip')} /></label>
        <label className="iv-flabel">City<input {...f('city')} /></label>
      </div>
      <div className="iv-two">
        <label className="iv-flabel">Country<input {...f('country')} /></label>
        <label className="iv-flabel">Phone<input {...f('phone')} type="tel" /></label>
      </div>
    </div>
  )
}

/* ---------- settings: his own details, laid out like the invoice form ---------- */

function SettingsForm() {
  const { invoiceSupplier, saveInvoiceProfile, invoices } = useStore()
  const [p, setP] = useState<Omit<InvoiceProfile, 'id' | 'updatedAt'>>(() => {
    const base = { ...DEFAULT_PROFILE, ...(invoiceSupplier ?? {}) }
    return { ...base, accounts: accountsOf(base) }
  })
  const [saved, setSaved] = useState(false)
  const set = (patch: Partial<InvoiceProfile>) => { setP((x) => ({ ...x, ...patch })); setSaved(false) }
  const accounts = p.accounts ?? []
  const setAcc = (id: string, patch: Partial<BankAccount>) => set({ accounts: accounts.map((a) => (a.id === id ? { ...a, ...patch } : patch.isDefault ? { ...a, isDefault: false } : a)) })
  const addAcc = () => set({ accounts: [...accounts, { id: `acc-${Date.now().toString(36)}`, label: accounts.length ? 'Another account' : 'Main account', currency: 'CZK', isDefault: !accounts.length }] })
  const dropAcc = (id: string) => { const rest = accounts.filter((a) => a.id !== id); if (rest.length && !rest.some((a) => a.isDefault)) rest[0] = { ...rest[0], isDefault: true }; set({ accounts: rest }) }
  return (
    <div className="iv-settings">
      <section className="iv-card iv-spanel">
        <h2 className="iv-h2">Your details</h2>
        <PartyFields value={p} onChange={set} />
        <label className="iv-flabel">Website<input className="iv-input" value={p.web ?? ''} onChange={(e) => set({ web: e.target.value })} /></label>
      </section>
      <section className="iv-card iv-spanel">
        <h2 className="iv-h2">Bank accounts</h2>
        {accounts.length === 0 && <p className="iv-hint">No account yet. Invoices paid by bank transfer need one for the account number and the QR code.</p>}
        {accounts.map((a) => {
          const auto = czIban(a.account ?? '')
          return (
            <div key={a.id} className="iv-acc">
              <div className="iv-acc-head">
                <input className="iv-input iv-acc-name" aria-label="Account name" value={a.label} onChange={(e) => setAcc(a.id, { label: e.target.value })} />
                <Select className="iv-select iv-w-sm" ariaLabel="Account currency" value={a.currency ?? 'CZK'} onChange={(v) => setAcc(a.id, { currency: v })} options={CURRENCIES} />
                <button type="button" className={`iv-acc-default${a.isDefault ? ' is-on' : ''}`} aria-pressed={!!a.isDefault} onClick={() => setAcc(a.id, { isDefault: true })}>{a.isDefault ? 'Default' : 'Make default'}</button>
                <button type="button" className="iv-x" aria-label={`Remove ${a.label}`} onClick={() => dropAcc(a.id)}><Icon.Close size={15} /></button>
              </div>
              <label className="iv-flabel">Account number<input className="iv-input" placeholder="123456789/0800" value={a.account ?? ''} onChange={(e) => setAcc(a.id, { account: e.target.value })} /></label>
              <div className="iv-two">
                <label className="iv-flabel">IBAN<input className="iv-input" placeholder={auto ? ibanSpaced(auto) : 'For foreign accounts'} value={a.iban ?? ''} onChange={(e) => setAcc(a.id, { iban: e.target.value })} /></label>
                <label className="iv-flabel">SWIFT<input className="iv-input" value={a.swift ?? ''} onChange={(e) => setAcc(a.id, { swift: e.target.value })} /></label>
              </div>
              {auto && !a.iban && <p className="iv-hint">IBAN from the account number: <b>{ibanSpaced(auto)}</b></p>}
            </div>
          )
        })}
        <button type="button" className="iv-outline iv-additem" onClick={addAcc}><Icon.Plus size={15} />Add bank account</button>
        <p className="iv-hint">An invoice takes the account in its currency by itself, else the default. You can change it on each invoice.</p>
      </section>
      <section className="iv-card iv-spanel">
        <h2 className="iv-h2">Invoice defaults</h2>
        <div className="iv-flabel">VAT
          <Segmented size="sm" label="VAT" value={p.vatPayer ? 'yes' : 'no'} onPick={(v) => set({ vatPayer: v === 'yes' })}
            options={[{ id: 'no', label: 'Not a VAT payer' }, { id: 'yes', label: 'VAT payer' }]} />
        </div>
        <div className="iv-two">
          <label className="iv-flabel">Number format<input className="iv-input" value={p.numberFormat} onChange={(e) => set({ numberFormat: e.target.value })} />
            <span className="iv-hint">Next: {nextNumber(invoices, p.numberFormat, isoDay())}. YYYY year, MM month, NNNN counter.</span>
          </label>
          <label className="iv-flabel">Due in days<input className="iv-input" type="number" min={0} value={p.dueDays} onChange={(e) => set({ dueDays: Math.max(0, Number(e.target.value) || 0) })} /></label>
        </div>
        <label className="iv-flabel">Register line<input className="iv-input" value={p.regNote ?? ''} onChange={(e) => set({ regNote: e.target.value })} /></label>
        <label className="iv-flabel">Default footer<input className="iv-input" value={p.footer ?? ''} onChange={(e) => set({ footer: e.target.value })} /></label>
      </section>
      <div className="iv-settings-foot">
        {saved && <span className="iv-saved" role="status">Saved. New invoices use these details.</span>}
        <button className="iv-yellow iv-create" type="button" onClick={() => { saveInvoiceProfile({ ...p, account: undefined, iban: undefined, swift: undefined }); setSaved(true) }}>Save details</button>
      </div>
    </div>
  )
}

/* ---------- ARES ---------- */

type AresHit = Pick<InvoiceParty, 'name' | 'dic' | 'street' | 'city' | 'zip' | 'country'>
async function aresLookup(ico: string): Promise<AresHit> {
  const clean = ico.replace(/\D/g, '')
  if (clean.length < 6 || clean.length > 8) throw new Error('An IČO has 8 digits.')
  const r = await fetch(`https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${clean.padStart(8, '0')}`)
  if (r.status === 404) throw new Error('ARES has no company with this IČO.')
  if (!r.ok) throw new Error('ARES did not answer. Try again in a moment.')
  const j = await r.json() as {
    obchodniJmeno?: string; dic?: string
    sidlo?: { nazevUlice?: string; cisloDomovni?: number; cisloOrientacni?: number; cisloOrientacniPismeno?: string; nazevObce?: string; nazevCastiObce?: string; psc?: number; nazevStatu?: string }
    adresaDorucovaci?: { radekAdresy1?: string; radekAdresy3?: string }
  }
  const s = j.sidlo ?? {}
  const num = `${s.cisloDomovni ?? ''}${s.cisloOrientacni ? `/${s.cisloOrientacni}${s.cisloOrientacniPismeno ?? ''}` : ''}`
  const street = j.adresaDorucovaci?.radekAdresy1 || [s.nazevUlice || s.nazevCastiObce, num].filter(Boolean).join(' ')
  const line3 = j.adresaDorucovaci?.radekAdresy3?.match(/^(\d{3}\s?\d{2})\s+(.+)$/)
  return {
    name: j.obchodniJmeno ?? '', dic: j.dic ?? '', street,
    zip: line3 ? line3[1].replace(/\s/g, '') : s.psc ? String(s.psc) : '',
    city: line3 ? line3[2] : s.nazevObce ?? '',
    country: s.nazevStatu ?? 'Česká republika',
  }
}

/* ---------- the printed sheet ---------- */

/* Laid out from his own Fakturoid PDF (PM375, 2026-11-01): the title and a heavy rule
   top right, supplier and customer side by side, label left and value right, a single
   PRICE column unless an item has a quantity, the QR payment square bottom left under
   the total's rule, the register line at the foot. No IBAN or SWIFT unless the payer
   needs them (his call, 2026-11-01). */
const L = {
  cs: {
    title: 'Faktura', supplier: 'Dodavatel', customer: 'Odběratel', ico: 'IČO', dic: 'DIČ', notVat: 'Neplátce DPH',
    account: 'Bankovní účet', iban: 'IBAN', swift: 'SWIFT', vs: 'Variabilní symbol', method: 'Způsob platby', order: 'Číslo objednávky',
    issued: 'Datum vystavení', taxable: 'Datum zdan. plnění', due: 'Datum splatnosti',
    qty: 'Počet', unitPrice: 'Cena za MJ', vatRate: 'DPH', price: 'Cena', base: 'Základ', vat: 'DPH', qr: 'QR Platba', cancelled: 'STORNO',
    methods: { bank: 'Převodem', cash: 'Hotově', card: 'Kartou', cod: 'Dobírkou' } as Record<PaymentMethod, string>,
  },
  en: {
    title: 'Invoice', supplier: 'Supplier', customer: 'Customer', ico: 'Reg. No.', dic: 'VAT No.', notVat: 'Not a VAT payer',
    account: 'Bank account', iban: 'IBAN', swift: 'SWIFT', vs: 'Variable symbol', method: 'Payment method', order: 'Order number',
    issued: 'Issue date', taxable: 'Taxable supply date', due: 'Due date',
    qty: 'Qty', unitPrice: 'Unit price', vatRate: 'VAT', price: 'Price', base: 'Base', vat: 'VAT', qr: 'QR payment', cancelled: 'CANCELLED',
    methods: { bank: 'Bank transfer', cash: 'Cash', card: 'Card', cod: 'Cash on delivery' } as Record<PaymentMethod, string>,
  },
}

/** 58601 -> "586 01", the Czech way. */
const zipFmt = (z?: string) => { const d = (z ?? '').replace(/\s/g, ''); return /^\d{5}$/.test(d) ? `${d.slice(0, 3)} ${d.slice(3)}` : (z ?? '') }

function PartyBlock({ head, p, t, extra }: { head: string; p: InvoiceParty; t: typeof L.cs; extra?: ReactNode }) {
  return (
    <div className="ivp-party">
      <i className="ivp-dash" />
      <span className="ivp-k">{head}</span>
      <b className="ivp-name">{p.name || '...'}</b>
      <span className="ivp-addr">
        {p.street && <span>{p.street}</span>}
        {(p.zip || p.city) && <span>{[zipFmt(p.zip), p.city].filter(Boolean).join(' ')}</span>}
        {p.country && p.country !== 'Česká republika' && <span>{p.country}</span>}
      </span>
      {(p.ico || p.dic) && (
        <dl className="ivp-rows">
          {p.ico && <><dt>{t.ico}</dt><dd>{p.ico}</dd></>}
          {p.dic && <><dt>{t.dic}</dt><dd>{p.dic}</dd></>}
        </dl>
      )}
      {extra}
    </div>
  )
}

/** The A4 sheet. Also what prints: the print stylesheet shows this alone (PdfSheet's print root). */
export function InvoicePaper({ inv }: { inv: Invoice }) {
  const t = L[inv.lang] ?? L.cs
  const sup = inv.supplier
  const vatPayer = sup.vatPayer
  const tot = totals(inv.lines, vatPayer)
  const code = useMemo(() => spayd(inv), [inv])
  const qr = useMemo(() => { if (!code) return null; try { return qrSvgPath(qrMatrix(code)) } catch { return null } }, [code])
  const iban = sup.iban || czIban(sup.account ?? '')
  const cur = inv.currency
  const bank = inv.method === 'bank'
  /* Only when the payer needs them: a foreign currency, or an account with no Czech number. */
  const showIban = bank && (cur !== 'CZK' || !sup.account)
  /* One PRICE column, like Fakturoid, until an item has a quantity or a unit. */
  const plain = inv.lines.every((l) => Number(l.qty) === 1 && !l.unit)
  return (
    <article className="iv-paper" aria-label={`${t.title} ${inv.number}`}>
      {inv.status === 'cancelled' && <span className="ivp-stamp">{t.cancelled}</span>}
      <div className="ivp-grid">
        <span aria-hidden="true" />
        <h2 className="ivp-title">{t.title} <span>{inv.number}</span></h2>
        <PartyBlock head={t.supplier} p={sup} t={t} extra={!vatPayer && <span className="ivp-vatnote">{t.notVat}</span>} />
        <PartyBlock head={t.customer} p={inv.client} t={t} />
        <dl className="ivp-rows ivp-pay">
          {bank && sup.account && <><dt>{t.account}</dt><dd>{sup.account}</dd></>}
          {showIban && iban && <><dt>{t.iban}</dt><dd>{ibanSpaced(iban)}</dd></>}
          {showIban && sup.swift && <><dt>{t.swift}</dt><dd>{sup.swift}</dd></>}
          {inv.vs && <><dt>{t.vs}</dt><dd>{inv.vs}</dd></>}
          <dt>{t.method}</dt><dd>{t.methods[inv.method]}</dd>
          {inv.orderNo && <><dt>{t.order}</dt><dd>{inv.orderNo}</dd></>}
        </dl>
        <dl className="ivp-rows ivp-pay">
          <dt>{t.issued}</dt><dd>{fmtDate(inv.issued)}</dd>
          {vatPayer && <><dt>{t.taxable}</dt><dd>{fmtDate(inv.taxable)}</dd></>}
          <dt>{t.due}</dt><dd>{fmtDate(inv.due)}</dd>
        </dl>
      </div>
      {inv.noteBefore && <p className="ivp-note">{inv.noteBefore}</p>}
      <table className="ivp-lines">
        <thead>
          <tr>
            <th />
            {!plain && <th className="is-n">{t.qty}</th>}
            {!plain && <th className="is-n">{t.unitPrice}</th>}
            {vatPayer && <th className="is-n">{t.vatRate}</th>}
            <th className="is-n">{t.price}</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l) => {
            const base = (Number(l.qty) || 0) * (Number(l.price) || 0)
            return (
              <tr key={l.id}>
                <td className="is-desc">{l.name}</td>
                {!plain && <td className="is-n">{String(l.qty).replace('.', ',')}{l.unit ? ` ${l.unit}` : ''}</td>}
                {!plain && <td className="is-n">{money(Number(l.price) || 0, cur)}</td>}
                {vatPayer && <td className="is-n">{Number(l.vat) || 0} %</td>}
                <td className="is-n">{money(base, cur)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="ivp-foot">
        <div className="ivp-qr">
          {qr && bank && (
            <>
              <div className="ivp-qrbox">
                <svg viewBox={`0 0 ${qr.size} ${qr.size}`} width="120" height="120" shapeRendering="crispEdges" role="img" aria-label={t.qr}>
                  <rect width={qr.size} height={qr.size} fill="#fff" /><path d={qr.d} fill="#000" />
                </svg>
              </div>
              <span className="ivp-qrcap"><i />{t.qr}<i /></span>
            </>
          )}
        </div>
        <div className="ivp-sum">
          {vatPayer && tot.byRate.map((r) => (
            <div className="ivp-sumrow" key={r.rate}><span>{t.base} {r.rate} %</span><span>{money(r.base, cur)}</span><span>{t.vat} {money(r.vat, cur)}</span></div>
          ))}
          <b className="ivp-total">{money(tot.total, cur)}</b>
        </div>
      </div>
      {inv.noteAfter && <p className="ivp-note">{inv.noteAfter}</p>}
      <footer className="ivp-legal">
        {sup.regNote && <span>{sup.regNote}</span>}
        {inv.footer && <span>{inv.footer}</span>}
        {(sup.phone || sup.email || sup.web) && <span className="ivp-contact">{[sup.phone, sup.email, sup.web].filter(Boolean).map((x) => <span key={x}>{x}</span>)}</span>}
      </footer>
    </article>
  )
}

/** Shrinks the A4 sheet to the width it is given, and tracks its height, so a preview is never cropped. */
function FitPaper({ inv }: { inv: Invoice }) {
  const slot = useRef<HTMLDivElement>(null)
  const paper = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ s: 1, h: 1123 })
  useLayoutEffect(() => {
    const a = slot.current, b = paper.current
    if (!a || !b) return
    const measure = () => setFit({ s: Math.min(1, a.clientWidth / 794), h: b.offsetHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(a); ro.observe(b)
    return () => ro.disconnect()
  }, [])
  return (
    <div className="iv-fit">
      <div className="iv-fit-slot" ref={slot}>
        <div className="iv-fit-box" style={{ width: 794 * fit.s, height: fit.h * fit.s }}>
          <div ref={paper} className="iv-fit-inner" style={{ width: 794, transform: `scale(${fit.s})` }}><InvoicePaper inv={inv} /></div>
        </div>
      </div>
    </div>
  )
}

function supplierOf(p: Omit<InvoiceProfile, 'id' | 'updatedAt'>, a?: BankAccount): Invoice['supplier'] {
  return {
    ...partyOf(p), account: a?.account, iban: a?.iban || czIban(a?.account ?? '') || undefined, swift: a?.swift,
    vatPayer: p.vatPayer, regNote: p.regNote,
  }
}
