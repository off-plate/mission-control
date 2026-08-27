/* THE TIMELINE.

   His brief, 2026-08-27: a vertical line you scroll, days and weeks and months
   on either side of it, so that being consistent day by day visibly adds up to
   being somewhere better later.

   The critique he was given before picking this one, and the reason the page is
   built the way it is rather than as a scrapbook: a timeline of the FUTURE is a
   plan, and a plan is fiction. A page of intentions asserts that consistency
   compounds and never shows it. So:

     - everything ABOVE the now line is MEASURED, out of his own habit log,
       focus sessions and finished tasks. Nothing there is invented.
     - everything BELOW it is PROJECTED from the rate those measurements
       actually produce, never from a rate that would look better.
     - the header carries the gap: what the measured rate delivers by the
       horizon against what a higher one would. That single number is the only
       thing on the page that argues for doing tonight's thing tonight.

   The rate is deliberately the simplest defensible one, and the page says so in
   words: daily habits only, kept over due, across the window. Weekly and
   monthly habits are left out of the denominator because attributing them to a
   particular day is a guess, and a guess in the denominator would quietly move
   every number on the page. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './store'
import { localDateKey } from './util'
import type { HabitDef, HabitTick, Task } from './types'

type Zoom = 'day' | 'week' | 'month'

/** The comparison rate the gap is measured against. Named once, shown in the UI. */
const BETTER = 0.8
/** How far back each zoom measures, and how far ahead it projects. */
const SPAN: Record<Zoom, { back: number; ahead: number }> = {
  day: { back: 21, ahead: 10 },
  week: { back: 10, ahead: 8 },
  month: { back: 8, ahead: 6 },
}
/** The window the rate itself is measured over, in days. */
const RATE_WINDOW = 30

const dayKey = (d: Date) => localDateKey(d)
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }

type Bucket = {
  id: string
  label: string
  when: 'past' | 'future'
  kept: number
  due: number
  focusMin: number
  done: number
  /** Only on future buckets: what the measured rate produces here. */
  projected?: number
}

