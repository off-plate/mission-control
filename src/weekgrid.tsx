/* THE ALMANAC. Shared by both places the week shows up: Plan's collapsible
   fold, and Today's always-open one. Its own module rather than living
   inside pages1.tsx, because Today's version is rendered from todayroom.tsx,
   and pages1.tsx already imports TodayRoom from there -- pulling WeekGrid the
   other way (todayroom.tsx importing pages1.tsx) would have made the two
   files import each other. */
import { useMemo } from 'react'
import { SLOTS, type DayTaskLog, type Task } from './types'
import { fmtDuration, localDateKey, taskMinutes } from './util'

/** Any date `n` days from today, local calendar, careful about DST and month
 *  ends the same way every other date arithmetic in this file already is. */
export function dayPlus(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return localDateKey(d)
}

/** How far he can step the day panel forward: today plus this many days. His
 *  ask, 2026-08-28: "instead of today, tomorrow... it would show... seven
 *  days ahead." Today is the first of the seven, so six more follow it. */
export const PLAN_AHEAD_DAYS = 6

/** What the week card's ring calls a full day: four hours planned, the same
 *  reachable shape the momentum work on Timeline settled on rather than a
 *  number invented fresh here. */
const WEEK_CAPACITY_MIN = 240

/** 'Mon 3 Aug' for a date key. */
export const shortDay = (key: string): string => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

/** 'Mon 24 – Sun 30 Aug', or 'Mon 31 Aug – Sun 6 Sep' across a month end: the
 *  month is dropped from the first date only when it would just repeat the
 *  second one right next to it. */
export const weekRangeLabel = (from: string, to: string): string => {
  const [, fm] = from.split('-')
  const [, tm] = to.split('-')
  const first = shortDay(from)
  return `${fm === tm ? first.replace(/ \w+$/, '') : first} – ${shortDay(to)}`
}

/** The week card's load ring: a plain stroke circle with an accent arc laid
 *  over it for the share of a full day that is planned. Radius and stroke
 *  scale with the ring's own box so one component serves every card size. */
/* Two different questions, same ring, same color. Today and future days ask
   "how full is this day" against WEEK_CAPACITY_MIN; past days ask "how much
   of what I planned actually got done" (his instruction 2026-08-31: a past
   day is a record, not a load). A green variant for past days shipped first
   and came right back out on his word -- one ring color everywhere, the
   section's own lime accent, no second color to tell the two questions apart
   by sight. */
function WeekRing({ pct, size = 34 }: { pct: number; size?: number }) {
  const sw = Math.max(3, Math.round(size * 0.12))
  const r = size / 2 - sw
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--wk-line-2)" strokeWidth={sw} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--wk-hot)" strokeWidth={sw}
        strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  )
}

/* The seven day-cards themselves. Pulled out so Plan and Today never drift
   into two slightly different readings of the same tasks -- the ring math
   and the Done-group fallback here are exactly what Plan's fold was built
   and hardened against, one bug at a time. Read-only: a day's header is the
   one thing that does anything, via onDayClick. */
