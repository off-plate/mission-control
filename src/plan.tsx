/* THE PLAN PAGE. Split out of pages1.tsx (2026-09-09). Carries the task-row
   pieces (SubEdit, SubtaskRow, EditTaskSheet, ActualLog, EstimateChip,
   TaskActions) and the day-switcher/bucket helpers (prevDay, longDay,
   offsetWord, offsetDate, BUCKETS, BUCKET_HINT) that used to sit textually
   near Today's own code in the old file but are only ever used here --
   confirmed by grep before moving them, not assumed. ActualLog stays
   exported: assistantdock.tsx and assistantpage.tsx both import it. */
import * as Icon from './icons'
import { useEffect, useRef, useState } from 'react'
import { SPACE_LABELS } from './exceptions'
import { fakeDecompose } from './mock'
import { useStore } from './store'
import { usePomodoro } from './pomodoro'
import { BreakdownSheet, Sheet } from './modals'
import { Linkify } from './widgets'
import { PLAN_AHEAD_DAYS, WeekGrid, dayPlus, shortDay, weekRangeLabel } from './weekgrid'
import { useCoarsePointer, Band, Dropdown, SpaceMark } from './ui'
import { estimateFor } from './estimate'
import { estimateTask } from './ai'
import { SLOTS, habitLocked, routineComplete, routineProgress, slotMinutes, TYPING_TARGET_WPM, type Project, type Routine, type SubTask, type Task, type TimeSlot } from './types'
import { periodKeyFor, fmtDuration, fmtSigned, dayOfWeekKey, isEstimated, localDateKey, slotForMoment, taskMinutes } from './util'

const prevDay = (): string => dayPlus(-1)

/** Tomorrow's date, stepped the same careful way. */

const nextDay = (): string => dayPlus(1)


const dateLine = () =>
  new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

/** 'Friday, 28 August', for the title of the day panel. He asked (2026-08-28)
 *  for the date OUT of the day switcher's own header and onto the page title
 *  instead, in words rather than the switcher's short numerals. */

const longDay = (key: string): string => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

/** 'Today', 'Tomorrow', or 'Fri': the word for a pill in the day switcher. */

const offsetWord = (n: number): string => {
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  const [y, m, d] = dayPlus(n).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short' })
}
/** The date under the word, blank for Today/Tomorrow where the word already
 *  says enough and a number under it would be noise. */

const offsetDate = (n: number): string => {
  if (n <= 1) return ''
  const [, , d] = dayPlus(n).split('-')
  return String(Number(d))
}



