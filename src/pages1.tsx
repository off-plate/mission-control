import { useEffect, useMemo, useRef, useState } from 'react'
import { SpaceGrid } from './Grid'
import { MOCK_AGENDA, SPACE_LABELS, exceptionsFor, globalExceptions, momentum } from './exceptions'
import { MOCK_MONEY, fakeDecompose } from './mock'
import { useStore } from './store'
import { usePomodoro } from './pomodoro'
import { MorningRoutine } from './morning'
import { BreakdownSheet, Sheet } from './modals'
import { GOAL_CATEGORIES, GOAL_TIMEFRAMES, HABIT_FREQUENCIES, SLOTS, daysSinceSlip, goalCurrent, habitFrequencyLabel, habitTarget, type AgendaEvent, type GoalCategory, type GoalTimeframe, type Goal, type HabitDef, type HabitFrequency, type HabitKind, type RoutineCadence, type Task, type TaskCategory, type TimeSlot } from './types'
import { estimateFor } from './estimate'
import { fmtDuration, fmtNum, fmtSigned, goalPace, fmtTime, fmtTimeShort, fmtWhen, gcalUrl, isEstimated, localDateKey, taskMinutes, toMin } from './util'

/* ---------------- shared bits ---------------- */

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
  const { space, tasks, routines, habits, coachSessions, plan, editing, setEditing, setPage, savedMin, todayIndex, review, addTask, deleteTask, setCoachOpen, setFocusTaskId, sources } = useStore()
  const nextEvent = useNextEvent(space)
  const exceptions = exceptionsFor(space, { tasks, routines })
  /* Money and official post follow you into Work and Off-Plate. Sitting in the
     Work profile all day used to mean the app told you nothing was wrong. */
  const shownExceptions = space === 'personal'
    ? exceptions
    : [...globalExceptions({ tasks, routines }), ...exceptions]
  const open = tasks.filter((t) => t.space === space && t.list === 'today' && !t.done)
  const DREAD_RANK = { admin: 0, call: 1, deep: 2, quick: 3 }
  const alertTaskTitles = new Set(exceptions.map((x) => x.task?.title).filter(Boolean) as string[])
  const alertRank = (t: Task) => (alertTaskTitles.has(t.title) ? 0 : 1)
  const firstMove =
    open.find((t) => alertTaskTitles.has(t.title)) ??
    tasks.find((t) => t.id === plan.firstMoveId && !t.done && t.space === space) ??
    [...open].sort((a, b) => alertRank(a) - alertRank(b) || DREAD_RANK[a.category] - DREAD_RANK[b.category])[0]
  const [addOpen, setAddOpen] = useState(false)
  const reviewDue = todayIndex === 6 && review.lastDoneDate !== localDateKey()
  const evening = new Date().getHours() >= 21
  // Next payment badge derives from the money schedule instead of a hardcoded string.
  const nextPay = MOCK_MONEY?.schedule.find((r) => r.state === 'not sent' || r.state === 'action needed')
  const wins = momentum({ tasks: tasks.filter((t) => t.space === space), routines, habits: habits.filter((h) => h.space === space), coachSessions })

  return (
    <div className="page">
      <Band
        title={SPACE_LABELS[space]}
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
              <span className="microcap fm-label">{evening ? 'First move tomorrow' : 'First move'}</span>
              <span className="fm-title">{firstMove.title}</span>
              <span className="est-chip">~{firstMove.estimateMin}m</span>
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
  const { spaces, space, addWidget } = useStore()
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

/** Vertical day timeline: calendar events plus any task pinned to a clock time. Full height, no inner scroll. */
function Schedule({ events, tasks }: { events: AgendaEvent[]; tasks: Task[] }) {
  const pinned = tasks.filter((t) => t.at && !t.done)
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
  const startH = START_H
  const endH = END_H
  const DAY_START = startH * 60
  const hours = endH - startH
  const height = hours * HOUR_PX
  const y = (hhmm: string) => ((toMin(hhmm) - DAY_START) / 60) * HOUR_PX
  return (
    <div className="vsched">
      <div className="vsched-inner" style={{ height }}>
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
          <div className="vev vev-task" key={t.id} style={{ top: y(t.at!) + 1, height: Math.max((taskMinutes(t) / 60) * HOUR_PX - 2, 42) }}>
            <TaskName title={t.title} start={t.at} className="t" />
            <span className="rng">{fmtTime(t.at!)} · task</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const BUCKETS: { id: TimeSlot | 'unsorted'; label: string; hint?: string }[] = [
  { id: 'unsorted', label: 'Unsorted', hint: 'drag into a time' },
  ...SLOTS.map((s) => ({ id: s.id, label: s.label, hint: s.hint })),
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


/* Breaking a task down and estimating it are actions on the task itself. */
function TaskActions({ task, onFocus }: { task: Task; onFocus?: () => void }) {
  const { setEstimate } = useStore()
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

export function PlanPage() {
  const { startFocus } = usePomodoro()
  const { space, tasks, toggleTask, logActual, assignSlot, toggleSubtask, logSubtaskActual, moveTasksToToday, moveTaskList, deleteTask, addTask, addTaskWithSubtasks, focusTaskId, setFocusTaskId } = useStore()
  const evening = new Date().getHours() >= 21
  const events = MOCK_AGENDA[space]

  const spaceTasks = tasks.filter((t) => t.space === space)
  const backlogOpen = spaceTasks.filter((t) => !t.done && t.list === 'backlog') // the to-do pool
  const todayAll = spaceTasks.filter((t) => t.list === 'today')  // today incl. finished (they stay, struck)
  const todayTasks = todayAll.filter((t) => !t.done)             // still to do
  const doneUnsorted = todayAll.filter((t) => t.done && !t.slot) // finished, never scheduled
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
  const dropToList = (id: string) => {
    const t = tasks.find((x) => x.id === id)
    if (!t || t.list === 'backlog') return
    moveTaskList(id, 'backlog')
    assignSlot(id, undefined)
  }

  return (
    <div className="page">
      <Band
        title={evening ? 'Plan tomorrow' : 'Plan the day'}
        metrics={[
          { v: fmtDuration(plannedMin), k: 'planned today', tone: 'info' as const },
          { v: `${donePct}%`, k: 'to-do done', tone: 'pos' as const },
        ]}
      />
      <div className="grid-3 plan-cols">
        {/* 1 — Schedule */}
        <div className="panel">
          <span className="microcap">Schedule</span>
          <Schedule events={events} tasks={todayTasks} />
          <p className="col-note">Google Calendar for today. Click any name to open or schedule it in Calendar.</p>
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
                  {isEstimated(t) ? <span className="est-chip">~{taskMinutes(t)}m</span> : <span className="est-chip is-none">no estimate</span>}
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
                        <span className="est-chip">~{s.estimateMin}m</span>
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
          {BUCKETS.map((b) => {
            // A finished task is not waiting to be scheduled, so it drops out of
            // Unsorted and joins the done group at the bottom.
            const inBucket = todayAll.filter((t) => (t.slot ?? 'unsorted') === b.id && !(b.id === 'unsorted' && t.done))
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
                  {b.hint && <span className="bucket-hint">{b.hint}</span>}
                  {tot > 0 && <span className="tot mono">{fmtDuration(tot)}</span>}
                </div>
                {inBucket.length === 0 ? (
                  <p className="bucket-empty">Drop a task here.</p>
                ) : (
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
                          <button
                            className="checkbox" role="checkbox" aria-checked={t.done}
                            aria-label={t.done ? `Reopen: ${t.title}` : `Complete: ${t.title}`}
                            onClick={() => {
                              if (t.done) { toggleTask(t.id); return }        // reopen
                              if (t.subtasks?.length) { toggleTask(t.id); return } // subtasked: time comes from subtasks
                              setLogging(t.id)                                 // flat: ask how long it took
                            }}
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 6.5 5 9.5 10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                          </button>
                          <span className={`cat-dot ${t.category}`} aria-hidden="true" />
                          <TaskName title={t.title} start={t.at} className="grow" />
                          {t.done && t.actualMin != null ? (
                            <span className="est-vs-actual mono">~{taskMinutes(t)} → {t.actualMin}m <b className={taskMinutes(t) - t.actualMin >= 0 ? 'val-pos' : 'val-urgent'}>{taskMinutes(t) - t.actualMin >= 0 ? '+' : ''}{taskMinutes(t) - t.actualMin}m</b></span>
                          ) : isEstimated(t) ? (
                            <span className="est-chip">~{taskMinutes(t)}m</span>
                          ) : (
                            <span className="est-chip is-none">no estimate</span>
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
                            {!t.done && (
                              <button role="menuitem" onClick={() => { moveTaskList(t.id, 'backlog'); assignSlot(t.id, undefined) }}>Back to the list</button>
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
                                    <span className="est-vs-actual mono">~{s.estimateMin} → {s.actualMin}m <b className={s.estimateMin - s.actualMin >= 0 ? 'val-pos' : 'val-urgent'}>{s.estimateMin - s.actualMin >= 0 ? '+' : ''}{s.estimateMin - s.actualMin}m</b></span>
                                  ) : (
                                    <span className="est-chip">~{s.estimateMin}m</span>
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
                    ? <span className="est-vs-actual mono">~{taskMinutes(t)} → {t.actualMin}m</span>
                    : isEstimated(t)
                      ? <span className="est-chip">~{taskMinutes(t)}m</span>
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

function HabitRow({ h, todayIndex, actions, drivenBy, progress }: {
  h: HabitDef
  todayIndex: number
  actions?: React.ReactNode
  /** Name of the routine that ticks this habit, when one does. */
  drivenBy?: string
  /** Today's progress through the routine that drives this habit. */
  progress?: { done: number; total: number }
}) {
  const { toggleHabitDay, logSlip, setPage } = useStore()
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

  /* A quit is a different scoreboard: days clean, and a single honest button
     for the day you slip. Day dots would be asking the wrong question. */
  if (h.kind === 'break') {
    const clean = daysSinceSlip(h) ?? 0
    return (
      <div className="habit-row is-quit">
        <div className="habit-row-top">
          <span className="habit-name">{h.name}</span>
          {actions}
        </div>
        <div className="quit-run">
          <span className="quit-days mono">{clean}</span>
          <span className="quit-unit">{clean === 1 ? 'day' : 'days'} without it</span>
        </div>
        <div className="habit-foot">
          <button className="quit-slip" onClick={() => logSlip(h.id)}>I slipped today</button>
          {h.lastSlip && clean > 0 && <span className="habit-weeks">last slip {fmtWhen(h.lastSlip)}</span>}
        </div>
      </div>
    )
  }

  return (
    <div className={`habit-row${drivenBy ? ' is-auto' : ''}`}>
      <div className="habit-row-top">
        <span className="habit-name">{h.name}</span>
        <span className="habit-count mono">{kept}/{target}<span className="habit-freq">{habitFrequencyLabel(h)}</span></span>
        {actions}
      </div>
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
      <div className="habit-foot">
        {drivenBy ? (
          <button className="habit-auto" onClick={() => setPage('routines')}>
            {progress && progress.total > 1 && progress.done < progress.total
              ? `${progress.done} of ${progress.total} steps done in ${drivenBy}`
              : `Ticks itself when you finish ${drivenBy}`}
          </button>
        ) : (
          <span className="habit-manual">You tick this one</span>
        )}
        {trend && <span className="habit-weeks">{trend}</span>}
      </div>
    </div>
  )
}

/* Habits are grouped by the part of the day they belong to, each group in its
   own column with its own heading, so you read down "Morning" instead of
   hunting a flat grid for which card happens to be an evening one. */
const DAYPART_COLS: { id: TimeSlot | 'anytime'; label: string; hint: string }[] = [
  { id: 'morning', label: 'Morning', hint: 'before noon' },
  { id: 'noon', label: 'Noon', hint: '12 to 2 PM' },
  { id: 'afternoon', label: 'Afternoon', hint: '2 to 6 PM' },
  { id: 'evening', label: 'Evening', hint: 'after 6 PM' },
  { id: 'anytime', label: 'Anytime', hint: 'no fixed hour' },
]

/* One sheet for adding and editing. A habit a routine drives keeps its name and
   frequency in step with that routine, so those fields are read-only here. */
function HabitSheet({ onClose, habit, drivenBy }: { onClose: () => void; habit?: HabitDef; drivenBy?: string }) {
  const { addHabit, updateHabit } = useStore()
  const [name, setName] = useState(habit?.name ?? '')
  const [daypart, setDaypart] = useState<TimeSlot | ''>(habit?.daypart ?? 'morning')
  const [frequency, setFrequency] = useState<HabitFrequency>(habit?.frequency ?? 'daily')
  const [perWeek, setPerWeek] = useState(habit?.targetPerWeek ?? 3)
  const [kind, setKind] = useState<HabitKind>(habit?.kind ?? 'build')
  const locked = !!drivenBy
  const quitting = kind === 'break'

  const submit = () => {
    if (!name.trim()) return
    const shape = {
      name: name.trim(),
      daypart: daypart || undefined,
      frequency,
      targetPerWeek: frequency === 'times-per-week' ? perWeek : undefined,
      kind,
    }
    if (habit) updateHabit(habit.id, locked ? { daypart: shape.daypart } : shape)
    else addHabit(shape)
    onClose()
  }

  return (
    <Sheet
      title={habit ? 'Edit this habit' : 'Add a habit'}
      onClose={onClose}
      note={locked
        ? `This habit is kept by the ${drivenBy} routine, so its name and frequency follow that routine. You can still move it to a different part of the day.`
        : 'Habits are the small things you repeat. Multi-step rituals belong on Routines.'}
    >
      <span className="field-label">Which kind is this?</span>
      <div className="seg kind-seg" role="group" aria-label="Kind of habit">
        <button aria-pressed={kind === 'build'} disabled={locked} onClick={() => setKind('build')}>Something to keep</button>
        <button aria-pressed={kind === 'break'} disabled={locked} onClick={() => setKind('break')}>Something to quit</button>
      </div>
      <p className="assist-note" style={{ marginTop: 6, marginBottom: 'var(--s4)' }}>
        {quitting
          ? 'Counted the other way round: the score is how long you have gone without it, and you only touch it on a day you slip.'
          : 'Counted the usual way: every day you do it is a tick, against a target for the week.'}
      </p>

      <label className="field-label" htmlFor="hname">{quitting ? 'What are you quitting?' : 'What is the habit?'}</label>
      <input
        id="hname" className="textinput" style={{ width: '100%' }} autoFocus={!locked} disabled={locked}
        placeholder="e.g. 20 minutes of movement"
        value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
      />

      <label className="field-label" style={{ marginTop: 'var(--s4)' }} htmlFor="hpart">When in the day?</label>
      <select id="hpart" className="textinput" style={{ width: '100%' }} value={daypart} onChange={(e) => setDaypart(e.target.value as TimeSlot | '')}>
        {SLOTS.map((s) => <option key={s.id} value={s.id}>{s.label}, {s.hint}</option>)}
        <option value="">Anytime</option>
      </select>

      {!quitting && <label className="field-label" style={{ marginTop: 'var(--s4)' }} htmlFor="hfreq">How often?</label>}
      {!quitting && (
        <select id="hfreq" className="textinput" style={{ width: '100%' }} value={frequency} disabled={locked} onChange={(e) => setFrequency(e.target.value as HabitFrequency)}>
          {HABIT_FREQUENCIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      )}

      {!quitting && frequency === 'times-per-week' && (
        <div className="sheet-inline" style={{ marginTop: 'var(--s3)' }}>
          <span>Aiming for</span>
          <input className="numinput" type="number" min={1} max={7} value={perWeek}
            onChange={(e) => setPerWeek(Math.max(1, Math.min(7, Number(e.target.value) || 1)))} aria-label="Days a week" />
          <span>days a week</span>
        </div>
      )}

      <div className="sheet-actions">
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!name.trim()} onClick={submit}>{habit ? 'Save changes' : 'Add habit'}</button>
      </div>
    </Sheet>
  )
}

export function HabitsPage() {
  const { habits, goals, space, deleteHabit, routines, todayIndex } = useStore()
  const [adding, setAdding] = useState(false)
  // Opening the goal sheet from a habit is the "set a goal on this" path.
  const [goalFor, setGoalFor] = useState<string | null>(null)
  const [editHabit, setEditHabit] = useState<HabitDef | null>(null)
  const goalOn = new Map(goals.filter((g) => g.habitId).map((g) => [g.habitId as string, g]))
  const spaceHabits = habits.filter((h) => h.space === space)
  // A habit a routine drives cannot be deleted from here, or the routine would
  // mirror into nothing. Pausing stays available.
  const drivenBy = new Map(routines.filter((r) => r.habitId).map((r) => [r.habitId as string, r.title]))
  // Today's step progress for each routine-driven habit.
  const progressFor = new Map(routines.filter((r) => r.habitId).map((r) => [
    r.habitId as string, { done: r.doneStepIds.length, total: r.steps.length },
  ]))
  const building = spaceHabits.filter((h) => !h.paused && h.kind !== 'break')
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
        actions={<button className="btn btn-primary" onClick={() => setAdding(true)}>Add a habit</button>}
      />

      {/* One band per part of the day: a heading, a rule, then that group's
          habits side by side across the full width. Groups stack down the page,
          so a busy morning never leaves a short evening column stranded. */}
      {cols.map((c) => (
        <section className="habit-section" key={c.id}>
          <div className="section-head">
            <span className="microcap">{c.label}</span>
            <span className="section-hint">{c.hint}</span>
            <span className="section-count mono">{c.list.length}</span>
          </div>
          <div className="habit-grid">
            {c.list.map((h) => (
              <div className={`panel habit-card${h.paused ? ' is-paused' : ''}`} key={h.id}>
                <HabitRow h={h} todayIndex={todayIndex} drivenBy={drivenBy.get(h.id)} progress={progressFor.get(h.id)} actions={
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

      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginTop: 16 }}>
        Missed days stay quiet on purpose. No broken streaks, no wall of missed-day marks. Multi-step routines live on the Routines tab; finishing one there checks its habit off here.
      </p>

      {adding && <HabitSheet onClose={() => setAdding(false)} />}
      {editHabit && <HabitSheet habit={editHabit} drivenBy={drivenBy.get(editHabit.id)} onClose={() => setEditHabit(null)} />}
      {goalFor && <GoalSheet presetHabitId={goalFor} onClose={() => setGoalFor(null)} />}
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

export function RoutinesPage() {
  const { routines, space, toggleRoutineStep, resetRoutine, habits } = useStore()
  const spaceRoutines = routines.filter((r) => r.space === space)
  const sorted = [...spaceRoutines].sort((a, b) => CADENCE_ORDER.indexOf(a.cadence) - CADENCE_ORDER.indexOf(b.cadence))
  return (
    <div className="page">
      <Band title="Routines" />
      <div className="routine-cards">
        {sorted.length === 0 && <div className="empty">No routines in this space yet.</div>}
        {sorted.map((r) => {
          if (r.id === 'r-morning') return <MorningRoutine routine={r} key={r.id} />
          const total = r.steps.length
          const done = r.doneStepIds.length
          const complete = total > 0 && done === total
          const linked = r.habitId ? habits.find((h) => h.id === r.habitId) : null
          return (
            <div className={`panel routine-card${complete ? ' is-complete' : ''}`} key={r.id}>
              <div className="routine-tag">
                <span className="routine-card-title">{r.title}</span>
                {complete
                  ? <span className="col-tot mono val-pos">{DONE_LABEL[r.cadence]}</span>
                  : <span className="routine-progress mono">{done}/{total}</span>}
              </div>
              {r.blurb && <p className="routine-blurb">{r.blurb}</p>}
              {total === 0 && (
                <p className="routine-empty">No steps yet. This one is yours to fill in.</p>
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
                {done > 0 && <button className="btn btn-ghost routine-reset" onClick={() => resetRoutine(r.id)}>Reset</button>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ---------------- GOALS ---------------- */


/* One sheet for creating and editing. `goal` edits an existing one; `presetHabitId`
   opens it prefilled from a habit, which is how "set a goal on this habit" works. */
function GoalSheet({ onClose, goal, presetHabitId }: {
  onClose: () => void
  goal?: Goal
  presetHabitId?: string
}) {
  const { space, habits, addGoal, updateGoal } = useStore()
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
  const linkable = [...habits.filter((h) => h.space === space && !h.paused)].reverse()
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
  }

  return (
    <Sheet title={goal ? 'Edit this goal' : 'Add a goal'} onClose={onClose} note="A goal is an outcome you can check off, with a date on it.">
      <label className="field-label" htmlFor="gname">What is the outcome?</label>
      <input id="gname" className="textinput" style={{ width: '100%' }} autoFocus
        placeholder="e.g. Twelve gym sessions" value={d.name}
        onChange={(e) => setD({ ...d, name: e.target.value })}
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

      {/* The cross-link: a goal can count itself off a habit you already keep.
          Newest habits first, so one you just made is the first thing you see. */}
      <label className="field-label" style={{ marginTop: 'var(--s4)' }} htmlFor="ghabit">How is progress counted?</label>
      <select id="ghabit" className="textinput" style={{ width: '100%' }} value={d.habitId}
        onChange={(e) => setD({ ...d, habitId: e.target.value })}>
        <option value="">I will log it myself</option>
        {linkable.map((h) => (
          <option key={h.id} value={h.id}>Automatically, from the “{h.name}” habit</option>
        ))}
      </select>
      <p className="assist-note" style={{ marginTop: 6 }}>
        {linked
          ? `Every time you tick “${linked.name}” on Habits, this goal moves. Nothing to log twice.`
          : linkable.length > 0
            ? 'Pick a habit above and this goal counts itself as you keep it.'
            : 'Create a habit first and a goal can count itself off it.'}
      </p>

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
  const { space, goals, habits, bumpGoal, toggleGoalMilestone, deleteGoal } = useStore()
  const spaceGoals = goals.filter((g) => g.space === space)
  const done = spaceGoals.filter((g) => goalCurrent(g, habits) >= g.target).length
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Goal | null>(null)

  return (
    <div className="page">
      <Band
        title="Goals"
        metrics={[{ v: `${done}/${spaceGoals.length}`, k: 'reached', tone: 'pos' as const }]}
        actions={<button className="btn btn-primary" onClick={() => setAdding(true)}>Add a goal</button>}
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
                const current = goalCurrent(g, habits)
                const fromHabit = habits.find((h) => h.id === g.habitId)
                const pct = Math.min(100, Math.round((current / g.target) * 100))
                const status = goalPace(current, g.target, g.timeframe ?? 'quarter')
                const milestoneDriven = !!g.milestones?.length && g.target === g.milestones.length
                const statusLabel = status === 'done' ? 'reached' : status === 'behind' ? 'needs a push' : 'on pace'
                return (
                  <div className="goal-card v2" key={g.id}>
                    <div className="goal-line">
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

      {adding && <GoalSheet onClose={() => setAdding(false)} />}
      {editing && <GoalSheet goal={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
