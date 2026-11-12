import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { qrMatrix, qrSvgPath } from '../qr'
import { czIban, ibanSpaced, money, spayd, totals } from '../invoicecalc'
import type { Invoice, InvoiceParty, PaymentMethod } from '../types'
import { fmtDate } from './shared'

/* ---------- the printed sheet ---------- */

/* Laid out from his own Fakturoid PDF (PM375, 2026-11-01): the title and a heavy rule
   top right, supplier and customer side by side, label left and value right, a single
   PRICE column unless an item has a quantity, the QR payment square bottom left under
   the total's rule, the register line at the foot. No IBAN or SWIFT unless the payer
   needs them (his call, 2026-11-01). */
export const L = {
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
export const zipFmt = (z?: string) => { const d = (z ?? '').replace(/\s/g, ''); return /^\d{5}$/.test(d) ? `${d.slice(0, 3)} ${d.slice(3)}` : (z ?? '') }

export function PartyBlock({ head, p, t, extra }: { head: string; p: InvoiceParty; t: typeof L.cs; extra?: ReactNode }) {
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
export function FitPaper({ inv }: { inv: Invoice }) {
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
