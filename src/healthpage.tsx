/* THE HEALTH PAGE.

   The look is lifted from his own Zepp Health dashboard (off-plate/zepp-health)
   on his instruction: glass tiles on a dark ground, a ring that fills with a
   spring, big tabular numbers under a small tracked label, sparklines that draw
   themselves in with a glow, and the 7D/30D/90D/1Y tab row. What did NOT come
   across is the green: it left this app's interface on his own earlier
   instruction, so the movement accent is the cyan this app already uses in the
   dark, and the coral, violet and amber stay as Zepp drew them.

   It sits on the app's FEATURE ground rather than on paper. That surface
   already exists here for the routine runner, and its note explains why: a
   mode has to look unlike the page it sits on. A body dashboard is that kind
   of mode -- and it is also the one page in this app whose whole language came
   from somewhere else, so making it look like the notes page would be the
   wrong kind of consistency.

   Every reading carries the day it was taken. See health.ts on why. */
import { useMemo, useState } from 'react'
import {
  agoFrom, daysSince, fmtDay, fmtHm, freshness, lastReading, rollUpByDay, totals, withinDays,
  useHealth, useHealthSync, type MetricKey, type SessionDay, type WellnessDay,
} from './health'
import * as Icon from './icons'

const SPANS = [
  { id: 7, label: '7D' },
  { id: 30, label: '30D' },
  { id: 90, label: '90D' },
  { id: 365, label: '1Y' },
]

/* Zepp's domain palette, minus the green. Each is a real CSS custom property
   on the page below, so a tile only ever names its accent once. */
const ACCENT = {
  train: 'var(--hp-train)',
  cardio: 'var(--hp-cardio)',
  sleep: 'var(--hp-sleep)',
  move: 'var(--hp-move)',
  body: 'var(--hp-body)',
}

/* ---------------------------------------------------------------- *
 * The chart. Zepp drew the line and the glow; what it never carried
 * was a scale, and his report on the first build was blunt -- "there
 * are fake fake diagrams". A line with no numbers beside it IS a
 * drawing. So every chart here states its own top and bottom value,
 * the dates at each end, and where the peak fell. It breaks on a gap
 * too: his sleep stops in June, and a line carried straight across
 * three silent months is a claim about months nothing reported.
 * ---------------------------------------------------------------- */
function plot(points: (number | null)[], height: number) {
  const w = 300
  const real = points.filter((v): v is number => v != null)
  if (real.length < 2) return null
  const min = Math.min(...real)
  const max = Math.max(...real)
  const range = max - min || 1
  const stepX = w / Math.max(1, points.length - 1)
  const y = (v: number) => 4 + (1 - (v - min) / range) * (height - 8)

  const runs: string[] = []
  let run: string[] = []
  points.forEach((v, i) => {
    if (v == null) { if (run.length > 1) runs.push(run.join(' ')); run = []; return }
    run.push(`${run.length === 0 ? 'M' : 'L'} ${(i * stepX).toFixed(1)} ${y(v).toFixed(1)}`)
  })
  if (run.length > 1) runs.push(run.join(' '))

  const lastIdx = points.reduce<number>((acc, v, i) => (v != null ? i : acc), -1)
  const firstIdx = points.findIndex((v) => v != null)
  const peakIdx = points.reduce<number>((acc, v, i) => (v != null && (acc < 0 || (points[acc] ?? 0) < v) ? i : acc), -1)
  return { w, min, max, stepX, y, runs, lastIdx, firstIdx, peakIdx, height }
}

function Spark({ points, accent, height = 44 }: { points: (number | null)[]; accent: string; height?: number }) {
  const g = plot(points, height)
  if (!g) return <div className="hp-spark hp-spark-empty" style={{ height }} />
  const id = `hpf-${accent.replace(/[^a-z]/gi, '')}-${points.length}-${height}`
  return (
    <div className="hp-sparkwrap" style={{ height, ['--hp-accent' as string]: accent }}>
    <svg className="hp-spark" viewBox={`0 0 ${g.w} ${height}`} preserveAspectRatio="none" style={{ height }} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.28" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      {g.runs.length === 1 && (
        <path
          className="hp-spark-fill"
          d={`${g.runs[0]} L ${(g.lastIdx * g.stepX).toFixed(1)} ${height} L ${(g.firstIdx * g.stepX).toFixed(1)} ${height} Z`}
          fill={`url(#${id})`}
        />
      )}
      {g.runs.map((d, i) => <path key={i} className="hp-spark-line" d={d} />)}
    </svg>
    <Tip g={g} points={points} />
    </div>
  )
}

