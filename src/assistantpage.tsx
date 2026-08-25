import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './store'
import { useCalendar } from './calendar'
import { Band } from './ui'
import { hasAiKey } from './ai'
import { ask, OPENING_PROMPT, type Brief, type Card, type Reply } from './assistant'
import { SLOTS, dueOn, habitsDueToday, goalCurrent, type HabitDef, type Task } from './types'
import { localDateKey, fmtDuration, goalPeriodKey, goalPeriodRange, type GoalTf } from './util'

/* The assistant, as a room of its own.

   Two halves. On the left it talks; on the right it SHOWS, using the same
   components every other page uses, drawn from the same store. The model never
   writes a number: it names a card and the app fills it. So a wrong sentence is
   a wrong sentence, and can never become a wrong figure.

   It speaks first. Opening on a blank box with a cursor would make him do the
   work of deciding what to ask, which is exactly the decision this app keeps
   trying to take off him. */

const dayLabel = () => new Date().toLocaleDateString('en-GB', { weekday: 'long' })

function useBrief(): Brief {
  const { tasks, habits, habitLog, routines, focusSessions, goals, todayIndex, inView, slips } = useStore()
  const { state: cal } = useCalendar()
  return useMemo(() => {
    const day = localDateKey()
    const mine = tasks.filter((t) => inView(t.space))
    const onDay = mine.filter((t) => t.list === 'today' && (t.plannedOn ?? day) === day)
    const planned = SLOTS.map((s) => ({
      slot: s.label,
      items: onDay.filter((t) => t.slot === s.id).map((t) => ({ title: t.title, done: !!t.done, min: t.estimateMin ?? 0 })),
    }))
    const unsorted = onDay.filter((t) => !t.slot)
    if (unsorted.length) planned.unshift({ slot: 'Unsorted', items: unsorted.map((t) => ({ title: t.title, done: !!t.done, min: t.estimateMin ?? 0 })) })
    const backlog = mine.filter((t) => t.list === 'backlog' && !t.done)
    const age = (t: Task) => {
      if (!t.createdAt) return 0
      const [y, m, d] = t.createdAt.split('-').map(Number)
      return Math.max(0, Math.round((Date.now() - new Date(y, m - 1, d).getTime()) / 86400000))
    }
    const visible = habits.filter((h) => inView(h.space) && !h.archivedAt)
    const { due, kept } = habitsDueToday(visible, routines, habitLog, todayIndex)
    const open = visible.filter((h) => dueOn(h, todayIndex, habitLog) && !h.days[todayIndex] && !h.folderId).map((h) => h.name)
    const meetings = cal.status === 'ok'
      ? cal.events.filter((e) => e.day === day && e.start !== null)
        .map((e) => ({ at: `${String(Math.floor((e.start as number) / 60)).padStart(2, '0')}:${String((e.start as number) % 60).padStart(2, '0')}`, title: e.title }))
      : []
    return {
      now: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      weekday: dayLabel(),
      planned,
      backlogCount: backlog.length,
      oldest: [...backlog].sort((a, b) => age(b) - age(a)).slice(0, 3).map((t) => ({ title: t.title, days: age(t) })),
      habits: { due, kept, open: open.slice(0, 6) },
      meetings,
      focusToday: focusSessions.filter((f) => f.day === day && inView(f.space)).reduce((a, f) => a + f.minutes, 0),
      goals: goals.filter((g) => inView(g.space) && !g.closed).slice(0, 4).map((g) => {
        const tf = (g.timeframe ?? 'quarter') as GoalTf
        const range = goalPeriodRange(tf, g.periodKey ?? goalPeriodKey(tf))
        const cur = goalCurrent(g, habits, habitLog, range, slips, focusSessions)
        return { name: g.name, pct: g.target > 0 ? Math.round((cur / g.target) * 100) : 0 }
      }),
    }
  }, [tasks, habits, habitLog, routines, focusSessions, goals, todayIndex, inView, slips, cal])
}

/* ---- the cards ----
   Every one reads the store directly. None of them is handed anything by the
   model beyond its own name. */

