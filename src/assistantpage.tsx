import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './store'
import { isMeeting, useCalendar } from './calendar'
import { SpaceMark } from './ui'
import { SPACE_LABELS } from './mock'
import { MORNING, SKILLS, ask, type Action, type Brief, type Card, type CardKind, type Reply } from './assistant'
import { engineName, speakingLevel, speakingMeasured, speechState, stop as stopSpeech, subscribe, toggle } from './speech'
import {
  cancel as cancelDictation, dictateState, dictationAvailable, dictationEngine,
  stop as stopDictation, subscribe as subscribeDictation, toggle as toggleDictation,
} from './dictation'
import {
  enter as enterVoice, exit as exitVoice, subscribe as subscribeVoice,
  voiceHeard, voiceLevel, voiceModeAvailable, voicePhase,
} from './voicemode'
import { getWeather, weatherLine, type Weather } from './weather'
import { SLOTS, dueOn, habitsDueToday, goalCurrent, type HabitDef, type PageId, type SpaceId, type Task } from './types'
import { localDateKey, fmtDuration, taskMinutes, goalPeriodKey, goalPeriodRange, type GoalTf } from './util'
import { ActualLog } from './pages1'
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
/** A URL pasted straight into a task title reads fine as a link on his own
 *  list, and reads as noise once a sentence has to carry it -- on screen as a
 *  wall of characters, out loud as a wall of syllables. Stripped here rather
 *  than asked of the model, so a title with a link in it cannot come back
 *  verbatim no matter how the model chooses to write the sentence around it. */
const dropUrl = (title: string) => title.replace(/https?:\/\/\S+/gi, '').replace(/\s{2,}/g, ' ').trim()

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
  const { tasks, habits, habitLog, routines, focusSessions, goals, todayIndex, slips, plan } = useStore()
  const { state: cal } = useCalendar()
  /* Fetched once when the page opens. It is a garnish on the brief, so it never
     blocks anything and a failure just means no weather line. */
  const [sky, setSky] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void getWeather().then((w) => { if (live && w) setSky(weatherLine(w)) })
    return () => { live = false }
  }, [])
  return useMemo(() => {
    const day = localDateKey()
    const tm = new Date(); tm.setDate(tm.getDate() + 1)
    const tomorrowKey = localDateKey(tm)
    const yd = new Date(); yd.setDate(yd.getDate() - 1)
    const yesterdayKey = localDateKey(yd)
    /* No inView. The briefing is his whole life, because he asked the whole
       life, and a filtered briefing makes the model confident about a day it
       has only seen a third of. */
    const onDay = tasks.filter((t) => t.list === 'today' && (t.plannedOn ?? day) === day)
    const planned = SLOTS.map((s) => ({
      slot: s.label,
      items: onDay.filter((t) => t.slot === s.id).map((t) => ({ title: dropUrl(t.title) || t.title, done: !!t.done, min: t.estimateMin ?? 0, space: label(t.space) })),
    }))
    const unsorted = onDay.filter((t) => !t.slot)
    if (unsorted.length) planned.unshift({ slot: 'Unsorted', items: unsorted.map((t) => ({ title: dropUrl(t.title) || t.title, done: !!t.done, min: t.estimateMin ?? 0, space: label(t.space) })) })
    const backlog = tasks.filter((t) => t.list === 'backlog' && !t.done)
    const age = (t: Task) => {
      if (!t.createdAt) return 0
      const [y, m, d] = t.createdAt.split('-').map(Number)
      return Math.max(0, Math.round((Date.now() - new Date(y, m - 1, d).getTime()) / 86400000))
    }
    const visible = habits.filter((h) => !h.archivedAt)
    const { due, kept } = habitsDueToday(visible, routines, habitLog, todayIndex)
    const open = visible.filter((h) => dueOn(h, todayIndex, habitLog) && !h.days[todayIndex] && !h.folderId).map((h) => h.name)
    /* Split, not lumped. isMeeting() reads the guest list rather than the
       title, so an hour he blocked for himself stops being reported as a
       meeting he has to attend. */
    const timed = cal.status === 'ok' ? cal.events.filter((e) => e.day === day && e.start !== null) : []
    const at = (e: { start: number | null }) =>
      `${String(Math.floor((e.start as number) / 60)).padStart(2, '0')}:${String((e.start as number) % 60).padStart(2, '0')}`
    const meetings = timed.filter(isMeeting).map((e) => ({ at: at(e), title: e.title }))
    const blocks = timed.filter((e) => !isMeeting(e)).map((e) => ({ at: at(e), title: e.title }))
    return {
      now: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      weekday: dayLabel(),
      planned,
      backlogCount: backlog.length,
      backlog: backlog.slice(0, 25).map((t) => ({ title: dropUrl(t.title), space: label(t.space) })).filter((t) => t.title),
      oldest: [...backlog].sort((a, b) => age(b) - age(a)).slice(0, 3).map((t) => ({ title: dropUrl(t.title), days: age(t), space: label(t.space) })).filter((t) => t.title),
      habits: { due, kept, open: open.slice(0, 6) },
      meetings,
      blocks,
      focusToday: focusSessions.filter((f) => f.day === day).reduce((a, f) => a + f.minutes, 0),
      /* NOT `plannedOn === yesterday`. The rollover has already swept these
         into the backlog and cleared plannedOn by the time this runs, so that
         filter finds an empty set every single time and the leftovers never
         reach the model. daily.tsx carries the same warning, having been caught
         by it first. plan.returnedIds is where they went. */
      tomorrow: tasks
        .filter((t) => t.list === 'today' && t.plannedOn === tomorrowKey && !t.done)
        .slice(0, 12).map((t) => ({ title: dropUrl(t.title), space: label(t.space) })).filter((t) => t.title),
      tomorrowMeetings: (cal.status === 'ok'
        ? cal.events.filter((e) => e.day === tomorrowKey && e.start !== null && isMeeting(e))
        : []).map((e) => ({ at: at(e), title: e.title })),
      unfinishedYesterday: (plan.returnedOn === day
        ? tasks.filter((t) => new Set(plan.returnedIds ?? []).has(t.id) && !t.done && t.list !== 'today')
        : []
      ).slice(0, 12).map((t) => ({ title: dropUrl(t.title), space: label(t.space) })).filter((t) => t.title),
      /* By doneAt, not plannedOn: the rollover clears plannedOn off finished
         work on its way to the ledger (see roll.ts), so that field is already
         gone by the time this runs. doneAt is a real timestamp and survives.
         Titles pass through dropUrl and the blank-after-stripping filter, same
         as every other list here: a task named only a pasted link should not
         hand the model a bullet with nothing left to say. */
      completedYesterday: tasks
        .filter((t) => t.done && t.doneAt && localDateKey(new Date(t.doneAt)) === yesterdayKey)
        .slice(0, 12).map((t) => ({ title: dropUrl(t.title), space: label(t.space) })).filter((t) => t.title),
      weather: sky,
      goals: goals.filter((g) => !g.closed).slice(0, 4).map((g) => {
        const tf = (g.timeframe ?? 'quarter') as GoalTf
        const range = goalPeriodRange(tf, g.periodKey ?? goalPeriodKey(tf))
        const cur = goalCurrent(g, habits, habitLog, range, slips, focusSessions)
        return { name: g.name, pct: g.target > 0 ? Math.round((cur / g.target) * 100) : 0 }
      }),
    }
  }, [tasks, habits, habitLog, routines, focusSessions, goals, todayIndex, slips, cal, sky, plan])
}

