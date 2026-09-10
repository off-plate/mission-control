/* THE HEALTH PAGE.

   Third pass (2026-09-10). His verdict on the second: "I want a nice graph,
   not this bunch of bullshit", and the sessions still would not open. Both
   were fair, and both came from the same mistake -- one giant chart carrying
   the whole page, reviewed by reading its source instead of looking at it.

   So the structure now comes from the two references he sent: Apple Health's
   Summary, and a card-per-measurement dashboard. Every measurement owns a
   card, and every card carries its own chart. That fixes the fault underneath
   all the others -- six bars stranded in a thousand pixels of white -- because
   a chart the width of a card is dense by construction, and it makes the page
   work the same way for every metric rather than lavishing a hero on one.

   Three rules held throughout, all of them his:
   - A number states what it is. "7-day average", "latest", "7-day total",
     and the day it was taken. Never a figure that could be today or June.
   - Hovering a chart reads it out. The headline becomes that day.
   - A range change moves everything, body included.

   Verified with his real rows in a browser (scripts/hpshot.mjs) before it
   was committed, which is the step the last two passes skipped. */
import { useMemo, useState } from 'react'
import {
  agoFrom, bodyStat, daysSince, fmtDay, fmtDayFull, fmtHm, fmtWeekday, frames, freshness,
  rollUpByDay, series, sessionSeries, totals, useHealth, useHealthSync, withinDays,
  type DayFrame, type MetricKey, type SessionDay, type Session, type WellnessDay,
} from './health'
import * as Icon from './icons'

const SPANS = [
  { id: 7, label: '7D' },
  { id: 30, label: '30D' },
  { id: 90, label: '90D' },
  { id: 365, label: '1Y' },
]

type Point = { day: string; value: number | null }

/* ------------------------------------------------------------------ *
 * CHARTS. Small on purpose. Bars are HTML rather than SVG because a
 * stretched viewBox is what turned the old chart's rounded corners into
 * lozenges and its bars into stripes; a flex row of divs is crisp at
 * every width and gives every day a real hover target for free.
 * ------------------------------------------------------------------ */
function Bars({ points, at, onAt, peak }: {
  points: Point[]; at: number | null; onAt: (i: number | null) => void; peak: number
}) {
  return (
    <div className="hp-bars" onMouseLeave={() => onAt(null)}>
      {points.map((p, i) => {
        const v = p.value ?? 0
        const h = peak > 0 ? Math.max(v > 0 ? 4 : 1.5, (v / peak) * 100) : 1.5
        const top = peak > 0 && v === peak && v > 0
        return (
          <button
            key={p.day}
            className={`hp-bar${at === i ? ' is-at' : ''}${v === 0 ? ' is-zero' : ''}${top ? ' is-peak' : ''}`}
            style={{ height: `${h}%` }}
            onMouseEnter={() => onAt(i)}
            onFocus={() => onAt(i)}
            aria-label={`${fmtDayFull(p.day)}: ${p.value ?? 'nothing'}`}
            type="button"
          />
        )
      })}
    </div>
  )
}

/* The line, for the metrics that are a level rather than a quantity --
   fitness, resting heart rate, weight. Stroke width is held steady with
   non-scaling-stroke so a wide card does not thin the line out. */
