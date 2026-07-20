import { useEffect, useState } from 'react'
import { COACH_SCENARIOS, MOCK_CLAUDE, MOCK_MONEY, MOCK_STATS } from './mock'
import { Band } from './pages1'
import { useStore } from './store'
import { Spark, SparkBox } from './widgets'
import type { CoachScenario, SocialEntry } from './types'

/* ---------------- MONEY ---------------- */

export function MoneyPage() {
  const { space, setSpace: setSpage, tasks, addTask } = useStore()
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
  return (
    <div className="page">
      <Band
        title="Money"
        sub="pay cycle and obligations"
        metrics={[
          { v: f.safeToSpend, k: 'safe to spend', tone: 'pos' as const },
          { v: f.totalRemaining, k: 'total debt remaining', tone: 'urgent' as const },
          { v: `${f.obligations.filter((o) => o.state === 'agreed').length}/${f.obligations.length}`, k: 'plans agreed' },
        ]}
      />
      <div className="grid-3">
        <div className="panel">
          <span className="microcap">Pay cycle</span>
          <div className="kpi val-pos">{f.safeToSpend}</div>
          <div className="kpi-sub">safe to spend {f.safeUntil}</div>
          <div className="kpi-sub">{f.safeMath}</div>
          <div className="bar" style={{ marginTop: 12 }}>
            <i style={{ width: `${f.spentPct}%` }} />
          </div>
          <div className="kpi-sub">{f.spentPct}% of the cycle budget spent. {f.budgetLine}.</div>
        </div>
        <div className="panel">
          <span className="microcap">Obligations</span>
          {f.obligations.map((o) => (
            <div className="oblig" key={o.id}>
              <div className="oblig-line">
                <span className="name">{o.name}</span>
                <span className="monthly">{o.monthly}</span>
                <span className={`state-tag ${o.state === 'action needed' ? 'action' : o.state}`}>{o.state}</span>
              </div>
              <div className="bar debt"><i style={{ width: `${o.progressPct}%` }} /></div>
              <div className="next">{o.remaining} · {o.next}</div>
            </div>
          ))}
        </div>
        <div className="panel">
          <span className="microcap">Next payments</span>
          <div className="rowlist">
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
      </div>
    </div>
  )
}

/* ---------------- REVIEW (weekly reset) ---------------- */

