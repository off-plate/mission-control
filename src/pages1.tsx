import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { SpaceGrid } from './Grid'
import { MOCK_AGENDA, SPACE_LABELS, exceptionsFor, globalExceptions, momentum } from './exceptions'
import { MOCK_MONEY, fakeDecompose } from './mock'
import { useStore } from './store'
import { usePomodoro } from './pomodoro'
import { MorningRoutine } from './morning'
import { BreakdownSheet, Sheet } from './modals'
import { GOAL_CATEGORIES, GOAL_TIMEFRAMES, HABIT_FREQUENCIES, SLOTS, bestStreak, currentStreak, daysClean, keptDaysIn, quitDays, quitKeptDays, focusMinutesOn, goalCurrent, habitFrequencyLabel, habitTarget, stepLocked, TYPING_TARGET_WPM, type AgendaEvent, type GoalCategory, type GoalTimeframe, type Goal, type HabitDef, type HabitFrequency, type HabitKind, type Routine, type RoutineCadence, type SpaceId, type Task, type TaskCategory, type TimeSlot } from './types'
import { estimateFor } from './estimate'
import { goalPeriodKey, goalPeriodRange, type GoalTf, fmtDuration, fmtNum, fmtSigned, goalPace, fmtTime, fmtTimeShort, fmtWhen, dayOfWeekKey, gcalUrl, isEstimated, localDateKey, slotForDaypart, taskMinutes, toMin } from './util'

/* ---------------- shared bits ---------------- */

/* A field that grows with what you type, up to a ceiling, then scrolls. Dragging
   a resize grip to see your own sentence is not a thing anyone should be doing. */
export function AutoTextarea({
  value, minRows = 3, maxRows = 18, className = '', onChange, ...rest
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'> & {
  value: string
  minRows?: number
  maxRows?: number
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const cs = getComputedStyle(el)
    const line = parseFloat(cs.lineHeight) || 20
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    const max = line * maxRows + pad
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [value, maxRows])

  return (
    <textarea
      {...rest}
      ref={ref}
      className={`autogrow ${className}`.trim()}
      rows={minRows}
      value={value}
      onChange={onChange}
    />
  )
}

/* A dropdown that opens upward when there is no room below it. Menus near the
   bottom of the page were opening off-screen with no way to reach the items. */
export function Dropdown({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const btn = ref.current?.getBoundingClientRect()
    const menu = ref.current?.querySelector('.kebab-menu') as HTMLElement | null
    if (btn && menu) {
      const need = menu.offsetHeight + 12
      setUp(btn.bottom + need > window.innerHeight && btn.top > need)
    }
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  return (
    <span className={`kebab-wrap ${className}`} ref={ref}>
      <button className="kebab" aria-label={label} aria-expanded={open} onClick={() => setOpen((v) => !v)}>⋯</button>
      {open && (
        <div className={`kebab-menu${up ? ' opens-up' : ''}`} role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </span>
  )
}

/* No `sub`. A page title does not get a subtitle restating it.
   See DESIGN.md, "No subtitles". */

/* WHICH ROOM THIS CAME FROM.
   Only shown in All, where a row could be from any of the three. Two channels,
   because one of them cannot carry it alone: the three space hues measure
   between 3.7:1 and 4.4:1 on these surfaces, under the 4.5:1 a coloured word
   would need, so the hue is a 3px rule (which needs 3:1, and all three clear it)
   and the letter beside it is neutral --muted at 7.5:1. Colour is never the only
   thing saying it. The rule runs the full height of its row, so three Work rows
   in a row read as one navy stripe rather than three ticks. */
/** In All, a new thing has to land somewhere. This says where, next to the
 *  button that commits it, rather than as a field somewhere else on the page. */
export function WriteTo() {
  const { view, space, setSpace } = useStore()
  if (view !== 'all') return null
  return (
    <select
      className="textinput writeto" value={space} aria-label="Which profile this goes to"
      onChange={(e) => setSpace(e.target.value as SpaceId)}
    >
      {(Object.keys(SPACE_LABELS) as SpaceId[]).map((s) => (
        <option key={s} value={s}>{SPACE_LABELS[s]}</option>
      ))}
    </select>
  )
}

export function SpaceMark({ space }: { space?: SpaceId }) {
  const { view } = useStore()
  if (view !== 'all' || !space) return null
  return (
    <span className={`spacemark s-${space}`}>
      <i aria-hidden="true" />
      <b aria-hidden="true">{SPACE_LABELS[space][0]}</b>
      <span className="visually-hidden">{SPACE_LABELS[space]}</span>
    </span>
  )
}

export function Band({
  title, metrics, actions,
}: {
  title: string
  metrics?: { v: string; k: string; tone?: 'pos' | 'urgent' | 'info' }[]
  actions?: React.ReactNode
}) {
  return (
    <div className="band">
      <div className="band-day">
        <h1>{title}</h1>
      </div>
      <div className="band-status">
        {metrics?.map((m) => (
          <div className="band-metric" key={m.k}>
            <span className={`v${m.tone ? ' val-' + m.tone : ''}`}>{m.v}</span>
            <span className="k">{m.k}</span>
          </div>
        ))}
        {actions && <div className="band-actions">{actions}</div>}
      </div>
    </div>
  )
}

function useNextEvent(space: string): { v: string; k: string } {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => tick((x) => x + 1), 30_000)
    return () => window.clearInterval(t)
  }, [])
  const events = MOCK_AGENDA[space as keyof typeof MOCK_AGENDA] ?? []
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
  const ongoing = events.find((e) => toMin(e.start) <= nowMin && nowMin < toMin(e.end))
  if (ongoing) return { v: `${ongoing.title.split(':')[0]} until ${fmtTimeShort(ongoing.end)}`, k: 'now' }
  const next = events.find((e) => toMin(e.start) > nowMin)
  if (!next) return { v: 'none today', k: 'next event' }
  return { v: `${fmtTimeShort(next.start)} ${next.title.split(':')[0]}`, k: 'next event' }
}

const dateLine = () =>
  new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

/* ---------------- TODAY ---------------- */

