/* THE CYCLE RAIL — every day of the cycle, and what lands on it.

   Replaces the "+ Income / + Bill" strip (2026-09-03, his ask). The Bills page
   could say what a cycle costs but never when: a column of totals has no order,
   so a month whose rent and two loans all fall before payday looked exactly
   like one where they fall after. This is the same items, laid out on the days
   they actually land.

   Money out grows UP from the day line and money in grows DOWN. One row of
   dots cannot separate the two directions money moves; two directions can.

   What it draws is what the data holds and nothing more. cycleChecklist
   already resolves a real date for a recurring bill with a day-of-month, a
   debt with a due day, and a one-off with a due date. Everything else -- a
   bill saved without a day, a debt with no day agreed, all of Unreasonable --
   has no date and is not given one: it sits in the tray under the rail,
   labelled for what it is. */
import { useState } from 'react'
import type { CycleItem } from './compassCalc'

export interface RailIncome { id: string; label: string; amount: number; day: number | null }

const money = (n: number): string => `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(Math.round(n))} Kč`
/* Above a bar there is room for four characters, not nine. */
const short = (n: number): string => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)))

export function CycleRail({ cycle, items, incomes, isNow, onOpenItem, onOpenIncome }: {
  cycle: { start: Date; end: Date; key: string }
  items: CycleItem[]
  incomes: RailIncome[]
  /** Only the cycle he is standing in gets a Today line. */
  isNow: boolean
  onOpenItem: (i: CycleItem) => void
  onOpenIncome: (id: string) => void
}) {
  const [picked, setPicked] = useState<number | null>(null)

  const days = new Date(cycle.start.getFullYear(), cycle.start.getMonth() + 1, 0).getDate()
  const today = isNow ? new Date().getDate() : null
  const monthLabel = cycle.start.toLocaleDateString('en-GB', { month: 'short' })

  /* Day of month straight off the ISO string. `new Date('2026-09-15')` is
     parsed as UTC midnight, which in Prague is still the 14th for two hours --
     the same trap compassCalc documents for its own due dates. */
  const dayOf = (iso: string | null): number | null => (iso ? Number(iso.slice(8, 10)) || null : null)

  const dated = items.filter((i) => dayOf(i.dueOn) !== null)
  const undated = items.filter((i) => dayOf(i.dueOn) === null)
  const datedIncome = incomes.filter((c) => c.day !== null && c.day >= 1 && c.day <= days)
  const undatedIncome = incomes.filter((c) => c.day === null || c.day < 1 || c.day > days)

  const outOn = (d: number) => dated.filter((i) => dayOf(i.dueOn) === d)
  const inOn = (d: number) => datedIncome.filter((c) => c.day === d)
  const outSum = (d: number) => outOn(d).reduce((s, i) => s + i.amount, 0)
  const inSum = (d: number) => inOn(d).reduce((s, c) => s + c.amount, 0)

  const maxOut = Math.max(1, ...Array.from({ length: days }, (_, n) => outSum(n + 1)))
  const maxIn = Math.max(1, ...Array.from({ length: days }, (_, n) => inSum(n + 1)))

  const totalIn = incomes.reduce((s, c) => s + c.amount, 0)
  const totalOut = items.reduce((s, i) => s + i.amount, 0)

  const shown = picked ?? today
  const shownOut = shown ? outOn(shown) : []
  const shownIn = shown ? inOn(shown) : []
  const hasReadout = shownOut.length > 0 || shownIn.length > 0

  return (
    /* Hovering a column previews it; the readout holds so its rows can be
       reached and clicked. Leaving the section entirely drops back to today,
       otherwise the rail sits showing whatever day the pointer last crossed
       for the rest of the session. */
    <div className="card cyclerail" onMouseLeave={() => setPicked(null)}>
      <div className="cr-head">
        <span className="overline">{cycle.start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</span>
        <span className="cr-meta"><b>{money(totalIn)}</b> in · <b>{money(totalOut)}</b> out</span>
      </div>

      <div className="cr-scroll">
        <div className="cr-rail">
          {Array.from({ length: days }, (_, n) => {
            const d = n + 1
            const date = new Date(cycle.start.getFullYear(), cycle.start.getMonth(), d)
            const weekend = date.getDay() === 0 || date.getDay() === 6
            const out = outSum(d), inc = inSum(d)
            const allPaid = out > 0 && outOn(d).every((i) => i.paid)
            const overdue = outOn(d).some((i) => i.overdue && !i.paid)
            return (
              <button
                key={d}
                type="button"
                className={`cr-day${weekend ? ' is-we' : ''}${d === today ? ' is-today' : ''}${shown === d ? ' is-on' : ''}`}
                aria-label={`${d} ${monthLabel}${out ? `, ${money(out)} out` : ''}${inc ? `, ${money(inc)} in` : ''}`}
                onMouseEnter={() => setPicked(d)}
                onFocus={() => setPicked(d)}
                onClick={() => setPicked(d)}
              >
                <span className="cr-dow">{date.getDay() === 1 ? 'Mo' : ''}</span>
                <span className="cr-up">
                  {d === today && <><i className="cr-nowline" /><i className="cr-nowtag">Today</i></>}
                  {out > 0 && <>
                    <span className={`cr-cap${allPaid ? ' is-paid' : ''}`}>{short(out)}</span>
                    <span className={`cr-bar${allPaid ? ' is-paid' : ''}${overdue ? ' is-late' : ''}`}
                      style={{ height: `${Math.max(7, Math.round((out / maxOut) * 74))}px` }} />
                  </>}
                </span>
                <span className="cr-num">{d}</span>
                <span className="cr-dn">
                  {inc > 0 && <>
                    <span className="cr-bar is-in" style={{ height: `${Math.max(7, Math.round((inc / maxIn) * 24))}px` }} />
                    <span className="cr-cap is-in">+{short(inc)}</span>
                  </>}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* The readout is the rail's only detail view: thirty columns cannot
          carry names, and a tooltip cannot be tapped. Each row here opens the
          thing it names. */}
      <div className={`cr-read${hasReadout ? '' : ' is-empty'}`}>
        <span className="cr-rday">{shown ? `${shown} ${monthLabel}` : '—'}</span>
        <span className="cr-rlist">
          {!shown && 'Point at a day.'}
          {shown && !hasReadout && 'Nothing on this day.'}
          {shownIn.map((c) => (
            <button key={c.id} type="button" className="cr-rrow" onClick={() => onOpenIncome(c.id)}>
              {c.label || 'Income'}<span className="cr-rnum is-in">+{money(c.amount)}</span>
            </button>
          ))}
          {shownOut.map((i) => (
            <button key={i.id} type="button" className={`cr-rrow${i.paid ? ' is-paid' : ''}`} onClick={() => onOpenItem(i)}>
              {i.name}<span className="cr-rnum">−{money(i.amount)}</span>
              {i.paid && <span className="cr-rtag">paid</span>}
              {!i.paid && i.overdue && <span className="cr-rtag is-late">overdue</span>}
            </button>
          ))}
        </span>
      </div>

      <div className="cr-legend">
        <span className="cr-lg"><i className="cr-lgd is-out" />Still to pay, above the line</span>
        <span className="cr-lg"><i className="cr-lgd is-paid" />Already paid</span>
        <span className="cr-lg"><i className="cr-lgd is-in" />Money in, below the line</span>
      </div>

      {(undated.length > 0 || undatedIncome.length > 0) && (
        <div className="cr-tray">
          <span className="cr-traylbl">Any time this cycle</span>
          {undatedIncome.map((c) => (
            <button key={c.id} type="button" className="cr-chip" onClick={() => onOpenIncome(c.id)}>
              {c.label || 'Income'}<span className="cr-chipamt is-in">+{money(c.amount)}</span>
            </button>
          ))}
          {undated.map((i) => (
            <button key={i.id} type="button" className={`cr-chip${i.paid ? ' is-paid' : ''}`} onClick={() => onOpenItem(i)}>
              {i.name}<span className="cr-chipamt">{money(i.amount)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
