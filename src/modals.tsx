import { useEffect, useRef, useState, type ReactNode } from 'react'
import { fakeDecompose, type DecomposedStep } from './mock'
import { BUFFER } from './estimate'
import type { Task } from './types'
import { breakdownTask, type Detail } from './ai'
import { useStore } from './store'
import { fmtDuration } from './util'

export function Sheet({ title, onClose, children, note, steady }: {
  title: string
  onClose: () => void
  children: ReactNode
  note?: string
  /** Hold one height across every state of the form, so switching between kinds
   *  changes the questions rather than the size of the window asking them. */
  steady?: boolean
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
        <div className={`sheet-body${steady ? ' is-steady' : ''}`}>{children}</div>
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
  const [source, setSource] = useState<'model' | 'local'>('local')
  const [why, setWhy] = useState<string>('')
  const [detail, setDetail] = useState<Detail>('normal')

  useEffect(() => {
    let live = true
    setBusy(true)
    void (async () => {
      const r = await breakdownTask(task.title, task.category, detail)
      if (!live) return
      if (r.ok) {
        setSource('model')
        setSteps(r.steps.map((s) => ({ title: s.title, why: s.why, estimateMin: s.estimateMin })))
      } else {
        setSource('local')
        setWhy(
          r.reason === 'no-key' ? 'No Groq key yet. Add one in Settings and this reads the actual task.'
          : r.reason === 'bad-key' ? 'That Groq key was rejected. Check it in Settings.'
          : r.reason === 'rate-limit' ? 'Groq is rate limiting right now. Try again shortly.'
          : 'Groq could not be reached just now.')
        setSteps(fakeDecompose(task.title).map((s) => ({ ...s, estimateMin: Math.max(1, Math.round(s.estimateMin * BUFFER)) })))
      }
      setBusy(false)
    })()
    return () => { live = false }
  }, [task.title, task.category, detail])

  const total = steps?.reduce((a, s) => a + s.estimateMin, 0) ?? 0

  return (
    <Sheet
      title="Break it down"
      onClose={onClose}
      note={source === 'model'
        ? 'Written for this task by Groq, using the key saved on this device. Nothing about it is in the code.'
        : `${why} These steps came from a local pattern library instead, so treat them as a starting point.`}
    >
      <p className="sheet-task">{task.title}</p>

      {/* How far down to break it. Some days the shape is enough; some days you
          need every single move spelled out. */}
      <div className="seg detail-seg" role="group" aria-label="How detailed">
        {(['light', 'normal', 'deep'] as Detail[]).map((d) => (
          <button key={d} aria-pressed={detail === d} onClick={() => setDetail(d)}>
            {d === 'light' ? 'Just the shape' : d === 'normal' ? 'Normal' : 'Every move'}
          </button>
        ))}
      </div>

      {busy && <div className="empty" style={{ paddingTop: 24 }} aria-live="polite">Reading this task and working out the steps.</div>}

      {steps && (
        <div style={{ marginTop: 12 }}>
          {steps.map((s, i) => (
            <div className="step-item" key={i} style={{ animationDelay: `${i * 60}ms` }}>
              <span className="n">{i + 1}</span>
              <span className="grow">
                {s.title}
                {s.why && <span className="why">{s.why}</span>}
              </span>
              <span className="est-chip">{fmtDuration(s.estimateMin)}</span>
            </div>
          ))}
          {source === 'local' && (
            <p className="sheet-warn">Not a model. A local pattern library matched this task, so read the steps before you accept them.</p>
          )}
          <div className="total-line">
            <span>Planned <span className="mono">{total}m</span></span>
            <span style={{ color: 'var(--muted)' }}>{source === 'model' ? 'Estimated per step by the model. This is the number that gets saved.' : `Every step carries the ${BUFFER}x buffer, so this is the number that gets saved.`}</span>
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