export function TodayPage() {
  const { space, tasks, routines, habits, coachSessions, plan, editing, setEditing, setPage, savedMin, todayIndex, review, addTask, deleteTask, setCoachOpen, setFocusTaskId, sources, inView } = useStore()
  const nextEvent = useNextEvent(space)
  const exceptions = exceptionsFor(space, { tasks, routines })
  /* Money and official post follow you into Work and Off-Plate. Sitting in the
     Work profile all day used to mean the app told you nothing was wrong. */
  const shownExceptions = space === 'personal'
    ? exceptions
    : [...globalExceptions({ tasks, routines }), ...exceptions]
  const open = tasks.filter((t) => inView(t.space) && t.list === 'today' && !t.done)
  const DREAD_RANK = { admin: 0, call: 1, deep: 2, quick: 3 }
  const alertTaskTitles = new Set(exceptions.map((x) => x.task?.title).filter(Boolean) as string[])
  const alertRank = (t: Task) => (alertTaskTitles.has(t.title) ? 0 : 1)
  const firstMove =
    open.find((t) => alertTaskTitles.has(t.title)) ??
    tasks.find((t) => t.id === plan.firstMoveId && !t.done && inView(t.space)) ??
    [...open].sort((a, b) => alertRank(a) - alertRank(b) || DREAD_RANK[a.category] - DREAD_RANK[b.category])[0]
  const [addOpen, setAddOpen] = useState(false)
  const reviewDue = todayIndex === 6 && review.lastDoneDate !== localDateKey()
  // Next payment badge derives from the money schedule instead of a hardcoded string.
  const nextPay = MOCK_MONEY?.schedule.find((r) => r.state === 'not sent' || r.state === 'action needed')
  const wins = momentum({ tasks: tasks.filter((t) => inView(t.space)), routines, habits: habits.filter((h) => inView(h.space)), coachSessions })

  return (
    <div className="page">
      <Band
        title="Today"
        metrics={[
          { v: nextEvent.v, k: nextEvent.k, tone: 'info' as const },
          { v: String(open.length), k: 'tasks open' },
          ...(space === 'personal' && nextPay
            ? [{ v: `${nextPay.amount} ${nextPay.date.split(' ')[0]}`, k: 'next payment', tone: 'urgent' as const }]
            : [{ v: `${fmtSigned(savedMin)}`, k: 'under estimate', tone: 'pos' as const }]),
        ]}
        actions={
          <>
            {/* Shown on phone too: the stack has its own reorder arrows and
                widget menu, which were unreachable while this button was hidden. */}
            <button className="btn btn-quiet" aria-pressed={editing} onClick={() => setEditing(!editing)}>
              {editing ? 'Done' : 'Edit grid'}
            </button>
            {editing && <button className="btn btn-quiet" onClick={() => setAddOpen(true)}>Add widget</button>}
          </>
        }
      />

      {shownExceptions.length > 0 ? (
        <div className="exceptions" role="alert" aria-label="Needs attention">
          {shownExceptions.map((x) => {
            const queued = x.task ? tasks.find((t) => t.title === x.task!.title) : undefined
            const resolved = queued?.done
            if (resolved) return null
            return (
              <div className={`exception-row${x.fromPersonal && space !== 'personal' ? ' from-other' : ''}`} key={x.id}>
                <span className="dot" aria-hidden="true" />
                {x.fromPersonal && space !== 'personal' && <span className="exc-origin">Personal</span>}
                <span>{x.text}</span>
                <span className="when">{x.when}</span>
                {x.action === 'add-task' && x.task && (
                  queued ? (
                    <span className="microcap" style={{ color: 'var(--progress)', marginLeft: 'var(--s2)' }}>queued for today</span>
                  ) : (
                    <button onClick={() => addTask({ title: x.task!.title, source: 'mc', estimateMin: x.task!.estimateMin, space: 'personal', list: 'today', category: 'admin' })}>
                      {x.actionLabel}
                    </button>
                  )
                )}
                {x.action === 'coach' && (
                  <>
                    <button onClick={() => { setCoachOpen(x.coachId ?? x.coachSeed ?? null); setPage('coach') }}>
                      {x.actionLabel ?? 'Walk me through it'}
                    </button>
                    {/* An old task deserves an honest second option: face it or let it go. */}
                    {x.taskId && <button className="exc-drop" onClick={() => deleteTask(x.taskId!)}>Drop it</button>}
                  </>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="allclear">
          <span className="dot" aria-hidden="true" />
          Nothing is on fire, here or in Personal.
        </div>
      )}

      {/* The other side of the ledger. Only real events, never a score. */}
      {wins.length > 0 && (
        <div className="momentum" aria-label="What is going right">
          <span className="microcap">Going right</span>
          {wins.map((w, i) => <span className="momentum-item" key={i}>{w}</span>)}
        </div>
      )}

      {(firstMove || (reviewDue && space === 'personal')) && (
        <div className="pin-row">
          {firstMove && (
            <div className="firstmove">
              <span className="microcap fm-label">First move</span>
              <span className="fm-title">{firstMove.title}</span>
              <span className="est-chip">{fmtDuration(firstMove.estimateMin)}</span>
              <button className="btn btn-primary" onClick={() => { setFocusTaskId(firstMove.id); setPage('plan') }}>Start</button>
            </div>
          )}
          {reviewDue && space === 'personal' && (
            <div className="firstmove" style={{ borderColor: 'var(--accent)' }}>
              <span className="microcap fm-label">Sunday</span>
              <span className="fm-title">Weekly reset, 15 minutes</span>
              <button className="btn btn-primary" onClick={() => setPage('review')}>Start</button>
            </div>
          )}
        </div>
      )}

      <SpaceGrid />

      {/* Only drawn when the space actually has a line; otherwise it left a
          stray hairline under the grid in Work. */}
      <div className={`status-strip${space === 'work' ? ' is-empty' : ''}`} aria-label="Background numbers">
        {space === 'personal' && (
          <button onClick={() => setPage('settings')}><span className="k">sync</span> {sources.filter((x) => x.status === 'connected').length} of {sources.filter((x) => x.status !== 'manual').length} live{sources.some((x) => x.status === 'off') ? `, ${sources.filter((x) => x.status === 'off').map((x) => x.name).join(', ')} paused` : ''}</button>
        )}
        {space === 'offplate' && (
          <button onClick={() => setPage('review')}><span className="k">follower stats</span> entered 9 d ago, stale</button>
        )}
      </div>
      {addOpen && <AddWidgetInline onClose={() => setAddOpen(false)} />}
    </div>
  )
}

/* Uses the shared Sheet so it inherits Escape-to-close, the way every other
   dialog in the app behaves. */
function AddWidgetInline({ onClose }: { onClose: () => void }) {
  const { spaces, space, addWidget, inView } = useStore()
  const present = new Set(spaces[space].map((w) => w.type))
  return (
    <Sheet
      title="Add a widget"
      onClose={onClose}
      note="The real app also gets a generic source widget: point it at any API or MCP connection and template the result."
    >
      <div className="addw-grid">
        {Object.values(WIDGET_DEFS_LIST).map((d) => (
          <button
            key={d.type}
            className="addw-item"
            disabled={present.has(d.type)}
            onClick={() => { addWidget(space, d.type); onClose() }}
          >
            {d.title}
            <span className="d">{d.description}</span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}

import { WIDGET_DEFS } from './mock'
const WIDGET_DEFS_LIST = WIDGET_DEFS

/* ---------------- PLAN ---------------- */

const HOUR_PX = 42             // tall enough that a 30-minute block fits its own label
/* The whole day, midnight to midnight. He wants to see the full day, not a
   window I decided was the interesting part of it. */
const START_H = 0
const END_H = 24

/** The task/event name IS the link; clicking opens (or schedules) it in Google Calendar. */
function TaskName({ title, start, end, className }: { title: string; start?: string; end?: string; className?: string }) {
  return (
    <a className={`task-link${className ? ' ' + className : ''}`} href={gcalUrl(title, start, end)} target="_blank" rel="noreferrer" title="Open in Google Calendar">
      {title}
    </a>
  )
}

/** 'HH:MM' for a pixel offset down the day, snapped to the nearest quarter hour. */
function timeAtOffset(px: number): string {
  const mins = Math.round(((px / HOUR_PX) * 60) / 15) * 15 + START_H * 60
  const clamped = Math.max(START_H * 60, Math.min(END_H * 60 - 15, mins))
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`
}

/** Vertical day timeline: calendar events plus any task pinned to a clock time. Full height, no inner scroll. */
function Schedule({ events, tasks, onDropAt }: { events: AgendaEvent[]; tasks: Task[]; onDropAt: (id: string, at: string) => void }) {
  const { setTaskAt, inView } = useStore()
  const pinned = tasks.filter((t) => t.at && !t.done)
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
  const startH = START_H
  const endH = END_H
  const DAY_START = startH * 60
  const hours = endH - startH
  const height = hours * HOUR_PX
  const y = (hhmm: string) => ((toMin(hhmm) - DAY_START) / 60) * HOUR_PX
  // Where the drop would land, shown as a line while you drag over the day.
  const [hoverAt, setHoverAt] = useState<string | null>(null)
  const offsetIn = (e: React.DragEvent<HTMLDivElement>) =>
    e.clientY - e.currentTarget.getBoundingClientRect().top
  return (
    <div className="vsched">
      <div
        className="vsched-inner"
        style={{ height }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setHoverAt(timeAtOffset(offsetIn(e))) }}
        onDragLeave={() => setHoverAt(null)}
        onDrop={(e) => {
          e.preventDefault()
          const id = e.dataTransfer.getData('text/plain')
          if (id) onDropAt(id, timeAtOffset(offsetIn(e)))
          setHoverAt(null)
        }}
      >
        {hoverAt && (
          <div className="vdrop" style={{ top: y(hoverAt) }} aria-hidden="true">
            <span className="vdrop-label mono">{fmtTime(hoverAt)}</span>
          </div>
        )}
        {Array.from({ length: hours + 1 }, (_, i) => {
          const h = startH + i
          return (
            <div key={h} className="hline" style={{ top: i * HOUR_PX }}>
              {h % 2 === 0 && h < 24 && <span className="hlabel">{fmtTimeShort(`${h}:00`)}</span>}
            </div>
          )
        })}
        {nowMin >= DAY_START && nowMin <= endH * 60 && (
          <div className="vnow" style={{ top: ((nowMin - DAY_START) / 60) * HOUR_PX }} aria-hidden="true">
            <span className="vnow-dot" /><span className="vnow-label mono">now</span>
          </div>
        )}
        {events.map((e) => (
          <div className="vev vev-cal" key={e.id} style={{ top: y(e.start) + 1, height: Math.max(((toMin(e.end) - toMin(e.start)) / 60) * HOUR_PX - 2, 42) }}>
            <TaskName title={e.title} start={e.start} end={e.end} className="t" />
            <span className="rng">{fmtTime(e.start)} – {fmtTime(e.end)}</span>
          </div>
        ))}
        {pinned.map((t) => (
          <div
            className="vev vev-task" key={t.id} draggable
            onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move' }}
            style={{ top: y(t.at!) + 1, height: Math.max((taskMinutes(t) / 60) * HOUR_PX - 2, 42) }}
          >
            <TaskName title={t.title} start={t.at} className="t" />
            <span className="rng">{fmtTime(t.at!)} · task</span>
            <button className="vev-x" aria-label={`Take ${t.title} off the clock`} onClick={() => setTaskAt(t.id, undefined)}>✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}

const BUCKETS: { id: TimeSlot | 'unsorted'; label: string }[] = [
  { id: 'unsorted', label: 'Unsorted' },
  ...SLOTS.map((s) => ({ id: s.id, label: s.label })),
]

/** Inline "how long did it take?" logger shown when you finish a task or subtask. */
function ActualLog({ est, onLog, onSkip }: { est: number; onLog: (m: number) => void; onSkip: () => void }) {
  const [custom, setCustom] = useState('')
  const chips = Array.from(new Set([Math.max(1, Math.round(est / 2)), est, est * 2]))
  return (
    <div className="actual-log" role="group" aria-label="How long did it take?">
      <span className="actual-log-q">How long?</span>
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
  if (fromSteps) return <span className="est-chip" title="Comes from the steps">{fmtDuration(mins)}</span>
  return (
    <button
      className={`est-chip est-edit${isEstimated(task) ? '' : ' is-none'}`}
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
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M8 5.5v13l10-6.5-10-6.5z" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <button
        className="task-act"
        disabled={hasSubs}
        aria-label={hasSubs ? `${task.title} takes its estimate from its steps` : `Estimate how long ${task.title} takes`}
        title={hasSubs ? 'Estimate comes from the steps' : 'Estimate the time'}
        onClick={() => {
          const e = estimateFor(task.title, task.category)
          setEstimate(task.id, e.minutes)
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9 2h6" strokeLinecap="round" />
        </svg>
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
function RoutineOnDay({ routine, habitName }: { routine: Routine; habitName?: string }) {
  const { toggleRoutineStep, setRoutineDone, setPage, inView } = useStore()
  const [open, setOpen] = useState(false)
  const total = routine.steps.length
  const done = routine.doneStepIds.length
  const complete = total > 0 && done === total
  /* A step that has to be earned elsewhere (the typing score) cannot be ticked
     from here, so neither can the routine. Saying that is better than a
     checkbox that quietly finishes four of five and stays empty. */
  const gated = !complete && routine.steps.some((st) => !routine.doneStepIds.includes(st.id) && stepLocked(routine, st.id))

  return (
    <div className="today-item">
      <div className={`today-task${complete ? ' done' : ''}`}>
        {/* A routine is not dragged into a time, but its checkbox still has to
            line up with the ones under it. */}
        <span className="drag-grip is-blank" aria-hidden="true">⠿</span>
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
              ? `Open it in Routines: one step has to be earned, not ticked (${TYPING_TARGET_WPM} WPM)`
              : undefined}
          onClick={() => setRoutineDone(routine.id, !complete)}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M2 6.5 5 9.5 10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
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
          <button role="menuitem" onClick={() => setPage('routines')}>Open in Routines</button>
        </Dropdown>
      </div>

      {total === 0 && (
        <p className="rod-empty">
          No steps yet.{' '}
          <button className="rod-link" onClick={() => setPage('routines')}>Write them</button>
        </p>
      )}

      {open && total > 0 && (
        <div className="subtask-list">
          {routine.steps.map((s) => {
            const checked = routine.doneStepIds.includes(s.id)
            const locked = !checked && stepLocked(routine, s.id)
            return (
              <div key={s.id} className="subtask-wrap">
                <button
                  className={`subtask${checked ? ' done' : ''}`}
                  disabled={locked}
                  title={locked ? `Open this in Routines and log ${TYPING_TARGET_WPM} WPM to check it off` : undefined}
                  onClick={() => (locked ? setPage('routines') : toggleRoutineStep(routine.id, s.id))}
                >
                  <span className="sub-tick" aria-hidden="true" />
                  <span className="grow">{s.title}</span>
                  {locked && <span className="rod-locked mono">{TYPING_TARGET_WPM} WPM to pass</span>}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {complete && habitName && (
        <p className="rod-done">Checked “{habitName}” off in Habits.</p>
      )}
    </div>
  )
}

export function PlanPage() {
  const todayIdx = (new Date().getDay() + 6) % 7
  const { startFocus } = usePomodoro()
  const { routines, habits } = useStore()
  const { space, tasks, toggleTask, logActual, assignSlot, toggleSubtask, logSubtaskActual, moveTasksToToday, moveTaskList, deleteTask, addTask, addTaskWithSubtasks, focusTaskId, setFocusTaskId, setTaskAt, inView } = useStore()
  const events = MOCK_AGENDA[space]

  const spaceTasks = tasks.filter((t) => inView(t.space))
  const backlogOpen = spaceTasks.filter((t) => !t.done && t.list === 'backlog') // the to-do pool
  const todayAll = spaceTasks.filter((t) => t.list === 'today')  // today incl. finished (they stay, struck)
  const todayTasks = todayAll.filter((t) => !t.done)             // still to do
  const doneUnsorted = todayAll.filter((t) => t.done && !t.slot) // finished, never scheduled

  /* Routines belong on the day by their own cadence: he never adds them, they
     are simply there. Each sits in the part of the day its habit names. */
  const isWeekend = todayIdx >= 5
  const dueRoutines = routines.filter((r) => inView(r.space) && !(r.cadence === 'prework' && isWeekend))
  const routineSlot = (r: Routine): TimeSlot | 'unsorted' =>
    slotForDaypart(habits.find((h) => h.id === r.habitId)?.daypart)
  const anytimeRoutines = dueRoutines.filter((r) => routineSlot(r) === 'unsorted')
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

  // time saved today: estimate minus actual, only for what you finished in Today
  const loggedAny = todayAll.some((t) => t.actualMin != null || t.subtasks?.some((s) => s.actualMin != null))
  const savedToday = todayAll.reduce((acc, t) => {
    if (t.subtasks?.length) return acc + t.subtasks.reduce((a, s) => a + (s.done && s.actualMin != null ? s.estimateMin - s.actualMin : 0), 0)
    return acc + (t.done && t.actualMin != null ? t.estimateMin - t.actualMin : 0)
  }, 0)

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [dropKey, setDropKey] = useState<string | null>(null)
  const [logging, setLogging] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [listDropOver, setListDropOver] = useState(false)
  const [quick, setQuick] = useState('')
  const [breakdownFor, setBreakdownFor] = useState<Task | null>(null)

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
    if (t && t.list !== 'today') moveTaskList(id, 'today')
    assignSlot(id, key === 'unsorted' ? undefined : key)
  }
  /* Dropped onto the day itself: the task gets that clock time, comes to today
     if it was in the backlog, and its bucket follows the hour. */
  const dropAt = (id: string, at: string) => {
    const t = tasks.find((x) => x.id === id)
    if (!t) return
    setTaskAt(id, at)
  }
  const dropToList = (id: string) => {
    const t = tasks.find((x) => x.id === id)
    if (!t || t.list === 'backlog') return
    moveTaskList(id, 'backlog')
    assignSlot(id, undefined)
  }

  return (
    <div className="page">
      <Band
        title="Plan the day"
        metrics={[
          { v: fmtDuration(plannedMin), k: 'planned today', tone: 'info' as const },
          { v: `${donePct}%`, k: 'to-do done', tone: 'pos' as const },
        ]}
      />
      <div className="grid-3 plan-cols">
        {/* 1 — Schedule */}
        <div className="panel">
          <span className="microcap">Schedule</span>
          <Schedule events={events} tasks={todayTasks} onDropAt={dropAt} />
          <p className="col-note">Drag a task onto the day to give it a time. On the day itself, a name opens in Google Calendar.</p>
        </div>

        {/* 2 — To-do list: everything you added, any day. Drag out to plan it,
            drag back to take it off today. */}
        <div
          className={`panel${listDropOver ? ' drop-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setListDropOver(true) }}
          onDragLeave={() => setListDropOver(false)}
          onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) dropToList(id); setListDropOver(false) }}
        >
          <div className="col-head">
            <span className="microcap">To-do list</span>
            <span className="col-tot mono">{backlogOpen.length} here</span>
          </div>
          <div className="todo-progress" aria-label={`${doneCount} of ${pool.length} tasks done`}>
            <div className="bar prog"><i style={{ width: `${donePct}%` }} /></div>
            <span className="todo-progress-label">
              {doneCount} of {pool.length} done across this space · {fmtDuration(totalMin - doneMin)} left
            </span>
          </div>
          {/* Add a task; breaking it down is an action on the task itself. */}
          <div className="formrow" style={{ marginBottom: 'var(--s2)' }}>
            <input
              className="textinput"
              placeholder="Add something to the list"
              value={quick}
              onChange={(e) => setQuick(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && quick.trim()) { addTask({ title: quick.trim(), source: 'mc', estimateMin: 0, space, list: 'backlog', category: 'quick' }); setQuick('') } }}
              aria-label="New task"
            />
            <button className="btn btn-quiet" disabled={!quick.trim()} onClick={() => { addTask({ title: quick.trim(), source: 'mc', estimateMin: 0, space, list: 'backlog', category: 'quick' }); setQuick('') }}>Add</button>
          </div>
          {backlogOpen.map((t) => {
            const isExp = expanded.has(t.id)
            const hasSubs = !!t.subtasks?.length
            const doneSubs = t.subtasks?.filter((s) => s.done).length ?? 0
            return (
              <div className="todo-item" key={t.id}>
                <div
                  className="todo-row"
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move' }}
                >
                  <span className="drag-grip" aria-hidden="true">⠿</span>
                  <span className={`cat-dot ${t.category}`} aria-hidden="true" />
                  <span className="grow">{t.title}</span>
                  <EstimateChip task={t} />
                  {hasSubs && (
                    <button className="expand-btn" aria-expanded={isExp} aria-label={isExp ? 'Collapse subtasks' : 'Expand subtasks'} onClick={() => toggleExp(t.id)}>
                      {isExp ? '▾' : '▸'} {doneSubs}/{t.subtasks!.length}
                    </button>
                  )}
                  <TaskActions task={t} />
                  <Dropdown label={`Options for ${t.title}`}>
                    <button role="menuitem" onClick={() => setBreakdownFor(t)}>Break it down</button>
                    <button role="menuitem" onClick={() => moveTasksToToday([t.id])}>Move to today</button>
                    <span className="kebab-sep" />
                    <button role="menuitem" className="danger" onClick={() => deleteTask(t.id)}>Delete</button>
                  </Dropdown>
                </div>
                {hasSubs && isExp && (
                  <div className="subtask-list">
                    {t.subtasks!.map((s) => (
                      <div className="subtask-row" key={s.id}>
                        <span className="sub-tick" aria-hidden="true" />
                        <span className="grow" style={{ fontSize: 'var(--text-sm)' }}>{s.title}</span>
                        <span className="est-chip">{fmtDuration(s.estimateMin)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {backlogOpen.length === 0 && <div className="empty">Nothing on the list. Generate a task above when something lands.</div>}
        </div>

        {/* 3 — Today: drag tasks from Unsorted into a time of day */}
        <div className="panel">
          <div className="col-head">
            <span className="microcap">Today</span>
            {loggedAny && <span className={`col-tot mono ${savedToday >= 0 ? 'val-pos' : 'val-urgent'}`}>{savedToday >= 0 ? '+' : ''}{savedToday}m saved</span>}
            <span className="col-tot mono">{fmtDuration(plannedMin)} planned</span>
          </div>
          {anytimeRoutines.length > 0 && (
            <div className="bucket rod-bucket">
              <div className="bucket-head">
                <span className="bucket-name">On repeat</span>
              </div>
              {anytimeRoutines.map((r) => (
                <RoutineOnDay key={r.id} routine={r} habitName={habits.find((h) => h.id === r.habitId)?.name} />
              ))}
            </div>
          )}
          {BUCKETS.map((b) => {
            // A finished task is not waiting to be scheduled, so it drops out of
            // Unsorted and joins the done group at the bottom.
            const inBucket = todayAll.filter((t) => (t.slot ?? 'unsorted') === b.id && !(b.id === 'unsorted' && t.done))
            // Dayless routines get their own group above; they are not tasks
            // waiting to be dragged into a time.
            const mine = b.id === 'unsorted' ? [] : dueRoutines.filter((r) => routineSlot(r) === b.id)
            if (b.id === 'unsorted' && inBucket.length === 0) return null
            const tot = inBucket.filter((t) => !t.done).reduce((a, t) => a + taskMinutes(t), 0)
            return (
              <div
                className={`bucket drop-zone${dropKey === b.id ? ' drop-over' : ''}`}
                key={b.id}
                onDragOver={(e) => { e.preventDefault(); setDropKey(b.id) }}
                onDragLeave={() => setDropKey((k) => (k === b.id ? null : k))}
                onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) dropTo(b.id, id); setDropKey(null) }}
              >
                <div className="bucket-head">
                  <span className="bucket-name">{b.label}</span>
                  {tot > 0 && <span className="tot mono">{fmtDuration(tot)}</span>}
                </div>
                {mine.map((r) => (
                  <RoutineOnDay key={r.id} routine={r} habitName={habits.find((h) => h.id === r.habitId)?.name} />
                ))}
                {inBucket.length === 0 && mine.length === 0 ? (
                  <p className="bucket-empty">Drop a task here.</p>
                ) : inBucket.length === 0 ? null : (
                  inBucket.map((t) => {
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
                          <span className="drag-grip" aria-hidden="true">⠿</span>
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
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 6.5 5 9.5 10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                          </button>
                          <span className={`cat-dot ${t.category}`} aria-hidden="true" />
                          <span className="grow wrap2">{t.title}</span>
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
                              <button role="menuitem" onClick={() => { moveTaskList(t.id, 'backlog'); assignSlot(t.id, undefined); setTaskAt(t.id, undefined) }}>Back to the list</button>
                            )}
                            <button role="menuitem" className="danger" onClick={() => deleteTask(t.id)}>Delete</button>
                          </Dropdown>
                        </div>
                        {logging === t.id && (
                          <ActualLog est={taskMinutes(t)} onLog={(m) => { logActual(t.id, m); setLogging(null) }} onSkip={() => { toggleTask(t.id); setLogging(null) }} />
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
                                    <span className="est-chip">{fmtDuration(s.estimateMin)}</span>
                                  )}
                                </button>
                                {!s.done && (
                                  <button
                                    className="task-act task-focus sub-focus"
                                    aria-label={`Focus on ${s.title} for ${s.estimateMin} minutes`}
                                    title={`Focus ${s.estimateMin}m on this step`}
                                    onClick={() => startFocus(s.estimateMin, s.title)}
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                      <path d="M8 5.5v13l10-6.5-10-6.5z" strokeLinejoin="round" />
                                    </svg>
                                  </button>
                                )}
                                {logging === `sub|${t.id}|${s.id}` && (
                                  <ActualLog est={s.estimateMin} onLog={(m) => { logSubtaskActual(t.id, s.id, m); setLogging(null) }} onSkip={() => { toggleSubtask(t.id, s.id); setLogging(null) }} />
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
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 6.5 5 9.5 10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                  </button>
                  <span className={`cat-dot ${t.category}`} aria-hidden="true" />
                  <span className="grow">{t.title}</span>
                  {t.actualMin != null
                    ? <span className="est-vs-actual mono">{fmtDuration(taskMinutes(t))} → {fmtDuration(t.actualMin)}</span>
                    : isEstimated(t)
                      ? <span className="est-chip">{fmtDuration(taskMinutes(t))}</span>
                      : <span className="est-chip is-none">no estimate</span>}
                </div>
              ))}
            </div>
          )}
          {todayAll.length === 0 && (
            <p className="col-note">Drag anything from the list into a time of day. Drag it back to take it off today.</p>
          )}
        </div>
      </div>

      {breakdownFor && <BreakdownSheet task={breakdownFor} onClose={() => setBreakdownFor(null)} />}

    </div>
  )
}

/* ---------------- HABITS ---------------- */

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']


/* A longer window than the week. One square a day, oldest on the left, so sixty
   or a hundred days reads as a shape rather than a wall of ticks. Green means
   kept, exactly as it does everywhere else; nothing marks a missed day, because
   a wall of misses is the guilt mechanic this app exists to avoid. */
function HabitTrail({ h, days }: { h: HabitDef; days: number }) {
  const { habitLog } = useStore()
  const today = new Date()
  const from = new Date(today); from.setDate(from.getDate() - (days - 1))
  const fromKey = localDateKey(from)
  const toKey = localDateKey(today)
  const kept = h.kind === 'break'
    ? quitKeptDays(h, fromKey, toKey)
    : keptDaysIn(habitLog, h.id, fromKey, toKey)
  const cells = Array.from({ length: days }, (_, i) => {
    const d = new Date(from); d.setDate(from.getDate() + i)
    return localDateKey(d)
  })
  const run = h.kind === 'break' ? (daysClean(h) ?? 0) : currentStreak(habitLog, h.id)
  const best = h.kind === 'break' ? (daysClean(h) ?? 0) : bestStreak(habitLog, h.id)
  return (
    <div className="habit-trail-wrap">
      <div className={`habit-trail w${days}`}>
        {cells.map((day) => (
          <span
            key={day}
            className={`trail-day${kept.has(day) ? ' kept' : ''}${day === toKey ? ' is-today' : ''}`}
            title={`${fmtWhen(day)}${kept.has(day) ? ', kept' : ''}`}
          />
        ))}
      </div>
      <div className="habit-foot">
        <span className="habit-weeks">{kept.size} of {days} days</span>
        <span className="habit-weeks">{run} now, {best} best</span>
      </div>
    </div>
  )
}

function HabitRow({ h, todayIndex, days: window = 7, actions, drivenBy, progress, goal }: {
  h: HabitDef
  todayIndex: number
  /** How many days back to show. Seven keeps the week of dots you can click. */
  days?: number
  actions?: React.ReactNode
  /** Name of the routine that ticks this habit, when one does. */
  drivenBy?: string
  /** Today's progress through the routine that drives this habit. */
  progress?: { done: number; total: number }
  /** A goal counting itself off this habit, if one exists. */
  goal?: Goal
}) {
  const { toggleHabitDay, logSlip, setPage, focusSessions, habitLog, inView } = useStore()
  const kept = h.days.filter(Boolean).length
  const target = habitTarget(h)
  // Weekdays-only habits do not expect the weekend, so those dots stay quiet.
  const expected = (i: number) => (h.frequency === 'weekdays' ? i < 5 : true)
  // How many of the last 12 weeks actually hit the target. This is the number
  // the row of bars was trying to say and never did.
  const weeks = h.history ?? []
  const hitWeeks = weeks.filter((n) => n >= target).length
  const avg = weeks.length ? weeks.reduce((a, n) => a + n, 0) / weeks.length : 0
  const trend = weeks.length === 0
    ? null
    : target <= 1
      ? `kept ${hitWeeks} of the last ${weeks.length} weeks`
      : `averaging ${avg.toFixed(1).replace(/\.0$/, '')} of ${target} a week`

  // Part-done shows as a partial fill on today's dot, so a routine you started
  // but did not finish is visible here instead of reading as untouched.
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  const partial = !!progress && progress.done > 0 && progress.done < progress.total

  /* Measured: the dot is not yes/no, it is how far through the day's target you
     got. A morning that reached 40 of 60 minutes reads as most of the way there
     rather than as a failure. */
  if (h.kind === 'measured') {
    const target = h.dailyTargetMin ?? 60
    const todayMin = focusMinutesOn(focusSessions, localDateKey(), h.space)
    const weekMin = DAY_LABELS.reduce((a, _, i) => a + focusMinutesOn(focusSessions, dayOfWeekKey(i), h.space), 0)
    return (
      <div className="habit-row is-measured">
        <div className="habit-row-top">
          <SpaceMark space={h.space} />
          <span className="habit-name">{h.name}</span>
          <span className="habit-count mono">
            {fmtDuration(todayMin)}<span className="habit-freq">of {fmtDuration(target)} today</span>
          </span>
          {actions}
        </div>
        <div className="habit-days">
          {DAY_LABELS.map((d, i) => {
            const mins = focusMinutesOn(focusSessions, dayOfWeekKey(i), h.space)
            const pct = Math.min(100, Math.round((mins / target) * 100))
            return (
              <span className="day-cell" key={i}>
                <span
                  className={`daydot is-measure${pct >= 100 ? ' full' : pct > 0 ? ' partial' : ''}`}
                  style={{ ['--fill' as string]: `${pct}%` } as React.CSSProperties}
                  title={`${d}: ${fmtDuration(mins)} of ${fmtDuration(target)}`}
                  aria-label={`${d}, ${mins} of ${target} minutes`}
                />
                <span className={`day-lab${i === todayIndex ? ' today' : ''}`}>{d[0]}</span>
              </span>
            )
          })}
        </div>
        <div className="habit-foot">
          <button className="habit-auto" onClick={() => setPage('plan')}>Fills itself from your focus blocks</button>
          <span className="habit-weeks">{fmtDuration(weekMin)} this week</span>
        </div>
      </div>
    )
  }

  /* A quit is a different scoreboard: days clean, and a single honest button
     for the day you slip. Day dots would be asking the wrong question. */
  if (h.kind === 'break') {
    const clean = daysClean(h) ?? 0
    // The week fills itself from the day he stopped: a day he did not do it is a
    // day kept, so he never has to tick anything to be given credit for it.
    const quitWeek = quitDays(h)
    return (
      <div className="habit-row is-quit">
        <div className="habit-row-top">
          <SpaceMark space={h.space} />
          <span className="habit-name">{h.name}</span>
          <span className="habit-count mono">{clean}<span className="habit-freq">{clean === 1 ? 'day' : 'days'} clean</span></span>
          {actions}
        </div>
        {window > 7 ? <HabitTrail h={h} days={window} /> : (
          <div className="habit-days">
            {DAY_LABELS.map((d, i) => (
              <span key={i} className={`daydot is-measure${quitWeek[i] ? ' full' : ''}`} title={quitWeek[i] ? 'A day without it' : undefined}>
                <b>{d}</b>
              </span>
            ))}
          </div>
        )}
        <div className="habit-foot">
          <button className="quit-slip" onClick={() => logSlip(h.id)}>I slipped today</button>
          {h.quitSince && <span className="habit-weeks">since {fmtWhen(h.quitSince)}</span>}
        </div>
      </div>
    )
  }

  return (
    <div className={`habit-row${drivenBy ? ' is-auto' : ''}`}>
      <div className="habit-row-top">
        <SpaceMark space={h.space} />
        <span className="habit-name">{h.name}</span>
        {/* The week's count belongs to the week. Showing 1/7 above a year of
            squares says two different things about the same habit. */}
        {window === 7 && (
          <span className="habit-count mono">{kept}/{target}<span className="habit-freq">{habitFrequencyLabel(h)}</span></span>
        )}
        {actions}
      </div>
      {window > 7 ? <HabitTrail h={h} days={window} /> : (
      <div className="habit-days">
        {DAY_LABELS.map((d, i) => (
          <span className="day-cell" key={i}>
            <button
              className={`daydot${expected(i) ? '' : ' off-day'}${drivenBy ? ' is-auto' : ''}${i === todayIndex && partial ? ' partial' : ''}`}
              style={i === todayIndex && partial ? ({ ['--fill' as string]: `${pct}%` } as React.CSSProperties) : undefined}
              role="checkbox"
              aria-checked={h.days[i]}
              /* A habit a routine ticks is read-only here: ticking it by hand
                 would contradict the routine that owns it. */
              disabled={i > todayIndex || !!drivenBy}
              aria-label={drivenBy ? `${h.name}, ${d}, set by the ${drivenBy} routine` : `${h.name}, ${d}`}
              title={drivenBy ? `Set by the ${drivenBy} routine` : undefined}
              onClick={() => { if (!drivenBy) toggleHabitDay(h.id, i) }}
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 6.5 5 9.5 10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
            <span className={`day-lab${i === todayIndex ? ' today' : ''}`}>{d[0]}</span>
          </span>
        ))}
      </div>
      )}
      {goal && (
        <button className="habit-goal" onClick={() => setPage('goals')}>
          Feeding “{goal.name}”
        </button>
      )}
      <div className="habit-foot">
        {drivenBy ? (
          <button className="habit-auto" onClick={() => setPage('routines')}>
            {progress && progress.total > 1 && progress.done < progress.total
              ? `${progress.done} of ${progress.total} steps done in ${drivenBy}`
              : `Ticks itself when you finish ${drivenBy}`}
          </button>
        ) : null}
        {trend && <span className="habit-weeks">{trend}</span>}
      </div>
    </div>
  )
}

/* Habits are grouped by the part of the day they belong to, each group in its
   own column with its own heading, so you read down "Morning" instead of
   hunting a flat grid for which card happens to be an evening one. */
const DAYPART_COLS: { id: TimeSlot | 'anytime'; label: string }[] = [
  { id: 'morning', label: 'Morning' },
  { id: 'noon', label: 'Noon' },
  { id: 'afternoon', label: 'Afternoon' },
  { id: 'evening', label: 'Evening' },
  { id: 'anytime', label: 'Anytime' },
]

/* One sheet for adding and editing. A habit a routine drives keeps its name and
   frequency in step with that routine, so those fields are read-only here. */
function HabitSheet({ onClose, habit, drivenBy }: { onClose: () => void; habit?: HabitDef; drivenBy?: string }) {
  const { addHabit, updateHabit, inView } = useStore()
  const [name, setName] = useState(habit?.name ?? '')
  // Editing keeps whatever it had, including none. Only a new habit defaults.
  const [daypart, setDaypart] = useState<TimeSlot | ''>(habit ? (habit.daypart ?? '') : 'morning')
  const [frequency, setFrequency] = useState<HabitFrequency>(habit?.frequency ?? 'daily')
  const [perWeek, setPerWeek] = useState(habit?.targetPerWeek ?? 3)
  const [kind, setKind] = useState<HabitKind>(habit?.kind ?? 'build')
  const [targetMin, setTargetMin] = useState(habit?.dailyTargetMin ?? 60)
  const [since, setSince] = useState(habit?.quitSince ?? localDateKey())
  const locked = !!drivenBy
  const quitting = kind === 'break'
  const measured = kind === 'measured'

  const submit = () => {
    if (!name.trim()) return
    const shape = {
      name: name.trim(),
      daypart: quitting ? undefined : (daypart || undefined),
      frequency,
      targetPerWeek: frequency === 'times-per-week' ? perWeek : undefined,
      kind,
      dailyTargetMin: measured ? Math.max(5, targetMin) : undefined,
      source: measured ? ('focus' as const) : undefined,
      quitSince: quitting ? (since || localDateKey()) : undefined,
    }
    if (habit) updateHabit(habit.id, locked ? { daypart: shape.daypart } : shape)
    else addHabit(shape)
    onClose()
  }

  return (
    <Sheet
      steady
      title={habit ? 'Edit this habit' : 'Add a habit'}
      onClose={onClose}
      note={locked
        ? `This habit is kept by the ${drivenBy} routine, so its name and frequency follow that routine. You can still move it to a different part of the day.`
        : 'Habits are the small things you repeat. Multi-step rituals belong on Routines.'}
    >
      <span className="field-label">Which kind is this?</span>
      <div className="kindpick three">
        <button type="button" className={kind === 'build' ? 'on' : ''} disabled={locked} onClick={() => setKind('build')}>
          <b>Keep</b><span>Something you want to do</span>
        </button>
        <button type="button" className={kind === 'break' ? 'on' : ''} disabled={locked} onClick={() => setKind('break')}>
          <b>Quit</b><span>Something you want to stop</span>
        </button>
        <button type="button" className={kind === 'measured' ? 'on' : ''} disabled={locked} onClick={() => setKind('measured')}>
          <b>Amount</b><span>Minutes to hit each day</span>
        </button>
      </div>

      <label className="field-label" style={{ marginTop: 'var(--s4)' }} htmlFor="hname">
        {quitting ? 'What are you quitting?' : measured ? 'What are you measuring?' : 'What is the habit?'}
      </label>
      <input
        id="hname" className="textinput" style={{ width: '100%' }} autoFocus={!locked} disabled={locked}
        placeholder={quitting ? 'e.g. Scrolling in bed' : 'e.g. 20 minutes of movement'}
        value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
      />

      {/* A thing you are quitting has no hour of the day; it has a day you
          stopped, and a rhythm for checking in on it. */}
      {quitting ? (
        <div className="sheet-grid" style={{ marginTop: 'var(--s4)' }}>
          <div>
            <label className="field-label" htmlFor="hsince">Not since</label>
            <input id="hsince" className="textinput" style={{ width: '100%' }} type="date" max={localDateKey()}
              value={since} onChange={(e) => setSince(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="hfreqq">Check in</label>
            <select id="hfreqq" className="textinput" style={{ width: '100%' }} value={frequency} disabled={locked}
              onChange={(e) => setFrequency(e.target.value as HabitFrequency)}>
              {HABIT_FREQUENCIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
        </div>
      ) : (
        <div className="sheet-grid" style={{ marginTop: 'var(--s4)' }}>
          <div>
            <label className="field-label" htmlFor="hpart">When in the day?</label>
            <select id="hpart" className="textinput" style={{ width: '100%' }} value={daypart} onChange={(e) => setDaypart(e.target.value as TimeSlot | '')}>
              {SLOTS.map((s) => <option key={s.id} value={s.id}>{s.label}, {s.hint}</option>)}
              <option value="">Anytime</option>
            </select>
          </div>
          <div>
            {measured ? (
              <>
                <label className="field-label" htmlFor="htarget">Minutes a day</label>
                <input id="htarget" className="textinput" style={{ width: '100%' }} type="number" min={5} max={600} step={5} value={targetMin}
                  onChange={(e) => setTargetMin(Math.max(5, Math.min(600, Number(e.target.value) || 5)))} />
              </>
            ) : frequency === 'times-per-week' ? (
              <>
                <label className="field-label" htmlFor="hper">Days a week</label>
                <input id="hper" className="textinput" style={{ width: '100%' }} type="number" min={1} max={7} value={perWeek}
                  onChange={(e) => setPerWeek(Math.max(1, Math.min(7, Number(e.target.value) || 1)))} />
              </>
            ) : (
              <>
                <label className="field-label" htmlFor="hfreq">How often?</label>
                <select id="hfreq" className="textinput" style={{ width: '100%' }} value={frequency} disabled={locked}
                  onChange={(e) => setFrequency(e.target.value as HabitFrequency)}>
                  {HABIT_FREQUENCIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              </>
            )}
          </div>
        </div>
      )}

      <div className="sheet-actions">
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!name.trim()} onClick={submit}>{habit ? 'Save changes' : 'Add habit'}</button>
      </div>
    </Sheet>
  )
}

/** How far back the habit page is looking. A week is the default because that is
 *  the rhythm; the longer windows are for the sixty and hundred day questions. */
const HABIT_WINDOWS = [
  { id: 7, label: 'A week' },
  { id: 30, label: '30 days' },
  { id: 90, label: '90 days' },
  { id: 365, label: 'A year' },
]

export function HabitsPage() {
  const { habits, goals, space, deleteHabit, routines, todayIndex, inView } = useStore()
  const [days, setDays] = useState(7)
  const [adding, setAdding] = useState(false)
  // Opening the goal sheet from a habit is the "set a goal on this" path.
  const [goalFor, setGoalFor] = useState<string | null>(null)
  const [editHabit, setEditHabit] = useState<HabitDef | null>(null)
  const goalOn = new Map(goals.filter((g) => g.habitId).map((g) => [g.habitId as string, g]))
  const spaceHabits = habits.filter((h) => inView(h.space))
  // A habit a routine drives cannot be deleted from here, or the routine would
  // mirror into nothing. Pausing stays available.
  const drivenBy = new Map(routines.filter((r) => r.habitId).map((r) => [r.habitId as string, r.title]))
  // Today's step progress for each routine-driven habit.
  const progressFor = new Map(routines.filter((r) => r.habitId).map((r) => [
    r.habitId as string, { done: r.doneStepIds.length, total: r.steps.length },
  ]))
  const building = spaceHabits.filter((h) => !h.paused && h.kind !== 'break' && h.kind !== 'measured')
  const kept = building.reduce((a, h) => a + h.days.filter(Boolean).length, 0)
  const target = building.reduce((a, h) => a + habitTarget(h), 0)

  // Only draw a column that has something in it, so empty parts of the day do
  // not leave a labelled void.
  const cols = DAYPART_COLS
    .map((c) => ({ ...c, list: spaceHabits.filter((h) => (h.daypart ?? 'anytime') === c.id) }))
    .filter((c) => c.list.length > 0)

  return (
    <div className="page">
      <Band
        title="Habits"
        metrics={[{ v: `${kept}/${target}`, k: 'kept this week', tone: 'pos' as const }]}
        actions={
          <>
            <select
              className="textinput rangepick" value={days} aria-label="How far back to look"
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {HABIT_WINDOWS.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
            </select>
            <WriteTo />
            <button className="btn btn-primary" onClick={() => setAdding(true)}>Add a habit</button>
          </>
        }
      />

      {/* One band per part of the day: a heading, a rule, then that group's
          habits side by side across the full width. Groups stack down the page,
          so a busy morning never leaves a short evening column stranded. */}
      {cols.map((c) => (
        <section className="habit-section" key={c.id}>
          <div className="section-head">
            <span className="microcap">{c.label}</span>
            <span className="section-count mono">{c.list.length}</span>
          </div>
          <div className="habit-grid">
            {c.list.map((h) => (
              <div className={`panel habit-card${h.paused ? ' is-paused' : ''}`} key={h.id}>
                <HabitRow h={h} todayIndex={todayIndex} days={days} drivenBy={drivenBy.get(h.id)} progress={progressFor.get(h.id)} goal={goalOn.get(h.id)} actions={
                  <>
                  {h.paused && <span className="col-tot mono">paused</span>}
                  {!h.paused && h.days[todayIndex] && <span className="col-tot mono val-pos">done today</span>}
                  <Dropdown label={`Options for ${h.name}`} className="habit-kebab">
                    <button role="menuitem" onClick={() => setEditHabit(h)}>Edit this habit</button>
                    {goalOn.has(h.id) ? (
                      <span className="kebab-note">Goal: {goalOn.get(h.id)!.name}</span>
                    ) : (
                      <button role="menuitem" onClick={() => setGoalFor(h.id)}>Set a goal on this</button>
                    )}
                    <span className="kebab-sep" />
                    {drivenBy.has(h.id) ? (
                      <span className="kebab-note">Deleted with the {drivenBy.get(h.id)} routine</span>
                    ) : (
                      <button role="menuitem" className="danger" onClick={() => deleteHabit(h.id)}>Delete this habit</button>
                    )}
                  </Dropdown>
                  </>
                } />
              </div>
            ))}
          </div>
        </section>
      ))}
      {cols.length === 0 && <div className="empty">No habits in this space yet. Add one from the button above.</div>}


      {adding && <HabitSheet onClose={() => setAdding(false)} />}
      {editHabit && <HabitSheet habit={editHabit} drivenBy={drivenBy.get(editHabit.id)} onClose={() => setEditHabit(null)} />}
      {goalFor && <GoalSheet presetHabitId={goalFor} thenGoToGoals onClose={() => setGoalFor(null)} />}
    </div>
  )
}

/* ---------------- ROUTINES ---------------- */

const CADENCE_ORDER: RoutineCadence[] = ['daily', 'prework', 'weekly', 'monthly']
const CADENCE_LABEL: Record<RoutineCadence, string> = { daily: 'Daily', prework: 'Before work', weekly: 'Weekly', monthly: 'Monthly' }
/** "done today" would be wrong on a monthly routine; each cadence names its own period. */
export const DONE_LABEL: Record<RoutineCadence, string> = {
  daily: 'done today', prework: 'done today', weekly: 'done this week', monthly: 'done this month',
}

/* Writing the steps of a routine. Editing is a mode on the card rather than a
   separate screen, because the thing you are editing is the thing you look at. */
function StepEditor({ routine }: { routine: Routine }) {
  const { addRoutineStep, updateRoutineStep, deleteRoutineStep, moveRoutineStep, inView } = useStore()
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')

  const add = () => {
    if (!title.trim()) return
    addRoutineStep(routine.id, { title: title.trim(), note: note.trim() || undefined })
    setTitle(''); setNote('')
  }

  return (
    <div className="step-editor">
      {routine.steps.map((s, i) => (
        <div className="step-edit-row" key={s.id}>
          <span className="step-order">
            <button aria-label={`Move ${s.title} up`} disabled={i === 0} onClick={() => moveRoutineStep(routine.id, s.id, -1)}>↑</button>
            <button aria-label={`Move ${s.title} down`} disabled={i === routine.steps.length - 1} onClick={() => moveRoutineStep(routine.id, s.id, 1)}>↓</button>
          </span>
          <span className="step-edit-fields">
            <input className="textinput" value={s.title} aria-label={`Step ${i + 1} title`}
              onChange={(e) => updateRoutineStep(routine.id, s.id, { title: e.target.value })} />
            <input className="textinput step-note" value={s.note ?? ''} placeholder="What it involves, if it needs saying"
              aria-label={`Step ${i + 1} note`}
              onChange={(e) => updateRoutineStep(routine.id, s.id, { note: e.target.value })} />
          </span>
          <button className="step-drop" aria-label={`Delete ${s.title}`} onClick={() => deleteRoutineStep(routine.id, s.id)}>×</button>
        </div>
      ))}

      <div className="step-add">
        <input className="textinput" placeholder="Add a step" value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }} aria-label="New step" />
        <input className="textinput step-note" placeholder="Note, optional" value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }} aria-label="New step note" />
        <button className="btn btn-primary" disabled={!title.trim()} onClick={add}>Add</button>
      </div>
    </div>
  )
}

function AddRoutineSheet({ onClose }: { onClose: () => void }) {
  const { addRoutine, inView } = useStore()
  const [title, setTitle] = useState('')
  const [cadence, setCadence] = useState<RoutineCadence>('daily')
  const [daypart, setDaypart] = useState<TimeSlot | ''>('morning')

  const submit = () => {
    if (!title.trim()) return
    addRoutine({ title: title.trim(), cadence, daypart: daypart || undefined })
    onClose()
  }

  return (
    <Sheet title="Add a routine" onClose={onClose} note="A routine is a set of steps you run on a rhythm. Finishing all of them checks off a habit of the same name, created with it.">
      <label className="field-label" htmlFor="rtitle">What is the routine?</label>
      <input id="rtitle" className="textinput" style={{ width: '100%' }} autoFocus placeholder="e.g. Evening shutdown"
        value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />

      <div className="sheet-grid" style={{ marginTop: 'var(--s4)' }}>
        <div>
          <label className="field-label" htmlFor="rcad">How often does it run?</label>
          <select id="rcad" className="textinput" style={{ width: '100%' }} value={cadence} onChange={(e) => setCadence(e.target.value as RoutineCadence)}>
            <option value="daily">Every day</option>
            <option value="prework">Before work, on weekdays</option>
            <option value="weekly">Once a week</option>
            <option value="monthly">Once a month</option>
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="rpart">When in the day?</label>
          <select id="rpart" className="textinput" style={{ width: '100%' }} value={daypart} onChange={(e) => setDaypart(e.target.value as TimeSlot | '')}>
            {SLOTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            <option value="">Anytime</option>
          </select>
        </div>
      </div>

      <p className="assist-note" style={{ marginTop: 'var(--s3)' }}>You write the steps on the card once it exists.</p>

      <div className="sheet-actions">
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!title.trim()} onClick={submit}>Add routine</button>
      </div>
    </Sheet>
  )
}

/* Which routines were finished on which day, drawn the same way a habit's longer
   window is: one square a day, green when it was finished. Same language for the
   same question, rather than a second chart type for the same idea. */
function RoutineTrail({ routineId, days }: { routineId: string; days: number }) {
  const { routineLog } = useStore()
  const today = new Date()
  const done = new Set(routineLog.filter((r) => r.routineId === routineId).map((r) => r.day))
  const cells = Array.from({ length: days }, (_, i) => {
    const d = new Date(today); d.setDate(today.getDate() - (days - 1 - i))
    return localDateKey(d)
  })
  const hit = cells.filter((c) => done.has(c)).length
  return (
    <div className="routine-trail-wrap">
      <div className={`habit-trail w${days}`}>
        {cells.map((day) => (
          <span key={day} className={`trail-day${done.has(day) ? ' kept' : ''}${day === cells[cells.length - 1] ? ' is-today' : ''}`}
            title={`${fmtWhen(day)}${done.has(day) ? ', finished' : ''}`} />
        ))}
      </div>
      <span className="habit-weeks">{hit} of the last {days} days</span>
    </div>
  )
}

const ROUTINE_WINDOWS = [
  { id: 0, label: 'Just today' },
  { id: 30, label: '30 days' },
  { id: 90, label: '90 days' },
]

export function RoutinesPage() {
  const { routines, space, toggleRoutineStep, resetRoutine, deleteRoutine, habits, inView } = useStore()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [trailDays, setTrailDays] = useState(0)
  const [adding, setAdding] = useState(false)
  const spaceRoutines = routines.filter((r) => inView(r.space))
  const sorted = [...spaceRoutines].sort((a, b) => CADENCE_ORDER.indexOf(a.cadence) - CADENCE_ORDER.indexOf(b.cadence))
  return (
    <div className="page">
      <Band
        title="Routines"
        actions={
          <>
            <select
              className="textinput rangepick" value={trailDays} aria-label="How far back to look"
              onChange={(e) => setTrailDays(Number(e.target.value))}
            >
              {ROUTINE_WINDOWS.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
            </select>
            <WriteTo />
            <button className="btn btn-primary" onClick={() => setAdding(true)}>Add a routine</button>
          </>
        }
      />
      <div className="routine-cards">
        {sorted.length === 0 && <div className="empty">No routines in this space yet. Add one from the button above.</div>}
        {sorted.map((r) => {
          if (r.id === 'r-morning' && editingId !== r.id) {
            return <MorningRoutine routine={r} key={r.id} onEdit={() => setEditingId(r.id)} />
          }
          const total = r.steps.length
          const done = r.doneStepIds.length
          const complete = total > 0 && done === total
          const linked = r.habitId ? habits.find((h) => h.id === r.habitId) : null
          return (
            <div className={`panel routine-card${complete ? ' is-complete' : ''}`} key={r.id}>
              <div className="routine-tag">
                <SpaceMark space={r.space} />
                <span className="routine-card-title">{r.title}</span>
                {editingId !== r.id && (complete
                  ? <span className="col-tot mono val-pos">{DONE_LABEL[r.cadence]}</span>
                  : <span className="routine-progress mono">{done}/{total}</span>)}
                <Dropdown label={`Options for ${r.title}`}>
                  <button role="menuitem" onClick={() => setEditingId(editingId === r.id ? null : r.id)}>
                    {editingId === r.id ? 'Done editing' : 'Edit the steps'}
                  </button>
                  <span className="kebab-sep" />
                  <button role="menuitem" className="danger" onClick={() => deleteRoutine(r.id)}>
                    Delete this routine
                  </button>
                </Dropdown>
              </div>
              {r.blurb && <p className="routine-blurb">{r.blurb}</p>}
              {trailDays > 0 && editingId !== r.id && <RoutineTrail routineId={r.id} days={trailDays} />}
              {editingId === r.id ? (
                <>
                  <StepEditor routine={r} />
                  <div className="routine-card-foot" style={{ marginTop: 'var(--s3)' }}>
                    <span className="assist-note">Changes save as you type.</span>
                    <button className="btn btn-primary routine-reset" onClick={() => setEditingId(null)}>Done</button>
                  </div>
                </>
              ) : (
              <>
              {total === 0 && (
                <p className="routine-empty">
                  No steps yet. Open the menu and write them.
                </p>
              )}
              <div className="routine-steplist">
                {r.steps.map((s) => {
                  const checked = r.doneStepIds.includes(s.id)
                  return (
                    <div className={`routine-step${checked ? ' checked' : ''}`} key={s.id}>
                      <button className="routine-check" role="checkbox" aria-checked={checked} aria-label={s.title} onClick={() => toggleRoutineStep(r.id, s.id)}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 6.5 5 9.5 10 3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </button>
                      <span className="routine-step-body">
                        <span className="l">
                          {s.title}
                          {s.kind === 'timer' && s.seconds ? <span className="routine-dur mono">{Math.round(s.seconds / 60)}m</span> : null}
                        </span>
                        {s.note && <span className="h">{s.note}</span>}
                        {s.example && <span className="ex mono">{s.example}</span>}
                        {s.link && <a className="routine-link" href={s.link} target="_blank" rel="noreferrer">{s.linkLabel ?? 'Open'} ↗</a>}
                      </span>
                    </div>
                  )
                })}
              </div>
              <div className="routine-card-foot">
                {linked && total > 0
                  ? <span className="assist-note">Finishing all {total} checks off “{linked.name}” in Habits.</span>
                  : linked
                    ? <span className="assist-note">Add steps here and finishing them will check off “{linked.name}”.</span>
                    : <span />}
                {(done > 0 || complete) && <button className="btn btn-ghost routine-reset" onClick={() => resetRoutine(r.id)}>Reset</button>}
              </div>
              </>
              )}
            </div>
          )
        })}
      </div>

      {adding && <AddRoutineSheet onClose={() => setAdding(false)} />}
    </div>
  )
}

/* ---------------- GOALS ---------------- */


/* One sheet for creating and editing. `goal` edits an existing one; `presetHabitId`
   opens it prefilled from a habit, which is how "set a goal on this habit" works. */
function GoalSheet({ onClose, goal, presetHabitId, thenGoToGoals }: {
  onClose: () => void
  goal?: Goal
  presetHabitId?: string
  /** Opened from a habit: show him the goal he just made, rather than saving
   *  it silently and leaving him staring at the page he started on. */
  thenGoToGoals?: boolean
}) {
  const { space, habits, addGoal, updateGoal, setPage, inView } = useStore()
  const preset = habits.find((h) => h.id === presetHabitId)
  const [d, setD] = useState({
    name: goal?.name ?? (preset ? preset.name : ''),
    why: goal?.why ?? '',
    target: goal?.target ?? (preset ? habitTarget(preset) * 4 : 3),
    unit: goal?.unit ?? 'steps',
    deadline: goal?.deadline ?? '',
    timeframe: goal?.timeframe ?? ('monthly' as GoalTimeframe),
    category: goal?.category ?? ('life' as GoalCategory),
    habitId: goal?.habitId ?? presetHabitId ?? '',
  })
  // Any habit in this profile can drive a goal, so the list grows as you do.
  const linkable = [...habits.filter((h) => inView(h.space) && !h.paused)].reverse()
  const linked = linkable.find((h) => h.id === d.habitId)

  const submit = () => {
    if (!d.name.trim()) return
    const shape = {
      name: d.name.trim(), target: Math.max(1, d.target),
      unit: d.habitId ? 'checkoffs' : (d.unit.trim() || 'steps'),
      why: d.why.trim() || undefined, deadline: d.deadline.trim() || undefined,
      timeframe: d.timeframe, category: d.category,
      habitId: d.habitId || undefined,
    }
    if (goal) updateGoal(goal.id, shape)
    else addGoal({ space, current: 0, note: '', milestones: [], ...shape })
    onClose()
    if (thenGoToGoals) setPage('goals')
  }

  const tracking = Boolean(d.habitId)
  /* The name follows the habit until he writes his own, then it is his and the
     picker stops touching it. */
  const [namedByHand, setNamedByHand] = useState(Boolean(goal?.name))

  return (
    <Sheet title={goal ? 'Edit this goal' : 'Add a goal'} onClose={onClose} note="A goal is an outcome you can check off, with a date on it.">
      {/* The first decision, not a dropdown three fields down: is this a goal you
          log yourself, or one of your habits counting itself? Asking it last is
          why it kept reading as "there is no way to pick a habit". */}
      <label className="field-label">What kind of goal?</label>
      <div className="kindpick">
        <button type="button" className={!tracking ? 'on' : ''} onClick={() => setD({ ...d, habitId: '' })}>
          <b>Something new</b>
          <span>You log the progress yourself</span>
        </button>
        <button
          type="button" className={tracking ? 'on' : ''}
          disabled={linkable.length === 0}
          title={linkable.length === 0 ? 'Create a habit first' : undefined}
          onClick={() => {
            const h = linkable.find((x) => x.id === d.habitId) ?? linkable[0]
            setD({ ...d, habitId: h?.id ?? '', name: namedByHand ? d.name : (h?.name ?? '') })
          }}
        >
          <b>Track one of my habits</b>
          <span>{linkable.length === 0 ? 'No habits yet' : 'It counts itself as you keep it'}</span>
        </button>
      </div>

      {tracking && (
        <>
          <label className="field-label" style={{ marginTop: 'var(--s4)' }} htmlFor="ghabit">Which habit?</label>
          <select id="ghabit" className="textinput" style={{ width: '100%' }} value={d.habitId}
            onChange={(e) => {
              const h = linkable.find((x) => x.id === e.target.value)
              setD({ ...d, habitId: e.target.value, name: namedByHand ? d.name : (h?.name ?? '') })
            }}>
            {linkable.map((h) => (
              <option key={h.id} value={h.id}>{h.name}{h.kind === 'break' ? ' (quitting)' : ''}</option>
            ))}
          </select>
          <p className="assist-note" style={{ marginTop: 6 }}>
            {linked ? `Every time “${linked.name}” is kept, this goal moves. Nothing to log twice.` : ''}
          </p>
        </>
      )}

      <label className="field-label" style={{ marginTop: 'var(--s4)' }} htmlFor="gname">What is the outcome?</label>
      <input id="gname" className="textinput" style={{ width: '100%' }} autoFocus
        placeholder="e.g. Twelve gym sessions" value={d.name}
        onChange={(e) => { setNamedByHand(true); setD({ ...d, name: e.target.value }) }}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />

      <label className="field-label" style={{ marginTop: 'var(--s4)' }} htmlFor="gwhy">Why does it matter?</label>
      <input id="gwhy" className="textinput" style={{ width: '100%' }}
        placeholder="The thing that keeps it alive when you do not feel like it"
        value={d.why} onChange={(e) => setD({ ...d, why: e.target.value })} />

      <div className="sheet-grid" style={{ marginTop: 'var(--s4)' }}>
        <div>
          <label className="field-label" htmlFor="gtf">Timeframe</label>
          <select id="gtf" className="textinput" style={{ width: '100%' }} value={d.timeframe}
            onChange={(e) => setD({ ...d, timeframe: e.target.value as GoalTimeframe })}>
            {GOAL_TIMEFRAMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="gcat">Area of life</label>
          <select id="gcat" className="textinput" style={{ width: '100%' }} value={d.category}
            onChange={(e) => setD({ ...d, category: e.target.value as GoalCategory })}>
            {GOAL_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
      </div>

      <div className="sheet-grid" style={{ marginTop: 'var(--s4)' }}>
        <div>
          <label className="field-label" htmlFor="gtarget">Target</label>
          <div className="sheet-inline">
            <input id="gtarget" className="numinput" type="number" min={1} value={d.target}
              onChange={(e) => setD({ ...d, target: Math.max(1, Number(e.target.value) || 1) })} />
            {d.habitId
              ? <span className="sheet-unit">checkoffs</span>
              : <input className="textinput" placeholder="unit, e.g. sessions" value={d.unit}
                  onChange={(e) => setD({ ...d, unit: e.target.value })} aria-label="Unit" />}
          </div>
        </div>
        <div>
          <label className="field-label" htmlFor="gdl">By when</label>
          <input id="gdl" className="textinput" style={{ width: '100%' }} placeholder="e.g. End of July"
            value={d.deadline} onChange={(e) => setD({ ...d, deadline: e.target.value })} />
        </div>
      </div>

      <div className="sheet-actions">
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!d.name.trim()} onClick={submit}>{goal ? 'Save changes' : 'Add goal'}</button>
      </div>
    </Sheet>
  )
}

export function GoalsPage() {
  const { space, goals, habits, habitLog, bumpGoal, toggleGoalMilestone, deleteGoal, repeatGoal, inView } = useStore()
  const all = goals.filter((g) => inView(g.space))
  /* A goal belongs to a period. The ones whose period has ended are not deleted
     and do not keep counting: they sit below with the number they finished on. */
  const spaceGoals = all.filter((g) => !g.closed)
  const past = all.filter((g) => g.closed).sort((a, b) => (a.closed!.on < b.closed!.on ? 1 : -1))
  const nowOf = (g: Goal) => goalCurrent(g, habits, habitLog, goalPeriodRange((g.timeframe ?? 'quarter') as GoalTf, g.periodKey ?? goalPeriodKey((g.timeframe ?? 'quarter') as GoalTf)))
  const done = spaceGoals.filter((g) => nowOf(g) >= g.target).length
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Goal | null>(null)

  return (
    <div className="page">
      <Band
        title="Goals"
        metrics={[{ v: `${done}/${spaceGoals.length}`, k: 'reached', tone: 'pos' as const }]}
        actions={<><WriteTo /><button className="btn btn-primary" onClick={() => setAdding(true)}>Add a goal</button></>}
      />

      <div className="grid-2 goal-cols">
        {GOAL_TIMEFRAMES.map((tfr) => {
          const inTf = spaceGoals.filter((g) => (g.timeframe ?? 'quarter') === tfr.id)
          return (
            <div className="panel goal-col" key={tfr.id}>
              <div className="col-head">
                <span className="microcap">{tfr.label}</span>
                <span className="col-tot mono">{tfr.sub}</span>
              </div>
              {inTf.map((g) => {
                // Habit-linked goals count themselves; the rest hold their own number.
                const current = nowOf(g)
                const fromHabit = habits.find((h) => h.id === g.habitId)
                const pct = Math.min(100, Math.round((current / g.target) * 100))
                const status = goalPace(current, g.target, g.timeframe ?? 'quarter')
                const milestoneDriven = !!g.milestones?.length && g.target === g.milestones.length
                const statusLabel = status === 'done' ? 'reached' : status === 'behind' ? 'needs a push' : 'on pace'
                return (
                  <div className="goal-card v2" key={g.id}>
                    <div className="goal-line">
                      <SpaceMark space={g.space} />
                      <span className={`cat-dot goalcat-${g.category ?? 'life'}`} aria-hidden="true" />
                      <span className="grow goal-obj">{g.name}</span>
                      <span className={`goal-status s-${status}`}>{statusLabel}</span>
                      <Dropdown label={`Options for ${g.name}`}>
                        <button role="menuitem" onClick={() => setEditing(g)}>Edit this goal</button>
                        <button role="menuitem" className="danger" onClick={() => deleteGoal(g.id)}>Delete this goal</button>
                      </Dropdown>
                    </div>
                    {g.why && <p className="goal-why">{g.why}</p>}
                    <div className={`bar prog${status === 'behind' ? ' warn' : ''}`}><i style={{ width: `${pct}%` }} /></div>
                    <div className="goal-measure">
                      <span className="mono meas">{fmtNum(current)} / {fmtNum(g.target)} {g.unit}</span>
                      <span className="mono pct">{pct}%</span>
                      {g.deadline && <span className="goal-deadline">by {g.deadline}</span>}
                    </div>
                    {fromHabit && (
                      <p className="goal-linked">Counts itself from the “{fromHabit.name}” habit.</p>
                    )}
                    {g.milestones && g.milestones.length > 0 && (
                      <ul className="goal-ms">
                        {g.milestones.map((m) => (
                          <li className={`goal-ms-item${m.done ? ' done' : ''}`} key={m.id}>
                            <button
                              className="goal-ms-check"
                              role="checkbox"
                              aria-checked={m.done}
                              aria-label={`${m.label}, ${m.done ? 'done' : 'not done'}`}
                              onClick={() => toggleGoalMilestone(g.id, m.id)}
                            >
                              {m.done && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6.5 5 9.5 10 3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                            </button>
                            <span>{m.label}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {/* Goals measured in their own milestones advance by ticking those;
                        anything counted in other units gets a manual logger. */}
                    {!milestoneDriven && !g.habitId && (
                      <div className="goal-actions">
                        <span className="goal-bump" role="group" aria-label={`Log progress for ${g.name}`}>
                          <button onClick={() => bumpGoal(g.id, -1)} disabled={current <= 0} aria-label="Less">−</button>
                          <span className="mono">log</span>
                          <button onClick={() => bumpGoal(g.id, 1)} disabled={current >= g.target} aria-label="More">+</button>
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
              {inTf.length === 0 && <p className="bucket-empty">No goals here yet.</p>}
            </div>
          )
        })}
      </div>

      {/* Where last week's goals went. They keep the number they finished on, and
          any of them can be set again for the period we are in now. */}
      {past.length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 'var(--s6)' }}>
            <span className="microcap">Finished periods</span>
            <span className="section-count mono">{past.length}</span>
          </div>
          <div className="panel">
            <div className="rowlist">
              {past.map((g) => {
                const tf = (g.timeframe ?? 'quarter') as GoalTf
                const label = goalPeriodRange(tf, g.periodKey ?? '').label
                const hit = g.closed!.final >= g.target
                return (
                  <div className="rowitem past-goal" key={g.id}>
                    <span className="grow">{g.name}</span>
                    <span className="meta">{label}</span>
                    <span className={`mono ${hit ? 'val-pos' : 'val-urgent'}`}>{fmtNum(g.closed!.final)} of {fmtNum(g.target)}</span>
                    <button className="btn btn-quiet" onClick={() => repeatGoal(g.id)}>Set it again</button>
                    <Dropdown label={`Options for ${g.name}`}>
                      <button role="menuitem" className="danger" onClick={() => deleteGoal(g.id)}>Delete this goal</button>
                    </Dropdown>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {adding && <GoalSheet onClose={() => setAdding(false)} />}
      {editing && <GoalSheet goal={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
