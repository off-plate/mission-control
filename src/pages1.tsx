import { useEffect, useMemo, useState } from 'react'
import { SpaceGrid } from './Grid'
import { MOCK_AGENDA, SPACE_LABELS, exceptionsFor } from './exceptions'
import { MOCK_MONEY, fakeDecompose } from './mock'
import { useStore } from './store'
import { MorningRoutine } from './morning'
import { Sheet } from './modals'
import { GOAL_CATEGORIES, GOAL_TIMEFRAMES, ON_TRACK_PCT, SLOTS, type AgendaEvent, type GoalCategory, type GoalTimeframe, type HabitDef, type RoutineCadence, type Task, type TaskCategory, type TimeSlot } from './types'
import { fmtDuration, fmtNum, fmtSigned, fmtTime, fmtTimeShort, gcalUrl, localDateKey, taskMinutes, toMin } from './util'

/* ---------------- shared bits ---------------- */

export function Band({
  title, sub, metrics, actions,
}: {
  title: string
  sub?: string
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
  const { space, tasks, routines, plan, editing, setEditing, setPage, savedMin, todayIndex, review, addTask, setCoachOpen, setFocusTaskId, sources } = useStore()
  const nextEvent = useNextEvent(space)
  const exceptions = exceptionsFor(space, { tasks, routines })
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
  const nextPay = MOCK_MONEY.schedule.find((r) => r.state === 'not sent' || r.state === 'action needed')

  return (
    <div className="page">
      <Band
        title={SPACE_LABELS[space]}
        sub={`${dateLine()} · Prague`}
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

      {exceptions.length > 0 ? (
        <div className="exceptions" role="alert" aria-label="Needs attention">
          {exceptions.map((x) => {
            const queued = x.task ? tasks.find((t) => t.title === x.task!.title) : undefined
            const resolved = queued?.done
            if (resolved) return null
            return (
              <div className="exception-row" key={x.id}>
                <span className="dot" aria-hidden="true" />
                <span>{x.text}</span>
                <span className="when">{x.when}</span>
                {x.action === 'add-task' && x.task && (
                  queued ? (
                    <span className="microcap" style={{ color: 'var(--progress)', marginLeft: 'var(--s2)' }}>queued for today</span>
                  ) : (
                    <button onClick={() => addTask({ title: x.task!.title, source: 'mc', estimateMin: x.task!.estimateMin, space, list: 'today', category: 'admin' })}>
                      {x.actionLabel}
                    </button>
                  )
                )}
                {x.action === 'coach' && (
                  <button onClick={() => { setCoachOpen(x.coachId ?? null); setPage('coach') }}>
                    {x.actionLabel ?? 'Walk me through it'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="allclear">
          <span className="dot" aria-hidden="true" />
          Nothing is on fire in this space.
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

const DAY_START = 0            // full day, midnight to midnight, shrunk to fit
const DAY_END = 24 * 60
const HOUR_PX = 42             // tall enough that a 30-minute block fits its own label

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
  const height = ((DAY_END - DAY_START) / 60) * HOUR_PX
  const y = (hhmm: string) => ((toMin(hhmm) - DAY_START) / 60) * HOUR_PX
  const pinned = tasks.filter((t) => t.at && !t.done)
  return (
    <div className="vsched">
      <div className="vsched-inner" style={{ height }}>
        {Array.from({ length: 25 }, (_, h) => (
          <div key={h} className="hline" style={{ top: h * HOUR_PX }}>
            {h % 2 === 0 && h < 24 && <span className="hlabel">{fmtTimeShort(`${h}:00`)}</span>}
          </div>
        ))}
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

export function PlanPage() {
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

  const [selected, setSelected] = useState<string[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [dropKey, setDropKey] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [logging, setLogging] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [quick, setQuick] = useState('')

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

  const toggleSel = (id: string) =>
    setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
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

  const selMin = backlogOpen.filter((t) => selected.includes(t.id)).reduce((a, t) => a + taskMinutes(t), 0)
  const dropTo = (key: TimeSlot | 'unsorted', id: string) => assignSlot(id, key === 'unsorted' ? undefined : key)

  return (
    <div className="page">
      <Band
        title={evening ? 'Plan tomorrow' : 'Plan the day'}
        sub={`${dateLine()} · Prague`}
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

        {/* 2 — To-do list: everything you added, any day */}
        <div className="panel">
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
          {/* Add a task plainly, or hand it to the breakdown when it feels too big. */}
          <div className="formrow" style={{ marginBottom: 'var(--s2)' }}>
            <input
              className="textinput"
              placeholder="Add something to the list"
              value={quick}
              onChange={(e) => setQuick(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && quick.trim()) { addTask({ title: quick.trim(), source: 'mc', estimateMin: 15, space, list: 'backlog', category: 'quick' }); setQuick('') } }}
              aria-label="New task"
            />
            <button className="btn btn-quiet" disabled={!quick.trim()} onClick={() => { addTask({ title: quick.trim(), source: 'mc', estimateMin: 15, space, list: 'backlog', category: 'quick' }); setQuick('') }}>Add</button>
          </div>
          <div className="formrow" style={{ marginBottom: 'var(--s3)' }}>
            <input
              className="textinput"
              placeholder="Too big? Break it down: e.g. Set up the bank payment plan"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') generate() }}
              aria-label="Goal to break into subtasks"
            />
            <button className="btn btn-primary" onClick={generate} disabled={busy || !goal.trim()}>{busy ? 'Thinking' : 'Break down'}</button>
          </div>
          {backlogOpen.map((t) => {
            const isExp = expanded.has(t.id)
            const hasSubs = !!t.subtasks?.length
            const doneSubs = t.subtasks?.filter((s) => s.done).length ?? 0
            return (
              <div className="todo-item" key={t.id}>
                <div className="todo-row">
                  <button
                    className={`select-box${selected.includes(t.id) ? ' on' : ''}`}
                    role="checkbox" aria-checked={selected.includes(t.id)} aria-label={`Select: ${t.title}`}
                    onClick={() => toggleSel(t.id)}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 6.5 5 9.5 10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                  </button>
                  <span className={`cat-dot ${t.category}`} aria-hidden="true" />
                  <span className="grow">{t.title}</span>
                  <span className="est-chip">~{taskMinutes(t)}m</span>
                  {hasSubs && (
                    <button className="expand-btn" aria-expanded={isExp} aria-label={isExp ? 'Collapse subtasks' : 'Expand subtasks'} onClick={() => toggleExp(t.id)}>
                      {isExp ? '▾' : '▸'} {doneSubs}/{t.subtasks!.length}
                    </button>
                  )}
                  <span className="kebab-wrap">
                    <button className="kebab" aria-label={`Options for ${t.title}`} aria-expanded={menuFor === t.id} onClick={() => setMenuFor((m) => (m === t.id ? null : t.id))}>⋯</button>
                    {menuFor === t.id && (
                      <div className="kebab-menu" role="menu">
                        <button role="menuitem" onClick={() => { moveTasksToToday([t.id]); setMenuFor(null) }}>Move to today</button>
                        <button role="menuitem" className="danger" onClick={() => { deleteTask(t.id); setMenuFor(null) }}>Delete</button>
                      </div>
                    )}
                  </span>
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
                          ) : (
                            <span className="est-chip">~{taskMinutes(t)}m</span>
                          )}
                          {hasSubs && (
                            <button className="expand-btn" aria-expanded={isExp} aria-label={isExp ? 'Collapse subtasks' : 'Expand subtasks'} onClick={() => toggleExp(t.id)}>
                              {isExp ? '▾' : '▸'} {doneSubs}/{t.subtasks!.length}
                            </button>
                          )}
                          <span className="kebab-wrap">
                            <button className="kebab" aria-label={`Options for ${t.title}`} aria-expanded={menuFor === t.id} onClick={() => setMenuFor((m) => (m === t.id ? null : t.id))}>⋯</button>
                            {menuFor === t.id && (
                              <div className="kebab-menu" role="menu">
                                {!t.done && BUCKETS.map((mb) => (
                                  <button key={mb.id} role="menuitemradio" aria-checked={(t.slot ?? 'unsorted') === mb.id} onClick={() => { dropTo(mb.id, t.id); setMenuFor(null) }}>
                                    {mb.label}
                                  </button>
                                ))}
                                {!t.done && <span className="kebab-sep" />}
                                {!t.done && (
                                  <button role="menuitem" onClick={() => { moveTaskList(t.id, 'backlog'); assignSlot(t.id, undefined); setMenuFor(null) }}>
                                    Back to the list
                                  </button>
                                )}
                                <button role="menuitem" className="danger" onClick={() => { deleteTask(t.id); setMenuFor(null) }}>Delete</button>
                              </div>
                            )}
                          </span>
                        </div>
                        {logging === t.id && (
                          <ActualLog est={taskMinutes(t)} onLog={(m) => { logActual(t.id, m); setLogging(null) }} onSkip={() => { toggleTask(t.id); setLogging(null) }} />
                        )}
                        {hasSubs && isExp && (
                          <div className="subtask-list">
                            {t.subtasks!.map((s) => (
                              <div key={s.id}>
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
                    : <span className="est-chip">~{taskMinutes(t)}m</span>}
                </div>
              ))}
            </div>
          )}
          {todayAll.length === 0 && (
            <p className="col-note">Select tasks in the to-do list and move them over, then drag them into a time of day.</p>
          )}
        </div>
      </div>

      {selected.length > 0 && (
        <div className="movebar" role="region" aria-label="Move selected tasks">
          <span className="movebar-count">{selected.length} selected · {fmtDuration(selMin)}</span>
          <button className="btn btn-ghost movebar-clear" onClick={() => setSelected([])}>Clear</button>
          <button className="btn btn-primary" onClick={() => { moveTasksToToday(selected); setSelected([]) }}>
            Move to today →
          </button>
        </div>
      )}
    </div>
  )
}

/* ---------------- HABITS ---------------- */

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function HabitRow({ h, todayIndex }: { h: HabitDef; todayIndex: number }) {
  const { toggleHabitDay } = useStore()
  const kept = h.days.filter(Boolean).length
  return (
    <div className="habit-row">
      <div className="habit-row-top">
        <span className="habit-name">{h.name}</span>
        <span className="habit-count mono">{kept}/7</span>
      </div>
      <div className="habit-days">
        {DAY_LABELS.map((d, i) => (
          <span className="day-cell" key={i}>
            <button
              className="daydot"
              role="checkbox"
              aria-checked={h.days[i]}
              disabled={i > todayIndex}
              aria-label={`${h.name}, ${d}`}
              onClick={() => toggleHabitDay(h.id, i)}
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 6.5 5 9.5 10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
            <span className={`day-lab${i === todayIndex ? ' today' : ''}`}>{d[0]}</span>
          </span>
        ))}
        <span className="habit-history only-wide" aria-label={`${h.name}, 12-week history`}>
          {(h.history ?? []).map((n, i) => (
            <i key={i} className={n >= 4 ? 'hi' : ''} style={{ height: `${Math.max(3, (n / 7) * 26)}px` }} />
          ))}
        </span>
      </div>
    </div>
  )
}

const DP_ORDER: (TimeSlot | 'anytime')[] = ['morning', 'noon', 'afternoon', 'evening', 'anytime']
const dpLabel = (dp?: TimeSlot) => (dp ? (SLOTS.find((s) => s.id === dp)?.label ?? 'Anytime') : 'Anytime')

export function HabitsPage() {
  const { habits, space, addHabit, togglePauseHabit, deleteHabit, routines, todayIndex } = useStore()
  const [name, setName] = useState('')
  const [daypart, setDaypart] = useState<TimeSlot | ''>('morning')
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const spaceHabits = habits.filter((h) => h.space === space)
  // A habit a routine drives cannot be deleted from here, or the routine would
  // mirror into nothing. Pausing stays available.
  const mirrored = new Set(routines.map((r) => r.habitId).filter(Boolean) as string[])
  const kept = spaceHabits.filter((h) => !h.paused).reduce((a, h) => a + h.days.filter(Boolean).length, 0)

  const sorted = [...spaceHabits].sort((a, b) => DP_ORDER.indexOf(a.daypart ?? 'anytime') - DP_ORDER.indexOf(b.daypart ?? 'anytime'))

  const add = () => {
    if (!name.trim()) return
    addHabit(name.trim(), daypart || undefined)
    setName('')
  }

  return (
    <div className="page">
      <Band title="Habits" sub={SPACE_LABELS[space]} metrics={[{ v: String(kept), k: 'checkoffs this week' }]} />
      <div className="panel" style={{ marginBottom: 'var(--s5)', maxWidth: 720 }}>
        <div className="formrow" style={{ marginBottom: 0 }}>
          <input
            className="textinput"
            placeholder="New habit"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add() }}
            aria-label="New habit name"
          />
          <select className="textinput" style={{ flex: '0 0 auto' }} value={daypart} onChange={(e) => setDaypart(e.target.value as TimeSlot | '')} aria-label="Part of day">
            {SLOTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            <option value="">Anytime</option>
          </select>
          <button className="btn btn-primary" disabled={!name.trim()} onClick={add}>Add habit</button>
        </div>
      </div>

      <div className="grid-4 habit-cards">
        {sorted.map((h) => (
          <div className={`panel habit-card${h.paused ? ' is-paused' : ''}`} key={h.id}>
            <div className="habit-card-tag">
              <span className="microcap">{dpLabel(h.daypart)}</span>
              {h.paused && <span className="col-tot mono">paused</span>}
              {!h.paused && h.days[todayIndex] && <span className="col-tot mono val-pos">done today</span>}
              <span className="kebab-wrap habit-kebab">
                <button className="kebab" aria-label={`Options for ${h.name}`} aria-expanded={menuFor === h.id} onClick={() => setMenuFor((m) => (m === h.id ? null : h.id))}>⋯</button>
                {menuFor === h.id && (
                  <div className="kebab-menu" role="menu">
                    <button role="menuitem" onClick={() => { togglePauseHabit(h.id); setMenuFor(null) }}>
                      {h.paused ? 'Resume' : 'Pause'}
                    </button>
                    {mirrored.has(h.id) ? (
                      <span className="kebab-note">Run by a routine</span>
                    ) : (
                      <button role="menuitem" className="danger" onClick={() => { deleteHabit(h.id); setMenuFor(null) }}>Delete</button>
                    )}
                  </div>
                )}
              </span>
            </div>
            <HabitRow h={h} todayIndex={todayIndex} />
          </div>
        ))}
        {sorted.length === 0 && <div className="empty">No habits in this space yet. Add one above.</div>}
      </div>

      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginTop: 16 }}>
        Missed days stay quiet on purpose. No broken streaks, no wall of missed-day marks. Multi-step routines live on the Routines tab; finishing one there checks its habit off here.
      </p>
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
      <Band title="Routines" sub={SPACE_LABELS[space]} />
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
                <span className="microcap">{CADENCE_LABEL[r.cadence]}</span>
                {complete
                  ? <span className="col-tot mono val-pos">{DONE_LABEL[r.cadence]}</span>
                  : <span className="routine-progress mono">{done}/{total}</span>}
              </div>
              <span className="routine-card-title">{r.title}</span>
              {r.blurb && <p className="routine-blurb">{r.blurb}</p>}
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
                {linked
                  ? <span className="assist-note">Finishing all {total} checks off “{linked.name}” in Habits.</span>
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


export function GoalsPage() {
  const { space, goals, bumpGoal, toggleGoalMilestone, addGoal, deleteGoal } = useStore()
  const spaceGoals = goals.filter((g) => g.space === space)
  const done = spaceGoals.filter((g) => g.current >= g.target).length
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ name: '', why: '', target: 1, unit: 'steps', deadline: '', timeframe: 'weekly' as GoalTimeframe, category: 'life' as GoalCategory })

  const submit = () => {
    if (!draft.name.trim()) return
    addGoal({
      space, name: draft.name.trim(), current: 0, target: Math.max(1, draft.target), unit: draft.unit.trim() || 'steps',
      note: '', why: draft.why.trim() || undefined, deadline: draft.deadline.trim() || undefined,
      timeframe: draft.timeframe, category: draft.category, milestones: [],
    })
    setDraft({ name: '', why: '', target: 1, unit: 'steps', deadline: '', timeframe: draft.timeframe, category: draft.category })
    setAdding(false)
  }

  return (
    <div className="page">
      <Band
        title="Goals"
        sub={SPACE_LABELS[space]}
        metrics={[{ v: `${done}/${spaceGoals.length}`, k: 'reached', tone: 'pos' as const }]}
        actions={<button className="btn btn-primary" onClick={() => setAdding((v) => !v)}>{adding ? 'Cancel' : 'Add a goal'}</button>}
      />

      {adding && (
        <div className="panel goal-add">
          <div className="formrow">
            <input className="textinput grow" placeholder="The outcome, not the activity" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Objective" autoFocus />
            <select className="textinput" value={draft.timeframe} onChange={(e) => setDraft({ ...draft, timeframe: e.target.value as GoalTimeframe })} aria-label="Timeframe">
              {GOAL_TIMEFRAMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <select className="textinput" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as GoalCategory })} aria-label="Category">
              {GOAL_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div className="formrow">
            <input className="textinput grow" placeholder="Why it matters (the thing that keeps it alive)" value={draft.why} onChange={(e) => setDraft({ ...draft, why: e.target.value })} aria-label="Why" />
            <input className="numinput" type="number" min={1} value={draft.target} onChange={(e) => setDraft({ ...draft, target: Number(e.target.value) })} aria-label="Target" />
            <input className="textinput" style={{ maxWidth: 130 }} placeholder="unit" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} aria-label="Unit" />
            <input className="textinput" style={{ maxWidth: 160 }} placeholder="by when" value={draft.deadline} onChange={(e) => setDraft({ ...draft, deadline: e.target.value })} aria-label="Deadline" />
            <button className="btn btn-primary" disabled={!draft.name.trim()} onClick={submit}>Add</button>
          </div>
        </div>
      )}

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
                const pct = Math.min(100, Math.round((g.current / g.target) * 100))
                const status = g.current >= g.target ? 'done' : pct < ON_TRACK_PCT ? 'behind' : 'ontrack'
                const milestoneDriven = !!g.milestones?.length && g.target === g.milestones.length
                const statusLabel = status === 'done' ? 'reached' : status === 'behind' ? 'behind' : 'on track'
                return (
                  <div className="goal-card v2" key={g.id}>
                    <div className="goal-line">
                      <span className={`cat-dot goalcat-${g.category ?? 'life'}`} aria-hidden="true" />
                      <span className="grow goal-obj">{g.name}</span>
                      <span className={`goal-status s-${status}`}>{statusLabel}</span>
                    </div>
                    {g.why && <p className="goal-why">{g.why}</p>}
                    <div className={`bar prog${status === 'behind' ? ' warn' : ''}`}><i style={{ width: `${pct}%` }} /></div>
                    <div className="goal-measure">
                      <span className="mono meas">{fmtNum(g.current)} / {fmtNum(g.target)} {g.unit}</span>
                      <span className="mono pct">{pct}%</span>
                      {g.deadline && <span className="goal-deadline">by {g.deadline}</span>}
                    </div>
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
                    <div className="goal-actions">
                      {!milestoneDriven && (
                        <span className="goal-bump" role="group" aria-label={`Log progress for ${g.name}`}>
                          <button onClick={() => bumpGoal(g.id, -1)} disabled={g.current <= 0} aria-label="Less">−</button>
                          <span className="mono">log</span>
                          <button onClick={() => bumpGoal(g.id, 1)} disabled={g.current >= g.target} aria-label="More">+</button>
                        </span>
                      )}
                      <button className="goal-drop" onClick={() => deleteGoal(g.id)} aria-label={`Drop goal ${g.name}`}>drop</button>
                    </div>
                  </div>
                )
              })}
              {inTf.length === 0 && <p className="bucket-empty">No goals here yet.</p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