export function TimelinePage() {
  const { habits, habitLog, focusSessions, tasks, inView } = useStore()
  const [zoom, setZoom] = useState<Zoom>('day')

  /* Daily habits only, and only the ones in view. See the note at the top: a
     weekly habit cannot be honestly attributed to a Tuesday. */
  const daily: HabitDef[] = useMemo(
    () => habits.filter((h) => inView(h.space) && !h.archivedAt && !h.paused && h.kind !== 'break' && h.frequency === 'daily'),
    [habits, inView],
  )
  const dailyIds = useMemo(() => new Set(daily.map((h) => h.id)), [daily])

  /* One pass over the log, then everything below is a lookup. */
  const keptByDay = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const t of habitLog as HabitTick[]) {
      if (!dailyIds.has(t.habitId)) continue
      if (!m.has(t.day)) m.set(t.day, new Set())
      m.get(t.day)!.add(t.habitId)
    }
    return m
  }, [habitLog, dailyIds])

  const focusByDay = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of focusSessions) {
      if (!inView(f.space)) continue
      m.set(f.day, (m.get(f.day) ?? 0) + f.minutes)
    }
    return m
  }, [focusSessions, inView])

  const doneByDay = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of tasks as Task[]) {
      if (!t.done || !t.doneAt || !inView(t.space)) continue
      const k = localDateKey(new Date(t.doneAt))
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  }, [tasks, inView])

  /* THE RATE. Kept over due across the window, out of the log and nothing else.
     If he has no daily habits there is no rate, and the page says that rather
     than dividing by zero and printing a confident 0%. */
  const { rate, measuredDays } = useMemo(() => {
    if (daily.length === 0) return { rate: null as number | null, measuredDays: 0 }
    const today = new Date()
    let kept = 0
    for (let i = 1; i <= RATE_WINDOW; i++) kept += keptByDay.get(dayKey(addDays(today, -i)))?.size ?? 0
    return { rate: kept / (daily.length * RATE_WINDOW), measuredDays: RATE_WINDOW }
  }, [daily, keptByDay])

  const buckets = useMemo<Bucket[]>(() => {
    const today = new Date()
    const out: Bucket[] = []
    const span = SPAN[zoom]
    const size = zoom === 'day' ? 1 : zoom === 'week' ? 7 : 30

    const gather = (from: Date, days: number) => {
      let kept = 0, focusMin = 0, done = 0
      for (let i = 0; i < days; i++) {
        const k = dayKey(addDays(from, i))
        kept += keptByDay.get(k)?.size ?? 0
        focusMin += focusByDay.get(k) ?? 0
        done += doneByDay.get(k) ?? 0
      }
      return { kept, focusMin, done, due: daily.length * days }
    }
    const label = (start: Date, days: number) =>
      zoom === 'day' ? start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })
        : zoom === 'week' ? `Week of ${start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
          : start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

    for (let b = span.back; b >= 1; b--) {
      const start = addDays(today, -(b * size))
      const g = gather(start, size)
      out.push({ id: `p${b}`, label: label(start, size), when: 'past', ...g })
    }
    for (let f = 0; f < span.ahead; f++) {
      const start = addDays(today, 1 + f * size)
      const due = daily.length * size
      out.push({
        id: `f${f}`, label: label(start, size), when: 'future',
        kept: 0, due, focusMin: 0, done: 0,
        projected: rate == null ? 0 : Math.round(due * rate),
      })
    }
    return out
  }, [zoom, keptByDay, focusByDay, doneByDay, daily, rate])

  /* The gap, in kept ticks, between the measured rate and a better one across
     everything the page projects.

     Summed OFF THE ROWS, never recomputed from the total. Each row rounds its
     own projection, and rounding per row then adding is not the same number as
     adding then rounding: the first version had the header claim 35 while the
     rows under it added to 40. A page whose whole argument is an honest
     projection cannot contradict itself in its own headline, so both figures
     here are built the same way the rows are. */
  const gap = useMemo(() => {
    if (rate == null) return null
    const future = buckets.filter((b) => b.when === 'future')
    const mine = future.reduce((a, b) => a + (b.projected ?? 0), 0)
    const better = future.reduce((a, b) => a + Math.round(b.due * BETTER), 0)
    return { mine, better, ahead: future.reduce((a, b) => a + b.due, 0) }
  }, [buckets, rate])

  return (
    <div className="page tline">
      <header className="tl-band">
        <h1>Timeline</h1>
        <div className="tl-zoom" role="group" aria-label="Zoom">
          {(['day', 'week', 'month'] as Zoom[]).map((z) => (
            <button key={z} className={z === zoom ? 'on' : ''} aria-pressed={z === zoom} onClick={() => setZoom(z)}>
              {z === 'day' ? 'Days' : z === 'week' ? 'Weeks' : 'Months'}
            </button>
          ))}
        </div>
        <div className="tl-rate">
          <p className="tl-l">Kept</p>
          <span className="tl-n">{rate == null ? '—' : `${Math.round(rate * 100)}%`}</span>
          <p className="tl-l">of {daily.length} daily habits, last {measuredDays} days</p>
        </div>
      </header>

      {rate == null ? (
        <p className="tl-empty">No daily habits in this workspace yet, so there is no rate to carry forward.
        Add one on Habits and this page starts measuring from the next tick.</p>
      ) : (
        <p className="tl-gap">
          {/* TICKS, not days. The rows count one tick per daily habit per day,
              so with {daily.length} of them a "day" and a "tick" are wildly
              different units and calling the total days would overstate it by
              that factor. The unit on the headline is the unit on the rows. */}
          Ahead of today this page projects <b>{gap!.mine}</b> habit ticks at your measured rate.
          At {Math.round(BETTER * 100)}% it would be <b>{gap!.better}</b>.
          <span className="tl-delta">The difference is {Math.max(0, gap!.better - gap!.mine)} ticks, across {daily.length} daily habits.</span>
        </p>
      )}

      <Spine buckets={buckets} zoom={zoom} rate={rate} />
    </div>
  )
}

function Spine({ buckets, zoom, rate }: { buckets: Bucket[]; zoom: Zoom; rate: number | null }) {
  const wrap = useRef<HTMLDivElement>(null)
  /* Reveal on scroll. Re-run on every zoom change, because the rows are new
     nodes and the old observer is watching elements that no longer exist. */
  useEffect(() => {
    const rows = wrap.current?.querySelectorAll('.tl-row')
    if (!rows?.length) return
    if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      rows.forEach((r) => r.classList.add('in'))
      return
    }
    const io = new IntersectionObserver((es) => {
      es.forEach((e, i) => {
        if (!e.isIntersecting) return
        window.setTimeout(() => e.target.classList.add('in'), i * 45)
        io.unobserve(e.target)
      })
    }, { rootMargin: '0px 0px -10% 0px' })
    rows.forEach((r) => io.observe(r))
    return () => io.disconnect()
  }, [buckets, zoom])

  const unit = zoom === 'day' ? 'day' : zoom === 'week' ? 'week' : 'month'
  return (
    <div className="tl-wrap" ref={wrap}>
      <div className="tl-spine" aria-hidden="true" />
      {buckets.map((b, i) => {
        const past = b.when === 'past'
        const share = b.due > 0 ? (past ? b.kept : (b.projected ?? 0)) / b.due : 0
        const full = past && b.due > 0 && b.kept >= b.due
        const empty = past && b.kept === 0
        return (
          <div key={b.id}>
            {i === buckets.findIndex((x) => x.when === 'future') && (
              <div className="tl-now"><span className="tl-nowdot">NOW</span></div>
            )}
            <div className={`tl-row ${i % 2 ? 'right' : 'left'}${past ? '' : ' future'}${full ? ' full' : ''}${empty ? ' empty' : ''}`}>
              <article className="tl-card">
                <h2>{b.label}</h2>
                <div className="tl-meter" aria-hidden="true"><i style={{ width: `${Math.round(Math.min(1, share) * 100)}%` }} /></div>
                <p className="tl-fig">
                  <span className="tl-n">{past ? b.kept : b.projected}</span>
                  <span className="tl-of">/ {b.due} habit {b.due === 1 ? 'tick' : 'ticks'}</span>
                </p>
                {past && (b.focusMin > 0 || b.done > 0) && (
                  <p className="tl-extra">
                    {b.focusMin > 0 && <span>{Math.floor(b.focusMin / 60)}h {String(b.focusMin % 60).padStart(2, '0')}m focused</span>}
                    {b.done > 0 && <span>{b.done} finished</span>}
                  </p>
                )}
                {!past && rate != null && (
                  <p className="tl-extra"><span>your rate, carried forward</span></p>
                )}
              </article>
              <span className="tl-node" aria-hidden="true" />
            </div>
          </div>
        )
      })}
      <p className="tl-foot">
        Above the line is measured, one {unit} at a time, out of your own log.
        Below it is the same rate carried forward and nothing else.
      </p>
    </div>
  )
}
