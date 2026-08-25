import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './store'
import { useCalendar } from './calendar'
import { SpaceMark } from './ui'
import { SPACE_LABELS } from './mock'
import { ask, STARTERS, opener, type Brief, type Card, type CardKind, type Reply } from './assistant'
import { engineName, speechState, stop as stopSpeech, subscribe, toggle } from './speech'
import { SLOTS, dueOn, habitsDueToday, goalCurrent, type HabitDef, type PageId, type SpaceId, type Task } from './types'
import { localDateKey, fmtDuration, goalPeriodKey, goalPeriodRange, type GoalTf } from './util'
import * as Icon from './icons'

/* The assistant, as a room of its own.

   TWO HALVES, once he has asked something. On the left it talks; on the right
   it SHOWS. The talking half never carries the data, and the showing half never
   carries an opinion. Ask for the day and the left says it pulled the day, the
   right becomes the day; ask about habits next and the left says so, the right
   turns into habits. One canvas, swapped, not a transcript that grows cards.

   Two reasons it is built this way rather than as cards inside the thread.
   Scrolling back four questions to see a list you are working from is not
   reading, it is hunting. And a list you are working from should not move while
   you type the next question.

   IT NEVER SCOPES TO A WORKSPACE. Every other page in this app is filtered to
   the space he is standing in; this one is deliberately not. Asking "what is on
   today" and getting only the Big Time half of today is a wrong answer told
   confidently. So every row carries its workspace mark instead, and the answer
   is the whole day.

   The model never writes a number: it names a card and the app fills it. So a
   wrong sentence is a wrong sentence, and can never become a wrong figure. */

const dayLabel = () => new Date().toLocaleDateString('en-GB', { weekday: 'long' })
/** Which workspace a thing came from, in words the model can repeat back. */
const label = (s?: SpaceId) => (s ? SPACE_LABELS[s] : 'Unfiled')

/** Wide enough for the split. Below this the canvas would be a column of
 *  nothing, so the cards go back into the thread where there is room for them. */
function useSplit(): boolean {
  const [wide, setWide] = useState(() =>
    typeof matchMedia === 'function' ? matchMedia('(min-width: 1000px)').matches : true)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia('(min-width: 1000px)')
    const on = () => setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return wide
}

function useBrief(): Brief {
  const { tasks, habits, habitLog, routines, focusSessions, goals, todayIndex, slips } = useStore()
  const { state: cal } = useCalendar()
  return useMemo(() => {
    const day = localDateKey()
    /* No inView. The briefing is his whole life, because he asked the whole
       life, and a filtered briefing makes the model confident about a day it
       has only seen a third of. */
    const onDay = tasks.filter((t) => t.list === 'today' && (t.plannedOn ?? day) === day)
    const planned = SLOTS.map((s) => ({
      slot: s.label,
      items: onDay.filter((t) => t.slot === s.id).map((t) => ({ title: t.title, done: !!t.done, min: t.estimateMin ?? 0, space: label(t.space) })),
    }))
    const unsorted = onDay.filter((t) => !t.slot)
    if (unsorted.length) planned.unshift({ slot: 'Unsorted', items: unsorted.map((t) => ({ title: t.title, done: !!t.done, min: t.estimateMin ?? 0, space: label(t.space) })) })
    const backlog = tasks.filter((t) => t.list === 'backlog' && !t.done)
    const age = (t: Task) => {
      if (!t.createdAt) return 0
      const [y, m, d] = t.createdAt.split('-').map(Number)
      return Math.max(0, Math.round((Date.now() - new Date(y, m - 1, d).getTime()) / 86400000))
    }
    const visible = habits.filter((h) => !h.archivedAt)
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
      oldest: [...backlog].sort((a, b) => age(b) - age(a)).slice(0, 3).map((t) => ({ title: t.title, days: age(t), space: label(t.space) })),
      habits: { due, kept, open: open.slice(0, 6) },
      meetings,
      focusToday: focusSessions.filter((f) => f.day === day).reduce((a, f) => a + f.minutes, 0),
      goals: goals.filter((g) => !g.closed).slice(0, 4).map((g) => {
        const tf = (g.timeframe ?? 'quarter') as GoalTf
        const range = goalPeriodRange(tf, g.periodKey ?? goalPeriodKey(tf))
        const cur = goalCurrent(g, habits, habitLog, range, slips, focusSessions)
        return { name: g.name, pct: g.target > 0 ? Math.round((cur / g.target) * 100) : 0 }
      }),
    }
  }, [tasks, habits, habitLog, routines, focusSessions, goals, todayIndex, slips, cal])
}

