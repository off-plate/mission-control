import { daysSince } from './health'
/* THE PLAN PAGE. Split out of pages1.tsx (2026-09-09). Carries the task-row
   pieces (SubEdit, SubtaskRow, EditTaskSheet, ActualLog, EstimateChip,
   TaskActions) and the day-switcher/bucket helpers (prevDay, longDay,
   offsetWord, offsetDate, BUCKETS, BUCKET_HINT) that used to sit textually
   near Today's own code in the old file but are only ever used here --
   confirmed by grep before moving them, not assumed. ActualLog stays
   exported: assistantdock.tsx and assistantpage.tsx both import it. */
import * as Icon from './icons'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SPACE_LABELS } from './exceptions'
import { fakeDecompose } from './mock'
import { useStore } from './store'
import { usePomodoro } from './pomodoro'
import { BreakdownSheet, Sheet } from './modals'
import { WeekGoals, useWeekGoals } from './weekgoals'
import { Linkify } from './widgets'
import { PLAN_AHEAD_DAYS, WeekGrid, dayPlus, shortDay, weekRangeLabel } from './weekgrid'
import { useCoarsePointer, usePhone, Band, WorkspaceTitle, Dropdown, SpaceMark, TagMark } from './ui'
import { TaskSheet } from './tasksheet'
import { TagField } from './tagfield'
import { matchProjects, tagOf, takeTag } from './tags'
import { SLOTS, SPACES, UNSORTED, habitLocked, routineComplete, routineProgress, slotMinutes, TYPING_TARGET_WPM, type Project, type Routine, type SubTask, type Task, type TimeSlot } from './types'
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

/* Estimating is automatic (store.tsx), so the only action left on a task row is
   starting a focus block. */
