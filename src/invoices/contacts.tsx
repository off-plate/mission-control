import { useState } from 'react'
import { useStore } from '../store'
import { Sheet } from '../modals'
import { Dropdown, Segmented, Select } from '../ui'
import * as Icon from '../icons'
import {
    DEFAULT_PROFILE, accountsOf, addDays, czIban, daysBetween, ibanSpaced, invoiceTotal, isoDay, money, nextNumber
} from '../invoicecalc'
import type { BankAccount, InvoiceParty, InvoiceProfile } from '../types'
import type { InvoiceClientDraft } from '../store/invoices'
import { CURRENCIES, IconAction, QUIET_DAYS, fmtDate, fold, inFilter, periodBuckets, plural, sumText } from './shared'
import { BarChart, InvoiceRows } from './lists'

/* ---------- contacts: Fakturoid's A to Z list and contact page ---------- */

export function ContactList({ onOpen, onAdd }: { onOpen: (id: string) => void; onAdd: () => void }) {
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

export function ContactDetail({ id, onBack, onEdit, onOpen, onNew }: { id: string; onBack: () => void; onEdit: () => void; onOpen: (id: string) => void; onNew: (cid: string) => void }) {
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

export const EMPTY_CONTACT: InvoiceClientDraft = { name: '', ico: '', dic: '', street: '', city: '', zip: '', country: 'Česká republika', email: '', phone: '', web: '', note: '' }

export function ContactSheet({ id, onClose, onSaved }: { id?: string; onClose: () => void; onSaved: (id: string, c: InvoiceClientDraft) => void }) {
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
export function PartyFields({ value, onChange }: { value: InvoiceParty; onChange: (p: Partial<InvoiceParty>) => void }) {
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

export function SettingsForm() {
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

export type AresHit = Pick<InvoiceParty, 'name' | 'dic' | 'street' | 'city' | 'zip' | 'country'>

export async function aresLookup(ico: string): Promise<AresHit> {
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