function CardBody({ kind }: { kind: Card['kind'] }) {
  const { tasks, habits, habitLog, routines, focusSessions, goals, todayIndex, inView, setPage, toggleTask, toggleHabitDay } = useStore()
  const { state: cal } = useCalendar()
  const day = localDateKey()
  const mine = tasks.filter((t) => inView(t.space))

  if (kind === 'today' || kind === 'stale') {
    const rows = kind === 'today'
      ? mine.filter((t) => t.list === 'today' && (t.plannedOn ?? day) === day)
      : mine.filter((t) => t.list === 'backlog' && !t.done)
        .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')).slice(0, 6)
    if (!rows.length) return <p className="as-empty">{kind === 'today' ? 'Nothing on the day yet.' : 'Nothing has been sitting long.'}</p>
    const bySlot = kind === 'today'
      ? SLOTS.map((s) => ({ label: s.label, items: rows.filter((t) => t.slot === s.id) }))
        .concat([{ label: 'Unsorted', items: rows.filter((t) => !t.slot) }]).filter((g) => g.items.length)
      : [{ label: 'Oldest first', items: rows }]
    return (
      <div className="as-list">
        {bySlot.map((g) => (
          <div key={g.label}>
            <span className="microcap">{g.label}</span>
            {g.items.map((t) => (
              <div className={`as-row${t.done ? ' is-done' : ''}`} key={t.id}>
                <button className="checkbox" role="checkbox" aria-checked={!!t.done}
                  aria-label={t.title} onClick={() => toggleTask(t.id)}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 5.65 5 8.65 10 2.15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                </button>
                <span className="as-row-title">{t.title}</span>
                {t.estimateMin > 0 && <span className="as-row-min mono">{fmtDuration(t.estimateMin)}</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }

  if (kind === 'backlog') {
    const rows = mine.filter((t) => t.list === 'backlog' && !t.done).slice(0, 10)
    if (!rows.length) return <p className="as-empty">The list is empty.</p>
    return (
      <div className="as-list">
        {rows.map((t) => (
          <div className="as-row" key={t.id}>
            <span className="as-row-title">{t.title}</span>
            {t.carried ? <span className="as-row-min mono">back {t.carried}x</span> : null}
          </div>
        ))}
      </div>
    )
  }

  if (kind === 'habits') {
    const visible = habits.filter((h) => inView(h.space) && !h.archivedAt && dueOn(h, todayIndex, habitLog))
    if (!visible.length) return <p className="as-empty">Nothing is due today.</p>
    return (
      <div className="as-list">
        {[...visible].sort((a, b) => Number(a.days[todayIndex]) - Number(b.days[todayIndex])).slice(0, 8).map((h: HabitDef) => (
          <div className={`as-row${h.days[todayIndex] ? ' is-done' : ''}`} key={h.id}>
            <button className="checkbox" role="checkbox" aria-checked={h.days[todayIndex]}
              aria-label={h.name} onClick={() => toggleHabitDay(h.id, todayIndex)}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 5.65 5 8.65 10 2.15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
            <span className="as-row-title">{h.name}</span>
          </div>
        ))}
      </div>
    )
  }

  if (kind === 'calendar') {
    if (cal.status !== 'ok') return <p className="as-empty">The calendar is not connected.</p>
    const rows = cal.events.filter((e) => e.day === day)
    if (!rows.length) return <p className="as-empty">Nothing in the calendar today.</p>
    return (
      <div className="as-list">
        {rows.map((e) => (
          <div className="as-row" key={e.uid + e.day}>
            <span className="as-row-min mono">{e.allDay ? 'all day' : `${String(Math.floor((e.start as number) / 60)).padStart(2, '0')}:${String((e.start as number) % 60).padStart(2, '0')}`}</span>
            <span className="as-row-title">{e.title}</span>
          </div>
        ))}
      </div>
    )
  }

  if (kind === 'focus') {
    const week = focusSessions.filter((f) => inView(f.space)).slice(-7)
    const total = week.reduce((a, f) => a + f.minutes, 0)
    if (!total) return <p className="as-empty">No blocks logged yet.</p>
    return (
      <div className="as-list">
        {week.map((f, i) => (
          <div className="as-row" key={i}>
            <span className="as-row-min mono">{f.day.slice(5)}</span>
            <span className="as-row-title">{f.label ?? 'Focus block'}</span>
            <span className="as-row-min mono">{fmtDuration(f.minutes)}</span>
          </div>
        ))}
      </div>
    )
  }

  const gs = goals.filter((g) => inView(g.space) && !g.closed).slice(0, 6)
  if (!gs.length) return <p className="as-empty">No goals set.</p>
  return (
    <div className="as-list">
      {gs.map((g) => (
        <button className="as-row as-link" key={g.id} onClick={() => setPage('goals')}>
          <span className="as-row-title">{g.name}</span>
          <span className="as-row-min mono">{g.current} / {g.target}</span>
        </button>
      ))}
    </div>
  )
}

const TITLES: Record<Card['kind'], string> = {
  today: 'On the day', backlog: 'The list', habits: 'Habits today',
  calendar: 'Calendar', goals: 'Goals', focus: 'Focus', stale: 'Sitting longest',
}

interface Turn { who: 'you' | 'it'; text: string; reply?: Reply }

export function AssistantPage() {
  const brief = useBrief()
  const [turns, setTurns] = useState<Turn[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const opened = useRef(false)
  const foot = useRef<HTMLDivElement>(null)

  const send = async (text: string, silent = false) => {
    if (busy) return
    setBusy(true); setErr(null)
    if (!silent) setTurns((t) => [...t, { who: 'you', text }])
    const history = turns.map((t) => ({ role: (t.who === 'you' ? 'user' : 'assistant') as 'user' | 'assistant', content: t.text }))
    const out = await ask(text, brief, history)
    if (out.ok) setTurns((t) => [...t, { who: 'it', text: out.reply.say, reply: out.reply }])
    else setErr(
      out.reason === 'no-key' ? 'No Groq key yet. Add one in Settings and this can answer.'
        : out.reason === 'rejected' ? 'That Groq key was rejected. Check it in Settings.'
          : out.reason === 'offline' ? 'Could not reach the model.'
            : out.detail ?? 'The answer came back unreadable.',
    )
    setBusy(false)
  }

  /* It speaks first. Opening on an empty box would hand him the decision of
     what to ask, and deciding is the thing he came here to be helped with. */
  useEffect(() => {
    if (opened.current || !hasAiKey()) return
    opened.current = true
    void send(OPENING_PROMPT, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { foot.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [turns, busy])

  return (
    <div className="page as-page">
      <Band title="Assistant" />
      {!hasAiKey() && (
        <div className="empty">No Groq key yet. Add one in Settings and this page can answer.</div>
      )}
      <div className="as-thread">
        {turns.map((t, i) => (
          <div className={`as-turn is-${t.who}`} key={i}>
            <p className="as-said">{t.text}</p>
            {t.reply?.show.map((c, k) => (
              <section className="as-card" key={k}>
                <span className="microcap">{TITLES[c.kind]}</span>
                <CardBody kind={c.kind} />
              </section>
            ))}
            {t.reply?.next && t.reply.next.length > 0 && (
              <div className="as-next">
                {t.reply.next.map((n, k) => (
                  <button className="btn btn-quiet" key={k} onClick={() => void send(n)}>{n}</button>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && <p className="as-thinking">Reading your day.</p>}
        {err && <p className="as-error">{err}</p>}
        <div ref={foot} />
      </div>
      <form
        className="as-ask"
        onSubmit={(e) => { e.preventDefault(); const t = q.trim(); if (t) { setQ(''); void send(t) } }}
      >
        <input
          className="textinput" value={q} placeholder="Ask about your day"
          aria-label="Ask the assistant"
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn btn-primary" disabled={busy || !q.trim()}>Ask</button>
      </form>
    </div>
  )
}
