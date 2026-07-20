import { memo, useState } from 'react'
import {
  MOCK_AGENDA,
  MOCK_CLAUDE,
  MOCK_MAIL,
  MOCK_MONEY,
  MOCK_OUTREACH,
  MOCK_TRAINING,
} from './mock'
import { useStore } from './store'
import type { SizeKey, SpaceId, WidgetType } from './types'

export function Spark({ data, width = 120, height = 32 }: { data: number[]; width?: number; height?: number }) {
  const max = Math.max(...data)
  const min = Math.min(...data)
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * (width - 4) + 2
      const y = height - 3 - ((v - min) / Math.max(1, max - min)) * (height - 6)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <line x1="2" y1={height - 2} x2={width - 2} y2={height - 2} stroke="currentColor" strokeWidth="1" className="spark-base" opacity="0.35" />
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" className="spark" />
    </svg>
  )
}

/** Full-width sparkline with labeled endpoints; numbers get context. */
export function SparkBox({ data, unit, caption }: { data: number[]; unit: string; caption: string }) {
  const first = data[0]
  const last = data[data.length - 1]
  return (
    <span className="sparkbox">
      <Spark data={data} width={400} height={64} />
      <span className="spark-vals">
        <span>{first}{unit}</span>
        <span className="last">{last}{unit} now</span>
      </span>
      <span className="spark-caption">{caption}</span>
    </span>
  )
}

const AgendaBody = memo(function AgendaBody({ space, size }: { space: SpaceId; size: SizeKey }) {
  const events = MOCK_AGENDA[space]
  const narrow = size === 'T' || size === 'S'
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
  const nextIdx = events.findIndex((e) => toMin(e.end) > nowMin)
  if (!events.length) {
    return <div className="empty">Nothing scheduled. Protect the evening.</div>
  }
  return (
    <div className="rowlist">
      {events.map((e, i) => {
        const past = toMin(e.end) <= nowMin
        return (
          <div className="rowitem" key={e.id}>
            <span className="mono meta" style={i === nextIdx ? { color: 'var(--accent)', fontWeight: 600 } : undefined}>{e.start}</span>
            <span className="grow wrap2" style={past ? { color: 'var(--muted)', textDecoration: 'line-through', textDecorationColor: 'var(--hairline-strong)' } : undefined} title={e.where ? `${e.title}, ${e.where}` : e.title}>{e.title}</span>
            {past ? <span className="meta mono">done</span> : e.where && !narrow ? <span className="meta">{e.where}</span> : null}
          </div>
        )
      })}
      {nextIdx === -1 && <div className="kpi-sub" style={{ paddingTop: 8 }}>Day is over. Tomorrow starts fresh.</div>}
    </div>
  )
})

