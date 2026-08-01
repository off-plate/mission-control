import { useEffect, useMemo, useRef, useState } from 'react'
import { COACH_SCENARIOS, MOCK_MONEY, MOCK_STATS } from './mock'
import { AutoTextarea, Band, SpaceMark } from './pages1'
import { useStore } from './store'
import { Spark, SparkBox } from './widgets'
import { RANGE_OPTIONS, allTimeRange, customRange, fmtDuration, fmtNum, fmtSigned, fmtWhen, goalPace, inRange, isoWeekKey, localDateKey, monthName, monthRange, monthsWithData, rangeFor, taskMinutes, type RangeId } from './util'
import { analyzeAvoidance, fallbackRead } from './coach'
import { getAiKey, hasAiKey, readAvoidance, setAiKey, type AvoidanceRead } from './ai'
import { paymentTaskTitle } from './exceptions'
import { SUPABASE_ENABLED, currentAccount, onAccountChange, sendSignInCode, signInWithCode, signOutAccount, type Account } from './supabase'
import { goalCurrent, ON_TRACK_PCT, STEP_UNITS, stepSeries, type StepEntry, type CoachFacts, type CoachSession, type TaskCategory } from './types'

/* ---------------- MONEY ---------------- */

/* Money is one pool — his real finances do not split by profile — so this page
   is identical in every space instead of dead-ending outside Personal. */
/** Kč written as a number, so paid amounts can be added up. */
const kc = (s: string) => Number(s.replace(/[^\d]/g, '')) || 0

/* The sections stay; only the numbers are gone. An empty section that names
   what belongs there is a place for real data to land. An invented number is
   not. */
function NoData({ label }: { label: string }) {
  return <div className="kpi nodata">&mdash;<span className="unit">{label}</span></div>
}

export function MoneyPage() {
  const f = MOCK_MONEY

  return (
    <div className="page">
      <Band title="Money" />
      <div className="grid-3">
        <div className="panel">
          <span className="microcap">Debt payoff</span>
          {f ? (
            <>
              <div className="kpi">{fmtNum(kc(f.debt.remaining))} Kč<span className="unit">left</span></div>
              <div className="bar debt" style={{ marginTop: 12 }}><i style={{ width: `${f.debt.pct}%` }} /></div>
              <div className="kpi-sub"><span className="val-pos">{f.debt.paid} paid</span> of {f.debt.original}</div>
            </>
          ) : (
            <>
              <NoData label="left" />
              <div className="bar debt" style={{ marginTop: 12 }}><i style={{ width: '0%' }} /></div>
              <div className="kpi-sub">What you still owe, and how much of it is cleared.</div>
            </>
          )}
        </div>

        <div className="panel">
          <span className="microcap">Monthly payments</span>
          {f ? (
            <>
              <div className="kpi">{f.debt.monthly}<span className="unit">/ month</span></div>
              <div className="kpi-sub">across your payment plans</div>
            </>
          ) : (
            <>
              <NoData label="/ month" />
              <div className="bar prog" style={{ marginTop: 12 }}><i style={{ width: '0%' }} /></div>
              <div className="kpi-sub">What leaves the account each month across your payment plans.</div>
            </>
          )}
        </div>

        <div className="panel">
          <span className="microcap">Monthly savings</span>
          {f ? (
            <>
              <div className="kpi val-pos">{f.savings.thisMonth}</div>
              <div className="kpi-sub">set aside this month</div>
            </>
          ) : (
            <>
              <NoData label="this month" />
              <div className="kpi-sub">What you managed to put aside, month by month.</div>
            </>
          )}
        </div>
      </div>

      <div className="panel money-compass" style={{ marginTop: 'var(--s5)' }}>
        <div className="money-compass-copy">
          <span className="microcap">{f ? 'The full picture lives in Compass' : 'Not connected yet'}</span>
          <p>
            {f
              ? 'Debts, budget, goals and the five-year plan are managed in Compass. This page is the at-a-glance readout.'
              : 'Your debts, budget and payment plans live in Compass. These panels stay empty until that link exists, because a number here that is not yours is worse than none.'}
          </p>
        </div>
        <a className="btn btn-primary money-compass-btn" href="https://compass-money.netlify.app" target="_blank" rel="noreferrer">
          Open Compass
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M7 17L17 7M17 7H8M17 7v9" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </a>
      </div>
    </div>
  )
}

/* ---------------- REVIEW (weekly reset + stats, merged) ---------------- */

