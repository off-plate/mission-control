import { useMemo, useState } from 'react'
import { useStore } from './store'
import { usePomodoro } from './pomodoro'
import { Band } from './pages1'
import { fmtDuration, fmtTime, fmtTimeShort, fmtWhen, localDateKey, monthName } from './util'

/* The month view and the day view of the same record. The grid answers "which
   days did things actually happen"; the schedule answers "when in that day",
   drawn ON the hours, because a finished thing happened AT a time and a list
   beside the clock was the clock refusing to say so. Clicking a day swaps the
   schedule onto it. */

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const HOUR_PX = 42
const HOURS = 24

/** Everything that happened on one day. What carries a wall-clock moment lands
 *  on the hours; what does not is still SAID, in the untimed strip, because a
 *  habit kept before the clock existed is not less kept. */
interface Moment { at: string; title: string; kind: 'task' | 'habit' | 'routine' | 'focus'; minutes?: number }

function useDayHappenings(day: string): { timed: Moment[]; untimed: { title: string; kind: Moment['kind'] }[] } {
  const { tasks, habits, habitLog, routines, routineLog, focusSessions, inView } = useStore()
  return useMemo(() => {
    const timed: Moment[] = []
    const untimed: { title: string; kind: Moment['kind'] }[] = []
    const tell = (at: string | undefined, title: string, kind: Moment['kind'], minutes?: number) => {
      if (at) timed.push({ at, title, kind, minutes })
      else if (!untimed.some((u) => u.title === title)) untimed.push({ title, kind })
    }
    for (const f of focusSessions) {
      if (f.day === day && inView(f.space)) tell(f.at, f.label ?? 'Focus block', 'focus', f.minutes)
    }
    for (const t of tasks) {
      if (t.done && inView(t.space)) {
        if (t.doneAt?.startsWith(day)) tell(t.doneAt, t.title, 'task')
      }
    }
    for (const r of routineLog) {
      if (r.day !== day) continue
      const ro = routines.find((x) => x.id === r.routineId)
      if (ro && inView(ro.space)) tell(r.at, ro.title, 'routine')
    }
    /* One row per habit per day here: the schedule tells each MOMENT, but a
       pre-clock day only knows THAT it was kept. */
    const seen = new Set<string>()
    for (const t of habitLog) {
      if (t.day !== day || t.src?.startsWith('auto:')) continue
      const h = habits.find((x) => x.id === t.habitId)
      // A routine-step tick is already told as its routine; the habit the
      // routine mirrors would say the same thing twice at the same hour.
      if (!h || !inView(h.space) || routines.some((r) => r.habitId === h.id && !r.archivedAt)) continue
      if (t.at) tell(t.at, h.name, 'habit')
      else if (!seen.has(h.id)) { seen.add(h.id); tell(undefined, h.name, 'habit') }
    }
    return { timed: timed.sort((a, b) => a.at.localeCompare(b.at)), untimed }
  }, [tasks, habits, habitLog, routines, routineLog, focusSessions, day, inView])
}

const minutesOf = (iso: string) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes() }

/** One day on the clock: every hour visible, the record drawn at its times, and
 *  for today also the tasks pinned to a time and the NOW line. */