/* ---- the cards ----
   Every one reads the store directly. None of them is handed anything by the
   model beyond its own name. Every row carries its workspace, always, because
   this page mixes all three on purpose. */

/* Rows land one after another instead of all at once, capped at ten so a long
   list never turns into a loading screen. 18ms apart is under the threshold
   where it reads as waiting; it reads as the list being dealt. */
const stagger = (i: number) => ({ animationDelay: `${Math.min(i, 10) * 18}ms` })

function Tick() {
  return (
    <Icon.Check size={12} strokeWidth={1.0} />
  )
}

/* Where the whole of a card lives, for when only the head of it is shown. */
const MORE_IN: Record<CardKind, [PageId, string]> = {
  today: ['today', 'Today'], backlog: ['plan', 'Plan'], habits: ['habits', 'Habits'],
  calendar: ['calendar', 'Calendar'], goals: ['goals', 'Goals'], focus: ['focus', 'Focus'],
  stale: ['plan', 'Plan'],
}

/** The canvas shows everything; a card inside the thread on a phone shows the
 *  head of it and says where the rest is. Forty habits in a chat bubble pushed
 *  the sentence that introduced them off the top of the screen. */
function More({ n, kind }: { n: number; kind: CardKind }) {
  const { setPage } = useStore()
  const [page, name] = MORE_IN[kind]
  if (n <= 0) return null
  return <button className="as-more" onClick={() => setPage(page)}>{n} more in {name}</button>
}