function SubEdit({ taskId, sub }: { taskId: string; sub: SubTask }) {
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

function SubtaskRow({ taskId, sub }: { taskId: string; sub: SubTask }) {
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
function EditTaskSheet({ task, onClose }: { task: Task; onClose: () => void }) {
  const { updateTask } = useStore()
  const [title, setTitle] = useState(task.title)
  /* Only the words. The minutes already have a home of their own, on the
     estimate chip and on each step, and a second door to the same number is
     how two numbers disagree. */
  const save = () => {
    updateTask(task.id, { title })
    onClose()
  }
  return (
    <Sheet title="Edit this task" onClose={onClose}>
      <label className="field-label" htmlFor="et-title">What is it?</label>
      <input id="et-title" className="textinput" style={{ width: '100%' }} value={title} autoFocus
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) save() }} />
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
function EstimateChip({ task }: { task: Task }) {
  const { setEstimate, inView } = useStore()
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

/* Breaking a task down and estimating it are actions on the task itself. */
function TaskActions({ task, onFocus }: { task: Task; onFocus?: () => void }) {
  const { setEstimate, inView } = useStore()
  const hasSubs = !!task.subtasks?.length
  const [thinking, setThinking] = useState(false)
  /* The AI reads the task; the local rule of thumb only catches the fall. A
     flat default dressed as an estimate taught him to ignore the button. */
  const estimate = async () => {
    if (thinking) return
    setThinking(true)
    try {
      const ai = await estimateTask(task.title, task.category)
      setEstimate(task.id, ai ?? estimateFor(task.title, task.category).minutes)
    } finally { setThinking(false) }
  }
  return (
    <span className="task-actions">
      {onFocus && (
        <button
          className="task-act task-focus"
          disabled={!isEstimated(task)}
          aria-label={isEstimated(task) ? `Focus on ${task.title} for ${taskMinutes(task)} minutes` : `Estimate ${task.title} before starting a focus block`}
          title={isEstimated(task) ? `Focus ${taskMinutes(task)}m on this` : 'Estimate it first'}
          onClick={onFocus}
        >
          <Icon.Play size={18} />
        </button>
      )}
      <button
        className="task-act"
        disabled={hasSubs}
        aria-label={hasSubs ? `${task.title} takes its estimate from its steps` : `Estimate how long ${task.title} takes`}
        title={hasSubs ? 'Estimate comes from the steps' : 'Estimate the time'}
        onClick={estimate}
      >
        {thinking
          ? <span className="est-thinking" aria-label="Estimating" />
          : (
            <Icon.Hourglass size={18} />
          )}
      </button>
    </span>
  )
}

/* A routine standing on the day's list. It is DERIVED from the routine, never a
   copy of it: a copied task would drift the moment either side changed, and the
   whole point is that finishing it here and finishing it on Routines are the
   same act. Its steps are the subtasks. */
/* A routine standing on the day's list. It is a task row, not a species of its
   own: same checkbox, same title, same expander, same menu. The only thing that
   marks it out is a small "repeats" tag, because a different layout for the same
   kind of thing reads as two different apps on one page. */

/* Each part of the day says WHICH hours it means, in the header, because
   "Morning" answers nothing about where 12:30 goes. */
const BUCKET_HINT: Record<string, string> = Object.fromEntries(SLOTS.map((s) => [s.id, s.hint]))
const BUCKETS: { id: TimeSlot | 'unsorted'; label: string }[] = [
  { id: 'unsorted', label: 'Unsorted' },
  ...SLOTS.map((s) => ({ id: s.id, label: s.label })),
]

function RoutineOnDay({ routine, day }: { routine: Routine; day?: string }) {
  const { toggleRoutineStep, toggleRoutineAlt, setRoutineDone, planRoutine, setPage, inView, habits, stepLog } = useStore()
  const [open, setOpen] = useState(false)
  // Counts what the routine needs, so an optional step neither pads the total
  // nor keeps a finished routine one short of it.
  const { done, total } = routineProgress(routine)
  const complete = routineComplete(routine, periodKeyFor(routine.cadence))
  /* Every step is a habit now, and the gate lives on the habit, not on the
     routine's own stepData: that field stopped being written the day logging
     the number moved to the Habits page, so reading it here would have shown
     the typing step locked forever, passed or not. */
  const stepGated = (stepId: string): boolean => {
    const h = habits.find((x) => x.id === (routine.steps.find((s) => s.id === stepId)?.habitId ?? `h-${routine.id}-${stepId}`))
    return !!h && habitLocked(h, stepLog, localDateKey())
  }
  const gated = !complete && routine.steps.some((st) => !routine.doneStepIds.includes(st.id) && stepGated(st.id))

  return (
    <div className="today-item">
      <div className={`today-task${complete ? ' done' : ''}`}>
        {/* A routine is not dragged into a time, but its checkbox still has to
            line up with the ones under it. */}
        <span className="drag-grip is-blank" aria-hidden="true"><Icon.Grip /></span>
        <SpaceMark space={routine.space} />
        <button
          className="checkbox"
          role="checkbox"
          aria-checked={complete}
          disabled={total === 0 || gated}
          aria-label={complete ? `Reopen: ${routine.title}` : `Finish: ${routine.title}`}
          title={total === 0
            ? 'Write its steps first'
            : gated
              ? `Open it in Habits: one step has to be earned, not ticked (${TYPING_TARGET_WPM} WPM)`
              : undefined}
          onClick={() => setRoutineDone(routine.id, !complete)}
        >
          <Icon.Check size={12} strokeWidth={4} />
        </button>
        <span className="grow wrap2">{routine.title}</span>
        {/* One tag, saying the one thing it needs to: this is a routine, it put
            itself here. Cadence words were never asked for. */}
        <span className="repeat-tag">routine</span>
        {total > 0 && (
          <button className="expand-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Collapse steps' : 'Expand steps'}>
            {open ? '▾' : '▸'} {done}/{total}
          </button>
        )}
        <Dropdown label={`Options for ${routine.title}`}>
          {/* Moving it is the same menu as putting it here in the first place,
              so a routine can be planned into the evening and then pulled
              forward without leaving the day. */}
          {SLOTS.filter((s) => s.id !== routine.planned?.slot).map((s) => (
            <button key={s.id} role="menuitem" onClick={() => planRoutine(routine.id, s.id, day)}>Move to {s.label.toLowerCase()}</button>
          ))}
          <span className="kebab-sep" />
          <button role="menuitem" onClick={() => setPage('habits')}>Open in Habits</button>
          {routine.planned && !routine.startedAt && (
            <button role="menuitem" onClick={() => planRoutine(routine.id)}>Take it off</button>
          )}
        </Dropdown>
      </div>

      {total === 0 && (
        <p className="rod-empty">
          No steps yet.{' '}
          <button className="rod-link" onClick={() => setPage('habits')}>Write them</button>
        </p>
      )}

      {open && total > 0 && (
        <div className="subtask-list">
          {routine.steps.map((s) => {
            const checked = routine.doneStepIds.includes(s.id)
            const locked = !checked && stepGated(s.id)
            /* A step with a choice is ticked by picking one of its answers, so
               here it offers the answers instead of a checkbox that would have
               to guess which one he meant. */
            if (s.alts?.length) {
              return (
                <div key={s.id} className="subtask-wrap">
                  {s.alts.map((a) => {
                    const picked = routine.stepChoice?.[s.id] === a.id
                    return (
                      <button
                        key={a.id}
                        className={`subtask alt${picked ? ' done' : ''}`}
                        onClick={() => toggleRoutineAlt(routine.id, s.id, a.id)}
                      >
                        <span className="sub-tick" aria-hidden="true" />
                        <span className="grow">{a.title}</span>
                      </button>
                    )
                  })}
                </div>
              )
            }
            return (
              <div key={s.id} className="subtask-wrap">
                <button
                  className={`subtask${checked ? ' done' : ''}`}
                  disabled={locked}
                  title={locked ? `Open this in Habits and log ${TYPING_TARGET_WPM} WPM to check it off` : undefined}
                  onClick={() => (locked ? setPage('habits') : toggleRoutineStep(routine.id, s.id))}
                >
                  <span className="sub-tick" aria-hidden="true" />
                  <span className="grow">{s.title}</span>
                  {s.optional && <span className="step-optional mono">optional</span>}
                  {locked && <span className="rod-locked mono">{TYPING_TARGET_WPM} WPM to pass</span>}
                </button>
              </div>
            )
          })}
        </div>
      )}

    </div>
  )
}

export function PlanPage() {
  const todayIdx = (new Date().getDay() + 6) % 7
  const pomo = usePomodoro()
  const { startFocus } = pomo
  const { routines, habits } = useStore()
  const { space, tasks, toggleTask, logActual, assignSlot, toggleSubtask, logSubtaskActual, moveTasksToToday, moveTaskList, deleteTask, addTask, addTaskWithSubtasks, focusTaskId, setFocusTaskId, setTaskAt, plan, setPage, openDay, view, inView, focusSessions, dayLog } = useStore()
  const { projects, openProjectId, setTaskProject } = useStore()
  /* A project is a room inside a Space, not a second store: this is the one
     line that scopes Plan to it. Everything below (backlog, the day, the
     progress bar) is derived from spaceTasks, so nothing downstream has to
     know a project was ever involved. */
  const activeProject = openProjectId ? projects.find((p) => p.id === openProjectId) ?? null : null
  const addSpace = activeProject ? activeProject.space : space

  /* Moving a task between a project and the Space's own Plan is the same
     move either direction: set or clear projectId. A task's own space never
     changes, so the only projects on offer are the ones already in ITS
     space, never the view's -- this menu still makes sense from All. */
  const projectMenu = (t: Task) => {
    const inSpace = projects.filter((p) => p.space === t.space)
    if (inSpace.length === 0) return null
    return (
      <>
        <span className="kebab-sep" />
        <span className="kebab-head">Project</span>
        {t.projectId && <button role="menuitem" onClick={() => setTaskProject(t.id, undefined)}>Move to Plan</button>}
        {inSpace.filter((p) => p.id !== t.projectId).map((p) => (
          <button key={p.id} role="menuitem" onClick={() => setTaskProject(t.id, p.id)}>Move to {p.name}</button>
        ))}
      </>
    )
  }

  const spaceTasks = tasks.filter((t) => inView(t.space) && (!openProjectId || t.projectId === openProjectId))
  const backlogOpen = spaceTasks.filter((t) => !t.done && t.list === 'backlog') // the to-do pool
  /* In All the three rooms would otherwise interleave into one undifferentiated
     pile. Grouped by room, in the order of the switcher above, so the list reads
     the same way the app is laid out. In a single room there is nothing to
     group, so his own order is left alone. */
  /* Newest first, full stop. His words: "every time I add something new into
     the to-do list, it should be the first item, based on time added."

     Two things used to push a new task down the page and both are gone. Work
     carried over from a planned day was hoisted above everything, so anything
     added today landed underneath it, which is the "somewhere in the middle"
     he saw. And in All view the list was then sorted by workspace, so where a
     new task appeared depended on which room it belonged to, which is the
     "random" one. The carried count is still on the row, because that fact is
     worth having; it just no longer decides the order.

     addedAt is a real timestamp. Tasks from before it existed have none, sort
     as 0, and keep their existing order below anything newly added, which is
     already newest-first because the store prepends. */
  const backlogSorted = [...backlogOpen].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
  /* Which day the right hand column is laying out. This used to be a single
     step, today or tomorrow, on the argument that Sunday evening is exactly
     when a week gets planned and Monday could not be touched until Monday. He
     asked for the rest of the week the same way (2026-08-28): PLAN_AHEAD_DAYS
     more days he can step onto and lay out, one at a time, the same panel he
     already knows. offset 0 is today, 1 is tomorrow, up to 6 days out. */
  const [dayOffset, setDayOffset] = useState(0)
  const coarse = useCoarsePointer()
  const planDay = dayPlus(dayOffset)
  const onDay = (t: Task) => t.list === 'today' && (t.plannedOn ?? localDateKey()) === planDay
  const todayAll = spaceTasks.filter(onDay)                      // the day incl. finished (they stay, struck)
  const todayTasks = todayAll.filter((t) => !t.done)             // still to do
  const doneUnsorted = todayAll.filter((t) => t.done && !t.slot) // finished, never scheduled

  /* A routine reaches the day by being started, not by existing. Until he ticks
     his first step it lives on the Routines page only, so Today opens as the
     work he chose rather than a wall of things the app put there. The moment it
     starts it files itself under the time he started it: this list is a record
     of the day, not a plan for it. */
  /* A day ahead's weekend is not today's: planning a Friday from a Tuesday must
     not hide the work routines it is planning. */
  const dayIdx = (todayIdx + dayOffset) % 7
  const isWeekend = dayIdx >= 5
  const today = localDateKey()
  const ahead = dayOffset > 0
  /* Started counts as on today only. A routine cannot have been started on a day
     that has not happened, so a day ahead shows exactly what he has planned
     onto it.

     "Started" has to mean started TODAY, not merely started at some point in
     the period still running. This read `!!r.startedAt`, and startedAt is only
     cleared when the PERIOD rolls over, which for a monthly routine is the
     turn of the month. So the Monthly review, begun once on an afternoon, sat
     on every single day for the rest of that month, in the slot matching the
     hour it was first opened, already finished, and "Take it off" could not
     shift it because that only clears `planned`. His report, exactly. */
  const startedOn = (r: Routine) => (r.startedAt ? localDateKey(new Date(r.startedAt)) : null)
  const onToday = (r: Routine) => (ahead
    ? r.planned?.day === planDay
    : (startedOn(r) === planDay || r.planned?.day === planDay))
  const dueRoutines = routines.filter((r) => inView(r.space) && !r.archivedAt && onToday(r) && !(r.cadence === 'prework' && isWeekend))
  /* A slot he chose wins over the clock: planning it for the evening and
     starting it early should not throw it back to the morning while he is
     looking at it. */
  const routineSlot = (r: Routine): TimeSlot | 'unsorted' =>
    r.planned?.day === planDay && r.planned.slot ? r.planned.slot
      : (!ahead && r.startedAt) ? slotForMoment(r.startedAt) : 'unsorted'
  const plannedMin = todayTasks.reduce((a, t) => a + taskMinutes(t), 0)

  /* Progress counts everything in the space, today included, and counts finished
     SUBTASK minutes too, so a task that is two thirds done moves the bar instead
     of reading as zero until the last step lands. */
  const pool = spaceTasks
  const totalMin = pool.reduce((a, t) => a + taskMinutes(t), 0)
  const doneMin = pool.reduce((a, t) => {
    if (t.done) return a + taskMinutes(t)
    return a + (t.subtasks?.filter((s) => s.done).reduce((x, s) => x + s.estimateMin, 0) ?? 0)
  }, 0)
  const doneCount = pool.filter((t) => t.done).length
  const donePct = totalMin ? Math.round((doneMin / totalMin) * 100) : 0

  /* Time saved today: estimate minus what it actually took. A task finished
     through the focus timer never had its minutes typed in, so its focus blocks
     ARE its actual; without that, an hour of overrun quietly vanished from the
     number and "saved" read positive on a day that ran long. */
  /* Every block clocked against this title today, plus the one still running if
     it carries the same name. A block finished and then extended is two rows,
     so this has to add them up rather than read the last one. */
  const trackedFor = (title: string) => {
    const want = title.trim().toLowerCase()
    const logged = focusSessions
      .filter((f) => f.day === localDateKey() && (f.label ?? '').trim().toLowerCase() === want && inView(f.space))
      .reduce((a, f) => a + f.minutes, 0)
    const live = pomo.phase === 'focus' && (pomo.focusLabel ?? '').trim().toLowerCase() === want
      ? Math.max(0, Math.floor((pomo.blockMin * 60 - pomo.secondsLeft) / 60))
      : 0
    const mins = logged + live
    return mins > 0 ? mins : null
  }
  const focusActual = (t: Task) => trackedFor(t.title)
  const actualOf = (t: Task) => t.actualMin ?? (t.done ? focusActual(t) : null)
  const loggedAny = todayAll.some((t) => actualOf(t) != null || t.subtasks?.some((x) => x.actualMin != null))
  const savedToday = todayAll.reduce((acc, t) => {
    if (t.subtasks?.length) return acc + t.subtasks.reduce((a, x) => a + (x.done && x.actualMin != null ? x.estimateMin - x.actualMin : 0), 0)
    const actual = actualOf(t)
    return acc + (t.done && actual != null ? t.estimateMin - actual : 0)
  }, 0)

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [dropKey, setDropKey] = useState<string | null>(null)
  /* DRAG A TASK, HOVER A DAY, IT OPENS ITSELF. His ask, 2026-08-29: sorting a
     few tasks across a few days meant a full click-drag-click-drag lap per
     task, because the only way onto Wednesday was to click its pill BEFORE
     picking the task up. Now the pill itself is a target: hold a drag over it
     for a second and this panel steps onto that day without letting go of
     what he is carrying, the same "spring-loaded folder" a file manager does.
     A plain click still switches instantly; this is additive, not a
     replacement. Touch has no drag to hover with, so it keeps the "Plan for a
     day" kebab shortcut built the same day. */
  const [armingDay, setArmingDay] = useState<number | null>(null)
  const armTimer = useRef<number | null>(null)
  const clearArm = () => {
    if (armTimer.current != null) { window.clearTimeout(armTimer.current); armTimer.current = null }
    setArmingDay(null)
  }
  const armDay = (n: number) => {
    if (n === dayOffset) return                 // already standing on it
    if (armingDay === n) return                  // already counting down to it
    clearArm()
    setArmingDay(n)
    armTimer.current = window.setTimeout(() => { setDayOffset(n); clearArm() }, 1000)
  }
  /* A drag can end mid-air over the pill without a dragleave ever firing (he
     drops right there, or the browser cancels it), which would otherwise
     leave the countdown running for a switch nobody is dragging toward any
     more. One window listener catches every way a drag can end. */
  useEffect(() => {
    const onEnd = () => clearArm()
    window.addEventListener('dragend', onEnd)
    window.addEventListener('drop', onEnd)
    return () => { window.removeEventListener('dragend', onEnd); window.removeEventListener('drop', onEnd) }
  }, [])
  const [logging, setLogging] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [flashIds, setFlashIds] = useState<string[]>([])
  const [listDropOver, setListDropOver] = useState(false)
  const [quick, setQuick] = useState('')
  const [breakdownFor, setBreakdownFor] = useState<Task | null>(null)
  const [editingTask, setEditingTask] = useState<Task | null>(null)

  /* On a laptop the four parts of the day run well past the fold, so each part
     folds away and the whole set folds with one button. Which ones are shut is a
     view he set rather than something that happened to his data, so it lives in
     localStorage and never goes near the sync. */
  const [shutSlots, setShutSlots] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('mc:shut-slots')
      return new Set(raw ? (JSON.parse(raw) as string[]) : [])
    } catch { return new Set() }
  })
  const keepShut = (next: Set<string>) => {
    setShutSlots(next)
    try { localStorage.setItem('mc:shut-slots', JSON.stringify([...next])) } catch { /* private mode */ }
  }
  const setShut = (id: string, on: boolean) => {
    const next = new Set(shutSlots)
    if (on) next.add(id); else next.delete(id)
    keepShut(next)
  }

  /* The returned work that is still actually waiting ON THE LIST. The bar
     reads from this, so replanning, finishing or deleting the last of it takes
     the bar away with it. Without the list check, pressing Replan moved both
     tasks and left the bar claiming they were back on a list that read
     "Nothing waiting" right underneath. */
  const returnedLeft = (plan.returnedIds ?? []).filter((id) => {
    const t = tasks.find((x) => x.id === id)
    return !!t && !t.done && t.list === 'backlog'
  })

  /* "Show me" points at the work that came back overnight: scroll the list into
     view and mark those rows for a couple of seconds. */
  const showReturned = () => {
    const ids = returnedLeft
    setFlashIds(ids)
    const first = document.querySelector(`[data-todo-id="${ids[0]}"]`)
    ;(first ?? document.querySelector('.todo-col'))?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    window.setTimeout(() => setFlashIds([]), 2600)
  }

  /* Today's "Start" hands the task over here: flash it so the eye lands on it. */
  useEffect(() => {
    if (!focusTaskId) return
    setFlashId(focusTaskId)
    setFocusTaskId(null)
    const el = document.querySelector(`[data-task-id="${focusTaskId}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const timer = window.setTimeout(() => setFlashId(null), 2600)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTaskId])

  const toggleExp = (id: string) =>
    setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  const generate = () => {
    if (!goal.trim() || busy) return
    setBusy(true)
    window.setTimeout(() => {
      const steps = fakeDecompose(goal)
      addTaskWithSubtasks(
        { title: goal.trim(), source: 'mc', estimateMin: 0, space, list: 'backlog', category: 'deep' },
        steps.map((s) => ({ title: s.title, estimateMin: s.estimateMin })),
      )
      setGoal(''); setBusy(false)
    }, 750)
  }

  /* One drop handler for both directions: into a time bucket moves the task to
     today and slots it; onto the list sends it back to the backlog. */
  const dropTo = (key: TimeSlot | 'unsorted', id: string) => {
    const t = tasks.find((x) => x.id === id)
    // Onto the day being shown, which is not always today.
    if (t && (t.list !== 'today' || (t.plannedOn ?? localDateKey()) !== planDay)) moveTaskList(id, 'today', planDay)
    assignSlot(id, key === 'unsorted' ? undefined : key)
  }
  const dropToList = (id: string) => {
    const t = tasks.find((x) => x.id === id)
    if (!t || t.list === 'backlog') return
    moveTaskList(id, 'backlog')
    assignSlot(id, undefined)
  }

  /* THE WEEK, on his instruction (2026-08-28): not the seven days ahead of the
     switcher above, which follows him and always starts on whichever day he
     opens the app, but the calendar week he is actually standing in, Monday to
     Sunday, so a Wednesday still shows what Monday looked like. Its own state:
     it does not track dayOffset, and stepping it does not move the day panel.

     READ ONLY BY DESIGN. The day panel above is already the tool for placing a
     task into a time of day; asking this grid to be forty nine more drop zones
     would make one job two half-built tools instead of one whole one. A day's
     header is the one thing here that does anything: click it and the day
     panel steps onto that day if it can, or opens that day's record if it
     already happened. */
  const [weekShift, setWeekShift] = useState(0)
  /* Folded shut on load, every time: the week is context for the day he's
     planning, not the first thing the page shows. His own mockup put it
     right under the header, above the to-do list and day panel, collapsed
     to one bar until he opens it. */
  const [weekOpen, setWeekOpen] = useState(false)
  /* THE ALMANAC. He picked this shape from three variants shown as artifacts,
     2026-08-30: a card per day with a ring for how full it is and its tasks
     grouped into slot chips, over the flat hairline table it replaces. A
     density cap with a "show every task" switch shipped first, then came
     out again on his word: he always wants every task visible, so there is
     no toggle left to default shut. */
  const weekAnchor = dayPlus(weekShift * 7)
  const weekDays = Array.from({ length: 7 }, (_, i) => dayOfWeekKey(i, new Date(`${weekAnchor}T12:00:00`)))
  const weekTasks = spaceTasks.filter((t) => t.list === 'today')
  /* How far a date sits from today, so a click knows whether to step the day
     panel (it can reach today plus PLAN_AHEAD_DAYS) or open the record of a
     day already gone. */
  const daysOut = (iso: string) => Math.round(
    (new Date(`${iso}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000,
  )
  const jumpToDay = (iso: string) => {
    const out = daysOut(iso)
    if (out < 0) { openDay(iso); return }
    setDayOffset(Math.min(out, PLAN_AHEAD_DAYS))
    document.querySelector('.day-switch')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  return (
    <div className="page">
      <Band
        title={activeProject ? activeProject.name : `Plan ${longDay(planDay)}`}
        /* Which room this is, against the title itself, not off in the far
           corner with the buttons: see Band's own note on `beside`. */
        beside={activeProject
          ? <span className="crumb">{SPACE_LABELS[activeProject.space]}</span>
          : undefined}
        metrics={[
          { v: fmtDuration(plannedMin), k: `planned ${dayOffset === 0 ? 'today' : offsetWord(dayOffset).toLowerCase()}`, tone: 'info' as const },
          { v: pool.length ? `${donePct}%` : '—', k: pool.length ? 'of planned time done' : 'no tasks yet', tone: (pool.length && donePct > 0 ? 'pos' : 'info') as 'pos' | 'info' },
          ...(loggedAny ? [{ v: savedToday >= 0 ? fmtSigned(savedToday) : fmtDuration(-savedToday), k: savedToday >= 0 ? 'saved today' : 'over your estimates', tone: (savedToday >= 0 ? 'pos' : 'urgent') as 'pos' | 'urgent' }] : []),
        ]}
        /* The way back into the record, or the way back out of a project into
           its own room's Plan. Never both: a project already has Yesterday
           one tap further, through Projects then the Space's own Plan. */
        actions={activeProject
          ? <button className="btn btn-ghost" onClick={() => setPage('projects')}>&larr; Projects</button>
          : <button className="btn btn-ghost" onClick={() => openDay(prevDay())}>Yesterday</button>}
      />
      {/* THE WEEK. Moved above the to-do list and day panel on his instruction
          (2026-08-31, from his own mockup): folded to one bar by default,
          giving context for the day he's about to plan without taking over
          the page in full. */}
      <div className={`panel weekplan${weekOpen ? ' is-open' : ''}`}>
        {/* The whole bar opens AND closes it -- one handler, both directions.
            The nav row (This week / prev) stops its own clicks from reaching
            this so paging a week doesn't also fold the thing shut. */}
        {/* A div carrying role="button": it holds real <button> nav controls
            inside it, and a button cannot nest inside a button -- the browser
            would just close the outer one early and break the layout.
            role+tabIndex give it the same keyboard reach a button would have. */}
        <div
          className="weekplan-bar"
          role="button"
          tabIndex={0}
          aria-expanded={weekOpen}
          onClick={() => setWeekOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setWeekOpen((v) => !v) }
          }}
        >
          <span className="weekplan-title">
            <span className="microcap">The week</span>
            <span className="weekplan-range mono">{weekRangeLabel(weekDays[0], weekDays[6])}</span>
          </span>
          {/* His sentence, verbatim in shape, tightened in wording: "9hours and
              10 minutes" read as a typo more than a choice, and this app
              already spells every other duration as fmtDuration does (Band's
              own "9h 10m" sits three lines above this bar on the same page). */}
          <span className="weekplan-sentence">
            {todayTasks.length === 0 ? (
              'Nothing planned for today yet.'
            ) : (
              <>
                You have <strong>{todayTasks.length} {todayTasks.length === 1 ? 'task' : 'tasks'}</strong> planned
                for today, taking <strong>{fmtDuration(plannedMin)}</strong> of your day.
              </>
            )}
          </span>
          <span className="weekplan-nav" onClick={(e) => e.stopPropagation()}>
            {weekOpen && (
              <button className="wk-navbtn" aria-label="Previous week" onClick={() => setWeekShift((n) => n - 1)}>
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 L6 8 L10 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            )}
            {weekOpen && (
              <button
                className="wk-navbtn is-word"
                disabled={weekShift === 0}
                aria-current={weekShift === 0 ? 'true' : undefined}
                onClick={() => setWeekShift(0)}
              >
                This week
              </button>
            )}
            {/* Same slot, two jobs. Shut, it's a redundant affordance for what
                the whole bar already does -- his words, "more of a show off
                than functional". Open, it becomes the real next-week arrow,
                which is why the icon swaps from a down chevron to a right one
                the moment the fold opens. */}
            <button
              className="wk-navbtn weekplan-toggle"
              aria-label={weekOpen ? 'Next week' : 'Show the week'}
              onClick={() => (weekOpen ? setWeekShift((n) => n + 1) : setWeekOpen(true))}
            >
              {weekOpen ? (
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3 L10 8 L6 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6 L8 10 L13 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              )}
            </button>
          </span>
        </div>
        {/* A CSS grid-rows tween, not a max-height guess: it animates to
            however tall the real content is, at any density, instead of
            snapping open or stopping short. The grid itself stays mounted
            through both states so the tween always has something to measure
            and a click inside it can never bubble up to the bar and fold it
            shut -- only the bar's own onClick can do that. */}
        <div className="weekplan-collapse" aria-hidden={!weekOpen}>
        <div className="weekplan-collapse-inner">
        <WeekGrid
          weekDays={weekDays} weekTasks={weekTasks} spaceTasks={spaceTasks} dayLog={dayLog}
          today={today} daysOut={daysOut} reachableMax={PLAN_AHEAD_DAYS} onDayClick={jumpToDay}
        />
        </div>
        </div>
      </div>
      {/* What came back overnight. Said once, on the day it happened, with the
          count and a way to take it back in one move. The alternative was work
          quietly vanishing from the day, which is worse than a wall of it. */}
      {/* Counted live against the tasks themselves: the bar names unfinished
          work, so finishing it (or deleting it) takes the bar away. A banner
          about work already done is nagging, not information. */}
      {plan.returnedOn === localDateKey() && returnedLeft.length > 0 && (
        <div className="handoff">
          <span className="grow">
            {returnedLeft.length === 1
              ? '1 thing you did not finish is back on the list.'
              : `${returnedLeft.length} things you did not finish are back on the list.`}
          </span>
          <button className="btn btn-quiet" onClick={() => openDay(prevDay())}>See yesterday</button>
          {/* This used to route to Plan from Plan, which is nothing happening.
              It now finds them on the list and marks them for a moment. */}
          <button className="btn btn-quiet" onClick={showReturned}>Show me</button>
          {/* Re-choosing them is the point of the rollover; re-dragging them one
              by one is just its tax. One press puts all of them back on today,
              unsorted, still his to place. */}
          <button className="btn btn-primary" onClick={() => { moveTasksToToday(returnedLeft); setDayOffset(0) }}>
            Replan {returnedLeft.length === 1 ? 'it' : `all ${returnedLeft.length}`} for today
          </button>
        </div>
      )}

      {/* The hourly schedule lives on Calendar now; Plan is the list and the day. */}
      <div className="grid-3 plan-cols plan-two">
        {/* 1. To-do list: everything you added, any day. Drag out to plan it,
            drag back to take it off today. */}
        <div
          className={`panel todo-col${listDropOver ? ' drop-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setListDropOver(true) }}
          onDragLeave={() => setListDropOver(false)}
          onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) dropToList(id); setListDropOver(false) }}
        >
          {/* One line that says what the list holds and what is left. The bar
              and the bare "10 here" were three tellings of half a fact. */}
          <div className="col-head">
            <span className="microcap">To-do list</span>
            {/* This head counts what the list below it shows. The whole pool's
                "0 of 5 done" over "Nothing waiting" was two truths about two
                different lists wearing one label. */}
            <span className="col-tot mono">{(() => {
              const mins = backlogOpen.reduce((a, t) => a + taskMinutes(t), 0)
              // "4 waiting · 0m" read like a bug; no estimates, no duration.
              return `${backlogOpen.length} waiting${mins > 0 ? ` · ${fmtDuration(mins)}` : ''}`
            })()}</span>
          </div>
          {/* Add a task; breaking it down is an action on the task itself. */}
          <div className="formrow" style={{ marginBottom: 'var(--s2)' }}>
            <input
              className="textinput"
              placeholder="Add something to the list…"
              value={quick}
              onChange={(e) => setQuick(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && quick.trim()) { addTask({ title: quick.trim(), source: 'mc', estimateMin: 0, space: addSpace, list: 'backlog', category: 'quick', projectId: openProjectId ?? undefined }); setQuick('') } }}
              aria-label="New task"
            />
            <button className="btn btn-quiet" disabled={!quick.trim()} onClick={() => { addTask({ title: quick.trim(), source: 'mc', estimateMin: 0, space: addSpace, list: 'backlog', category: 'quick', projectId: openProjectId ?? undefined }); setQuick('') }}>Add</button>
          </div>
          {backlogSorted.map((t) => {
            const isExp = expanded.has(t.id)
            const hasSubs = !!t.subtasks?.length
            const doneSubs = t.subtasks?.filter((s) => s.done).length ?? 0
            return (
              <div className="todo-item" key={t.id} data-todo-id={t.id}>
                <div
                  className={`todo-row${flashIds.includes(t.id) ? ' flash' : ''}`}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move' }}
                >
                  <span className="drag-grip" aria-hidden="true"><Icon.Grip /></span>
                  <SpaceMark space={t.space} />
                  <span className={`cat-dot ${t.category}`} aria-hidden="true" />
                  <span className="grow"><Linkify text={t.title} /></span>
                  {(t.carried ?? 0) > 0 && (
                    <span className="carried-tag mono" title={`Planned and not finished on ${t.carried} ${t.carried === 1 ? 'day' : 'days'}`}>
                      {t.carried === 1 ? 'came back' : `came back ${t.carried}x`}
                    </span>
                  )}
                  <EstimateChip task={t} />
                  {hasSubs && (
                    <button className="expand-btn" aria-expanded={isExp} aria-label={isExp ? 'Collapse subtasks' : 'Expand subtasks'} onClick={() => toggleExp(t.id)}>
                      {isExp ? '▾' : '▸'} {doneSubs}/{t.subtasks!.length}
                    </button>
                  )}
                  <TaskActions task={t} />
                  <Dropdown label={`Options for ${t.title}`}>
                    <button role="menuitem" onClick={() => setEditingTask(t)}>Edit</button>
                    <button role="menuitem" onClick={() => setBreakdownFor(t)}>Break it down</button>
                    {/* ON A TOUCH SCREEN ONLY, restored 2026-09-09. These two
                        groups were cut on 2026-09-04 because he does not reach
                        for them with a mouse -- drag does both, and the menu
                        was getting long. True on the desktop, and it stays cut
                        there. It was not true on a phone: drag needs a cursor,
                        so cutting them left a task that could be written down
                        and then never put on a day at all, which is the exact
                        complaint ("Plan doesn't work at all on mobile") the tap
                        paths were built for in the first place. */}
                    {coarse && (
                      <>
                        <span className="kebab-head">Plan for a day</span>
                        {Array.from({ length: PLAN_AHEAD_DAYS + 1 }, (_, n) => n).map((n) => (
                          <button key={n} role="menuitem" onClick={() => { moveTasksToToday([t.id], dayPlus(n)); setDayOffset(n) }}>
                            Move to {n <= 1 ? offsetWord(n).toLowerCase() : shortDay(dayPlus(n))}
                          </button>
                        ))}
                        <span className="kebab-head">Straight into today</span>
                        {SLOTS.map((sl) => (
                          <button key={sl.id} role="menuitem" onClick={() => dropTo(sl.id, t.id)}>{sl.label}</button>
                        ))}
                      </>
                    )}
                    {projectMenu(t)}
                    <span className="kebab-sep" />
                    <button role="menuitem" className="danger" onClick={() => deleteTask(t.id)}>Delete</button>
                  </Dropdown>
                </div>
                {hasSubs && isExp && (
                  <div className="subtask-list">
                    {t.subtasks!.map((s) => (
                      <SubtaskRow key={s.id} taskId={t.id} sub={s} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {backlogOpen.length === 0 && <div className="empty">Nothing waiting. Add the first task above.</div>}
        </div>

        {/* 2. The day: drag tasks from Unsorted into a time of day */}
        <div className="panel">
          <div className="col-head">
            {/* Which day this column lays out. Two days is the whole range: the
                one he is in, and the one he is about to be in. */}
            {/* Seven pills, not two. He asked (2026-08-28) to lay out a
                week ahead rather than only the day right in front of him: each
                one steps this same panel onto that day, the way Today and
                Tomorrow always did. */}
            <span className="day-switch" role="group" aria-label="Which day to plan">
              {Array.from({ length: PLAN_AHEAD_DAYS + 1 }, (_, n) => n).map((n) => (
                <button
                  key={n}
                  className={`microcap${armingDay === n ? ' is-arming' : ''}`}
                  aria-pressed={dayOffset === n}
                  onClick={() => setDayOffset(n)}
                  onDragEnter={() => armDay(n)}
                  onDragOver={(e) => e.preventDefault()}
                  onDragLeave={() => { if (armingDay === n) clearArm() }}
                >
                  {offsetWord(n)}{offsetDate(n) && <i>{offsetDate(n)}</i>}
                </button>
              ))}
            </span>
            {(() => {
              const shown = BUCKETS.filter((b) => b.id !== 'unsorted' || todayAll.some((t) => !t.slot && !t.done)).map((b) => b.id)
              const allShut = shown.length > 0 && shown.every((id) => shutSlots.has(id))
              return (
                <button
                  className="fold-all"
                  onClick={() => keepShut(allShut ? new Set() : new Set(shown))}
                >
                  {allShut ? 'Expand all' : 'Collapse all'}
                </button>
              )
            })()}
          </div>
          {BUCKETS.map((b) => {
            // A finished task is not waiting to be scheduled, so it drops out of
            // Unsorted and joins the done group at the bottom.
            const inBucket = todayAll.filter((t) => (t.slot ?? 'unsorted') === b.id && !(b.id === 'unsorted' && t.done))
            // Dayless routines get their own group above; they are not tasks
            // waiting to be dragged into a time.
            const mine = b.id === 'unsorted' ? [] : dueRoutines.filter((r) => routineSlot(r) === b.id)
            if (b.id === 'unsorted' && inBucket.length === 0) return null
            /* One ordered list: what is still to do first, his own work ahead of
               the repeats, and everything finished sunk to the bottom. A ticked
               task sitting between two open ones is the list telling him he has
               work above AND below something already handled. */
            const rDone = (r: Routine) => routineComplete(r, periodKeyFor(r.cadence))
            const items = [
              ...inBucket.filter((x) => !x.done).map((task) => ({ kind: 'task' as const, task })),
              ...mine.filter((r) => !rDone(r)).map((routine) => ({ kind: 'repeat' as const, routine })),
              ...inBucket.filter((x) => x.done).map((task) => ({ kind: 'task' as const, task })),
              ...mine.filter(rDone).map((routine) => ({ kind: 'repeat' as const, routine })),
            ]
            const tot = inBucket.filter((t) => !t.done).reduce((a, t) => a + taskMinutes(t), 0)
            /* Unsorted is not a part of the day and has no hours to run out of. */
            const cap = b.id === 'unsorted' ? 0 : slotMinutes(b.id as TimeSlot)
            const over = cap > 0 ? tot - cap : 0
            const shut = shutSlots.has(b.id)
            const left = inBucket.filter((x) => !x.done).length + mine.filter((r) => !rDone(r)).length
            return (
              <div
                className={`bucket drop-zone${dropKey === b.id ? ' drop-over' : ''}${shut ? ' is-shut' : ''}`}
                key={b.id}
                /* A task cannot be dropped into a part of the day he cannot see,
                   so hovering one open is the only honest thing to do. */
                onDragOver={(e) => { e.preventDefault(); setDropKey(b.id); if (shut) setShut(b.id, false) }}
                onDragLeave={() => setDropKey((k) => (k === b.id ? null : k))}
                onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) dropTo(b.id, id); setDropKey(null) }}
              >
                <button
                  className="bucket-head"
                  aria-expanded={!shut}
                  aria-label={`${b.label}, ${shut ? 'expand' : 'collapse'}`}
                  onClick={() => setShut(b.id, !shut)}
                >
                  <span className="fold-caret" aria-hidden="true" />
                  <span className="bucket-name">{b.label}</span>
                  {BUCKET_HINT[b.id] && <span className="bucket-hours mono">{BUCKET_HINT[b.id]}</span>}
                  {/* Shut, the rows are gone and the count is the only thing left
                      saying whether there is anything in there. */}
                  {shut && left > 0 && <span className="bucket-left mono">{left} left</span>}
                  {/* What is planned against what the window actually holds, for
                      THIS workspace only. Four hours of work in a two hour
                      window is not ambition, it is a day that was over before it
                      started, and the app knew both numbers all along. */}
                  {tot > 0 && (over > 0
                    ? (
                      <span className="tot mono is-over" title={`${fmtDuration(tot)} planned, ${fmtDuration(cap)} in this part of the day`}>
                        {fmtDuration(tot)} of {fmtDuration(cap)}
                        <b>{fmtDuration(over)} over</b>
                      </span>
                    )
                    : <span className="tot mono">{fmtDuration(tot)}</span>)}
                </button>
                {shut ? null : items.length === 0 ? (
                  <p className="empty is-boxed">Drop a task here.</p>
                ) : (
                  items.map((it) => {
                    if (it.kind === 'repeat') {
                      const r = it.routine
                      return <RoutineOnDay key={r.id} routine={r} day={planDay} />
                    }
                    const t = it.task
                    const isExp = expanded.has(t.id)
                    const hasSubs = !!t.subtasks?.length
                    const doneSubs = t.subtasks?.filter((s) => s.done).length ?? 0
                    return (
                      <div className="today-item" key={t.id} data-task-id={t.id}>
                        <div
                          className={`today-task${t.done ? ' done' : ''}${flashId === t.id ? ' flash' : ''}`}
                          draggable={!t.done}
                          onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move' }}
                        >
                          <span className="drag-grip" aria-hidden="true"><Icon.Grip /></span>
                          <SpaceMark space={t.space} />
                          <button
                            className="checkbox" role="checkbox" aria-checked={t.done}
                            aria-label={t.done ? `Reopen: ${t.title}` : `Complete: ${t.title}`}
                            onClick={() => {
                              if (t.done) { toggleTask(t.id); return }  // reopen
                              // Subtasked or flat, it asks how long it took; ticking the
                              // parent ticks the steps inside it either way.
                              setLogging(t.id)
                            }}
                          >
                            <Icon.Check size={12} strokeWidth={4} />
                          </button>
                          <span className={`cat-dot ${t.category}`} aria-hidden="true" />
                          <span className="grow wrap2"><Linkify text={t.title} /></span>
                          {t.done && t.actualMin != null ? (
                            <span className="est-vs-actual mono">{fmtDuration(taskMinutes(t))} → {fmtDuration(t.actualMin)} <b className={taskMinutes(t) - t.actualMin >= 0 ? 'val-pos' : 'val-urgent'}>{taskMinutes(t) - t.actualMin >= 0 ? '+' : ''}{taskMinutes(t) - t.actualMin}m</b></span>
                          ) : (
                            <EstimateChip task={t} />
                          )}
                          {hasSubs && (
                            <button className="expand-btn" aria-expanded={isExp} aria-label={isExp ? 'Collapse subtasks' : 'Expand subtasks'} onClick={() => toggleExp(t.id)}>
                              {isExp ? '▾' : '▸'} {doneSubs}/{t.subtasks!.length}
                            </button>
                          )}
                          {!t.done && <TaskActions task={t} onFocus={() => startFocus(taskMinutes(t), t.title)} />}
                          <Dropdown label={`Options for ${t.title}`}>
                            {!t.done && <button role="menuitem" onClick={() => setBreakdownFor(t)}>Break it down</button>}
                            {!t.done && <span className="kebab-sep" />}
                            {!t.done && <span className="kebab-head">Move to</span>}
                            {!t.done && BUCKETS.map((mb) => (
                              <button key={mb.id} role="menuitemradio" aria-checked={(t.slot ?? 'unsorted') === mb.id} onClick={() => dropTo(mb.id, t.id)}>
                                {mb.label}
                              </button>
                            ))}
                            {!t.done && <span className="kebab-sep" />}
                            {/* Dragging onto the day is the fast way; on a phone
                                there is no drag, so the time can be typed. */}
                            {!t.done && <span className="kebab-head">At a time</span>}
                            {!t.done && (
                              <div className="kebab-timerow">
                                <input
                                  type="time" className="textinput" value={t.at ?? ''} step={900}
                                  aria-label={`Clock time for ${t.title}`}
                                  onChange={(e) => setTaskAt(t.id, e.target.value || undefined)}
                                />
                                {t.at && (
                                  <button className="linkish" onClick={() => setTaskAt(t.id, undefined)}>Clear</button>
                                )}
                              </div>
                            )}
                            {!t.done && <span className="kebab-sep" />}
                            {!t.done && (
                              <>
                                {/* Moving a task between times used to be drag
                                    only, and drag does not work with a thumb.
                                    That is most of why he said Plan "doesn't
                                    work at all" on a phone: he could get a
                                    task onto the day from the list, then never
                                    move it again. */}
                                <span className="kebab-head">Move to</span>
                                {SLOTS.filter((sl) => sl.id !== (t.slot ?? 'unsorted')).map((sl) => (
                                  <button key={sl.id} role="menuitem" onClick={() => assignSlot(t.id, sl.id)}>{sl.label}</button>
                                ))}
                                <span className="kebab-sep" />
                                <button role="menuitem" onClick={() => setEditingTask(t)}>Edit</button>
                                <button role="menuitem" onClick={() => { moveTaskList(t.id, 'backlog'); assignSlot(t.id, undefined); setTaskAt(t.id, undefined) }}>Back to the list</button>
                              </>
                            )}
                            {!t.done && projectMenu(t)}
                            <button role="menuitem" className="danger" onClick={() => deleteTask(t.id)}>Delete</button>
                          </Dropdown>
                        </div>
                        {logging === t.id && (
                          <ActualLog est={taskMinutes(t)} tracked={trackedFor(t.title)} onLog={(m) => { logActual(t.id, m); setLogging(null) }} onSkip={() => { toggleTask(t.id); setLogging(null) }} />
                        )}
                        {hasSubs && isExp && (
                          <div className="subtask-list">
                            {t.subtasks!.map((s) => (
                              <div key={s.id} className="subtask-wrap">
                                <button
                                  className={`subtask${s.done ? ' done' : ''}`}
                                  onClick={() => { if (s.done) toggleSubtask(t.id, s.id); else setLogging(`sub|${t.id}|${s.id}`) }}
                                >
                                  <span className="sub-tick" aria-hidden="true" />
                                  <span className="grow">{s.title}</span>
                                  {s.done && s.actualMin != null ? (
                                    <span className="est-vs-actual mono">{fmtDuration(s.estimateMin)} → {fmtDuration(s.actualMin)} <b className={s.estimateMin - s.actualMin >= 0 ? 'val-pos' : 'val-urgent'}>{s.estimateMin - s.actualMin >= 0 ? '+' : ''}{s.estimateMin - s.actualMin}m</b></span>
                                  ) : (
                                    <span className="chip tone-info">{fmtDuration(s.estimateMin)}</span>
                                  )}
                                </button>
                                {!s.done && (
                                  <button
                                    className="task-act task-focus sub-focus"
                                    aria-label={`Focus on ${s.title} for ${s.estimateMin} minutes`}
                                    title={`Focus ${s.estimateMin}m on this step`}
                                    onClick={() => startFocus(s.estimateMin, s.title)}
                                  >
                                    <Icon.Play size={17} />
                                  </button>
                                )}
                                {/* The same tools the list gives a step. A step
                                    could only be corrected before he planned it,
                                    so the day he actually works from was the one
                                    place a wrong number was stuck. */}
                                {!s.done && <SubEdit taskId={t.id} sub={s} />}
                                {logging === `sub|${t.id}|${s.id}` && (
                                  <ActualLog est={s.estimateMin} tracked={trackedFor(s.title)} onLog={(m) => { logSubtaskActual(t.id, s.id, m); setLogging(null) }} onSkip={() => { toggleSubtask(t.id, s.id); setLogging(null) }} />
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            )
          })}
          {/* No dayless group any more: a routine on the day has been started,
              and the moment it started is a real time, so it always has a slot. */}
          {/* Finished-but-unscheduled work, kept visible without asking to be planned. */}
          {doneUnsorted.length > 0 && (
            <div className="done-group">
              <div className="bucket-head">
                <span className="bucket-name">Done today</span>
                <span className="tot mono">{doneUnsorted.length}</span>
              </div>
              {doneUnsorted.map((t) => (
                <div className="today-task done" key={t.id} data-task-id={t.id}>
                  <button className="checkbox" role="checkbox" aria-checked aria-label={`Reopen: ${t.title}`} onClick={() => toggleTask(t.id)}>
                    <Icon.Check size={12} strokeWidth={4} />
                  </button>
                  <span className={`cat-dot ${t.category}`} aria-hidden="true" />
                  <span className="grow">{t.title}</span>
                  {t.actualMin != null
                    ? <span className="est-vs-actual mono">{fmtDuration(taskMinutes(t))} → {fmtDuration(t.actualMin)}</span>
                    : isEstimated(t)
                      ? <span className="chip tone-info">{fmtDuration(taskMinutes(t))}</span>
                      : <span className="chip tone-info is-none">no estimate</span>}
                </div>
              ))}
            </div>
          )}
          {todayAll.length === 0 && (
            <p className="col-note">
              <span className="hide-touch">Drag anything from the list into a time of day. Drag it back to take it off today.</span>
              <span className="only-touch">Use a task's ⋯ menu to put it into a time of day, or send it back to the list.</span>
            </p>
          )}
        </div>
      </div>


      {breakdownFor && <BreakdownSheet task={breakdownFor} onClose={() => setBreakdownFor(null)} />}
      {editingTask && <EditTaskSheet task={editingTask} onClose={() => setEditingTask(null)} />}

    </div>
  )
}

/* ---------------- PROJECTS ----------------
   A directory, not a filter. Every card here is a door into Plan, pre-scoped
   to one project on the way in; Plan itself does the filtering (see
   `openProjectId` in PlanPage above), so this page owns no task data of its
   own. Today, Calendar, Habits, and Goals never find out a project exists. */

