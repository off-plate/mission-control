import { useMemo, useState } from 'react'
import { useStore } from './store'
import { Band, Schedule, SpaceMark } from './pages1'
import { MOCK_AGENDA } from './mock'
import { fmtDuration, fmtTime, fmtWhen, localDateKey, monthName, monthKey } from './util'
import type { SpaceId, Task } from './types'

/* The month view and the day view of the same record. The grid answers "which
   days did things actually happen", the schedule answers "when in that day",
   and clicking a day swaps the schedule onto it. Today keeps the live schedule
   with its draggable pinned tasks; any other day is read-only, because the past
   is a record and the future has no clock times yet. */

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/** Everything with a wall-clock moment on one day, for the hour column. */
interface Moment { at: string; title: string; kind: 'task' | 'habit' | 'routine' | 'focus'; minutes?: number }

function useDayMoments(day: string): Moment[] {
  const { tasks, habits, habitLog, routines, routineLog, focusSessions, inView } = useStore()
  return useMemo(() => {
    const out: Moment[] = []
    for (const f of focusSessions) {
      if (f.day === day && f.at && inView(f.space)) out.push({ at: f.at, title: f.label ?? 'Focus block', kind: 'focus', minutes: f.minutes })
    }
    for (const t of tasks) {
      if (t.done && t.doneAt?.startsWith(day) && inView(t.space)) out.push({ at: t.doneAt, title: t.title, kind: 'task' })
    }
    for (const r of routineLog) {
      if (r.day === day && r.at) {
        const ro = routines.find((x) => x.id === r.routineId)
        if (ro && inView(ro.space)) out.push({ at: r.at, title: ro.title, kind: 'routine' })
      }
    }
    for (const t of habitLog) {
      if (t.day === day && t.at && !t.src?.startsWith('auto:')) {
        const h = habits.find((x) => x.id === t.habitId)
        // A routine-step tick is already told as its routine; a habit the
        // routine mirrors would say the same thing twice at the same hour.
        if (h && inView(h.space) && !routines.some((r) => r.habitId === h.id && !r.archivedAt)) {
          out.push({ at: t.at, title: h.name, kind: 'habit' })
        }
      }
    }
    return out.sort((a, b) => a.at.localeCompare(b.at))
  }, [tasks, habits, habitLog, routines, routineLog, focusSessions, day, inView])
}

