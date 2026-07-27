import { useEffect, useRef, useState, type ReactNode } from 'react'
import { fakeDecompose, type DecomposedStep } from './mock'
import { BUFFER } from './estimate'
import type { Task } from './types'
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

/* Breaking down happens ON a task now, not in a box you retype the task into.
   The sheet reads the task you clicked, proposes steps, and attaches them as
   subtasks when you accept. */
export function BreakdownSheet({ task, onClose }: { task: Task; onClose: () => void }) {
  const { setSubtasks } = useStore()
  const [busy, setBusy] = useState(true)
  const [steps, setSteps] = useState<DecomposedStep[] | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSteps(fakeDecompose(task.title).map((s) => ({ ...s, estimateMin: Math.max(1, Math.round(s.estimateMin * BUFFER)) })))
      setBusy(false)
    }, 650)
    return () => window.clearTimeout(t)
  }, [task.title])

  const total = steps?.reduce((a, s) => a + s.estimateMin, 0) ?? 0

  return (
    <Sheet
      title="Break it down"
      onClose={onClose}
      note="Demo: the steps come from a local library. The real build sends this task to a model and calibrates each estimate against your own logged history."
    >
      <p className="sheet-task">{task.title}</p>

      {busy && <div className="empty" style={{ paddingTop: 24 }} aria-live="polite">Splitting it into steps and estimating each one.</div>}

      {steps && (
        <div style={{ marginTop: 12 }}>
          {steps.map((s, i) => (
            <div className="step-item" key={i} style={{ animationDelay: `${i * 60}ms` }}>
              <span className="n">{i + 1}</span>
              <span className="grow">
                {s.title}
                {s.why && <span className="why">{s.why}</span>}
              </span>
              <span className="est-chip">~{s.estimateMin}m</span>
            </div>
          ))}
          <div className="total-line">
            <span>Planned <span className="mono">{total}m</span></span>
            <span style={{ color: 'var(--muted)' }}>Every step carries the {BUFFER}x buffer, so this is the number that gets saved.</span>
          </div>
          <div className="sheet-actions">
            <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={() => { setSubtasks(task.id, steps.map((s) => ({ title: s.title, estimateMin: s.estimateMin }))); onClose() }}>
              Add {steps.length} steps to this task
            </button>
          </div>
        </div>
      )}
    </Sheet>
  )
}


