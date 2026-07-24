import { useEffect, useState } from 'react'
import { COACH_SCENARIOS, MOCK_CLAUDE, MOCK_MONEY, MOCK_STATS } from './mock'
import { Band } from './pages1'
import { useStore } from './store'
import { Spark, SparkBox } from './widgets'
import { fmtDuration, taskMinutes } from './util'
import type { CoachScenario } from './types'

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
        metrics={[
          { v: f.debt.remaining, k: 'debt remaining', tone: 'urgent' as const },
          { v: f.debt.paid, k: 'paid off', tone: 'pos' as const },
          { v: `${f.debt.monthly}/mo`, k: 'across plans' },
        ]}
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
      <div className="panel" style={{ maxWidth: 820 }}>
        <span className="microcap">Manual checkup</span>
        <h4 className="checkup-q">What actually went well?</h4>
        {wins.map((w, i) => (
          <input key={i} className="textinput" style={{ marginBottom: 8, width: '100%' }} placeholder={`Win ${i + 1}`} value={w} onChange={(e) => setW(i, e.target.value)} aria-label={`Win ${i + 1}`} />
        ))}
        <h4 className="checkup-q">What drifted, and one change for next week?</h4>
        <input className="textinput" style={{ width: '100%' }} placeholder="One honest note" value={changed} onChange={(e) => setChanged(e.target.value)} aria-label="What to change" />
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
  )
}

/* ---------------- COACH ---------------- */

export function CoachPage() {
  const { addTask, space, setPage, coachOpen, setCoachOpen } = useStore()
  const [scenario, setScenario] = useState<CoachScenario | null>(null)
  const [i, setI] = useState(0)
  const [finished, setFinished] = useState<string | null>(null)

  useEffect(() => {
    if (!coachOpen) return
    const hit = COACH_SCENARIOS.find((x) => x.id === coachOpen)
    if (hit) { setScenario(hit); setI(0) }
    setCoachOpen(null)
  }, [coachOpen])

  if (!scenario) {
    return (
      <div className="page">
        <Band title="Coach" sub="for the things you keep putting off" />
        {finished && (
          <div className="allclear" style={{ borderColor: 'var(--progress)' }}>
            <span className="dot" aria-hidden="true" />
            Saved as a task: {finished}. It is on your list now.
            <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setPage('plan')}>Open plan</button>
          </div>
        )}
        <div className="scenario-grid">
          {COACH_SCENARIOS.map((s) => (
            <button key={s.id} className="scenario" onClick={() => { setScenario(s); setI(0) }}>
              <span className="microcap">{s.tag}</span>
              <span className="t">{s.title}</span>
              <span className="desc">{s.blurb}</span>
              <span className="mono foot-line">~10 min · ends as a scheduled task</span>
            </button>
          ))}
        </div>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginTop: 20, maxWidth: '72ch' }}>
          Demo: {COACH_SCENARIOS.length} canned scenarios. In the real app you describe your own situation and the model plays the counterpart in rehearsal, without ever inventing institutional facts.
        </p>
      </div>
    )
  }

  const step = scenario.steps[i]
  const last = i === scenario.steps.length - 1

  return (
    <div className="page">
      <Band title={scenario.title} sub={scenario.tag} />
      <div className="panel" style={{ maxWidth: 1100, marginInline: "auto" }}>
        <div className="coach-progress" aria-hidden="true">
          {scenario.steps.map((_, k) => <i key={k} className={k <= i ? 'on' : ''} />)}
        </div>
        <span className="microcap coach-step-label">Step {i + 1} of {scenario.steps.length} · {step.label}</span>
        <h3 className="coach-q">{step.question}</h3>
        {step.body && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', marginBottom: 12 }}>{step.body}</p>}
        {step.scripts?.map((s, k) => (
          <div className="script-line" key={k}>
            <span className="say">{s.say}</span>
            {s.text}
          </div>
        ))}
        <div className="coach-nav">
          <button className="btn btn-ghost" onClick={() => setScenario(null)}>All scenarios</button>
          {i > 0 && <button className="btn btn-quiet" onClick={() => setI(i - 1)}>Back</button>}
          {!last && <button className="btn btn-primary" onClick={() => setI(i + 1)}>Next</button>}
          {last && (
            <button
              className="btn btn-primary"
              onClick={() => {
                addTask({ title: scenario.resultTask.title, source: 'mc', estimateMin: scenario.resultTask.estimateMin, space, list: 'today', category: scenario.resultTask.category })
                setFinished(scenario.resultTask.title)
                setScenario(null)
              }}
            >
              Save the task
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------------- SETTINGS ---------------- */

export function SettingsPage() {
  const { sources, toggleSource, theme, toggleTheme, resetDemo } = useStore()
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
          <span className="microcap">Appearance</span>
          <div className="source-row">
            <span className="info"><span className="name">Theme</span><span className="detail" style={{ display: 'block' }}>Follows your system until you flip it</span></span>
            <button className="btn btn-quiet" onClick={toggleTheme}>{theme === 'dark' ? 'Switch to light' : 'Switch to dark'}</button>
          </div>
          <span className="microcap" style={{ marginTop: 24, display: 'block' }}>Demo</span>
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