const TasksBody = memo(function TasksBody({ space, size }: { space: SpaceId; size: SizeKey }) {
  const { tasks, toggleTask, logActual } = useStore()
  const [logOpen, setLogOpen] = useState<string | null>(null)
  const list = tasks.filter((t) => t.space === space && t.list === 'today')
  const open = list.filter((t) => !t.done)
  const remaining = open.reduce((a, t) => a + t.estimateMin, 0)
  const shown = size === 'M' ? list.slice(0, 3) : list
  return (
    <div>
      {open.length > 0 && (
        <div className="kpi-sub" style={{ marginTop: 0, marginBottom: 4 }}>
          {open.length} open · ~{remaining} min planned
        </div>
      )}
      <div className="rowlist">
        {shown.map((t) => (
          <div className={`rowitem${t.done ? ' done' : ''}`} key={t.id}>
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
            <span className="grow wrap2">{t.title}</span>
            {!t.done && t.actualMin === undefined && (
              <span className={`actual-chips${logOpen === t.id ? ' open' : ''}`} title="Done in...">
                {[Math.max(1, Math.round(t.estimateMin / 3)), t.estimateMin].map((m) => (
                  <button key={m} onClick={() => logActual(t.id, m)} aria-label={`Done in ${m} minutes`}>
                    {m}m
                  </button>
                ))}
              </span>
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
          </div>
        ))}
        {open.length === 0 && <div className="empty">Everything due today is done. Log off proud.</div>}
      </div>
    </div>
  )
})

const MailBody = memo(function MailBody({ space, size }: { space: SpaceId; size: SizeKey }) {
  const accounts = MOCK_MAIL[space]
  return (
    <div>
      {accounts.map((a) => (
        <div className="mail-account" key={a.addr}>
          <span className="mail-count">{a.unread}<span className="kpi-sub" style={{ display: 'block', marginTop: 0 }}>unread</span></span>
          <span className="mail-body-col">
            <span className="mail-addr">{a.addr}</span>
            {size !== 'S' && <span className="mail-top">{a.top} · {a.age}</span>}
          </span>
        </div>
      ))}
    </div>
  )
})

const FinanceBody = memo(function FinanceBody({ size }: { size: SizeKey }) {
  const f = MOCK_MONEY
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span className="kpi val-pos" style={{ fontSize: '1.6rem' }}>{f.safeToSpend}</span>
        <span className="kpi-sub" style={{ marginTop: 0 }}>safe to spend {f.safeUntil}</span>
      </div>
      <div className="kpi-sub">{f.safeMath}</div>
      <div className="bar" style={{ marginTop: 10 }} aria-label={`Spent ${f.spentPct} percent of cycle budget`}>
        <i style={{ width: `${f.spentPct}%` }} />
      </div>
      <div className="rowlist" style={{ marginTop: 6 }}>
        <div className="rowitem" style={{ minHeight: 34 }}>
          <span className="grow" style={{ color: 'var(--alert)', fontWeight: 500 }}>{f.nextObligation}</span>
        </div>
        {size === 'L' && f.obligations.map((o) => (
          <div className="rowitem" key={o.id} style={{ minHeight: 34 }}>
            <span className="grow" style={{ color: 'var(--muted)' }}>{o.name}</span>
            <span className={`state-tag ${o.state === 'action needed' ? 'action' : o.state}`}>{o.state}</span>
          </div>
        ))}
      </div>
    </div>
  )
})

const HabitsBody = memo(function HabitsBody() {
  const { habits, toggleHabitDay, todayIndex } = useStore()
  const active = habits.filter((h) => !h.paused)
  return (
    <div className="habit-grid">
      {active.map((h) => (
        <button
          key={h.id}
          className="habit"
          aria-pressed={h.days[todayIndex]}
          onClick={() => toggleHabitDay(h.id, todayIndex)}
        >
          <span className="tick" aria-hidden="true" />
          {h.name}
        </button>
      ))}
      {active.length === 0 && <div className="empty">No active habits. Add one on the Habits page.</div>}
    </div>
  )
})

const TrainingBody = memo(function TrainingBody({ size }: { size: SizeKey }) {
  const t = MOCK_TRAINING
  if (size === 'S') {
    return (
      <div>
        <div className="kpi">{t.weeklySets.at(-1)}<span className="unit">sets this wk</span></div>
        <div className="kpi-sub">next: {t.next}</div>
      </div>
    )
  }
  return (
    <div>
      <div className="rowlist">
        <div className="rowitem"><span className="grow">{t.last}</span><span className="src-tag">hevy</span></div>
        <div className="rowitem"><span className="grow" style={{ color: 'var(--muted)' }}>next: {t.next}</span></div>
      </div>
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <Spark data={t.weeklySets} />
        <span className="kpi-sub" style={{ marginTop: 0 }}>{t.weeklySets[0]} to {t.weeklySets.at(-1)} sets per week, 8 weeks</span>
      </div>
    </div>
  )
})

const GoalsBody = memo(function GoalsBody({ space }: { space: SpaceId }) {
  const { goals, todayIndex } = useStore()
  const list = goals.filter((g) => g.space === space)
  return (
    <div>
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
            <div className={`bar prog${off ? ' warn' : ''}`}>
              <i style={{ width: `${pct}%` }} />
            </div>
            <div className="kpi-sub">{g.current} of {g.target} {g.unit}</div>
          </div>
        )
      })}
      {list.length === 0 && <div className="empty">No goals in this space yet.</div>}
    </div>
  )
})

