import { useEffect, useRef, useState, type ReactNode } from 'react'
import { fakeDecompose, type DecomposedStep } from './mock'
import { useStore } from './store'

export function Sheet({ title, onClose, children, note }: {
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

/** Optimism correction applied to every generated estimate. The real app derives
 *  this per category from the logged ledger; here it is one honest constant. */
const BUFFER = 1.3

export function DecomposeSheet({ onClose }: { onClose: () => void }) {
  const { addTaskWithSubtasks, space } = useStore()
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [dest, setDest] = useState<'today' | 'backlog'>('today')
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

  const buffered = steps?.map((s) => ({ ...s, estimateMin: Math.max(1, Math.round(s.estimateMin * BUFFER)) })) ?? null
  const total = steps?.reduce((a, s) => a + s.estimateMin, 0) ?? 0
  // Summed from the rounded steps, so the headline equals what gets created.
  const calibrated = buffered?.reduce((a, s) => a + s.estimateMin, 0) ?? 0

  /* The buffered number is the one that gets created. Showing 39m and then
     saving 30m would quietly re-teach the optimism this is meant to correct. */
  const accept = () => {
    if (!buffered) return
    addTaskWithSubtasks(
      { title: goal.trim(), source: 'mc', estimateMin: 0, space, list: dest, category: 'deep' },
      buffered.map((s) => ({ title: s.title, estimateMin: s.estimateMin })),
    )
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
          placeholder="Set up the bank payment plan"
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

      {buffered && (
        <div style={{ marginTop: 20 }}>
          {buffered.map((s, i) => (
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
            <span>Planned <span className="mono">{calibrated}m</span></span>
            <span style={{ color: 'var(--muted)' }}>
              Raw steps add up to <span className="mono">{total}m</span>; each one carries the 1.3x buffer. The real app computes that buffer from your own logged history.
            </span>
          </div>
          <div style={{ display: 'flex', marginTop: 16, gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="seg" role="group" aria-label="Where to add">
              <button aria-pressed={dest === 'today'} onClick={() => setDest('today')}>today</button>
              <button aria-pressed={dest === 'backlog'} onClick={() => setDest('backlog')}>backlog</button>
            </div>
            <button className="btn btn-primary" onClick={accept} style={{ marginLeft: 'auto' }}>
              Add as a task with {buffered.length} subtasks
            </button>
          </div>
        </div>
      )}
    </Sheet>
  )
}

