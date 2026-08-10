import { useEffect, useMemo, useRef, useState } from 'react'
import { MOCK_STATS, SPACE_LABELS } from './mock'
import { useCompass, type CompassState } from './compass'
import { AutoTextarea, Band, SpaceMark } from './pages1'
import { useStore } from './store'
import { Spark, SparkBox } from './widgets'
import { RANGE_OPTIONS, allTimeRange, customRange, fmtDuration, fmtNum, fmtSigned, fmtWhen, goalPace, goalPeriodKey, goalPeriodRange, inRange, isoWeekKey, localDateKey, monthName, monthRange, monthsWithData, rangeFor, taskMinutes, type GoalTf, type RangeId } from './util'
import { WALL } from './board'
import { getAiKey, hasAiKey, setAiKey } from './ai'
import { paymentTaskTitle } from './exceptions'
import { SUPABASE_ENABLED, currentAccount, onAccountChange, sendSignInCode, signInWithCode, signOutAccount, type Account } from './supabase'
import { goalCurrent, isTimeFed, ON_TRACK_PCT, STEP_UNITS, stepSeries, type StepEntry, type TaskCategory } from './types'

/* ---------------- MONEY ---------------- */

/* Money is one pool: his real finances do not split by profile, so this page is
   identical in every space instead of dead-ending outside Personal.

   Every figure is read from Compass at runtime, over his own session. There is
   no fallback number and no cached copy in this bundle, because this repo is
   public and a stale or invented balance is worse than an empty panel. */

function NoData({ label }: { label: string }) {
  return <div className="kpi nodata">&mdash;<span className="unit">{label}</span></div>
}

/** Kč, grouped, no decimals. Compass stores whole crowns. */
const kc = (n: number) => `${fmtNum(Math.round(n))} Kč`

function CompassCard({ state, onReload }: { state: CompassState; onReload: () => void }) {
  const label =
    state.status === 'ok' ? 'Read from Compass'
    : state.status === 'loading' ? 'Reading Compass'
    : state.status === 'signed-out' ? 'Sign in to read Compass'
    : state.status === 'empty' ? 'Compass has no debts in it'
    : state.status === 'error' ? 'Compass could not be read'
    : 'Not connected in this build'
  const body =
    state.status === 'ok' ? 'Debts, budget, goals and the five-year plan are managed in Compass. This page is the readout, and it never writes back.'
    : state.status === 'loading' ? 'Reading your debts and payments.'
    : state.status === 'signed-out' ? 'Compass shares this database, so the same sign-in reads it. Sign in from Settings and the figures appear here.'
    : state.status === 'empty' ? 'Nothing to read yet. Add your debts in Compass and they show up here.'
    : state.status === 'error' ? state.message
    : 'Sync is off in this build, so there is nothing to read.'
  return (
    <div className="panel money-compass">
      <div className="money-compass-copy">
        <span className="microcap">{label}</span>
        <p>{body}</p>
      </div>
      {state.status === 'error' && (
        <button className="btn btn-ghost" onClick={onReload}>Try again</button>
      )}
      <a className="btn btn-primary money-compass-btn" href="https://compass-money.netlify.app" target="_blank" rel="noreferrer">
        Open Compass
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M7 17L17 7M17 7H8M17 7v9" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </a>
    </div>
  )
}

export function MoneyPage() {
  const { state, reload } = useCompass()
  const m = state.status === 'ok' ? state.money : null

  return (
    <div className="page">
      <Band
        title="Money"
        metrics={m ? [
          { v: kc(m.owed), k: 'still owed', tone: 'urgent' as const },
          { v: `${m.pct}%`, k: 'of it paid off', tone: 'pos' as const },
        ] : []}
        actions={m ? <button className="btn btn-quiet" onClick={reload}>Refresh</button> : undefined}
      />
      {/* With no figures, the one thing he can DO comes first instead of hiding
          under three empty scaffolds. */}
      {!m && <CompassCard state={state} onReload={reload} />}
      <div className="grid-3">
        <div className="panel">
          <span className="microcap">Debt payoff</span>
          {m ? (
            <>
              <div className="kpi">{kc(m.owed)}<span className="unit">left</span></div>
              <div className="bar debt" style={{ marginTop: 12 }}><i style={{ width: `${m.pct}%` }} /></div>
              <div className="kpi-sub"><span className="val-pos">{kc(m.paidOff)} paid</span> of {kc(m.baseline)}</div>
            </>
          ) : (
            <>
              <NoData label="left" />
              <div className="bar debt" style={{ marginTop: 12 }}><i style={{ width: '0%' }} /></div>
            </>
          )}
        </div>

        <div className="panel">
          <span className="microcap">Monthly payments</span>
          {m ? (
            <>
              <div className="kpi">{kc(m.monthly)}<span className="unit">/ month</span></div>
              <div className="kpi-sub">across {m.openDebts} {m.openDebts === 1 ? 'debt' : 'debts'} still open</div>
            </>
          ) : (
            <>
              <NoData label="/ month" />
              <div className="bar prog" style={{ marginTop: 12 }}><i style={{ width: '0%' }} /></div>
            </>
          )}
        </div>

        <div className="panel">
          <span className="microcap">Saved this month</span>
          {m ? (
            <>
              <div className={m.savedThisMonth > 0 ? 'kpi val-pos' : 'kpi'}>{kc(m.savedThisMonth)}</div>
              <div className="kpi-sub">{m.savedThisMonth > 0 ? 'set aside this month' : 'nothing set aside yet this month'}</div>
            </>
          ) : (
            <NoData label="this month" />
          )}
        </div>
      </div>

      {m && <CompassCard state={state} onReload={reload} />}
    </div>
  )
}

