/* The face of the day: three pieces that sit above and below his own widget
   grid on Today.

   The shape came from a dashboard he sent, which puts a banner across the top,
   a row of big numbers under it and a calendar strip beside it. What that
   mockup fills those slots with is a gradient, a joke about a cat and a month
   of nothing. Every number here is his: focus blocks he actually ran, habits he
   actually kept, tasks he actually finished. Nothing on this page is drawn from
   a constant, so an empty day looks empty. */

import { useEffect, useState } from 'react'
import { useStore } from './store'
import { fmtDuration, fmtSigned, localDateKey } from './util'
import { dueOn, type FocusSession, type HabitDef, type Task } from './types'

/* ---------------- the day, drawn on a line ---------------- */

const DAY_MIN = 24 * 60
const pct = (min: number) => `${(min / DAY_MIN) * 100}%`

/** Local minutes past midnight for an ISO moment. */
const minsOf = (iso: string): number => {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

interface Block { id: string; from: number; to: number; label: string; minutes: number }

export function DayLine() {
  const { focusSessions, tasks, inView } = useStore()
  const day = localDateKey()

  /* Re-rendered on the minute so the now marker is where it says it is. */
  const [now, setNow] = useState(() => new Date().getHours() * 60 + new Date().getMinutes())
  useEffect(() => {
    const t = window.setInterval(() => {
      const m = new Date().getHours() * 60 + new Date().getMinutes()
      setNow((prev) => (prev === m ? prev : m))
    }, 1000)
    return () => window.clearInterval(t)
  }, [])

  const mine = focusSessions.filter((f: FocusSession) => f.day === day && inView(f.space))
  /* A block records when it FINISHED. Its start is that moment less its own
     length, which is the only honest way to place it. A block with no stamp
     (logged by hand, or from before stamps existed) cannot be placed at all,
     so it is counted off to the side rather than dropped at midnight. */
  const blocks: Block[] = mine
    .filter((f) => f.at)
    .map((f) => {
      const to = minsOf(f.at as string)
      return { id: f.id, from: Math.max(0, to - f.minutes), to, label: f.label ?? 'Focus block', minutes: f.minutes }
    })
    .sort((a, b) => a.from - b.from)
  const unplaced = mine.length - blocks.length

  const pinned = tasks
    .filter((t: Task) => inView(t.space) && t.at && !t.done && (t.plannedOn ?? day) === day)
    .map((t) => ({ id: t.id, at: Number(t.at!.slice(0, 2)) * 60 + Number(t.at!.slice(3, 5)), title: t.title }))
    .sort((a, b) => a.at - b.at)

  const focused = mine.reduce((a, f) => a + f.minutes, 0)

  return (
    <section className="dayline" aria-label="Today on the clock">
      <div className="dayline-head">
        <span className="microcap">On the clock today</span>
        <span className="dayline-sum mono">
          {focused > 0 ? `${fmtDuration(focused)} in ${mine.length} ${mine.length === 1 ? 'block' : 'blocks'}` : 'nothing logged yet'}
          {unplaced > 0 ? `, ${unplaced} without a time` : ''}
        </span>
      </div>

      <div className="dayline-track">
        {/* Every third hour gets a rule, so the eye can place a block without
            counting. */}
        {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
          <span className="dayline-tick" key={h} style={{ left: pct(h * 60) }}>
            <span className="mono">{String(h).padStart(2, '0')}</span>
          </span>
        ))}

        {blocks.map((b) => (
          <span
            className="dayline-block"
            key={b.id}
            style={{ left: pct(b.from), width: `max(3px, ${(b.minutes / DAY_MIN) * 100}%)` }}
            title={`${b.label}, ${hhmm(b.from)} to ${hhmm(b.to)}, ${fmtDuration(b.minutes)}`}
          />
        ))}

        {pinned.map((p) => (
          <span className="dayline-pin" key={p.id} style={{ left: pct(p.at) }} title={`${p.title} at ${hhmm(p.at)}`}>
            <span className="dayline-pin-dot" />
          </span>
        ))}

        {/* Now. No number on it: where the line sits IS the information, and
            the clock tile below already says the time in a form worth reading.
            Two identical times 400px apart read as a bug. */}
        <span className="dayline-now" style={{ left: pct(now) }} title={`Now, ${hhmm(now)}`}>
          <span className="dayline-now-dot" />
        </span>
      </div>

      {/* The names, under the line rather than crowded onto it. Only what is
          still ahead of him, because what is behind is already in the total. */}
      {pinned.length > 0 && (
        <div className="dayline-legend">
          {pinned.slice(0, 4).map((p) => (
            <span className="dayline-legend-item" key={p.id}>
              <span className="mono">{hhmm(p.at)}</span>
              {p.title}
            </span>
          ))}
          {pinned.length > 4 && <span className="dayline-legend-more">and {pinned.length - 4} more</span>}
        </div>
      )}
    </section>
  )
}

