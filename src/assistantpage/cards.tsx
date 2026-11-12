import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { useCalendar } from '../calendar'
import { SpaceMark, TagMark } from '../ui'
import { type CardKind } from '../assistant'
import { getWeather, type Weather } from '../weather'
import { SLOTS, dueOn, habitStepKey, routineComplete, requiredSteps, type HabitDef, type PageId } from '../types'
import { localDateKey, fmtDuration, periodKeyFor } from '../util'
import { useAssistantBills } from '../assistantbills'
import { TIER_LABEL } from '../peoplelayout'
import { SOURCES, STAGES, label } from '../prospectcalc'
import * as Icon from '../icons'
import { TITLES, fit, rowCls, stagger } from './shared'

export function Tick() {
  return (
    <Icon.Check size={12} strokeWidth={4} />
  )
}

/* Where the whole of a card lives, for when only the head of it is shown.
   Partial: the weather card has no page behind it and never truncates, so
   there is nowhere for it to send him and nothing to send him for. */
export const MORE_IN: Partial<Record<CardKind, [PageId, string]>> = {
  today: ['today', 'Today'], backlog: ['plan', 'Plan'], habits: ['habits', 'Habits'],
  calendar: ['calendar', 'Calendar'], goals: ['goals', 'Goals'], focus: ['focus', 'Focus'],
  stale: ['plan', 'Plan'], planned: ['plan', 'Plan'], projects: ['projects', 'Projects'],
  routines: ['routines', 'Routines'], notes: ['notes', 'Notes'], people: ['people', 'People'],
  ideas: ['ideas', 'Ideas'], bills: ['bills', 'Bills'], gym: ['gym', 'Gym'], prompts: ['prompts', 'Prompts'],
  business: ['people', 'People'],
}

/* WHAT THE LAST CHANGE TOUCHED. A key is a row's id, or for a row the store
   makes without handing its id back (a new project, habit, goal), its name. */
export type Hot = (id: string, name?: string) => boolean

export const hotFor = (touched: string[]): Hot => {
  const names = new Set(touched.map((k) => k.trim().toLowerCase()))
  return (id, name) => touched.includes(id) || (!!name && names.has(name.trim().toLowerCase()))
}

/** Bills is its own component so the Supabase read only runs when the card is
 *  actually on screen. */
export function BillsCard({ hot, limit }: { hot: Hot; limit?: number }) {
  const bills = useAssistantBills()
  if (bills.loading) return <p className="as-empty">Bills is still loading.</p>
  if (!bills.ready) return <p className="as-empty">Bills is not signed in on this device.</p>
  const all = bills.items
  if (!all.length) return <p className="as-empty">Nothing due this cycle.</p>
  const rows = fit(all, limit ?? 30, (i) => hot(i.id, i.name))
  return (
    <div className="as-list">
      <div className="as-group">
        {rows.map((i, k) => (
          <div className={rowCls(hot(i.id, i.name), i.paid)} key={i.id} style={stagger(k)}>
            <span className="as-row-title">{i.name}</span>
            <span className="as-row-min mono">{i.amount} Kč{i.overdue && !i.paid ? ', overdue' : ''}</span>
          </div>
        ))}
      </div>
      <More n={all.length - rows.length} kind="bills" />
    </div>
  )
}

/** The canvas shows everything; a card inside the thread on a phone shows the
 *  head of it and says where the rest is. Forty habits in a chat bubble pushed
 *  the sentence that introduced them off the top of the screen. */
export function More({ n, kind }: { n: number; kind: CardKind }) {
  const { setPage } = useStore()
  const where = MORE_IN[kind]
  if (n <= 0 || !where) return null
  const [page, name] = where
  return <button className="as-more" onClick={() => setPage(page)}>{n} more in {name}</button>
}

/* Prague, drawn rather than described.

   The brief used to read the figures out in a sentence, which is the one thing
   a screen is better at than a voice. So the sky gets a card and the sentence
   gets to be a remark: "take a coat" is worth saying, "16 degrees and overcast"
   is already on the wall behind it.

   Every number here is the app's own fetch. The model never touches this. */
export function glyphFor(code: number): (p: Icon.IconProps) => JSX.Element {
  if (code === 0) return Icon.Sun
  if (code <= 2) return Icon.CloudSun
  if (code === 3) return Icon.Cloud
  if (code <= 48) return Icon.Fog
  if (code <= 67) return Icon.Rain
  if (code <= 77) return Icon.Snow
  if (code <= 86) return Icon.Rain
  return Icon.Storm
}

