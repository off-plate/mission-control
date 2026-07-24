import { useEffect, useMemo, useState } from 'react'
import { SpaceGrid } from './Grid'
import { MOCK_AGENDA, MOCK_EXCEPTIONS_FOR, SPACE_LABELS } from './exceptions'
import { fakeDecompose } from './mock'
import { useStore } from './store'
import { RoutineRunner } from './modals'
import { SLOTS, type AgendaEvent, type HabitDef, type Task, type TaskCategory, type TimeSlot } from './types'
import { fmtDuration, fmtTime, fmtTimeShort, gcalUrl, taskMinutes, toMin } from './util'

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
        {sub && <span className="sub">{sub}</span>}
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
  const { space, tasks, plan, editing, setEditing, setPage, savedMin, todayIndex, review, addTask, setCoachOpen, setFocusTaskId, sources } = useStore()
  const nextEvent = useNextEvent(space)
  const exceptions = MOCK_EXCEPTIONS_FOR(space)
  const open = tasks.filter((t) => t.space === space && t.list === 'today' && !t.done)
  const DREAD_RANK = { admin: 0, call: 1, deep: 2, quick: 3 }
  const alertTaskTitles = new Set(exceptions.map((x) => x.task?.title).filter(Boolean) as string[])
  const alertRank = (t: Task) => (alertTaskTitles.has(t.title) ? 0 : 1)
  const firstMove =
    open.find((t) => alertTaskTitles.has(t.title)) ??
    tasks.find((t) => t.id === plan.firstMoveId && !t.done && t.space === space) ??
    [...open].sort((a, b) => alertRank(a) - alertRank(b) || DREAD_RANK[a.category] - DREAD_RANK[b.category])[0]
  const [addOpen, setAddOpen] = useState(false)
  const reviewDue = todayIndex === 6 && review.lastDoneDate !== new Date().toISOString().slice(0, 10)
  const evening = new Date().getHours() >= 21

  return (
    <div className="page">
      <Band
        title={SPACE_LABELS[space]}
        sub={`${dateLine()} · Prague`}
        metrics={[
          { v: nextEvent.v, k: nextEvent.k, tone: 'info' as const },
          { v: String(open.length), k: 'tasks open' },
          ...(space === 'personal' ? [{ v: '2 400 Kč Fri', k: 'next payment', tone: 'urgent' as const }] : [{ v: `${Math.floor(savedMin / 60)}h ${savedMin % 60}m`, k: 'under estimate', tone: 'pos' as const }]),
        ]}
        actions={
          <>
            <button className="btn btn-quiet hide-phone" aria-pressed={editing} onClick={() => setEditing(!editing)}>
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
              <button className="btn btn-primary" onClick={() => { setFocusTaskId(firstMove.id); setPage('tasks') }}>Start</button>
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

      <div className="status-strip" aria-label="Background numbers">
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

function AddWidgetInline({ onClose }: { onClose: () => void }) {
  const { spaces, space, addWidget } = useStore()
  const present = new Set(spaces[space].map((w) => w.type))
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Add a widget">
        <div className="sheet-head">
          <h2>Add a widget</h2>
          <button className="close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="sheet-body">
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
        </div>
        <div className="demo-note">
          The real app also gets a generic source widget: point it at any API or MCP connection and template the result.
        </div>
      </div>
    </div>
  )
}

import { WIDGET_DEFS } from './mock'
const WIDGET_DEFS_LIST = WIDGET_DEFS

/* ---------------- PLAN ---------------- */

const DAY_START = 0            // full day, midnight to midnight, shrunk to fit
const DAY_END = 24 * 60
const HOUR_PX = 30

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
          <div className="vev vev-cal" key={e.id} style={{ top: y(e.start) + 1, height: Math.max(((toMin(e.end) - toMin(e.start)) / 60) * HOUR_PX - 2, 30) }}>
            <TaskName title={e.title} start={e.start} end={e.end} className="t" />
            <span className="rng">{fmtTime(e.start)} – {fmtTime(e.end)}</span>
          </div>
        ))}
        {pinned.map((t) => (
          <div className="vev vev-task" key={t.id} style={{ top: y(t.at!) + 1, height: Math.max((taskMinutes(t) / 60) * HOUR_PX - 2, 28) }}>
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

export function PlanPage() {
  const { space, tasks, toggleTask, assignSlot, toggleSubtask, moveTasksToToday, addTaskWithSubtasks } = useStore()
  const evening = new Date().getHours() >= 21
  const events = MOCK_AGENDA[space]

  const spaceTasks = tasks.filter((t) => t.space === space)
  const open = spaceTasks.filter((t) => !t.done)                 // everything you added, any day
  const todayAll = spaceTasks.filter((t) => t.list === 'today')  // today incl. finished (they stay, struck)
  const todayTasks = todayAll.filter((t) => !t.done)             // still to do
  const plannedMin = todayTasks.reduce((a, t) => a + taskMinutes(t), 0)

  // to-do progress: done vs the time still left across everything
  const totalMin = spaceTasks.reduce((a, t) => a + taskMinutes(t), 0)
  const doneMin = spaceTasks.filter((t) => t.done).reduce((a, t) => a + taskMinutes(t), 0)
  const doneCount = spaceTasks.filter((t) => t.done).length
  const donePct = totalMin ? Math.round((doneMin / totalMin) * 100) : 0

  const [selected, setSelected] = useState<string[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [dropKey, setDropKey] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)

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

  const selMin = open.filter((t) => selected.includes(t.id)).reduce((a, t) => a + taskMinutes(t), 0)
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
            <span className="col-tot mono">{fmtDuration(totalMin - doneMin)} left</span>
          </div>
          <div className="todo-progress" aria-label={`${doneCount} of ${spaceTasks.length} tasks done`}>
            <div className="bar prog"><i style={{ width: `${donePct}%` }} /></div>
            <span className="todo-progress-label">{doneCount} of {spaceTasks.length} done · {fmtDuration(totalMin - doneMin)} left</span>
          </div>
          <div className="formrow" style={{ marginBottom: 'var(--s3)' }}>
            <input
              className="textinput"
              placeholder="Generate: e.g. Set up the bank payment plan"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') generate() }}
              aria-label="Goal to break into subtasks"
            />
            <button className="btn btn-primary" onClick={generate} disabled={busy || !goal.trim()}>{busy ? 'Thinking' : 'Generate'}</button>
          </div>
          {open.map((t) => {
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
                  {t.list === 'today' && <span className="on-today-tag">today</span>}
                  <span className="est-chip">~{taskMinutes(t)}m</span>
                  {hasSubs && (
                    <button className="expand-btn" aria-expanded={isExp} aria-label={isExp ? 'Collapse subtasks' : 'Expand subtasks'} onClick={() => toggleExp(t.id)}>
                      {isExp ? '▾' : '▸'} {doneSubs}/{t.subtasks!.length}
                    </button>
                  )}
                </div>
                {hasSubs && isExp && (
                  <div className="subtask-list">
                    {t.subtasks!.map((s) => (
                      <button className={`subtask${s.done ? ' done' : ''}`} key={s.id} onClick={() => toggleSubtask(t.id, s.id)}>
                        <span className="sub-tick" aria-hidden="true" />
                        <span className="grow">{s.title}</span>
                        <span className="est-chip">~{s.estimateMin}m</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {open.length === 0 && <div className="empty">Nothing on the list. Generate a task above when something lands.</div>}
        </div>

        {/* 3 — Today: drag tasks from Unsorted into a time of day */}
        <div className="panel">
          <div className="col-head">
            <span className="microcap">Today</span>
            <span className="col-tot mono">{fmtDuration(plannedMin)} planned</span>
          </div>
          {BUCKETS.map((b) => {
            const inBucket = todayAll.filter((t) => (t.slot ?? 'unsorted') === b.id)
            // Unsorted only appears when something is actually unsorted
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
                      <div className="today-item" key={t.id}>
                        <div
                          className={`today-task${t.done ? ' done' : ''}`}
                          draggable={!t.done}
                          onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move' }}
                        >
                          <span className="drag-grip" aria-hidden="true">⠿</span>
                          <button className="checkbox" role="checkbox" aria-checked={t.done} aria-label={t.done ? `Reopen: ${t.title}` : `Complete: ${t.title}`} onClick={() => toggleTask(t.id)}>
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 6.5 5 9.5 10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                          </button>
                          <span className={`cat-dot ${t.category}`} aria-hidden="true" />
                          <TaskName title={t.title} start={t.at} className="grow" />
                          <span className="est-chip">~{taskMinutes(t)}m</span>
                          {hasSubs && (
                            <button className="expand-btn" aria-expanded={isExp} aria-label={isExp ? 'Collapse subtasks' : 'Expand subtasks'} onClick={() => toggleExp(t.id)}>
                              {isExp ? '▾' : '▸'} {doneSubs}/{t.subtasks!.length}
                            </button>
                          )}
                          {!t.done && (
                            <span className="kebab-wrap">
                              <button className="kebab" aria-label="Move to a time of day" aria-expanded={menuFor === t.id} onClick={() => setMenuFor((m) => (m === t.id ? null : t.id))}>⋯</button>
                              {menuFor === t.id && (
                                <div className="kebab-menu" role="menu">
                                  {BUCKETS.map((mb) => (
                                    <button key={mb.id} role="menuitemradio" aria-checked={(t.slot ?? 'unsorted') === mb.id} onClick={() => { dropTo(mb.id, t.id); setMenuFor(null) }}>
                                      {mb.label}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </span>
                          )}
                        </div>
                        {hasSubs && isExp && (
                          <div className="subtask-list">
                            {t.subtasks!.map((s) => (
                              <button className={`subtask${s.done ? ' done' : ''}`} key={s.id} onClick={() => toggleSubtask(t.id, s.id)}>
                                <span className="sub-tick" aria-hidden="true" />
                                <span className="grow">{s.title}</span>
                                <span className="est-chip">~{s.estimateMin}m</span>
                              </button>
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

/* ---------------- TASKS ---------------- */

export function TasksPage({ onDecompose: _onDecompose }: { onDecompose?: () => void }) {
  const { space, tasks, toggleTask, logActual, addTask, moveTaskList, deleteTask } = useStore()
  const [filter, setFilter] = useState<'today' | 'backlog' | 'done'>('today')
  const [title, setTitle] = useState('')
  const [est, setEst] = useState(15)
  const [cat, setCat] = useState<TaskCategory>('quick')
  const [logOpen, setLogOpen] = useState<string | null>(null)
  const { focusTaskId, setFocusTaskId } = useStore()
  const [flashId, setFlashId] = useState<string | null>(null)

  useEffect(() => {
    if (!focusTaskId) return
    const t = tasks.find((x) => x.id === focusTaskId)
    if (t) setFilter(t.done ? 'done' : t.list)
    setFlashId(focusTaskId)
    setFocusTaskId(null)
    const timer = window.setTimeout(() => setFlashId(null), 2600)
    return () => window.clearTimeout(timer)
  }, [focusTaskId])

  const inSpace = tasks.filter((t) => t.space === space)
  const cols: { key: 'today' | 'backlog' | 'done'; label: string; list: Task[] }[] = [
    { key: 'today', label: 'Today', list: inSpace.filter((t) => !t.done && t.list === 'today') },
    { key: 'backlog', label: 'Backlog', list: inSpace.filter((t) => !t.done && t.list === 'backlog') },
    { key: 'done', label: 'Done', list: inSpace.filter((t) => t.done) },
  ]

  const submit = () => {
    if (!title.trim()) return
    addTask({ title: title.trim(), source: 'mc', estimateMin: est, space, list: filter === 'backlog' ? 'backlog' : 'today', category: cat })
    setTitle('')
  }

  const row = (t: Task) => (
    <div className={`rowitem${t.done ? ' done' : ''}${flashId === t.id ? ' flash' : ''}`} key={t.id}>
      <button
        className="checkbox"
        role="checkbox"
        aria-checked={t.done}
        aria-label={t.done ? `Reopen: ${t.title}` : `Complete: ${t.title}`}
        onClick={() => toggleTask(t.id)}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 6.5 5 9.5 10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <span className={`cat-dot ${t.category}`} title={t.category} aria-hidden="true" />
      <span className="grow">{t.title}</span>
      {!t.done && t.actualMin === undefined && (
        <span className={`actual-chips${logOpen === t.id ? ' open' : ''}`} title="Done in...">
          {[Math.max(1, Math.round(t.estimateMin / 3)), t.estimateMin, t.estimateMin * 2].map((m) => (
            <button key={m} onClick={() => logActual(t.id, m)} aria-label={`Done in ${m} minutes`}>{m}m</button>
          ))}
        </span>
      )}
      {t.done && t.actualMin !== undefined && (
        <span className="mono meta">~{t.estimateMin}m → {t.actualMin}m</span>
      )}
      <button
        className="est-chip"
        onClick={() => setLogOpen(logOpen === t.id ? null : t.id)}
        aria-expanded={logOpen === t.id}
        aria-label={`Log time for ${t.title}, estimated ${t.estimateMin} minutes`}
      >
        ~{t.estimateMin}m
      </button>
      <span className="src-tag">{t.source === 'mc' ? 'here' : t.source}</span>
      {!t.done && (
        <button
          className="btn-ghost btn"
          style={{ minHeight: 30, fontSize: 'var(--text-xs)' }}
          onClick={() => moveTaskList(t.id, t.list === 'today' ? 'backlog' : 'today')}
        >
          {t.list === 'today' ? '→ backlog' : '→ today'}
        </button>
      )}
      <button className="btn btn-danger" style={{ minHeight: 30, fontSize: 'var(--text-xs)' }} onClick={() => deleteTask(t.id)} aria-label={`Delete ${t.title}`}>×</button>
    </div>
  )

  return (
    <div className="page">
      <Band
        title="Tasks"
        sub={SPACE_LABELS[space]}
        metrics={[
          { v: String(cols[0].list.length), k: 'today' },
          { v: String(cols[1].list.length), k: 'backlog' },
        ]}
      />

      <div className="panel" style={{ marginBottom: 'var(--s5)', maxWidth: 1240 }}>
        <div className="formrow" style={{ marginBottom: 0 }}>
          <input
            className="textinput"
            placeholder="Add a task"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            aria-label="New task title"
          />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input
              className="numinput"
              type="number"
              min={1}
              value={est}
              onChange={(e) => setEst(Math.max(1, Number(e.target.value)))}
              aria-label="Estimate in minutes"
            />
            <span className="microcap">min</span>
          </span>
          <select className="textinput" value={cat} onChange={(e) => setCat(e.target.value as TaskCategory)} aria-label="Category">
            <option value="quick">quick win</option>
            <option value="call">phone call</option>
            <option value="admin">admin</option>
            <option value="deep">deep work</option>
          </select>
          <button className="btn btn-primary" onClick={submit} disabled={!title.trim()}>Add</button>
        </div>
      </div>

      <div className="seg tasks-seg" role="group" aria-label="Filter tasks" style={{ marginBottom: 'var(--s4)' }}>
        {cols.map((c) => (
          <button key={c.key} aria-pressed={filter === c.key} onClick={() => setFilter(c.key)}>{c.key}</button>
        ))}
      </div>

      <div className="tasks-board">
        {cols.map((c) => (
          <div className={`tasks-col${filter === c.key ? ' active' : ''}`} key={c.key}>
            <div className="colhead">
              <span className="microcap">{c.label}</span>
              <span className="mono meta">{c.list.length}</span>
            </div>
            <div className="rowlist">
              {c.list.map(row)}
              {c.list.length === 0 && (
                <div className="empty">
                  {c.key === 'done' ? 'Nothing finished yet today.' : c.key === 'backlog' ? 'Backlog is empty. Enjoy it while it lasts.' : 'Nothing planned for today. Pull something from the backlog or plan the day.'}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------------- HABITS ---------------- */

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function HabitRow({ h, todayIndex, onStart }: { h: HabitDef; todayIndex: number; onStart: (h: HabitDef) => void }) {
  const { toggleHabitDay, togglePauseHabit, deleteHabit } = useStore()
  const kept = h.days.filter(Boolean).length
  const isRoutine = !!h.steps?.length
  return (
    <div className={`habit-row${h.paused ? ' habit-paused' : ''}`}>
      <div className="habit-row-top">
        <span className="habit-name">{h.name}</span>
        {isRoutine && !h.paused && (
          <button className="btn btn-primary habit-start" onClick={() => onStart(h)}>▸ Start</button>
        )}
        <span className="habit-count mono">{kept}/7</span>
        <button className="btn btn-ghost" style={{ minHeight: 30, fontSize: 'var(--text-xs)' }} onClick={() => togglePauseHabit(h.id)}>{h.paused ? 'resume' : 'pause'}</button>
        <button className="btn btn-danger" style={{ minHeight: 30, fontSize: 'var(--text-xs)' }} onClick={() => deleteHabit(h.id)} aria-label={`Delete ${h.name}`}>×</button>
      </div>
      {isRoutine && (
        <div className="routine-preview">
          {h.steps!.map((s) => (
            <span className="routine-chip" key={s.id}>{s.title}{s.kind === 'timer' && s.seconds ? ` · ${Math.round(s.seconds / 60)}m` : ''}</span>
          ))}
        </div>
      )}
      <div className="habit-days">
        {DAY_LABELS.map((d, i) => (
          <span className="day-cell" key={i}>
            <button
              className="daydot"
              role="checkbox"
              aria-checked={h.days[i]}
              disabled={h.paused || i > todayIndex}
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

export function HabitsPage() {
  const { habits, addHabit, todayIndex } = useStore()
  const [name, setName] = useState('')
  const [daypart, setDaypart] = useState<TimeSlot | ''>('morning')
  const [running, setRunning] = useState<HabitDef | null>(null)
  const kept = habits.filter((h) => !h.paused).reduce((a, h) => a + h.days.filter(Boolean).length, 0)

  const groups: { id: TimeSlot | 'anytime'; label: string }[] = [
    ...SLOTS.map((s) => ({ id: s.id, label: s.label })),
    { id: 'anytime', label: 'Anytime' },
  ]

  const add = () => {
    if (!name.trim()) return
    addHabit(name.trim(), daypart || undefined)
    setName('')
  }

  return (
    <div className="page narrow">
      <Band title="Habits" sub="this week, the way the day runs" metrics={[{ v: String(kept), k: 'checkoffs this week' }]} />
      <div className="panel panel-wide">
        <div className="formrow">
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

        {groups.map((g) => {
          const inGroup = habits.filter((h) => (h.daypart ?? 'anytime') === g.id)
          if (inGroup.length === 0) return null
          return (
            <div className="habit-group" key={g.id}>
              <div className="habit-group-head"><span className="bucket-name">{g.label}</span></div>
              {inGroup.map((h) => <HabitRow key={h.id} h={h} todayIndex={todayIndex} onStart={setRunning} />)}
            </div>
          )
        })}

        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginTop: 16 }}>
          Missed days stay quiet on purpose. No broken streaks, no wall of missed-day marks. Pausing a habit is fine, it just stops counting until you resume it.
        </p>
      </div>
      {running && <RoutineRunner habit={running} onClose={() => setRunning(null)} />}
    </div>
  )
}

/* ---------------- GOALS ---------------- */

export function GoalsPage() {
  const { space, goals, addGoal, bumpGoal, deleteGoal, todayIndex } = useStore()
  const list = goals.filter((g) => g.space === space)
  const [name, setName] = useState('')
  const [target, setTarget] = useState(10)
  const [unit, setUnit] = useState('')

  const submit = () => {
    if (!name.trim() || target < 1) return
    addGoal({ space, name: name.trim(), current: 0, target, unit: unit.trim() || 'steps done', note: '' })
    setName(''); setUnit('')
  }

  return (
    <div className="page narrow">
      <Band
        title="Quarter goals"
        sub={`${SPACE_LABELS[space]} · Q3 2026`}
        metrics={[{ v: `${list.filter((g) => g.current / g.target >= 0.5).length}/${list.length}`, k: 'on track' }]}
      />
      <div className="panel panel-wide">
        <div className="formrow">
          <input className="textinput" placeholder="Goal, e.g. Ten discovery calls" value={name} onChange={(e) => setName(e.target.value)} aria-label="Goal name" />
          <input className="numinput" type="number" min={1} value={target} onChange={(e) => setTarget(Math.max(1, Number(e.target.value)))} aria-label="Target number" />
          <input className="textinput" style={{ maxWidth: 180 }} placeholder="unit, e.g. calls" value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Unit" />
          <button className="btn btn-primary" onClick={submit} disabled={!name.trim()}>Add goal</button>
        </div>
        {list.map((g) => {
          const pct = Math.round((g.current / g.target) * 100)
          const weekly = /this week/.test(g.unit)
          const off = pct < 50 && !(weekly && todayIndex < 3)
          return (
            <div className="goal-row" key={g.id}>
              <div className="goal-line">
                <span className="grow">{g.name}</span>
                <span className={`drift ${off ? 'off' : 'ok'}`}>{off ? 'drifting' : 'on track'}</span>
              </div>
              <div className={`bar prog${off ? ' warn' : ''}`}><i style={{ width: `${pct}%` }} /></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <span className="kpi-sub" style={{ marginTop: 0, flex: 1 }}>
                  {g.current} of {g.target} {g.unit}{g.note ? ` · ${g.note}` : ''}
                </span>
                <button className="btn btn-quiet" style={{ minHeight: 30 }} onClick={() => bumpGoal(g.id, 1)} aria-label={`Progress ${g.name}`}>+1</button>
                <button className="btn btn-ghost" style={{ minHeight: 30 }} onClick={() => bumpGoal(g.id, -1)} aria-label={`Undo progress ${g.name}`}>-1</button>
                <button className="btn btn-danger" style={{ minHeight: 30, fontSize: 'var(--text-xs)' }} onClick={() => deleteGoal(g.id)} aria-label={`Delete ${g.name}`}>×</button>
              </div>
            </div>
          )
        })}
        {list.length === 0 && <div className="empty">No goals in this space yet. Add the first one above.</div>}
      </div>
    </div>
  )
}