/* ---- the cards ----
   Every one reads the store directly. None of them is handed anything by the
   model beyond its own name. Every row carries its workspace, always, because
   this page mixes all three on purpose. */

/* WHAT HAPPENED, in the app's words rather than the model's.

   `ok` is what actually changed. `no` is a change that could not be made, and
   it says why in the same breath, because "Added it" over a task that was never
   added is the failure this whole mechanism exists to prevent. */
export interface Done {
  ok: boolean
  text: string
  /** Set only for a 'done' action on a task with no actual time logged yet.
   *  The thread renders the same "how long did it take?" prompt the task list
   *  itself shows, rather than marking it done and moving on: he asked for
   *  this specifically because a task he finishes by telling the assistant
   *  was going in with no actual time recorded, and no page open to fix it. */
  needsActual?: { taskId: string; est: number }
}

/** Loose enough to find "the noon testing task" from "test testing website",
 *  strict enough to refuse when two rows could both be meant. Accents are
 *  folded because half his titles are Czech and he types them without. */
const fold = (t: string) =>
  t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

function pick<T extends { title: string }>(rows: T[], match: string): { row?: T; why?: string } {
  const m = fold(match)
  if (!m) return { why: 'nothing to look for' }
  const exact = rows.filter((r) => fold(r.title) === m)
  if (exact.length === 1) return { row: exact[0] }
  const has = rows.filter((r) => fold(r.title).includes(m))
  if (has.length === 1) return { row: has[0] }
  if (has.length > 1) return { why: `${has.length} of them match "${match}"` }
  /* Last resort: every word he used has to appear, in any order. This is what
     turns "noon testing task" into the row actually called "test testing
     website", and it is deliberately the LAST thing tried. */
  const words = m.split(' ').filter((w) => w.length > 2)
  const all = words.length ? rows.filter((r) => words.every((w) => fold(r.title).includes(w))) : []
  if (all.length === 1) return { row: all[0] }
  if (all.length > 1) return { why: `${all.length} of them match "${match}"` }
  return { why: `nothing here is called "${match}"` }
}