/* A section heading is the heading. No explanatory note: it restated the
   label and added nothing you could act on. See DESIGN.md, "No subtitles". */
function SecHead({ label }: { label: string }) {
  return (
    <div className="review-sec">
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

export function ReviewPage() {
  const { space, habits, goals, closeReview, review, ledger, focusSessions, habitLog, routineLog, stepLog, routines, records, inView } = useStore()
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
  const rows = ledger.filter((e) => inView(e.space) && inRange(e.when, range))
  const saved = rows.reduce((a, e) => a + (e.estimateMin - e.actualMin), 0)
  const worked = rows.reduce((a, e) => a + e.actualMin, 0)
  const onTime = rows.filter((e) => Math.abs(e.estimateMin - e.actualMin) <= e.estimateMin * 0.25).length
  const accuracy = rows.length ? Math.round((onTime / rows.length) * 100) : 0
  const blocks = focusSessions.filter((f) => inView(f.space) && inRange(f.day, range))
  const focusMin = blocks.reduce((a, f) => a + f.minutes, 0)

  const activeHabits = habits.filter((h) => !h.paused && !h.archivedAt && inView(h.space))
  const spaceGoals = goals.filter((g) => inView(g.space))
  const goalsOnTrack = spaceGoals.filter((g) => goalPace(goalCurrent(g, habits), g.target, g.timeframe ?? 'quarter') !== 'behind').length

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
    setChanged(w.length > 3 ? w.slice(3).join(' ') : '')
    const o = closed?.outcomes ?? []
    setOutcomes([o[0] ?? '', o[1] ?? '', o[2] ?? ''])
  }, [closed?.id, range.from, range.to])

  const setW = (i: number, v: string) => setWins((p) => p.map((x, j) => (j === i ? v : x)))
  const setO = (i: number, v: string) => setOutcomes((p) => p.map((x, j) => (j === i ? v : x)))

  return (
    <div className="page">
      <Band
        title="Review"
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
          { v: fmtSigned(saved), k: 'time saved', tone: 'pos' as const },
          { v: `${accuracy}%`, k: 'estimate accuracy' },
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
          <span className="microcap">Work logged</span>
          <div className="kpi">{rows.length}</div>
          <div className="kpi-sub">{fmtDuration(worked)} of it, start to finish</div>
        </div>
        <div className="panel">
          <span className="microcap">Focus time</span>
          <div className="kpi val-pos">{fmtDuration(focusMin)}</div>
          <div className="kpi-sub">across {blocks.length} {blocks.length === 1 ? 'block' : 'blocks'}</div>
        </div>
        <div className="panel">
          <span className="microcap">Time saved</span>
          <div className={`kpi ${saved >= 0 ? 'val-pos' : 'val-urgent'}`}>{fmtSigned(saved)}</div>
          <div className="kpi-sub">against your own estimates</div>
        </div>
        <div className="panel">
          <span className="microcap">Goals on track</span>
          <div className="kpi">{goalsOnTrack}<span className="unit">of {spaceGoals.length}</span></div>
          <div className="rowlist" style={{ marginTop: 8 }}>
            {spaceGoals.slice(0, 5).map((g) => {
              const pct = Math.min(100, Math.round((goalCurrent(g, habits) / g.target) * 100))
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

      <SecHead label="Habits" />
      <div>
        <div className="panel">
          <div className="rowlist" style={{ marginTop: 8 }}>
            {activeHabits.map((h) => {
              const hist = [...(h.history ?? []), h.days.filter(Boolean).length]
              return (
                <div className="rowitem" key={h.id} style={{ minHeight: 34 }}>
                  <span className="grow">{h.name}</span>
                  {hist.length > 1 ? <Spark data={hist} width={110} height={22} /> : <span className="meta">first week</span>}
                  <span className="mono meta">{hist[hist.length - 1]}/7</span>
                </div>
              )
            })}
            {activeHabits.length === 0 && <div className="empty">No active habits in this profile.</div>}
          </div>
        </div>
      </div>

      {/* Numbers a routine step recorded, over the same window as everything
          else on this page. Looking back at them is a Review job, not something
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
                <span className="src-tag">{e.category}</span>
                <span className="mono" style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>{fmtDuration(e.estimateMin)} → {fmtDuration(e.actualMin)}</span>
                <span className={`delta ${d >= 0 ? 'saved' : 'over'}`}>{d >= 0 ? `+${d}m` : `${d}m`}</span>
              </div>
            )
          })}
          {rows.length === 0 && <div className="empty">Nothing logged in this window.</div>}
        </div>
      </div>

      <SecHead label="Checkup" />
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
            <h4 className="checkup-q">What drifted, and one change?</h4>
            <input className="textinput" style={{ width: '100%' }} placeholder="One honest note" value={changed} onChange={(e) => setChanged(e.target.value)} aria-label="What to change" />
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
                  closeReview({ id: range.id, label: range.label, from: range.from, to: range.to }, [...wins, changed].filter(Boolean), outcomes.filter(Boolean))
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

/* ---------------- COACH ----------------
   Coach is for a thing you are avoiding. You give it the thing in plain
   words; it breaks the thing down factually (what it is, the steps, the
   cost of stalling) and hands you an easy first step. You do the step, then
   tell it how it actually felt. That last part is the point: it trains the
   fear back down. You never fill in the analysis, Coach does. */

type CoachStage = 'home' | 'review' | 'saved'
const EMPTY_FACTS: CoachFacts = { avoiding: '', steps: '', cost: '' }

const FELT_OPTS: { key: NonNullable<CoachSession['felt']>; label: string }[] = [
  { key: 'easier', label: 'Easier than I feared' },
  { key: 'as-feared', label: 'About what I expected' },
  { key: 'harder', label: 'Harder than I feared' },
]
const FELT_TAG: Record<NonNullable<CoachSession['felt']>, string> = {
  easier: 'easier than feared', 'as-feared': 'about as expected', harder: 'harder than feared',
}

function ReflectForm({ onSubmit, onCancel }: { onSubmit: (didIt: boolean, felt: CoachSession['felt'], text: string) => void; onCancel: () => void }) {
  const [didIt, setDidIt] = useState(true)
  const [felt, setFelt] = useState<NonNullable<CoachSession['felt']>>('easier')
  const [text, setText] = useState('')
  return (
    <div className="coach-reflect">
      <span className="coach-field-q">Did you do it?</span>
      <div className="coach-choice">
        <button className={didIt ? 'on' : ''} onClick={() => setDidIt(true)}>Yes</button>
        <button className={!didIt ? 'on' : ''} onClick={() => setDidIt(false)}>Not yet</button>
      </div>
      {/* "How did it feel" only makes sense once you have actually done it. */}
      {didIt && (
        <>
          <span className="coach-field-q">How did it actually feel?</span>
          <div className="coach-choice wrap">
            {FELT_OPTS.map((o) => (
              <button key={o.key} className={felt === o.key ? 'on' : ''} onClick={() => setFelt(o.key)}>{o.label}</button>
            ))}
          </div>
        </>
      )}
      <AutoTextarea className="textinput" minRows={2} style={{ width: '100%', marginTop: 'var(--s2)' }}
        placeholder={didIt ? 'What did it feel like? One honest line.' : 'What is actually in the way? One honest line.'}
        value={text} onChange={(e) => setText(e.target.value)} aria-label={didIt ? 'How it felt' : 'What is in the way'} />
      {!didIt && <p className="assist-note" style={{ marginTop: 'var(--s2)' }}>This stays open. An unfaced thing should keep showing up.</p>}
      <div className="coach-nav">
        <button className="btn btn-quiet" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onSubmit(didIt, felt, text.trim())}>
          {didIt ? 'Close the loop' : 'Save the note'}
        </button>
      </div>
    </div>
  )
}

export function CoachPage() {
  const { space, tasks, setPage, coachOpen, setCoachOpen, coachSessions, startCoachSession, reflectCoachSession, deleteCoachSession, inView } = useStore()
  const [stage, setStage] = useState<CoachStage>('home')
  const [thing, setThing] = useState('')
  const [title, setTitle] = useState('')
  const [facts, setFacts] = useState<CoachFacts>(EMPTY_FACTS)
  const [firstStep, setFirstStep] = useState('')
  const [meta, setMeta] = useState<{ firstStepMin: number; category: TaskCategory }>({ firstStepMin: 10, category: 'admin' })
  const [read, setRead] = useState<AvoidanceRead | null>(null)
  const [fromModel, setFromModel] = useState(false)
  const [why, setWhy] = useState('')
  const [thinking, setThinking] = useState(false)
  const [reflectId, setReflectId] = useState<string | null>(null)

  /* His own eight-beat approach, applied by the model to what he actually
     wrote. Without a key it falls back to the template library and says so. */
  const analyze = async (input: string) => {
    setTitle(input.trim())
    setThinking(true)
    setStage('review')
    const r = await readAvoidance(input)
    if (r.ok) {
      setRead(r.read)
      setFromModel(true)
      setFirstStep(r.read.firstStep)
      setMeta({ firstStepMin: r.read.firstStepMin, category: r.read.category })
      setFacts({ avoiding: r.read.naming, steps: r.read.nextPiece, cost: r.read.document })
    } else {
      const a = analyzeAvoidance(input)
      // Same eight beats either way. Generic content is honest; a different page
      // shape for the same feature is not.
      setRead(fallbackRead(input))
      setFromModel(false)
      setWhy(
        r.reason === 'no-key' ? 'No Groq key yet.'
        : r.reason === 'bad-key' ? 'That Groq key was rejected.'
        : r.reason === 'rate-limit' ? 'Groq is rate limiting right now.'
        : 'Groq could not be reached.')
      setFacts({ avoiding: a.avoiding, steps: a.steps, cost: a.cost })
      setFirstStep(a.firstStep)
      setMeta({ firstStepMin: a.firstStepMin, category: a.category })
    }
    setThinking(false)
  }

  /* Today deep-links here two ways: a known scenario id, or the raw title of a
     task that has been sitting too long. Either way Coach starts from something
     real instead of an empty box. */
  useEffect(() => {
    if (!coachOpen) return
    const s = COACH_SCENARIOS.find((x) => x.id === coachOpen)
    const seed = s ? s.title : coachOpen
    setThing(seed)
    void analyze(seed)
    setCoachOpen(null)
  }, [coachOpen])

  const reset = () => { setStage('home'); setThing(''); setTitle(''); setFacts(EMPTY_FACTS); setFirstStep(''); setRead(null); setFromModel(false); setWhy('') }
  const setFact = (k: keyof CoachFacts, v: string) => setFacts((f) => ({ ...f, [k]: v }))
  const save = () => {
    startCoachSession({ title: title.trim() || thing.trim(), facts, firstStep: firstStep.trim(), firstStepMin: meta.firstStepMin, category: meta.category })
    setStage('saved')
  }

  // Loops belong to the profile they were opened in (older ones show everywhere).
  const mine = coachSessions.filter((s) => inView(s.space))
  const open = mine.filter((s) => s.status === 'open')
  const closed = mine.filter((s) => s.status === 'closed')
  const easedCount = closed.filter((s) => s.didIt && s.felt === 'easier').length
  /* The starters are HIS list, all of it: every open task from the plan and
     the backlog, ranked by how avoided a thing looks, what keeps coming back
     first, then what has waited longest. Canned scenarios only appear when the
     list is empty, because the point of this page is HIS things. */
  const oldest = tasks
    .filter((t) => !t.done && inView(t.space))
    .sort((a, b) => (b.carried ?? 0) - (a.carried ?? 0)
      || ((a.createdAt ?? '9999') < (b.createdAt ?? '9999') ? -1 : 1))

  /* ---- review the breakdown Coach drafted, then commit ---- */
  if (stage === 'review') {
    return (
      <div className="page">
        <Band title={title || 'Avoidance'} />
        <div className="panel coach-facts">
          <div className="coach-drafted">
            <span className="microcap">{fromModel ? 'Read through the eight beats' : 'Generic, not read'}</span>
            <span className="assist-note">
              {fromModel
                ? 'Your own approach, applied to what you wrote. Change anything that is off, then send the first step to Today.'
                : `${why} These beats came from a pattern library, so they are generic and do not know what you wrote.`}
            </span>
            {!fromModel && (
              <button className="btn btn-primary" style={{ marginTop: 'var(--s2)', alignSelf: 'flex-start' }} onClick={() => setPage('settings')}>
                Add a key so it reads it
              </button>
            )}
          </div>

          {thinking && <div className="empty" style={{ paddingTop: 20 }}>Reading what you wrote.</div>}

          {/* His eight beats, in his order, all eight present. Rendering only the
              ones the model filled left holes at 4 and 7, and a two-column grid
              turned 1..8 into a zigzag, so the sequence he wrote was unreadable. */}
          {!thinking && read && (
            <ol className="beats">
              <li className="beat">
                <span className="beat-n">1</span>
                <div className="beat-body">
                  <span className="beat-h">Name it out loud</span>
                  <p>{read.naming}</p>
                  {read.absolutes.length > 0 && (
                    <p className="beat-abs">The spiral talks in absolutes. You used: {read.absolutes.map((a) => `“${a}”`).join(', ')}</p>
                  )}
                </div>
              </li>

              <li className="beat">
                <span className="beat-n">2</span>
                <div className="beat-body">
                  <span className="beat-h">Separate the feeling from the verdict</span>
                  <p className="beat-feel"><b>Feel this:</b> {read.feeling}</p>
                  <p className="beat-verdict"><b>Do not sign this:</b> {read.verdict}</p>
                </div>
              </li>

              <li className="beat">
                <span className="beat-n">3</span>
                <div className="beat-body">
                  <span className="beat-h">Open the actual document</span>
                  <p>{read.document}</p>
                </div>
              </li>

              <li className="beat beat-action">
                <span className="beat-n">4</span>
                <div className="beat-body" style={{ width: '100%' }}>
                  <span className="beat-h">Shrink it to the first physical action</span>
                  <input className="textinput" style={{ width: '100%', marginTop: 6 }} value={firstStep}
                    onChange={(e) => setFirstStep(e.target.value)} aria-label="First step" />
                  <div className="coach-field-inline" style={{ marginTop: 'var(--s2)' }}>
                    <span>Give it</span>
                    <input className="textinput" type="number" min={1} max={120} style={{ width: 72 }} value={meta.firstStepMin}
                      onChange={(e) => setMeta((m) => ({ ...m, firstStepMin: Math.max(1, Number(e.target.value) || 1) }))} aria-label="Minutes" />
                    <span>min ·</span>
                    <select className="textinput" value={meta.category} onChange={(e) => setMeta((m) => ({ ...m, category: e.target.value as TaskCategory }))} aria-label="Category">
                      <option value="call">call</option><option value="admin">admin</option><option value="deep">deep</option><option value="quick">quick</option>
                    </select>
                  </div>
                </div>
              </li>

              <li className="beat">
                <span className="beat-n">5</span>
                <div className="beat-body">
                  <span className="beat-h">Take it on your terms</span>
                  <p>{read.onYourTerms}</p>
                </div>
              </li>

              <li className="beat">
                <span className="beat-n">6</span>
                <div className="beat-body">
                  <span className="beat-h">One piece, never the stack</span>
                  <p>{read.nextPiece}</p>
                </div>
              </li>

              <li className="beat">
                <span className="beat-n">7</span>
                <div className="beat-body">
                  <span className="beat-h">Do not decide big things from the bottom</span>
                  <p>{read.defer || 'Nothing here is a decision of that size. If one shows up, it waits for a clear-headed day.'}</p>
                </div>
              </li>

              <li className="beat">
                <span className="beat-n">8</span>
                <div className="beat-body">
                  <span className="beat-h">Do not carry it fully alone</span>
                  <p>{read.who || 'Say it out loud to one person who knows the terrain. Not for rescue, just so it is not only in your head.'}</p>
                </div>
              </li>
            </ol>
          )}

          {!thinking && (
            <div className="coach-nav">
              <button className="btn btn-quiet" onClick={reset}>Back</button>
              <button className="btn btn-primary" disabled={!firstStep.trim()} onClick={save}>Put first step on Today</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (stage === 'saved') {
    return (
      <div className="page">
        <Band title={title || 'Avoidance'} />
        <div className="panel coach-facts">
          <div className="allclear" style={{ borderColor: 'var(--progress)', marginTop: 0 }}>
            <span className="dot" aria-hidden="true" />
            First step is on Today: {firstStep}
          </div>
          <p className="coach-body">This is an open loop now. Once you have done it, come back and tell Coach how it actually felt. That reflection is what trains the dread down over time.</p>
          <div className="coach-nav">
            <button className="btn btn-ghost" onClick={() => setPage('today')}>Open Today</button>
            <button className="btn btn-primary" onClick={reset}>Done</button>
          </div>
        </div>
      </div>
    )
  }

  /* ---- home: name the thing, Coach breaks it down ---- */
  return (
    <div className="page">
      <Band title="Avoidance" />

      {/* Two columns above 1600px: the box on the left, everything you can act
          on to its right, so an ultrawide screen is not two thirds empty. */}
      <div className="coach-two">
      <div className="panel coach-intake">
        <span className="microcap">What are you avoiding?</span>
        <AutoTextarea
          className="textinput" minRows={3} style={{ width: '100%', marginTop: 'var(--s2)' }}
          value={thing} onChange={(e) => setThing(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && thing.trim()) void analyze(thing) }}
          placeholder="Say it plainly. e.g. Call VZP to confirm the payment plan, or Reply to the tax office letter"
          aria-label="What you are avoiding"
        />
        <div className="coach-intake-row">
          <button className="btn btn-primary" disabled={!thing.trim()} onClick={() => void analyze(thing)}>Face it</button>
          <span className="assist-note">Coach looks at it factually and hands you an easy first step. You do not fill in the analysis, it does.</span>
        </div>

      </div>

      <div className="coach-side">
        {/* Naming the thing is the step an avoider cannot do cold, so the page
            offers the usual suspects and your own oldest tasks to point at. */}
        <div className="coach-starters">
          <span className="microcap">Or start from one of these</span>
          <div className="coach-starter-row">
            {oldest.map((t) => (
              <button key={t.id} className="coach-starter is-yours" onClick={() => { setThing(t.title); void analyze(t.title) }}>
                {t.title}
                <span className="cs-age">{(t.carried ?? 0) > 0 ? `came back ${t.carried}x` : t.createdAt ? `since ${fmtWhen(t.createdAt)}` : 'on your list'}</span>
              </button>
            ))}
            {COACH_SCENARIOS.slice(0, oldest.length === 0 ? 5 : 0).map((s) => (
              <button key={s.id} className="coach-starter" onClick={() => { setThing(s.title); void analyze(s.title) }}>
                {s.title}
                <span className="cs-age">{s.tag}</span>
              </button>
            ))}
          </div>
        </div>

      {open.length > 0 && (
        <>
          <SecHead label="Open loops" />
          <div className="coach-loops">
            {open.map((s) => (
              <div className="panel coach-loop" key={s.id}>
                <div className="coach-loop-head">
                  <span className="grow">{s.title}</span>
                  <span className="mono meta">{fmtWhen(s.when)}</span>
                </div>
                <div className="coach-loop-step">First step: {s.firstStep}</div>
                {s.didIt === false && s.reflection && (
                  <div className="coach-loop-blocked">In the way: {s.reflection}</div>
                )}
                {reflectId === s.id ? (
                  <ReflectForm
                    onCancel={() => setReflectId(null)}
                    onSubmit={(didIt, felt, text) => { reflectCoachSession(s.id, didIt, felt, text); setReflectId(null) }}
                  />
                ) : (
                  <div className="coach-loop-actions">
                    <button className="btn btn-primary" onClick={() => setReflectId(s.id)}>Check in</button>
                    <button className="btn btn-ghost" onClick={() => deleteCoachSession(s.id)}>Drop</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {closed.length > 0 && (
        <>
          <SecHead label="What you faced" />
          <div className="coach-history">
            {closed.map((s) => (
              <div className="coach-closed" key={s.id}>
                {s.felt && <span className={`coach-felt-tag felt-${s.felt}`}>{FELT_TAG[s.felt]}</span>}
                {!s.didIt && <span className="coach-felt-tag felt-open">not done</span>}
                <span className="grow">
                  <strong>{s.title}</strong>
                  {s.reflection && <span className="coach-closed-note">{s.reflection}</span>}
                </span>
                <button className="assist-goto" onClick={() => deleteCoachSession(s.id)} aria-label="Remove">remove</button>
              </div>
            ))}
          </div>
        </>
      )}
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
          <span className="name">Groq, for breaking tasks down</span>
          <span className="detail" style={{ display: 'block' }}>
            {live ? 'Connected. Break it down reads the actual task.' : 'Not set. Break it down falls back to a pattern library.'}
          </span>
        </span>
        <a className="btn btn-quiet" href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Get a free key ↗</a>
      </div>
      <div className="formrow" style={{ marginTop: 'var(--s2)', marginBottom: 0 }}>
        <input
          className="textinput grow" type="password" placeholder="gsk_..." value={key}
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
                <span className="detail" style={{ display: 'block' }}>{s.detail}</span>
              </span>
              {s.status === 'manual' ? (
                <span className="src-tag">manual</span>
              ) : (
                <button
                  className="toggle"
                  role="switch"
                  aria-checked={s.status === 'connected'}
                  aria-label={`${s.name} ${s.status === 'connected' ? 'connected' : 'off'}`}
                  onClick={() => toggleSource(s.id)}
                >
                  <i />
                </button>
              )}
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
