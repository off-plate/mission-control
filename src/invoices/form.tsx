import { useState, type ReactNode } from 'react'
import { useStore } from '../store'
import { Sheet } from '../modals'
import { Segmented, Select } from '../ui'
import * as Icon from '../icons'
import {
    DEFAULT_PROFILE, accountsOf, addDays, pickAccount, czIban, daysBetween, ibanSpaced, isoDay, money, nextNumber, totals, vsFromNumber
} from '../invoicecalc'
import type { BankAccount, Invoice, InvoiceCurrency, InvoiceLang, InvoiceLine, InvoiceProfile } from '../types'
import type { InvoiceDraft } from '../store/invoices'
import { CURRENCIES, METHODS, fmtDate, partyOf, plural } from './shared'
import { ContactSheet } from './contacts'
import { FitPaper } from './paper'

export const LANGS: { value: InvoiceLang; label: string }[] = [{ value: 'cs', label: 'Czech' }, { value: 'en', label: 'English' }]

export const DUE_PRESETS = [0, 7, 10, 14, 21, 30, 60]

export const lineId = () => `ln-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/* ---------- the form: Fakturoid's, labels on the left, one Create at the end ---------- */

export function InvoiceForm({ id, copyOf, clientId, onDone }: { id?: string; copyOf?: string; clientId?: string; onDone: (id?: string) => void }) {
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

export function FRow({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <div className={`iv-frow${error ? ' has-err' : ''}`}>
      <span className="iv-flab">{label}</span>
      <div className="iv-fctl">{children}{error && <p className="iv-err">{error}</p>}</div>
    </div>
  )
}

export function supplierOf(p: Omit<InvoiceProfile, 'id' | 'updatedAt'>, a?: BankAccount): Invoice['supplier'] {
  return {
    ...partyOf(p), account: a?.account, iban: a?.iban || czIban(a?.account ?? '') || undefined, swift: a?.swift,
    vatPayer: p.vatPayer, regNote: p.regNote,
  }
}
