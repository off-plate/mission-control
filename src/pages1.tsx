import { useEffect, useMemo, useState } from 'react'
import { SpaceGrid } from './Grid'
import { MOCK_AGENDA, MOCK_EXCEPTIONS_FOR, SPACE_LABELS } from './exceptions'
import { useStore } from './store'
import type { Task, TaskCategory } from './types'

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
  if (ongoing) return { v: `${ongoing.title.split(':')[0]} until ${ongoing.end}`, k: 'now' }
  const next = events.find((e) => toMin(e.start) > nowMin)
  if (!next) return { v: 'none today', k: 'next event' }
  return { v: `${next.start} ${next.title.split(':')[0]}`, k: 'next event' }
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

function DayTimeline({ events }: { events: { id: string; start: string; end: string; title: string }[] }) {
  const DAY_START = 8 * 60
  const DAY_END = 24 * 60
  const span = DAY_END - DAY_START
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
  return (
    <div className="timeline" role="img" aria-label="Today's events on a timeline from 8:00 to midnight">
      {events.map((e) => {
        const l = ((toMin(e.start) - DAY_START) / span) * 100
        const w = ((toMin(e.end) - toMin(e.start)) / span) * 100
        return (
          <div className="ev" key={e.id} style={{ left: `${l}%`, width: `${Math.max(w, 2)}%` }}>
            <span>{e.title.split(':')[0]}</span>
          </div>
        )
      })}
      {['08', '12', '16', '20', '24'].map((h, i) => (
        <span className="tick" key={h} style={{ left: `${(i / 4) * 100}%` }}>{h}:00</span>
      ))}
    </div>
  )
}

