import { memo, useEffect, useState } from 'react'
import {
  MOCK_AGENDA,
  MOCK_CLAUDE,
  MOCK_MAIL,
  MOCK_MONEY,
  MOCK_OUTREACH,
  MOCK_TRAINING,
  SPACE_LABELS,
} from './mock'
import { useStore } from './store'
import { useCalendar } from './calendar'
import { goalCurrent, isTimeFed, keptThisPeriod, ON_TRACK_PCT, type SizeKey, type SpaceId, type WidgetType } from './types'
import { useClockStamp } from './ui'
import { fmtDuration, fmtNum, fmtTimeShort, goalPace, goalPeriodKey, goalPeriodRange, isoWeekKey, localDateKey, type GoalTf } from './util'
import * as Icon from './icons'

/** `fluid` makes the line span its container, so label rows underneath line up. */
/* A pasted URL is an address, not prose: shown raw it swallowed two lines of a
   task title. Wherever free text renders, links collapse to a short clickable
   host/path and the words around them stay words. */
const URL_RE = /https?:\/\/[^\s<>"')]+/g

function shortUrl(raw: string): string {
  try {
    const u = new URL(raw)
    const seg = u.pathname.split('/').filter(Boolean)[0]
    const path = seg ? `/${seg}` : ''
    const s = `${u.hostname.replace(/^www\./, '')}${path}`
    return s.length > 34 ? `${s.slice(0, 33)}…` : `${s}${u.pathname.split('/').filter(Boolean).length > 1 ? '/…' : ''}`
  } catch { return raw.length > 34 ? `${raw.slice(0, 33)}…` : raw }
}

export function Linkify({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const at = m.index ?? 0
    if (at > last) parts.push(text.slice(last, at))
    const url = m[0]
    parts.push(
      <a
        key={at} className="txt-link" href={url} target="_blank" rel="noreferrer" title={url}
        /* The row underneath has its own ideas about clicks and drags; opening
           a link must not toggle, drag or expand anything. */
        onClick={(e) => e.stopPropagation()}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
      >
        {shortUrl(url)}
      </a>,
    )
    last = at + url.length
  }
  if (parts.length === 0) return <>{text}</>
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

export function Spark({ data, width = 120, height = 32, fluid = false }: { data: number[]; width?: number; height?: number; fluid?: boolean }) {
  const max = Math.max(...data)
  const min = Math.min(...data)
  const pts = data
    .map((v, i) => {
      /* One point divides by zero and emits "NaN,23" into the path, which the
         browser rejects and the whole line disappears. A single reading sits in
         the middle: there is no slope to draw yet. */
      const x = data.length === 1 ? width / 2 : (i / (data.length - 1)) * (width - 4) + 2
      const y = height - 3 - ((v - min) / Math.max(1, max - min)) * (height - 6)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg
      width={fluid ? '100%' : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={fluid ? 'none' : undefined}
      style={fluid ? { display: 'block' } : undefined}
      aria-hidden="true"
    >
      <line x1="2" y1={height - 2} x2={width - 2} y2={height - 2} stroke="currentColor" strokeWidth="1" className="spark-base" opacity="0.35" />
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" className="spark" vectorEffect={fluid ? 'non-scaling-stroke' : undefined} />
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

/* His real work calendar, drawn here rather than embedded.

   An iframe was the obvious way and the wrong one: it cannot be styled, it
   cannot answer "what is next", and it drops a Google login into a page that
   otherwise only ever shows his own record. The feed is fetched by an Edge
   Function (Google sends no CORS header, measured) and parsed in src/ical.ts.

   Every state is named. An empty day and a calendar that could not be read
   look identical if you let them, and "nothing scheduled" over a day full of
   meetings is the most expensive lie this widget could tell. */
const AgendaBody = memo(function AgendaBody({ size }: { space: SpaceId; size: SizeKey }) {
  const { state } = useCalendar()
  const narrow = size === 'T' || size === 'S'
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const today = localDateKey()

  if (state.status === 'loading') return <div className="empty">Reading the calendar.</div>
  if (state.status === 'off') return <div className="empty">Sync is off, so the calendar cannot be read.</div>
  if (state.status === 'signed-out') return <div className="empty">Sign in to read the calendar.</div>
  if (state.status === 'not-set-up') return <div className="empty">No calendar feed connected yet.</div>
  if (state.status === 'error') return <div className="empty">Calendar could not be read. {state.message}</div>

  const todays = state.events.filter((e) => e.day === today)
  if (!todays.length) return <div className="empty">Nothing in the calendar today.</div>

  const nextIdx = todays.findIndex((e) => e.start !== null && (e.end ?? e.start) > nowMin)
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  return (
    <div className="rowlist">
      {todays.map((e, i) => {
        const past = e.start !== null && (e.end ?? e.start) <= nowMin
        return (
          <div className="rowitem" key={`${e.day}-${e.start ?? 'all'}-${e.title}`}>
            <span className={`mono meta${i === nextIdx ? ' cal-next' : ''}`}>
              {e.allDay ? 'all day' : hm(e.start as number)}
            </span>
            <span
              className={`grow wrap2${past ? ' cal-past' : ''}`}
              title={e.where ? `${e.title}, ${e.where}` : e.title}
            >{e.title}</span>
            {past ? <span className="meta mono">done</span> : e.where && !narrow ? <span className="meta">{e.where}</span> : null}
          </div>
        )
      })}
      {nextIdx === -1 && <div className="kpi-sub" style={{ paddingTop: 8 }}>Day is over. Tomorrow starts fresh.</div>}
    </div>
  )
})

const TasksBody = memo(function TasksBody({ space, size }: { space: SpaceId; size: SizeKey }) {
  const { tasks, toggleTask, logActual, inView } = useStore()
  const [logOpen, setLogOpen] = useState<string | null>(null)
  // Today's work only: a task laid out for tomorrow is not on this list yet.
  const list = tasks.filter((t) => inView(t.space) && t.list === 'today' && (t.plannedOn ?? localDateKey()) === localDateKey())
  const open = list.filter((t) => !t.done)
  const remaining = open.reduce((a, t) => a + t.estimateMin, 0)
  const shown = size === 'M' ? list.slice(0, 3) : list
  return (
    <div>
      {open.length > 0 && (
        <div className="kpi-sub" style={{ marginTop: 0, marginBottom: 4 }}>
          {open.length} open · {fmtDuration(remaining)} planned
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
              onClick={() => {
                // Same contract as Plan: finishing asks how long it really took,
                // otherwise the estimate ledger quietly stops learning.
                if (t.done || t.subtasks?.length) { toggleTask(t.id); return }
                setLogOpen(logOpen === t.id ? null : t.id)
              }}
            >
              <Icon.Check size={12} strokeWidth={1.0} />
            </button>
            <span className={`cat-dot ${t.category}`} title={t.category} aria-hidden="true" />
            <span className="grow wrap2"><Linkify text={t.title} /></span>
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
              className="chip tone-info"
              onClick={() => setLogOpen(logOpen === t.id ? null : t.id)}
              aria-expanded={logOpen === t.id}
              aria-label={`Log time for ${t.title}, estimated ${t.estimateMin} minutes`}
            >
              {fmtDuration(t.estimateMin)}
            </button>
            {/* A source tag earns its place only when the source is somewhere
                else. Seven grey "here" chips were noise dressed as links. */}
            {t.source !== 'mc' && <span className="chip tone-info is-src">{t.source}</span>}
          </div>
        ))}
        {open.length === 0 && list.length > 0 && (
          <div className="kpi-sub" style={{ paddingTop: 6 }}>All done. That is everything you planned for today.</div>
        )}
        {list.length === 0 && <div className="empty">Nothing planned today. Pull something over on the Plan page.</div>}
      </div>
    </div>
  )
})

/* The date and the time, as a thing on the page rather than a line in the
   header. It reads the machine's own clock, so it is right by definition, and
   it re-renders only when a shown value changes: a widget that repainted every
   second next to a drag-and-drop grid is a cost with nothing to show for it. */
export const ClockBody = memo(function ClockBody() {
  const now = useClockStamp()
  return (
    <div className="clockw">
      <span className="clockw-time">{now.time}</span>
      <span className="clockw-day">{now.day}</span>
      <span className="clockw-date">
        {now.date}
        <span className="clockw-week mono">week {now.week}</span>
      </span>
    </div>
  )
})

const MailBody = memo(function MailBody() {
  return <div className="empty">Not connected yet. Gmail will feed this.</div>
})

const FinanceBody = memo(function FinanceBody() {
  return <div className="empty">Not connected yet. The real figures live in Compass.</div>
})

const HabitsBody = memo(function HabitsBody({ space }: { space: SpaceId }) {
  const { habits, routines, toggleHabitDay, setPage, todayIndex, habitLog, inView } = useStore()
  const active = habits.filter((h) => inView(h.space) && !h.paused && !h.archivedAt)
  /* A habit a routine drives is a read-out here too. Ticking it by hand looked
     like it worked and was reverted on the next load. */
  const driven = new Map(routines.filter((r) => r.habitId && !r.archivedAt).map((r) => [r.habitId as string, r.title]))
  /* Three chips reading "Focus for 30 minutes" with nothing telling them
     apart: when a name collides, the workspace says which one this is. */
  const names = new Map<string, number>()
  for (const h of active) names.set(h.name, (names.get(h.name) ?? 0) + 1)
  return (
    <div className="habit-chips">
      {active.map((h) => (
        <button
          key={h.id}
          className={`habit${driven.has(h.id) ? ' is-auto' : ''}`}
          /* A weekly/monthly habit is pressed once it is kept for its whole
             period, not once today's slot happens to be true: a monthly review
             finished three weeks ago is still kept, and today's slot alone
             cannot say so. */
          aria-pressed={h.frequency === 'weekly' || h.frequency === 'monthly' ? keptThisPeriod(h, habitLog) : h.days[todayIndex]}
          title={driven.has(h.id) ? `Ticks itself when you finish “${driven.get(h.id)}”` : undefined}
          onClick={() => (driven.has(h.id) ? setPage('routines') : toggleHabitDay(h.id, todayIndex))}
        >
          <span className="tick" aria-hidden="true" />
          {h.name}
          {(names.get(h.name) ?? 0) > 1 && <span className="habit-qual">{SPACE_LABELS[h.space]}</span>}
        </button>
      ))}
      {active.length === 0 && <div className="empty">No active habits. Add one on the Habits page.</div>}
    </div>
  )
})

const TrainingBody = memo(function TrainingBody() {
  return <div className="empty">Not connected yet. Hevy will feed this.</div>
})

const GoalsBody = memo(function GoalsBody({ space }: { space: SpaceId }) {
  const { goals, habits, habitLog, slips, focusSessions, todayIndex, inView } = useStore()
  const list = goals.filter((g) => inView(g.space))
  return (
    <div>
      {list.map((g) => {
        /* The same accurate read GoalsPage uses: a habit-linked goal's current
           count comes from the dated log inside its OWN period, not the
           seven-day cache, and `g.current` below was never that goal's
           current at all for a habit-linked one; it was whatever number
           happened to be stored on the row, stale the moment a day passed. */
        const tf = (g.timeframe ?? 'quarter') as GoalTf
        const range = goalPeriodRange(tf, g.periodKey ?? goalPeriodKey(tf))
        const cur = goalCurrent(g, habits, habitLog, range, slips, focusSessions)
        const pct = Math.round((cur / g.target) * 100)
        const fromHabit = habits.find((h) => h.id === g.habitId)
        const dailyCap = !!fromHabit && !isTimeFed(fromHabit)
        // Judged against elapsed time, not a flat percentage.
        const off = goalPace(cur, g.target, tf, new Date(), dailyCap) === 'behind'
        return (
          <div className="goal-row" key={g.id}>
            <div className="goal-line">
              <span className="grow">{g.name}</span>
              <span className={`drift ${off ? 'off' : 'ok'}`}>{off ? 'needs a push' : 'on pace'}</span>
            </div>
            <div className={`bar prog${off ? ' warn' : ''}`}>
              <i style={{ width: `${pct}%` }} />
            </div>
            <div className="kpi-sub">{fmtNum(g.current)} of {fmtNum(g.target)} {g.unit}</div>
          </div>
        )
      })}
      {list.length === 0 && <div className="empty">No goals in this space yet.</div>}
    </div>
  )
})

const TimeSavedBody = memo(function TimeSavedBody() {
  const { savedMin, accuracyPct, setPage, inView } = useStore()
  const abs = Math.abs(savedMin)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  const sign = savedMin < 0 ? '-' : ''
  return (
    <button onClick={() => setPage('review')} style={{ textAlign: 'left', display: 'block', width: '100%' }} aria-label="Open the time saved log">
      <div className={`kpi${savedMin >= 0 ? ' val-pos' : ' val-urgent'}`}>{h > 0 ? `${sign}${h}h ${m}` : `${sign}${m}`}<span className="unit">min</span></div>
      <div className="kpi-sub">net minutes under your own estimates this week</div>
      <div className="kpi-sub">estimate accuracy {accuracyPct}%</div>
    </button>
  )
})

const ClaudeBody = memo(function ClaudeBody() {
  return <div className="empty">Not connected yet.</div>
})

const SocialBody = memo(function SocialBody() {
  return <div className="empty">Nothing entered yet.</div>
})

const OutreachBody = memo(function OutreachBody() {
  return <div className="empty">Nothing here yet.</div>
})

const SourcesBody = memo(function SourcesBody({ size }: { size: SizeKey }) {
  const { sources, inView } = useStore()
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
    case 'clock': return <ClockBody />
    case 'agenda': return <AgendaBody space={space} size={size} />
    case 'tasks': return <TasksBody space={space} size={size} />
    case 'mail': return <MailBody />
    case 'finance': return <FinanceBody />
    case 'habits': return <HabitsBody space={space} />
    case 'training': return <TrainingBody />
    case 'goals': return <GoalsBody space={space} />
    case 'timesaved': return <TimeSavedBody />
    case 'claude': return <ClaudeBody />
    case 'social': return <SocialBody />
    case 'sources': return <SourcesBody size={size} />
    case 'outreach': return <OutreachBody />
  }
}