/* The end dot lives in HTML, not in the chart. These charts stretch to their
   container (preserveAspectRatio="none", which is what keeps the line reading
   the same at any width), and a <circle> inside a viewBox scaled unevenly is
   drawn as an ellipse. */
function Tip({ g, points }: { g: NonNullable<ReturnType<typeof plot>>; points: (number | null)[] }) {
  if (g.lastIdx < 0) return null
  const left = (g.lastIdx / Math.max(1, points.length - 1)) * 100
  const top = (g.y(points[g.lastIdx] as number) / g.height) * 100
  return <i className="hp-tip" style={{ left: `${left}%`, top: `${top}%` }} />
}

/** The same line, with the scale that makes it a reading: the value at the top
 *  and bottom of the drawn range, the date at each end, and the peak named. */
function Chart({ points, days, accent, format, height = 96 }: {
  points: (number | null)[]; days: string[]; accent: string; format: (v: number) => string; height?: number
}) {
  const g = plot(points, height)
  if (!g) return <p className="hp-sub">Not enough readings in this range to chart.</p>
  const id = `hpc-${accent.replace(/[^a-z]/gi, '')}-${points.length}`
  const mid = (g.min + g.max) / 2
  const peakVal = g.peakIdx >= 0 ? points[g.peakIdx] : null
  return (
    <div className="hp-chart" style={{ ['--hp-accent' as string]: accent }}>
      <div className="hp-chart-plot" style={{ height }}>
        {/* The dot is placed as a percentage of the PLOT, so the plot needs a
            box of its own -- the axis gutter is padding on the parent, and a
            dot at 100% of that box lands beside the numbers instead of on the
            line's last point. */}
        <div className="hp-plot-inner">
        <svg viewBox={`0 0 ${g.w} ${height}`} preserveAspectRatio="none" style={{ height }} aria-hidden="true">
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={accent} stopOpacity="0.26" />
              <stop offset="100%" stopColor={accent} stopOpacity="0" />
            </linearGradient>
          </defs>
          <line className="hp-grid-line" x1="0" y1={g.y(g.max)} x2={g.w} y2={g.y(g.max)} />
          <line className="hp-grid-line" x1="0" y1={g.y(mid)} x2={g.w} y2={g.y(mid)} />
          <line className="hp-grid-line" x1="0" y1={g.y(g.min)} x2={g.w} y2={g.y(g.min)} />
          {g.runs.length === 1 && (
            <path
              className="hp-spark-fill"
              d={`${g.runs[0]} L ${(g.lastIdx * g.stepX).toFixed(1)} ${height} L ${(g.firstIdx * g.stepX).toFixed(1)} ${height} Z`}
              fill={`url(#${id})`}
            />
          )}
          {g.runs.map((d, i) => <path key={i} className="hp-spark-line" d={d} />)}
        </svg>
        <Tip g={g} points={points} />
        </div>
        <div className="hp-chart-y">
          <span>{format(g.max)}</span>
          <span>{format(mid)}</span>
          <span>{format(g.min)}</span>
        </div>
      </div>
      <div className="hp-chart-x">
        <span>{days[g.firstIdx] ? fmtDay(days[g.firstIdx]) : ''}</span>
        {peakVal != null && days[g.peakIdx] && (
          <span className="hp-chart-peak">peak {format(peakVal)} · {fmtDay(days[g.peakIdx])}</span>
        )}
        <span>{days[g.lastIdx] ? fmtDay(days[g.lastIdx]) : ''}</span>
      </div>
    </div>
  )
}

/* Zepp's ring, kept to one. Three rings are three daily goals, and two of his
   three streams stopped reporting in June; a ring stuck at zero every morning
   is a worse lie than no ring. */
function Ring({ pct, label, value, sub }: { pct: number; label: string; value: string; sub: string }) {
  const r = 52
  const c = 2 * Math.PI * r
  const shown = Math.max(0, Math.min(1, pct))
  return (
    <div className="hp-ring">
      <svg viewBox="0 0 130 130" role="img" aria-label={`${label}: ${value}, ${sub}`}>
        <defs>
          <linearGradient id="hp-ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--hp-train)" />
            <stop offset="100%" stopColor="var(--hp-train-soft)" />
          </linearGradient>
        </defs>
        <circle cx="65" cy="65" r={r} fill="none" stroke="var(--hp-ring-track)" strokeWidth="13" />
        <circle
          className="hp-ring-arc"
          cx="65" cy="65" r={r} fill="none"
          stroke="url(#hp-ring-grad)" strokeWidth="13" strokeLinecap="round"
          strokeDasharray={`${(c * shown).toFixed(1)} ${c.toFixed(1)}`}
          transform="rotate(-90 65 65)"
        />
      </svg>
      <div className="hp-ring-mid">
        <b>{value}</b>
        <span>{label}</span>
      </div>
    </div>
  )
}

