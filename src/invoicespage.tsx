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
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useStore } from './store'
import { Sheet } from './modals'
import { Band, Dropdown, Segmented, Select } from './ui'
import * as Icon from './icons'
import { qrMatrix, qrSvgPath } from './qr'
import {
  DEFAULT_PROFILE, STATUS_LABEL, addDays, czIban, daysBetween, ibanSpaced, invoiceTotal, isoDay, money, nextNumber,
  shownStatus, spayd, totals, vsFromNumber, type ShownStatus,
} from './invoicecalc'
import type { Invoice, InvoiceCurrency, InvoiceLang, InvoiceLine, InvoiceParty, InvoiceProfile, PaymentMethod } from './types'
import type { InvoiceClientDraft, InvoiceDraft } from './store/invoices'

type Tab = 'invoices' | 'overview' | 'contacts' | 'settings'
type View =
  | { kind: 'list' }
  | { kind: 'invoice'; id: string }
  | { kind: 'edit'; id?: string; copyOf?: string; clientId?: string }
  | { kind: 'contact'; id: string }

const TAB_KEY = 'mc-invoices-tab'
const TABS: { id: Tab; label: string }[] = [
  { id: 'invoices', label: 'Invoices' }, { id: 'overview', label: 'Overview' },
  { id: 'contacts', label: 'Contacts' }, { id: 'settings', label: 'Settings' },
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

/** "Due in 5 days", "12 days late", "Paid 3. 11. 2026". */
function whenText(i: Invoice, today: string): { t: string; late: boolean } {
  const s = shownStatus(i, today)
  if (s === 'paid') return { t: `Paid ${fmtDate(i.paidOn)}`, late: false }
  if (s === 'cancelled') return { t: 'Cancelled', late: false }
  const d = daysBetween(today, i.due)
  if (d < 0) return { t: `${plural(-d, 'day', 'days')} late`, late: true }
  return { t: d === 0 ? 'Due today' : `Due in ${plural(d, 'day', 'days')}`, late: false }
}

/* ---------- the page ---------- */

export function InvoicesPage() {
  const { invoiceSupplier } = useStore()
  const [tab, setTabRaw] = useState<Tab>(() => {
    try { const t = localStorage.getItem(TAB_KEY) as Tab | null; return t && TABS.some((x) => x.id === t) ? t : 'invoices' } catch { return 'invoices' }
  })
  const [view, setView] = useState<View>({ kind: 'list' })
  const [contactEdit, setContactEdit] = useState<{ id?: string } | null>(null)
  const setTab = (t: Tab) => { setTabRaw(t); setView({ kind: 'list' }); try { localStorage.setItem(TAB_KEY, t) } catch { /* private mode */ } }
  const openInvoice = (id: string) => { setTabRaw('invoices'); setView({ kind: 'invoice', id }) }
  const newInvoice = (clientId?: string) => { setTabRaw('invoices'); setView({ kind: 'edit', clientId }) }
  const openContact = (id: string) => { setTabRaw('contacts'); setView({ kind: 'contact', id }) }
  useEffect(() => { window.scrollTo({ top: 0 }) }, [tab, view])

  const action = view.kind === 'edit' ? null : tab === 'contacts' && view.kind === 'list'
    ? <button className="btn btn-primary iv-new" type="button" onClick={() => setContactEdit({})}><Icon.Plus size={15} />New contact</button>
    : tab !== 'settings' ? <button className="btn btn-primary iv-new" type="button" onClick={() => newInvoice()}><Icon.Plus size={15} />New invoice</button> : null

  return (
    <div className="iv-page">
      <Band title="Invoices" actions={action} />
      <nav className="iv-tabs" aria-label="Invoices sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" className="iv-tab" aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </nav>

      {!invoiceSupplier?.name && tab !== 'settings' && (
        <div className="iv-notice">
          <span>Your name, IČO, address and bank account go on every invoice.</span>
          <button className="btn btn-quiet" type="button" onClick={() => setTab('settings')}>Fill in your details</button>
        </div>
      )}

      <div className="iv-body">
        {tab === 'invoices' && view.kind === 'list' && <InvoiceList onOpen={openInvoice} onNew={() => newInvoice()} />}
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
        {tab === 'overview' && <Overview onOpen={openInvoice} />}
        {tab === 'contacts' && view.kind === 'list' && <ContactList onOpen={openContact} onAdd={() => setContactEdit({})} />}
        {tab === 'contacts' && view.kind === 'contact' && (
          <ContactDetail id={view.id} onBack={() => setView({ kind: 'list' })} onEdit={() => setContactEdit({ id: view.id })}
            onOpen={openInvoice} onNew={newInvoice} />
        )}
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
  { id: 'all', label: 'All', icon: <Icon.DockInvoice size={22} />, scope: 'in 12 months' },
  { id: 'unpaid', label: 'Unpaid', icon: <Icon.Clock size={22} />, scope: 'incl. overdue' },
  { id: 'overdue', label: 'Overdue', icon: <Icon.Flag size={22} />, scope: 'all time' },
  { id: 'paid', label: 'Paid', icon: <Icon.CheckRing size={22} />, scope: 'in 12 months' },
  { id: 'cancelled', label: 'Cancelled', icon: <Icon.Close size={22} />, scope: 'in 12 months' },
]

function InvoiceList({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const { invoices } = useStore()
  const today = isoDay()
  const yearAgo = addDays(today, -365)
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [order, setOrder] = useState<'new' | 'old'>('new')

  const inFilter = (i: Invoice, f: Filter): boolean => {
    const s = shownStatus(i, today)
    if (f === 'unpaid') return s === 'open' || s === 'sent' || s === 'overdue'
    if (f === 'overdue') return s === 'overdue'
    if (f === 'paid') return s === 'paid' && (i.paidOn ?? i.issued) >= yearAgo
    if (f === 'cancelled') return s === 'cancelled' && i.issued >= yearAgo
    return i.issued >= yearAgo && s !== 'cancelled'
  }
  const shown = invoices
    .filter((i) => (q.trim() ? true : inFilter(i, filter)))
    .filter((i) => !q.trim() || fold(q.trim()).split(/\s+/).every((w) => fold([i.number, i.client.name, i.client.ico, ...i.lines.map((l) => l.name)].join(' ')).includes(w)))
    .sort((a, b) => (order === 'new' ? 1 : -1) * (b.issued.localeCompare(a.issued) || b.number.localeCompare(a.number)))

  if (!invoices.length) {
    return (
      <div className="iv-empty">
        <p>Every invoice you issue lives here, with what is paid, what is waiting and what is late.</p>
        <button className="btn btn-primary" type="button" onClick={onNew}>Create the first invoice</button>
      </div>
    )
  }
  return (
    <>
      <div className="iv-cards" role="group" aria-label="Show invoices">
        {CARDS.map((c) => {
          const rows = invoices.filter((i) => inFilter(i, c.id))
          return (
            <button key={c.id} type="button" className={`iv-scard is-${c.id}`} aria-pressed={!q.trim() && filter === c.id} onClick={() => { setFilter(c.id); setQ('') }}>
              <span className="iv-scard-ico" aria-hidden="true">{c.icon}</span>
              <span className="iv-scard-name">{c.label}<small>{plural(rows.length, 'invoice', 'invoices')}</small></span>
              <span className="iv-scard-sum">{sumText(rows)}<small>{c.scope}</small></span>
            </button>
          )
        })}
      </div>

      <div className="iv-listbar">
        <label className="iv-search">
          <Icon.Search size={16} />
          <input type="search" value={q} placeholder="Search by number, client or item" aria-label="Search invoices" onChange={(e) => setQ(e.target.value)} />
        </label>
        <Segmented size="sm" label="Order" value={order} onPick={setOrder} options={[{ id: 'new', label: 'Newest' }, { id: 'old', label: 'Oldest' }]} />
      </div>

      {shown.length === 0
        ? <div className="iv-empty"><p>{q.trim() ? 'Nothing matches that search.' : 'No invoices here.'}</p></div>
        : <InvoiceRows rows={shown} onOpen={onOpen} />}
    </>
  )
}

/** One invoice per line, Fakturoid's list: number, status, date, client, due, amount, menu. */
function InvoiceRows({ rows, onOpen, hideClient }: { rows: Invoice[]; onOpen: (id: string) => void; hideClient?: boolean }) {
  const { patchInvoice } = useStore()
  const today = isoDay()
  return (
    <ul className={`iv-rows${hideClient ? ' no-client' : ''}`}>
      {rows.map((i) => {
        const s = shownStatus(i, today)
        const w = whenText(i, today)
        return (
          <li key={i.id} className={`iv-row is-${s}`} onClick={() => onOpen(i.id)}>
            <button type="button" className="iv-row-num" onClick={(e) => { e.stopPropagation(); onOpen(i.id) }}>{i.number}</button>
            <span className={`iv-row-status is-${s}`}>{STATUS_LABEL[s]}</span>
            <span className="iv-row-date">{fmtDate(i.issued)}</span>
            {!hideClient && <span className="iv-row-client">{i.client.name}</span>}
            <span className={`iv-row-when${w.late ? ' is-late' : ''}`}>{w.t}</span>
            <span className="iv-row-amt">{money(invoiceTotal(i), i.currency)}</span>
            <span className="iv-row-menu" onClick={(e) => e.stopPropagation()}>
              <Dropdown label={`Options for ${i.number}`}>
                {s !== 'paid' && s !== 'cancelled' && <button role="menuitem" onClick={() => patchInvoice(i.id, { status: 'paid', paidOn: today })}>Mark as paid today</button>}
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

/* ---------- overview ---------- */

function Overview({ onOpen }: { onOpen: (id: string) => void }) {
  const { invoices } = useStore()
  const today = isoDay()
  const thisYear = today.slice(0, 4)
  const years = [...new Set([thisYear, ...invoices.map((i) => i.issued.slice(0, 4))])].sort().reverse()
  const [year, setYear] = useState(thisYear)
  const [hover, setHover] = useState<number | null>(null)
  const live = invoices.filter((i) => i.status !== 'cancelled')
  const inYear = live.filter((i) => i.issued.startsWith(year))
  const paidYear = inYear.filter((i) => i.status === 'paid')
  const unpaidAll = live.filter((i) => i.status !== 'paid').sort((a, b) => a.due.localeCompare(b.due))
  const late = unpaidAll.filter((i) => i.due < today)

  /* Fakturoid's chart: per month, what was invoiced, split into paid and not yet. CZK only, a bar cannot add euros to crowns. */
  const czk = inYear.filter((i) => i.currency === 'CZK')
  const months = Array.from({ length: 12 }, (_, m) => {
    const key = `${year}-${String(m + 1).padStart(2, '0')}`
    const rows = czk.filter((i) => i.issued.startsWith(key))
    const paid = rows.filter((i) => i.status === 'paid').reduce((s, i) => s + invoiceTotal(i), 0)
    const all = rows.reduce((s, i) => s + invoiceTotal(i), 0)
    return { key, name: new Date(Number(year), m, 1).toLocaleDateString('en-GB', { month: 'long' }), paid, unpaid: all - paid, count: rows.length }
  })
  const top = Math.max(1, ...months.map((m) => m.paid + m.unpaid))
  const step = niceStep(top)
  const ceil = Math.ceil(top / step) * step
  const clients = [...inYear.reduce((m, i) => {
    const k = i.clientId ?? i.client.name
    const cur = m.get(k) ?? { name: i.client.name, rows: [] as Invoice[] }
    cur.rows.push(i); m.set(k, cur); return m
  }, new Map<string, { name: string; rows: Invoice[] }>()).values()]
    .map((c) => ({ ...c, sum: c.rows.filter((i) => i.currency === 'CZK').reduce((s, i) => s + invoiceTotal(i), 0) }))
    .sort((a, b) => b.sum - a.sum).slice(0, 5)

  if (!invoices.length) return <div className="iv-empty"><p>Nothing invoiced yet. Once you issue invoices, this shows what came in each month and what is still waiting.</p></div>

  return (
    <div className="iv-overview">
      <div className="iv-ov-head">
        <div className="iv-kpis">
          <div className="iv-kpi"><span>Invoiced in {year}</span><b>{sumText(inYear)}</b><small>{plural(inYear.length, 'invoice', 'invoices')}</small></div>
          <div className="iv-kpi"><span>Paid</span><b className="is-pos">{sumText(paidYear)}</b><small>{plural(paidYear.length, 'invoice', 'invoices')}</small></div>
          <div className="iv-kpi"><span>Waiting for payment</span><b>{sumText(unpaidAll)}</b><small>{plural(unpaidAll.length, 'invoice', 'invoices')}, all years</small></div>
          <div className="iv-kpi"><span>Overdue</span><b className={late.length ? 'is-late' : ''}>{late.length ? sumText(late) : 'Nothing late'}</b><small>{plural(late.length, 'invoice', 'invoices')}</small></div>
        </div>
        {years.length > 1 && <Select className="iv-year" ariaLabel="Year" value={year} onChange={setYear} options={years.map((y) => ({ value: y, label: y }))} />}
      </div>

      <section className="iv-panel iv-chart-panel" aria-label={`Invoiced per month in ${year}, CZK`}>
        <div className="iv-chart">
          <div className="iv-axis" aria-hidden="true">
            {Array.from({ length: Math.round(ceil / step) + 1 }, (_, k) => ceil - k * step).map((v) => <span key={v}>{money(v, 'CZK', 0)}</span>)}
          </div>
          <div className="iv-plot" onMouseLeave={() => setHover(null)}>
            <div className="iv-grid-lines" aria-hidden="true">{Array.from({ length: Math.round(ceil / step) + 1 }, (_, k) => <i key={k} className="iv-grid-line" style={{ top: `${(k * step / ceil) * 100}%` }} />)}</div>
            {months.map((m, k) => (
              <div key={m.key} className={`iv-col${hover === k ? ' is-on' : ''}`} onMouseEnter={() => setHover(k)}>
                <div className="iv-stack" style={{ height: `${((m.paid + m.unpaid) / ceil) * 100}%` }}>
                  {m.unpaid > 0 && <span className="iv-seg is-unpaid" style={{ flexGrow: m.unpaid }} />}
                  {m.paid > 0 && <span className="iv-seg is-paid" style={{ flexGrow: m.paid }} />}
                </div>
                <span className="iv-col-k">{m.name.slice(0, 3)}</span>
                {hover === k && m.count > 0 && (
                  <div className={`iv-tip${k > 8 ? ' is-left' : ''}`} role="status">
                    <b>{m.name}</b>
                    <div><span>Invoiced</span><span>{money(m.paid + m.unpaid, 'CZK', 0)}</span></div>
                    <div><span><i className="is-paid" />Paid</span><span>{money(m.paid, 'CZK', 0)}</span></div>
                    <div><span><i className="is-unpaid" />Unpaid</span><span>{money(m.unpaid, 'CZK', 0)}</span></div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="iv-ov-lists">
        <section className="iv-panel">
          <h2 className="iv-h2">Waiting for payment</h2>
          {unpaidAll.length ? <InvoiceRows rows={unpaidAll.slice(0, 8)} onOpen={onOpen} /> : <p className="iv-quiet">Everything is paid.</p>}
        </section>
        <section className="iv-panel">
          <h2 className="iv-h2">Top clients in {year}</h2>
          {clients.length ? (
            <ol className="iv-tops">
              {clients.map((c) => (
                <li key={c.name}>
                  <span className="iv-top-name">{c.name}</span>
                  <span className="iv-top-bar"><i style={{ transform: `scaleX(${c.sum / Math.max(1, clients[0].sum)})` }} /></span>
                  <span className="iv-top-sum">{sumText(c.rows)}</span>
                </li>
              ))}
            </ol>
          ) : <p className="iv-quiet">No invoices in {year}.</p>}
        </section>
      </div>
    </div>
  )
}

function niceStep(max: number): number {
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? mag * 10
}

/* ---------- one invoice ---------- */

function InvoiceDetail({ id, onBack, onEdit, onCopy, onContact }: {
  id: string; onBack: () => void; onEdit: (id: string) => void; onCopy: (id: string) => void; onContact: (id: string) => void
}) {
  const { invoices, invoiceClients, patchInvoice, deleteInvoice } = useStore()
  const inv = invoices.find((i) => i.id === id)
  const today = isoDay()
  const [paying, setPaying] = useState(false)
  if (!inv) return <div className="iv-empty"><p>This invoice was deleted.</p><button className="btn btn-quiet" type="button" onClick={onBack}>Back to invoices</button></div>
  const s = shownStatus(inv, today)
  const w = whenText(inv, today)
  const t = totals(inv.lines, inv.supplier.vatPayer)
  const contact = inv.clientId ? invoiceClients.find((c) => c.id === inv.clientId) : undefined

  const print = () => {
    const was = document.title
    document.title = `${inv.lang === 'en' ? 'Invoice' : 'Faktura'} ${inv.number}`
    document.body.classList.add('iv-printing')
    const done = () => { document.title = was; document.body.classList.remove('iv-printing'); window.removeEventListener('afterprint', done) }
    window.addEventListener('afterprint', done)
    window.print()
  }

  return (
    <div className="iv-detail">
      <button className="iv-back" type="button" onClick={onBack}><Icon.ChevronLeft size={15} />All invoices</button>
      <header className="iv-dhead">
        <div className="iv-dtitle">
          <h2>Invoice {inv.number}</h2>
          <div className="iv-dstate">
            <span className={`iv-row-status is-${s}`}>{STATUS_LABEL[s]}{s === 'sent' && inv.sentOn ? ` ${fmtDate(inv.sentOn)}` : ''}</span>
            <span className={w.late ? 'is-late' : ''}>{w.t}</span>
          </div>
        </div>
        <div className="iv-dactions" role="toolbar" aria-label="Invoice actions">
          <IconAction icon={<Icon.DockInvoice size={22} />} label="Print or PDF" onClick={print} />
          {s !== 'paid' && s !== 'cancelled' && <IconAction icon={<Icon.CheckRing size={22} />} label="Record payment" onClick={() => setPaying(true)} strong />}
          <IconAction icon={<Icon.Edit size={22} />} label="Edit" onClick={() => onEdit(inv.id)} />
          <IconAction icon={<Icon.Copy size={22} />} label="Duplicate" onClick={() => onCopy(inv.id)} />
          <Dropdown label="More actions" className="iv-more" trigger={({ onClick, open }) => (
            <button type="button" className="iv-iact" aria-expanded={open} onClick={onClick}><Icon.More size={22} /><span>More</span></button>
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

      <div className="iv-dfacts">
        <div>
          {contact ? <button type="button" className="iv-link iv-dclient" onClick={() => onContact(contact.id)}>{inv.client.name}</button> : <b className="iv-dclient">{inv.client.name}</b>}
          {inv.client.street && <span>{inv.client.street}</span>}
          {(inv.client.zip || inv.client.city) && <span>{[inv.client.zip, inv.client.city].filter(Boolean).join(' ')}</span>}
        </div>
        <dl>
          <dt>Issued</dt><dd>{fmtDate(inv.issued)}</dd>
          <dt>Due</dt><dd>{fmtDate(inv.due)}</dd>
          {inv.supplier.vatPayer && <><dt>Taxable supply</dt><dd>{fmtDate(inv.taxable)}</dd></>}
          {inv.paidOn && <><dt>Paid</dt><dd>{fmtDate(inv.paidOn)}</dd></>}
        </dl>
        <dl>
          <dt>Variable symbol</dt><dd>{inv.vs}</dd>
          <dt>Payment</dt><dd>{METHODS.find((m) => m.id === inv.method)?.label}</dd>
          <dt>Total</dt><dd className="iv-dtotal">{money(t.total, inv.currency)}</dd>
        </dl>
      </div>

      <div className="iv-paperwrap"><InvoicePaper inv={inv} /></div>

      {paying && <PaymentSheet inv={inv} onClose={() => setPaying(false)} onPaid={(day) => { patchInvoice(inv.id, { status: 'paid', paidOn: day }); setPaying(false) }} />}
    </div>
  )
}

function IconAction({ icon, label, onClick, strong }: { icon: ReactNode; label: string; onClick: () => void; strong?: boolean }) {
  return <button type="button" className={`iv-iact${strong ? ' is-strong' : ''}`} onClick={onClick}>{icon}<span>{label}</span></button>
}

function PaymentSheet({ inv, onClose, onPaid }: { inv: Invoice; onClose: () => void; onPaid: (day: string) => void }) {
  const [day, setDay] = useState(isoDay())
  return (
    <Sheet title={`Record payment for ${inv.number}`} onClose={onClose}>
      <div className="iv-paysheet">
        <div className="iv-pay-amt">{money(invoiceTotal(inv), inv.currency)}<span>from {inv.client.name}</span></div>
        <label className="iv-flabel">Paid on<input className="iv-input" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
        <div className="iv-sheet-foot">
          <button className="btn btn-quiet" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="button" disabled={!day} onClick={() => onPaid(day)}>Mark as paid</button>
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
      supplier: supplierOf(profile),
      method: source?.method ?? 'bank', currency: source?.currency ?? 'CZK', lang: source?.lang ?? 'cs',
      lines: source ? source.lines.map((l) => ({ ...l, id: lineId() })) : [{ id: lineId(), name: '', qty: 1, unit: '', price: 0, vat: 21 }],
      noteBefore: source?.noteBefore ?? '', noteAfter: source?.noteAfter ?? '', footer: profile.footer ?? '', orderNo: '',
      status: 'open',
    }
  })
  const [editNumber, setEditNumber] = useState(false)
  const [more, setMore] = useState(false)
  const [newContact, setNewContact] = useState(false)
  const [preview, setPreview] = useState(false)
  const [tried, setTried] = useState(false)
  const set = <K extends keyof InvoiceDraft>(k: K, v: InvoiceDraft[K]) => setD((p) => ({ ...p, [k]: v }))
  const setLine = (lid: string, patch: Partial<InvoiceLine>) => setD((p) => ({ ...p, lines: p.lines.map((l) => (l.id === lid ? { ...l, ...patch } : l)) }))
  const dueDays = daysBetween(d.issued, d.due)
  const vatPayer = existing ? d.supplier.vatPayer : profile.vatPayer
  const tot = totals(d.lines, vatPayer)
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
    supplier: existing && existing.status !== 'open' ? existing.supplier : supplierOf(profile),
    ...(existing ? { id: existing.id } : {}),
  })
  const save = () => { setTried(true); if (!bad) onDone(saveInvoice(draftFinal())) }
  const dueOptions = [...new Set([...DUE_PRESETS, dueDays])].filter((n) => n >= 0).sort((a, b) => a - b)

  return (
    <div className="iv-form">
      <div className="iv-form-head">
        <button className="iv-back" type="button" onClick={() => onDone(existing?.id)}><Icon.ChevronLeft size={15} />{existing ? `Invoice ${existing.number}` : 'All invoices'}</button>
        <h2>{existing ? `Edit invoice ${existing.number}` : copyOf ? 'New invoice from a copy' : 'New invoice'}</h2>
      </div>

      <div className="iv-panel iv-form-panel">
        <div className="iv-fgrid">
          <FRow label="Customer" error={tried ? err.client : ''}>
            <div className="iv-inline">
              <Select className="iv-select iv-w-lg" ariaLabel="Customer" value={d.clientId ?? ''} onChange={pickClient}
                options={[{ value: '', label: invoiceClients.length ? 'Choose a customer' : 'No contacts yet' },
                  ...[...invoiceClients].sort((a, b) => a.name.localeCompare(b.name, 'cs')).map((c) => ({ value: c.id, label: c.name }))]} />
              <button type="button" className="iv-link iv-plus" onClick={() => setNewContact(true)}><Icon.Plus size={15} />New customer</button>
            </div>
            {d.client.name && (
              <span className="iv-hint">{[d.client.street, [d.client.zip, d.client.city].filter(Boolean).join(' '), d.client.ico && `IČO ${d.client.ico}`].filter(Boolean).join(', ')}</span>
            )}
          </FRow>

          <FRow label="Invoice number" error={tried ? err.number : ''}>
            {editNumber
              ? <input className="iv-input iv-w-md" autoFocus value={d.number} onChange={(e) => { const v = e.target.value; setD((p) => ({ ...p, number: v, vs: p.vs === vsFromNumber(p.number) ? vsFromNumber(v) : p.vs })) }} />
              : <div className="iv-inline"><b className="iv-static">{d.number}</b><button type="button" className="iv-link" onClick={() => setEditNumber(true)}>Change</button></div>}
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

          <FRow label="Payment method">
            <Segmented size="sm" label="Payment method" value={d.method} onPick={(v) => set('method', v)} options={METHODS} className="iv-paymethod" />
          </FRow>

          <FRow label="Due" error={tried ? err.due : ''}>
            <div className="iv-inline">
              <Select className="iv-select iv-w-md" ariaLabel="Due in" value={dueDays} onChange={(n) => set('due', addDays(d.issued, n))}
                options={dueOptions.map((n) => ({ value: n, label: n === 0 ? 'On issue' : plural(n, 'day', 'days') }))} />
              <span className="iv-hint">lands on {fmtDate(d.due)}</span>
            </div>
          </FRow>

          <FRow label="Currency">
            <Select className="iv-select iv-w-sm" ariaLabel="Currency" value={d.currency} onChange={(v) => set('currency', v)} options={CURRENCIES} />
          </FRow>

          <FRow label="">
            <button type="button" className="iv-link iv-plus iv-more-btn" aria-expanded={more} onClick={() => setMore((v) => !v)}>
              <Icon.ChevronDown size={15} />{more ? 'Fewer options' : 'More options'}
            </button>
          </FRow>
          {more && (
            <>
              <FRow label="Language"><Select className="iv-select iv-w-md" ariaLabel="Language" value={d.lang} onChange={(v) => set('lang', v)} options={LANGS} /></FRow>
              <FRow label="Variable symbol"><input className="iv-input iv-w-md" inputMode="numeric" value={d.vs} onChange={(e) => set('vs', e.target.value.replace(/\D/g, '').slice(0, 10))} /></FRow>
              <FRow label="Order number"><input className="iv-input iv-w-md" value={d.orderNo ?? ''} onChange={(e) => set('orderNo', e.target.value)} /></FRow>
              <FRow label="Text above items"><textarea className="iv-input iv-w-lg" rows={2} value={d.noteBefore ?? ''} onChange={(e) => set('noteBefore', e.target.value)} /></FRow>
              <FRow label="Text below items"><textarea className="iv-input iv-w-lg" rows={2} value={d.noteAfter ?? ''} onChange={(e) => set('noteAfter', e.target.value)} /></FRow>
              <FRow label="Footer"><input className="iv-input iv-w-lg" value={d.footer ?? ''} onChange={(e) => set('footer', e.target.value)} /></FRow>
            </>
          )}
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
          <button className="btn btn-quiet iv-additem" type="button"
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
          <button type="button" className="iv-link" onClick={() => onDone(existing?.id)}>Discard</button>
          <button type="button" className="iv-link" onClick={() => setPreview(true)}>Preview</button>
          <button type="button" className="btn btn-primary iv-create" onClick={save}>{existing ? 'Save invoice' : 'Create invoice'}</button>
        </div>
      </div>

      {newContact && (
        <ContactSheet onClose={() => setNewContact(false)}
          onSaved={(cid, c) => { setNewContact(false); setD((p) => ({ ...p, clientId: cid, client: partyOf(c), due: c.dueDays != null ? addDays(p.issued, c.dueDays) : p.due })) }} />
      )}
      {preview && (
        <Sheet title="Preview" onClose={() => setPreview(false)}>
          <div className="iv-preview"><InvoicePaper inv={{ ...draftFinal(), id: 'preview', createdAt: 0, updatedAt: 0 } as Invoice} /></div>
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

/* ---------- contacts ---------- */

function ContactList({ onOpen, onAdd }: { onOpen: (id: string) => void; onAdd: () => void }) {
  const { invoiceClients, invoices } = useStore()
  const [q, setQ] = useState('')
  const rows = invoiceClients
    .filter((c) => !q.trim() || fold([c.name, c.ico, c.dic, c.city, c.email].join(' ')).includes(fold(q.trim())))
    .sort((a, b) => a.name.localeCompare(b.name, 'cs'))
  if (!invoiceClients.length) {
    return (
      <div className="iv-empty">
        <p>Everyone you invoice. Type an IČO and the name and address come from ARES.</p>
        <button className="btn btn-primary" type="button" onClick={onAdd}>Add the first contact</button>
      </div>
    )
  }
  return (
    <>
      <label className="iv-search is-big">
        <Icon.Search size={18} />
        <input type="search" value={q} placeholder="Name, IČO or email" aria-label="Search contacts" onChange={(e) => setQ(e.target.value)} />
      </label>
      <ul className="iv-crows">
        {rows.map((c) => {
          const mine = invoices.filter((i) => i.clientId === c.id && i.status !== 'cancelled')
          const unpaid = mine.filter((i) => i.status !== 'paid')
          return (
            <li key={c.id} className="iv-crow" onClick={() => onOpen(c.id)}>
              <button type="button" className="iv-crow-name" onClick={(e) => { e.stopPropagation(); onOpen(c.id) }}>{c.name}</button>
              <span className="iv-crow-ids">{c.ico && <span>IČO {c.ico}</span>}{c.dic && <span>DIČ {c.dic}</span>}</span>
              <span className="iv-crow-mail">{c.email}</span>
              <span className="iv-crow-city">{c.city}</span>
              <span className="iv-crow-sum">{mine.length ? sumText(mine) : ''}<small>{mine.length ? plural(mine.length, 'invoice', 'invoices') : 'Not invoiced yet'}</small></span>
              <span className={`iv-crow-unpaid${unpaid.length ? ' is-on' : ''}`}>{unpaid.length ? `${sumText(unpaid)} unpaid` : ''}</span>
            </li>
          )
        })}
      </ul>
    </>
  )
}

function ContactDetail({ id, onBack, onEdit, onOpen, onNew }: { id: string; onBack: () => void; onEdit: () => void; onOpen: (id: string) => void; onNew: (cid: string) => void }) {
  const { invoiceClients, invoices, deleteInvoiceClient } = useStore()
  const c = invoiceClients.find((x) => x.id === id)
  if (!c) return <div className="iv-empty"><p>This contact was deleted.</p><button className="btn btn-quiet" type="button" onClick={onBack}>Back to contacts</button></div>
  const theirs = invoices.filter((i) => i.clientId === c.id).sort((a, b) => b.issued.localeCompare(a.issued))
  const live = theirs.filter((i) => i.status !== 'cancelled')
  const unpaid = live.filter((i) => i.status !== 'paid')
  const late = unpaid.filter((i) => i.due < isoDay())
  return (
    <div className="iv-detail">
      <button className="iv-back" type="button" onClick={onBack}><Icon.ChevronLeft size={15} />All contacts</button>
      <header className="iv-dhead">
        <div className="iv-dtitle">
          <h2>{c.name}</h2>
          <div className="iv-dstate">{[c.ico && `IČO ${c.ico}`, c.dic && `DIČ ${c.dic}`, [c.street, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).map((x) => <span key={String(x)}>{x}</span>)}</div>
        </div>
        <div className="iv-dactions" role="toolbar" aria-label="Contact actions">
          <IconAction icon={<Icon.Plus size={22} />} label="New invoice" onClick={() => onNew(c.id)} strong />
          <IconAction icon={<Icon.Edit size={22} />} label="Edit" onClick={onEdit} />
          <Dropdown label="More actions" className="iv-more" trigger={({ onClick, open }) => (
            <button type="button" className="iv-iact" aria-expanded={open} onClick={onClick}><Icon.More size={22} /><span>More</span></button>
          )}>
            <button role="menuitem" className="danger" onClick={() => { deleteInvoiceClient(c.id); onBack() }}>Delete contact</button>
          </Dropdown>
        </div>
      </header>
      <div className="iv-kpis is-contact">
        <div className="iv-kpi"><span>Invoiced</span><b>{sumText(live)}</b><small>{plural(live.length, 'invoice', 'invoices')}</small></div>
        <div className="iv-kpi"><span>Waiting for payment</span><b>{sumText(unpaid)}</b><small>{plural(unpaid.length, 'invoice', 'invoices')}</small></div>
        <div className="iv-kpi"><span>Overdue</span><b className={late.length ? 'is-late' : ''}>{late.length ? sumText(late) : 'Nothing late'}</b><small>{c.email || 'No email'}</small></div>
      </div>
      <section className="iv-panel">
        <h2 className="iv-h2">Invoices</h2>
        {theirs.length ? <InvoiceRows rows={theirs} onOpen={onOpen} hideClient /> : <p className="iv-quiet">No invoices for {c.name} yet.</p>}
      </section>
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
          <button className="btn btn-quiet" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="button" disabled={!c.name.trim()} onClick={save}>{existing ? 'Save contact' : 'Add contact'}</button>
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
          <button className="btn btn-quiet" type="button" disabled={busy || !(value.ico ?? '').replace(/\D/g, '')} onClick={() => void lookup()}>{busy ? 'Looking up' : 'Fill from ARES'}</button>
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
  const [p, setP] = useState<Omit<InvoiceProfile, 'id' | 'updatedAt'>>(() => ({ ...DEFAULT_PROFILE, ...(invoiceSupplier ?? {}) }))
  const [saved, setSaved] = useState(false)
  const set = (patch: Partial<InvoiceProfile>) => { setP((x) => ({ ...x, ...patch })); setSaved(false) }
  const autoIban = czIban(p.account ?? '')
  return (
    <div className="iv-settings">
      <section className="iv-panel">
        <h2 className="iv-h2">Your details</h2>
        <PartyFields value={p} onChange={set} />
        <label className="iv-flabel">Website<input className="iv-input" value={p.web ?? ''} onChange={(e) => set({ web: e.target.value })} /></label>
      </section>
      <section className="iv-panel">
        <h2 className="iv-h2">Bank account</h2>
        <label className="iv-flabel">Account number<input className="iv-input" placeholder="123456789/0800" value={p.account ?? ''} onChange={(e) => set({ account: e.target.value })} /></label>
        <div className="iv-two">
          <label className="iv-flabel">IBAN<input className="iv-input" placeholder={autoIban ? ibanSpaced(autoIban) : ''} value={p.iban ?? ''} onChange={(e) => set({ iban: e.target.value })} /></label>
          <label className="iv-flabel">SWIFT<input className="iv-input" value={p.swift ?? ''} onChange={(e) => set({ swift: e.target.value })} /></label>
        </div>
        {autoIban && !p.iban && <p className="iv-hint">The IBAN for the QR payment code comes from the account number: {ibanSpaced(autoIban)}</p>}
      </section>
      <section className="iv-panel">
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
        <button className="btn btn-primary iv-create" type="button" onClick={() => { saveInvoiceProfile(p); setSaved(true) }}>Save details</button>
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

const L = {
  cs: {
    title: 'Faktura', supplier: 'Dodavatel', customer: 'Odběratel', ico: 'IČO', dic: 'DIČ', issued: 'Datum vystavení',
    taxable: 'Datum zdan. plnění', due: 'Datum splatnosti', method: 'Způsob platby', account: 'Bankovní účet', iban: 'IBAN', swift: 'SWIFT',
    vs: 'Variabilní symbol', order: 'Číslo objednávky', item: 'Položka', qty: 'Množství', price: 'Cena za jedn.', vatRate: 'DPH',
    base: 'Bez DPH', vat: 'DPH', total: 'Celkem', toPay: 'Celkem k úhradě', noVat: 'Nejsem plátce DPH.', qr: 'QR Platba',
    summaryBase: 'Základ', cancelled: 'STORNO', paid: 'Uhrazeno',
    methods: { bank: 'Převodem', cash: 'Hotově', card: 'Kartou', cod: 'Dobírkou' } as Record<PaymentMethod, string>,
  },
  en: {
    title: 'Invoice', supplier: 'Supplier', customer: 'Customer', ico: 'Reg. No.', dic: 'VAT No.', issued: 'Issue date',
    taxable: 'Taxable supply date', due: 'Due date', method: 'Payment method', account: 'Bank account', iban: 'IBAN', swift: 'SWIFT',
    vs: 'Variable symbol', order: 'Order number', item: 'Item', qty: 'Quantity', price: 'Unit price', vatRate: 'VAT',
    base: 'Net', vat: 'VAT', total: 'Total', toPay: 'Total due', noVat: 'Not registered for VAT.', qr: 'QR payment',
    summaryBase: 'Base', cancelled: 'CANCELLED', paid: 'Paid',
    methods: { bank: 'Bank transfer', cash: 'Cash', card: 'Card', cod: 'Cash on delivery' } as Record<PaymentMethod, string>,
  },
}

function PartyBlock({ head, p, t }: { head: string; p: InvoiceParty; t: typeof L.cs }) {
  return (
    <div className="ivp-party">
      <span className="ivp-k">{head}</span>
      <b className="ivp-name">{p.name || '...'}</b>
      {p.street && <span>{p.street}</span>}
      {(p.zip || p.city) && <span>{[p.zip, p.city].filter(Boolean).join(' ')}</span>}
      {p.country && p.country !== 'Česká republika' && <span>{p.country}</span>}
      {(p.ico || p.dic) && (
        <span className="ivp-ids">
          {p.ico && <span>{t.ico}: {p.ico}</span>}
          {p.dic && <span>{t.dic}: {p.dic}</span>}
        </span>
      )}
      {p.email && <span className="ivp-soft">{p.email}</span>}
    </div>
  )
}

/** The A4 sheet. Also what prints: the print stylesheet shows this alone. */
export function InvoicePaper({ inv }: { inv: Invoice }) {
  const t = L[inv.lang] ?? L.cs
  const sup = inv.supplier
  const vatPayer = sup.vatPayer
  const tot = totals(inv.lines, vatPayer)
  const code = useMemo(() => spayd(inv), [inv])
  const qr = useMemo(() => { if (!code) return null; try { return qrSvgPath(qrMatrix(code)) } catch { return null } }, [code])
  const iban = sup.iban || czIban(sup.account ?? '')
  const cur = inv.currency
  return (
    <article className="iv-paper" aria-label={`${t.title} ${inv.number}`}>
      {inv.status === 'cancelled' && <span className="ivp-stamp">{t.cancelled}</span>}
      <header className="ivp-head">
        <h2>{t.title} <span>{inv.number}</span></h2>
      </header>
      <div className="ivp-parties">
        <PartyBlock head={t.supplier} p={sup} t={t} />
        <PartyBlock head={t.customer} p={inv.client} t={t} />
      </div>
      <div className="ivp-meta">
        <dl>
          {inv.method === 'bank' && sup.account && <><dt>{t.account}</dt><dd className="ivp-strong">{sup.account}</dd></>}
          {inv.method === 'bank' && iban && <><dt>{t.iban}</dt><dd>{ibanSpaced(iban)}</dd></>}
          {inv.method === 'bank' && sup.swift && <><dt>{t.swift}</dt><dd>{sup.swift}</dd></>}
          {inv.vs && <><dt>{t.vs}</dt><dd className="ivp-strong">{inv.vs}</dd></>}
          <dt>{t.method}</dt><dd>{t.methods[inv.method]}</dd>
          {inv.orderNo && <><dt>{t.order}</dt><dd>{inv.orderNo}</dd></>}
        </dl>
        <dl>
          <dt>{t.issued}</dt><dd>{fmtDate(inv.issued)}</dd>
          {vatPayer && <><dt>{t.taxable}</dt><dd>{fmtDate(inv.taxable)}</dd></>}
          <dt>{t.due}</dt><dd className="ivp-strong">{fmtDate(inv.due)}</dd>
        </dl>
      </div>
      {inv.noteBefore && <p className="ivp-note">{inv.noteBefore}</p>}
      <table className="ivp-lines">
        <thead>
          <tr>
            <th>{t.item}</th>
            <th className="is-n">{t.qty}</th>
            <th className="is-n">{t.price}</th>
            {vatPayer && <th className="is-n">{t.vatRate}</th>}
            {vatPayer && <th className="is-n">{t.base}</th>}
            <th className="is-n">{vatPayer ? `${t.total} s DPH` : t.total}</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l) => {
            const base = (Number(l.qty) || 0) * (Number(l.price) || 0)
            const withVat = vatPayer ? base * (1 + (Number(l.vat) || 0) / 100) : base
            return (
              <tr key={l.id}>
                <td>{l.name}</td>
                <td className="is-n">{String(l.qty).replace('.', ',')} {l.unit}</td>
                <td className="is-n">{money(Number(l.price) || 0, cur)}</td>
                {vatPayer && <td className="is-n">{Number(l.vat) || 0} %</td>}
                {vatPayer && <td className="is-n">{money(base, cur)}</td>}
                <td className="is-n">{money(withVat, cur)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="ivp-foot">
        <div className="ivp-qr">
          {qr && inv.method === 'bank' && (
            <>
              <svg viewBox={`0 0 ${qr.size} ${qr.size}`} width="132" height="132" shapeRendering="crispEdges" role="img" aria-label={t.qr}>
                <rect width={qr.size} height={qr.size} fill="#fff" /><path d={qr.d} fill="#000" />
              </svg>
              <span className="ivp-k">{t.qr}</span>
            </>
          )}
        </div>
        <div className="ivp-sum">
          {vatPayer && tot.byRate.map((r) => (
            <div className="ivp-sumrow" key={r.rate}><span>{t.summaryBase} {r.rate} %</span><span>{money(r.base, cur)}</span><span>{t.vat} {money(r.vat, cur)}</span></div>
          ))}
          <div className="ivp-total"><span>{t.toPay}</span><b>{money(tot.total, cur)}</b></div>
          {inv.status === 'paid' && <span className="ivp-paid">{t.paid} {fmtDate(inv.paidOn)}</span>}
        </div>
      </div>
      {inv.noteAfter && <p className="ivp-note">{inv.noteAfter}</p>}
      <footer className="ivp-legal">
        {!vatPayer && <span>{t.noVat}</span>}
        {sup.regNote && <span>{sup.regNote}</span>}
        {inv.footer && <span>{inv.footer}</span>}
        {(sup.phone || sup.email || sup.web) && <span className="ivp-contact">{[sup.phone, sup.email, sup.web].filter(Boolean).map((x) => <span key={x}>{x}</span>)}</span>}
      </footer>
    </article>
  )
}

function supplierOf(p: Omit<InvoiceProfile, 'id' | 'updatedAt'>): Invoice['supplier'] {
  return {
    ...partyOf(p), account: p.account, iban: p.iban || czIban(p.account ?? '') || undefined, swift: p.swift,
    vatPayer: p.vatPayer, regNote: p.regNote,
  }
}