function Spark({ points, at, onAt }: { points: Point[]; at: number | null; onAt: (i: number | null) => void }) {
  const W = 300
  const H = 100
  const vals = points.map((p) => p.value).filter((v): v is number => v != null)
  if (vals.length < 2) return <div className="hp-spark is-thin">not enough readings to draw</div>
  const hi = Math.max(...vals)
  const lo = Math.min(...vals)
  const span = hi - lo || 1
  const x = (i: number) => (points.length === 1 ? W / 2 : (i / (points.length - 1)) * W)
  /* Six percent of headroom top and bottom, so a peak is not clipped by the
     edge of its own card and a flat run does not sit welded to the floor. */
  const y = (v: number) => 6 + (1 - (v - lo) / span) * (H - 12)

  let d = ''
  let started = false
  const drawn: number[] = []
  points.forEach((p, i) => {
    if (p.value == null) { started = false; return }
    d += `${started ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)} `
    started = true
    drawn.push(i)
  })
  const first = drawn[0]
  const last = drawn[drawn.length - 1]
  const area = `${d} L ${x(last).toFixed(1)} ${H} L ${x(first).toFixed(1)} ${H} Z`

  return (
    <div className="hp-spark" onMouseLeave={() => onAt(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="hp-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--hp-accent)" stopOpacity="0.26" />
            <stop offset="100%" stopColor="var(--hp-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="hp-spark-area" d={area} fill="url(#hp-fade)" />
        <path className="hp-spark-line" d={d} vectorEffect="non-scaling-stroke" />
      </svg>
      {/* The read-out dot is an HTML element, not an SVG circle: inside a
          preserveAspectRatio="none" viewBox a circle renders as an ellipse. */}
      {at != null && points[at]?.value != null && (
        <i
          className="hp-spark-dot"
          style={{ left: `${(x(at) / W) * 100}%`, top: `${(y(points[at].value as number) / H) * 100}%` }}
        />
      )}
      <div className="hp-spark-hits">
        {points.map((p, i) => (
          <button
            key={p.day}
            type="button"
            onMouseEnter={() => onAt(i)}
            onFocus={() => onAt(i)}
            aria-label={`${fmtDayFull(p.day)}: ${p.value ?? 'nothing'}`}
          />
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * THE CARD. One measurement: what it is, what it says, and its shape
 * over the range. Hovering the chart swaps the headline to that day,
 * which is how the chart answers questions without a floating tooltip
 * that the card would only clip.
 * ------------------------------------------------------------------ */
type Basis = 'total' | 'average' | 'latest'

function MetricCard({ accent, label, basis, span, points, chart, fmt, unit, foot, headline }: {
  accent: string
  label: string
  basis: Basis
  span: number
  points: Point[]
  chart: 'bar' | 'line'
  fmt: (v: number) => string
  unit?: string
  foot?: React.ReactNode
  /** Overrides the computed headline, for a metric whose summary is not one
   *  of the three bases (fitness quotes its peak, say). */
  headline?: { value: string; note: React.ReactNode }
}) {
  const [at, setAt] = useState<number | null>(null)
  const vals = points.map((p) => p.value).filter((v): v is number => v != null)
  const peak = vals.length ? Math.max(...vals) : 0

  const summary =
    basis === 'total' ? vals.reduce((a, v) => a + v, 0) :
    basis === 'average' ? (vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : null) :
    (points.reduce<number | null>((acc, p) => (p.value != null ? p.value : acc), null))

  const lastDay = points.reduce<string | null>((acc, p) => (p.value != null ? p.day : acc), null)
  const basisWord = basis === 'total' ? `${span}-day total` : basis === 'average' ? `${span}-day average` : 'latest reading'

  const hovered = at != null ? points[at] : null
  const showing = hovered && hovered.value != null
  const value = showing ? fmt(hovered.value as number) : headline ? headline.value : summary != null ? fmt(summary) : null
  const note: React.ReactNode = showing
    ? fmtDayFull(hovered.day)
    : headline ? headline.note
    : summary != null ? basisWord
    : 'no readings in this range'

  return (
    <article className={`hp-card${vals.length === 0 ? ' is-empty' : ''}`} style={{ ['--hp-accent' as string]: accent }}>
      <header className="hp-card-top">
        <span className="hp-card-label"><i className="hp-dot" />{label}</span>
        {vals.length > 0 && <span className="hp-card-peak">{fmt(peak)} high</span>}
      </header>

      <div className="hp-card-read">
        <b className={value == null ? 'is-quiet' : undefined}>{value ?? 'None'}</b>
        {value != null && unit && <em>{unit}</em>}
      </div>
      <p className={`hp-card-note${showing ? ' is-live' : ''}`}>{note}</p>

      <div className="hp-card-chart">
        {vals.length === 0 ? (
          <div className="hp-spark is-thin">nothing recorded in this range</div>
        ) : chart === 'bar' ? (
          <Bars points={points} at={at} onAt={setAt} peak={peak} />
        ) : (
          <Spark points={points} at={at} onAt={setAt} />
        )}
      </div>

      {/* The middle slot only earns its place when it says something the two
          ends do not: "last 10 Sept" beside "10 Sept" is noise. */}
      <footer className="hp-card-foot">
        <span>{fmtDay(points[0].day)}</span>
        {foot ?? (lastDay && lastDay !== points[points.length - 1].day
          ? <span className="hp-card-last">last read {fmtDay(lastDay)}</span>
          : <span />)}
        <span>{fmtDay(points[points.length - 1].day)}</span>
      </footer>
    </article>
  )
}

/* A body metric the range may not cover at all. His weight stopped on 5 June
   and the page must say that rather than quietly average nothing, or -- worse
   -- print a June figure under today's date. */
function BodyCard({ days, metric, accent, label, span, fmt, unit, chart, basis }: {
  days: WellnessDay[]; metric: MetricKey; accent: string; label: string; span: number
  fmt: (v: number) => string; unit?: string; chart: 'bar' | 'line'; basis: Basis
}) {
  const stat = bodyStat(days, metric, span)
  const points = useMemo(() => series(days, metric, span), [days, metric, span])
  const foot = stat.inRange.length === 0 && stat.last
    ? <span className="hp-card-last is-old">last {fmt(stat.last.value)} on {fmtDay(stat.last.day)}</span>
    : undefined
  return (
    <MetricCard
      accent={accent} label={label} basis={basis} span={span} points={points}
      chart={chart} fmt={fmt} unit={unit} foot={foot}
    />
  )
}

function Age({ day }: { day: string | null }) {
  if (!day) return <span className="hp-age is-none">never</span>
  const age = daysSince(day)
  const text = age === 0 ? 'today' : age === 1 ? 'yesterday' : age < 60 ? `${age} days ago` : fmtDay(day)
  return <span className={`hp-age is-${freshness(age)}`}>{text}</span>
}

/* ------------------------------------------------------------------ *
 * SESSIONS. What the watch filed, day by day.
 *
 * The complaint that survived two passes: "+5 more" and then nothing
 * opens. The handler was in fact wired, but the affordance was a 11px
 * grey chevron floating above the words, and a day with a single part
 * "opened" into a row that repeated the summary -- so a click either
 * looked like nothing had happened or produced nothing worth seeing.
 * Now: only a day with real parts is openable, it says so in a control
 * shaped like a control, and what opens is the actual list.
 * ------------------------------------------------------------------ */
/* Intervals hands the type over as one run-on word -- WeightTraining, and the
   pill's uppercasing turned that into WEIGHTTRAINING. Split the camel back
   apart so it reads as English. */
function prettyType(type: string): string {
  return type.replace(/([a-z])([A-Z])/g, '$1 $2')
}

function Part({ s }: { s: Session }) {
  const at = s.start_date_local ?? s.start_date
  /* Postgres hands these over as "2026-09-09 14:36:33+00", which Safari will
     not parse. The T is not decoration. */
  const when = at ? new Date(at.replace(' ', 'T')) : null
  const time = when && !Number.isNaN(when.getTime())
    ? when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : ''
  return (
    <li className="hp-part">
      <span className="hp-part-time mono">{time}</span>
      <span className="hp-part-name">{s.name ?? s.type ?? 'Session'}</span>
      <span className="hp-part-nums">
        {s.moving_time ? <b>{Math.round(s.moving_time / 60)}m</b> : null}
        {s.average_heartrate ? <b>{Math.round(s.average_heartrate)}<i>bpm</i></b> : null}
        {s.calories ? <b>{Math.round(s.calories)}<i>kcal</i></b> : null}
        {s.icu_training_load ? <b className="is-effort">{Math.round(s.icu_training_load)}<i>effort</i></b> : null}
      </span>
    </li>
  )
}

function DayRow({ d, hardest }: { d: SessionDay; hardest: number }) {
  const [open, setOpen] = useState(false)
  const effort = hardest > 0 ? Math.min(1, d.load / hardest) : 0
  const many = d.parts > 1
  const isHardest = d.load > 0 && d.load === hardest

  const body = (
    <>
      <span className="hp-day-date">
        <b>{new Date(`${d.day}T12:00:00`).getDate()}</b>
        <span>{fmtWeekday(d.day)}</span>
      </span>

      <span className="hp-day-mid">
        <span className="hp-day-title">{d.title}</span>
        <span className="hp-day-meta">
          <span className="hp-day-type">{prettyType(d.type)}</span>
          {isHardest && <span className="hp-day-best">hardest of the range</span>}
        </span>
      </span>

      <span className="hp-day-stats">
        <span className="hp-stat"><b>{fmtHm(d.minutes)}</b><i>moving</i></span>
        {d.avgHr != null && <span className="hp-stat"><b>{d.avgHr}</b><i>avg bpm</i></span>}
        {d.maxHr != null && <span className="hp-stat"><b>{d.maxHr}</b><i>peak bpm</i></span>}
        <span className="hp-stat"><b>{d.calories.toLocaleString('en-GB')}</b><i>kcal</i></span>
      </span>

      <span className="hp-day-effort">
        <span className="hp-effort-num">{d.load}</span>
        <span className="hp-effort-bar"><i style={{ width: `${Math.round(effort * 100)}%` }} /></span>
        <span className="hp-effort-cap">effort</span>
      </span>

      {many && (
        <span className="hp-day-more">
          <span className="hp-day-count">{d.parts}</span>
          <Icon.ChevronDown size={14} className={open ? 'hp-chev is-open' : 'hp-chev'} />
        </span>
      )}
    </>
  )

  return (
    <li className={`hp-day${open ? ' is-open' : ''}${many ? ' is-openable' : ''}`}>
      {many ? (
        <button
          className="hp-day-main"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`${d.title}, ${d.parts} sessions. ${open ? 'Hide' : 'Show'} them`}
        >{body}</button>
      ) : (
        /* One part is already fully described by the row. Opening it to
           repeat itself was the click that felt broken. */
        <div className="hp-day-main is-flat">{body}</div>
      )}

      {open && (
        <ul className="hp-parts">
          {d.items.map((s) => <Part key={s.id} s={s} />)}
        </ul>
      )}
    </li>
  )
}

export function HealthPage() {
  const { state, reload } = useHealth()
  const { sync, start, clear } = useHealthSync()
  const [span, setSpan] = useState(7)

  const days = state.status === 'ok' ? state.days : []
  const sessions = state.status === 'ok' ? state.sessions : []
  const lastRun = state.status === 'ok' ? state.lastRun : null
  const busySync = sync.phase === 'asking' || sync.phase === 'running'

  const view = useMemo(() => {
    const allDays = rollUpByDay(sessions)
    const nowDays = withinDays(allDays, span)
    const rows: DayFrame[] = frames(days, allDays, span)
    return {
      rows,
      nowDays,
      now: totals(nowDays),
      hardest: Math.max(0, ...nowDays.map((d) => d.load)),
      load: sessionSeries(rows, 'load'),
      minutes: sessionSeries(rows, 'minutes'),
      calories: sessionSeries(rows, 'calories'),
      ctl: series(days, 'ctl', span),
    }
  }, [days, sessions, span])

  const peakCtl = days.reduce((m, d) => (d.ctl != null && d.ctl > m ? d.ctl : m), 0)
  const fitness = days.reduce<{ day: string; value: number } | null>((acc, d) => (d.ctl != null ? { day: d.day, value: d.ctl } : acc), null)
  const lastSession = view.nowDays[0] ?? rollUpByDay(sessions)[0] ?? null

  return (
    <div className="page">
      <div className="hp">
        <header className="hp-head">
          <div>
            <h1 className="hp-title">Health</h1>
            <p className="hp-since">
              {lastSession
                ? <>Last session {fmtDay(lastSession.day)}, <Age day={lastSession.day} /></>
                : 'No sessions on record.'}
              {lastRun && <span className="hp-since-sync">Synced {agoFrom(lastRun.ran_at)}</span>}
            </p>
          </div>
          <div className="hp-head-right">
            <div className="hp-tabs" role="tablist" aria-label="Range">
              {SPANS.map((s) => (
                <button
                  key={s.id}
                  role="tab"
                  aria-selected={span === s.id}
                  className={`hp-tab${span === s.id ? ' is-on' : ''}`}
                  onClick={() => setSpan(s.id)}
                >{s.label}</button>
              ))}
            </div>
            <button className="hp-sync" onClick={start} disabled={busySync} title="Fetch everything new from Intervals.icu">
              <Icon.Repeat size={13} className={busySync ? 'hp-spin' : undefined} />
              {busySync ? 'Syncing' : 'Sync'}
            </button>
          </div>
        </header>

        {sync.phase !== 'idle' && (
          <p className={`hp-syncline is-${sync.phase}`}>
            <span>
              {sync.phase === 'asking' && 'Asking the worker to run…'}
              {sync.phase === 'running' && 'Running. It usually lands within a minute.'}
              {sync.phase === 'done' && `Synced ${sync.run.wellness_rows ?? 0} days and ${sync.run.activity_rows ?? 0} sessions.`}
              {sync.phase === 'failed' && sync.message}
            </span>
            {!busySync && (
              <button className="hp-syncline-x" onClick={clear} aria-label="Dismiss">
                <Icon.Close size={12} />
              </button>
            )}
          </p>
        )}

        {state.status === 'off' && <p className="hp-empty">Sync is off on this device.</p>}
        {state.status === 'signed-out' && <p className="hp-empty">Not signed in on this device.</p>}
        {state.status === 'loading' && <p className="hp-empty">Reading the watch…</p>}
        {state.status === 'empty' && <p className="hp-empty">Nothing has synced from Intervals.icu yet.</p>}
        {state.status === 'error' && (
          <p className="hp-empty">
            {state.message}
            <button className="hp-retry" onClick={reload}>Try again</button>
          </p>
        )}

        {state.status === 'ok' && (
          <>
            <div className="hp-cards">
              <MetricCard
                accent="var(--hp-train)" label="Fitness" basis="latest" span={span}
                points={view.ctl} chart="line" fmt={(v) => v.toFixed(1)}
                headline={fitness ? {
                  value: fitness.value.toFixed(1),
                  note: peakCtl ? <>{Math.round((fitness.value / peakCtl) * 100)}% of your {peakCtl.toFixed(1)} peak</> : 'latest reading',
                } : undefined}
              />
              <MetricCard
                accent="var(--hp-cardio)" label="Effort" basis="total" span={span}
                points={view.load} chart="bar" fmt={(v) => Math.round(v).toLocaleString('en-GB')}
                foot={<span className="hp-card-last">{view.now.days} of {span} days trained</span>}
              />
              <BodyCard
                days={days} metric="sleep_secs" accent="var(--hp-sleep)" label="Sleep" span={span}
                basis="average" chart="bar" fmt={(v) => `${(v / 3600).toFixed(1)}h`}
              />
              <BodyCard
                days={days} metric="steps" accent="var(--hp-move)" label="Steps" span={span}
                basis="average" chart="bar" fmt={(v) => Math.round(v).toLocaleString('en-GB')}
              />
              <BodyCard
                days={days} metric="resting_hr" accent="var(--hp-cardio)" label="Resting heart rate" span={span}
                basis="latest" chart="line" fmt={(v) => String(Math.round(v))} unit="bpm"
              />
              <BodyCard
                days={days} metric="weight" accent="var(--hp-body)" label="Weight" span={span}
                basis="latest" chart="line" fmt={(v) => v.toFixed(1)} unit="kg"
              />
              <MetricCard
                accent="var(--hp-move)" label="Moving time" basis="total" span={span}
                points={view.minutes} chart="bar" fmt={(v) => fmtHm(Math.round(v))}
              />
              <MetricCard
                accent="var(--hp-train)" label="Calories" basis="total" span={span}
                points={view.calories} chart="bar" fmt={(v) => Math.round(v).toLocaleString('en-GB')} unit="kcal"
              />
            </div>

            <section className="hp-section">
              <h2 className="hp-h2">
                Sessions
                <span className="hp-h2-count">{view.nowDays.length} {view.nowDays.length === 1 ? 'day' : 'days'} in this range</span>
              </h2>
              {view.nowDays.length === 0 ? (
                <p className="hp-empty hp-empty-flat">Nothing logged in this range.</p>
              ) : (
                <ul className="hp-days">
                  {view.nowDays.map((d) => <DayRow key={d.day} d={d} hardest={view.hardest} />)}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
