import { Fragment, useState, type ReactNode } from 'react'
import { useStore } from '../store'
import { Dropdown, Segmented } from '../ui'
import * as Icon from '../icons'
import { STATUS_LABEL, daysBetween, invoiceTotal, isoDay, money, shownStatus } from '../invoicecalc'
import type { Invoice } from '../types'
import { Filter, Period, QUIET_DAYS, fold, inFilter, periodBuckets, plural, sumText } from './shared'

export const CARDS: { id: Filter; label: string; icon: ReactNode; scope: string }[] = [
  { id: 'all', label: 'All', icon: <Icon.DockInvoice size={26} />, scope: 'last 12 months' },
  { id: 'unpaid', label: 'Unpaid', icon: <Icon.Clock size={26} />, scope: 'incl. overdue' },
  { id: 'overdue', label: 'Overdue', icon: <Icon.Flag size={26} />, scope: 'all time' },
  { id: 'paid', label: 'Paid', icon: <Icon.CheckRing size={26} />, scope: 'last 12 months' },
]

export function InvoiceList({ filter, setFilter, onOpen, onNew }: { filter: Filter; setFilter: (f: Filter) => void; onOpen: (id: string) => void; onNew: () => void }) {
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
export function InvoiceRows({ rows, onOpen, hideClient }: { rows: Invoice[]; onOpen: (id: string) => void; hideClient?: boolean }) {
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
export const fmtShort = (iso: string) => { const [y, m, d] = iso.split('-'); return `${Number(d)}. ${Number(m)}. ${y.slice(2)}` }

export function BarChart({ data, height = 260 }: { data: ReturnType<typeof periodBuckets>; height?: number }) {
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

export function niceStep(max: number): number {
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? mag * 10
}

export function Overview({ onOpen, onList, onContact }: { onOpen: (id: string) => void; onList: (f: Filter) => void; onContact: (id: string) => void }) {
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

export const VAT_LIMIT = 2_000_000

export const VAT_HARD = 2_536_000

export function Statistics() {
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