function CardBody({ kind, limit }: { kind: CardKind; limit?: number }) {
  const { tasks, habits, habitLog, focusSessions, goals, todayIndex, setPage, toggleTask, toggleHabitDay } = useStore()
  const { state: cal } = useCalendar()
  const day = localDateKey()

  if (kind === 'today' || kind === 'stale') {
    const all = kind === 'today'
      ? tasks.filter((t) => t.list === 'today' && (t.plannedOn ?? day) === day)
      : tasks.filter((t) => t.list === 'backlog' && !t.done)
        .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')).slice(0, 12)
    if (!all.length) return <p className="as-empty">{kind === 'today' ? 'Nothing on the day yet.' : 'Nothing has been sitting long.'}</p>
    const rows = limit ? all.slice(0, limit) : all
    const groups = kind === 'today'
      ? SLOTS.map((s) => ({ label: s.label, items: rows.filter((t) => t.slot === s.id) }))
        .concat([{ label: 'Unsorted', items: rows.filter((t) => !t.slot) }]).filter((g) => g.items.length)
      : [{ label: 'Oldest first', items: rows }]
    return (
      <div className="as-list">
        {groups.map((g) => (
          <div className="as-group" key={g.label}>
            <span className="microcap">{g.label}</span>
            {g.items.map((t, i) => (
              <div className={`as-row${t.done ? ' is-done' : ''}`} key={t.id} style={stagger(i)}>
                <button className="checkbox" role="checkbox" aria-checked={!!t.done}
                  aria-label={t.title} onClick={() => toggleTask(t.id)}><Tick /></button>
                <SpaceMark space={t.space} always />
                <span className="as-row-title">{t.title}</span>
                {t.estimateMin > 0 && <span className="as-row-min mono">{fmtDuration(t.estimateMin)}</span>}
              </div>
            ))}
          </div>
        ))}
        <More n={all.length - rows.length} kind={kind} />
      </div>
    )
  }

  if (kind === 'backlog') {
    const all = tasks.filter((t) => t.list === 'backlog' && !t.done).slice(0, 30)
    if (!all.length) return <p className="as-empty">The list is empty.</p>
    const rows = all.slice(0, limit ?? 20)
    return (
      <div className="as-list">
        <div className="as-group">
          {rows.map((t, i) => (
            <div className="as-row" key={t.id} style={stagger(i)}>
              <button className="checkbox" role="checkbox" aria-checked={false}
                aria-label={t.title} onClick={() => toggleTask(t.id)}><Tick /></button>
              <SpaceMark space={t.space} always />
              <span className="as-row-title">{t.title}</span>
              {t.carried ? <span className="as-row-min mono">back {t.carried}x</span> : null}
            </div>
          ))}
        </div>
        <More n={all.length - rows.length} kind={kind} />
      </div>
    )
  }

  if (kind === 'habits') {
    const all = [...habits.filter((h) => !h.archivedAt && dueOn(h, todayIndex, habitLog))]
      .sort((a, b) => Number(a.days[todayIndex]) - Number(b.days[todayIndex]))
    if (!all.length) return <p className="as-empty">Nothing is due today.</p>
    const rows = limit ? all.slice(0, limit) : all
    return (
      <div className="as-list">
        <div className="as-group">
          {rows.map((h: HabitDef, i) => (
            <div className={`as-row${h.days[todayIndex] ? ' is-done' : ''}`} key={h.id} style={stagger(i)}>
              <button className="checkbox" role="checkbox" aria-checked={h.days[todayIndex]}
                aria-label={h.name} onClick={() => toggleHabitDay(h.id, todayIndex)}><Tick /></button>
              <SpaceMark space={h.space} always />
              <span className="as-row-title">{h.name}</span>
            </div>
          ))}
        </div>
        <More n={all.length - rows.length} kind={kind} />
      </div>
    )
  }

  if (kind === 'calendar') {
    if (cal.status !== 'ok') return <p className="as-empty">The calendar is not connected.</p>
    const all = cal.events.filter((e) => e.day >= day).slice(0, 25)
    if (!all.length) return <p className="as-empty">Nothing in the calendar.</p>
    const rows = limit ? all.slice(0, limit) : all
    return (
      <div className="as-list">
        <div className="as-group">
          {rows.map((e, i) => (
            <div className="as-row" key={e.uid + e.day} style={stagger(i)}>
              <span className="as-row-when mono">{e.allDay ? 'all day' : `${String(Math.floor((e.start as number) / 60)).padStart(2, '0')}:${String((e.start as number) % 60).padStart(2, '0')}`}</span>
              <span className="as-row-title">{e.title}</span>
              {e.day !== day && <span className="as-row-min mono">{e.day.slice(5)}</span>}
            </div>
          ))}
        </div>
        <More n={all.length - rows.length} kind={kind} />
      </div>
    )
  }

  if (kind === 'focus') {
    const all = focusSessions.slice(-10).reverse()
    if (!all.length) return <p className="as-empty">No blocks logged yet.</p>
    const week = limit ? all.slice(0, limit) : all
    return (
      <div className="as-list">
        <div className="as-group">
          {week.map((f, i) => (
            <div className="as-row" key={i} style={stagger(i)}>
              <span className="as-row-when mono">{f.day.slice(5)}</span>
              <SpaceMark space={f.space} always />
              <span className="as-row-title">{f.label ?? 'Focus block'}</span>
              <span className="as-row-min mono">{fmtDuration(f.minutes)}</span>
            </div>
          ))}
        </div>
        <More n={all.length - week.length} kind={kind} />
      </div>
    )
  }

  const allGoals = goals.filter((g) => !g.closed)
  if (!allGoals.length) return <p className="as-empty">No goals set.</p>
  const gs = limit ? allGoals.slice(0, limit) : allGoals
  return (
    <div className="as-list">
      <div className="as-group">
        {gs.map((g, i) => (
          <button className="as-row as-link" key={g.id} style={stagger(i)} onClick={() => setPage('goals')}>
            <SpaceMark space={g.space} always />
            <span className="as-row-title">{g.name}</span>
            <span className="as-row-min mono">{g.current} / {g.target}</span>
          </button>
        ))}
      </div>
      <More n={allGoals.length - gs.length} kind="goals" />
    </div>
  )
}

const TITLES: Record<CardKind, string> = {
  today: 'On the day', backlog: 'The list', habits: 'Habits today',
  calendar: 'Calendar', goals: 'Goals', focus: 'Focus', stale: 'Sitting longest',
}

/** The canvas. One place, swapped, animated on the swap so the change is
 *  visible rather than a silent substitution while he is looking elsewhere. */
function Canvas({ kinds }: { kinds: CardKind[] }) {
  const sig = kinds.join('+')
  return (
    <aside className="as-canvas" aria-live="polite">
      <header className="as-canvas-head">
        <h2 key={sig}>{kinds.map((k) => TITLES[k]).join(' · ')}</h2>
      </header>
      <div className="as-canvas-body" key={sig}>
        {kinds.map((k) => (
          <section className="as-pane" key={k}>
            {kinds.length > 1 && <h3 className="microcap as-pane-head">{TITLES[k]}</h3>}
            <CardBody kind={k} />
          </section>
        ))}
      </div>
    </aside>
  )
}

/* Play and pause on an answer, the way it sits under a reply in Claude.

   It is deliberately not a row of transport controls. There is no scrubber, no
   speed, no voice picker: this is a thing he presses once on the way to making
   coffee, and every control that is not play is a control he would never touch.

   The label is the state, not a fixed word, because an icon alone cannot say
   whether a silent second means loading or finished. */