export function PlanPage() {
  const { space, tasks, commitPlan, plan, setPage } = useStore()
  const todayKey = new Date().toISOString().slice(0, 10)
  const committed = plan.committedDate === todayKey
  const pool = tasks.filter((t) => t.space === space && !t.done)
  const [selected, setSelected] = useState<string[]>(
    () => pool.filter((t) => t.list === 'today').map((t) => t.id),
  )
  const [firstMove, setFirstMove] = useState<string | null>(null)
  const events = MOCK_AGENDA[space]

  const capacityMin = 210
  const plannedMin = pool.filter((t) => selected.includes(t.id)).reduce((a, t) => a + t.estimateMin, 0)
  const over = plannedMin > capacityMin

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  return (
    <div className="page">
      <Band
        title={new Date().getHours() >= 21 ? 'Plan tomorrow' : 'Plan the day'}
        sub={`${dateLine()} · about 5 minutes`}
        metrics={[
          { v: `${Math.floor(capacityMin / 60)}h ${capacityMin % 60}m`, k: 'free between events' },
          { v: `${plannedMin}m`, k: 'planned' },
        ]}
      />
      <div className="grid-3">
        <div className="panel">
          <span className="microcap">{new Date().getHours() >= 21 ? '1 · Tomorrow’s calendar' : '1 · Today’s calendar'}</span>
          <DayTimeline events={events} />
          <div className="rowlist">
            {events.map((e) => (
              <div className="rowitem" key={e.id}>
                <span className="mono meta">{e.start}</span>
                <span className="grow">{e.title}</span>
                <span className="meta">{e.end}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginTop: 12 }}>
            Free time between events today: about {Math.floor(capacityMin / 60)}h {capacityMin % 60}m.
          </p>
        </div>

        <div className="panel">
          <span className="microcap">2 · Pick what actually fits</span>
          <div className="capacity">
            <span className="v">{plannedMin} of {capacityMin} min</span>
            {over && <span className="over">You are overcommitting. Cut something.</span>}
          </div>
          <div className={`bar${over ? ' warn' : ''}`}>
            <i style={{ width: `${Math.min(100, (plannedMin / capacityMin) * 100)}%` }} />
          </div>
          <div style={{ marginTop: 12 }}>
            {pool.map((t) => (
              <div className="pickrow" key={t.id}>
                <button
                  className="checkbox"
                  role="checkbox"
                  aria-checked={selected.includes(t.id)}
                  aria-label={`Plan: ${t.title}`}
                  onClick={() => toggle(t.id)}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M2 6.5 5 9.5 10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
                <span className="pickrow-label">{t.title}</span>
                <span className="est-chip">~{t.estimateMin}m</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <span className="microcap">3 · Pick the first move</span>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', marginBottom: 12 }}>
            The first thing you do, before you open a single tab. Usually the one you dread.
          </p>
          {pool.filter((t) => selected.includes(t.id)).map((t) => (
            <div className="pickrow" key={t.id}>
              <button
                className="radio"
                role="radio"
                aria-checked={firstMove === t.id}
                aria-label={`First move: ${t.title}`}
                onClick={() => setFirstMove(t.id)}
              />
              <span className="pickrow-label">{t.title}</span>
            </div>
          ))}
          <div style={{ display: 'flex', marginTop: 16, gap: 8, alignItems: 'center' }}>
            {committed && <span className="microcap" style={{ color: 'var(--progress)' }}>Committed today</span>}
            <button
              className="btn btn-primary"
              style={{ marginLeft: 'auto' }}
              disabled={selected.length === 0}
              onClick={() => { commitPlan(selected, firstMove); setPage('today') }}
            >
              Commit the day
            </button>
          </div>
        </div>
      </div>
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

function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => window.innerWidth < 640)
  useEffect(() => {
    const onResize = () => setPhone(window.innerWidth < 640)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return phone
}

export function HabitsPage() {
  const { habits, toggleHabitDay, addHabit, togglePauseHabit, deleteHabit, todayIndex } = useStore()
  const [name, setName] = useState('')
  const phone = useIsPhone()
  const kept = habits.filter((h) => !h.paused).reduce((a, h) => a + h.days.filter(Boolean).length, 0)

  const dot = (h: { id: string; name: string; days: boolean[]; paused: boolean }, i: number) => (
    <button
      key={i}
      className="daydot"
      role="checkbox"
      aria-checked={h.days[i]}
      disabled={h.paused}
      aria-label={`${h.name}, ${DAY_LABELS[i]}`}
      onClick={() => toggleHabitDay(h.id, i)}
    >
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M2 6.5 5 9.5 10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </button>
  )

  return (
    <div className="page narrow">
      <Band
        title="Habits"
        sub="this week"
        metrics={[{ v: String(kept), k: 'checkoffs this week' }]}
      />
      <div className="panel panel-wide">
        <div className="formrow">
          <input
            className="textinput"
            placeholder="New habit"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { addHabit(name.trim()); setName('') } }}
            aria-label="New habit name"
          />
          <button className="btn btn-primary" disabled={!name.trim()} onClick={() => { addHabit(name.trim()); setName('') }}>Add habit</button>
        </div>

        {phone ? (
          <div>
            {habits.map((h) => (
              <div key={h.id} style={{ padding: 'var(--s3) 0', borderBottom: '1px solid var(--hairline)', opacity: h.paused ? 0.5 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ flex: 1, fontWeight: 500, fontSize: 'var(--text-sm)' }}>{h.name}</span>
                  <button className="btn btn-ghost" style={{ minHeight: 34, fontSize: 'var(--text-xs)' }} onClick={() => togglePauseHabit(h.id)}>
                    {h.paused ? 'resume' : 'pause'}
                  </button>
                  <button className="btn btn-danger" style={{ minHeight: 34, fontSize: 'var(--text-xs)' }} onClick={() => deleteHabit(h.id)} aria-label={`Delete ${h.name}`}>×</button>
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'center' }}>
                  {h.days.map((_, i) => (
                    <span key={i} style={{ display: 'grid', justifyItems: 'center', gap: 3 }}>
                      {dot(h, i)}
                      <span className="mono" style={{ fontSize: '0.625rem', color: i === todayIndex ? 'var(--accent)' : 'var(--faint)' }}>{DAY_LABELS[i][0]}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="habit-week">
              <thead>
                <tr>
                  <th>Habit</th>
                  {DAY_LABELS.map((d, i) => (
                    <th key={d} className={i === todayIndex ? 'today-col' : ''}>{d}</th>
                  ))}
                  <th style={{ textAlign: 'left', paddingLeft: 24 }}>12 weeks</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {habits.map((h) => (
                  <tr key={h.id} className={h.paused ? 'habit-paused' : ''}>
                    <td>{h.name}</td>
                    {h.days.map((_, i) => (
                      <td key={i} className={i === todayIndex ? 'today-col' : ''}>{dot(h, i)}</td>
                    ))}
                    <td style={{ paddingLeft: 24 }}>
                      <div className="habit-history" aria-label={`${h.name}, checkoffs per week over 12 weeks`}>
                        {(h.history ?? []).map((n, i) => (
                          <i key={i} className={n >= 4 ? 'hi' : ''} style={{ height: `${Math.max(3, (n / 7) * 26)}px` }} />
                        ))}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost" style={{ minHeight: 30, fontSize: 'var(--text-xs)' }} onClick={() => togglePauseHabit(h.id)}>
                          {h.paused ? 'resume' : 'pause'}
                        </button>
                        <button className="btn btn-danger" style={{ minHeight: 30, fontSize: 'var(--text-xs)' }} onClick={() => deleteHabit(h.id)} aria-label={`Delete ${h.name}`}>×</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginTop: 16 }}>
          Missed days stay quiet on purpose. No broken streaks, no wall of missed-day marks. Pausing a habit is fine, it just stops counting until you resume it.
        </p>
      </div>
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
