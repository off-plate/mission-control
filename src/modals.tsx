import { useEffect, useRef, useState, type ReactNode } from 'react'
import { COACH_DEMO, WIDGET_DEFS, fakeDecompose, type DecomposedStep } from './mock'
import { useStore } from './store'
import type { WidgetType } from './types'

function Sheet({ title, onClose, children, note }: {
  title: string
  onClose: () => void
  children: ReactNode
  note?: string
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="sheet-body">{children}</div>
        {note && <div className="demo-note">{note}</div>}
      </div>
    </div>
  )
}

/* ---------------- decompose ---------------- */

export function DecomposeSheet({ onClose }: { onClose: () => void }) {
  const { addTasks, space } = useStore()
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [steps, setSteps] = useState<DecomposedStep[] | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const run = () => {
    if (!goal.trim() || busy) return
    setBusy(true)
    setSteps(null)
    window.setTimeout(() => {
      setSteps(fakeDecompose(goal))
      setBusy(false)
    }, 850)
  }

  const total = steps?.reduce((a, s) => a + s.estimateMin, 0) ?? 0
  const calibrated = Math.round(total * 1.3)

  const accept = () => {
    if (!steps) return
    addTasks(steps.map((s, i) => ({
      id: `d-${Date.now()}-${i}`,
      title: s.title,
      source: 'mc' as const,
      estimateMin: s.estimateMin,
      done: false,
      space,
    })))
    onClose()
  }

  return (
    <Sheet
      title="Break it down"
      onClose={onClose}
      note="Demo: steps come from a canned library. The real app calls Claude with your goal, returns a dynamic number of steps, and calibrates estimates against your own logged history."
    >
      <label className="field-label" htmlFor="goal">What needs to happen?</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          id="goal"
          ref={inputRef}
          className="textinput"
          placeholder="Plan next week"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run() }}
        />
        <button className="btn btn-primary" onClick={run} disabled={busy || !goal.trim()}>
          {busy ? 'Thinking' : 'Break down'}
        </button>
      </div>

      {busy && (
        <div className="empty" style={{ paddingTop: 24 }} aria-live="polite">
          Splitting into steps and estimating each one.
        </div>
      )}

      {steps && (
        <div style={{ marginTop: 20 }}>
          {steps.map((s, i) => (
            <div className="step-item" key={i} style={{ animationDelay: `${i * 70}ms` }}>
              <span className="n">{i + 1}</span>
              <span className="grow">
                {s.title}
                {s.why && <span className="why">{s.why}</span>}
              </span>
              <span className="est-chip">~{s.estimateMin}m</span>
            </div>
          ))}
          <div className="total-line">
            <span>Raw estimate <span className="mono">{total}m</span></span>
            <span style={{ color: 'var(--muted)' }}>
              Plan for <span className="mono">{calibrated}m</span>, your history runs about 1.3x
            </span>
          </div>
          <div style={{ display: 'flex', marginTop: 16 }}>
            <button className="btn btn-primary" onClick={accept} style={{ marginLeft: 'auto' }}>
              Add {steps.length} steps to {space === 'personal' ? 'Personal' : space === 'work' ? 'Work' : 'Off-Plate'}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  )
}

/* ---------------- coach ---------------- */

export function CoachSheet({ onClose }: { onClose: () => void }) {
  const { addTasks, space } = useStore()
  const [i, setI] = useState(0)
  const step = COACH_DEMO[i]
  const last = i === COACH_DEMO.length - 1

  const finish = () => {
    addTasks([{
      id: `c-${Date.now()}`,
      title: 'Call: confirm the payment plan, script ready',
      source: 'mc',
      estimateMin: 15,
      done: false,
      space,
    }])
    onClose()
  }

  return (
    <Sheet
      title="Coach"
      onClose={onClose}
      note="Demo: one canned scenario. The real app walks any uncomfortable situation in five steps, plays the counterpart in rehearsal, and never invents institutional facts."
    >
      <div className="coach-progress" aria-hidden="true">
        {COACH_DEMO.map((_, k) => <i key={k} className={k <= i ? 'on' : ''} />)}
      </div>
      <span className="coach-step-label">Step {i + 1} of {COACH_DEMO.length}: {step.label}</span>
      <h3 className="coach-q">{step.question}</h3>
      {step.body && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', marginBottom: 12 }}>{step.body}</p>}
      {step.scripts?.map((s, k) => (
        <div className="script-line" key={k}>
          <span className="say">{s.say}</span>
          {s.text}
        </div>
      ))}
      <div className="coach-nav">
        {i > 0 && <button className="btn btn-quiet" onClick={() => setI(i - 1)}>Back</button>}
        {!last && <button className="btn btn-primary" onClick={() => setI(i + 1)}>Next</button>}
        {last && <button className="btn btn-primary" onClick={finish}>Save the call as a task</button>}
      </div>
    </Sheet>
  )
}

/* ---------------- time saved ledger ---------------- */

export function LedgerSheet({ onClose }: { onClose: () => void }) {
  const { ledger, savedMin, accuracyPct } = useStore()
  return (
    <Sheet
      title="Time saved"
      onClose={onClose}
      note="Every number here traces to a logged estimate and a logged actual. Nothing is projected, nothing is invented."
    >
      <div className="kpi">
        {Math.floor(savedMin / 60) > 0 ? `${Math.floor(savedMin / 60)}h ${savedMin % 60}` : savedMin}
        <span className="unit"> min</span>
      </div>
      <div className="kpi-sub" style={{ marginBottom: 16 }}>
        saved this week. Estimate accuracy {accuracyPct}% within a quarter of the estimate.
      </div>
      {ledger.map((e) => {
        const d = e.estimateMin - e.actualMin
        return (
          <div className="ledger-row" key={e.id}>
            <span className="mono" style={{ color: 'var(--faint)', fontSize: 'var(--text-xs)', minWidth: '3ch' }}>{e.when}</span>
            <span style={{ flex: 1, minWidth: 0 }}>{e.title}</span>
            <span className="mono" style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>
              ~{e.estimateMin} → {e.actualMin}m
            </span>
            <span className={`delta ${d >= 0 ? 'saved' : 'over'}`}>{d >= 0 ? `+${d}m` : `${d}m`}</span>
          </div>
        )
      })}
    </Sheet>
  )
}

/* ---------------- add widget ---------------- */

export function AddWidgetSheet({ onClose }: { onClose: () => void }) {
  const { spaces, space, addWidget } = useStore()
  const present = new Set(spaces[space].map((w) => w.type))
  const types = Object.values(WIDGET_DEFS)
  return (
    <Sheet
      title="Add a widget"
      onClose={onClose}
      note="The real app also gets a generic source widget: point it at any API or MCP connection and template the result."
    >
      <div className="addw-grid">
        {types.map((d) => (
          <button
            key={d.type}
            className="addw-item"
            disabled={present.has(d.type as WidgetType)}
            onClick={() => { addWidget(space, d.type as WidgetType); onClose() }}
          >
            {d.title}
            <span className="d">{d.description}</span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}
