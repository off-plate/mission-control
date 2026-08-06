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
type Mode = Detail | 'custom'

export function BreakdownSheet({ task, onClose }: { task: Task; onClose: () => void }) {
  const { setSubtasks } = useStore()
  const [busy, setBusy] = useState(true)
  const [steps, setSteps] = useState<DecomposedStep[] | null>(null)
  const [source, setSource] = useState<'model' | 'local'>('local')
  const [why, setWhy] = useState<string>('')
  const [mode, setMode] = useState<Mode>('normal')
  /* His own steps. Seeded from whatever was on screen when he switched, so
     Custom is also "these, but corrected", which is the more common want than
     starting from an empty list. */
  const [mine, setMine] = useState<DecomposedStep[]>([])
  const lastRow = useRef<HTMLInputElement>(null)
  const [focusLast, setFocusLast] = useState(false)

  useEffect(() => {
    if (mode === 'custom') return
    let live = true
    setBusy(true)
    void (async () => {
      const r = await breakdownTask(task.title, task.category, mode)
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
  }, [task.title, task.category, mode])

  useEffect(() => {
    if (focusLast) { lastRow.current?.focus(); setFocusLast(false) }
  }, [focusLast, mine.length])

  const toCustom = () => {
    setMine((prev) => (prev.length ? prev : (steps?.map((s) => ({ title: s.title, estimateMin: s.estimateMin })) ?? [{ title: '', estimateMin: 15 }])))
    setMode('custom')
    setBusy(false)
  }
  const own = mode === 'custom'
  const rows = own ? mine : (steps ?? [])
  const keep = rows.filter((s) => s.title.trim())
  const total = keep.reduce((a, s) => a + s.estimateMin, 0)
  const editRow = (i: number, patch: Partial<DecomposedStep>) =>
    setMine((prev) => prev.map((s, k) => (k === i ? { ...s, ...patch } : s)))
  const addRow = () => { setMine((prev) => [...prev, { title: '', estimateMin: 15 }]); setFocusLast(true) }
  const dropRow = (i: number) => setMine((prev) => prev.filter((_, k) => k !== i))

  return (
    <Sheet
      title="Break it down"
      onClose={onClose}
      /* No note when the model wrote them: the step list is the point, and a
         line about which service produced it is not something he needs under
         every breakdown. When it FAILED he still needs to know why, and what
         to do about it, so that one stays. */
      note={own || source === 'model' ? undefined : why}
    >
      <p className="sheet-task">{task.title}</p>

      {/* How far down to break it. Some days the shape is enough; some days you
          need every single move spelled out. */}
      <div className="seg detail-seg" role="group" aria-label="How detailed">
        {(['light', 'normal', 'deep'] as Detail[]).map((d) => (
          <button key={d} aria-pressed={mode === d} onClick={() => setMode(d)}>
            {d === 'light' ? 'Just the shape' : d === 'normal' ? 'Normal' : 'Every move'}
          </button>
        ))}
        {/* His own list. Nothing is asked of a model in this mode. */}
        <button aria-pressed={own} onClick={toCustom}>Mine</button>
      </div>

      {busy && !own && <div className="empty" style={{ paddingTop: 24 }} aria-live="polite">Reading this task and working out the steps.</div>}

      {own && (
        <div style={{ marginTop: 12 }}>
          {mine.map((s, i) => (
            <div className="step-edit" key={i}>
              <span className="n">{i + 1}</span>
              <input
                ref={i === mine.length - 1 ? lastRow : undefined}
                className="textinput grow" value={s.title} placeholder="What happens in this step"
                aria-label={`Step ${i + 1}`}
                onChange={(e) => editRow(i, { title: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); if (i === mine.length - 1) addRow(); }
                  if (e.key === 'Backspace' && !s.title && mine.length > 1) { e.preventDefault(); dropRow(i) }
                }}
              />
              <span className="step-min">
                <input
                  className="textinput" type="number" min={1} max={600} value={s.estimateMin}
                  aria-label={`Minutes for step ${i + 1}`}
                  onChange={(e) => editRow(i, { estimateMin: Math.max(1, Math.min(600, Number(e.target.value) || 1)) })}
                />
                <span className="mono">m</span>
              </span>
              <button className="step-drop" aria-label={`Remove step ${i + 1}`} onClick={() => dropRow(i)}>×</button>
            </div>
          ))}
          <button className="btn btn-quiet step-add" onClick={addRow}>Add a step</button>
        </div>
      )}

      {!own && steps && (
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
        </div>
      )}

      {(own || steps) && (
        <>
          <div className="total-line">
            <span>Planned <span className="mono">{total}m</span></span>
            <span style={{ color: 'var(--muted)' }}>
              {own ? 'Your steps, your minutes. This is the number that gets saved.'
                : source === 'model' ? 'Estimated per step by the model. This is the number that gets saved.'
                  : `Every step carries the ${BUFFER}x buffer, so this is the number that gets saved.`}
            </span>
          </div>
          <div className="sheet-actions">
            <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
            <button
              className="btn btn-primary" disabled={!keep.length}
              onClick={() => { setSubtasks(task.id, keep.map((s) => ({ title: s.title.trim(), estimateMin: s.estimateMin }))); onClose() }}
            >
              {keep.length ? `Add ${keep.length} ${keep.length === 1 ? 'step' : 'steps'} to this task` : 'Write a step first'}
            </button>
          </div>
        </>
      )}
    </Sheet>
  )
}


