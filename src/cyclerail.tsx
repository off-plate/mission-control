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
import { iso, type Cycle, type CycleItem } from './compassCalc'

export interface RailIncome { id: string; label: string; amount: number; day: number | null }

const money = (n: number): string => `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(Math.round(n))} Kč`
/* Above a bar there is room for four characters, not nine. */
const short = (n: number): string => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)))

export function CycleRail({ cycle, items, incomes, isNow, onOpenItem, onOpenIncome }: {
  cycle: Cycle
  items: CycleItem[]
  incomes: RailIncome[]
  /** Only the cycle he is standing in gets a Today line. */
  isNow: boolean
  onOpenItem: (i: CycleItem) => void
  onOpenIncome: (id: string) => void
}) {
  const [picked, setPicked] = useState<string | null>(null)

  /* The cycle runs 14th to 14th, so this is a window of dates across two
     months, not 1..daysInMonth. Every column is a real date and everything is
     matched on its ISO string: a day NUMBER would be ambiguous the moment the
     window stopped starting on the 1st. */
  const dates: Date[] = []
  for (const d = new Date(cycle.start); d < cycle.end; d.setDate(d.getDate() + 1)) dates.push(new Date(d))
  const todayIso = isNow ? iso(new Date()) : null
  const inCycle = (day: string) => day >= iso(cycle.start) && day < iso(cycle.end)

  /* A day-of-month off the settings blob is placed on whichever of the two
     months the window actually covers -- the same both-months lookup
     compassCalc's occurrenceInWindow does for a bill's day. */
  const dateForDay = (day: number): string | null => {
    const hit = dates.find((d) => d.getDate() === day)
    return hit ? iso(hit) : null
  }

  const dated = items.filter((i) => i.dueOn && inCycle(i.dueOn))
  const undated = items.filter((i) => !i.dueOn || !inCycle(i.dueOn))
  const incomeOn = new Map<string, RailIncome[]>()
  const undatedIncome: RailIncome[] = []
  for (const c of incomes) {
    const at = c.day === null ? null : dateForDay(c.day)
    if (at) incomeOn.set(at, [...(incomeOn.get(at) ?? []), c])
    else undatedIncome.push(c)
  }

  const outOn = (day: string) => dated.filter((i) => i.dueOn === day)
  const inOn = (day: string) => incomeOn.get(day) ?? []
  const outSum = (day: string) => outOn(day).reduce((s, i) => s + i.amount, 0)
  const inSum = (day: string) => inOn(day).reduce((s, c) => s + c.amount, 0)

  const maxOut = Math.max(1, ...dates.map((d) => outSum(iso(d))))
  const maxIn = Math.max(1, ...dates.map((d) => inSum(iso(d))))

  const totalIn = incomes.reduce((s, c) => s + c.amount, 0)
  const totalOut = items.reduce((s, i) => s + i.amount, 0)

  const shown = picked ?? todayIso
  const shownOut = shown ? outOn(shown) : []
  const shownIn = shown ? inOn(shown) : []
  const hasReadout = shownOut.length > 0 || shownIn.length > 0
  const dayMonth = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

  return (
    /* Hovering a column previews it; the readout holds so its rows can be
       reached and clicked. Leaving the section entirely drops back to today,
       otherwise the rail sits showing whatever day the pointer last crossed
       for the rest of the session. */
    <div className="card cyclerail" onMouseLeave={() => setPicked(null)}>
      <div className="cr-head">
        <span className="overline">{cycle.label}</span>
        <span className="cr-meta"><b>{money(totalIn)}</b> in · <b>{money(totalOut)}</b> out</span>
      </div>

      <div className="cr-scroll">
        <div className="cr-rail">
          {dates.map((date, n) => {
            const day = iso(date)
            const d = date.getDate()
            const weekend = date.getDay() === 0 || date.getDay() === 6
            /* The window crosses a month. Mark where, or a run of 28, 29, 30,
               1, 2 reads as a glitch. */
            const newMonth = n > 0 && d === 1
            const out = outSum(day), inc = inSum(day)
            const allPaid = out > 0 && outOn(day).every((i) => i.paid)
            const overdue = outOn(day).some((i) => i.overdue && !i.paid)
            return (
              <button
                key={day}
                type="button"
                className={`cr-day${weekend ? ' is-we' : ''}${day === todayIso ? ' is-today' : ''}${shown === day ? ' is-on' : ''}${newMonth ? ' is-newmonth' : ''}`}
                aria-label={`${dayMonth(day)}${out ? `, ${money(out)} out` : ''}${inc ? `, ${money(inc)} in` : ''}`}
                onMouseEnter={() => setPicked(day)}
                onFocus={() => setPicked(day)}
                onClick={() => setPicked(day)}
              >
                <span className="cr-dow">{n === 0 || newMonth ? date.toLocaleDateString('en-GB', { month: 'short' }) : date.getDay() === 1 ? 'Mo' : ''}</span>
                <span className="cr-up">
                  {day === todayIso && <><i className="cr-nowline" /><i className="cr-nowtag">Today</i></>}
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
        <span className="cr-rday">{shown ? dayMonth(shown) : '—'}</span>
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