/** The hourly record of one day: what happened, at the hour it happened. */
function DayRecord({ day }: { day: string }) {
  const moments = useDayMoments(day)
  if (moments.length === 0) {
    return <div className="empty">Nothing with a clock time on this day.</div>
  }
  return (
    <div className="dayrec">
      {moments.map((m, i) => (
        <div className={`dayrec-row k-${m.kind}`} key={i}>
          <span className="dayrec-at mono">
            {new Date(m.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span className="dayrec-dot" aria-hidden="true" />
          <span className="grow">{m.title}</span>
          <span className="dayrec-kind mono">{m.minutes ? fmtDuration(m.minutes) : m.kind}</span>
        </div>
      ))}
    </div>
  )
}

/** Which days of a month have anything finished on them, and how much. */
function useDayCounts(): Map<string, number> {
  const { tasks, habitLog, routineLog, focusSessions, habits, routines, inView } = useStore()
  return useMemo(() => {
    const m = new Map<string, number>()
    const add = (day: string) => m.set(day, (m.get(day) ?? 0) + 1)
    for (const t of tasks) if (t.done && t.doneAt && inView(t.space)) add(t.doneAt.slice(0, 10))
    for (const t of habitLog) {
      const h = habits.find((x) => x.id === t.habitId)
      if (h && inView(h.space)) add(t.day)
    }
    for (const r of routineLog) {
      const ro = routines.find((x) => x.id === r.routineId)
      if (ro && inView(ro.space)) add(r.day)
    }
    for (const f of focusSessions) if (inView(f.space)) add(f.day)
    return m
  }, [tasks, habitLog, routineLog, focusSessions, habits, routines, inView])
}

function MonthGrid({ year, month, selected, counts, onPick }: {
  year: number; month: number; selected: string; counts: Map<string, number>; onPick: (day: string) => void
}) {
  const first = new Date(year, month, 1)
  const daysIn = new Date(year, month + 1, 0).getDate()
  const lead = (first.getDay() + 6) % 7 // Monday-first
  const today = localDateKey()
  const iso = (d: number) => `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return (
    <div className="cal-month">
      <div className="cal-month-name microcap">{monthName(`${year}-${String(month + 1).padStart(2, '0')}`)}</div>
      <div className="cal-grid">
        {DOW.map((d, i) => <span className="cal-dow" key={`d${i}`}>{d}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
        {Array.from({ length: daysIn }, (_, i) => {
          const day = iso(i + 1)
          const n = counts.get(day) ?? 0
          return (
            <button
              key={day}
              className={`cal-day${day === today ? ' is-today' : ''}${day === selected ? ' is-picked' : ''}${n > 0 ? ' has-any' : ''}`}
              onClick={() => onPick(day)}
              aria-label={`${fmtWhen(day)}${n ? `, ${n} things finished` : ''}`}
            >
              <span className="cal-num mono">{i + 1}</span>
              {/* How much happened, said in dots, capped where it stops meaning more. */}
              {n > 0 && (
                <span className="cal-marks" aria-hidden="true">
                  {Array.from({ length: Math.min(n, 4) }, (_, k) => <i key={k} />)}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function CalendarPage() {
  const { tasks, space, openDay, inView } = useStore()
  const [selected, setSelected] = useState(localDateKey())
  /* The four months on show, as an offset from the current one. History gets
     one month by default because the record is mostly behind you. */
  const [from, setFrom] = useState(-1)
  const counts = useDayCounts()
  const today = localDateKey()
  const isToday = selected === today

  const now = new Date()
  const months = Array.from({ length: 4 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + from + i, 1)
    return { year: d.getFullYear(), month: d.getMonth() }
  })

  const todayTasks: Task[] = tasks.filter((t) => inView(t.space) && t.list === 'today' && !t.done)
  const events = MOCK_AGENDA[space as SpaceId] ?? []
  const doneOn = counts.get(selected) ?? 0

  return (
    <div className="page">
      <div className="grid-3 cal-cols">
        {/* 1 — the day, by the hour */}
        <div className="panel">
          <div className="col-head">
            <span className="microcap">{isToday ? 'Today' : fmtWhen(selected)}</span>
            <button className="linkish" onClick={() => openDay(selected)}>Open the day record</button>
          </div>
          {isToday ? (
            <>
              <Schedule events={events} tasks={todayTasks} onDropAt={() => {}} />
              <DayRecord day={selected} />
            </>
          ) : (
            <DayRecord day={selected} />
          )}
        </div>

        {/* 2+3 — four months of the record */}
        <div className="cal-wide">
          <div className="cal-head">
            <Band title="Calendar" metrics={doneOn > 0 ? [{ v: String(doneOn), k: `finished ${isToday ? 'today' : 'that day'}`, tone: 'pos' as const }] : []} />
            <span className="cal-nav">
              <button className="btn btn-ghost" onClick={() => setFrom((f) => f - 1)} aria-label="Earlier months">←</button>
              <button className="btn btn-ghost" onClick={() => setFrom(-1)} disabled={from === -1}>Now</button>
              <button className="btn btn-ghost" onClick={() => setFrom((f) => f + 1)} aria-label="Later months">→</button>
            </span>
          </div>
          <div className="cal-months">
            {months.map((m) => (
              <MonthGrid key={`${m.year}-${m.month}`} year={m.year} month={m.month}
                selected={selected} counts={counts} onPick={setSelected} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