function DaySchedule({ day }: { day: string }) {
  const { tasks, inView } = useStore()
  const pomo = usePomodoro()
  const { timed: moments, untimed } = useDayHappenings(day)
  const isToday = day === localDateKey()
  const y = (mins: number) => (mins / 60) * HOUR_PX
  /* A block can only occupy the day it is drawn in. Without the cap, a block
     whose arithmetic leaks past midnight painted hours nobody worked. */
  const capped = (top: number, h: number) => Math.min(h, HOURS * HOUR_PX - top - 2)
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
  const pinned = isToday ? tasks.filter((t) => t.at && !t.done && t.list === 'today' && inView(t.space)) : []
  /* The block on the clock right now belongs on the clock too. */
  const liveMin = isToday && pomo.phase === 'focus' ? Math.max(0, Math.floor((pomo.blockMin * 60 - pomo.secondsLeft) / 60)) : 0

  return (
    <>
      {/* Kept and finished without a clock time: history from before the app
          stamped moments, and past days ticked by hand. Named, not placed. */}
      {untimed.length > 0 && (
        <div className="cal-untimed">
          {/* Bare chips read as clutter with no name. The caption carries the
              one fact the hours cannot: these were done, the clock was not
              recorded, which only happens to ticks from before stamping. */}
          <span className="cal-untimed-cap mono">done this day, no clock time recorded</span>
          {untimed.map((u, i) => (
            <span className={`cal-chip k-${u.kind}`} key={i}>
              <i aria-hidden="true" />{u.title}
            </span>
          ))}
        </div>
      )}
      <div className="vsched cal-sched">
      <div className="vsched-inner" style={{ height: HOURS * HOUR_PX }}>
        {Array.from({ length: HOURS + 1 }, (_, h) => (
          <div key={h} className="hline" style={{ top: h * HOUR_PX }}>
            {h % 2 === 0 && h < 24 && <span className="hlabel">{fmtTimeShort(`${h}:00`)}</span>}
          </div>
        ))}
        {isToday && (
          <div className="vnow" style={{ top: y(nowMin) }} aria-hidden="true">
            <span className="vnow-dot" /><span className="vnow-label mono">now</span>
          </div>
        )}
        {pinned.map((t) => (
          <div className="vev vev-task" key={t.id} style={{ top: y(minutesOf(`${day}T${t.at}:00`)) + 1, minHeight: 24, maxHeight: capped(y(minutesOf(`${day}T${t.at}:00`)), 9999) }}>
            <span className="t">{t.title}</span>
            <span className="rng">{fmtTime(t.at!)} · planned</span>
          </div>
        ))}
        {liveMin > 0 && (
          <div className="vev vev-live" style={{ top: y(Math.max(0, nowMin - liveMin)) + 1, height: capped(y(Math.max(0, nowMin - liveMin)), Math.max((liveMin / 60) * HOUR_PX - 2, 24)) }}>
            <span className="t">{pomo.focusLabel ?? 'Focus'}</span>
            <span className="rng">running, {fmtDuration(liveMin)} so far</span>
          </div>
        )}
        {moments.map((m, i) => {
          const start = m.minutes ? minutesOf(m.at) - m.minutes : minutesOf(m.at)
          return m.minutes ? (
            <div className={`vev vev-done k-${m.kind}`} key={i}
              style={{ top: y(Math.max(0, start)) + 1, height: capped(y(Math.max(0, start)), Math.max((m.minutes / 60) * HOUR_PX - 2, 24)) }}>
              <span className="t">{m.title}</span>
              <span className="rng">{fmtTime(`${Math.floor(start / 60)}:${String(start % 60).padStart(2, '0')}`)} · {fmtDuration(m.minutes)}</span>
            </div>
          ) : (
            <div className={`vmark k-${m.kind}`} key={i} style={{ top: y(minutesOf(m.at)) }}>
              <span className="vmark-dot" aria-hidden="true" />
              <span className="vmark-t">{m.title}</span>
            </div>
          )
        })}
      </div>
      </div>
    </>
  )
}

/** Which days have anything finished on them, and how much. */
function useDayCounts(): Map<string, number> {
  const { tasks, habitLog, routineLog, focusSessions, habits, routines, inView } = useStore()
  return useMemo(() => {
    const m = new Map<string, number>()
    const add = (day: string) => m.set(day, (m.get(day) ?? 0) + 1)
    for (const t of tasks) if (t.done && t.doneAt && inView(t.space)) add(localDateKey(new Date(t.doneAt)))
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
  const { openDay } = useStore()
  const [selected, setSelected] = useState(localDateKey())
  /* ONE month on show, moved with the arrows. Four at once buried the one that
     matters under three walls of numbers. */
  const [from, setFrom] = useState(0)
  const counts = useDayCounts()
  const isToday = selected === localDateKey()
  const doneOn = counts.get(selected) ?? 0

  const now = new Date()
  const shown = new Date(now.getFullYear(), now.getMonth() + from, 1)
  const month = { year: shown.getFullYear(), month: shown.getMonth() }

  return (
    <div className="page">
      <Band
        title="Calendar"
        metrics={doneOn > 0 ? [{ v: String(doneOn), k: `finished ${isToday ? 'today' : fmtWhen(selected)}`, tone: 'pos' as const }] : []}
        actions={
          <span className="cal-nav">
            <button className="btn btn-ghost" onClick={() => setFrom((f) => f - 1)} aria-label="Previous month">←</button>
            <button className="btn btn-ghost" onClick={() => { setFrom(0); setSelected(localDateKey()) }} disabled={from === 0}>Now</button>
            <button className="btn btn-ghost" onClick={() => setFrom((f) => f + 1)} aria-label="Next month">→</button>
          </span>
        }
      />

      <div className="grid-3 cal-cols">
        {/* 1 — the picked day, on the clock */}
        <div className="panel">
          <div className="col-head">
            <span className="microcap">{isToday ? 'Today' : fmtWhen(selected)}</span>
            <button className="linkish" onClick={() => openDay(selected)}>Open the day record</button>
          </div>
          <DaySchedule day={selected} />
        </div>

        {/* 2+3 — four months of the record */}
        <div className="cal-wide">
          <div className="cal-months one">
            <MonthGrid year={month.year} month={month.month}
              selected={selected} counts={counts} onPick={setSelected} />
          </div>
        </div>
      </div>
    </div>
  )
}