export function WeatherCard(): JSX.Element {
  const [w, setW] = useState<Weather | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    void getWeather().then((got) => { if (!live) return; if (got) setW(got); else setFailed(true) })
    return () => { live = false }
  }, [])
  if (failed) return <p className="as-empty">Could not reach the forecast.</p>
  if (!w) return <p className="as-empty">Looking outside…</p>
  const Now = glyphFor(w.code)
  return (
    <div className="wx">
      <div className="wx-now">
        <Now size={44} strokeWidth={1.5} />
        <span className="wx-temp mono">{w.nowC}<span className="wx-deg">°C</span></span>
        <span className="wx-meta">
          <span className="wx-sky">{w.sky[0].toUpperCase() + w.sky.slice(1)}</span>
          <span className="wx-hilo mono">{w.highC}° / {w.lowC}°{w.rainPct > 0 ? ` · ${w.rainPct}% rain` : ''}</span>
        </span>
      </div>
      {w.hours.length ? (
        /* Scrolls on its own rather than squeezing: eight hours at a readable
           size beats twelve at an unreadable one. */
        <div className="wx-hours">
          {w.hours.map((h) => {
            const G = glyphFor(h.code)
            return (
              <div className="wx-hour" key={h.at}>
                <span className="wx-at mono">{h.at}</span>
                <G size={20} strokeWidth={1.6} />
                <span className={`wx-rain mono${h.rainPct >= 30 ? ' is-wet' : ''}`}>{h.rainPct}%</span>
                <span className="wx-h-temp mono">{h.tempC}°</span>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export function CardBody({ kind, limit, touched = [], onAsk }: { kind: CardKind; limit?: number; touched?: string[]; onAsk?: (text: string) => void }) {
  const {
    tasks, habits, habitLog, routines, focusSessions, goals, todayIndex, setPage, toggleTask, toggleHabitDay,
    projects, notes, noteFolders, people, ideaBoard, gymGoals, prompts, prospects,
  } = useStore()
  const { state: cal } = useCalendar()
  const day = localDateKey()
  const hot = hotFor(touched)
  /* A task's words, with its #project tag running inline at the start of them.
     The tag used to be its own flex item beside the title, so a long tag
     (#elizabethbackontrack) left the title a column of three letters. Inside
     the title it wraps with the words and the title keeps the whole row. */
  const taskTitle = (t: { title: string; projectId?: string }) => {
    const pr = t.projectId ? projects.find((x) => x.id === t.projectId) : undefined
    return <span className="as-row-title">{pr ? <><TagMark project={pr} />{' '}</> : null}{t.title}</span>
  }

  if (kind === 'weather') return <WeatherCard />
  if (kind === 'bills') return <BillsCard hot={hot} limit={limit} />

  if (kind === 'planned') {
    const all = tasks.filter((t) => t.list === 'today' && (t.plannedOn ?? day) > day)
      .sort((a, b) => (a.plannedOn ?? '').localeCompare(b.plannedOn ?? '') || (a.at ?? '').localeCompare(b.at ?? ''))
    if (!all.length) return <p className="as-empty">Nothing planned after today.</p>
    const rows = fit(all, limit ?? 40, (t) => hot(t.id, t.title))
    const days = [...new Set(rows.map((t) => t.plannedOn as string))].sort()
    return (
      <div className="as-list">
        {days.map((d) => (
          <div className="as-group" key={d}>
            <span className="microcap">{new Date(`${d}T12:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</span>
            {rows.filter((t) => t.plannedOn === d).map((t, i) => (
              <div className={rowCls(hot(t.id, t.title), t.done)} key={t.id} style={stagger(i)}>
                <button className="checkbox" role="checkbox" aria-checked={!!t.done}
                  aria-label={t.title} onClick={() => toggleTask(t.id)}><Tick /></button>
                <SpaceMark space={t.space} always />
                {taskTitle(t)}
                <span className="as-row-min mono">{t.at ?? (t.estimateMin > 0 ? fmtDuration(t.estimateMin) : '')}</span>
              </div>
            ))}
          </div>
        ))}
        <More n={all.length - rows.length} kind={kind} />
      </div>
    )
  }

  if (kind === 'projects') {
    if (!projects.length) return <p className="as-empty">No projects yet.</p>
    return (
      <div className="as-list">
        <div className="as-group">
          {projects.map((p, i) => (
            <div className={rowCls(hot(p.id, p.name))} key={p.id} style={stagger(i)}>
              <SpaceMark space={p.space} always />
              <span className="as-row-title">{p.name}</span>
              <span className="as-row-min mono">{tasks.filter((t) => t.projectId === p.id && !t.done).length} open</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (kind === 'routines') {
    const all = routines.filter((r) => !r.archivedAt)
    if (!all.length) return <p className="as-empty">No routines yet.</p>
    return (
      <div className="as-list">
        {all.map((r, i) => {
          const on = hot(r.id, r.title)
          return (
            <div className="as-group" key={r.id}>
              <div className={rowCls(on, routineComplete(r, periodKeyFor(r.cadence)))} style={stagger(i)}>
                <SpaceMark space={r.space} always />
                <span className="as-row-title">{r.title}</span>
                <span className="as-row-min mono">{r.doneStepIds.length} / {r.steps.length}</span>
              </div>
              {/* The steps of the routine he just changed, and only that one:
                  a routine set runs to forty-odd steps. */}
              {on && r.steps.map((st, k) => (
                <div className={`as-row as-row-sub${r.doneStepIds.includes(st.id) ? ' is-done' : ''}`} key={st.id} style={stagger(k)}>
                  <span className="as-row-title">{st.title}</span>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    )
  }

  if (kind === 'notes') {
    const folderName = (id: string) => noteFolders.find((f) => f.id === id)?.name ?? ''
    const all = [...notes].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    if (!all.length) return <p className="as-empty">No notes yet.</p>
    const rows = fit(all, limit ?? 20, (n) => hot(n.id, n.title))
    return (
      <div className="as-list">
        <div className="as-group">
          {rows.map((n, i) => (
            <div className={rowCls(hot(n.id, n.title) || hot(n.folderId, folderName(n.folderId)), !!n.done)} key={n.id} style={stagger(i)}>
              <span className="as-row-title">{n.title || n.body.split('\n')[0]}</span>
              <span className="as-row-min mono">{folderName(n.folderId)}</span>
            </div>
          ))}
        </div>
        <More n={all.length - rows.length} kind={kind} />
      </div>
    )
  }

  if (kind === 'people') {
    const all = [...people].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    if (!all.length) return <p className="as-empty">Nobody on the People page yet.</p>
    const rows = fit(all, limit ?? 20, (p) => hot(p.id, p.name))
    return (
      <div className="as-list">
        <div className="as-group">
          {rows.map((p, i) => (
            <div className={rowCls(hot(p.id, p.name))} key={p.id} style={stagger(i)}>
              <span className="as-row-title">{p.name}{p.rel ? `, ${p.rel}` : ''}</span>
              <span className="as-row-min mono">{TIER_LABEL[p.tier]}</span>
            </div>
          ))}
        </div>
        <More n={all.length - rows.length} kind={kind} />
      </div>
    )
  }

  if (kind === 'business') {
    /* People > Business: each prospect with its stage and how he found it,
       the one JARVIS just touched marked (his report, 2026-10-04: a new
       prospect landed on the personal People list instead). Newest first. */
    const all = [...prospects].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    if (!all.length) return <p className="as-empty">No prospects yet.</p>
    const rows = fit(all, limit ?? 20, (p) => hot(p.id, p.name))
    return (
      <div className="as-list">
        <div className="as-group">
          {rows.map((p, i) => (
            <div className={rowCls(hot(p.id, p.name), p.stage === 'lost')} key={p.id} style={stagger(i)}>
              <span className="as-row-title">{p.name}{p.domain ? `, ${p.domain}` : ''}</span>
              <span className="as-row-min mono">{label(STAGES, p.stage)}, {label(SOURCES, p.source).toLowerCase()}</span>
            </div>
          ))}
        </div>
        <More n={all.length - rows.length} kind={kind} />
      </div>
    )
  }

  if (kind === 'ideas' || kind === 'gym' || kind === 'prompts') {
    const all = kind === 'ideas'
      ? [...ideaBoard].sort((a, b) => b.createdAt - a.createdAt).map((c) => ({ id: c.id, name: c.title, side: '' }))
      : kind === 'gym'
        ? gymGoals.map((g) => ({ id: g.id, name: g.name, side: `${g.current ?? '?'} / ${g.goal} ${g.unit}` }))
        : [...prompts].sort((a, b) => Number(!!a.sentAt) - Number(!!b.sentAt) || b.createdAt - a.createdAt)
          .map((p) => ({ id: p.id, name: p.text, side: p.sentAt ? 'sent' : p.project }))
    if (!all.length) return <p className="as-empty">Nothing here yet.</p>
    const rows = fit(all, limit ?? 20, (r) => hot(r.id, r.name))
    return (
      <div className="as-list">
        <div className="as-group">
          {rows.map((r, i) => (
            <div className={rowCls(hot(r.id, r.name))} key={r.id} style={stagger(i)}>
              <span className="as-row-title">{r.name}</span>
              {r.side ? <span className="as-row-min mono">{r.side}</span> : null}
            </div>
          ))}
        </div>
        <More n={all.length - rows.length} kind={kind} />
      </div>
    )
  }

  if (kind === 'today' || kind === 'stale') {
    const all = kind === 'today'
      ? tasks.filter((t) => t.list === 'today' && (t.plannedOn ?? day) === day)
      : tasks.filter((t) => t.list === 'backlog' && !t.done)
        .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')).slice(0, 12)
    if (!all.length) return <p className="as-empty">{kind === 'today' ? 'Nothing on the day yet.' : 'Nothing has been sitting long.'}</p>
    const rows = limit ? fit(all, limit, (t) => hot(t.id, t.title)) : all
    const groups = kind === 'today'
      ? SLOTS.map((s) => ({ label: s.label, items: rows.filter((t) => t.slot === s.id) }))
        .concat([{ label: 'Unsorted', items: rows.filter((t) => !t.slot) }]).filter((g) => g.items.length)
        /* A plan reads top to bottom by the clock: a pinned time sorts ahead of
           an unpinned one, earlier before later (the sheet had 15:30 under 16:45). */
        .map((g) => ({ ...g, items: [...g.items].sort((a, b) => (a.at ?? '99:99').localeCompare(b.at ?? '99:99')) }))
      : [{ label: 'Oldest first', items: rows }]
    return (
      <div className="as-list">
        {groups.map((g) => (
          <div className="as-group" key={g.label}>
            <span className="microcap">{g.label}</span>
            {g.items.map((t, i) => (
              <div className={rowCls(hot(t.id, t.title), t.done)} key={t.id} style={stagger(i)}>
                <button className="checkbox" role="checkbox" aria-checked={!!t.done}
                  aria-label={t.title} onClick={() => toggleTask(t.id)}><Tick /></button>
                <SpaceMark space={t.space} always />
                {taskTitle(t)}
                {t.estimateMin > 0 && <span className="as-row-min mono">{t.at ?? fmtDuration(t.estimateMin)}</span>}
              </div>
            ))}
          </div>
        ))}
        <More n={all.length - rows.length} kind={kind} />
      </div>
    )
  }

  if (kind === 'backlog') {
    /* A row he just ticked off the list stays in view, struck through, so
       "done" has somewhere to be seen. */
    const all = tasks.filter((t) => t.list === 'backlog' && (!t.done || hot(t.id)))
    if (!all.length) return <p className="as-empty">The list is empty.</p>
    const rows = fit(all, limit ?? 20, (t) => hot(t.id, t.title))
    return (
      <div className="as-list">
        <div className="as-group">
          {rows.map((t, i) => (
            <div className={rowCls(hot(t.id, t.title), t.done)} key={t.id} style={stagger(i)}>
              <button className="checkbox" role="checkbox" aria-checked={!!t.done}
                aria-label={t.title} onClick={() => toggleTask(t.id)}><Tick /></button>
              <SpaceMark space={t.space} always />
              {taskTitle(t)}
              {t.carried ? <span className="as-row-min mono">back {t.carried}x</span> : null}
            </div>
          ))}
        </div>
        <More n={all.length - rows.length} kind={kind} />
      </div>
    )
  }

  if (kind === 'habits') {
    /* Routines used to ride in this same list under their own auto-ticking
       habit, so "Morning Preparation" and "Invoicing routine" showed up as
       plain checkboxes -- tapping one looked like it worked and reverted on
       the next load, because a routine is finished by running its steps, not
       by a tick (his report, 2026-09-07). Same exclusion useBrief() applies
       to the text brief, applied here to the card so the two never disagree
       about what counts as a habit. */
    const routineHabitIds = new Set(routines.filter((r) => !r.archivedAt && r.habitId).map((r) => r.habitId as string))
    const allHabits = [...habits.filter((h) => !h.archivedAt && (hot(h.id, h.name) || (dueOn(h, todayIndex, habitLog) && !routineHabitIds.has(h.id) && !habitStepKey(h))))]
      .sort((a, b) => Number(a.days[todayIndex]) - Number(b.days[todayIndex]))
    const openRoutines = routines
      .filter((r) => !r.archivedAt && requiredSteps(r).length > 0 && !routineComplete(r, periodKeyFor(r.cadence)))
    if (!allHabits.length && !openRoutines.length) return <p className="as-empty">Nothing is due today.</p>
    const habitRows = limit ? fit(allHabits, limit, (h) => hot(h.id, h.name)) : allHabits
    return (
      <div className="as-list">
        {openRoutines.length > 0 && (
          <div className="as-group">
            <span className="microcap">Routines still open</span>
            {openRoutines.map((r, i) => (
              <button className="as-row as-row-link" key={r.id} style={stagger(i)} onClick={() => setPage('routines')}>
                <SpaceMark space={r.space} always />
                <span className="as-row-title">{r.title}</span>
                <span className="as-row-min mono">Run it →</span>
              </button>
            ))}
          </div>
        )}
        {habitRows.length > 0 && (
          <div className="as-group">
            {openRoutines.length > 0 && <span className="microcap">Habits</span>}
            {habitRows.map((h: HabitDef, i) => (
              <div className={rowCls(hot(h.id, h.name), h.days[todayIndex])} key={h.id} style={stagger(i)}>
                <button className="checkbox" role="checkbox" aria-checked={h.days[todayIndex]}
                  aria-label={h.name} onClick={() => toggleHabitDay(h.id, todayIndex)}><Tick /></button>
                <SpaceMark space={h.space} always />
                <span className="as-row-title">{h.name}</span>
              </div>
            ))}
          </div>
        )}
        <More n={allHabits.length - habitRows.length} kind={kind} />
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
    const week = limit ? all.slice(0, limit) : all
    return (
      <div className="as-list">
        {/* A starter, not a log: talking about focus puts the way in right here.
            It asks the assistant, so it starts the same real timer a spoken
            "focus for 25 minutes" does. */}
        {onAsk ? (
          <div className="as-focus-start" role="group" aria-label="Start a focus block">
            {[25, 50, 90].map((m) => (
              <button className="as-focus-btn" key={m} onClick={() => onAsk(`Start a ${m} minute focus timer`)}>
                <Icon.Waveform size={14} />{m} min
              </button>
            ))}
          </div>
        ) : null}
        {!all.length ? <p className="as-empty">No blocks logged yet.</p> : null}
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

  const allGoals = goals.filter((g) => !g.closed || hot(g.id, g.name))
  if (!allGoals.length) return <p className="as-empty">No goals set.</p>
  const gs = limit ? fit(allGoals, limit, (g) => hot(g.id, g.name)) : allGoals
  return (
    <div className="as-list">
      <div className="as-group">
        {gs.map((g, i) => (
          <button className={`${rowCls(hot(g.id, g.name))} as-link`} key={g.id} style={stagger(i)} onClick={() => setPage('goals')}>
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

/** The canvas. One place, swapped, animated on the swap so the change is
 *  visible rather than a silent substitution while he is looking elsewhere. */
export function Canvas({ kinds, touched, onAsk, top }: { kinds: CardKind[]; touched: string[]; onAsk?: (text: string) => void; top?: React.ReactNode }) {
  const sig = kinds.join('+')
  const body = useRef<HTMLDivElement>(null)
  /* Bring the first changed row into view: a new task at the bottom of a
     long list is otherwise a change he has to go and find. */
  useEffect(() => {
    const id = requestAnimationFrame(() => body.current?.querySelector('.is-touched')?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
    return () => cancelAnimationFrame(id)
  }, [sig, touched])
  return (
    <aside className="as-canvas" aria-live="polite">
      <header className="as-canvas-head">
        <h2 key={sig}>{kinds.map((k) => TITLES[k]).join(', ')}</h2>
      </header>
      {top}
      <div className="as-canvas-body" key={sig} ref={body}>
        {kinds.map((k) => (
          <section className="as-pane" key={k}>
            {kinds.length > 1 && <h3 className="microcap as-pane-head">{TITLES[k]}</h3>}
            <CardBody kind={k} touched={touched} onAsk={onAsk} />
          </section>
        ))}
      </div>
    </aside>
  )
}
