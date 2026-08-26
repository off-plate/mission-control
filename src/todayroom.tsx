/* THE TODAY ROOM.

   Michael, 2026-08-26, on the page this replaces: "it lacks half of the things
   that there should be", the numbers he cares about were "written small", and
   the whole thing read as "AI slop from the beginning to the end". He gave a
   dark financial dashboard as the reference and asked for the day to feel
   finite: a countdown with seconds, the day drawn as dots, and the lists deep
   enough to be worth reading.

   Two rules govern everything in here, and both come from him:

   1. NO SUBTITLES, and that is not a style preference. A block is a LABEL and a
      FIGURE. Nothing sits under a number to explain what the number already
      says. If you are about to add a sentence to a card, the card is wrong.
   2. Every list shows TEN rows, not three. He asked for the depth twice.

   It is a dark slab inset in the warm paper app. It does not repaint the
   shell. The Zone can afford to take the whole window because you enter it on
   purpose; Today is the landing page, and making the header flip between paper
   and ink on every navigation would be worse than anything it fixed. The
   reference does the same thing: a dark dashboard sitting on a light desktop.
   Every token in here is scoped to `.troom` so none of it leaks. */
import { useEffect, useState } from 'react'
import { useStore } from './store'
import { useFirstMove } from './ui'
import { fmtDuration, fmtNum, fmtSigned, goalPace, goalPeriodKey, goalPeriodRange, isEstimated, localDateKey, taskMinutes, type GoalTf } from './util'
import { SLOTS, dueOn, goalCurrent, habitsDueToday, isTimeFed, type Task } from './types'
import { WeekStrip } from './dayface'

/* A pasted spreadsheet link is an address, not a title. Left raw it took three
   lines of the Next card and pushed the card off the right of the room. The
   host and first segment are enough to recognise it. */
const URL_RE = /https?:\/\/[^\s]+/g
function shortTitle(raw: string): string {
  return raw.replace(URL_RE, (u) => {
    try {
      const url = new URL(u)
      const seg = url.pathname.split('/').filter(Boolean)[0]
      return url.hostname.replace(/^www\./, '') + (seg ? '/' + seg : '')
    } catch { return u }
  }).trim()
}

/** Whole days since a task was written down. Avoidance is measured in age, never in a due date. */
function ageDays(t: Task): number {
  if (t.addedAt) return Math.max(0, Math.floor((Date.now() - t.addedAt) / 86400000))
  if (!t.createdAt) return 0
  const [y, m, d] = t.createdAt.split('-').map(Number)
  return Math.max(0, Math.round((Date.now() - new Date(y, m - 1, d).getTime()) / 86400000))
}

/* The five named parts of a day, and how long each one actually lasts. The
   markers under the dot field are weighted by these, so a marker sits under
   the quarter hours it owns instead of under an equal fifth of the row. */
const PHASES = [
  { id: 'night', label: 'Night', from: 0, to: 6 },
  { id: 'morning', label: 'Morning', from: 6, to: 11 },
  { id: 'noon', label: 'Noon', from: 11, to: 14 },
  { id: 'afternoon', label: 'Afternoon', from: 14, to: 18 },
  { id: 'evening', label: 'Evening', from: 18, to: 24 },
]

