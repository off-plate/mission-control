/* INVOICES (2026-11-01): Fakturoid's core, rebuilt inside Mission Control. An
   invoice carries a copy of both parties as they were when it was saved, so
   editing a contact or his own address later never rewrites a document that
   already went out. */

export type InvoiceStatus = 'open' | 'sent' | 'paid' | 'cancelled'
export type PaymentMethod = 'bank' | 'cash' | 'card' | 'cod'
export type InvoiceCurrency = 'CZK' | 'EUR' | 'USD'
export type InvoiceLang = 'cs' | 'en'

/** A company or a person, as it is printed on the invoice. */
export interface InvoiceParty {
  name: string
  ico?: string
  dic?: string
  street?: string
  city?: string
  zip?: string
  country?: string
  email?: string
  phone?: string
  web?: string
}

export interface InvoiceLine {
  id: string
  name: string
  qty: number
  unit: string
  /** Per unit, before VAT. */
  price: number
  /** Percent. Ignored when he is not a VAT payer. */
  vat: number
}

/** His own details, the supplier on every invoice. One row, id 'me'. */
export interface InvoiceProfile extends InvoiceParty {
  id: 'me'
  /** Czech account, "prefix-number/bank" or "number/bank". */
  account?: string
  iban?: string
  swift?: string
  vatPayer: boolean
  /** The register line, "Fyzická osoba zapsaná v živnostenském rejstříku." */
  regNote?: string
  dueDays: number
  /** YYYY, YY and MM are replaced; a run of N is the counter, zero padded. */
  numberFormat: string
  footer?: string
  updatedAt: number
}

export interface InvoiceClient extends InvoiceParty {
  id: string
  /** Overrides his default due days for this client. */
  dueDays?: number
  note?: string
  createdAt: number
  updatedAt: number
}

export interface Invoice {
  id: string
  number: string
  clientId?: string
  client: InvoiceParty
  supplier: Omit<InvoiceProfile, 'id' | 'updatedAt' | 'numberFormat' | 'dueDays' | 'footer'>
  /** YYYY-MM-DD */
  issued: string
  /** Taxable supply date (DUZP). Printed only for a VAT payer. */
  taxable: string
  due: string
  method: PaymentMethod
  currency: InvoiceCurrency
  lang: InvoiceLang
  /** Variable symbol, the invoice number's digits by default. */
  vs: string
  orderNo?: string
  lines: InvoiceLine[]
  noteBefore?: string
  noteAfter?: string
  footer?: string
  status: InvoiceStatus
  sentOn?: string
  paidOn?: string
  createdAt: number
  updatedAt: number
}
