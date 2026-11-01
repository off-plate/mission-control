/* INVOICES (2026-11-01, his ask): Fakturoid's core, rebuilt here so invoicing
   lives next to everything else. Reached from the header, beside Ideas.

   Four faces on one page: Overview (what came in, what is waiting, what is
   late), Invoices (the list, an invoice, the editor), Contacts (who he bills,
   with an ARES lookup by IČO), Settings (his own details, the supplier on every
   invoice). The printed invoice is an A4 sheet in the Czech layout with a QR
   Platba square; "Print or PDF" goes through the browser's own dialog.

   Stored in the app state like Prospects: three synced lists, offline first,
   merged by row, deletions buried and undoable. An invoice carries a copy of
   both parties, so editing a contact later never rewrites one already sent. */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useStore } from './store'
import { Sheet } from './modals'
import { Chip, Segmented, Select } from './ui'
import * as Icon from './icons'
import { qrMatrix, qrSvgPath } from './qr'
import {
  DEFAULT_PROFILE, STATUS_LABEL, addDays, czIban, daysBetween, ibanSpaced, invoiceTotal, isoDay, money, nextNumber,
  shownStatus, spayd, totals, vsFromNumber, type ShownStatus,
} from './invoicecalc'
import type {
  Invoice, InvoiceCurrency, InvoiceLang, InvoiceLine, InvoiceParty, InvoiceProfile, PaymentMethod,
} from './types'
import type { InvoiceClientDraft, InvoiceDraft } from './store/invoices'

type Tab = 'overview' | 'invoices' | 'contacts' | 'settings'
type View = { kind: 'list' } | { kind: 'invoice'; id: string } | { kind: 'edit'; id?: string; copyOf?: string; clientId?: string }

const TAB_KEY = 'mc-invoices-tab'
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'invoices', label: 'Invoices' },
  { id: 'contacts', label: 'Contacts' }, { id: 'settings', label: 'Settings' },
]
const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'bank', label: 'Bank transfer' }, { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' }, { value: 'cod', label: 'Cash on delivery' },
]
const CURRENCIES: { value: InvoiceCurrency; label: string }[] = [
  { value: 'CZK', label: 'CZK' }, { value: 'EUR', label: 'EUR' }, { value: 'USD', label: 'USD' },
]
const LANGS: { value: InvoiceLang; label: string }[] = [{ value: 'cs', label: 'Czech' }, { value: 'en', label: 'English' }]
const TONE: Record<ShownStatus, 'info' | 'accent' | 'alert' | 'progress' | 'quiet'> = {
  open: 'info', sent: 'accent', overdue: 'alert', paid: 'progress', cancelled: 'quiet',
}