/* ---------------- four numbers, all of them his ---------------- */

export function DayNumbers({ savedMin }: { savedMin: number }) {
  const { focusSessions, habits, habitLog, tasks, todayIndex, inView } = useStore()
  const day = localDateKey()

  const focused = focusSessions.filter((f) => f.day === day && inView(f.space)).reduce((a, f) => a + f.minutes, 0)
  /* The same rule the Habits page opens with, imported rather than rewritten,
     so the two can never disagree about what today asked of him. */
  const due = habits.filter((h: HabitDef) => inView(h.space) && !h.archivedAt && dueOn(h, todayIndex, habitLog))
  const kept = due.filter((h) => h.days[todayIndex]).length
  /* Ticked today, by its own stamp. Not the ledger: a ledger row is only
     written when he gives the task an actual, so counting rows would quietly
     drop everything he ticked and moved on from. */
  const finished = tasks.filter((t) => t.done && inView(t.space) && (t.doneAt ?? '').slice(0, 10) === day).length

  return (
    <div className="daynums">
      <div className="daynum">
        <span className={`v${focused > 0 ? ' val-pos' : ''}`}>{focused > 0 ? fmtDuration(focused) : '—'}</span>
        <span className="k">focused today</span>
      </div>
      <div className="daynum">
        <span className="v">{kept}<span className="of">/{due.length}</span></span>
        <span className="k">habits kept</span>
      </div>
      <div className="daynum">
        <span className="v">{finished}</span>
        <span className="k">{finished === 1 ? 'thing finished' : 'things finished'}</span>
      </div>
      <div className="daynum">
        <span className={`v${savedMin === 0 ? '' : savedMin > 0 ? ' val-pos' : ' val-urgent'}`}>
          {savedMin === 0 ? '—' : fmtSigned(savedMin)}
        </span>
        <span className="k">{savedMin < 0 ? 'over your estimates' : 'against your estimates'}</span>
      </div>
    </div>
  )
}

/* ---------------- the week behind him ---------------- */

const stepDay = (iso: string, by: number): string => {
  const [y, m, d] = iso.split('-').map(Number)
  const x = new Date(y, m - 1, d + by)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

export function WeekStrip() {
  const { focusSessions, habitLog, routineLog, routines, habits, ledger, openDay, inView } = useStore()
  const today = localDateKey()
  const days = Array.from({ length: 7 }, (_, i) => stepDay(today, i - 6))

  const mineHabits = new Set(habits.filter((h) => inView(h.space)).map((h) => h.id))
  const mineRoutines = new Set(routines.filter((r) => inView(r.space)).map((r) => r.id))

  /* One scale for the whole strip: a bar is only readable against the other
     bars, so the busiest day in the window sets the ceiling. */
  const minutesOn = (d: string) => focusSessions.filter((f) => f.day === d && inView(f.space)).reduce((a, f) => a + f.minutes, 0)
  const peak = Math.max(60, ...days.map(minutesOn))

  return (
    <section className="weekstrip" aria-label="The last seven days">
      <div className="weekstrip-head">
        <span className="microcap">The week behind you</span>
      </div>
      <div className="weekstrip-days">
        {days.map((d) => {
          const [, , dd] = d.split('-')
          const name = new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(dd)).toLocaleDateString('en-GB', { weekday: 'short' })
          const mins = minutesOn(d)
          const kept = habitLog.filter((t) => t.day === d && mineHabits.has(t.habitId)).length
          const ran = routineLog.filter((r) => r.day === d && mineRoutines.has(r.routineId)).length
          const done = ledger.filter((e) => e.when === d && inView(e.space)).length
          const empty = !mins && !kept && !ran && !done
          return (
            <button
              className={`weekday${d === today ? ' is-today' : ''}${empty ? ' is-empty' : ''}`}
              key={d}
              onClick={() => openDay(d)}
              aria-label={`Open ${name} the ${Number(dd)}`}
            >
              <span className="weekday-head">
                <span className="weekday-name">{name}</span>
                <span className="weekday-num">{Number(dd)}</span>
              </span>
              <span className="weekday-bar" aria-hidden="true">
                <i style={{ width: `${Math.round((mins / peak) * 100)}%` }} />
              </span>
              {/* Two facts at most. A card this size holding four of them is a
                  paragraph, and a paragraph is not glanceable. */}
              <span className="weekday-facts mono">
                {mins > 0 && <span className="wf focus">{fmtDuration(mins)}</span>}
                {kept > 0 && <span className="wf kept">{kept} kept</span>}
                {!mins && !kept && ran > 0 && <span className="wf ran">{ran} run</span>}
                {!mins && !kept && !ran && done > 0 && <span className="wf done">{done} done</span>}
                {empty && <span className="wf none">nothing</span>}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
