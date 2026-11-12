import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { Sheet } from '../modals'
import { Dropdown } from '../ui'
import * as Icon from '../icons'
import { daysBetween, ibanSpaced, invoiceTotal, isoDay, money, shownStatus, totals } from '../invoicecalc'
import type { Invoice } from '../types'
import { IconAction, METHODS, fmtDate, plural } from './shared'
import { FitPaper, InvoicePaper } from './paper'

/* ---------- one invoice: Fakturoid's page, the app's own view of it ---------- */

export function InvoiceDetail({ id, onBack, onEdit, onCopy, onContact }: {
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
      {createPortal(
        /* The table is only there to repeat a top and bottom gap on every printed page: the page itself has
           no margin (the print dialog's "Margins" setting can override @page, "None" is a common choice), so
           the sheet carries its own. */
        <div className="iv-print-root">
          <table className="iv-print-table">
            <thead><tr><td className="iv-print-gap" /></tr></thead>
            <tbody><tr><td><InvoicePaper inv={inv} /></td></tr></tbody>
            <tfoot><tr><td className="iv-print-gap" /></tr></tfoot>
          </table>
        </div>,
        document.body,
      )}
    </>
  )
}

export function PaymentSheet({ inv, onClose, onPaid }: { inv: Invoice; onClose: () => void; onPaid: (day: string) => void }) {
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