const fmtDate = (iso?: string) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('cs-CZ') : '')
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const lineId = () => `ln-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const partyOf = (c: InvoiceParty): InvoiceParty => ({
  name: c.name, ico: c.ico, dic: c.dic, street: c.street, city: c.city, zip: c.zip, country: c.country, email: c.email, phone: c.phone, web: c.web,
})

/** Sums per currency, CZK first: "12 500,00 Kč + 400,00 €". */
function sumText(rows: Invoice[], pick: (i: Invoice) => number = invoiceTotal): string {
  const by = new Map<InvoiceCurrency, number>()
  for (const i of rows) by.set(i.currency, (by.get(i.currency) ?? 0) + pick(i))
  if (!by.size) return money(0, 'CZK', 0)
  return [...by.entries()].sort(([a], [b]) => (a === 'CZK' ? -1 : b === 'CZK' ? 1 : a.localeCompare(b)))
    .map(([c, n]) => money(n, c, 0)).join(' + ')
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

/* ---------- the page ---------- */

export function InvoicesPage() {
  const { invoices, invoiceSupplier } = useStore()
  const [tab, setTabRaw] = useState<Tab>(() => {
    try { const t = localStorage.getItem(TAB_KEY) as Tab | null; return t && TABS.some((x) => x.id === t) ? t : 'overview' } catch { return 'overview' }
  })
  const [view, setView] = useState<View>({ kind: 'list' })
  const [contactOpen, setContactOpen] = useState<{ id?: string } | null>(null)
  const setTab = (t: Tab) => { setTabRaw(t); setView({ kind: 'list' }); try { localStorage.setItem(TAB_KEY, t) } catch { /* private mode */ } }
  const openInvoice = (id: string) => { setTabRaw('invoices'); setView({ kind: 'invoice', id }) }
  const newInvoice = (clientId?: string) => { setTabRaw('invoices'); setView({ kind: 'edit', clientId }) }
  useEffect(() => { window.scrollTo({ top: 0 }) }, [tab, view])

  const editing = view.kind === 'edit'
  const viewing = view.kind === 'invoice' ? invoices.find((i) => i.id === view.id) : undefined

  return (
    <div className="pp-page pr-page iv-page">
      <div className="pr-bar iv-toolbar" role="toolbar" aria-label="Invoices">
        <h1 className="pp-h1">Invoices</h1>
        <Segmented size="sm" label="Section" value={tab} onPick={setTab} options={TABS} />
        {tab === 'contacts'
          ? <button className="btn btn-primary pp-add" type="button" onClick={() => setContactOpen({})}><Icon.Plus size={14} />Add contact</button>
          : tab !== 'settings' && !editing && (
            <button className="btn btn-primary pp-add" type="button" onClick={() => newInvoice()}><Icon.Plus size={14} />New invoice</button>
          )}
      </div>

      {!invoiceSupplier?.name && tab !== 'settings' && (
        <div className="iv-notice">
          <p>Your own details go on every invoice: name, IČO, address and bank account.</p>
          <button className="btn btn-quiet" type="button" onClick={() => setTab('settings')}>Add your details</button>
        </div>
      )}

      {tab === 'overview' && <Overview onOpen={openInvoice} />}
      {tab === 'invoices' && view.kind === 'list' && <InvoiceList onOpen={openInvoice} onNew={() => newInvoice()} />}
      {tab === 'invoices' && view.kind === 'invoice' && (viewing
        ? <InvoiceView inv={viewing} onBack={() => setView({ kind: 'list' })} onEdit={() => setView({ kind: 'edit', id: viewing.id })}
            onCopy={() => setView({ kind: 'edit', copyOf: viewing.id })} />
        : <div className="pr-empty"><p>This invoice was deleted.</p><button className="btn btn-quiet" type="button" onClick={() => setView({ kind: 'list' })}>Back to invoices</button></div>)}
      {tab === 'invoices' && view.kind === 'edit' && (
        <InvoiceEditor
          key={`${view.id ?? ''}${view.copyOf ?? ''}${view.clientId ?? ''}`}
          id={view.id} copyOf={view.copyOf} clientId={view.clientId}
          onDone={(id) => setView(id ? { kind: 'invoice', id } : { kind: 'list' })}
        />
      )}
      {tab === 'contacts' && <ContactList onOpen={(id) => setContactOpen({ id })} onAdd={() => setContactOpen({})} />}
      {tab === 'settings' && <SettingsForm />}

      {contactOpen && (
        <ContactSheet
          id={contactOpen.id} onClose={() => setContactOpen(null)}
          onOpenInvoice={(id) => { setContactOpen(null); openInvoice(id) }}
          onNewInvoice={(cid) => { setContactOpen(null); newInvoice(cid) }}
        />
      )}
    </div>
  )
}

/* ---------- overview ---------- */

function Overview({ onOpen }: { onOpen: (id: string) => void }) {
  const { invoices, patchInvoice } = useStore()
  const today = isoDay()
  const thisYear = today.slice(0, 4)
  const years = [...new Set([thisYear, ...invoices.map((i) => i.issued.slice(0, 4))])].sort().reverse()
  const [year, setYear] = useState(thisYear)
  const live = invoices.filter((i) => i.status !== 'cancelled')
  const inYear = live.filter((i) => i.issued.startsWith(year))
  const paidInYear = live.filter((i) => i.status === 'paid' && (i.paidOn ?? i.issued).startsWith(year))
  const waiting = live.filter((i) => i.status !== 'paid').sort((a, b) => a.due.localeCompare(b.due))
  const late = waiting.filter((i) => i.due < today)

  /* Months in CZK only: a bar mixing currencies would add euros to crowns. */
  const czk = (rows: Invoice[]) => rows.filter((i) => i.currency === 'CZK')
  const months = Array.from({ length: 12 }, (_, m) => {
    const key = `${year}-${String(m + 1).padStart(2, '0')}`
    return {
      key, label: new Date(Number(year), m, 1).toLocaleDateString('en-GB', { month: 'short' }),
      issued: czk(inYear).filter((i) => i.issued.startsWith(key)).reduce((s, i) => s + invoiceTotal(i), 0),
      paid: czk(paidInYear).filter((i) => (i.paidOn ?? i.issued).startsWith(key)).reduce((s, i) => s + invoiceTotal(i), 0),
    }
  })
  const top = Math.max(1, ...months.map((m) => Math.max(m.issued, m.paid)))
  const clients = [...inYear.reduce((m, i) => {
    const k = i.clientId ?? i.client.name
    const cur = m.get(k) ?? { name: i.client.name, rows: [] as Invoice[] }
    cur.rows.push(i); m.set(k, cur); return m
  }, new Map<string, { name: string; rows: Invoice[] }>()).values()]
    .map((c) => ({ ...c, sum: c.rows.reduce((s, i) => s + invoiceTotal(i), 0) }))
    .sort((a, b) => b.sum - a.sum).slice(0, 6)

  if (!invoices.length) {
    return <div className="pr-empty"><p>Nothing invoiced yet. Every invoice you create shows up here: what came in, what is waiting, and what is late.</p></div>
  }

  return (
    <div className="iv-overview">
      <div className="iv-yearrow">
        <Select className="pp-dd iv-year" ariaLabel="Year" value={year} onChange={setYear} options={years.map((y) => ({ value: y, label: y }))} />
      </div>
      <div className="iv-tiles">
        <Tile k={`Invoiced in ${year}`} v={sumText(inYear)} n={`${inYear.length} ${inYear.length === 1 ? 'invoice' : 'invoices'}`} />
        <Tile k={`Paid in ${year}`} v={sumText(paidInYear)} n={`${paidInYear.length} paid`} tone="pos" />
        <Tile k="Waiting for payment" v={sumText(waiting)} n={`${waiting.length} unpaid`} />
        <Tile k="Overdue" v={late.length ? sumText(late) : 'None'} n={late.length ? `${late.length} late` : 'Nothing late'} tone={late.length ? 'urgent' : undefined} />
      </div>

      <section className="iv-card">
        <div className="iv-card-head"><h2>Month by month</h2><span className="iv-legend"><i className="is-issued" />Invoiced<i className="is-paid" />Paid</span></div>
        <div className="iv-bars" role="img" aria-label={`Invoiced and paid per month in ${year}, CZK`}>
          {months.map((m) => (
            <div className="iv-bar-col" key={m.key} title={`${m.label}: invoiced ${money(m.issued, 'CZK', 0)}, paid ${money(m.paid, 'CZK', 0)}`}>
              <div className="iv-bar-pair">
                <span className="iv-bar is-issued" style={{ height: `${(m.issued / top) * 100}%` }} />
                <span className="iv-bar is-paid" style={{ height: `${(m.paid / top) * 100}%` }} />
              </div>
              <span className="iv-bar-k">{m.label}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="iv-two">
        <section className="iv-card">
          <div className="iv-card-head"><h2>Waiting for payment</h2><span className="mono">{waiting.length}</span></div>
          {waiting.length === 0 ? <p className="iv-quiet">Everything is paid.</p> : (
            <ul className="iv-rows">
              {waiting.slice(0, 8).map((i) => {
                const d = daysBetween(today, i.due)
                return (
                  <li key={i.id}>
                    <button type="button" className="iv-row-main" onClick={() => onOpen(i.id)}>
                      <b>{i.client.name || 'No client'}</b>
                      <span className="mono">{i.number}</span>
                      <span className={d < 0 ? 'iv-late' : 'iv-quiet'}>{d < 0 ? `${-d} ${d === -1 ? 'day' : 'days'} late` : d === 0 ? 'Due today' : `Due in ${d} ${d === 1 ? 'day' : 'days'}`}</span>
                    </button>
                    <span className="mono iv-amt">{money(invoiceTotal(i), i.currency)}</span>
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => patchInvoice(i.id, { status: 'paid', paidOn: today })}>Paid</button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
        <section className="iv-card">
          <div className="iv-card-head"><h2>Top clients in {year}</h2></div>
          {clients.length === 0 ? <p className="iv-quiet">No invoices in {year}.</p> : (
            <ul className="iv-rows">
              {clients.map((c) => (
                <li key={c.name}>
                  <span className="iv-row-main is-static"><b>{c.name}</b><span className="iv-quiet">{c.rows.length} {c.rows.length === 1 ? 'invoice' : 'invoices'}</span></span>
                  <span className="mono iv-amt">{sumText(c.rows)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function Tile({ k, v, n, tone }: { k: string; v: string; n: string; tone?: 'pos' | 'urgent' }) {
  return (
    <div className={`iv-tile${tone ? ` is-${tone}` : ''}`}>
      <span className="iv-tile-k">{k}</span>
      <span className="iv-tile-v">{v}</span>
      <span className="iv-tile-n">{n}</span>
    </div>
  )
}

/* ---------- list ---------- */

function InvoiceList({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const { invoices } = useStore()
  const today = isoDay()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<ShownStatus | ''>('')
  const [year, setYear] = useState('')
  const years = [...new Set(invoices.map((i) => i.issued.slice(0, 4)))].sort().reverse()
  const shown = invoices
    .filter((i) => !status || shownStatus(i, today) === status)
    .filter((i) => !year || i.issued.startsWith(year))
    .filter((i) => !q.trim() || fold(q.trim()).split(/\s+/).every((w) => fold([i.number, i.client.name, i.client.ico, ...i.lines.map((l) => l.name)].join(' ')).includes(w)))
    .sort((a, b) => b.issued.localeCompare(a.issued) || b.number.localeCompare(a.number))
  const count = (s: ShownStatus) => invoices.filter((i) => shownStatus(i, today) === s).length

  if (!invoices.length) {
    return (
      <div className="pr-empty">
        <p>Your invoices live here. Pick a contact, add what you did, and it is numbered, dated and ready to send as a PDF.</p>
        <button className="btn btn-primary" type="button" onClick={onNew}>Create the first invoice</button>
      </div>
    )
  }
  return (
    <>
      <div className="iv-filters">
        <div className="pp-search">
          <Icon.Search size={14} />
          <input className="pp-search-input" type="search" value={q} placeholder="Search invoices" aria-label="Search invoices" onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select className="pp-dd pp-circle-pick" ariaLabel="Status" value={status} onChange={setStatus}
          options={[{ value: '' as const, label: `All statuses (${invoices.length})` }, ...(Object.keys(STATUS_LABEL) as ShownStatus[]).map((s) => ({ value: s, label: `${STATUS_LABEL[s]} (${count(s)})` }))]} />
        {years.length > 1 && (
          <Select className="pp-dd pp-circle-pick" ariaLabel="Year" value={year} onChange={setYear}
            options={[{ value: '', label: 'All years' }, ...years.map((y) => ({ value: y, label: y }))]} />
        )}
        <span className="iv-filter-sum mono">{sumText(shown.filter((i) => i.status !== 'cancelled'))}</span>
      </div>
      {shown.length === 0 ? (
        <div className="pr-empty"><p>Nothing matches these filters.</p><button className="btn btn-quiet" type="button" onClick={() => { setQ(''); setStatus(''); setYear('') }}>Clear filters</button></div>
      ) : (
        <div className="pr-sheetwrap iv-sheetwrap">
          <table className="pr-grid iv-grid">
            <thead>
              <tr>
                <th scope="col" className="iv-c-num">Number</th>
                <th scope="col">Client</th>
                <th scope="col">Issued</th>
                <th scope="col">Due</th>
                <th scope="col" className="is-n">Amount</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => {
                const s = shownStatus(i, today)
                return (
                  <tr key={i.id} onClick={() => onOpen(i.id)}>
                    <th scope="row" className="iv-c-num"><button type="button" onClick={(e) => { e.stopPropagation(); onOpen(i.id) }}>{i.number}</button></th>
                    <td title={i.client.name}>{i.client.name}</td>
                    <td className="mono">{fmtDate(i.issued)}</td>
                    <td className="mono">{fmtDate(i.due)}</td>
                    <td className="is-n">{money(invoiceTotal(i), i.currency)}</td>
                    <td><Chip tone={TONE[s]}>{STATUS_LABEL[s]}{s === 'paid' && i.paidOn ? ` ${fmtDate(i.paidOn)}` : ''}</Chip></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/* ---------- one invoice ---------- */

function InvoiceView({ inv, onBack, onEdit, onCopy }: { inv: Invoice; onBack: () => void; onEdit: () => void; onCopy: () => void }) {
  const { patchInvoice, deleteInvoice } = useStore()
  const today = isoDay()
  const s = shownStatus(inv, today)
  const [paidOn, setPaidOn] = useState(today)
  const [armed, setArmed] = useState(false)

  const print = () => {
    const was = document.title
    document.title = `${inv.lang === 'en' ? 'Invoice' : 'Faktura'} ${inv.number}`
    document.body.classList.add('iv-printing')
    const done = () => { document.title = was; document.body.classList.remove('iv-printing'); window.removeEventListener('afterprint', done) }
    window.addEventListener('afterprint', done)
    window.print()
  }

  return (
    <div className="iv-view">
      <div className="iv-actions" role="toolbar" aria-label="Invoice actions">
        <button className="btn btn-ghost" type="button" onClick={onBack}><Icon.ChevronLeft size={14} />Invoices</button>
        <Chip tone={TONE[s]}>{STATUS_LABEL[s]}{s === 'paid' && inv.paidOn ? ` ${fmtDate(inv.paidOn)}` : ''}{inv.status === 'sent' && inv.sentOn && s !== 'paid' ? `, sent ${fmtDate(inv.sentOn)}` : ''}</Chip>
        <span className="iv-actions-gap" />
        {inv.status === 'open' && <button className="btn btn-quiet" type="button" onClick={() => patchInvoice(inv.id, { status: 'sent', sentOn: today })}>Mark as sent</button>}
        {inv.status !== 'paid' && inv.status !== 'cancelled' && (
          <span className="iv-paybox">
            <input className="pp-text pp-date" type="date" value={paidOn} aria-label="Paid on" onChange={(e) => setPaidOn(e.target.value)} />
            <button className="btn btn-primary" type="button" onClick={() => patchInvoice(inv.id, { status: 'paid', paidOn: paidOn || today })}>Mark as paid</button>
          </span>
        )}
        {inv.status === 'paid' && <button className="btn btn-quiet" type="button" onClick={() => patchInvoice(inv.id, { status: inv.sentOn ? 'sent' : 'open', paidOn: undefined })}>Mark as unpaid</button>}
        <button className="btn btn-quiet" type="button" onClick={print}>Print or PDF</button>
        <button className="btn btn-quiet" type="button" onClick={onEdit}><Icon.Edit size={14} />Edit</button>
        <button className="btn btn-quiet" type="button" onClick={onCopy}><Icon.Copy size={14} />Duplicate</button>
        {inv.status === 'cancelled'
          ? <button className="btn btn-quiet" type="button" onClick={() => patchInvoice(inv.id, { status: inv.paidOn ? 'paid' : inv.sentOn ? 'sent' : 'open' })}>Restore</button>
          : <button className="btn btn-quiet" type="button" onClick={() => patchInvoice(inv.id, { status: 'cancelled' })}>Cancel invoice</button>}
        <button className={`pp-danger${armed ? ' is-armed' : ''}`} type="button" onBlur={() => setArmed(false)}
          onClick={() => { if (armed) { deleteInvoice(inv.id); onBack() } else setArmed(true) }}>
          {armed ? 'Delete for good?' : 'Delete'}
        </button>
      </div>
      <div className="iv-paperwrap"><InvoicePaper inv={inv} /></div>
    </div>
  )
}

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

/* ---------- the editor ---------- */

function InvoiceEditor({ id, copyOf, clientId, onDone }: { id?: string; copyOf?: string; clientId?: string; onDone: (id?: string) => void }) {
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
  const [newContact, setNewContact] = useState(false)
  const [tried, setTried] = useState(false)
  const set = <K extends keyof InvoiceDraft>(k: K, v: InvoiceDraft[K]) => setD((p) => ({ ...p, [k]: v }))
  const setLine = (lid: string, patch: Partial<InvoiceLine>) => setD((p) => ({ ...p, lines: p.lines.map((l) => (l.id === lid ? { ...l, ...patch } : l)) }))
  const dueDays = daysBetween(d.issued, d.due)
  const vatPayer = existing ? d.supplier.vatPayer : profile.vatPayer
  const tot = totals(d.lines, vatPayer)

  const clash = invoices.some((i) => i.number === d.number.trim() && i.id !== id)
  const problems = [
    !d.client.name.trim() && 'Pick who the invoice is for.',
    !d.number.trim() && 'The invoice needs a number.',
    clash && `Number ${d.number} is already used.`,
    !d.lines.some((l) => l.name.trim()) && 'Add at least one item.',
    d.due < d.issued && 'The due date is before the issue date.',
  ].filter(Boolean) as string[]

  const pickClient = (cid: string) => {
    const c = invoiceClients.find((x) => x.id === cid)
    if (!c) return
    setD((p) => ({ ...p, clientId: c.id, client: partyOf(c), due: c.dueDays != null ? addDays(p.issued, c.dueDays) : p.due }))
  }
  const save = () => {
    setTried(true)
    if (problems.length) return
    const clean: InvoiceDraft = {
      ...d, number: d.number.trim(),
      lines: d.lines.filter((l) => l.name.trim()).map((l) => ({ ...l, name: l.name.trim(), qty: Number(l.qty) || 0, price: Number(l.price) || 0, vat: Number(l.vat) || 0 })),
      /* Re-saving takes his current details, except on an invoice already
         sent or paid: that one stays exactly as the customer received it. */
      supplier: existing && existing.status !== 'open' ? existing.supplier : supplierOf(profile),
      ...(existing ? { id: existing.id } : {}),
    }
    onDone(saveInvoice(clean))
  }

  return (
    <div className="iv-editor">
      <div className="iv-actions">
        <button className="btn btn-ghost" type="button" onClick={() => onDone(existing?.id)}><Icon.ChevronLeft size={14} />{existing ? 'Back' : 'Invoices'}</button>
        <h2 className="iv-edit-title">{existing ? `Edit ${existing.number}` : copyOf ? 'Duplicate invoice' : 'New invoice'}</h2>
        <span className="iv-actions-gap" />
        <button className="btn btn-quiet" type="button" onClick={() => onDone(existing?.id)}>Discard</button>
        <button className="btn btn-primary" type="button" onClick={save}>Save invoice</button>
      </div>
      {!invoiceSupplier?.name && <p className="iv-warn">Your own details are empty, so the supplier on this invoice will be blank. Fill them in under Settings.</p>}
      {tried && problems.length > 0 && <ul className="iv-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}

      <div className="iv-form">
        <section className="iv-card">
          <div className="iv-card-head"><h2>Customer</h2></div>
          <div className="iv-client-row">
            <Select
              className="pp-dd" ariaLabel="Customer" value={d.clientId ?? ''}
              onChange={(v) => { if (v === '__new') setNewContact(true); else pickClient(v) }}
              options={[
                { value: '', label: invoiceClients.length ? 'Pick a contact' : 'No contacts yet' },
                ...[...invoiceClients].sort((a, b) => a.name.localeCompare(b.name, 'cs')).map((c) => ({ value: c.id, label: c.name })),
                { value: '__new', label: 'New contact...' },
              ]}
            />
          </div>
          {d.client.name && (
            <div className="iv-client-card">
              <b>{d.client.name}</b>
              <span>{[d.client.street, [d.client.zip, d.client.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</span>
              {(d.client.ico || d.client.dic) && <span className="mono">{[d.client.ico && `IČO ${d.client.ico}`, d.client.dic && `DIČ ${d.client.dic}`].filter(Boolean).join('   ')}</span>}
            </div>
          )}
        </section>

        <section className="iv-card">
          <div className="iv-card-head"><h2>Details</h2></div>
          <div className="iv-grid3">
            <Field label="Number"><input className="pp-text" value={d.number} onChange={(e) => setD((p) => ({ ...p, number: e.target.value, vs: p.vs === vsFromNumber(p.number) ? vsFromNumber(e.target.value) : p.vs }))} /></Field>
            <Field label="Issued"><input className="pp-text" type="date" value={d.issued} onChange={(e) => { const v = e.target.value; if (v) setD((p) => ({ ...p, issued: v, taxable: p.taxable === p.issued ? v : p.taxable, due: addDays(v, daysBetween(p.issued, p.due)) })) }} /></Field>
            <Field label="Due in days"><input className="pp-text" type="number" min={0} value={dueDays} onChange={(e) => set('due', addDays(d.issued, Math.max(0, Number(e.target.value) || 0)))} /></Field>
            <Field label="Due date"><input className="pp-text" type="date" value={d.due} onChange={(e) => e.target.value && set('due', e.target.value)} /></Field>
            {vatPayer && <Field label="Taxable supply date"><input className="pp-text" type="date" value={d.taxable} onChange={(e) => e.target.value && set('taxable', e.target.value)} /></Field>}
            <Field label="Payment"><Select className="pp-dd" ariaLabel="Payment" value={d.method} onChange={(v) => set('method', v)} options={METHODS} /></Field>
            <Field label="Currency"><Select className="pp-dd" ariaLabel="Currency" value={d.currency} onChange={(v) => set('currency', v)} options={CURRENCIES} /></Field>
            <Field label="Language"><Select className="pp-dd" ariaLabel="Language" value={d.lang} onChange={(v) => set('lang', v)} options={LANGS} /></Field>
            <Field label="Variable symbol"><input className="pp-text" inputMode="numeric" value={d.vs} onChange={(e) => set('vs', e.target.value.replace(/\D/g, '').slice(0, 10))} /></Field>
            <Field label="Order number"><input className="pp-text" value={d.orderNo ?? ''} onChange={(e) => set('orderNo', e.target.value)} /></Field>
          </div>
        </section>

        <section className="iv-card">
          <div className="iv-card-head"><h2>Items</h2><span className="mono">{d.lines.length}</span></div>
          <Field label="Text above the items"><textarea className="pp-text" rows={2} value={d.noteBefore ?? ''} onChange={(e) => set('noteBefore', e.target.value)} /></Field>
          <div className={`iv-lines${vatPayer ? ' has-vat' : ''}`}>
            <div className="iv-line is-head" aria-hidden="true">
              <span>Item</span><span>Qty</span><span>Unit</span><span>Unit price</span>{vatPayer && <span>VAT %</span>}<span className="is-n">Total</span><span />
            </div>
            {d.lines.map((l) => {
              const base = (Number(l.qty) || 0) * (Number(l.price) || 0)
              return (
                <div className="iv-line" key={l.id}>
                  <input className="pp-text" aria-label="Item" placeholder="What you did" value={l.name} onChange={(e) => setLine(l.id, { name: e.target.value })} />
                  <input className="pp-text" aria-label="Quantity" type="number" step="any" value={l.qty} onChange={(e) => setLine(l.id, { qty: e.target.value === '' ? ('' as unknown as number) : Number(e.target.value) })} />
                  <input className="pp-text" aria-label="Unit" placeholder="h, ks" value={l.unit} onChange={(e) => setLine(l.id, { unit: e.target.value })} />
                  <input className="pp-text" aria-label="Unit price" type="number" step="any" value={l.price} onChange={(e) => setLine(l.id, { price: e.target.value === '' ? ('' as unknown as number) : Number(e.target.value) })} />
                  {vatPayer && <Select className="pp-dd" ariaLabel="VAT rate" value={Number(l.vat) || 0} onChange={(v) => setLine(l.id, { vat: v })} options={[21, 12, 0].map((r) => ({ value: r, label: `${r} %` }))} />}
                  <span className="is-n mono iv-line-sum">{money(vatPayer ? base * (1 + (Number(l.vat) || 0) / 100) : base, d.currency)}</span>
                  <button className="pp-x" type="button" aria-label="Remove item" disabled={d.lines.length === 1}
                    onClick={() => setD((p) => ({ ...p, lines: p.lines.filter((x) => x.id !== l.id) }))}><Icon.Close size={14} /></button>
                </div>
              )
            })}
          </div>
          <button className="btn btn-quiet iv-addline" type="button"
            onClick={() => setD((p) => ({ ...p, lines: [...p.lines, { id: lineId(), name: '', qty: 1, unit: p.lines.at(-1)?.unit ?? '', price: 0, vat: p.lines.at(-1)?.vat ?? 21 }] }))}>
            <Icon.Plus size={14} />Add item
          </button>
          <div className="iv-totals">
            {vatPayer && <div><span>Without VAT</span><span className="mono">{money(tot.base, d.currency)}</span></div>}
            {vatPayer && <div><span>VAT</span><span className="mono">{money(tot.vat, d.currency)}</span></div>}
            <div className="is-total"><span>Total</span><span className="mono">{money(tot.total, d.currency)}</span></div>
          </div>
        </section>

        <section className="iv-card">
          <div className="iv-card-head"><h2>Notes</h2></div>
          <Field label="Text below the items"><textarea className="pp-text" rows={2} value={d.noteAfter ?? ''} onChange={(e) => set('noteAfter', e.target.value)} /></Field>
          <Field label="Footer"><input className="pp-text" value={d.footer ?? ''} onChange={(e) => set('footer', e.target.value)} /></Field>
        </section>
      </div>

      {newContact && (
        <ContactSheet
          onClose={() => setNewContact(false)}
          onSaved={(cid, c) => { setNewContact(false); setD((p) => ({ ...p, clientId: cid, client: partyOf(c), due: c.dueDays != null ? addDays(p.issued, c.dueDays) : p.due })) }}
        />
      )}
    </div>
  )
}

function supplierOf(p: Omit<InvoiceProfile, 'id' | 'updatedAt'>): Invoice['supplier'] {
  return {
    ...partyOf(p), account: p.account, iban: p.iban || czIban(p.account ?? '') || undefined, swift: p.swift,
    vatPayer: p.vatPayer, regNote: p.regNote,
  }
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={`pp-field iv-field${wide ? ' is-wide' : ''}`}><span>{label}</span>{children}</label>
}

/* ---------- contacts ---------- */

function ContactList({ onOpen, onAdd }: { onOpen: (id: string) => void; onAdd: () => void }) {
  const { invoiceClients, invoices } = useStore()
  const [q, setQ] = useState('')
  const rows = invoiceClients
    .filter((c) => !q.trim() || fold([c.name, c.ico, c.city, c.email].join(' ')).includes(fold(q.trim())))
    .sort((a, b) => a.name.localeCompare(b.name, 'cs'))
  if (!invoiceClients.length) {
    return (
      <div className="pr-empty">
        <p>Everyone you invoice. Type an IČO and the name and address come from ARES.</p>
        <button className="btn btn-primary" type="button" onClick={onAdd}>Add the first contact</button>
      </div>
    )
  }
  return (
    <>
      <div className="iv-filters">
        <div className="pp-search">
          <Icon.Search size={14} />
          <input className="pp-search-input" type="search" value={q} placeholder="Search contacts" aria-label="Search contacts" onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="pr-sheetwrap iv-sheetwrap">
        <table className="pr-grid iv-grid">
          <thead>
            <tr>
              <th scope="col" className="iv-c-num">Name</th>
              <th scope="col">IČO</th>
              <th scope="col">City</th>
              <th scope="col">Email</th>
              <th scope="col" className="is-n">Invoices</th>
              <th scope="col" className="is-n">Invoiced</th>
              <th scope="col" className="is-n">Unpaid</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const mine = invoices.filter((i) => i.clientId === c.id && i.status !== 'cancelled')
              const unpaid = mine.filter((i) => i.status !== 'paid')
              return (
                <tr key={c.id} onClick={() => onOpen(c.id)}>
                  <th scope="row" className="iv-c-num"><button type="button" onClick={(e) => { e.stopPropagation(); onOpen(c.id) }}>{c.name}</button></th>
                  <td className="mono">{c.ico}</td>
                  <td>{c.city}</td>
                  <td>{c.email}</td>
                  <td className="is-n">{mine.length}</td>
                  <td className="is-n">{mine.length ? sumText(mine) : ''}</td>
                  <td className="is-n">{unpaid.length ? sumText(unpaid) : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

const EMPTY_CONTACT: InvoiceClientDraft = { name: '', ico: '', dic: '', street: '', city: '', zip: '', country: 'Česká republika', email: '', phone: '', web: '', note: '' }

function ContactSheet({ id, onClose, onSaved, onOpenInvoice, onNewInvoice }: {
  id?: string
  onClose: () => void
  onSaved?: (id: string, c: InvoiceClientDraft) => void
  onOpenInvoice?: (id: string) => void
  onNewInvoice?: (clientId: string) => void
}) {
  const { invoiceClients, invoices, saveInvoiceClient, deleteInvoiceClient } = useStore()
  const existing = id ? invoiceClients.find((c) => c.id === id) : undefined
  const [c, setC] = useState<InvoiceClientDraft>(() => (existing ? { ...existing } : { ...EMPTY_CONTACT }))
  const [armed, setArmed] = useState(false)
  const theirs = existing ? invoices.filter((i) => i.clientId === existing.id).sort((a, b) => b.issued.localeCompare(a.issued)) : []
  const save = () => {
    if (!c.name.trim()) return
    const cid = saveInvoiceClient({ ...c, ...(existing ? { id: existing.id } : {}) })
    if (onSaved) onSaved(cid, c); else onClose()
  }
  return (
    <Sheet title={existing ? existing.name : 'New contact'} onClose={onClose}>
      <div className="iv-sheet">
        <PartyFields value={c} onChange={(p) => setC((x) => ({ ...x, ...p }))} />
        <div className="pp-row2">
          <Field label="Due in days (this client only)">
            <input className="pp-text" type="number" min={0} value={c.dueDays ?? ''} placeholder="Your default"
              onChange={(e) => setC((x) => ({ ...x, dueDays: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) }))} />
          </Field>
        </div>
        <Field label="Note"><textarea className="pp-text" rows={2} value={c.note ?? ''} onChange={(e) => setC((x) => ({ ...x, note: e.target.value }))} /></Field>
        <div className="pp-dialog-actions iv-sheet-actions">
          {existing && (
            <button className={`pp-danger${armed ? ' is-armed' : ''}`} type="button" onBlur={() => setArmed(false)}
              onClick={() => { if (armed) { deleteInvoiceClient(existing.id); onClose() } else setArmed(true) }}>
              {armed ? 'Delete for good?' : 'Delete contact'}
            </button>
          )}
          <span className="iv-actions-gap" />
          {existing && onNewInvoice && <button className="btn btn-quiet" type="button" onClick={() => { saveInvoiceClient({ ...c, id: existing.id }); onNewInvoice(existing.id) }}>New invoice</button>}
          <button className="btn btn-primary" type="button" disabled={!c.name.trim()} onClick={save}>Save contact</button>
        </div>
        {theirs.length > 0 && (
          <section className="iv-their">
            <h3>Invoices</h3>
            <ul className="iv-rows">
              {theirs.map((i) => {
                const s = shownStatus(i)
                return (
                  <li key={i.id}>
                    <button type="button" className="iv-row-main" onClick={() => onOpenInvoice?.(i.id)}>
                      <b className="mono">{i.number}</b><span className="iv-quiet">{fmtDate(i.issued)}</span>
                    </button>
                    <span className="mono iv-amt">{money(invoiceTotal(i), i.currency)}</span>
                    <Chip tone={TONE[s]}>{STATUS_LABEL[s]}</Chip>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </div>
    </Sheet>
  )
}

/** Name, IČO with the ARES button, DIČ, address, contact lines. Shared by a contact and his own details. */
function PartyFields({ value, onChange }: { value: InvoiceParty; onChange: (p: Partial<InvoiceParty>) => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const lookup = async () => {
    setBusy(true); setErr('')
    try { onChange(await aresLookup(value.ico ?? '')) } catch (e) { setErr(e instanceof Error ? e.message : 'ARES lookup failed.') }
    setBusy(false)
  }
  const f = (k: keyof InvoiceParty) => ({ value: value[k] ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange({ [k]: e.target.value }) })
  return (
    <div className="iv-party-fields">
      <div className="iv-ico-row">
        <Field label="IČO"><input className="pp-text" inputMode="numeric" {...f('ico')} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void lookup() } }} /></Field>
        <button className="btn btn-quiet" type="button" disabled={busy || !(value.ico ?? '').replace(/\D/g, '')} onClick={() => void lookup()}>{busy ? 'Loading...' : 'Fill from ARES'}</button>
      </div>
      {err && <p className="iv-err">{err}</p>}
      <Field label="Name"><input className="pp-text" {...f('name')} /></Field>
      <div className="pp-row2">
        <Field label="DIČ"><input className="pp-text" {...f('dic')} /></Field>
        <Field label="Email"><input className="pp-text" type="email" {...f('email')} /></Field>
      </div>
      <Field label="Street"><input className="pp-text" {...f('street')} /></Field>
      <div className="iv-zip-row">
        <Field label="ZIP"><input className="pp-text" {...f('zip')} /></Field>
        <Field label="City"><input className="pp-text" {...f('city')} /></Field>
      </div>
      <div className="pp-row2">
        <Field label="Country"><input className="pp-text" {...f('country')} /></Field>
        <Field label="Phone"><input className="pp-text" type="tel" {...f('phone')} /></Field>
      </div>
    </div>
  )
}

/* ---------- settings ---------- */

function SettingsForm() {
  const { invoiceSupplier, saveInvoiceProfile, invoices } = useStore()
  const [p, setP] = useState<Omit<InvoiceProfile, 'id' | 'updatedAt'>>(() => ({ ...DEFAULT_PROFILE, ...(invoiceSupplier ?? {}) }))
  const [saved, setSaved] = useState(false)
  const set = (patch: Partial<InvoiceProfile>) => { setP((x) => ({ ...x, ...patch })); setSaved(false) }
  const autoIban = czIban(p.account ?? '')
  const today = isoDay()
  return (
    <div className="iv-form iv-settings">
      <section className="iv-card">
        <div className="iv-card-head"><h2>Your details</h2></div>
        <PartyFields value={p} onChange={set} />
        <Field label="Website"><input className="pp-text" value={p.web ?? ''} onChange={(e) => set({ web: e.target.value })} /></Field>
      </section>
      <section className="iv-card">
        <div className="iv-card-head"><h2>Bank</h2></div>
        <Field label="Account number"><input className="pp-text" placeholder="123456789/0800" value={p.account ?? ''} onChange={(e) => set({ account: e.target.value })} /></Field>
        <div className="pp-row2">
          <Field label="IBAN"><input className="pp-text" placeholder={autoIban ? ibanSpaced(autoIban) : ''} value={p.iban ?? ''} onChange={(e) => set({ iban: e.target.value })} /></Field>
          <Field label="SWIFT"><input className="pp-text" value={p.swift ?? ''} onChange={(e) => set({ swift: e.target.value })} /></Field>
        </div>
        {autoIban && !p.iban && <p className="iv-quiet">IBAN worked out from the account number: {ibanSpaced(autoIban)}. It goes into the QR payment code.</p>}
      </section>
      <section className="iv-card">
        <div className="iv-card-head"><h2>Invoices</h2></div>
        <Segmented size="sm" label="VAT" value={p.vatPayer ? 'yes' : 'no'} onPick={(v) => set({ vatPayer: v === 'yes' })}
          options={[{ id: 'no', label: 'Not a VAT payer' }, { id: 'yes', label: 'VAT payer' }]} />
        <div className="pp-row2">
          <Field label="Number format">
            <input className="pp-text" value={p.numberFormat} onChange={(e) => set({ numberFormat: e.target.value })} />
          </Field>
          <Field label="Due in days"><input className="pp-text" type="number" min={0} value={p.dueDays} onChange={(e) => set({ dueDays: Math.max(0, Number(e.target.value) || 0) })} /></Field>
        </div>
        <p className="iv-quiet">Next number: <b className="mono">{nextNumber(invoices, p.numberFormat, today)}</b>. YYYY is the year, MM the month, NNNN the counter.</p>
        <Field label="Register line"><input className="pp-text" value={p.regNote ?? ''} onChange={(e) => set({ regNote: e.target.value })} /></Field>
        <Field label="Default footer"><input className="pp-text" value={p.footer ?? ''} onChange={(e) => set({ footer: e.target.value })} /></Field>
      </section>
      <div className="iv-save-row">
        <button className="btn btn-primary" type="button" onClick={() => { saveInvoiceProfile(p); setSaved(true) }}>Save details</button>
        {saved && <span className="iv-saved" role="status">Saved. New invoices use these details.</span>}
      </div>
    </div>
  )
}