const TimeSavedBody = memo(function TimeSavedBody() {
  const { savedMin, accuracyPct, setPage } = useStore()
  const h = Math.floor(savedMin / 60)
  const m = savedMin % 60
  return (
    <button onClick={() => setPage('stats')} style={{ textAlign: 'left', display: 'block', width: '100%' }} aria-label="Open the time saved log">
      <div className={`kpi${savedMin >= 0 ? ' val-pos' : ' val-urgent'}`}>{h > 0 ? `${h}h ${m}` : m}<span className="unit">min</span></div>
      <div className="kpi-sub">net minutes under your own estimates this week</div>
      <div className="kpi-sub">estimate accuracy {accuracyPct}%</div>
    </button>
  )
})

const ClaudeBody = memo(function ClaudeBody({ size }: { size: SizeKey }) {
  const c = MOCK_CLAUDE
  return (
    <div>
      <div className="kpi">{c.sessionsToday}<span className="unit">sessions today</span></div>
      {size === 'M' ? (
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <Spark data={c.tokensWeek} />
          <span className="kpi-sub" style={{ marginTop: 0 }}>{c.tokensWeek.at(-1)}k tokens today</span>
        </div>
      ) : (
        <div className="kpi-sub">{c.note}</div>
      )}
    </div>
  )
})

const SocialBody = memo(function SocialBody({ size }: { size: SizeKey }) {
  const { social } = useStore()
  return (
    <div className="rowlist">
      {social.map((s) => (
        <div className="rowitem" key={s.platform}>
          <span className="grow">{s.platform}</span>
          {size === 'L' && <span className="meta">{s.lastPost}</span>}
          <span className="mono" style={{ fontWeight: 600 }}>{s.followers.toLocaleString('en')}</span>
          <span className="mono meta" style={{ color: s.change >= 0 ? 'var(--progress)' : 'var(--alert)' }}>
            {s.change >= 0 ? '+' : ''}{s.change}
          </span>
        </div>
      ))}
    </div>
  )
})

const OutreachBody = memo(function OutreachBody() {
  return (
    <div className="rowlist">
      {MOCK_OUTREACH.map((o) => (
        <div className="rowitem" key={o.name}>
          <span className="status-dot" style={{ background: o.ok ? 'var(--progress)' : 'var(--alert)' }} />
          <span className="grow">{o.name}</span>
          <span className="meta">{o.state}</span>
        </div>
      ))}
    </div>
  )
})

const SourcesBody = memo(function SourcesBody({ size }: { size: SizeKey }) {
  const { sources } = useStore()
  const shown = size === 'S' ? sources.slice(0, 4) : sources
  return (
    <div className="rowlist">
      {shown.map((s) => (
        <div className="rowitem" key={s.id} style={{ minHeight: 30, paddingBlock: 4 }}>
          <span className={`status-dot ${s.status}`} />
          <span className="grow" style={{ fontSize: 'var(--text-xs)' }}>{s.name}</span>
          <span className="meta mono" style={{ fontSize: '0.625rem' }}>{s.status === 'connected' ? 'live' : s.status}</span>
        </div>
      ))}
    </div>
  )
})

export function WidgetBody({ type, space, size }: { type: WidgetType; space: SpaceId; size: SizeKey }) {
  switch (type) {
    case 'agenda': return <AgendaBody space={space} size={size} />
    case 'tasks': return <TasksBody space={space} size={size} />
    case 'mail': return <MailBody space={space} size={size} />
    case 'finance': return <FinanceBody size={size} />
    case 'habits': return <HabitsBody />
    case 'training': return <TrainingBody size={size} />
    case 'goals': return <GoalsBody space={space} />
    case 'timesaved': return <TimeSavedBody />
    case 'claude': return <ClaudeBody size={size} />
    case 'social': return <SocialBody size={size} />
    case 'sources': return <SourcesBody size={size} />
    case 'outreach': return <OutreachBody />
  }
}