function Age({ day }: { day: string | null }) {
  if (!day) return <span className="hp-age is-none">never</span>
  const age = daysSince(day)
  const state = freshness(age)
  const text = age === 0 ? 'today' : age === 1 ? 'yesterday' : age < 60 ? `${age} days ago` : fmtDay(day)
  return <span className={`hp-age is-${state}`}>{text}</span>
}

function Tile({ accent, label, value, unit, sub, children }: {
  accent: string; label: string; value: string; unit?: string; sub?: React.ReactNode; children?: React.ReactNode
}) {
  return (
    <div className="hp-tile" style={{ ['--hp-accent' as string]: accent }}>
      <div className="hp-label"><i className="hp-dot" />{label}</div>
      <div className="hp-value">{value}{unit ? <em>{unit}</em> : null}</div>
      {sub ? <div className="hp-sub">{sub}</div> : null}
      {children}
    </div>
  )
}

/** A metric the watch used to report. Shows the real last reading and how old
 *  it is, never a blank where a number is expected. */
function BodyTile({ days, metric, accent, label, format }: {
  days: WellnessDay[]; metric: MetricKey; accent: string; label: string; format: (v: number) => string
}) {
  const last = lastReading(days, metric)
  const pts = days.map((d) => d[metric])
  const real = pts.filter((v): v is number => v != null)
  const lo = real.length ? Math.min(...real) : null
  const hi = real.length ? Math.max(...real) : null
  return (
    <div className="hp-tile" style={{ ['--hp-accent' as string]: accent }}>
      <div className="hp-label"><i className="hp-dot" />{label}</div>
      <div className="hp-value">{last ? format(last.value) : '—'}</div>
      <div className="hp-sub"><Age day={last?.day ?? null} /></div>
      <Spark points={pts} accent={accent} height={40} />
      {lo != null && hi != null && (
        <div className="hp-chart-x" style={{ paddingRight: 0 }}>
          <span>{format(lo)}</span>
          <span>{real.length} readings</span>
          <span>{format(hi)}</span>
        </div>
      )}
    </div>
  )
}