function Speak({ id, text }: { id: string; text: string }): JSX.Element {
  const [, bump] = useState(0)
  useEffect(() => subscribe(() => bump((n) => n + 1)), [])
  const st = speechState(id)
  const label = st === 'playing' ? 'Pause' : st === 'loading' ? 'Loading' : st === 'paused' ? 'Resume' : 'Play'
  return (
    <button
      className={`as-speak is-${st}`}
      onClick={() => void toggle(id, text)}
      disabled={st === 'loading'}
      aria-label={`${label} this answer, spoken by ${engineName()}`}
      title={`${label}. Read by ${engineName()}.`}
    >
      <span className="as-speak-ico" aria-hidden="true">
        {st === 'playing' ? (
          <Icon.Pause size={12} filled />
        ) : (
          <Icon.Play size={12} filled />
        )}
      </span>
      {label}
    </button>
  )
}

interface Turn { who: 'you' | 'it'; text: string; reply?: Reply }

export function AssistantPage() {
  const brief = useBrief()
  const split = useSplit()
  const [turns, setTurns] = useState<Turn[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  /* A second line that says what to DO about it. An error naming a retired
     model means nothing to him; "the model this app used was retired, this
     build already moved to its replacement, reload" is something he can act on. */
  const [errHint, setErrHint] = useState<string | null>(null)
  /* What the right half is showing. It survives a reply that names no cards,
     because a canvas that empties itself every time he asks a plain question is
     a canvas he cannot work from. */
  const [canvas, setCanvas] = useState<CardKind[]>(['today'])
  /* The answer as it is being written. The model emits its sentence first, so
     this fills in a few words at a time while the rest of the object is still
     coming, which is the difference between watching it think and watching a
     spinner spin. */
  const [live, setLive] = useState('')
  const foot = useRef<HTMLDivElement>(null)
  const shell = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  /* The page is exactly the room left under the header, so the thread scrolls
     inside itself and the ask box does not travel with it. Measured rather than
     assumed: the header grows a banner some days, and a hardcoded offset would
     put the box a banner's height off the bottom on exactly those days. */
  useEffect(() => {
    const el = shell.current
    if (!el) return
    const fit = () => {
      const top = Math.round(el.getBoundingClientRect().top + window.scrollY)
      el.style.setProperty('--as-top', `${top}px`)
    }
    fit()
    window.addEventListener('resize', fit)
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null
    if (ro && el.parentElement) ro.observe(el.parentElement)
    return () => { window.removeEventListener('resize', fit); ro?.disconnect() }
  }, [])

  const send = async (text: string) => {
    if (busy) return
    setBusy(true); setErr(null); setErrHint(null); setLive('')
    setTurns((t) => [...t, { who: 'you', text }])
    const history = turns.map((t) => ({ role: (t.who === 'you' ? 'user' : 'assistant') as 'user' | 'assistant', content: t.text }))
    const out = await ask(text, brief, history, setLive)
    if (out.ok) {
      setTurns((t) => [...t, { who: 'it', text: out.reply.say, reply: out.reply }])
      const kinds = out.reply.show.map((c: Card) => c.kind)
      if (kinds.length) setCanvas(kinds.slice(0, 3))
    } else {
      setErr(
        out.reason === 'no-key' ? 'No Groq key yet.'
          : out.reason === 'rejected' ? 'That Groq key was rejected.'
            : out.reason === 'offline' ? 'Could not reach the model.'
              : out.detail ?? 'The answer came back unreadable.',
      )
      setErrHint(
        out.reason === 'no-key' ? 'Add one in Settings. It is free and it stays on this device.'
          : out.reason === 'rejected' ? 'Check it in Settings, or generate a new one at console.groq.com.'
            : out.reason === 'model-gone' ? 'The model this app used was retired. This build already moved to its replacement, so reload the page.'
              : out.reason === 'offline' ? 'Check the connection and ask again.'
                : 'Ask again, or rephrase it.',
      )
    }
    setBusy(false); setLive('')
    box.current?.focus()
  }

  useEffect(() => { foot.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [turns, busy])
  /* Instant while it writes. Smooth-scrolling on every token makes each new
     word fight the last one's animation and the column shivers. */
  useEffect(() => { if (live) foot.current?.scrollIntoView({ block: 'end' }) }, [live])
  /* The caret is in the box when the page opens. Every other page here is a
     thing to read; this one is a thing to type into. */
  useEffect(() => { box.current?.focus() }, [])
  /* Walking off the page stops the voice. Otherwise it keeps reading an answer
     that is no longer on screen, from a page he has already left. */
  useEffect(() => stopSpeech, [])

  const empty = turns.length === 0 && !busy && !err
  const submit = () => { const t = q.trim(); if (t) { setQ(''); void send(t) } }

  const askBox = (
    <form className="as-ask" onSubmit={(e) => { e.preventDefault(); submit() }}>
      <textarea
        ref={box}
        className="as-input"
        value={q}
        rows={1}
        placeholder="Ask anything about your week"
        aria-label="Ask the assistant"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
        }}
      />
      <div className="as-ask-foot">
        <span className="as-hint">Enter sends. Shift and Enter for a new line.</span>
        <button className="btn btn-primary as-send" disabled={busy || !q.trim()}>Ask</button>
      </div>
    </form>
  )

  return (
    <div ref={shell} className={`page as-page${empty ? ' is-empty' : ' is-split'}`}>
      {/* Before he has asked anything the page is a doorway, not a workspace:
          one mark, one question, one box. The split arrives with the answer. */}
      {empty && (
        <div className="as-open">
          <div className="as-hero">
            <span className="as-orb" aria-hidden="true" />
            <h1 className="as-hero-q">What can I help with?</h1>
            {/* Something true the moment the page opens, counted by the app, not
                asked of a model. This is the only sentence here allowed to carry
                numbers, because the app is the thing doing the counting. */}
            <p className="as-hero-now">{opener(brief)}</p>
          </div>
          {askBox}
          {/* Not attach, search, reason, create an image. Those are a general
              chatbot's furniture and none of them is a thing this app does.
              These are questions about his own week, each answerable from his
              own log. */}
          <div className="as-starters">
            {STARTERS.map((s) => (
              <button className="as-chip" key={s.label} onClick={() => void send(s.ask)}>{s.label}</button>
            ))}
          </div>
        </div>
      )}

      {!empty && (
        <>
          <div className="as-chat">
            <div className="as-thread">
              {turns.map((t, i) => (
                <div className={`as-turn is-${t.who}`} key={i}>
                  <p className="as-said">{t.text}</p>
                  {/* One row of things you can do with the answer: hear it, and
                      go to what it pulled. Play used to sit on its own line above
                      these and read as a fourth stacked pill, which made a
                      two-line sentence carry three rows of furniture.
                      On a wide screen the cards live on the right, so the thread
                      keeps only a way back to them. On a phone there is no right,
                      so they render below, full size. */}
                  {t.who === 'it' && (t.text.trim() || (split && t.reply?.show.length)) ? (
                    <div className="as-pulled">
                      {t.text.trim() ? <Speak id={`t${i}`} text={t.text} /> : null}
                      {split && t.reply?.show.length
                        ? t.reply.show.map((c, k) => (
                            <button className="as-pulled-btn" key={k} onClick={() => setCanvas([c.kind])}>
                              {TITLES[c.kind]}
                            </button>
                          ))
                        : null}
                    </div>
                  ) : null}
                  {t.reply?.show.length ? (
                    split ? null : (
                      t.reply.show.map((c, k) => (
                        <section className="as-card" key={k}>
                          <h3 className="microcap">{TITLES[c.kind]}</h3>
                          <CardBody kind={c.kind} limit={6} />
                        </section>
                      ))
                    )
                  ) : null}
                  {t.reply?.next && t.reply.next.length > 0 && (
                    <div className="as-next">
                      {t.reply.next.map((n, k) => (
                        <button className="as-chip" key={k} onClick={() => void send(n)}>{n}</button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {busy && (
                <div className="as-turn is-it">
                  {live
                    ? (
                      <p className="as-said is-live" role="status">
                        {live}<span className="as-caret" aria-hidden="true" />
                      </p>
                    )
                    : (
                      <p className="as-thinking" role="status">
                        <span className="as-orb as-orb-sm" aria-hidden="true" />
                        <span className="as-dots" aria-hidden="true"><i /><i /><i /></span>
                        <span className="visually-hidden">Reading your day</span>
                      </p>
                    )}
                </div>
              )}
              {err && (
                <div className="as-error">
                  <p>{err}</p>
                  {errHint && <p className="as-error-hint">{errHint}</p>}
                </div>
              )}
              <div ref={foot} />
            </div>
            {askBox}
          </div>
          {split && <Canvas kinds={canvas} />}
        </>
      )}
    </div>
  )
}