function TaskActions({ task, onFocus }: { task: Task; onFocus?: () => void }) {
  if (!onFocus) return null
  return (
    <span className="task-actions">
      <button
        className="task-act task-focus"
        disabled={!isEstimated(task)}
        aria-label={isEstimated(task) ? `Focus on ${task.title} for ${taskMinutes(task)} minutes` : `Estimating ${task.title}`}
        title={isEstimated(task) ? `Focus ${taskMinutes(task)}m on this` : 'Estimating...'}
        onClick={onFocus}
      >
        <Icon.Play size={18} />
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
        <SpaceMark space={routine.space} />
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

/* The strip itself. Folder glyph, name, open-task count: the same facts a
   project card on the Projects page carries, in one row. Plain click selects
   that one project (click it again to clear); shift/cmd/ctrl-click adds or
   removes; on touch there is no modifier, so a tap toggles. */
/* Spotlight-style search (his ask, 2026-10-11): a centred box over the page,
   type, arrow to a task, Enter or click to jump to its project with the row
   highlighted (jumpTo, unchanged). Every task, every workspace. */
function Spotlight({ q, setQ, matches, projects, onPick, onClose }: {
  q: string; setQ: (v: string) => void; matches: Task[]; projects: Project[]
  onPick: (t: Task) => void; onClose: () => void
}) {
  const [hi, setHi] = useState(0)
  useEffect(() => setHi(0), [q])
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  return (
    <div className="spot-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="spot" role="dialog" aria-label="Search every task">
        <div className="spot-field">
          <Icon.Search size={18} />
          <input
            ref={ref} value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search every task, every workspace"
            aria-label="Search every task"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              else if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, matches.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)) }
              else if (e.key === 'Enter' && matches[hi]) onPick(matches[hi])
            }}
          />
          <kbd>Esc</kbd>
        </div>
        {q.trim() && (
          <ul className="spot-results" role="listbox">
            {matches.length === 0 && <li className="empty">Nothing matches.</li>}
            {matches.map((t, i) => {
              const proj = t.projectId ? projects.find((p) => p.id === t.projectId) : undefined
              return (
                <li key={t.id}>
                  <button className={`plan-search-hit${i === hi ? ' is-hi' : ''}`} onMouseEnter={() => setHi(i)} onClick={() => onPick(t)}>
                    <SpaceMark space={t.space} always />
                    <span className="plan-search-hit-title"><Linkify text={t.title} /> <TagMark project={proj} /></span>
                    <span className="plan-search-hit-where mono">{proj ? proj.name : t.list === 'today' ? "today's plan" : 'backlog'}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

/* The Projects page folder, shrunk to a glyph: back with its tab, one sheet
   peeking out, the front flap in the workspace colour. Same colour recipe as
   .folder, so a project looks like itself in both places. */
function FolderGlyph({ cls }: { cls: string }) {
  return (
    <span className={`fg ${cls}`} aria-hidden="true">
      <i className="fg-back" /><i className="fg-paper" /><i className="fg-front" />
    </span>
  )
}

function ProjectStrip({ projects, tasks, sel, showSpaces, touch, inScope, onAll, onPick, onManage }: {
  projects: Project[]; tasks: Task[]; sel: string[]; showSpaces: boolean; touch: boolean; inScope: (t: Task) => boolean
  onAll: () => void; onPick: (id: string, add: boolean) => void; onManage: () => void
}) {
  const open = (id: string) => tasks.filter((t) => t.projectId === id && !t.done).length
  const total = projects.reduce((a, p) => a + open(p.id), 0)
  let lastSpace = ''
  return (
    <div className="pstrip" role="group" aria-label="Filter Plan by project">
      <button className={`pstrip-item${sel.length === 0 ? ' is-on' : ''}`} aria-pressed={sel.length === 0} onClick={onAll}>
        <Icon.List size={15} /><span>All</span><em className="mono">{total}</em>
      </button>
      {projects.map((p) => {
        const head = showSpaces && p.space !== lastSpace
        lastSpace = p.space
        const on = sel.includes(p.id)
        return (
          <span className="pstrip-cell" key={p.id}>
            {head && <SpaceMark space={p.space} always />}
            <button
              className={`pstrip-item${on ? ' is-on' : ''}`} aria-pressed={on}
              onClick={(e) => onPick(p.id, touch || e.shiftKey || e.metaKey || e.ctrlKey)}
            >
              <FolderGlyph cls={`s-${p.space}`} /><span>{p.name}</span><em className="mono">{open(p.id)}</em>
            </button>
          </span>
        )
      })}
      <button className={`pstrip-item${sel.includes(UNSORTED) ? ' is-on' : ''}`} aria-pressed={sel.includes(UNSORTED)} onClick={(e) => onPick(UNSORTED, touch || e.shiftKey || e.metaKey || e.ctrlKey)}>
        <FolderGlyph cls="f-unsorted" /><span>Unsorted</span><em className="mono">{tasks.filter((t) => !t.projectId && !t.done && inScope(t)).length}</em>
      </button>
      <button className="pstrip-item pstrip-manage" onClick={onManage} aria-label="Manage projects"><Icon.FolderAdd size={15} /></button>
    </div>
  )
}

/* The phone's version of the strip above: one folder icon beside Yesterday that
   opens the same choices as a menu (his ask, 2026-10-16). A dot says a filter is
   on. Picks add and remove, like a tap on the strip does on touch. */
function PhoneProjectFilter({ projects, tasks, sel, inScope, onAll, onPick, onManage }: {
  projects: Project[]; tasks: Task[]; sel: string[]; inScope: (t: Task) => boolean
  onAll: () => void; onPick: (id: string, add: boolean) => void; onManage: () => void
}) {
  const open = (id: string) => tasks.filter((t) => t.projectId === id && !t.done).length
  const total = projects.reduce((a, p) => a + open(p.id), 0)
  return (
    <Dropdown
      label="Filter Plan by project" className="phone-only"
      /* The folder goes straight to the Projects page (his ask, 2026-10-26),
         not to a dropdown of them; the strip above still filters. */
      trigger={() => (
        <button className="btn btn-ghost plan-proj-btn" aria-label="Open Projects" onClick={onManage}>
          <Icon.Folder size={20} />{sel.length > 0 && <span className="plan-proj-dot" aria-hidden="true" />}
        </button>
      )}
    >
      <button role="menuitem" aria-checked={sel.length === 0} onClick={onAll}>All <em className="mono plan-proj-n">{total}</em></button>
      {projects.map((p) => (
        <button key={p.id} role="menuitem" aria-checked={sel.includes(p.id)} onClick={() => onPick(p.id, true)}>
          <FolderGlyph cls={`s-${p.space}`} /><span>{p.name}</span><em className="mono plan-proj-n">{open(p.id)}</em>
        </button>
      ))}
      <button role="menuitem" aria-checked={sel.includes(UNSORTED)} onClick={() => onPick(UNSORTED, true)}>
        <FolderGlyph cls="f-unsorted" /><span>Unsorted</span><em className="mono plan-proj-n">{tasks.filter((t) => !t.projectId && !t.done && inScope(t)).length}</em>
      </button>
      <span className="kebab-sep" />
      <button role="menuitem" onClick={onManage}>Manage projects</button>
    </Dropdown>
  )
}

/* Desktop's project filter: one button where the strip of folders used to be.
   Same choices as the phone's menu, but the button itself opens the menu. */
function ProjectFilter({ projects, tasks, sel, inScope, onAll, onPick, onManage }: {
  projects: Project[]; tasks: Task[]; sel: string[]; inScope: (t: Task) => boolean
  onAll: () => void; onPick: (id: string, add: boolean) => void; onManage: () => void
}) {
  const open = (id: string) => tasks.filter((t) => t.projectId === id && !t.done).length
  const label = sel.length === 0 ? 'All projects'
    : sel.length === 1 ? (sel[0] === UNSORTED ? 'Unsorted' : projects.find((p) => p.id === sel[0])?.name ?? 'Project')
    : `${sel.length} projects`
  return (
    <Dropdown
      label="Filter Plan by project" className="hide-phone"
      trigger={({ onClick, open: isOpen }) => (
        <button className="btn btn-ghost pf-proj" onClick={onClick} aria-expanded={isOpen}>
          {label} <Icon.ChevronDown size={14} />
        </button>
      )}
    >
      <button role="menuitem" aria-checked={sel.length === 0} onClick={onAll}>All projects <em className="mono plan-proj-n">{tasks.filter((t) => !t.done && inScope(t)).length}</em></button>
      {projects.map((p) => (
        <button key={p.id} role="menuitem" aria-checked={sel.includes(p.id)} onClick={(e) => onPick(p.id, e.shiftKey || e.metaKey || e.ctrlKey)}>
          <FolderGlyph cls={`s-${p.space}`} /><span>{p.name}</span><em className="mono plan-proj-n">{open(p.id)}</em>
        </button>
      ))}
      <button role="menuitem" aria-checked={sel.includes(UNSORTED)} onClick={(e) => onPick(UNSORTED, e.shiftKey || e.metaKey || e.ctrlKey)}>
        <FolderGlyph cls="f-unsorted" /><span>Unsorted</span><em className="mono plan-proj-n">{tasks.filter((t) => !t.projectId && !t.done && inScope(t)).length}</em>
      </button>
      <span className="kebab-sep" />
      <button role="menuitem" onClick={onManage}>Manage projects</button>
    </Dropdown>
  )
}

/** What a day of focus is measured against on the Today ring: an hour and a
 *  half, the figure in the version he picked (2026-11-02). */
const FOCUS_DAY_MIN = 90

function Ring({ v, size, cls }: { v: number; size: number; cls: string }) {
  const r = size / 2 - 5
  const c = 2 * Math.PI * r
  return (
    <svg className={`pf-ringsvg ${cls}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} className="pf-ring-track" />
      <circle cx={size / 2} cy={size / 2} r={r} className="pf-ring-fill"
        strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, v)))}
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  )
}

/* The phone shows one list at a time (his ask, 2026-10-15). The tab bar's +
   fires mc:new-task, which lands on Plan's new-task box, and that box lives in
   the to-do list, so the next Plan render opens on it. Registered at import,
   ahead of the shell's own listener, so it is set before Plan mounts. */
let openTodoNext = false
if (typeof window !== 'undefined') window.addEventListener('mc:new-task', () => { openTodoNext = true })

export function PlanPage() {
  const todayIdx = (new Date().getDay() + 6) % 7
  const pomo = usePomodoro()
  const { startFocus } = pomo
  const { routines, habits, openDaily } = useStore()
  const { space, tasks, toggleTask, logActual, assignSlot, toggleSubtask, logSubtaskActual, moveTasksToToday, moveTaskList, deleteTask, addTask, addTaskWithSubtasks, focusTaskId, setFocusTaskId, setTaskAt, plan, setPage, openDay, view, inView, focusSessions, dayLog } = useStore()
  const { projects, openProjectId, setTaskProject, setTaskSpace, setSpace, setView, enterProject } = useStore()
  /* A project is a room inside a Space, not a second store: this is the one
     line that scopes Plan to it. Everything below (backlog, the day, the
     progress bar) is derived from spaceTasks, so nothing downstream has to
     know a project was ever involved. */
  /* THE PROJECT STRIP (2026-10-11). Plan used to be scoped by one openProjectId,
     reached through a hover menu or the Projects page, so seeing two projects
     together was impossible and one was often four clicks away. The strip under
     the search bar makes every project in the workspace one click, several at
     once with shift/cmd (or a plain tap on touch), and remembers the choice.
     openProjectId is still the door from elsewhere (search hits, the nav
     menu): when it is set, it becomes the selection. */
  const PICK_KEY = 'mc:plan-projects'
  const [picked, setPicked] = useState<string[]>(() => {
    try { const v = JSON.parse(localStorage.getItem(PICK_KEY) ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
  })
  useEffect(() => { if (openProjectId) setPicked([openProjectId]) }, [openProjectId])
  useEffect(() => { try { localStorage.setItem(PICK_KEY, JSON.stringify(picked)) } catch { /* private mode */ } }, [picked])
  /* Grouped by workspace in the switcher's order, whatever order they were
     created in, so each workspace's marker appears once. */
  const stripProjects = (view === 'all' ? projects : projects.filter((p) => p.space === view))
    .map((p, i) => ({ p, i }))
    .sort((a, b) => SPACES.indexOf(a.p.space) - SPACES.indexOf(b.p.space) || a.i - b.i)
    .map((x) => x.p)
  const sel = picked.filter((id) => id === UNSORTED || stripProjects.some((p) => p.id === id))
  const activeProject = sel.length !== 1 ? null
    : sel[0] === UNSORTED ? { id: UNSORTED, name: 'Unsorted', space }
    : projects.find((p) => p.id === sel[0]) ?? null
  /* New tasks typed inside the Unsorted folder stay project-less. */
  const newProjectId = activeProject && activeProject.id !== UNSORTED ? activeProject.id : undefined
  const addSpace = activeProject ? activeProject.space : space
  /* Only outside a project's own room: standing inside it already says which
     project every task on screen belongs to, so the mark would be repeating
     the room he is already standing in. */
  /* Always drawn now (2026-10-25): the hashtag IS how a task says where it
     lives, and a tap on it narrows the list to that project. */
  /* On the phone a title is one line with an ellipsis, three or four words of
     it (his report, 2026-10-26). A tap on the words opens that one task's full
     title, a second tap folds it again. A link inside the title still opens. */
  const [openTitles, setOpenTitles] = useState<Set<string>>(() => new Set())
  /** The task whose sheet is open on the phone. */
  const [sheetId, setSheetId] = useState<string | null>(null)
  const toggleTitle = (e: React.MouseEvent, id: string) => {
    if ((e.target as HTMLElement).closest('a, button')) return
    /* On the phone a tap on a task opens its menu as a sheet instead (his ask,
       2026-10-26): the kebab was too small to hit, and the sheet shows the
       whole title, so the fold-open is no longer needed there. */
    if (phone) { setSheetId(id); return }
    setOpenTitles((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  const markOf = (t: Task) => (t.projectId ? projects.find((p) => p.id === t.projectId) : undefined)
  const pickTag = (p: Project) => setPicked((prev) => (prev.length === 1 && prev[0] === p.id ? [] : [p.id]))
  /* Offered in the add box: this workspace's projects first, then the rest,
     because a hashtag can file a task anywhere. */
  const tagChoices = view === 'all' ? stripProjects : [...stripProjects, ...projects.filter((p) => p.space !== view)]
  const submitQuick = () => {
    const got = takeTag(quick, projects)
    if (!got.title) return
    const proj = got.project ?? (newProjectId ? projects.find((p) => p.id === newProjectId) : undefined)
    addTask({ title: got.title, source: 'mc', estimateMin: 0, space: proj?.space ?? addSpace, list: 'backlog', category: 'quick', projectId: proj?.id })
    /* Filed somewhere the list is not showing: widen the filter to it, so the
       task he just wrote does not vanish the moment he presses Enter. */
    if (got.project && sel.length && !sel.includes(got.project.id)) setPicked((prev) => [...prev, got.project!.id])
    setQuick('')
  }

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

  /* His ask (2026-09-12): move a task across workspaces from its own
     kebab menu, the same one tap the project move above already gets.
     "Workspace," not "Move to" -- both menus that render this already
     have their own "Move to" heading (a time slot, or a day), and a third
     one with the same words but a different meaning is exactly the kind
     of menu he flagged as confusing right before asking for this. */
  const spaceMenu = (t: Task) => (
    <>
      <span className="kebab-sep" />
      <span className="kebab-head">Workspace</span>
      {SPACES.filter((s) => s !== t.space).map((s) => (
        <button key={s} role="menuitem" onClick={() => setTaskSpace(t.id, s)}>Move to {SPACE_LABELS[s]}</button>
      ))}
    </>
  )

  const spaceTasks = tasks.filter((t) => inView(t.space) && (sel.length === 0 || (t.projectId ? sel.includes(t.projectId) : sel.includes(UNSORTED))))
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
  /* His ask (2026-09-30): a small sort menu on the list instead of the
     "111 waiting" count (that moved up beside the day's numbers). Newest stays
     the default, exactly the order above. Most postponed is the carried
     counter, oldest first within a tie; longest and shortest are the estimate,
     and a task with no estimate counts as zero. */
  const SORTS = [
    { id: 'newest', label: 'Newest' },
    { id: 'oldest', label: 'Oldest' },
    { id: 'postponed', label: 'Most postponed' },
    { id: 'longest', label: 'Longest' },
    { id: 'shortest', label: 'Shortest' },
  ] as const
  type SortId = typeof SORTS[number]['id']
  const [sortBy, setSortBy] = useState<SortId>(() => {
    try { const v = localStorage.getItem('mc:todo-sort'); return SORTS.some((x) => x.id === v) ? (v as SortId) : 'newest' } catch { return 'newest' }
  })
  const pickSort = (id: SortId) => {
    setSortBy(id)
    try { localStorage.setItem('mc:todo-sort', id) } catch { /* private mode */ }
  }
  const byNewest = (a: Task, b: Task) => (b.addedAt ?? 0) - (a.addedAt ?? 0)
  const backlogSorted = [...backlogOpen].sort(
    sortBy === 'oldest' ? (a, b) => -byNewest(a, b)
    : sortBy === 'postponed' ? (a, b) => (b.carried ?? 0) - (a.carried ?? 0) || -byNewest(a, b)
    : sortBy === 'longest' ? (a, b) => taskMinutes(b) - taskMinutes(a) || byNewest(a, b)
    : sortBy === 'shortest' ? (a, b) => taskMinutes(a) - taskMinutes(b) || byNewest(a, b)
    : byNewest,
  )
  const backlogMins = backlogOpen.reduce((a, t) => a + taskMinutes(t), 0)
  /* Which day the right hand column is laying out. This used to be a single
     step, today or tomorrow, on the argument that Sunday evening is exactly
     when a week gets planned and Monday could not be touched until Monday. He
     asked for the rest of the week the same way (2026-08-28): PLAN_AHEAD_DAYS
     more days he can step onto and lay out, one at a time, the same panel he
     already knows. offset 0 is today, 1 is tomorrow, up to 6 days out. */
  const [dayOffset, setDayOffset] = useState(0)
  /* Read in the initialiser, cleared after mount: an initialiser can run twice
     (StrictMode), and clearing there let the second run land on the day list. */
  const [phoneList, setPhoneList] = useState<'todo' | 'day'>(() => (openTodoNext || (window as Window & { __mcNewTask?: boolean }).__mcNewTask ? 'todo' : 'day'))
  useEffect(() => { openTodoNext = false; (window as Window & { __mcNewTask?: boolean }).__mcNewTask = false }, [])
  useEffect(() => {
    const on = () => { openTodoNext = false; (window as Window & { __mcNewTask?: boolean }).__mcNewTask = false; setPhoneList('todo') }
    window.addEventListener('mc:new-task', on)
    return () => window.removeEventListener('mc:new-task', on)
  }, [])
  const coarse = useCoarsePointer()
  const phone = usePhone()
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
  /* Every task, every workspace, every project -- the current view's own
     filters (space, project, day) exist to keep the working list small, and
     that is exactly what makes a task hard to find again once he can't
     remember which of those rooms he left it in. Search is the one place in
     Plan that reads `tasks` unfiltered on purpose. */
  const [search, setSearch] = useState('')
  const searchMatches = (() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    /* His report (2026-09-16): a finished task showed up here as if it were
       still waiting somewhere. Search exists to find something he still has
       to act on -- a task he already finished isn't lost, it's done, and
       belongs in the record, not in a search for where he left something. */
    /* "#off" finds what is filed under a project, the same matching the add
       box uses, so a tag is also the fastest way back to everything in it. */
    if (q.startsWith('#')) {
      const ids = new Set(matchProjects(q.slice(1), projects).map((p) => p.id))
      return tasks.filter((t) => !t.done && t.projectId && ids.has(t.projectId)).slice(0, 8)
    }
    return tasks.filter((t) => !t.done && t.title.toLowerCase().includes(q)).slice(0, 8)
  })()
  const [spot, setSpot] = useState(false)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSpot(true) } }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  const jumpTo = (t: Task) => {
    const proj = t.projectId ? projects.find((p) => p.id === t.projectId) : undefined
    /* The strip may be filtered to something that hides this task, so the
       selection moves to where the task lives, not just the view. */
    if (proj) { setSpace(proj.space); enterProject(proj.id); setPicked([proj.id]) } else { setView(t.space); setPicked([]) }
    setFocusTaskId(t.id)
    setSearch('')
  }
  /* Dismissing the "came back overnight" banner without resolving anything --
     keyed to the date it was shown, in localStorage so a reload the same day
     doesn't bring it right back. */
  const [handoffDismissed, setHandoffDismissed] = useState(() => localStorage.getItem('mc-handoff-dismissed') === localDateKey())
  const dismissHandoff = (returnedOn: string | undefined) => {
    if (!returnedOn) return
    try { localStorage.setItem('mc-handoff-dismissed', returnedOn) } catch { /* private mode */ }
    setHandoffDismissed(true)
  }
  const [listDropOver, setListDropOver] = useState(false)
  const [quick, setQuick] = useState('')
  const [breakdownFor, setBreakdownFor] = useState<Task | null>(null)
  const sheetTask = sheetId ? tasks.find((x) => x.id === sheetId) ?? null : null
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

  /* Today's "Start" hands the task over here, and now the search box does too
     (below): flash it so the eye lands on it, wherever it actually lives --
     Today and the backlog mark "here it is" with two different classes on
     two different rows, so both fire rather than guessing which one a given
     task is in. */
  /* Make the task reachable, wait for its row to exist, scroll, THEN flash.
     The old version looked for the row in the same tick the jump started, so
     it found nothing whenever the jump also changed the filter or the page
     (the row did not exist yet), and it flashed before the scroll finished.
     It also could not reach a task planned for another day or sitting inside
     a folded part of the day. */
  const flashTimers = useRef<number[]>([])
  useEffect(() => {
    if (!focusTaskId) return
    const id = focusTaskId
    setFocusTaskId(null)
    flashTimers.current.forEach((x) => window.clearTimeout(x))
    flashTimers.current = []
    const t = tasks.find((x) => x.id === id)
    if (t) {
      if (sel.length && !(t.projectId ? sel.includes(t.projectId) : sel.includes(UNSORTED))) setPicked([])
      if (t.list === 'today' && !t.done) {
        const n = Array.from({ length: PLAN_AHEAD_DAYS + 1 }, (_, i) => i).find((i) => dayPlus(i) === (t.plannedOn ?? localDateKey()))
        if (n !== undefined) setDayOffset(n)
        const slot = t.slot ?? 'unsorted'
        if (shutSlots.has(slot)) setShut(slot, false)
      }
    }
    let tries = 0
    const find = () => {
      const el = document.querySelector(`[data-task-id="${id}"], [data-todo-id="${id}"]`)
      if (!el) {
        if (++tries < 40) flashTimers.current.push(window.setTimeout(find, 50))
        return
      }
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      flashTimers.current.push(window.setTimeout(() => { setFlashId(id); setFlashIds([id]) }, 350))
      flashTimers.current.push(window.setTimeout(() => { setFlashId(null); setFlashIds([]) }, 3000))
    }
    flashTimers.current.push(window.setTimeout(find, 60))
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

  /* ---------------- TODAY FOCUS (2026-11-02) ----------------
     He picked this shape from three working versions: one task in front of
     him, the week's goals on the left with today's share of each, the to-do
     pool on the right. What came out with it: the three header numbers, the
     project strip, the black week bar (the Today page keeps the week), and the
     four time-of-day boxes, which are now a label on the row he can click. */
  const { goals, setTaskGoal } = useStore()
  const { rows: goalRows } = useWeekGoals()
  const goalOf = (t: Task) => (t.goalId ? goals.find((g) => g.id === t.goalId) : undefined)
  const goalTag = (t: Task) => {
    const g = goalOf(t)
    return g ? <span className="goal-tag mono" title={`Finishing this adds ${t.goalAmt ?? 1} to ${g.name}`}>{g.name} +{t.goalAmt ?? 1}</span> : null
  }
  /* "Send first 10 cold emails" counts as 10. A title with no number counts as one. */
  const amtFrom = (title: string) => { const m = title.match(/\d+/); return m ? Math.max(1, Math.min(1000, Number(m[0]))) : 1 }
  const goalMenu = (t: Task) => (goalRows.length === 0 ? null : (
    <>
      <span className="kebab-sep" />
      <span className="kebab-head">Counts toward</span>
      {goalRows.map(({ goal: g }) => (
        <button key={g.id} role="menuitem" aria-checked={t.goalId === g.id}
          onClick={() => setTaskGoal(t.id, t.goalId === g.id ? undefined : g.id, amtFrom(t.title))}>
          {t.goalId === g.id ? `Stop counting toward ${g.name}` : `${g.name} +${amtFrom(t.title)}`}
        </button>
      ))}
    </>
  ))
  const SLOT_CYCLE: (TimeSlot | undefined)[] = [...SLOTS.map((s) => s.id), undefined]
  const slotLabel = (s?: TimeSlot) => (s ? SLOTS.find((x) => x.id === s)!.label : 'Anytime')
  const slotBtn = (t: Task) => (
    <button className="slot-btn" title="Change the part of the day" aria-label={`${slotLabel(t.slot)}, change the part of the day`}
      onClick={() => assignSlot(t.id, SLOT_CYCLE[(SLOT_CYCLE.indexOf(t.slot) + 1) % SLOT_CYCLE.length])}>
      {slotLabel(t.slot)}
    </button>
  )
  const slotRank = (t: Task) => (t.slot ? SLOTS.findIndex((x) => x.id === t.slot) : SLOTS.length)
  const dayOpen = todayAll.filter((t) => !t.done).sort((a, b) => slotRank(a) - slotRank(b))
  const nextUp = dayOpen[0]
  const dayRest = dayOpen.slice(1)
  const dayDone = todayAll.filter((t) => t.done)
  const rDone = (r: Routine) => routineComplete(r, periodKeyFor(r.cadence))

  /* The rings read TODAY, whichever day the middle column is showing. */
  const todayList = spaceTasks.filter((t) => t.list === 'today' && (t.plannedOn ?? today) === today)
  const todayDone = todayList.filter((t) => t.done).length
  const focusToday = focusSessions.filter((f) => f.day === today && inView(f.space)).reduce((a, f) => a + f.minutes, 0)
    + (pomo.phase === 'focus' ? Math.max(0, Math.floor((pomo.blockMin * 60 - pomo.secondsLeft) / 60)) : 0)
  const shareRows = goalRows.filter((r) => !r.done || r.added > 0)
  const goalWant = shareRows.reduce((a, r) => a + r.share, 0)
  const goalGot = shareRows.reduce((a, r) => a + Math.min(r.share, r.added), 0)
  const rings = [
    { k: 'Tasks', cls: 'r-accent', v: todayList.length ? todayDone / todayList.length : 0, txt: `${todayDone} of ${todayList.length}` },
    { k: 'Focus', cls: 'r-info', v: Math.min(1, focusToday / FOCUS_DAY_MIN), txt: `${fmtDuration(focusToday)} of ${fmtDuration(FOCUS_DAY_MIN)}` },
    { k: 'Goals', cls: 'r-prog', v: goalWant ? goalGot / goalWant : 0, txt: goalWant ? `${goalGot} of ${goalWant} today` : 'No goals yet' },
  ]
  const ringRow = (size: number) => (
    <div className="pf-rings">
      {rings.map((r) => (
        <div key={r.k} className="pf-ring">
          <Ring v={r.v} size={size} cls={r.cls} />
          <b>{r.k}</b>
          <span className="mono">{r.txt}</span>
        </div>
      ))}
    </div>
  )
  const [closing, setClosing] = useState(false)
  /* THREE COLUMNS, EACH ITS OWN SCROLL (his ask, 2026-11-02): a long day must
     not drag the goals and the pool off screen with it. Each column sticks
     under the app's header and scrolls inside itself; this measures that
     header so the columns start exactly below it at any width. */
  const gridRef = useRef<HTMLDivElement>(null)
  /* The columns fill exactly what is left of the window under the title (and
     the overnight banner when it shows), so at rest nothing hides below the
     fold and the page itself does not need to scroll. Measured after every
     render because that banner comes and goes. */
  useLayoutEffect(() => {
    const g = gridRef.current
    if (!g) return
    const set = () => {
      const top = g.getBoundingClientRect().top + window.scrollY
      g.style.setProperty('--pf-h', `${Math.max(420, Math.floor(window.innerHeight - top - 16))}px`)
      const head = document.querySelector('.topstick') as HTMLElement | null
      g.style.setProperty('--pf-top', `${Math.ceil(head?.getBoundingClientRect().height ?? 0)}px`)
    }
    set()
    window.addEventListener('resize', set)
    return () => window.removeEventListener('resize', set)
  })
  const leftToday = todayList.filter((t) => !t.done)
  const focusingOn = (t: Task) => pomo.phase === 'focus' && (pomo.focusLabel ?? '').trim().toLowerCase() === t.title.trim().toLowerCase()
  const [pq, setPq] = useState('')
  const poolShown = pq.trim() ? backlogSorted.filter((t) => t.title.toLowerCase().includes(pq.trim().toLowerCase())) : backlogSorted
  const addFromSearch = () => {
    const got = takeTag(pq, projects)
    if (!got.title) return
    const proj = got.project ?? (newProjectId ? projects.find((p) => p.id === newProjectId) : undefined)
    addTask({ title: got.title, source: 'mc', estimateMin: 0, space: proj?.space ?? addSpace, list: 'backlog', category: 'quick', projectId: proj?.id })
    if (got.project && sel.length && !sel.includes(got.project.id)) setPicked((prev) => [...prev, got.project!.id])
    setPq('')
  }

  const dayMenu = (t: Task) => (
    <Dropdown label={`Options for ${t.title}`}>
      {phone && !t.done && isEstimated(t) && <button role="menuitem" onClick={() => startFocus(taskMinutes(t), t.title)}>Start focus</button>}
      {!t.done && <button role="menuitem" onClick={() => setBreakdownFor(t)}>Break it down</button>}
      {!t.done && <span className="kebab-sep" />}
      {!t.done && (
        <>
          <button role="menuitem" onClick={() => setEditingTask(t)}>Edit</button>
          <button role="menuitem" onClick={() => { moveTaskList(t.id, 'backlog'); assignSlot(t.id, undefined); setTaskAt(t.id, undefined) }}>Back to the list</button>
        </>
      )}
      {!t.done && goalMenu(t)}
      {!t.done && projectMenu(t)}
      {!t.done && spaceMenu(t)}
      <button role="menuitem" className="danger" onClick={() => deleteTask(t.id)}>Delete</button>
    </Dropdown>
  )
  const subList = (t: Task) => (
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
          {!s.done && <SubEdit taskId={t.id} sub={s} />}
          {logging === `sub|${t.id}|${s.id}` && (
            <ActualLog est={s.estimateMin} tracked={trackedFor(s.title)} onLog={(m) => { logSubtaskActual(t.id, s.id, m); setLogging(null) }} onSkip={() => { toggleSubtask(t.id, s.id); setLogging(null) }} />
          )}
        </div>
      ))}
    </div>
  )
  const dayRow = (t: Task) => {
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
          <button
            className="checkbox" role="checkbox" aria-checked={t.done}
            aria-label={t.done ? `Reopen: ${t.title}` : `Complete: ${t.title}`}
            onClick={() => { if (t.done) { toggleTask(t.id); return } setLogging(t.id) }}
          >
            <Icon.Check size={12} strokeWidth={4} />
          </button>
          <SpaceMark space={t.space} />
          <span className={`grow wrap2${openTitles.has(t.id) ? ' is-open' : ''}`} onClick={(e) => toggleTitle(e, t.id)}><Linkify text={t.title} /> <TagMark project={markOf(t)} onPick={pickTag} /></span>
          {goalTag(t)}
          {!t.done && slotBtn(t)}
          {t.done && t.actualMin != null ? (
            <span className="est-vs-actual mono">{fmtDuration(taskMinutes(t))} → {fmtDuration(t.actualMin)}</span>
          ) : (
            <EstimateChip task={t} />
          )}
          {hasSubs && (
            <button className="expand-btn" aria-expanded={isExp} aria-label={isExp ? 'Collapse subtasks' : 'Expand subtasks'} onClick={() => toggleExp(t.id)}>
              {isExp ? '▾' : '▸'} {doneSubs}/{t.subtasks!.length}
            </button>
          )}
          {!t.done && <TaskActions task={t} onFocus={() => startFocus(taskMinutes(t), t.title)} />}
          {dayMenu(t)}
        </div>
        {logging === t.id && (
          <ActualLog est={taskMinutes(t)} tracked={trackedFor(t.title)} onLog={(m) => { logActual(t.id, m); setLogging(null) }} onSkip={() => { toggleTask(t.id); setLogging(null) }} />
        )}
        {hasSubs && isExp && subList(t)}
      </div>
    )
  }
  const poolRow = (t: Task) => {
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
          <span className={`grow${openTitles.has(t.id) ? ' is-open' : ''}`} onClick={(e) => toggleTitle(e, t.id)}>
            <Linkify text={t.title} /> <TagMark project={markOf(t)} onPick={pickTag} />
            {goalOf(t) && <><br />{goalTag(t)}</>}
          </span>
          {t.createdAt && daysSince(t.createdAt) > 0 && (
            <span className="carried-tag mono" title={`On the list since ${t.createdAt}`}>
              {daysSince(t.createdAt) === 1 ? '1 day' : `${daysSince(t.createdAt)} days`}
            </span>
          )}
          <EstimateChip task={t} />
          {hasSubs && (
            <button className="expand-btn" aria-expanded={isExp} aria-label={isExp ? 'Collapse subtasks' : 'Expand subtasks'} onClick={() => toggleExp(t.id)}>
              {isExp ? '▾' : '▸'} {doneSubs}/{t.subtasks!.length}
            </button>
          )}
          <button className="pf-send" aria-label={`Add ${t.title} to ${dayOffset === 0 ? 'today' : longDay(planDay)}`}
            title={`Add to ${dayOffset <= 1 ? offsetWord(dayOffset).toLowerCase() : shortDay(planDay)}`}
            onClick={() => moveTasksToToday([t.id], planDay)}>
            <Icon.ChevronRight size={16} />
          </button>
          <Dropdown label={`Options for ${t.title}`}>
            <button role="menuitem" onClick={() => setEditingTask(t)}>Edit</button>
            <button role="menuitem" onClick={() => setBreakdownFor(t)}>Break it down</button>
            {coarse && (
              <>
                <span className="kebab-head">Plan for a day</span>
                {Array.from({ length: PLAN_AHEAD_DAYS + 1 }, (_, n) => n).map((n) => (
                  <button key={n} role="menuitem" onClick={() => { moveTasksToToday([t.id], dayPlus(n)); setDayOffset(n) }}>
                    Move to {n <= 1 ? offsetWord(n).toLowerCase() : shortDay(dayPlus(n))}
                  </button>
                ))}
              </>
            )}
            {goalMenu(t)}
            {projectMenu(t)}
            {spaceMenu(t)}
            <span className="kebab-sep" />
            <button role="menuitem" className="danger" onClick={() => deleteTask(t.id)}>Delete</button>
          </Dropdown>
        </div>
        {hasSubs && isExp && (
          <div className="subtask-list">
            {t.subtasks!.map((s) => <SubtaskRow key={s.id} taskId={t.id} sub={s} />)}
          </div>
        )}
      </div>
    )
  }
  const pickProject = (id: string, add: boolean) => setPicked(sel.includes(id)
    ? (add ? sel.filter((x) => x !== id) : sel.length === 1 ? [] : [id])
    : (add ? [...sel, id] : [id]))

  return (
    <div className="page plan-focus">
      <Band
        title={<WorkspaceTitle before="Plan" after={longDay(planDay)} />}
        actions={(
          <span className="plan-actions">
            <button className="btn btn-ghost plan-search-btn hide-phone" onClick={() => setSpot(true)} aria-label="Search every task" title="Search every task (Cmd K)"><Icon.Search size={16} /></button>
            <ProjectFilter projects={stripProjects} tasks={tasks} sel={sel} inScope={(t) => inView(t.space)}
              onAll={() => setPicked([])} onPick={pickProject} onManage={() => setPage('projects')} />
            <PhoneProjectFilter
              projects={stripProjects} tasks={tasks} sel={sel} inScope={(t) => inView(t.space)}
              onAll={() => setPicked([])} onPick={pickProject} onManage={() => setPage('projects')}
            />
            <button className="btn btn-ghost" onClick={openDaily}>Yesterday</button>
          </span>
        )}
      />
      {spot && createPortal(
        <Spotlight
          q={search} setQ={setSearch} matches={searchMatches} projects={projects}
          onPick={(t) => { setSpot(false); jumpTo(t) }}
          onClose={() => { setSpot(false); setSearch('') }}
        />,
        document.body,
      )}
      {plan.returnedOn === localDateKey() && returnedLeft.length > 0 && !handoffDismissed && (
        <div className="handoff">
          <span className="grow">
            {returnedLeft.length === 1
              ? '1 thing you did not finish is back on the list.'
              : `${returnedLeft.length} things you did not finish are back on the list.`}
          </span>
          <button className="btn btn-quiet" onClick={() => openDay(prevDay())}>See yesterday</button>
          <button className="btn btn-quiet" onClick={showReturned}>Show me</button>
          <button className="btn btn-primary" onClick={() => { moveTasksToToday(returnedLeft); setDayOffset(0) }}>
            Replan {returnedLeft.length === 1 ? 'it' : `all ${returnedLeft.length}`} for today
          </button>
          <button className="handoff-close" onClick={() => dismissHandoff(plan.returnedOn)} aria-label="Dismiss">
            <Icon.Close size={14} />
          </button>
        </div>
      )}

      <div className="seg-phone" role="tablist" aria-label="Which list">
        <button role="tab" aria-selected={phoneList === 'day'} onClick={() => setPhoneList('day')}>{offsetWord(dayOffset)}</button>
        <button role="tab" aria-selected={phoneList === 'todo'} onClick={() => setPhoneList('todo')}>To-do list <em>{backlogOpen.length}</em></button>
      </div>
      <div className={`pf-grid phone-${phoneList}`} ref={gridRef}>
        {/* LEFT: how today is going, and what the week is for. */}
        <aside className="pf-rail pf-col" data-menu-fixed>
          <section className="panel pf-today" aria-label="Today">
            <div className="pf-head"><span className="microcap">Today</span></div>
            {ringRow(64)}
            <button className="btn btn-quiet pf-close" onClick={() => setClosing(true)}>Close the day</button>
          </section>
          <WeekGoals />
        </aside>

        {/* MIDDLE: the day, with the next thing to do in front. */}
        <main
          className={`pf-main pf-col${dropKey === 'day' ? ' drop-over' : ''}`}
          data-menu-fixed
          onDragOver={(e) => { e.preventDefault(); setDropKey('day') }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropKey(null) }}
          onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); const t = tasks.find((x) => x.id === id); if (id) dropTo((t?.slot ?? 'unsorted') as TimeSlot | 'unsorted', id); setDropKey(null) }}
        >
          <div className="pf-days" role="group" aria-label="Which day to plan">
            {Array.from({ length: PLAN_AHEAD_DAYS + 1 }, (_, n) => n).map((n) => (
              <button
                key={n}
                className={`pf-day${armingDay === n ? ' is-arming' : ''}`}
                aria-pressed={dayOffset === n}
                onClick={() => setDayOffset(n)}
                onDragEnter={() => armDay(n)}
                onDragOver={(e) => e.preventDefault()}
                onDragLeave={() => { if (armingDay === n) clearArm() }}
              >
                {offsetWord(n)}{offsetDate(n) && <i>{offsetDate(n)}</i>}
              </button>
            ))}
          </div>

          {nextUp ? (
            <section className={`panel pf-next${flashId === nextUp.id ? ' flash' : ''}`} data-task-id={nextUp.id} aria-label="Next up">
              <div className="pf-next-top">
                <span className="microcap">{dayOffset === 0 ? 'Next up' : `${offsetWord(dayOffset)}, first up`}</span>
                {dayMenu(nextUp)}
              </div>
              <div className="pf-next-title"><Linkify text={nextUp.title} /> <TagMark project={markOf(nextUp)} onPick={pickTag} /></div>
              <div className="pf-next-meta">
                <EstimateChip task={nextUp} />
                {goalTag(nextUp)}
                {slotBtn(nextUp)}
              </div>
              <div className="pf-next-acts">
                {dayOffset === 0 && (focusingOn(nextUp)
                  ? <span className="pf-timer mono" aria-live="off">{String(Math.floor(pomo.secondsLeft / 60)).padStart(2, '0')}:{String(pomo.secondsLeft % 60).padStart(2, '0')}</span>
                  : (
                    <button className="btn btn-primary" disabled={!isEstimated(nextUp)} onClick={() => startFocus(taskMinutes(nextUp), nextUp.title)}>
                      <Icon.Play size={14} /> {isEstimated(nextUp) ? `Start ${taskMinutes(nextUp)} min focus` : 'Estimating...'}
                    </button>
                  ))}
                <button className="btn btn-quiet" onClick={() => setLogging(nextUp.id)}>Mark done</button>
              </div>
              {logging === nextUp.id && (
                <ActualLog est={taskMinutes(nextUp)} tracked={trackedFor(nextUp.title)} onLog={(m) => { logActual(nextUp.id, m); setLogging(null) }} onSkip={() => { toggleTask(nextUp.id); setLogging(null) }} />
              )}
              {!!nextUp.subtasks?.length && subList(nextUp)}
            </section>
          ) : (
            <section className="panel pf-next is-empty">
              <div className="pf-next-title">{todayAll.length ? 'Everything planned is done' : `Nothing planned for ${dayOffset === 0 ? 'today' : longDay(planDay)}`}</div>
              <p className="col-note">
                {todayAll.length && dayOffset === 0 ? 'Close the day, or pull one more from the list.' : 'Pull something from the to-do list with its arrow, or drag it here.'}
              </p>
            </section>
          )}

          {(dayRest.length > 0 || dueRoutines.length > 0 || dayDone.length > 0) && (
            <div className="pf-sum">
              <b>{dayOpen.length} open</b>
              <span className="mono">{fmtDuration(plannedMin)} of your day</span>
            </div>
          )}
          {/* PHASES OF THE DAY, back on his word (2026-11-02, with fourteen
              tasks on the day): one flat list of fourteen is not a plan. Each
              phase is a header in the list, not a box: its hours, what is in it
              against what it holds, a fold. Anytime collects what has no part
              of the day yet and only shows when something is in it. An empty
              phase is one quiet line that opens up while a task is dragged over
              it, so it stays a place to drop without taking room. The Next up
              task is counted in its phase but shown only once, in the card. */}
          <div className="pf-list">
            {BUCKETS.map((b) => {
              const inPhase = (t: Task) => (t.slot ?? 'unsorted') === b.id
              const open = dayRest.filter(inPhase)
              const fin = dayDone.filter(inPhase)
              const rts = b.id === 'unsorted' ? [] : dueRoutines.filter((r) => routineSlot(r) === b.id)
              const rOpen = rts.filter((r) => !rDone(r))
              const rFin = rts.filter(rDone)
              const heroHere = !!nextUp && inPhase(nextUp)
              const count = open.length + fin.length + rts.length + (heroHere ? 1 : 0)
              if (b.id === 'unsorted' && count === 0) return null
              const tot = todayAll.filter((t) => !t.done && inPhase(t)).reduce((a, t) => a + taskMinutes(t), 0)
              const cap = b.id === 'unsorted' ? 0 : slotMinutes(b.id as TimeSlot)
              const over = cap > 0 ? tot - cap : 0
              const shut = shutSlots.has(b.id)
              const left = open.length + rOpen.length
              const rows = open.length + fin.length + rts.length
              return (
                <section
                  key={b.id}
                  className={`pf-phase${count === 0 ? ' is-empty' : ''}${b.id === 'unsorted' ? ' is-anytime' : ''}${dropKey === b.id ? ' drop-over' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropKey(b.id); if (shut) setShut(b.id, false) }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropKey((k) => (k === b.id ? null : k)) }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const id = e.dataTransfer.getData('text/plain'); if (id) dropTo(b.id, id); setDropKey(null) }}
                >
                  <button className="pf-phase-head" aria-expanded={!shut} disabled={rows === 0}
                    aria-label={`${b.id === 'unsorted' ? 'Anytime' : b.label}, ${shut ? 'expand' : 'collapse'}`}
                    onClick={() => setShut(b.id, !shut)}>
                    {rows > 0 && <span className="fold-caret" aria-hidden="true" />}
                    <span className="pf-phase-name">{b.id === 'unsorted' ? 'Anytime' : b.label}</span>
                    {BUCKET_HINT[b.id] && <span className="pf-phase-hours mono">{BUCKET_HINT[b.id]}</span>}
                    <span className={`pf-phase-tot mono${over > 0 ? ' is-over' : ''}`}>
                      {count === 0 ? 'Empty, drop a task here'
                        : over > 0 ? `${fmtDuration(tot)} of ${fmtDuration(cap)}, ${fmtDuration(over)} over`
                        : tot > 0 ? fmtDuration(tot) : ''}
                      {shut && left > 0 ? `, ${left} left` : ''}
                    </span>
                  </button>
                  {!shut && rows > 0 && (
                    <div className="pf-phase-rows">
                      {open.map(dayRow)}
                      {rOpen.map((r) => <RoutineOnDay key={r.id} routine={r} day={planDay} />)}
                      {fin.map(dayRow)}
                      {rFin.map((r) => <RoutineOnDay key={r.id} routine={r} day={planDay} />)}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        </main>

        {/* RIGHT: the pool. Search it, add to it, send from it. */}
        <aside
          className={`panel todo-col pf-pool pf-col${listDropOver ? ' drop-over' : ''}`}
          data-menu-fixed
          onDragOver={(e) => { e.preventDefault(); setListDropOver(true) }}
          onDragLeave={() => setListDropOver(false)}
          onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) dropToList(id); setListDropOver(false) }}
        >
          <div className="pf-head">
            <span className="microcap">To do</span>
            <span className="pf-count mono">{backlogOpen.length} waiting</span>
            <Dropdown
              label="Sort the to-do list"
              className="col-sort"
              trigger={({ onClick, open }) => (
                <button className="fold-all" onClick={onClick} aria-expanded={open} aria-label="Sort the to-do list">
                  {SORTS.find((x) => x.id === sortBy)!.label} <Icon.ChevronDown size={12} />
                </button>
              )}
            >
              {SORTS.map((x) => (
                <button key={x.id} role="menuitem" aria-checked={x.id === sortBy} className={x.id === sortBy ? 'is-on' : undefined} onClick={() => pickSort(x.id)}>{x.label}</button>
              ))}
            </Dropdown>
          </div>
          <TagField
            id="plan-add" label="Search or add a new task" placeholder="Search, or type and press Enter to add"
            value={pq} onChange={setPq} onSubmit={addFromSearch}
            projects={tagChoices} createSpace={addSpace}
          />
          <div className="pf-pool-list">
            {poolShown.map(poolRow)}
            {backlogOpen.length === 0 && <div className="empty">Nothing waiting. Type above to add the first task.</div>}
            {backlogOpen.length > 0 && poolShown.length === 0 && <div className="empty">Nothing matches. Press Enter to add it.</div>}
          </div>
        </aside>
      </div>

      {closing && (
        <Sheet title="Close the day" onClose={() => setClosing(false)}>
          {ringRow(56)}
          <span className="microcap pf-sheet-h">Done today</span>
          {todayList.filter((t) => t.done).length === 0 && <p className="col-note">Nothing ticked yet today.</p>}
          <ul className="pf-wins">
            {todayList.filter((t) => t.done).sort((a, b) => (a.doneAt ?? '').localeCompare(b.doneAt ?? '')).map((t) => (
              <li key={t.id}>
                <span className="mono">{t.doneAt ? new Date(t.doneAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                <span className="grow">{t.title}</span>
                {goalTag(t)}
              </li>
            ))}
            {focusToday > 0 && <li><span className="mono">Focus</span><span className="grow">{fmtDuration(focusToday)} focused</span></li>}
            {goalRows.filter((r) => r.added > 0).map((r) => (
              <li key={r.goal.id}><span className="mono">Goal</span><span className="grow">{r.goal.name}</span><span className="goal-tag mono">+{r.added}</span></li>
            ))}
          </ul>
          {leftToday.length > 0 && (
            <>
              <span className="microcap pf-sheet-h">Moves to tomorrow</span>
              <ul className="pf-wins">
                {leftToday.map((t) => <li key={t.id}><span className="grow">{t.title}</span><span className="mono">{fmtDuration(taskMinutes(t))}</span></li>)}
              </ul>
            </>
          )}
          <div className="sheet-actions">
            <button className="btn btn-quiet" onClick={() => setClosing(false)}>Not yet</button>
            <button className="btn btn-primary" onClick={() => {
              if (leftToday.length) moveTasksToToday(leftToday.map((t) => t.id), dayPlus(1))
              setClosing(false)
            }}>
              {leftToday.length ? `Move ${leftToday.length} to tomorrow and close` : 'Close the day'}
            </button>
          </div>
        </Sheet>
      )}

      {breakdownFor && <BreakdownSheet task={breakdownFor} onClose={() => setBreakdownFor(null)} />}
      {editingTask && <EditTaskSheet task={editingTask} onClose={() => setEditingTask(null)} />}
      {phone && sheetTask && (
        <TaskSheet
          key={sheetTask.id}
          task={sheetTask}
          onClose={() => setSheetId(null)}
          onDone={() => { if (sheetTask.list === 'today') setLogging(sheetTask.id); else toggleTask(sheetTask.id) }}
          onEdit={() => setEditingTask(sheetTask)}
          onBreakdown={() => setBreakdownFor(sheetTask)}
          onFocus={isEstimated(sheetTask) ? () => startFocus(taskMinutes(sheetTask), sheetTask.title) : undefined}
          onPlaced={(n) => setDayOffset(n)}
        />
      )}
    </div>
  )
}

/* ---------------- PROJECTS ----------------
   A directory, not a filter. Every card here is a door into Plan, pre-scoped
   to one project on the way in; Plan itself does the filtering (see
   `openProjectId` in PlanPage above), so this page owns no task data of its
   own. Today, Calendar, Habits, and Goals never find out a project exists. */