export function WeekGrid({
  weekDays, weekTasks, spaceTasks, dayLog, today, daysOut, reachableMax, onDayClick,
}: {
  weekDays: string[]
  weekTasks: Task[]
  spaceTasks: Task[]
  dayLog: DayTaskLog[]
  today: string
  daysOut: (iso: string) => number
  reachableMax: number
  onDayClick: (iso: string) => void
}) {
  /* Today's card renders this from TodayRoom, which re-renders once a
     second off its own clock (see useNow in todayroom.tsx) -- with the
     dnum/name pair recomputed inline, that was 7 `new Date` constructions
     and 7 Intl.DateTimeFormat calls a second for a date that only actually
     changes at midnight. weekDays itself is a fresh array every one of
     those renders (TodayRoom builds it with Array.from, not memoized), so
     the dependency here is the dates' own content, not the array's
     identity -- otherwise this would never hit its cache. */
  const dayMeta = useMemo(
    () => new Map(weekDays.map((iso) => [
      iso,
      { dnum: iso.split('-')[2], name: new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' }) },
    ])),
    [weekDays.join(',')],
  )
  return (
    <div className="weekplan-grid">
      {weekDays.map((iso) => {
        const { dnum, name } = dayMeta.get(iso)!
        const dayTasks = weekTasks.filter((t) => (t.plannedOn ?? today) === iso)
        const totalMin = dayTasks.filter((t) => !t.done).reduce((a, t) => a + taskMinutes(t), 0)
        const pct = Math.min(100, Math.round((totalMin / WEEK_CAPACITY_MIN) * 100))
        const out = daysOut(iso)
        /* Past days lose plannedOn on roll (see roll.ts), so their tasks
           drop out of dayTasks entirely once the day turns over. doneAt
           survives that sweep, so it's the only honest source left for
           what actually got finished that day -- and he wants the tasks
           themselves crossed out here, not a count standing in for them. */
        const doneItems = out < 0
          ? spaceTasks.filter((t) => t.done && t.doneAt?.slice(0, 10) === iso)
          : []
        const doneCount = doneItems.length
        /* Today and future ask "how full is this day" (pct above, against
           WEEK_CAPACITY_MIN). A past day asks something else: "of what I
           planned, how much actually got done" -- his instruction
           (2026-08-31). dayLog has the real ratio for any day sealed since
           this shipped; a day that rolled before it existed has no
           planned-count left to compare against (roll.ts already wiped
           it), so it falls back to counting only what's still knowable --
           full if anything was finished, empty if nothing was. */
        const sealed = out < 0 ? dayLog.find((d) => d.date === iso) : undefined
        const ringPct = out < 0
          ? (sealed ? (sealed.planned > 0 ? Math.round((sealed.done / sealed.planned) * 100) : 0) : (doneCount > 0 ? 100 : 0))
          : pct
        const reachable = out >= 0 && out <= reachableMax
        /* Unsorted is a fifth group now, not a count he cannot read. His
           words: "it doesn't mean if it's unsorted... you still have to
           show" it. Same shape as the other four, same cap, first in the
           list the way the day panel above already orders its own BUCKETS.
           Done is the sixth, past days only, built from doneItems instead
           of dayTasks since roll.ts already emptied that for these days. */
        const groups = [{ id: 'unsorted', label: 'Unsorted' }, ...SLOTS].map((sl) => ({
          slot: sl,
          here: dayTasks.filter((t) => (sl.id === 'unsorted' ? !t.slot : t.slot === sl.id)),
        })).filter((g) => g.here.length)
        if (doneItems.length) groups.push({ slot: { id: 'done', label: 'Done' }, here: doneItems })
        return (
          <div className={`weekplan-day${iso === today ? ' is-today' : ''}${out < 0 ? ' is-past' : ''}`} key={iso}>
            <button
              className="weekplan-daybtn"
              onClick={() => onDayClick(iso)}
              title={reachable ? `Plan ${name} ${Number(dnum)}` : out < 0 ? `See ${name} ${Number(dnum)}` : undefined}
            >
              <WeekRing pct={ringPct} />
              <span className="weekplan-daylabel">
                <span className="weekplan-dayname">{name}</span>
                <span className="weekplan-daynum mono">{Number(dnum)}</span>
              </span>
              <span className="weekplan-daymeta mono">
                {out < 0
                  ? (doneCount > 0 ? `${doneCount} done` : '—')
                  : (totalMin > 0 ? fmtDuration(totalMin) : '—')}
              </span>
            </button>
            {groups.length ? groups.map(({ slot: sl, here }) => (
              <div className="weekplan-slot" key={sl.id}>
                <span className="weekplan-slotname">{sl.label}</span>
                {here.map((t) => (
                  <span className={`weekplan-item${t.done ? ' is-done' : ''}`} key={t.id} title={t.title}>
                    <span className={`cat-dot ${t.category}`} aria-hidden="true" />
                    {t.title}
                  </span>
                ))}
              </div>
            )) : <span className="weekplan-empty">Nothing planned</span>}
          </div>
        )
      })}
    </div>
  )
}
