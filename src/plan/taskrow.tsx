import * as Icon from '../icons'
import { useState } from 'react'
import { useStore } from '../store'
import { Sheet } from '../modals'
import { Linkify } from '../widgets'
import { TagField } from '../tagfield'
import { tagOf, takeTag } from '../tags'
import { type SubTask, type Task } from '../types'
import { fmtDuration, isEstimated, taskMinutes } from '../util'

/* Add a step to a task by hand (his ask, 2026-11-07: every task can have sub tasks). Used under a task's
   steps in both views. Minutes are optional: the first step takes the task's own estimate, later ones 15. */
export function StepAdd({ taskId, first }: { taskId: string; first: boolean }) {
  const { addSubtask } = useStore()
  const [title, setTitle] = useState('')
  const [mins, setMins] = useState('')
  const add = () => {
    const t = title.trim()
    if (!t) return
    addSubtask(taskId, t, Number(mins) > 0 ? Number(mins) : undefined)
    setTitle(''); setMins('')
  }
  return (
    <div className="step-add">
      <span className="step-add-plus" aria-hidden="true"><Icon.Plus size={12} /></span>
      <input className="step-add-title" value={title} placeholder={first ? 'Add a first step' : 'Add a step'} aria-label="New step" autoComplete="off" enterKeyHint="done"
        onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }} />
      <input className="step-add-min mono" type="number" inputMode="numeric" min={1} max={480} value={mins} placeholder="min" aria-label="Minutes for the new step"
        onChange={(e) => setMins(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }} />
      <button className="step-add-go" disabled={!title.trim()} onClick={add}>Add</button>
    </div>
  )
}

export function SubEdit({ taskId, sub }: { taskId: string; sub: SubTask }) {
  const { updateSubtask, deleteSubtask } = useStore()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(sub.title)
  const [mins, setMins] = useState(String(sub.estimateMin))
  const save = () => {
    updateSubtask(taskId, sub.id, { title: title.trim() || sub.title, estimateMin: Number(mins) || sub.estimateMin })
    setEditing(false)
  }
  const cancel = () => { setTitle(sub.title); setMins(String(sub.estimateMin)); setEditing(false) }
  if (!editing) {
    return (
      <span className="sub-tools">
        <button className="sub-tool" aria-label={`Edit step: ${sub.title}`} onClick={() => setEditing(true)}>Edit</button>
        <button className="sub-tool" aria-label={`Remove step: ${sub.title}`} onClick={() => deleteSubtask(taskId, sub.id)}>Remove</button>
      </span>
    )
  }
  return (
    <div className="subtask-row is-editing" style={{ flex: '1 0 100%' }}>
      <input className="textinput sub-edit-title" value={title} autoFocus
        aria-label={`Step title: ${sub.title}`}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }} />
      <input className="textinput sub-edit-min mono" type="number" min={1} max={480} value={mins}
        aria-label={`Minutes for ${sub.title}`}
        onChange={(e) => setMins(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }} />
      <button className="btn btn-primary sub-btn" onClick={save}>Save</button>
    </div>
  )
}

export function SubtaskRow({ taskId, sub }: { taskId: string; sub: SubTask }) {
  const { updateSubtask, deleteSubtask } = useStore()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(sub.title)
  const [mins, setMins] = useState(String(sub.estimateMin))

  const save = () => {
    const t = title.trim()
    // An empty title would leave a row with nothing in it; keep the old one.
    updateSubtask(taskId, sub.id, { title: t || sub.title, estimateMin: Number(mins) || sub.estimateMin })
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="subtask-row is-editing">
        <input className="textinput sub-edit-title" value={title} autoFocus aria-label="Step name" autoComplete="off"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setTitle(sub.title); setMins(String(sub.estimateMin)); setEditing(false) } }} />
        <input className="textinput sub-edit-min mono" type="number" inputMode="numeric" min={1} max={480} value={mins} aria-label="Minutes for this step"
          onChange={(e) => setMins(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
        <button className="btn btn-primary sub-btn" onClick={save}>Save</button>
      </div>
    )
  }
  /* Finished stays finished here. This row drew every step the same way, so a
     task sent back to the list showed work he had already done as untouched:
     the record was intact, the page simply refused to say so. */
  return (
    <div className={`subtask-row${sub.done ? ' is-done' : ''}`}>
      <span className="sub-tick" aria-hidden="true" />
      <span className="grow" style={{ fontSize: 'var(--text-sm)' }}><Linkify text={sub.title} /></span>
      <span className="chip tone-info">{sub.done && sub.actualMin != null ? `${fmtDuration(sub.actualMin)} taken` : fmtDuration(sub.estimateMin)}</span>
      <span className="sub-tools">
        <button className="sub-tool" aria-label={`Edit step: ${sub.title}`} onClick={() => setEditing(true)}>Edit</button>
        <button className="sub-tool" aria-label={`Remove step: ${sub.title}`} onClick={() => deleteSubtask(taskId, sub.id)}>Remove</button>
      </span>
    </div>
  )
}

/* Editing what a task says and how big it claims to be. Everything on the list
   is his, generated or typed, so every row can be corrected without a detour
   through delete-and-retype. */