/** Ticks once a second, because a countdown that only moves by the minute is a clock. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
  return Math.ceil(((+t - +new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 86400000 + 1) / 7)
}

export function TodayRoom() {
  const { tasks, habits, habitLog, routines, focusSessions, goals, slips, savedMin, todayIndex, inView, setPage, setFocusTaskId, toggleTask, toggleHabitDay } = useStore()
  const now = useNow()
  const firstMove = useFirstMove()
  const day = localDateKey()

  const mins = now.getHours() * 60 + now.getMinutes()
  const quarter = Math.floor(mins / 15)
  const pct = Math.round((mins / 1440) * 100)
  const msLeft = new Date(now).setHours(24, 0, 0, 0) - +now
  const h = Math.floor(msLeft / 3600000)
  const m = Math.floor((msLeft % 3600000) / 60000)
  const s = Math.floor((msLeft % 60000) / 1000)
  const phase = PHASES.find((p) => now.getHours() >= p.from && now.getHours() < p.to) ?? PHASES[0]

  const mine = tasks.filter((t) => inView(t.space))
  /* On the clock: what he actually put into today, in the order the day runs. */
  const slotRank = Object.fromEntries(SLOTS.map((sl, i) => [sl.id, i])) as Record<string, number>
  const onClock = mine
    .filter((t) => t.list === 'today' && (t.plannedOn ?? day) === day)
    .sort((a, b) => Number(a.done) - Number(b.done) || (slotRank[a.slot ?? ''] ?? 9) - (slotRank[b.slot ?? ''] ?? 9))
    .slice(0, 10)
  const clockLeft = onClock.filter((t) => !t.done).length

  /* The to-do: everything waiting in the list, newest thinking first. */
  const todo = mine.filter((t) => t.list === 'backlog' && !t.done).sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)).slice(0, 10)
  const todoTotal = mine.filter((t) => t.list === 'backlog' && !t.done).length

  /* Standing: not a re-sort of the to-do, a different question. Only work that
     has been sitting for a fortnight counts, so this column says "you are
     avoiding these", and does not repeat the list above it in another order. */
  const STANDING_DAYS = 14
  const standingAll = mine
    .filter((t) => !t.done).map((t) => ({ t, d: ageDays(t) }))
    .filter((x) => x.d >= STANDING_DAYS)
    .sort((a, b) => b.d - a.d)
  const standing = standingAll.slice(0, 10)

  /* The four numbers, derived EXACTLY as the strip they replaced derived them.
     Two of these are not obvious and both were fixed once already:

     - focused counts only blocks in the spaces currently in view, or the figure
       disagrees with itself when he switches space;
     - finished reads `doneAt` through the LOCAL date key, never `plannedOn` and
       never the raw UTC slice. `doneAt` is a UTC instant, so its first ten
       characters are a day behind Prague for the two hours after midnight,
       which is exactly when he finishes a late block. Copying the shape of this
       line, instead of the line itself, is how that bug comes back. */
  const focusedMin = focusSessions.filter((f) => f.day === day && inView(f.space)).reduce((a, f) => a + f.minutes, 0)
  const visibleHabits = habits.filter((hb) => inView(hb.space) && !hb.archivedAt)
  const { due, kept } = habitsDueToday(visibleHabits, routines, habitLog, todayIndex)
  const finished = tasks.filter((t) => t.done && inView(t.space) && t.doneAt && localDateKey(new Date(t.doneAt)) === day).length

  /* Which quarter hours already have something in them, so the day field shows
     where the work sits and not only where the clock is. */
  const busy = new Set<number>()
  for (const t of onClock) {
    const i = SLOTS.findIndex((sl) => sl.id === t.slot)
    if (i >= 0) busy.add(Math.floor((SLOTS[i].from ?? 0) * 4))
  }

  /* And where he actually focused. This is the one thing the old day line drew
     that nothing else did: a block at the minute it happened. `at` is the
     instant the block FINISHED, so the span runs backwards from it by its own
     length, which is why the start is `at` less `minutes`. */
  const focusQ = new Set<number>()
  for (const f of focusSessions) {
    if (f.day !== day || !f.at) continue
    const end = new Date(f.at)
    if (Number.isNaN(+end)) continue
    const endMin = end.getHours() * 60 + end.getMinutes()
    const startMin = endMin - (f.minutes ?? 0)
    for (let q = Math.floor(startMin / 15); q < Math.ceil(endMin / 15); q++) {
      if (q >= 0 && q < 96) focusQ.add(q)
    }
  }

  /* A ROUTINE IS NOT A HABIT, and this card used to say it was.

     His report: Morning Preparation, After wake up and the rest were listed as
     habits with checkboxes beside them. They are routines, and each one is a
     folder of habits. The old filter dropped the habits INSIDE folders and then
     kept each routine's OWN habit, which exists only to carry that routine's
     streak, so the two categories arrived mixed under one heading.

     The split below comes straight from `habitsDueToday`: folders on one side,
     what it calls `loose` on the other. It matters beyond
     tidiness, because a routine cannot be ticked. It finishes when its steps
     do, so it gets progress and a way in, and never a checkbox. */
  const dueRaw = visibleHabits.filter((hb) => dueOn(hb, todayIndex, habitLog))
  const ownHabitIds = new Set(routines.map((r) => r.habitId).filter(Boolean) as string[])

  const routineRows = [...new Set(dueRaw.map((hb) => hb.folderId).filter(Boolean) as string[])]
    .map((id) => {
      const r = routines.find((x) => x.id === id)
      // Optional steps never hold a routine open, exactly as the Habits page counts it.
      const need = dueRaw.filter((hb) => hb.folderId === id && !hb.optional)
      return { id, name: r?.title ?? 'Routine', total: need.length, done: need.filter((hb) => hb.days[todayIndex]).length }
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => a.done / a.total - b.done / b.total)

  /* Loose: no folder, and not a routine's own streak-carrying habit. These are
     the only things on this card he ticks directly. */
  const habitRows = dueRaw
    .filter((hb) => !hb.folderId && !ownHabitIds.has(hb.id))
    .map((hb) => ({ hb, done: !!hb.days[todayIndex] }))
    .sort((a, b) => Number(a.done) - Number(b.done))
    .slice(0, 10)
  const routinesDone = routineRows.filter((r) => r.done === r.total).length

  /* Goals, on the same accurate read GoalsPage uses: a habit-linked goal counts
     from the dated log inside its OWN period, never the seven-day cache. */
  const goalRows = goals.filter((g) => !g.closed && inView(g.space)).slice(0, 5).map((g) => {
    const tf = (g.timeframe ?? 'quarter') as GoalTf
    const range = goalPeriodRange(tf, g.periodKey ?? goalPeriodKey(tf))
    const cur = goalCurrent(g, habits, habitLog, range, slips, focusSessions)
    const fromHabit = habits.find((hb) => hb.id === g.habitId)
    const off = goalPace(cur, g.target, tf, new Date(), !!fromHabit && !isTimeFed(fromHabit)) === 'behind'
    return { g, cur, off, pct: g.target > 0 ? Math.min(100, Math.round((cur / g.target) * 100)) : 0 }
  })

  const start = (t: Task) => { setFocusTaskId(t.id); setPage('plan') }

  return (
    <div className="troom">

      {/* ---- the figures ---- */}
      <section className="troom-hero">
        <div className="tr-card tr-card--ink tr-clock">
          <div>
            <p className="tr-l">Left of today</p>
            <div className="tr-n tr-count">
              {h}<span className="tr-u">h</span>{String(m).padStart(2, '0')}<span className="tr-u">m</span>
              <span className="tr-hot">{String(s).padStart(2, '0')}</span><span className="tr-u">s</span>
            </div>
          </div>
          {/* The wall clock. It carried its own card on the old page; it is a
              figure about time, so it belongs beside the other one. */}
          <div className="tr-wall">
            <p className="tr-l">Now</p>
            <div className="tr-n tr-nowt">{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        </div>
        <div className="tr-card tr-card--hover tr-tile">
          <p className="tr-l">{now.toLocaleDateString('en-GB', { weekday: 'long' })}</p>
          <div className="tr-n">{now.getDate()}<span className="tr-mo">{now.toLocaleDateString('en-GB', { month: 'short' })}</span></div>
        </div>
        <div className="tr-card tr-card--hover tr-tile">
          <p className="tr-l">Week</p>
          <div className="tr-n">{isoWeek(now)}</div>
        </div>
        <div className="tr-card tr-card--hover tr-tile is-hot">
          <p className="tr-l">Day gone</p>
          <div className="tr-n">{pct}%</div>
          <div className="tr-bar"><i style={{ width: `${pct}%` }} /></div>
        </div>
        <div className="tr-card tr-card--hover tr-tile is-hot">
          <p className="tr-l">Phase</p>
          <div className="tr-n tr-phase">{phase.label}</div>
        </div>
      </section>

      {/* ---- the day, 96 quarter hours ---- */}
      <section className="tr-card tr-day">
        <div className="tr-head">
          <p className="tr-l">The day</p>
          <span className="tr-count-inline"><span className="tr-n">{96 - quarter}</span><span className="tr-l">quarters left</span></span>
        </div>
        <div className="tr-dots">
          {Array.from({ length: 96 }, (_, i) => (
            <span
              key={i}
              data-q={i}
              className={`tr-q${focusQ.has(i) ? ' is-focus' : ''}${i < quarter ? ' is-spent' : i === quarter ? ' is-now' : busy.has(i) ? ' is-busy' : ''}`}
            />
          ))}
        </div>
        <div className="tr-phases">
          {PHASES.map((p) => (
            <span key={p.id} className={`tr-ph${p.id === phase.id ? ' is-on' : ''}`} style={{ flex: p.to - p.from }}>{p.label}</span>
          ))}
        </div>
      </section>

      {/* ---- next ---- */}
      {firstMove && (
        <section className="tr-card tr-next">
          <div className="tr-head">
            <p className="tr-l">Next</p>
            {isEstimated(firstMove) && firstMove.estimateMin > 0 && <span className="tr-n tr-sm">{fmtDuration(taskMinutes(firstMove))}</span>}
          </div>
          <p className="tr-nextt">{shortTitle(firstMove.title)}</p>
          <div className="tr-chips">
            <span className="tr-chip">{ageDays(firstMove)} days</span>
            <button className="tr-start" onClick={() => start(firstMove)}><span>Start</span></button>
          </div>
        </section>
      )}

      {/* ---- the three lists ---- */}
      <section className="troom-lists">
        <div className="tr-card">
          <div className="tr-head"><p className="tr-l">To-do</p><span className="tr-n tr-sm">{todoTotal}</span></div>
          <div className="tr-rows">
            {todo.length === 0 && <p className="tr-empty">Nothing waiting.</p>}
            {todo.map((t) => (
              <div className="tr-r" key={t.id}>
                <button className="tr-box" role="checkbox" aria-checked={false} aria-label={t.title} onClick={() => toggleTask(t.id)} />
                <span className="tr-t">{t.title}</span>
                <span className="tr-age is-cool">{ageDays(t)}<u>d</u></span>
              </div>
            ))}
          </div>
        </div>

        <div className="tr-card">
          <div className="tr-head"><p className="tr-l">On the clock</p><span className="tr-n tr-sm">{clockLeft}<i>/{onClock.length}</i></span></div>
          <div className="tr-rows">
            {onClock.length === 0 && <p className="tr-empty">Nothing planned into today.</p>}
            {onClock.map((t) => (
              <div className={`tr-r${t.done ? ' is-done' : ''}`} key={t.id}>
                <span className="tr-tick" aria-hidden="true" />
                <span className="tr-slot">{SLOTS.find((sl) => sl.id === t.slot)?.label ?? '—'}</span>
                <span className="tr-t">{t.title}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="tr-card">
          <div className="tr-head"><p className="tr-l">Standing</p><span className="tr-n tr-sm is-hot">{standingAll.length}</span></div>
          <div className="tr-rows">
            {standing.length === 0 && <p className="tr-empty">Nothing has been waiting two weeks.</p>}
            {standing.map(({ t, d }) => (
              <div className="tr-r" key={t.id}>
                <span className={`tr-age${d >= 30 ? '' : ' is-cool'}`}>{d}<u>d</u></span>
                <span className="tr-t">{t.title}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- the four numbers ---- */}
      <section className="troom-stats">
        <div className="tr-card tr-stat" data-stat="focused">
          <p className="tr-l k">Focused</p>
          <div className="tr-n v">{focusedMin > 0 ? fmtDuration(focusedMin) : '\u2014'}</div>
          <div className="tr-bar"><i style={{ width: `${Math.min(100, Math.round((focusedMin / 240) * 100))}%` }} /></div>
        </div>
        <div className="tr-card tr-stat" data-stat="habits">
          <p className="tr-l k">Habits</p>
          <div className="tr-n v">{kept}<i>/{due}</i></div>
          <div className="tr-pips">
            {Array.from({ length: Math.min(Math.max(due, 1), 24) }, (_, i) => <i key={i} className={i < kept ? 'is-on' : ''} />)}
          </div>
        </div>
        <div className="tr-card tr-card--lime tr-stat" data-stat="finished">
          <p className="tr-l k">Finished</p>
          <div className="tr-n v">{finished}</div>
          <div className="tr-bar"><i style={{ width: `${Math.min(100, finished * 20)}%` }} /></div>
        </div>
        <div className="tr-card tr-stat" data-stat="estimates">
          <p className="tr-l k">{savedMin < 0 ? 'Over estimate' : 'Against estimate'}</p>
          <div className={`tr-n v${savedMin < 0 ? ' is-hot' : ''}`}>{savedMin === 0 ? '\u2014' : fmtSigned(savedMin)}</div>
        </div>
      </section>

      {/* ---- habits, goals, and the week behind ---- */}
      <section className="troom-lower">
        <div className="tr-card tr-ritual">
          <div className="tr-head"><p className="tr-l">Routines</p>
            <span className="tr-n tr-sm">{routinesDone}<i>/{routineRows.length}</i></span></div>
          <div className="tr-strip">
            {routineRows.length === 0 && <p className="tr-empty">No routine is due today.</p>}
            {routineRows.map((r) => (
              <button className="tr-rt" key={r.id} onClick={() => setPage('habits')} aria-label={`${r.name}, ${r.done} of ${r.total} done`}>
                <span className="tr-rtn">{r.name}</span>
                <span className="tr-rtb"><i style={{ width: `${(r.done / r.total) * 100}%` }} /></span>
                <span className="tr-rtc">{r.done}<i>/{r.total}</i></span>
              </button>
            ))}
          </div>
          <div className="tr-rule" />
          <div className="tr-head"><p className="tr-l">Habits</p>
            <span className="tr-n tr-sm">{habitRows.filter((h) => h.done).length}<i>/{habitRows.length}</i></span></div>
          <div className="tr-rows">
            {habitRows.length === 0 && <p className="tr-empty">Nothing due today.</p>}
            {habitRows.map(({ hb, done }) => (
              <div className={`tr-r${done ? ' is-done' : ''}`} key={hb.id}>
                <button
                  className={`tr-box${done ? ' is-on' : ''}`}
                  role="checkbox"
                  aria-checked={done}
                  aria-label={hb.name}
                  onClick={() => toggleHabitDay(hb.id, todayIndex)}
                />
                <span className="tr-t">{hb.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="tr-card">
          <div className="tr-head"><p className="tr-l">Goals</p><span className="tr-n tr-sm">{goalRows.filter((r) => r.off).length ? `${goalRows.filter((r) => r.off).length} behind` : 'on pace'}</span></div>
          <div className="tr-goals">
            {goalRows.length === 0 && <p className="tr-empty">No goals in this space.</p>}
            {goalRows.map(({ g, cur, off, pct }) => (
              <div className="tr-goal" key={g.id}>
                <div className="tr-goalhead">
                  <span className="tr-t">{g.name}</span>
                  <span className={`tr-n tr-pct${off ? ' is-hot' : ''}`}>{pct}%</span>
                </div>
                <div className="tr-bar"><i className={off ? 'is-off' : ''} style={{ width: `${pct}%` }} /></div>
                <p className="tr-l tr-of">{fmtNum(cur)} of {fmtNum(g.target)} {g.unit}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="tr-card tr-week">
          <div className="tr-head"><p className="tr-l">The week behind</p></div>
          <WeekStrip />
        </div>
      </section>

    </div>
  )
}