/* ---------------- REVIEW (weekly reset + stats, merged) ---------------- */

/* A section heading is the heading. No explanatory note: it restated the
   label and added nothing you could act on. See DESIGN.md, "No subtitles". */
function SecHead({ label }: { label: string }) {
  return (
    <div className="sechead">
      <span className="microcap">{label}</span>
    </div>
  )
}

/**
 * A number over time, drawn properly: a dated axis, the real spread on the y
 * axis, the target as a line you can see yourself crossing, and every run
 * marked. A sparkline in a table row could show none of that, and stretched
 * across a wide monitor it showed less than nothing.
 */
function NumberChart({ runs, target, unit, width }: { runs: StepEntry[]; target?: number; unit: string; width: number }) {
  const W = width, H = 180, L = 40, R = 16, T = 14, B = 30
  const vals = runs.map((r) => r.value)
  const lo = Math.min(...vals, ...(target ? [target] : []))
  const hi = Math.max(...vals, ...(target ? [target] : []))
  // A flat series still needs a band to sit in, or every point lands on one line.
  const pad = Math.max(4, Math.round((hi - lo) * 0.15))
  const yMin = Math.max(0, lo - pad), yMax = hi + pad
  const x = (i: number) => (runs.length === 1 ? L : L + (i / (runs.length - 1)) * (W - L - R))
  const y = (v: number) => T + (1 - (v - yMin) / Math.max(1, yMax - yMin)) * (H - T - B)
  const ticks = [yMax, yMin]

  return (
    <svg className="numchart" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`${runs.length} runs, from ${vals[0]} to ${vals[vals.length - 1]} ${unit}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} y1={y(t)} x2={W - R} y2={y(t)} className="nc-grid" />
          <text x={L - 8} y={y(t) + 4} textAnchor="end" className="nc-axis">{Math.round(t)}</text>
        </g>
      ))}
      {target != null && (
        <>
          <line x1={L} y1={y(target)} x2={W - R} y2={y(target)} className="nc-target" />
          <text x={L - 8} y={y(target) + 4} textAnchor="end" className="nc-target-lab">{target}</text>
        </>
      )}
      {runs.length > 1 && (
        <polyline className="nc-line" fill="none"
          points={runs.map((r, i) => `${x(i).toFixed(1)},${y(r.value).toFixed(1)}`).join(' ')} />
      )}
      {runs.map((r, i) => (
        <g key={`${r.at ?? r.day}${i}`}>
          <circle cx={x(i)} cy={y(r.value)} r={4} className={`nc-dot${target != null && r.value >= target ? ' pass' : ''}`}>
            <title>{`${fmtWhen(r.day)}: ${r.value} ${unit}`}</title>
          </circle>
          {(runs.length <= 8 || i === 0 || i === runs.length - 1) && (
            <text x={x(i)} y={y(r.value) - 11} textAnchor="middle" className="nc-val">{r.value}</text>
          )}
        </g>
      ))}
      <text x={L} y={H - 8} className="nc-axis">{fmtWhen(runs[0].day)}</text>
      {/* Several runs on one day would print the same date at both ends. */}
      {runs[0].day !== runs[runs.length - 1].day && (
        <text x={W - R} y={H - 8} textAnchor="end" className="nc-axis">{fmtWhen(runs[runs.length - 1].day)}</text>
      )}
    </svg>
  )
}

/* An SVG at width:100% scales its HEIGHT with its width, so a full-width panel
   turned a slim chart into a poster. This measures the space it has been given
   and draws at that exact size, one unit to the pixel: full width, fixed
   height, and text that never rescales. */
function ChartArea({ runs, target, unit }: { runs: StepEntry[]; target?: number; unit: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div className="numchart-scroll" ref={ref}>
      {w > 0 && <NumberChart runs={runs} target={target} unit={unit} width={Math.max(460, w)} />}
    </div>
  )
}

/** The window of the same length immediately before this one. A number with
 *  nothing to compare it to is trivia; a number with a direction is a fact. */
function priorRange(r: { from: string; to: string }): { id: string; label: string; from: string; to: string } {
  const d = (iso: string) => { const [y, m, day] = iso.split('-').map(Number); return new Date(y, m - 1, day) }
  const key = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  const days = Math.max(1, Math.round((d(r.to).getTime() - d(r.from).getTime()) / 86400000) + 1)
  const to = d(r.from); to.setDate(to.getDate() - 1)
  const from = new Date(to); from.setDate(from.getDate() - (days - 1))
  return { id: 'prior', label: 'the window before', from: key(from), to: key(to) }
}

/** How many of its own occasions a routine had inside a window. */
function occasionsIn(cadence: string, r: { from: string; to: string }): number {
  const d = (iso: string) => { const [y, m, day] = iso.split('-').map(Number); return new Date(y, m - 1, day) }
  const days = Math.max(1, Math.round((d(r.to).getTime() - d(r.from).getTime()) / 86400000) + 1)
  if (cadence === 'weekly') return Math.max(1, Math.round(days / 7))
  if (cadence === 'monthly') return Math.max(1, Math.round(days / 30))
  if (cadence === 'prework') {
    let n = 0
    const cur = d(r.from)
    for (let i = 0; i < days; i++) { const wd = (cur.getDay() + 6) % 7; if (wd < 5) n++; cur.setDate(cur.getDate() + 1) }
    return Math.max(1, n)
  }
  return days
}

/** A direction on a number, drawn only when there is something to compare. */
function Delta({ now, before, unit = '' }: { now: number; before: number; unit?: string }) {
  if (before === 0 && now === 0) return null
  const d = now - before
  if (d === 0) return <span className="rf-delta same">same as before</span>
  return (
    <span className={`rf-delta ${d > 0 ? 'up' : 'down'}`}>
      {d > 0 ? '+' : ''}{unit === 'm' ? fmtDuration(Math.abs(d)) : Math.abs(d)}{unit && unit !== 'm' ? ` ${unit}` : ''} {d > 0 ? 'more' : 'less'} than before
    </span>
  )
}

export function ReviewPage() {
  const { space, tasks, habits, goals, closeReview, review, ledger, focusSessions, habitLog, routineLog, stepLog, routines, records, coachSessions, slips, setPage, inView } = useStore()
  const [rangeId, setRangeId] = useState<string>('this-week')
  const [from, setFrom] = useState(localDateKey())
  const [to, setTo] = useState(localDateKey())

  /* Which windows are worth offering comes from the data, not from a fixed list
     of the last twelve months. A fixed list offers empty months he can only find
     out are empty by opening them, and hides anything older than a year. */
  const dated = useMemo(() => [
    ...ledger.filter((e) => inView(e.space)).map((e) => e.when),
    ...focusSessions.filter((f) => inView(f.space)).map((f) => f.day),
    ...habitLog.map((t) => t.day),
    ...routineLog.map((r) => r.day),
  ], [ledger, focusSessions, habitLog, routineLog, inView])
  const months = useMemo(() => monthsWithData(dated), [dated])

  const range = useMemo(() => {
    if (rangeId === 'all-time') return allTimeRange(dated)
    if (rangeId === 'custom') return customRange(from, to)
    if (/^\d{4}-\d{2}$/.test(rangeId)) return monthRange(rangeId)
    return rangeFor(rangeId as RangeId)
  }, [rangeId, dated, from, to])

  const [wins, setWins] = useState<string[]>(['', '', ''])
  const [changed, setChanged] = useState('')
  const [outcomes, setOutcomes] = useState<string[]>(['', '', ''])

  /* Every number below reads the same two dates. Nothing is computed per window,
     so a week and a quarter are the same page with a different span. */
  const blocks = focusSessions.filter((f) => inView(f.space) && inRange(f.day, range))
  const focusMin = blocks.reduce((a, f) => a + f.minutes, 0)
  /* A focus block writes its own ledger row, with the estimate equal to what it
     ran. Counted among the tasks it inflated the work count and handed the
     accuracy figure a free 100% every time he sat down. The blocks are told in
     their own panel, so the task numbers here are tasks only. */
  const fromFocus = new Set(focusSessions.map((f) => f.ledgerId).filter(Boolean) as string[])
  const rows = ledger.filter((e) => inView(e.space) && inRange(e.when, range) && !fromFocus.has(e.id))
  const saved = rows.reduce((a, e) => a + (e.estimateMin - e.actualMin), 0)
  const worked = rows.reduce((a, e) => a + e.actualMin, 0)
  const onTime = rows.filter((e) => Math.abs(e.estimateMin - e.actualMin) <= e.estimateMin * 0.25).length
  const accuracy = rows.length ? Math.round((onTime / rows.length) * 100) : 0

  /* What he actually did, counted. The page held the times and the shapes but
     never the plain totals, which are the first thing you want when you sit
     down to look back at a month. */
  const habitSpace = new Map(habits.map((h) => [h.id, h.space]))
  const myTicks = habitLog.filter((t) => inRange(t.day, range) && inView(habitSpace.get(t.habitId)))
  const keptDays = new Set(myTicks.map((t) => `${t.habitId}|${t.day}`)).size
  const routineSpace = new Map(routines.map((r) => [r.id, r.space]))
  const routinesDone = routineLog.filter((r) => inRange(r.day, range) && inView(routineSpace.get(r.routineId))).length

  /* How long this window is, in days. The written question follows it. */
  const spanDays = Math.max(1, Math.round((new Date(range.to).getTime() - new Date(range.from).getTime()) / 86400000) + 1)

  /* ---- the window before this one, for direction ---- */
  const prior = useMemo(() => priorRange(range), [range.from, range.to])
  const priorRows = ledger.filter((e) => inView(e.space) && inRange(e.when, prior) && !fromFocus.has(e.id))
  const priorFocus = focusSessions.filter((f) => inView(f.space) && inRange(f.day, prior)).reduce((a, f) => a + f.minutes, 0)
  const priorKept = new Set(habitLog.filter((t) => inRange(t.day, prior) && inView(habitSpace.get(t.habitId))).map((t) => `${t.habitId}|${t.day}`)).size

  /* ---- what he promised this window, and whether it landed ----
     The tasks he put on a week or a month in Goals. Nothing is inferred: a
     promise is done or it is not, and one whose period has ended without
     being done is the one worth naming. */
  const promises = tasks.filter((t) => inView(t.space) && t.horizon && t.horizonKey
    && (() => { const r = goalPeriodRange(t.horizon as GoalTf, t.horizonKey!); return r.from <= range.to && r.to >= range.from })())
  const promisesKept = promises.filter((t) => t.done)
  const promisesOpen = promises.filter((t) => !t.done)

  /* ---- which routines are actually still running ----
     A routine dies weeks before he notices. The log knows exactly when it
     started slipping, and never said so anywhere. */
  const adherence = routines
    .filter((r) => !r.archivedAt && inView(r.space))
    .map((r) => {
      const ran = new Set(routineLog.filter((x) => x.routineId === r.id && inRange(x.day, range)).map((x) => x.day)).size
      const due = occasionsIn(r.cadence, range)
      return { id: r.id, title: r.title, space: r.space, ran, due, pct: due ? Math.round((ran / due) * 100) : 0 }
    })
    .sort((a, b) => b.pct - a.pct)

  /* ---- what he avoided ----
     `carried` has been counted on every task that came back and shown as a
     chip on one row. Summed up, it is the most honest line on this page. */
  const cameBack = tasks.filter((t) => inView(t.space) && !t.done && (t.carried ?? 0) > 0)
    .sort((a, b) => (b.carried ?? 0) - (a.carried ?? 0))
  const oldestOpen = tasks.filter((t) => inView(t.space) && !t.done && t.createdAt)
    .sort((a, b) => (a.createdAt! < b.createdAt! ? -1 : 1))[0]
  const facedIn = coachSessions.filter((c) => inView(c.space) && inRange(c.when, range))
  const facedDone = facedIn.filter((c) => c.didIt)

  /* ---- where the time went ----
     Not a total, a split: the same hour spent on admin and on deep work is
     the same hour only to a clock. */
  const byCategory = ['deep', 'admin', 'call', 'quick'].map((c) => ({
    c, min: rows.filter((e) => e.category === c).reduce((a, e) => a + e.actualMin, 0),
  })).filter((x) => x.min > 0).sort((a, b) => b.min - a.min)

  const activeHabits = habits.filter((h) => !h.paused && !h.archivedAt && inView(h.space))
  const spaceGoals = goals.filter((g) => inView(g.space))
  /* The same accurate, period-aware read GoalsPage uses: a habit-linked
     goal's current count comes from the dated log inside its OWN window, not
     from the seven-day cache, and a day-counted goal cannot out-pace its own
     remaining days no matter the ratio. */
  const goalsOnTrack = spaceGoals.filter((g) => {
    const tf = (g.timeframe ?? 'quarter') as GoalTf
    const range = goalPeriodRange(tf, g.periodKey ?? goalPeriodKey(tf))
    const current = goalCurrent(g, habits, habitLog, range, slips, focusSessions)
    const fromHabit = habits.find((h) => h.id === g.habitId)
    const dailyCap = !!fromHabit && !isTimeFed(fromHabit)
    return goalPace(current, g.target, tf, new Date(), dailyCap) !== 'behind'
  }).length

  /* One row per step that has ever recorded a number, holding the runs inside
     this window. The best is all-time on purpose: a personal best does not stop
     being one because you are looking at a shorter window. */
  const numberSeries = useMemo(() => {
    const steps = [...new Set(stepLog.map((e) => `${e.routineId}|${e.stepId}`))]
    return steps.map((key) => {
      const [routineId, stepId] = key.split('|')
      const routine = routines.find((r) => r.id === routineId)
      const runs = stepSeries(stepLog, routineId, stepId).filter((e) => inRange(e.day, range))
      const meta = STEP_UNITS[stepId]
      return {
        key,
        label: routine?.steps.find((s) => s.id === stepId)?.title ?? routine?.title ?? 'A routine step',
        space: routine?.space,
        runs,
        best: records[`${routineId}:${stepId}`] ?? 0,
        unit: meta?.unit ?? '',
        target: meta?.target,
      }
    }).filter((n) => n.runs.length > 0 && inView(n.space))
  }, [stepLog, routines, records, range, inView])

  const live = (review.reflections ?? []).filter((r) => !r.supersededBy)
  const closed = live.find((r) => r.from === range.from && r.to === range.to)
  const previous = live.find((r) => r.to < range.from)

  /* Reopening a closed window loads what he wrote. It used to show only a
     banner, so pressing the button again saved three empty boxes over it. */
  useEffect(() => {
    const w = closed?.wins ?? []
    setWins([w[0] ?? '', w[1] ?? '', w[2] ?? ''])
    /* Older closes rode the note in wins[3]; it has its own field now. */
    setChanged(closed?.drifted ?? (w.length > 3 ? w.slice(3).join(' ') : ''))
    const o = closed?.outcomes ?? []
    setOutcomes([o[0] ?? '', o[1] ?? '', o[2] ?? ''])
  }, [closed?.id, range.from, range.to])

  const setW = (i: number, v: string) => setWins((p) => p.map((x, j) => (j === i ? v : x)))
  const setO = (i: number, v: string) => setOutcomes((p) => p.map((x, j) => (j === i ? v : x)))

  return (
    <div className="page">
      <Band
        title="Reflect"
        actions={
          <select
            className="textinput rangepick" value={rangeId}
            aria-label="Which window to review"
            onChange={(e) => setRangeId(e.target.value)}
          >
            <optgroup label="Recent">
              {RANGE_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </optgroup>
            <optgroup label="A month">
              {months.map((k) => <option key={k} value={k}>{monthName(k)}</option>)}
            </optgroup>
            <optgroup label="Or">
              <option value="all-time">Everything</option>
              <option value="custom">Pick the dates</option>
            </optgroup>
          </select>
        }
        metrics={[
          /* Green is earned: a week with nothing logged shows no-data, not a
             proud +0m, and accuracy is not asserted from zero estimates. */
          ...(rows.length ? [
            { v: saved >= 0 ? fmtSigned(saved) : fmtDuration(-saved), k: saved >= 0 ? 'time saved' : 'over your estimates', tone: (saved >= 0 ? 'pos' : 'urgent') as 'pos' | 'urgent' },
            { v: `${accuracy}%`, k: 'within a quarter of the estimate' },
          ] : [{ v: '—', k: 'nothing logged yet', tone: 'info' as const }]),
        ]}
      />

      <SecHead label={range.label} />
      {rangeId === 'custom' && (
        <div className="daterange">
          <label htmlFor="rfrom">From</label>
          <input id="rfrom" className="textinput" type="date" value={from} max={localDateKey()} onChange={(e) => setFrom(e.target.value)} />
          <label htmlFor="rto">to</label>
          <input id="rto" className="textinput" type="date" value={to} max={localDateKey()} onChange={(e) => setTo(e.target.value)} />
        </div>
      )}
      {closed && (
        <div className="allclear" style={{ borderColor: 'var(--progress)' }}>
          <span className="dot" aria-hidden="true" />
          Closed on {fmtWhen(closed.when)}. The numbers keep updating live.
        </div>
      )}

      <div className="grid-4">
        <div className="panel">
          <span className="microcap">Finished</span>
          <div className="kpi">{rows.length}<span className="unit">{rows.length === 1 ? 'task' : 'tasks'}</span></div>
          <div className="kpi-sub">{fmtDuration(worked)} of it, start to finish</div>
          <Delta now={rows.length} before={priorRows.length} />
        </div>
        <div className="panel">
          <span className="microcap">Habits kept</span>
          <div className="kpi val-pos">{keptDays}</div>
          <div className="kpi-sub">
            {routinesDone} {routinesDone === 1 ? 'routine' : 'routines'} finished
          </div>
          <Delta now={keptDays} before={priorKept} />
        </div>
        <div className="panel">
          <span className="microcap">Focus time</span>
          <div className="kpi val-pos">{fmtDuration(focusMin)}</div>
          <div className="kpi-sub">across {blocks.length} {blocks.length === 1 ? 'block' : 'blocks'}</div>
          <Delta now={focusMin} before={priorFocus} unit="m" />
        </div>
        <div className="panel">
          <span className="microcap">{saved >= 0 ? 'Time saved' : 'Time over'}</span>
          <div className={`kpi ${saved >= 0 ? 'val-pos' : 'val-urgent'}`}>{saved >= 0 ? fmtSigned(saved) : fmtDuration(-saved)}</div>
          <div className="kpi-sub">against your own estimates</div>
        </div>
        <div className="panel panel-wide">
          <span className="microcap">Goals on track</span>
          <div className="kpi">{goalsOnTrack}<span className="unit">of {spaceGoals.length}</span></div>
          <div className="rowlist" style={{ marginTop: 8 }}>
            {spaceGoals.slice(0, 5).map((g) => {
              const gtf = (g.timeframe ?? 'quarter') as GoalTf
              const grange = goalPeriodRange(gtf, g.periodKey ?? goalPeriodKey(gtf))
              const pct = Math.min(100, Math.round((goalCurrent(g, habits, habitLog, grange, slips, focusSessions) / g.target) * 100))
              return (
                <div className="rowitem" key={g.id} style={{ minHeight: 30 }}>
                  <span className="grow">{g.name}</span>
                  <span className={`drift ${pct < ON_TRACK_PCT ? 'off' : 'ok'}`}>{pct}%</span>
                </div>
              )
            })}
            {spaceGoals.length === 0 && <div className="empty">No goals in this profile.</div>}
          </div>
        </div>
      </div>

      {/* What this window was FOR. The tasks he promised to a week or a month
          in Goals, and whether they landed. This is the first question a
          review has to answer and the page never asked it. */}
      {promises.length > 0 && (
        <>
          <SecHead label="What you promised" />
          <div className="panel">
            <div className="rf-promise-head">
              <span className="kpi">{promisesKept.length}<span className="unit">of {promises.length} landed</span></span>
              {promisesOpen.length > 0 && (
                <button className="linkish" onClick={() => setPage('goals')}>
                  {promisesOpen.length} still open
                </button>
              )}
            </div>
            <div className="rowlist" style={{ marginTop: 8 }}>
              {promises.slice(0, 8).map((t) => (
                <div className="rowitem" key={t.id} style={{ minHeight: 30 }}>
                  <span className={`grow${t.done ? ' rf-done' : ''}`}>{t.title}</span>
                  <span className="meta mono">{goalPeriodRange(t.horizon as GoalTf, t.horizonKey!).label}</span>
                  <span className={`drift ${t.done ? 'ok' : 'off'}`}>{t.done ? 'done' : 'open'}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Which routines are still alive. A routine dies quietly, weeks before
          the feeling of it arrives, and the log knew all along. */}
      {adherence.length > 0 && (
        <>
          <SecHead label="Routines that held" />
          <div className="panel">
            <div className="rowlist" style={{ marginTop: 8 }}>
              {adherence.map((a) => (
                <div className="rowitem" key={a.id} style={{ minHeight: 30 }}>
                  <span className="grow">{a.title}</span>
                  <span className="meta mono">{a.ran} of {a.due}</span>
                  <span className={`drift ${a.pct >= 60 ? 'ok' : 'off'}`}>{a.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* The honest half. Work that keeps coming back, the oldest thing still
          waiting, and what he faced instead of moving. */}
      {(cameBack.length > 0 || oldestOpen || facedIn.length > 0) && (
        <>
          <SecHead label="What you avoided" />
          <div className="grid-3">
            <div className="panel">
              <span className="microcap">Came back</span>
              <div className={`kpi ${cameBack.length ? 'val-urgent' : ''}`}>{cameBack.length}</div>
              <div className="kpi-sub">
                {cameBack[0]
                  ? `“${cameBack[0].title}” has come back ${cameBack[0].carried}x`
                  : 'Nothing was pushed to another day.'}
              </div>
            </div>
            <div className="panel">
              <span className="microcap">Oldest thing waiting</span>
              {oldestOpen ? (
                <>
                  <div className="kpi">{Math.max(0, Math.round((new Date(localDateKey()).getTime() - new Date(oldestOpen.createdAt!).getTime()) / 86400000))}<span className="unit">days</span></div>
                  <div className="kpi-sub">{oldestOpen.title}</div>
                </>
              ) : (
                <div className="kpi-sub" style={{ marginTop: 8 }}>Nothing is ageing on the list.</div>
              )}
            </div>
            <div className="panel">
              <span className="microcap">Faced in Avoidance</span>
              <div className="kpi val-pos">{facedDone.length}<span className="unit">of {facedIn.length}</span></div>
              <div className="kpi-sub">
                {facedIn.filter((c) => c.didIt && c.felt === 'easier').length > 0
                  ? `${facedIn.filter((c) => c.didIt && c.felt === 'easier').length} felt easier than you feared`
                  : 'Naming it is the step that costs the most.'}
              </div>
            </div>
          </div>
        </>
      )}

      {/* An hour of admin and an hour of deep work are the same hour only to a
          clock. */}
      {byCategory.length > 0 && (
        <>
          <SecHead label="Where the time went" />
          <div className="panel">
            <div className="rowlist" style={{ marginTop: 8 }}>
              {byCategory.map((b) => (
                <div className="rowitem" key={b.c} style={{ minHeight: 30 }}>
                  <span className={`cat-dot ${b.c}`} aria-hidden="true" />
                  <span className="grow">{b.c === 'deep' ? 'Deep work' : b.c === 'admin' ? 'Admin' : b.c === 'call' ? 'Calls' : 'Quick things'}</span>
                  <span className="bar prog rf-bar"><i style={{ width: `${Math.round((b.min / worked) * 100)}%` }} /></span>
                  <span className="meta mono">{fmtDuration(b.min)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <SecHead label="Habits" />
      <div>
        <div className="panel">
          <div className="rowlist" style={{ marginTop: 8 }}>
            {activeHabits.map((h) => {
              const hist = [...(h.history ?? []), h.days.filter(Boolean).length]
              const twin = activeHabits.some((x) => x.id !== h.id && x.name === h.name)
              /* Kept days inside THIS window, against the days it could have
                 been kept. The spark shows the shape; this says the rate. */
              const keptHere = new Set(habitLog.filter((t) => t.habitId === h.id && inRange(t.day, range)).map((t) => t.day)).size
              const chances = Math.max(1, Math.round((new Date(range.to).getTime() - new Date(range.from).getTime()) / 86400000) + 1)
              /* Dying, not stillborn: it was kept before this window and not
                 once inside it. A habit that never started gets no red word;
                 the page would be a wall of accusation and he would stop
                 opening it. */
              const keptEver = habitLog.some((t) => t.habitId === h.id && t.day < range.from)
              const dying = keptEver && keptHere === 0 && chances >= 7
              return (
                <div className="rowitem" key={h.id} style={{ minHeight: 34 }}>
                  <span className="grow">{h.name}{twin && <span className="habit-qual">{SPACE_LABELS[h.space]}</span>}</span>
                  {/* Said plainly, once, where he can act on it. */}
                  {dying && <span className="rf-dead">kept before, not once here</span>}
                  {hist.length > 1 ? <Spark data={hist} width={110} height={22} /> : <span className="meta">first week</span>}
                  <span className="mono meta">{keptHere} of {chances} days</span>
                </div>
              )
            })}
            {activeHabits.length === 0 && <div className="empty">No active habits in this profile.</div>}
          </div>
        </div>
      </div>

      {/* Numbers a routine step recorded, over the same window as everything
          else on this page. Looking back at them is a Reflect job, not something
          to read while you are still typing the number in. */}
      {numberSeries.length > 0 && (
        <>
          <SecHead label="Numbers" />
          {numberSeries.map((n) => {
            return (
              <div className="panel numpanel" key={n.key}>
                <div className="numpanel-head">
                  <span className="numpanel-title">{n.label}</span>
                  {n.best > Math.max(...n.runs.map((r) => r.value)) && (
                    <span className="numpanel-fig mono">best {n.best} {n.unit}, before this window</span>
                  )}
                </div>
                {/* Always drawn, from the first run. A chart with one point on
                    it is the start of the chart; replacing it with a sentence
                    means the graph only appears once you no longer need telling.
                    Scrolls rather than shrinks: scaled to a phone's width the
                    whole drawing shrinks with it and every label goes to about
                    four pixels. */}
                <ChartArea runs={n.runs} target={n.target} unit={n.unit} />
              </div>
            )
          })}
        </>
      )}

      <SecHead label="Everything logged" />
      <div className="panel">
        <div className="ledger-list">
          {rows.slice(0, 60).map((e) => {
            const d = e.estimateMin - e.actualMin
            return (
              <div className="ledger-row" key={e.id}>
                <SpaceMark space={e.space} />
                <span className="mono" style={{ color: 'var(--faint)', fontSize: 'var(--text-xs)', minWidth: '3ch' }}>{fmtWhen(e.when)}</span>
                <span className="ledger-title">{e.title}</span>
                <span className="chip tone-info is-src">{e.category}</span>
                <span className="mono" style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>{fmtDuration(e.estimateMin)} → {fmtDuration(e.actualMin)}</span>
                <span className={`delta ${d >= 0 ? 'saved' : 'over'}`}>{d >= 0 ? `+${d}m` : `${-d}m over`}</span>
              </div>
            )
          })}
          {rows.length === 0 && <div className="empty">Nothing logged in this window.</div>}
        </div>
      </div>

      {/* A month is long enough to have forgotten why. The last thing it shows
          is his own wall, in his own words, picked by the window so it holds
          still while he reads it. */}
      {spanDays > 10 && (() => {
        const lines = WALL.filter((c) => c.kind === 'statement' || c.kind === 'quote' || c.kind === 'rule')
        if (!lines.length) return null
        const seed = [...range.from].reduce((a, ch) => a + ch.charCodeAt(0), 0)
        const card = lines[seed % lines.length] as { kind: string; text: string; by?: string }
        return (
          <>
            <SecHead label="Why any of this" />
            <button className="panel rf-why" onClick={() => setPage('board')}>
              <span className="rf-why-text">{card.text}</span>
              {card.by && <span className="rf-why-by">{card.by}</span>}
            </button>
          </>
        )
      })()}

      <SecHead label="Checkup" />
      {/* The question follows the window. A quarter does not deserve the same
          question as a Tuesday. */}
      {previous && (previous.wins.length > 0 || previous.outcomes.length > 0) && (
        <div className="panel lastweek">
          <span className="microcap">{previous.label}, you said</span>
          <div className="lastweek-cols">
            {previous.wins.length > 0 && (
              <div>
                <span className="lastweek-h">went well</span>
                <ul className="lastweek-list">{previous.wins.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </div>
            )}
            {previous.outcomes.length > 0 && (
              <div>
                <span className="lastweek-h">you committed to</span>
                <ul className="lastweek-list">{previous.outcomes.map((o, i) => <li key={i}>{o}</li>)}</ul>
              </div>
            )}
            {previous.drifted && (
              <div>
                <span className="lastweek-h">what drifted</span>
                <ul className="lastweek-list"><li>{previous.drifted}</li></ul>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="panel checkup-panel">
        <div className="checkup-cols">
          <div className="checkup-col">
            <h4 className="checkup-q">What actually went well?</h4>
            {wins.map((w, i) => (
              <input key={i} className="textinput" style={{ marginBottom: 8, width: '100%' }} placeholder={`Win ${i + 1}`} value={w} onChange={(e) => setW(i, e.target.value)} aria-label={`Win ${i + 1}`} />
            ))}
            <h4 className="checkup-q">{spanDays > 60 ? 'Is this still what you want?' : spanDays > 10 ? 'What do you stop doing?' : 'What got in the way?'}</h4>
            <input className="textinput" style={{ width: '100%' }} placeholder="One honest note…" value={changed} onChange={(e) => setChanged(e.target.value)} aria-label="What to change" />
          </div>
          <div className="checkup-col">
            <h4 className="checkup-q">Three outcomes for next time</h4>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginBottom: 8 }}>Results you can check off. They land in the backlog.</p>
            {outcomes.map((o, i) => (
              <input key={i} className="textinput" style={{ marginBottom: 8, width: '100%' }} placeholder={`Outcome ${i + 1}`} value={o} onChange={(e) => setO(i, e.target.value)} aria-label={`Outcome ${i + 1}`} />
            ))}
            <div className="coach-nav">
              <button
                className="btn btn-primary"
                onClick={() => {
                  /* Wins keep their three positions so an empty first box can
                     never promote the note into a win on reopen. */
                  closeReview({ id: range.id, label: range.label, from: range.from, to: range.to }, wins.map((x) => x.trim()), outcomes.filter(Boolean), changed)
                  setWins(['', '', '']); setChanged(''); setOutcomes(['', '', ''])
                }}
              >
                {closed ? 'Update this window' : 'Close this window'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------------- SETTINGS ---------------- */

/* Sync is what makes the same day show up on the laptop and the phone, and it is
   also the only backup. It runs behind a login because the key that reaches the
   database ships inside this page: without a session on the request, the database
   cannot tell him apart from anyone who opened the site. */
function AccountField() {
  const [me, setMe] = useState<Account | null>(null)
  const [ready, setReady] = useState(false)
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void currentAccount().then((a) => { setMe(a); setReady(true) })
    return onAccountChange((a) => setMe(a))
  }, [])

  if (!SUPABASE_ENABLED) {
    return (
      <div className="source-row">
        <span className="status-dot off" />
        <span className="info">
          <span className="name">Sync</span>
          <span className="detail" style={{ display: 'block' }}>Off in this build. Everything stays in this browser.</span>
        </span>
      </div>
    )
  }

  const send = async () => {
    setBusy(true); setErr(null)
    const e = await sendSignInCode(email)
    setBusy(false)
    if (e) setErr(e); else { setSent(true); setCode('') }
  }
  const verify = async () => {
    setBusy(true); setErr(null)
    const e = await signInWithCode(email, code)
    setBusy(false)
    if (e) setErr(e)
  }

  return (
    <div className="ai-key">
      <div className="source-row">
        <span className={`status-dot ${me ? 'connected' : 'off'}`} />
        <span className="info">
          <span className="name">Sync across your devices</span>
          <span className="detail" style={{ display: 'block' }}>
            {!ready ? 'Checking...'
              : me ? `Signed in as ${me.email}. Every change is saved and reaches your other devices.`
              : 'Signed out. This browser only, and nothing is backed up.'}
          </span>
        </span>
        {me
          ? <button className="btn btn-quiet" onClick={() => void signOutAccount()}>Sign out</button>
          : null}
      </div>
      {ready && !me && !sent && (
        <>
          <div className="formrow" style={{ marginTop: 'var(--s2)', marginBottom: 0 }}>
            <input
              className="textinput grow" type="email" placeholder="you@example.com" value={email}
              onChange={(e) => { setEmail(e.target.value); setErr(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && email.includes('@') && !busy) void send() }}
              aria-label="Email for the sign-in code"
            />
            <button className="btn btn-primary" disabled={!email.includes('@') || busy} onClick={() => void send()}>
              {busy ? 'Sending...' : 'Email me a code'}
            </button>
          </div>
          <p className="assist-note" style={{ marginTop: 6 }}>
            {err ?? 'No password. A code arrives, you type it back, and this device stays signed in.'}
          </p>
        </>
      )}
      {ready && !me && sent && (
        <>
          <div className="formrow" style={{ marginTop: 'var(--s2)', marginBottom: 0 }}>
            <input
              className="textinput grow mono" inputMode="numeric" autoComplete="one-time-code"
              placeholder="00000000" value={code}
              onChange={(e) => { setCode(e.target.value); setErr(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && code.trim().length >= 6 && !busy) void verify() }}
              aria-label="The code from the email"
            />
            <button className="btn btn-primary" disabled={code.trim().length < 6 || busy} onClick={() => void verify()}>
              {busy ? 'Checking...' : 'Sign in'}
            </button>
          </div>
          <p className="assist-note" style={{ marginTop: 6 }}>
            {err ?? `Sent to ${email}. The email is titled "Your Magic Link" and holds the code.`}
            {' '}
            <button className="linkish" onClick={() => { setSent(false); setErr(null) }}>Use a different address</button>
          </p>
        </>
      )}
    </div>
  )
}

function AiKeyField() {
  const [key, setKey] = useState(getAiKey())
  const [saved, setSaved] = useState(false)
  const live = hasAiKey()
  return (
    <div className="ai-key">
      <div className="source-row">
        <span className={`status-dot ${live ? 'connected' : 'off'}`} />
        <span className="info">
          <span className="name">Groq, for breaking tasks down and /help in Notes</span>
          <span className="detail" style={{ display: 'block' }}>
            {live ? 'Connected. Break it down reads the actual task, and /help works in Notes.' : 'Not set. Break it down falls back to a pattern library, and /help in Notes does nothing.'}
          </span>
        </span>
        <a className="btn btn-quiet" href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Get a free key ↗</a>
      </div>
      <div className="formrow" style={{ marginTop: 'var(--s2)', marginBottom: 0 }}>
        <input
          className="textinput grow" type="password" placeholder="gsk_…" value={key}
          onChange={(e) => { setKey(e.target.value); setSaved(false) }}
          aria-label="Groq API key"
        />
        <button className="btn btn-primary" onClick={() => { setAiKey(key); setSaved(true) }}>Save</button>
      </div>
      <p className="assist-note" style={{ marginTop: 6 }}>
        {saved ? 'Saved on this device.' : 'Kept in this browser only. Never synced, never in the code, so it cannot leak through the public repo. You paste it once per device.'}
      </p>
    </div>
  )
}

export function SettingsPage() {
  const { sources, toggleSource, resetDemo, setPage, inView } = useStore()
  return (
    <div className="page">
      <Band title="Settings" />
      <div className="grid-2">
        <div className="panel">
          <span className="microcap">Connected sources</span>
          {sources.map((s) => (
            <div className="source-row" key={s.id}>
              <span className={`status-dot ${s.status}`} />
              <span className="info">
                <span className="name">{s.name}</span>
                {/* The tag already says not-connected; the detail only speaks
                    when it adds something. */}
                {s.detail !== 'Not connected yet' && <span className="detail" style={{ display: 'block' }}>{s.detail}</span>}
              </span>
              {/* No switch: flipping one set the row to "connected" while its
                  own detail still said "Not connected yet", and Today's footer
                  started counting a fantasy as "1 of 6 live". A source becomes
                  a switch the day a real connect flow exists behind it. */}
              {s.status === 'manual'
                ? <span className="chip tone-info is-src">manual</span>
                : <span className="chip tone-info is-src">{s.status === 'connected' ? 'live' : 'not connected'}</span>}
            </div>
          ))}

        </div>
        <div className="panel">
          <span className="microcap">Your account</span>
          <AccountField />
          <span className="microcap" style={{ marginTop: 24, display: 'block' }}>AI</span>
          <AiKeyField />
          <span className="microcap" style={{ marginTop: 24, display: 'block' }}>Design</span>
          <div className="source-row">
            <span className="info"><span className="name">Brand &amp; guidelines</span><span className="detail" style={{ display: 'block' }}>The colours, type and rules this app is built on</span></span>
            <button className="btn btn-quiet" onClick={() => setPage('brand')}>Open</button>
          </div>
          <span className="microcap" style={{ marginTop: 24, display: 'block' }}>Start over</span>
          <div className="source-row">
            <span className="info"><span className="name">Wipe everything</span><span className="detail" style={{ display: 'block' }}>Clears this device and the saved copy. There is no undo on this one.</span></span>
            <button className="btn btn-danger" style={{ border: '1px solid var(--alert)' }} onClick={resetDemo}>Wipe</button>
          </div>
        </div>
      </div>
    </div>
  )
}