export function HealthPage() {
  const { state, reload } = useHealth()
  const { sync, start } = useHealthSync()
  const [span, setSpan] = useState(90)

  const days = state.status === 'ok' ? state.days : []
  const sessions = state.status === 'ok' ? state.sessions : []

  const view = useMemo(() => {
    const inRange = withinDays(days, span)
    const allDays = rollUpByDay(sessions)
    const nowDays = withinDays(allDays, span)
    const prevDays = allDays.filter((d) => {
      const age = daysSince(d.day)
      return age >= span && age < span * 2
    })
    return { inRange, allDays, now: totals(nowDays), prev: totals(prevDays), nowDays }
  }, [days, sessions, span])

  const busySync = sync.phase === 'asking' || sync.phase === 'running'
  const lastRun = state.status === 'ok' ? state.lastRun : null
  const fitness = lastReading(days, 'ctl')
  const peak = days.reduce((m, d) => (d.ctl != null && d.ctl > m ? d.ctl : m), 0)
  const lastSession = view.allDays[0] ?? null
  const ramp = days.length ? days[days.length - 1].ramp_rate : null

  const trend = (now: number, before: number) => {
    if (!before) return null
    const pct = Math.round(((now - before) / before) * 100)
    return <span className={`hp-delta ${pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'}`}>{pct > 0 ? '+' : ''}{pct}%</span>
  }

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
              {lastRun && <span className="hp-since-sync"> · synced {agoFrom(lastRun.ran_at)}</span>}
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
            <button
              className="hp-sync"
              onClick={start}
              disabled={busySync}
              title="Fetch everything new from Intervals.icu"
            >
              <Icon.Repeat size={13} className={busySync ? 'hp-spin' : undefined} />
              {busySync ? 'Syncing' : 'Sync'}
            </button>
          </div>
        </header>

        {/* The worker's own words, never this page's guess about them. */}
        {sync.phase !== 'idle' && (
          <p className={`hp-syncline is-${sync.phase}`}>
            {sync.phase === 'asking' && 'Asking the worker to run…'}
            {sync.phase === 'running' && 'Running. It usually lands within a minute.'}
            {sync.phase === 'done' && `Synced ${sync.run.wellness_rows ?? 0} days and ${sync.run.activity_rows ?? 0} sessions.`}
            {sync.phase === 'failed' && sync.message}
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
            <div className="hp-grid">
              {/* HERO — fitness, the one stream that still arrives daily */}
              <div className="hp-tile hp-hero" style={{ ['--hp-accent' as string]: ACCENT.train }}>
                <div className="hp-label"><i className="hp-dot" />Fitness</div>
                <div className="hp-hero-body">
                  <Ring
                    pct={peak ? (fitness?.value ?? 0) / peak : 0}
                    label="of peak"
                    value={fitness ? fitness.value.toFixed(1) : '—'}
                    sub={peak ? `peak ${peak.toFixed(1)}` : 'no peak yet'}
                  />
                  <div className="hp-hero-read">
                    <div className="hp-hero-lines">
                      <div className="hp-hero-line">
                        <b>{peak ? Math.round(((fitness?.value ?? 0) / peak) * 100) : 0}%</b>
                        <span>of your {peak.toFixed(1)} peak</span>
                      </div>
                      {ramp != null && (
                        <div className="hp-hero-line">
                          <b className={ramp < 0 ? 'is-down' : 'is-up'}>{ramp > 0 ? '+' : ''}{ramp.toFixed(2)}</b>
                          <span>ramp rate a week</span>
                        </div>
                      )}
                      <div className="hp-hero-line">
                        <b>{view.now.days}</b>
                        <span>days trained in range</span>
                      </div>
                    </div>
                    <Chart
                      points={view.inRange.map((d) => d.ctl)}
                      days={view.inRange.map((d) => d.day)}
                      accent={ACCENT.train}
                      format={(v) => v.toFixed(1)}
                      height={104}
                    />
                  </div>
                </div>
              </div>

              <Tile
                accent={ACCENT.cardio}
                label="Sessions"
                value={String(view.now.sessions)}
                sub={<>on {view.now.days} {view.now.days === 1 ? 'day' : 'days'} {trend(view.now.sessions, view.prev.sessions)}</>}
              />
              <Tile
                accent={ACCENT.move}
                label="Time"
                value={fmtHm(view.now.minutes)}
                sub={<>moving {trend(view.now.minutes, view.prev.minutes)}</>}
              />
              <Tile
                accent={ACCENT.cardio}
                label="Calories"
                value={view.now.calories.toLocaleString('en-GB')}
                unit="kcal"
                sub={<>burned {trend(view.now.calories, view.prev.calories)}</>}
              />
              <Tile
                accent={ACCENT.train}
                label="Load"
                value={String(view.now.load)}
                sub={<>training load {trend(view.now.load, view.prev.load)}</>}
              />
            </div>

            <section className="hp-section">
              <h2 className="hp-h2">Sessions</h2>
              {view.nowDays.length === 0 ? (
                <p className="hp-empty hp-empty-flat">Nothing logged in this range.</p>
              ) : (
                <ul className="hp-days">
                  {view.nowDays.map((d) => <DayRow key={d.day} d={d} />)}
                </ul>
              )}
            </section>

            <section className="hp-section">
              <h2 className="hp-h2">Body</h2>
              <div className="hp-grid hp-grid-body">
                <BodyTile days={days} metric="steps" accent={ACCENT.move} label="Steps" format={(v) => Math.round(v).toLocaleString('en-GB')} />
                <BodyTile days={days} metric="sleep_secs" accent={ACCENT.sleep} label="Sleep" format={(v) => `${(v / 3600).toFixed(1)}h`} />
                <BodyTile days={days} metric="resting_hr" accent={ACCENT.cardio} label="Resting HR" format={(v) => `${Math.round(v)}`} />
                <BodyTile days={days} metric="weight" accent={ACCENT.body} label="Weight" format={(v) => `${v.toFixed(1)}kg`} />
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function DayRow({ d }: { d: SessionDay }) {
  return (
    <li className="hp-day">
      <span className="hp-day-when">{fmtDay(d.day)}</span>
      <span className="hp-day-what">
        <span className="hp-day-title">{d.title}</span>
        {d.parts > 1 && <span className="hp-day-parts">+{d.parts - 1} more</span>}
      </span>
      <span className="hp-day-nums">
        <b>{fmtHm(d.minutes)}</b>
        {d.avgHr != null && <span>{d.avgHr} bpm</span>}
        {d.calories > 0 && <span>{d.calories.toLocaleString('en-GB')} kcal</span>}
        {d.load > 0 && <span className="hp-day-load"><Icon.DockHeartbeat size={11} />{d.load}</span>}
      </span>
    </li>
  )
}
