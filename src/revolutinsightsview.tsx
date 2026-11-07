/* The analytics half of the Revolut page (2026-11-07). Everything is computed in revolutinsights.ts;
   this file only draws it. Charts are plain CSS bars plus one SVG line, no chart library.

   Colour is meaning (COLOR.md): green = money in and the balance he has, slate = plain spending
   figures, amber only when a number moved the wrong way by a lot, coral only for a negative net.
   No category colours, no subtitles under headings. */
import { useMemo, useState } from 'react'
import { Segmented } from './ui'
import { analyse, czk, type Insights, type Row } from './revolutinsights'

const PERIODS = [
  { id: '30', label: '30 days' }, { id: '90', label: '3 months' }, { id: '182', label: '6 months' }, { id: '365', label: '12 months' },
] as const
type PeriodId = (typeof PERIODS)[number]['id']

const shortDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const monthShort = (m: string) => new Date(m + '-01T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
const pctText = (n: number) => `${n >= 0 ? '+' : '-'}${Math.round(Math.abs(n) * 100)}%`

function Delta({ cur, prev, goodWhen }: { cur: number; prev: number; goodWhen: 'up' | 'down' }) {
  if (prev <= 0) return <small className="rv-delta">no earlier period to compare</small>
  const d = (cur - prev) / prev
  const good = goodWhen === 'up' ? d >= 0 : d <= 0
  const big = Math.abs(d) >= 0.15
  return <small className={`rv-delta${big ? (good ? ' is-good' : ' is-bad') : ''}`}>{pctText(d)} against the {'previous period'}</small>
}

function Kpi({ label, value, tone, children }: { label: string; value: string; tone?: 'in' | 'neg'; children?: React.ReactNode }) {
  return (
    <div className="rv-kpi">
      <b>{label}</b>
      <span className={`rv-kpi-v${tone === 'in' ? ' rv-in' : tone === 'neg' ? ' rv-neg' : ''}`}>{value}</span>
      {children}
    </div>
  )
}

function BalanceChart({ series }: { series: Insights['balance'] }) {
  if (series.length < 2) return <p className="rv-quiet">Not enough balance history in this period.</p>
  const W = 720, H = 170, P = 10
  const vals = series.map((s) => s.total)
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const span = hi - lo || 1
  const x = (i: number) => (i / (series.length - 1)) * W
  const y = (v: number) => P + (1 - (v - lo) / span) * (H - 2 * P)
  const line = series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(s.total).toFixed(1)}`).join(' ')
  const lowAt = series[vals.indexOf(lo)], highAt = series[vals.indexOf(hi)]
  const now = series[series.length - 1]
  return (
    <div>
      <svg className="rv-line" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Total balance, from ${czk(series[0].total)} to ${czk(now.total)}, low ${czk(lo)}, high ${czk(hi)}`}>
        <path className="rv-area" d={`${line} L${W} ${H} L0 ${H} Z`} />
        <path className="rv-stroke" d={line} />
      </svg>
      <div className="rv-axis">
        <span>{shortDay(series[0].day)}: {czk(series[0].total)}</span>
        <span>Low {czk(lo)} on {shortDay(lowAt.day)}</span>
        <span>High {czk(hi)} on {shortDay(highAt.day)}</span>
        <span>{shortDay(now.day)}: {czk(now.total)}</span>
      </div>
    </div>
  )
}

function MonthBars({ months }: { months: Insights['months'] }) {
  const max = Math.max(1, ...months.flatMap((m) => [m.income, m.spending]))
  const h = (v: number) => (v <= 0 ? '0' : `${Math.max(1.5, (v / max) * 100)}%`)
  return (
    <div className="rv-months-chart" role="group" aria-label="Income and spending by month">
      {months.map((m) => (
        <div className="rv-mcol" key={m.month} title={`${m.month}: in ${czk(m.income)}, out ${czk(m.spending)}${m.invested ? `, invested ${czk(m.invested)}` : ''}, net ${czk(m.net, true)}`}>
          <div className="rv-mbars">
            <i className="rv-bar-in" style={{ height: h(m.income) }} />
            <i className="rv-bar-out" style={{ height: h(m.spending) }} />
          </div>
          <span className="rv-mlabel">{monthShort(m.month)}</span>
          <span className={`rv-mnet${m.net < 0 ? ' rv-neg' : ' rv-in'}`}>{Math.abs(m.net) >= 1000 ? `${m.net < 0 ? '-' : '+'}${Math.round(Math.abs(m.net) / 1000)}k` : Math.round(m.net)}</span>
        </div>
      ))}
    </div>
  )
}

