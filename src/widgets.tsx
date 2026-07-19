import { memo } from 'react'
import {
  MOCK_AGENDA,
  MOCK_CLAUDE,
  MOCK_FINANCE,
  MOCK_GOALS,
  MOCK_MAIL,
  MOCK_SOCIAL,
  MOCK_SOURCES,
  MOCK_TRAINING,
} from './mock'
import { useStore } from './store'
import type { SizeKey, SpaceId, WidgetType } from './types'

function Spark({ data, width = 120, height = 32 }: { data: number[]; width?: number; height?: number }) {
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

const AgendaBody = memo(function AgendaBody({ space, size }: { space: SpaceId; size: SizeKey }) {
  const events = MOCK_AGENDA[space]
  const narrow = size === 'T' || size === 'S'
  if (!events.length) {
    return <div className="empty">Nothing scheduled. Protect the evening.</div>
  }
  return (
    <div className="rowlist">
      {events.map((e) => (
        <div className="rowitem" key={e.id}>
          <span className="mono meta">{e.start}</span>
          <span className="grow" title={e.where ? `${e.title}, ${e.where}` : e.title}>{e.title}</span>
          {e.where && !narrow && <span className="meta">{e.where}</span>}
        </div>
      ))}
    </div>
  )
})

const TasksBody = memo(function TasksBody({ space, size }: { space: SpaceId; size: SizeKey }) {
  const { tasks, toggleTask, logActual } = useStore()
  const list = tasks.filter((t) => t.space === space)
  const open = list.filter((t) => !t.done)
  const shown = size === 'M' ? list.slice(0, 3) : list
  return (
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
          <span className="grow">{t.title}</span>
          {!t.done && t.actualMin === undefined && (
            <span className="actual-chips" title="Done in...">
              {[Math.round(t.estimateMin / 3), t.estimateMin].map((m) => (
                <button key={m} onClick={() => logActual(t.id, m)} aria-label={`Done in ${m} minutes`}>
                  {m}m
                </button>
              ))}
            </span>
          )}
          <span className="est-chip">~{t.estimateMin}m</span>
          <span className="src-tag">{t.source}</span>
        </div>
      ))}
      {open.length === 0 && <div className="empty">Everything due today is done. Log off proud.</div>}
    </div>
  )
})

const MailBody = memo(function MailBody({ space, size }: { space: SpaceId; size: SizeKey }) {
  const accounts = MOCK_MAIL[space]
  return (
    <div>
      {accounts.map((a) => (
        <div className="mail-account" key={a.addr}>
          <span className="mail-count mono">{a.unread}</span>
          <span className="mail-body-col">
            <span className="mail-addr">{a.addr}</span>
            {size !== 'S' && <span className="mail-top">{a.top}</span>}
          </span>
        </div>
      ))}
    </div>
  )
})

const FinanceBody = memo(function FinanceBody({ size }: { size: SizeKey }) {
  const f = MOCK_FINANCE
  return (
    <div>
      <div className="kpi-sub">{f.cycleLabel}</div>
      <div className="bar" style={{ marginTop: 8 }} aria-label={`Spent ${f.spentPct} percent of cycle budget`}>
        <i style={{ width: `${f.spentPct}%` }} />
      </div>
      <div className="rowlist" style={{ marginTop: 10 }}>
        <div className="rowitem">
          <span className="grow">{f.nextObligation}</span>
        </div>
        {size === 'L' && (
          <div className="rowitem">
            <span className="grow" style={{ color: 'var(--muted)' }}>{f.buffer}</span>
          </div>
        )}
      </div>
    </div>
  )
})

const HabitsBody = memo(function HabitsBody() {
  const { habits, toggleHabit } = useStore()
  return (
    <div className="habit-grid">
      {habits.map((h) => (
        <button key={h.id} className="habit" aria-pressed={h.done} onClick={() => toggleHabit(h.id)}>
          <span className="tick" aria-hidden="true" />
          {h.name}
        </button>
      ))}
    </div>
  )
})

const TrainingBody = memo(function TrainingBody({ size }: { size: SizeKey }) {
  const t = MOCK_TRAINING
  if (size === 'S') {
    return (
      <div>
        <div className="kpi">{t.weeklySets.at(-1)}<span className="unit"> sets</span></div>
        <div className="kpi-sub">{t.next}</div>
      </div>
    )
  }
  return (
    <div>
      <div className="rowlist">
        <div className="rowitem"><span className="grow">{t.last}</span></div>
        <div className="rowitem"><span className="grow">{t.next}</span></div>
      </div>
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <Spark data={t.weeklySets} />
        <span className="kpi-sub">sets per week</span>
      </div>
    </div>
  )
})