/* Rows land one after another instead of all at once, capped at ten so a long
   list never turns into a loading screen. 18ms apart is under the threshold
   where it reads as waiting; it reads as the list being dealt. */
const stagger = (i: number) => ({ animationDelay: `${Math.min(i, 10) * 18}ms` })

function Tick() {
  return (
    <Icon.Check size={12} strokeWidth={4} />
  )
}

/* Where the whole of a card lives, for when only the head of it is shown.
   Partial: the weather card has no page behind it and never truncates, so
   there is nowhere for it to send him and nothing to send him for. */
const MORE_IN: Partial<Record<CardKind, [PageId, string]>> = {
  today: ['today', 'Today'], backlog: ['plan', 'Plan'], habits: ['habits', 'Habits'],
  calendar: ['calendar', 'Calendar'], goals: ['goals', 'Goals'], focus: ['focus', 'Focus'],
  stale: ['plan', 'Plan'],
}

/** The canvas shows everything; a card inside the thread on a phone shows the
 *  head of it and says where the rest is. Forty habits in a chat bubble pushed
 *  the sentence that introduced them off the top of the screen. */
function More({ n, kind }: { n: number; kind: CardKind }) {
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
function glyphFor(code: number): (p: Icon.IconProps) => JSX.Element {
  if (code === 0) return Icon.Sun
  if (code <= 2) return Icon.CloudSun
  if (code === 3) return Icon.Cloud
  if (code <= 48) return Icon.Fog
  if (code <= 67) return Icon.Rain
  if (code <= 77) return Icon.Snow
  if (code <= 86) return Icon.Rain
  return Icon.Storm
}

function WeatherCard(): JSX.Element {
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

function CardBody({ kind, limit }: { kind: CardKind; limit?: number }) {
  const { tasks, habits, habitLog, focusSessions, goals, todayIndex, setPage, toggleTask, toggleHabitDay } = useStore()
  const { state: cal } = useCalendar()
  const day = localDateKey()

  if (kind === 'weather') return <WeatherCard />

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
  weather: 'Prague',
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

/* The assistant's mark: a blob that changes shape as it works.

   It replaced a hexagonal reticle, which replaced a blue sphere. His brief for
   this one: "it should be sort of expanding circle like a blob or something
   that has different shapes whenever it's being interacted with".

   NOT A MORPH BETWEEN TWO POSES. The outline is generated fresh every frame
   from a radius that varies around the circle, so it never returns to the same
   shape twice and never reads as a loop. Three ripples at 2, 3 and 5 lobes,
   turning at different rates and in different directions, are what stop it
   settling into a rhythm.

   The points are joined with a closed Catmull-Rom spline converted to cubic
   Béziers, which is what keeps it liquid: joining them with straight lines, or
   with arcs, gives a cog rather than a drop of water.

   `state` drives all of it, so the animation IS the status. Idle breathes.
   Thinking swells and churns, which is the one place motion stands for work
   rather than for a measurement. Listening and speaking take their amplitude
   from the real signal, so the blob answers his voice and then its own. */
export type MarkState = 'idle' | 'thinking' | 'listening' | 'speaking'

/* Base radius, how far the outline strays, and how fast it churns. Idle is
   almost still on purpose: a mark that writhes while nothing is happening is
   the same lie as a waveform with no sound behind it. */
const MOOD: Record<MarkState, { r: number; amp: number; speed: number }> = {
  idle: { r: 0.56, amp: 0.1, speed: 0.4 },
  thinking: { r: 0.6, amp: 0.22, speed: 1.8 },
  listening: { r: 0.58, amp: 0.09, speed: 0.7 },
  speaking: { r: 0.6, amp: 0.12, speed: 0.9 },
}

/* Not harmonics of each other, so the lobes never line up into a flower. */
const RIPPLE = [
  { lobes: 2, rate: 0.9, phase: 0 },
  { lobes: 3, rate: -0.61, phase: 2.1 },
  { lobes: 5, rate: 0.37, phase: 4.3 },
]

/** A closed outline through points at varying radius, as one smooth path.

    Catmull-Rom to cubic Bézier: each control point is pulled a sixth of the way
    along the line between its neighbours, which is the standard construction
    and the reason the curve passes exactly through every point while staying
    continuous at the joins. */
function blobPath(t: number, amp: number, radius: number, size: number): string {
  const c = size / 2
  const N = 12
  const pts: [number, number][] = []
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2
    let r = radius
    for (const w of RIPPLE) r += amp * Math.sin(w.lobes * a + t * w.rate + w.phase) / w.lobes
    /* r is a fraction of the RADIUS available, not of the whole box. Times the
       full size it came out larger than the box and the blob was clipped flat
       against all four edges. */
    pts.push([c + Math.cos(a) * r * c, c + Math.sin(a) * r * c])
  }
  const at = (i: number): [number, number] => pts[(i + N) % N]
  let d = `M${at(0)[0].toFixed(2)},${at(0)[1].toFixed(2)}`
  for (let i = 0; i < N; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2)
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${c1[0].toFixed(2)},${c1[1].toFixed(2)} ${c2[0].toFixed(2)},${c2[1].toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`
  }
  return `${d}Z`
}

export function Mark({ state = 'idle', size = 132 }: { state?: MarkState; size?: number }): JSX.Element {
  const [, bump] = useState(0)
  const t = useRef(0)
  const live = useRef(0)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined
    let raf = 0
    let last = performance.now()
    const tick = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const mood = MOOD[state]
      t.current += dt * mood.speed * 3
      /* Listening and speaking borrow the real level, so the blob swells with
         his voice and then with the answer. Idle and thinking have no signal to
         borrow and do not pretend to: their motion says "working", not "loud". */
      const signal = state === 'listening' ? voiceLevel() : state === 'speaking' ? speakingLevel() : 0
      live.current += (signal - live.current) * 0.15
      bump((n) => n + 1)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [state])

  const mood = MOOD[state]
  const amp = mood.amp + live.current * 0.16
  const radius = mood.r + live.current * 0.06
  return (
    <svg
      className={`as-mark is-${state}`}
      width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
    >
      {/* Three outlines at slightly different times, so the shape trails itself
          and reads as one soft body rather than a single hard edge. */}
      <path className="as-mark-far" d={blobPath(t.current - 0.55, amp * 1.12, radius * 1.04, size)} />
      <path className="as-mark-mid" d={blobPath(t.current - 0.25, amp, radius, size)} />
      <path className="as-mark-core" d={blobPath(t.current, amp * 0.82, radius * 0.9, size)} />
    </svg>
  )
}

/* The answer, drawn while it is being read.

   Voice mode had a waveform and Play did not, and Play is where he hears it
   most: he presses it on an answer and the only sign anything is happening was
   the word on the button changing to Pause. "There is no sound wave when the
   assistant is speaking" was about here.

   It runs its own frame loop rather than leaning on the speech module's
   subscribe, which only fires when the state changes and would leave the bars
   frozen through the whole answer. */
const MINI_BARS = 18

function MiniWave(): JSX.Element {
  const [, bump] = useState(0)
  const history = useRef<number[]>(Array.from({ length: MINI_BARS }, () => 0))
  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      const h = history.current
      h.push(speakingLevel())
      if (h.length > MINI_BARS) h.shift()
      bump((n) => n + 1)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  /* SVG, not styled spans. As spans this drew a flat dotted line: the computed
     height stayed at its floor while the inline style said ten pixels, because
     a height transition re-targeted every frame never advances. An SVG rect
     cannot be clamped by a flex row or held back by a transition, and the
     geometry is the value rather than a request to lay something out. */
  const W = MINI_BARS * 3 - 1
  return (
    <svg className="as-mini-wave" width={W} height="14" viewBox={`0 0 ${W} 14`} aria-hidden="true">
      {history.current.map((v, i) => {
        const h = 2 + Math.min(1, v) * 11
        return <rect key={i} x={i * 3} y={(14 - h) / 2} width="2" height={h} rx="1" />
      })}
    </svg>
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
      {st === 'playing' ? <MiniWave /> : null}
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

/** Runs what the model named, against the same store every page writes to, and
 *  reports what it actually did. Nothing here trusts a title: every match is
 *  resolved against his real rows first, and an unresolved one changes nothing.
 *
 *  It reads `tasks` through a ref rather than through the closure, because a
 *  reply naming three changes runs them back to back and each one has to see
 *  the row the last one just wrote. */
function useDoer() {
  const st = useStore()
  const { space, todayIndex } = st
  const live = useRef(st)
  live.current = st

  return (actions: Action[]): Done[] => {
    const out: Done[] = []
    for (const a of actions) {
      const s2 = live.current
      const day = localDateKey()
      if (a.kind === 'add') {
        const slot = a.list === 'backlog' ? undefined : a.slot
        const list = a.list ?? (a.slot ? 'today' : 'backlog')
        s2.addTask({
          title: a.title,
          source: 'mc',
          estimateMin: a.min ?? 15,
          estimated: a.min != null,
          space: a.space ?? space,
          list,
          category: 'admin',
          slot,
          plannedOn: list === 'today' ? day : undefined,
        })
        out.push({ ok: true, text: `Added to ${slot ? SLOTS.find((x) => x.id === slot)?.label.toLowerCase() : list === 'today' ? 'today' : 'the list'}: ${a.title}` })
        continue
      }
      if (a.kind === 'habit') {
        const rows = s2.habits.filter((h) => !h.archivedAt).map((h) => ({ ...h, title: h.name }))
        const { row, why } = pick(rows, a.match)
        if (!row) { out.push({ ok: false, text: why ?? 'no habit matched' }); continue }
        const already = row.days[todayIndex]
        if (already === a.on) { out.push({ ok: true, text: `${row.name} was already ${a.on ? 'kept' : 'open'} today` }); continue }
        s2.markHabitDay(row.id, todayIndex, a.on)
        out.push({ ok: true, text: a.on ? `Kept today: ${row.name}` : `Reopened today: ${row.name}` })
        continue
      }
      const { row, why } = pick(s2.tasks, a.match)
      if (!row) { out.push({ ok: false, text: why ?? 'no task matched' }); continue }
      switch (a.kind) {
        case 'done':
          if (row.done) { out.push({ ok: true, text: `${row.title} was already done` }); break }
          s2.toggleTask(row.id)
          out.push({
            ok: true,
            text: `Done: ${row.title}`,
            needsActual: row.actualMin == null ? { taskId: row.id, est: taskMinutes(row) } : undefined,
          })
          break
        case 'undone':
          if (!row.done) { out.push({ ok: true, text: `${row.title} was already open` }); break }
          s2.toggleTask(row.id)
          out.push({ ok: true, text: `Reopened: ${row.title}` })
          break
        case 'move':
          if (a.list && a.list !== row.list) s2.moveTaskList(row.id, a.list, day)
          if (a.slot) {
            if (row.list !== 'today' && !a.list) s2.moveTaskList(row.id, 'today', day)
            s2.assignSlot(row.id, a.slot)
          }
          out.push({
            ok: true,
            text: a.slot
              ? `Moved to ${SLOTS.find((x) => x.id === a.slot)?.label.toLowerCase()}: ${row.title}`
              : `Moved to ${a.list === 'today' ? 'today' : 'the list'}: ${row.title}`,
          })
          break
        case 'estimate':
          s2.setEstimate(row.id, a.min)
          out.push({ ok: true, text: `${fmtDuration(a.min)} on ${row.title}` })
          break
        case 'drop':
          s2.deleteTask(row.id)
          out.push({ ok: true, text: `Deleted: ${row.title}` })
          break
        default: break
      }
    }
    return out
  }
}

/* Dictation, beside Ask. One button, three states, no settings.

   It is hidden rather than disabled where no engine exists, because a mic that
   cannot ever listen is furniture, and a disabled control invites a click that
   teaches nothing. */
function Dictate({ base, onText, busy }: { base: string; onText: (t: string) => void; busy: boolean }): JSX.Element | null {
  const [, bump] = useState(0)
  useEffect(() => subscribeDictation(() => bump((n) => n + 1)), [])
  useEffect(() => cancelDictation, [])
  if (!dictationAvailable()) return null
  const st = dictateState()
  const label = st === 'listening' ? 'Stop' : st === 'transcribing' ? 'Writing it down' : 'Dictate'
  const how = dictationEngine() === 'browser'
    ? 'Speak and the words appear as you go.'
    : 'Speak, then stop, and Whisper writes it down.'
  return (
    <button
      type="button"
      className={`as-mic is-${st}`}
      onClick={() => toggleDictation(base, onText)}
      disabled={busy || st === 'transcribing'}
      aria-label={label}
      aria-pressed={st === 'listening'}
      title={st === 'idle' ? how : label}
    >
      <Icon.Mic size={15} />
      <span className="as-mic-text">{label}</span>
    </button>
  )
}

/* Voice mode, in the place the ask box was.

   Not a takeover screen. The thread behind it does not move and every question
   and answer lands in it as an ordinary turn, so what he said is still there to
   read afterwards. Only the box changes shape.

   The bars are a real reading. `voiceLevel()` is the RMS of the microphone
   right now, kept as a short history so the wave travels left as he talks. When
   the microphone is shut, during thinking and speaking, the bars go flat and
   dim, because inventing motion there would be drawing a signal that does not
   exist. */

/* Three layers, deliberately not harmonics of each other: 1.6, 2.7 and 4.3 do
   not divide evenly, so the curves drift out of step and the shape never
   visibly repeats. Two of them run backwards, which is what stops it reading
   as one wave with copies behind it. */
const RIBBONS = [
  { freq: 1.6, speed: 1, offset: 0, scale: 1, opacity: 1 },
  { freq: 2.7, speed: -0.62, offset: 1.7, scale: 0.68, opacity: 0.5 },
  { freq: 4.3, speed: 0.41, offset: 3.4, scale: 0.4, opacity: 0.28 },
]

/* One curve across the box. The envelope tapers it to nothing at both ends, so
   it reads as a ribbon of light rather than a signal cut off by the edges,
   which is the difference between the reference and a line chart. */
function ribbon(amp: number, phase: number, freq: number): string {
  const pts: string[] = []
  for (let i = 0; i <= 40; i++) {
    const t = i / 40
    const env = Math.sin(Math.PI * t) ** 1.5
    const y = 24 + Math.sin(t * freq * Math.PI * 2 + phase) * amp * env
    pts.push(`${(t * 300).toFixed(1)},${y.toFixed(2)}`)
  }
  return `M${pts.join(' L')}`
}


function VoicePanel({ onExit }: { onExit: () => void }): JSX.Element {
  const [, bump] = useState(0)
  /* Smoothed, because a meter that jumps frame to frame reads as noise rather
     than as a voice. It rises fast and falls slowly, which is the shape speech
     actually has: a syllable arrives at once and decays. */
  const amp = useRef(0)
  const drift = useRef(0)
  /* Held in a ref so the subscription is made once. Re-subscribing on every
     frame of the waveform would be a new listener sixty times a second. */
  const exitRef = useRef(onExit)
  exitRef.current = onExit
  /* Once, and only once. onExit calls exit() again, exit() emits, and this
     subscriber runs from inside that emit: without the latch it called itself
     until the stack gave out, and the setVoice(false) that removes this panel
     sat AFTER the exit() call and so never ran. The panel stayed on screen with
     a dead microphone behind it. */
  const hungUp = useRef(false)
  useEffect(() => subscribeVoice(() => {
    const want = voiceLevel() * 18
    amp.current += (want - amp.current) * (want > amp.current ? 0.35 : 0.08)
    /* The phase only moves while there is something to show, so silence is
       still rather than a ribbon idling along on its own. */
    if (amp.current > 0.3) drift.current += 0.09
    /* IT CAN HANG UP BY ITSELF, after six seconds with nothing said. The module
       knows it has stopped; React does not, and without this the panel stayed
       on screen with a dead microphone behind it, looking like it was still
       listening. */
    if (voicePhase() === 'off' && !hungUp.current) { hungUp.current = true; exitRef.current() }
    bump((n) => n + 1)
  }), [])

  const phase = voicePhase()
  const heard = voiceHeard()
  /* The bars are live while it listens AND while it talks: one is his voice,
     the other is the answer. Only the wait in between is still. */
  const live = phase === 'listening' || phase === 'speaking'
  /* When it is talking and nothing can be measured, the bars are flat and the
     label says why. A still meter that looks like a fault, with no explanation,
     is how a generated wave got written in the first place. */
  const mute = phase === 'speaking' && !speakingMeasured()
  const said = phase === 'thinking' ? 'Thinking'
    : phase === 'speaking' ? (mute ? 'Reading it out, no level from this voice' : 'Reading it out')
      : 'Listening'

  return (
    <div className={`as-voice is-${phase}`}>
      <div className="as-voice-head">
        <span className="as-voice-state">{said}</span>
        <button type="button" className="as-voice-exit" onClick={onExit}>Done</button>
      </div>
      {/* FLUID, NOT AN EQUALISER. He showed me the reference: a light ribbon
          that moves as one thing, the way Siri does, rather than a row of
          separate bars. Three curves at different frequencies and phases,
          drifting past each other, so the shape never quite repeats.

          Drawn as SVG because as styled divs the bars rendered at their floor
          no matter what their height said: a percentage height carrying a
          transition that is re-targeted every frame never resolves. A path's
          geometry IS the value.

          THE AMPLITUDE IS THE REAL SIGNAL AND NOTHING ELSE. When there is
          nothing to measure the curves settle into a straight line, which is
          the honest picture of silence. Nothing here generates a shape.

          aria-hidden: the bars are the state made visible, and the state is
          already announced in words beside them. */}
      <svg
        className="as-wave" viewBox="0 0 300 48" preserveAspectRatio="none"
        aria-hidden="true"
      >
        {RIBBONS.map((r, i) => (
          <path
            key={i}
            d={ribbon(amp.current * r.scale, drift.current * r.speed + r.offset, r.freq)}
            opacity={r.opacity}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <p className="as-voice-heard" aria-live="polite">
        {heard || (live ? 'Say something.' : '\u00a0')}
      </p>
    </div>
  )
}

interface Turn { who: 'you' | 'it'; text: string; reply?: Reply; done?: Done[] }

export function AssistantPage() {
  const brief = useBrief()
  const split = useSplit()
  const run = useDoer()
  const { logActual } = useStore()
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
  const box = useRef<HTMLTextAreaElement>(null)

  /* Returns the answer's words. The button ignores them and voice mode reads
     them out; an empty string means there was nothing to say. */
  /* `shown` is what goes in the thread when it differs from what is asked. The
     morning brief is a skill: he pressed a button, so the thread should say
     "Morning brief", not recite the paragraph the button sends on his behalf.
     Seeing the engineering is seeing the wiring. */
  const send = async (text: string, shown?: string): Promise<string> => {
    if (busy) return ''
    setBusy(true); setErr(null); setErrHint(null); setLive('')
    setTurns((t) => [...t, { who: 'you', text: shown ?? text }])
    const history = turns.map((t) => ({ role: (t.who === 'you' ? 'user' : 'assistant') as 'user' | 'assistant', content: t.text }))
    let out = await ask(text, brief, history, setLive)
    /* A RATE LIMIT WAITS RATHER THAN FAILS, on his instruction: he would rather
       stare at the thinking mark for twenty seconds than read an error and
       have to press Ask again himself. `ask()` already tried Gemini once
       before ever returning this reason, so a retry here is a second full
       pass at both providers, not a hammer on the same closed door. Capped at
       two so a key that is genuinely dead, not just busy, still surfaces the
       real message instead of a mark that spins forever. Groq's own wait time
       is used when it parsed one; twenty seconds otherwise, matched to what he
       said he can live with. `live` stays empty through the wait so the plain
       thinking mark shows, not a caret with nothing after it. */
    for (let tries = 0; !out.ok && out.reason === 'rate-limit' && tries < 2; tries++) {
      const waitS = out.detail ? Math.max(1, Number(out.detail)) : 20
      setLive('')
      await new Promise((r) => setTimeout(r, waitS * 1000))
      out = await ask(text, brief, history, setLive)
    }
    if (out.ok) {
      /* Performed BEFORE the turn is drawn, so the line under the sentence is
         the outcome and not a prediction of it. */
      const done = out.reply.do?.length ? run(out.reply.do) : undefined
      setTurns((t) => [...t, { who: 'it', text: out.reply.say, reply: out.reply, done }])
      let kinds = out.reply.show.map((c: Card) => c.kind)
      /* The brief ALWAYS draws the sky, whether or not the model remembered to
         name it. He asked for the weather to be visible, and that is not a
         thing to leave to whether a sentence came back with the right card in
         it. The app owns this card's numbers anyway. */
      if (text === MORNING.ask && !kinds.includes('weather')) kinds = ['weather', ...kinds]
      if (kinds.length) setCanvas(kinds.slice(0, 3))
      /* A change he cannot see is a change he will not believe. Anything that
         touched the day puts the day on the canvas unless it named its own. */
      else if (done?.some((d) => d.ok)) setCanvas(out.reply.do?.some((a) => a.kind === 'habit') ? ['habits'] : ['today'])
    } else {
      /* A 429 used to fall through to `out.detail`, which for a rate limit is
         Groq's raw body: an org id, a token count, a billing upsell link, all
         ending in "Ask again" on a request that was never unreadable. Two
         questions back to back after a card just wrote something is ordinary
         traffic, not a fault, and reads that way now. */
      setErr(
        out.reason === 'no-key' ? 'No Groq key yet.'
          : out.reason === 'rejected' ? 'That Groq key was rejected.'
            : out.reason === 'offline' ? 'Could not reach the model.'
              : out.reason === 'rate-limit' ? 'Too many questions in the last minute.'
                : out.detail ?? 'The answer came back unreadable.',
      )
      setErrHint(
        out.reason === 'no-key' ? 'Add one in Settings. It is free and it stays on this device.'
          : out.reason === 'rejected' ? 'Check it in Settings, or generate a new one at console.groq.com.'
            : out.reason === 'model-gone' ? 'The model this app used was retired. This build already moved to its replacement, so reload the page.'
              : out.reason === 'offline' ? 'Check the connection and ask again.'
                : out.reason === 'rate-limit' ? (out.detail ? `Wait about ${out.detail}s and ask again.` : 'Wait a few seconds and ask again.')
                  : 'Ask again, or rephrase it.',
      )
    }
    setBusy(false); setLive('')
    box.current?.focus()
    return out.ok ? out.reply.say : ''
  }

  /* Answers the "how long did it take?" prompt under a 'done' line. "Skip"
   *  here is HIS word for it, from asking for this feature: it means the same
   *  time as the estimate, not the task-list page's own "skip", which leaves
   *  no time logged at all and asks again later. Two different buttons in two
   *  different places are allowed to mean two different things; this one
   *  means what he asked it to mean. */
  const logTaskActual = (turnIndex: number, doneIndex: number, taskId: string, minutes: number) => {
    logActual(taskId, minutes)
    setTurns((prev) => prev.map((t, ti) => (ti !== turnIndex
      ? t
      : { ...t, done: t.done?.map((d, di) => (di !== doneIndex ? d : { ...d, text: `${d.text} — ${fmtDuration(minutes)}`, needsActual: undefined })) }
    )))
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
  /* cancel, not stop: the question has been asked, so the tail of it is not
     wanted back in the box that is about to be cleared. */
  const submit = () => { const t = q.trim(); if (t) { cancelDictation(); setQ(''); void send(t) } }

  const [voice, setVoice] = useState(false)
  /* Voice mode drives the SAME send as the button, so a spoken question is an
     ordinary turn in the thread and the answer it reads out is the answer he
     can also see. */
  const startVoice = async (opening?: string, openingLabel?: string) => {
    cancelDictation()
    setQ('')
    setVoice(true)
    const ok = await enterVoice(
      (text) => send(text, text === opening ? openingLabel : undefined),
      opening,
    )
    if (!ok) setVoice(false)
  }
  /* One path for every skill on this page, including the brief. It opens voice
     mode when the browser can do it, because these are things he asks on the
     way somewhere, and falls back to a typed send when it cannot. Either way
     the thread shows the skill's NAME, never the paragraph behind it. */
  const runSkill = async (k: { label: string; ask: string }) => {
    if (voiceModeAvailable()) { await startVoice(k.ask, k.label); return }
    cancelDictation(); setQ('')
    await send(k.ask, k.label)
  }

  const endVoice = () => { exitVoice(); setVoice(false); box.current?.focus() }
  /* Leaving the page hangs up. A microphone left open on a page he has walked
     away from is the worst bug this feature could have. */
  useEffect(() => exitVoice, [])

  const askBox = voice ? <VoicePanel onExit={endVoice} /> : (
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
        {voiceModeAvailable() ? (
          <button
            type="button" className="as-voice-btn" onClick={() => void startVoice()} disabled={busy}
            title="Talk to it, and it talks back. It keeps listening until you are done."
          >
            <Icon.Waveform size={15} />
            <span className="as-mic-text">Voice</span>
          </button>
        ) : null}
        <Dictate base={q} onText={setQ} busy={busy} />
        <button className="btn btn-primary as-send" disabled={busy || !q.trim()}>Ask</button>
      </div>
    </form>
  )

  return (
    <div className={`page as-page${empty ? ' is-empty' : ' is-split'}`}>
      {/* Before he has asked anything the page is a doorway, not a workspace:
          one mark, one question, one box. The split arrives with the answer. */}
      {empty && (
        <div className="as-open">
          <div className="as-hero">
            <Mark state={voice ? 'listening' : 'idle'} />
            <h1 className="as-hero-q">What can I help with?</h1>

          </div>
          {/* Six things he does rather than types, in one row, one design.
              The chip row that used to sit below the ask box is gone: this was
              two different weights for buttons that all do the same kind of
              thing, one filled and central, five outlined and stranded under
              the box. Not gated on voiceModeAvailable() the way the single
              button used to be, because runSkill() already falls back to a
              typed send where voice mode does not exist, and a browser
              without SpeechRecognition should not lose every one-tap skill on
              the doorway, only the live listening. Not attach, search, reason,
              create an image. Those are a general chatbot's furniture and none
              of them is a thing this app does. These are questions about his
              own week, each answerable from his own log. */}
          <div className="as-skills">
            <button className="as-brief" onClick={() => void runSkill(MORNING)}>
              <Icon.Waveform size={18} />
              {MORNING.label}
            </button>
            {SKILLS.map((k) => (
              <button className="as-brief" key={k.label} onClick={() => void runSkill(k)}>
                <Icon.Waveform size={18} />
                {k.label}
              </button>
            ))}
          </div>
          {askBox}
        </div>
      )}

      {!empty && (
        <>
          <div className="as-chat">
            <div className="as-thread">
              {turns.map((t, i) => (
                <div className={`as-turn is-${t.who}`} key={i}>
                  <p className="as-said">{t.text}</p>
                  {/* The app's own account of what changed, not the model's.
                      It sits under the sentence because the sentence is an
                      intention and this is the fact. */}
                  {t.done?.length ? (
                    <ul className="as-did">
                      {t.done.map((d, k) => (
                        <li className={d.ok ? 'is-ok' : 'is-no'} key={k}>
                          {d.ok ? null : <span className="as-did-head">Nothing changed, </span>}
                          {d.text}
                          {d.needsActual ? (
                            <ActualLog
                              est={d.needsActual.est}
                              onLog={(m) => logTaskActual(i, k, d.needsActual!.taskId, m)}
                              onSkip={() => logTaskActual(i, k, d.needsActual!.taskId, d.needsActual!.est)}
                            />
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
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
                        {/* ONE indicator, not two. A 22px mark beside three dots
                            was two things saying "working" and neither saying it
                            well: at that size the blob read as a speck while the
                            dots did the actual work. The blob is the whole
                            indicator now, at a size where its churn is legible. */}
                        <Mark state="thinking" size={34} />
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