function CategoryBars({ cats }: { cats: Insights['cats'] }) {
  if (!cats.length) return <p className="rv-quiet">No spending in this period.</p>
  const max = cats[0].spending
  return (
    <ul className="rv-cats">
      {cats.slice(0, 12).map((c) => {
        const showDelta = c.deltaPct !== null && c.prev >= 500
        return (
          <li key={c.category}>
            <span className="rv-cname">{c.category}</span>
            <span className="rv-track"><i style={{ width: `${Math.max(1.5, (c.spending / max) * 100)}%` }} /></span>
            <span className="rv-camt">{czk(c.spending)}</span>
            <span className="rv-cshare">{Math.round(c.share * 100)}%</span>
            <span className={`rv-cdelta${showDelta && Math.abs(c.deltaPct as number) >= 0.25 ? ((c.deltaPct as number) > 0 ? ' is-bad' : ' is-good') : ''}`}>{showDelta ? pctText(c.deltaPct as number) : ''}</span>
          </li>
        )
      })}
    </ul>
  )
}

function Bars({ values, labels, max, unit }: { values: number[]; labels: string[]; max: number; unit: string }) {
  return (
    <div className="rv-minibars" role="img" aria-label={labels.map((l, i) => `${l} ${czk(values[i])}`).join(', ')}>
      {values.map((v, i) => (
        <div className="rv-mini" key={i} title={`${labels[i]}: ${czk(v)} ${unit}`}>
          <div className="rv-mini-col"><i style={{ height: v <= 0 ? '0' : `${Math.max(2, (v / max) * 100)}%` }} /></div>
          <span>{labels[i]}</span>
        </div>
      ))}
    </div>
  )
}