export function ReviewPage() {
  const { tasks, space, savedMin, accuracyPct, habits, social, setSocial, finishReview, review } = useStore()
  const [step, setStep] = useState(0)
  const doneTasks = tasks.filter((t) => t.done && t.space === space)
  const [wins, setWins] = useState<string[]>(['', '', ''])
  const [socialDraft, setSocialDraft] = useState<SocialEntry[]>(social)
  const [outcomes, setOutcomes] = useState<string[]>(['', '', ''])
  const todayKey = new Date().toISOString().slice(0, 10)
  const doneToday = review.lastDoneDate === todayKey

  const habitsKept = habits.filter((h) => !h.paused).reduce((a, h) => a + h.days.filter(Boolean).length, 0)

  const STEPS = ['Wins', 'Numbers', 'Audience', 'Next week']

  if (doneToday && step === 0) {
    return (
      <div className="page narrow">
        <Band title="Weekly review" sub="Sunday ritual, about 15 minutes" />
        <div className="panel">
          <span className="done-mark">Done for this week.</span>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', marginTop: 8 }}>
            Your outcomes for next week are in the backlog. See you next Sunday.
          </p>
          {review.outcomes.filter(Boolean).map((o, i) => (
            <div className="rowitem" key={i}><span className="mono meta">{i + 1}</span><span className="grow">{o}</span></div>
          ))}
          <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => setStep(1)}>Run it again anyway</button>
        </div>
      </div>
    )
  }

  const idx = doneToday ? step - 1 : step

  return (
    <div className="page narrow">
      <Band title="Weekly review" sub="Sunday ritual, about 15 minutes" />
      <div className="panel" style={{ maxWidth: 1100, marginInline: "auto" }}>
        <div className="coach-progress" aria-hidden="true">
          {STEPS.map((_, k) => <i key={k} className={k <= idx ? 'on' : ''} />)}
        </div>
        <span className="microcap coach-step-label">Step {idx + 1} of {STEPS.length} · {STEPS[idx]}</span>

        {idx === 0 && (
          <div>
            <h3 className="coach-q">What actually went well?</h3>
            {doneTasks.length > 0 && (
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginBottom: 8 }}>
                Finished this week: {doneTasks.map((t) => t.title).slice(0, 3).join(' · ')}
              </p>
            )}
            {wins.map((w, i) => (
              <input
                key={i}
                className="textinput"
                style={{ marginBottom: 8, width: '100%' }}
                placeholder={`Win ${i + 1}`}
                value={w}
                onChange={(e) => setWins((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                aria-label={`Win ${i + 1}`}
              />
            ))}
          </div>
        )}

        {idx === 1 && (
          <div>
            <h3 className="coach-q">The numbers, no commentary</h3>
            <div className="rowlist">
              <div className="rowitem"><span className="grow">Time saved vs your estimates</span><span className="mono" style={{ fontWeight: 600 }}>{Math.floor(savedMin / 60)}h {savedMin % 60}m</span></div>
              <div className="rowitem"><span className="grow">Estimate accuracy</span><span className="mono" style={{ fontWeight: 600 }}>{accuracyPct}%</span></div>
              <div className="rowitem"><span className="grow">Habit checkoffs</span><span className="mono" style={{ fontWeight: 600 }}>{habitsKept}</span></div>
            </div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginTop: 12 }}>
              Every one of these traces to something you logged. Nothing is projected.
            </p>
          </div>
        )}

        {idx === 2 && (
          <div>
            <h3 className="coach-q">Audience numbers, 60 seconds</h3>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginBottom: 12 }}>
              From each platform’s own analytics screen. This is the manual entry that keeps the Audience widget honest.
            </p>
            {socialDraft.map((s, i) => (
              <div className="formrow" key={s.platform}>
                <span style={{ minWidth: 90, fontSize: 'var(--text-sm)', fontWeight: 600, alignSelf: 'center' }}>{s.platform}</span>
                <input
                  className="numinput"
                  type="number"
                  value={s.followers}
                  onChange={(e) => setSocialDraft((prev) => prev.map((x, j) => (j === i ? { ...x, change: Number(e.target.value) - x.followers + x.change, followers: Number(e.target.value) } : x)))}
                  aria-label={`${s.platform} followers`}
                />
                <input
                  className="textinput"
                  style={{ maxWidth: 200 }}
                  value={s.lastPost}
                  onChange={(e) => setSocialDraft((prev) => prev.map((x, j) => (j === i ? { ...x, lastPost: e.target.value } : x)))}
                  aria-label={`${s.platform} last post`}
                />
              </div>
            ))}
          </div>
        )}

        {idx === 3 && (
          <div>
            <h3 className="coach-q">Three outcomes for next week</h3>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginBottom: 8 }}>
              Outcomes, not activities. They land in the backlog and Monday’s plan pulls from there.
            </p>
            {outcomes.map((o, i) => (
              <input
                key={i}
                className="textinput"
                style={{ marginBottom: 8, width: '100%' }}
                placeholder={`Outcome ${i + 1}`}
                value={o}
                onChange={(e) => setOutcomes((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                aria-label={`Outcome ${i + 1}`}
              />
            ))}
          </div>
        )}

        <div className="coach-nav">
          {idx > 0 && <button className="btn btn-quiet" onClick={() => setStep(step - 1)}>Back</button>}
          {idx < 3 && <button className="btn btn-primary" onClick={() => setStep(step + 1)}>Next</button>}
          {idx === 3 && (
            <button
              className="btn btn-primary"
              onClick={() => { setSocial(socialDraft); finishReview(wins.filter(Boolean), outcomes.filter(Boolean)); setStep(0) }}
            >
              Close the week
            </button>
          )}
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
      <div className="page narrow">
        <Band title="Coach" sub="for the things you keep putting off" />
        {finished && (
          <div className="allclear" style={{ borderColor: 'var(--progress)' }}>
            <span className="dot" aria-hidden="true" />
            Saved as a task: {finished}. It is on your list now.
            <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setPage('tasks')}>Open tasks</button>
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
    <div className="page narrow">
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

/* ---------------- STATS ---------------- */

export function StatsPage() {
  const { ledger, savedMin, accuracyPct } = useStore()
  const s = MOCK_STATS
  return (
    <div className="page">
      <Band
        title="Stats"
        sub="everything traces to a log entry"
        metrics={[
          { v: `${Math.floor(savedMin / 60)}h ${savedMin % 60}m`, k: 'under estimate, net', tone: 'pos' as const },
          { v: `${accuracyPct}%`, k: 'estimate accuracy' },
        ]}
      />
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
