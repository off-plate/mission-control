/* THE INVOICES' data: invoices, the contacts he bills, and his own supplier
   details as a one-row list (a list so it merges by row like everything else).
   Deleting buries the row like every other deletion. */
import { useState } from 'react'
import { rowKey } from '../sync-merge'
import type { Invoice, InvoiceClient, InvoiceProfile } from '../types'
import { newId } from './shared'

export type InvoiceDraft = Omit<Invoice, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
export type InvoiceClientDraft = Omit<InvoiceClient, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }

export interface InvoicesSlice {
  invoices: Invoice[]
  setInvoices: (next: Invoice[]) => void
  invoiceClients: InvoiceClient[]
  setInvoiceClients: (next: InvoiceClient[]) => void
  invoiceProfile: InvoiceProfile[]
  setInvoiceProfile: (next: InvoiceProfile[]) => void
  saveInvoice: (d: InvoiceDraft) => string
  patchInvoice: (id: string, patch: Partial<Omit<Invoice, 'id' | 'createdAt'>>) => void
  deleteInvoice: (id: string) => void
  saveInvoiceClient: (d: InvoiceClientDraft) => string
  deleteInvoiceClient: (id: string) => void
  saveInvoiceProfile: (p: Omit<InvoiceProfile, 'id' | 'updatedAt'>) => void
}

export function useInvoicesSlice(
  persisted: { invoices?: Invoice[]; invoiceClients?: InvoiceClient[]; invoiceProfile?: InvoiceProfile[] } | null,
  deps: { armUndo: (label: string, restore: () => void) => void; bury: (...keys: string[]) => void; digUp: (...keys: string[]) => void },
): InvoicesSlice {
  const { armUndo, bury, digUp } = deps
  const [invoices, setInvoices] = useState<Invoice[]>(persisted?.invoices ?? [])
  const [invoiceClients, setInvoiceClients] = useState<InvoiceClient[]>(persisted?.invoiceClients ?? [])
  const [invoiceProfile, setInvoiceProfile] = useState<InvoiceProfile[]>(persisted?.invoiceProfile ?? [])

  const saveInvoice = (d: InvoiceDraft): string => {
    const now = Date.now()
    const id = d.id ?? newId('inv')
    setInvoices((prev) => prev.some((i) => i.id === id)
      ? prev.map((i) => (i.id === id ? { ...i, ...d, id, updatedAt: now } : i))
      : [...prev, { ...d, id, createdAt: now, updatedAt: now }])
    return id
  }
  const patchInvoice = (id: string, patch: Partial<Omit<Invoice, 'id' | 'createdAt'>>): void =>
    setInvoices((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch, updatedAt: Date.now() } : i)))
  const deleteInvoice = (id: string): void => {
    const before = invoices
    const key = rowKey('invoices', { id })
    setInvoices((prev) => prev.filter((i) => i.id !== id))
    bury(key)
    armUndo('Invoice deleted', () => { setInvoices(before); digUp(key) })
  }

  const saveInvoiceClient = (d: InvoiceClientDraft): string => {
    const now = Date.now()
    const id = d.id ?? newId('ivc')
    const clean = { ...d, name: d.name.trim() }
    setInvoiceClients((prev) => prev.some((c) => c.id === id)
      ? prev.map((c) => (c.id === id ? { ...c, ...clean, id, updatedAt: now } : c))
      : [...prev, { ...clean, id, createdAt: now, updatedAt: now }])
    return id
  }
  const deleteInvoiceClient = (id: string): void => {
    const before = invoiceClients
    const key = rowKey('invoiceClients', { id })
    setInvoiceClients((prev) => prev.filter((c) => c.id !== id))
    bury(key)
    armUndo('Contact deleted', () => { setInvoiceClients(before); digUp(key) })
  }

  const saveInvoiceProfile = (p: Omit<InvoiceProfile, 'id' | 'updatedAt'>): void =>
    setInvoiceProfile([{ ...p, id: 'me', updatedAt: Date.now() }])

  return {
    invoices, setInvoices, invoiceClients, setInvoiceClients, invoiceProfile, setInvoiceProfile,
    saveInvoice, patchInvoice, deleteInvoice, saveInvoiceClient, deleteInvoiceClient, saveInvoiceProfile,
  }
}