export function EditTaskSheet({ task, onClose }: { task: Task; onClose: () => void }) {
  const { updateTask, projects, setTaskProject } = useStore()
  /* The words and the hashtag, nothing else. The minutes already have a home
     of their own, on the estimate chip and on each step, and a second door to
     the same number is how two numbers disagree. The tag is written into the
     field so moving a task is the same act as filing it: change the hashtag,
     or delete it to take the task out of its project. */
  const own = projects.find((p) => p.id === task.projectId)
  const [title, setTitle] = useState(own ? `${task.title} #${tagOf(own)}` : task.title)
  const choices = [...projects.filter((p) => p.space === task.space), ...projects.filter((p) => p.space !== task.space)]
  const save = () => {
    const got = takeTag(title, projects)
    if (!got.title) return
    updateTask(task.id, { title: got.title })
    if (got.project?.id !== task.projectId) setTaskProject(task.id, got.project?.id)
    onClose()
  }
  return (
    <Sheet title="Edit this task" onClose={onClose}>
      <label className="field-label" htmlFor="et-title">What is it?</label>
      <TagField id="et-title" label="What is it?" value={title} onChange={setTitle} onSubmit={save} projects={choices} createSpace={task.space} autoFocus />
      <div className="sheet-actions">
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!title.trim()} onClick={save}>Save changes</button>
      </div>
    </Sheet>
  )
}

/** Inline "how long did it take?" logger shown when you finish a task or subtask.
 *  Also used by the assistant, under its own "Done: X" line, so this is the one
 *  place that ever asks the question -- not a second version of it there. */
export function ActualLog({ est, tracked, onLog, onSkip }: { est: number; tracked?: number | null; onLog: (m: number) => void; onSkip: () => void }) {
  const [custom, setCustom] = useState('')
  /* The timer already knows. Guesses off the estimate were the only offer here,
     so a block plus the ten minutes he extended it by got thrown away the moment
     he tapped "45m", and the day's saved-time went back to being fiction. What
     was actually clocked comes first, and it counts every block on this task
     today, extensions included. */
  const chips = Array.from(new Set([Math.max(1, Math.round(est / 2)), est, est * 2])).filter((m) => m !== tracked)
  return (
    <div className="actual-log" role="group" aria-label="How long did it take?">
      <span className="actual-log-q">How long?</span>
      {tracked ? (
        <button className="actual-chip is-tracked" onClick={() => onLog(tracked)}>
          {fmtDuration(tracked)} <span className="mono">tracked</span>
        </button>
      ) : null}
      {chips.map((m) => <button key={m} className="actual-chip" onClick={() => onLog(m)}>{m}m</button>)}
      <input
        className="actual-input" type="number" min={1} placeholder="min" value={custom}
        onChange={(e) => setCustom(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && Number(custom) > 0) onLog(Number(custom)) }}
        aria-label="Custom minutes"
      />
      <button className="actual-skip" onClick={onSkip}>skip</button>
    </div>
  )
}

/* The estimate is a number you can argue with. Click it and type your own; the
   generated one is a starting point, not a verdict. */
export function EstimateChip({ task }: { task: Task }) {
  const { setEstimate } = useStore()
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState('')
  const fromSteps = !!task.subtasks?.length
  const mins = taskMinutes(task)

  if (editing) {
    const commit = () => {
      const n = Math.round(Number(val))
      if (Number.isFinite(n) && n > 0) setEstimate(task.id, n)
      setEditing(false)
    }
    return (
      <input
        className="est-input" type="number" min={1} autoFocus value={val}
        aria-label={`Minutes for ${task.title}`}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
      />
    )
  }
  if (fromSteps) return <span className="chip tone-info" title="Comes from the steps">{fmtDuration(mins)}</span>
  return (
    <button
      className={`chip tone-info est-edit${isEstimated(task) ? '' : ' is-none'}`}
      title="Click to set the minutes yourself"
      aria-label={isEstimated(task) ? `${mins} minutes, click to change` : `No estimate, click to set one`}
      onClick={() => { setVal(isEstimated(task) ? String(mins) : ''); setEditing(true) }}
    >
      {isEstimated(task) ? fmtDuration(mins) : 'no estimate'}
    </button>
  )
}

/* The estimate button on a Line card (his ask, 2026-11-07: "instead of the three dots, keep the estimation
   icon that estimates the time, and that's it"). One tap asks for a fresh estimate of the task. A task
   with steps is the sum of its steps, so there it only says so. */
export function EstimateBtn({ task }: { task: Task }) {
  const { estimateNow } = useStore()
  const [busy, setBusy] = useState(false)
  const fromSteps = !!task.subtasks?.length
  const mins = taskMinutes(task)
  const label = fromSteps ? 'The time comes from the steps' : busy ? 'Estimating' : isEstimated(task) ? `Estimate again, now ${fmtDuration(mins)}` : 'Estimate the time'
  return (
    <button className={`pl-est${busy ? ' is-busy' : ''}`} disabled={fromSteps || busy} aria-label={label} title={label}
      onClick={() => { setBusy(true); void estimateNow(task.id).finally(() => setBusy(false)) }}>
      <Icon.Hourglass size={18} />
    </button>
  )
}
