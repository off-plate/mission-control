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
import { useEffect, useState } from 'react'
import { useStore } from './store'
import * as Icon from './icons'
import { Filter } from './invoices/shared'
import { InvoiceList, Overview, Statistics } from './invoices/lists'
import { InvoiceDetail } from './invoices/detail'
import { InvoiceForm } from './invoices/form'
import { ContactDetail, ContactList, ContactSheet, SettingsForm } from './invoices/contacts'
export { PdfSheet } from './invoices/detail'
export { InvoicePaper } from './invoices/paper'

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
