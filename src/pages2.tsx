import { useEffect, useState } from 'react'
import { COACH_SCENARIOS, MOCK_CLAUDE, MOCK_MONEY, MOCK_STATS } from './mock'
import { Band } from './pages1'
import { useStore } from './store'
import { Spark, SparkBox } from './widgets'
import { fmtDuration, taskMinutes } from './util'
import { analyzeAvoidance } from './coach'
import type { CoachFacts, CoachSession, TaskCategory } from './types'

/* ---------------- MONEY ---------------- */

export function MoneyPage() {
  const { space, setSpace: setSpage, tasks, addTask, goals } = useStore()
  const f = MOCK_MONEY
  if (space !== 'personal') {
    return (
      <div className="page">
        <Band title="Money" sub="personal space only" />
        <div className="panel">
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)' }}>
            Money lives in the Personal space.
          </p>
          <button className="btn btn-quiet" style={{ marginTop: 12 }} onClick={() => setSpage('personal')}>
            Switch to Personal
          </button>
        </div>
      </div>
    )
  }
  const moneyGoals = goals.filter((g) => g.space === 'personal' && g.category === 'money')
  return (
    <div className="page">
      <Band
        title="Money"
        sub="where the debt is going"
      />
      <div className="grid-3">
        {/* Debt payoff */}
        <div className="panel">
          <span className="microcap">Debt payoff</span>
          <div className="kpi">{f.debt.remaining}<span className="unit">left</span></div>
          <div className="bar debt" style={{ marginTop: 12 }}><i style={{ width: `${f.debt.pct}%` }} /></div>
          <div className="kpi-sub"><span className="val-pos">{f.debt.paid} paid</span> of {f.debt.original} · {f.debt.pct}% cleared</div>
          <div className="rowlist" style={{ marginTop: 10 }}>
            {f.obligations.map((o) => (
              <div className="rowitem" key={o.id} style={{ minHeight: 34 }}>
                <span className="grow" style={{ color: 'var(--muted)' }}>{o.name}</span>
                <span className="mono meta">{o.monthly}</span>
                <span className={`state-tag ${o.state === 'action needed' ? 'action' : o.state}`}>{o.state}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Monthly payments */}
        <div className="panel">
          <span className="microcap">Monthly payments</span>
          <div className="kpi">{f.debt.monthly}<span className="unit">/ month</span></div>
          <div className="kpi-sub">across your payment plans</div>
          <div className="rowlist" style={{ marginTop: 12 }}>
            {f.schedule.map((sch) => {
              const taskTitle = `Send: ${sch.name.split(',')[0]} (${sch.amount})`
              const queued = tasks.find((t) => t.title === taskTitle)
              const urgent = sch.state === 'action needed' || sch.state === 'not sent'
              return (
                <div className="rowitem wrap-row" key={sch.date + sch.name}>
                  <span className="mono meta" style={{ minWidth: '9ch' }}>{sch.date}</span>
                  <span className="grow">{sch.name}</span>
                  <span className="mono" style={{ fontWeight: 600 }}>{sch.amount}</span>
                  <span className={`state-tag ${urgent ? 'action' : sch.state === 'pending' ? 'pending' : sch.state === 'scheduled' ? 'scheduled' : 'waiting'}`}>{sch.state}</span>
                  {urgent && (
                    queued ? (
                      <span className="microcap" style={{ color: 'var(--progress)' }}>{queued.done ? 'done' : 'on today'}</span>
                    ) : (
                      <button className="btn btn-ghost" style={{ minHeight: 30, fontSize: 'var(--text-xs)' }}
                        onClick={() => addTask({ title: taskTitle, source: 'mc', estimateMin: 5, space: 'personal', list: 'today', category: 'admin' })}>
                        Add to today
                      </button>
                    )
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Monthly savings over time */}
        <div className="panel">
          <span className="microcap">Monthly savings</span>
          <div className="kpi val-pos">{f.savings.thisMonth}</div>
          <div className="kpi-sub">set aside this month, {f.savings.note}</div>
          <div style={{ marginTop: 12 }}>
            <Spark data={f.savings.months} width={260} height={54} />
            <div className="savings-months">
              {f.savings.monthLabels.map((m) => <span key={m}>{m}</span>)}
            </div>
          </div>
          <div className="kpi-sub" style={{ marginTop: 10 }}><span className="val-pos">{f.savings.total}</span> saved so far</div>
        </div>
      </div>

      {/* Money goals + Compass */}
      <div className="panel" style={{ marginTop: 'var(--s5)' }}>
        <div className="col-head">
          <span className="microcap">Money goals</span>
          <a className="cal-link" style={{ marginLeft: 'auto' }} href="https://compass-money.netlify.app" target="_blank" rel="noreferrer">Open Compass ↗</a>
        </div>
        <div className="grid-3" style={{ marginTop: 'var(--s3)' }}>
          {moneyGoals.map((g) => {
            const pct = Math.min(100, Math.round((g.current / g.target) * 100))
            return (
              <div className="goal-card" key={g.id}>
                <div className="goal-line"><span className="grow">{g.name}</span></div>
                <div className="bar prog"><i style={{ width: `${pct}%` }} /></div>
                <div className="kpi-sub">{g.current.toLocaleString('en')} of {g.target.toLocaleString('en')} {g.unit}</div>
              </div>
            )
          })}
          {moneyGoals.length === 0 && <p className="bucket-empty">No money goals yet. Add them on the Goals page.</p>}
        </div>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--faint)', marginTop: 'var(--s4)' }}>
          Figures are demo placeholders. The real app reads your Compass ledger server-side; nothing financial ships in this public bundle.
        </p>
      </div>
    </div>
  )
}

/* ---------------- REVIEW (weekly reset + stats, merged) ---------------- */

function SecHead({ label, note }: { label: string; note?: string }) {
  return (
    <div className="review-sec">
      <span className="microcap">{label}</span>
      {note && <span className="review-sec-note">{note}</span>}
    </div>
  )
}

export function ReviewPage() {
  const { tasks, space, savedMin, accuracyPct, habits, goals, finishReview, review, ledger } = useStore()
  const [wins, setWins] = useState<string[]>(['', '', ''])
  const [changed, setChanged] = useState('')
  const [outcomes, setOutcomes] = useState<string[]>(['', '', ''])
  const todayKey = new Date().toISOString().slice(0, 10)
  const doneToday = review.lastDoneDate === todayKey
  const s = MOCK_STATS

  const doneTasks = tasks.filter((t) => t.done && t.space === space)
  const doneMin = doneTasks.reduce((a, t) => a + taskMinutes(t), 0)
  const activeHabits = habits.filter((h) => !h.paused)
  const habitsKept = activeHabits.reduce((a, h) => a + h.days.filter(Boolean).length, 0)
  const spaceGoals = goals.filter((g) => g.space === space)
  const goalsOnTrack = spaceGoals.filter((g) => g.current / g.target >= 0.5).length

  const setW = (i: number, v: string) => setWins((p) => p.map((x, j) => (j === i ? v : x)))
  const setO = (i: number, v: string) => setOutcomes((p) => p.map((x, j) => (j === i ? v : x)))

  return (
    <div className="page">
      <Band
        title="Weekly review"
        sub="the week in numbers, then a quick checkup"
        metrics={[
          { v: `${Math.floor(savedMin / 60)}h ${savedMin % 60}m`, k: 'time saved', tone: 'pos' as const },
          { v: `${accuracyPct}%`, k: 'estimate accuracy' },
        ]}
      />
      {doneToday && (
        <div className="allclear" style={{ borderColor: 'var(--progress)' }}>
          <span className="dot" aria-hidden="true" />
          Closed for this week. Your outcomes are in the backlog. The numbers below keep updating live.
        </div>
      )}

      <SecHead label="This week" note="live, straight off what you logged" />
      <div className="grid-4">
        <div className="panel">
          <span className="microcap">Tasks done</span>
          <div className="kpi">{doneTasks.length}</div>
          <div className="kpi-sub">{fmtDuration(doneMin)} of work · {accuracyPct}% within estimate</div>
        </div>
        <div className="panel">
          <span className="microcap">Habits kept</span>
          <div className="kpi val-pos">{habitsKept}</div>
          <div className="kpi-sub">checkoffs across {activeHabits.length} habits</div>
          <div className="rowlist" style={{ marginTop: 8 }}>
            {activeHabits.map((h) => (
              <div className="rowitem" key={h.id} style={{ minHeight: 30 }}>
                <span className="grow">{h.name}</span>
                <span className="mono meta">{h.days.filter(Boolean).length}/7</span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <span className="microcap">Goals on track</span>
          <div className="kpi">{goalsOnTrack}<span className="unit">of {spaceGoals.length}</span></div>
          <div className="rowlist" style={{ marginTop: 8 }}>
            {spaceGoals.slice(0, 5).map((g) => {
              const pct = Math.min(100, Math.round((g.current / g.target) * 100))
              return (
                <div className="rowitem" key={g.id} style={{ minHeight: 30 }}>
                  <span className="grow">{g.name}</span>
                  <span className={`drift ${pct < 50 ? 'off' : 'ok'}`}>{pct}%</span>
                </div>
              )
            })}
          </div>
        </div>
        <div className="panel">
          <span className="microcap">Time saved</span>
          <div className={`kpi ${savedMin >= 0 ? 'val-pos' : 'val-urgent'}`}>{Math.floor(savedMin / 60)}h {savedMin % 60}m</div>
          <div className="kpi-sub">vs your own estimates · {accuracyPct}% accuracy. Everything here traces to something you logged.</div>
        </div>
      </div>

      <SecHead label="Trends & calibration" note="six weeks back, this week live" />
      <div className="grid-3">
        <div className="panel">
          <span className="microcap">Time saved, six weeks</span>
          <SparkBox data={[...s.weeklySavedMin, savedMin]} unit="m" caption="minutes per week saved vs your estimates, this week live" />
          <span className="microcap" style={{ marginTop: 24, display: 'block' }}>Accuracy trend</span>
          <SparkBox data={[...s.weeklyAccuracy, accuracyPct]} unit="%" caption="share of tasks finished within a quarter of the estimate" />
        </div>
        <div className="panel">
          <span className="microcap">Your calibration factors</span>
          <table className="caltable">
            <tbody>
              {s.calibration.map((c) => (
                <tr key={c.category}>
                  <td style={{ fontWeight: 600 }}>{c.label}</td>
                  <td className="f">x{c.factor.toFixed(1)}</td>
                  <td className="n">{c.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <span className="microcap">Claude usage</span>
          <div className="kpi">{MOCK_CLAUDE.sessionsToday}<span className="unit">sessions today</span></div>
          <div style={{ marginTop: 12 }}>
            <SparkBox data={MOCK_CLAUDE.tokensWeek} unit="k" caption={`tokens per day, ${MOCK_CLAUDE.note}`} />
          </div>
        </div>
        <div className="panel panel-wide">
          <span className="microcap">The ledger, estimate vs actual</span>
          <div className="ledger-list">
            {ledger.map((e) => {
              const d = e.estimateMin - e.actualMin
              return (
                <div className="ledger-row" key={e.id}>
                  <span className="mono" style={{ color: 'var(--faint)', fontSize: 'var(--text-xs)', minWidth: '3ch' }}>{e.when}</span>
                  <span className="ledger-title">{e.title}</span>
                  <span className="src-tag">{e.category}</span>
                  <span className="mono" style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>~{e.estimateMin}m → {e.actualMin}m</span>
                  <span className={`delta ${d >= 0 ? 'saved' : 'over'}`}>{d >= 0 ? `+${d}m` : `${d}m`}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <SecHead label="Checkup" note="two minutes, honest" />
      <div className="panel checkup-panel">
        <span className="microcap">Manual checkup</span>
        <div className="checkup-cols">
          <div className="checkup-col">
            <h4 className="checkup-q">What actually went well?</h4>
            {wins.map((w, i) => (
              <input key={i} className="textinput" style={{ marginBottom: 8, width: '100%' }} placeholder={`Win ${i + 1}`} value={w} onChange={(e) => setW(i, e.target.value)} aria-label={`Win ${i + 1}`} />
            ))}
            <h4 className="checkup-q">What drifted, and one change for next week?</h4>
            <input className="textinput" style={{ width: '100%' }} placeholder="One honest note" value={changed} onChange={(e) => setChanged(e.target.value)} aria-label="What to change" />
          </div>
          <div className="checkup-col">
            <h4 className="checkup-q">Three outcomes for next week</h4>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginBottom: 8 }}>Results you can check off. They land in the backlog and Monday’s plan pulls from there.</p>
            {outcomes.map((o, i) => (
              <input key={i} className="textinput" style={{ marginBottom: 8, width: '100%' }} placeholder={`Outcome ${i + 1}`} value={o} onChange={(e) => setO(i, e.target.value)} aria-label={`Outcome ${i + 1}`} />
            ))}
            <div className="coach-nav">
              <button className="btn btn-primary" onClick={() => { finishReview([...wins, changed].filter(Boolean), outcomes.filter(Boolean)); setWins(['', '', '']); setChanged(''); setOutcomes(['', '', '']) }}>
                {doneToday ? 'Update the week' : 'Close the week'}
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
      <span className="coach-field-q">How did it actually feel?</span>
      <div className="coach-choice wrap">
        {FELT_OPTS.map((o) => (
          <button key={o.key} className={felt === o.key ? 'on' : ''} onClick={() => setFelt(o.key)}>{o.label}</button>
        ))}
      </div>
      <textarea className="textinput" rows={2} style={{ width: '100%', marginTop: 'var(--s2)' }} placeholder="What did it feel like? One honest line." value={text} onChange={(e) => setText(e.target.value)} aria-label="How it felt" />
      <div className="coach-nav">
        <button className="btn btn-quiet" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onSubmit(didIt, felt, text.trim())}>Close the loop</button>
      </div>
    </div>
  )
}

export function CoachPage() {
  const { space, setPage, coachOpen, setCoachOpen, coachSessions, startCoachSession, reflectCoachSession, deleteCoachSession } = useStore()
  const [stage, setStage] = useState<CoachStage>('home')
  const [thing, setThing] = useState('')
  const [title, setTitle] = useState('')
  const [facts, setFacts] = useState<CoachFacts>(EMPTY_FACTS)
  const [firstStep, setFirstStep] = useState('')
  const [meta, setMeta] = useState<{ firstStepMin: number; category: TaskCategory }>({ firstStepMin: 5, category: 'admin' })
  const [reflectId, setReflectId] = useState<string | null>(null)

  const analyze = (input: string) => {
    const a = analyzeAvoidance(input)
    setTitle(input.trim())
    setFacts({ avoiding: a.avoiding, steps: a.steps, cost: a.cost })
    setFirstStep(a.firstStep)
    setMeta({ firstStepMin: a.firstStepMin, category: a.category })
    setStage('review')
  }

  // Today's avoided-admin alerts deep-link here; seed the analyzer from the alert.
  useEffect(() => {
    if (!coachOpen) return
    const s = COACH_SCENARIOS.find((x) => x.id === coachOpen)
    if (s) { setThing(s.title); analyze(s.title) }
    setCoachOpen(null)
  }, [coachOpen])

  const reset = () => { setStage('home'); setThing(''); setTitle(''); setFacts(EMPTY_FACTS); setFirstStep('') }
  const setFact = (k: keyof CoachFacts, v: string) => setFacts((f) => ({ ...f, [k]: v }))
  const save = () => {
    startCoachSession({ title: title.trim() || thing.trim(), facts, firstStep: firstStep.trim(), firstStepMin: meta.firstStepMin, category: meta.category })
    setStage('saved')
  }

  const open = coachSessions.filter((s) => s.status === 'open')
  const closed = coachSessions.filter((s) => s.status === 'closed')
  const easedCount = closed.filter((s) => s.felt === 'easier').length

  /* ---- review the breakdown Coach drafted, then commit ---- */
  if (stage === 'review') {
    return (
      <div className="page">
        <Band title={title || 'Coach'} sub="what it actually is" />
        <div className="panel coach-facts">
          <div className="coach-drafted">
            <span className="microcap">Coach broke this down</span>
            <span className="assist-note">Drafted from what you wrote. Fix anything that is off, then send the first step to Today.</span>
          </div>
          <div className="coach-field">
            <span className="coach-field-q">What you are avoiding</span>
            <textarea className="textinput coach-ta" rows={3} value={facts.avoiding} onChange={(e) => setFact('avoiding', e.target.value)} aria-label="What you are avoiding" />
          </div>
          <div className="coach-field">
            <span className="coach-field-q">The steps it takes</span>
            <textarea className="textinput coach-ta" rows={4} value={facts.steps} onChange={(e) => setFact('steps', e.target.value)} aria-label="The steps" />
          </div>
          <div className="coach-field">
            <span className="coach-field-q">If you keep putting it off</span>
            <textarea className="textinput coach-ta" rows={3} value={facts.cost} onChange={(e) => setFact('cost', e.target.value)} aria-label="The cost" />
          </div>
          <div className="coach-field coach-firststep">
            <span className="coach-field-q">Your easy first step</span>
            <span className="coach-field-hint">Not the whole thing. The smallest move that gets you in.</span>
            <input className="textinput" style={{ width: '100%' }} value={firstStep} onChange={(e) => setFirstStep(e.target.value)} aria-label="First step" />
          </div>
          <div className="coach-field-inline">
            <span>Give it</span>
            <input className="textinput" type="number" min={1} max={120} style={{ width: 72 }} value={meta.firstStepMin} onChange={(e) => setMeta((m) => ({ ...m, firstStepMin: Math.max(1, Number(e.target.value) || 1) }))} aria-label="Minutes" />
            <span>min ·</span>
            <select className="textinput" value={meta.category} onChange={(e) => setMeta((m) => ({ ...m, category: e.target.value as TaskCategory }))} aria-label="Category">
              <option value="call">call</option><option value="admin">admin</option><option value="deep">deep</option><option value="quick">quick</option>
            </select>
          </div>
          <div className="coach-nav">
            <button className="btn btn-quiet" onClick={reset}>Back</button>
            <button className="btn btn-primary" disabled={!firstStep.trim()} onClick={save}>Put first step on Today</button>
          </div>
        </div>
      </div>
    )
  }

  if (stage === 'saved') {
    return (
      <div className="page">
        <Band title={title || 'Coach'} sub="on your list" />
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
      <Band title="Coach" sub="for the thing you keep circling" />

      <div className="panel coach-intake">
        <span className="microcap">What are you avoiding?</span>
        <textarea
          className="textinput" rows={3} style={{ width: '100%', marginTop: 'var(--s2)' }}
          value={thing} onChange={(e) => setThing(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && thing.trim()) analyze(thing) }}
          placeholder="Say it plainly. e.g. Call VZP to confirm the payment plan, or Reply to the tax office letter"
          aria-label="What you are avoiding"
        />
        <div className="coach-intake-row">
          <button className="btn btn-primary" disabled={!thing.trim()} onClick={() => analyze(thing)}>Face it</button>
          <span className="assist-note">Coach looks at it factually and hands you an easy first step. You do not fill in the analysis, it does.</span>
        </div>
      </div>

      {open.length > 0 && (
        <>
          <SecHead label="Open loops" note="you started these, close them when they are done" />
          <div className="coach-loops">
            {open.map((s) => (
              <div className="panel coach-loop" key={s.id}>
                <div className="coach-loop-head">
                  <span className="grow">{s.title}</span>
                  <span className="mono meta">{s.when}</span>
                </div>
                <div className="coach-loop-step">First step: {s.firstStep}</div>
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
          <SecHead label="What you faced" note={easedCount ? `${easedCount} of ${closed.length} felt easier than you feared` : undefined} />
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

      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginTop: 'var(--s5)', maxWidth: '72ch' }}>
        Demo: Coach drafts the breakdown here in your browser. The real build sends what you wrote to a model that reads the actual thing, and remembers your pattern so the fifth avoided call is easier than the first.
      </p>
    </div>
  )
}

/* ---------------- SETTINGS ---------------- */

export function SettingsPage() {
  const { sources, toggleSource, resetDemo } = useStore()
  return (
    <div className="page">
      <Band title="Settings" sub="connections and controls" />
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
          <span className="microcap">Demo</span>
          <div className="source-row">
            <span className="info"><span className="name">Reset the demo</span><span className="detail" style={{ display: 'block' }}>Clears local changes, restores the sample data</span></span>
            <button className="btn btn-danger" style={{ border: '1px solid var(--alert)' }} onClick={resetDemo}>Reset</button>
          </div>
          <span className="microcap" style={{ marginTop: 24, display: 'block' }}>About this build</span>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)' }}>
            V1 demo. Every page and flow works, and every change persists in this browser.
            Not here yet: real accounts, real sync, the live AI. That is the Phase 1 backend, already specced.
          </p>
        </div>
      </div>
    </div>
  )
}