const GoalsBody = memo(function GoalsBody({ space }: { space: SpaceId }) {
  const goals = MOCK_GOALS[space]
  return (
    <div>
      {goals.map((g) => (
        <div className="goal-row" key={g.name}>
          <div className="goal-line">
            <span className="grow">{g.name}</span>
            <span className={`drift ${g.drift}`}>{g.drift === 'ok' ? 'on track' : 'drifting'}</span>
          </div>
          <div className={`bar prog${g.drift === 'off' ? ' warn' : ''}`}>
            <i style={{ width: `${g.pct}%` }} />
          </div>
          <div className="kpi-sub">{g.note}</div>
        </div>
      ))}
    </div>
  )
})

const TimeSavedBody = memo(function TimeSavedBody({ onOpenLedger }: { onOpenLedger?: () => void }) {
  const { savedMin, accuracyPct } = useStore()
  const h = Math.floor(savedMin / 60)
  const m = savedMin % 60
  return (
    <button onClick={onOpenLedger} style={{ textAlign: 'left', display: 'block', width: '100%' }} aria-label="Open the time saved log">
      <div className="kpi">{h > 0 ? `${h}h ${m}` : m}<span className="unit"> min</span></div>
      <div className="kpi-sub">saved this week vs your own estimates</div>
      <div className="kpi-sub">estimate accuracy {accuracyPct}%</div>
    </button>
  )
})

const ClaudeBody = memo(function ClaudeBody({ size }: { size: SizeKey }) {
  const c = MOCK_CLAUDE
  return (
    <div>
      <div className="kpi">{c.sessionsToday}<span className="unit"> sessions</span></div>
      {size === 'M' ? (
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <Spark data={c.tokensWeek} />
          <span className="kpi-sub">k tokens per day</span>
        </div>
      ) : (
        <div className="kpi-sub">{c.note}</div>
      )}
    </div>
  )
})

const SocialBody = memo(function SocialBody({ size }: { size: SizeKey }) {
  return (
    <div className="rowlist">
      {MOCK_SOCIAL.map((s) => (
        <div className="rowitem" key={s.platform}>
          <span className="grow">{s.platform}</span>
          {size === 'L' && <span className="meta">{s.lastPost}</span>}
          <span className="mono" style={{ fontWeight: 600 }}>{s.followers.toLocaleString('en')}</span>
          <span className={`mono meta`} style={{ color: s.change >= 0 ? 'var(--progress)' : 'var(--alert)' }}>
            {s.change >= 0 ? '+' : ''}{s.change}
          </span>
        </div>
      ))}
    </div>
  )
})

const SourcesBody = memo(function SourcesBody({ size }: { size: SizeKey }) {
  const shown = size === 'S' ? MOCK_SOURCES.slice(0, 4) : MOCK_SOURCES
  return (
    <div className="rowlist">
      {shown.map((s) => (
        <div className="rowitem" key={s.name} style={{ minHeight: 30, paddingBlock: 4 }}>
          <span
            className="dot"
            style={{
              width: 7, height: 7, borderRadius: '50%', flex: 'none',
              background: s.state === 'live' ? 'var(--progress)' : s.state === 'stale' ? 'var(--alert)' : 'var(--faint)',
            }}
          />
          <span className="grow" style={{ fontSize: 'var(--text-xs)' }}>{s.name}</span>
          <span className="meta mono" style={{ fontSize: '0.625rem' }}>{s.state}</span>
        </div>
      ))}
    </div>
  )
})

export function WidgetBody({
  type, space, size, onOpenLedger,
}: {
  type: WidgetType
  space: SpaceId
  size: SizeKey
  onOpenLedger?: () => void
}) {
  switch (type) {
    case 'agenda': return <AgendaBody space={space} size={size} />
    case 'tasks': return <TasksBody space={space} size={size} />
    case 'mail': return <MailBody space={space} size={size} />
    case 'finance': return <FinanceBody size={size} />
    case 'habits': return <HabitsBody />
    case 'training': return <TrainingBody size={size} />
    case 'goals': return <GoalsBody space={space} />
    case 'timesaved': return <TimeSavedBody onOpenLedger={onOpenLedger} />
    case 'claude': return <ClaudeBody size={size} />
    case 'social': return <SocialBody size={size} />
    case 'sources': return <SourcesBody size={size} />
  }
}