export function RevolutInsights({ rows, asOf }: { rows: Row[]; asOf: string }) {
  const [period, setPeriod] = useState<PeriodId>('30')
  const a = useMemo(() => analyse(rows, asOf, Number(period)), [rows, asOf, period])
  const dayMax = Math.max(1, ...a.pattern.weekday.map((w) => w.spending))
  const hourMax = Math.max(1, ...a.pattern.hours)
  const subsMonthly = a.recurring.reduce((s, r) => s + r.monthly, 0)
  const rate = a.cur.income > 0 ? a.cur.net / a.cur.income : null

  return (
    <section className="rv-ins" aria-label="Insights">
      <div className="rv-insbar">
        <h2 className="rv-h">Insights</h2>
        <Segmented size="sm" label="Period" value={period} onPick={setPeriod} options={PERIODS.map((p) => ({ id: p.id, label: p.label }))} />
        <span className="rv-range">{shortDay(a.from)} to {shortDay(a.to)}</span>
      </div>

      <div className="rv-kpis">
        <Kpi label="Income" value={czk(a.cur.income)} tone="in"><Delta cur={a.cur.income} prev={a.prev.income} goodWhen="up" /></Kpi>
        <Kpi label="Spending" value={czk(a.cur.spending)}><Delta cur={a.cur.spending} prev={a.prev.spending} goodWhen="down" /></Kpi>
        <Kpi label="Net" value={czk(a.cur.net, true)} tone={a.cur.net < 0 ? 'neg' : 'in'}>
          <small className="rv-delta">{rate === null ? 'no income in this period' : `${Math.round(rate * 100)}% of income ${rate >= 0 ? 'kept' : 'overspent'}`}</small>
        </Kpi>
        <Kpi label="Per day" value={czk(a.cur.avgDaily)}><Delta cur={a.cur.avgDaily} prev={a.prev.avgDaily} goodWhen="down" /></Kpi>
        {a.cur.invested !== 0 && <Kpi label="Invested" value={czk(a.cur.invested)}><small className="rv-delta">put away, not counted as spending</small></Kpi>}
      </div>

      {a.lines.length > 0 && (
        <div className="rv-panel">
          <h3 className="rv-h3">What stands out</h3>
          <ul className="rv-lines">{a.lines.map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
      )}

      <div className="rv-panel">
        <h3 className="rv-h3">Total balance</h3>
        <BalanceChart series={a.balance} />
      </div>

      <div className="rv-panel">
        <h3 className="rv-h3">Income and spending by month</h3>
        <MonthBars months={a.months} />
        <div className="rv-legend"><span><i className="rv-bar-in" />Income</span><span><i className="rv-bar-out" />Spending</span><span>Figure under each month: net, in thousands</span></div>
      </div>

      <div className="rv-panel">
        <h3 className="rv-h3">Where the money goes</h3>
        <CategoryBars cats={a.cats} />
      </div>

      <div className="rv-two">
        <div className="rv-panel">
          <h3 className="rv-h3">Top places</h3>
          <table className="rv-table rv-mini-table">
            <thead><tr><th>Where</th><th className="r">Total</th><th className="r">Times</th><th className="r rv-hide-phone">Average</th></tr></thead>
            <tbody>
              {a.merchants.map((m) => <tr key={m.name}><td className="rv-desc">{m.name}</td><td className="r rv-nowrap">{czk(m.total)}</td><td className="r rv-dim">{m.n}</td><td className="r rv-dim rv-nowrap rv-hide-phone">{czk(m.avg)}</td></tr>)}
              {!a.merchants.length && <tr><td colSpan={4} className="rv-quiet">Nothing in this period.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="rv-panel">
          <h3 className="rv-h3">Biggest payments</h3>
          <table className="rv-table rv-mini-table">
            <thead><tr><th>Date</th><th>What</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {a.biggest.map((b, i) => <tr key={i}><td className="rv-dim rv-nowrap">{shortDay(b.day)}</td><td className="rv-desc">{b.description}<em className="rv-dim">{b.category}</em></td><td className="r rv-nowrap">{czk(b.amount)}</td></tr>)}
              {!a.biggest.length && <tr><td colSpan={3} className="rv-quiet">Nothing in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rv-two">
        <div className="rv-panel">
          <h3 className="rv-h3">By weekday</h3>
          <Bars values={a.pattern.weekday.map((w) => w.spending)} labels={a.pattern.weekday.map((w) => w.name.slice(0, 3))} max={dayMax} unit="spent" />
        </div>
        <div className="rv-panel">
          <h3 className="rv-h3">By hour of the day</h3>
          <Bars values={a.pattern.hours} labels={a.pattern.hours.map((_, i) => (i % 6 === 0 ? String(i) : ''))} max={hourMax} unit="spent" />
          <p className="rv-note">{a.pattern.nightDays ? `${a.pattern.nightDays} ${a.pattern.nightDays === 1 ? 'day' : 'days'} with spending between midnight and 5 am (${czk(a.pattern.nightSpending)}).` : 'No spending between midnight and 5 am.'}</p>
        </div>
      </div>

      <div className="rv-panel">
        <h3 className="rv-h3">Recurring payments</h3>
        {a.recurring.length ? (
          <>
            <table className="rv-table rv-mini-table">
              <thead><tr><th>Payment</th><th className="r">Per month</th><th className="r rv-hide-phone">Per year</th><th className="r rv-hide-phone">Charged</th><th className="r">Last</th></tr></thead>
              <tbody>
                {a.recurring.map((r) => <tr key={r.name}><td className="rv-desc">{r.name}</td><td className="r rv-nowrap">{czk(r.monthly)}</td><td className="r rv-dim rv-nowrap rv-hide-phone">{czk(r.yearly)}</td><td className="r rv-dim rv-hide-phone">{r.n}x</td><td className="r rv-dim rv-nowrap">{shortDay(r.last)}</td></tr>)}
              </tbody>
            </table>
            <p className="rv-note">About {czk(subsMonthly)} a month, {czk(subsMonthly * 12)} a year. Found by a monthly rhythm and a similar amount, so a rare one can be missing.</p>
          </>
        ) : <p className="rv-quiet">No monthly rhythm found.</p>}
      </div>
    </section>
  )
}
