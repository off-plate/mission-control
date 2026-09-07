import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './store'
import { isMeeting, useCalendar } from './calendar'
import { SPACE_LABELS } from './mock'
import { MORNING, ask, type Action, type Brief, type Card, type CardKind, type Reply } from './assistant'
import { getAiProvider, PROVIDERS } from './ai'
import { engineName, speakingLevel, speechState, subscribe, toggle } from './speech'
import { voiceLevel } from './voicemode'
import { getWeather, weatherLine } from './weather'
import { SLOTS, dueOn, habitsDueToday, goalCurrent, habitStepKey, routineComplete, requiredSteps, type HabitDef, type SpaceId, type Task } from './types'
import { localDateKey, fmtDuration, taskMinutes, goalPeriodKey, goalPeriodRange, periodKeyFor, type GoalTf } from './util'
import * as Icon from './icons'

/* THE ASSISTANT'S CORE, shared by the full page (assistantpage.tsx, lazy-
   loaded) and the dock's compact widget (assistantdock.tsx, loaded on every
   page since the dock itself is). Split out (2026-09-08) after the first
   version of the dock panel silently pulled the ENTIRE assistant page --
   canvas cards, voice mode, dictation, all of it -- into the app's eager
   main bundle: dock.tsx has no lazy boundary of its own, so a static import
   of anything in assistantpage.tsx dragged that whole lazy chunk in with it
   (confirmed in the build output, and by the chunk that used to be its own
   ~54KB file disappearing into index.js once assistantdock.tsx imported
   from it directly). Everything actually needed for a real conversation --
   the brief, the doer, the mark, the play button, useAssistantThread itself
   -- lives here instead, with no page-only code (CardBody, the canvas,
   VoicePanel, Dictate) anywhere in this file. assistantpage.tsx imports
   this module too, so there is exactly one copy of each, never a fork. */

const dayLabel = () => new Date().toLocaleDateString('en-GB', { weekday: 'long' })
/** Which workspace a thing came from, in words the model can repeat back. */
const label = (s?: SpaceId) => (s ? SPACE_LABELS[s] : 'Unfiled')
/** A URL pasted straight into a task title reads fine as a link on his own
 *  list, and reads as noise once a sentence has to carry it -- on screen as a
 *  wall of characters, out loud as a wall of syllables. Stripped here rather
 *  than asked of the model, so a title with a link in it cannot come back
 *  verbatim no matter how the model chooses to write the sentence around it. */
const dropUrl = (title: string) => title.replace(/https?:\/\/\S+/gi, '').replace(/\s{2,}/g, ' ').trim()

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
    /* A routine's own auto-ticking habit was landing in this list by name
       (2026-09-07 report: "Morning Preparation" and "Invoicing routine"
       showing up as habits to keep) even though habitsDueToday above already
       excludes it from the due/kept COUNT for the same reason -- it belongs
       to the routine's own streak, not a row of its own. Same exclusion,
       applied to the names too, so the count and the list agree. */
    /* srcStepId catches the much larger set routineHabitIds alone missed: a
       habit auto-materialized FROM one routine step (its typing test, its
       "clean the desk", forty-odd of them in a real routine set) rather than
       the routine's own single streak. Both are "run the routine", not "tick
       a habit", so both are excluded the same way. */
    const routineHabitIds = new Set(routines.filter((r) => !r.archivedAt && r.habitId).map((r) => r.habitId as string))
    const isRoutineLinked = (h: HabitDef) => routineHabitIds.has(h.id) || habitStepKey(h) !== null
    const open = visible.filter((h) => dueOn(h, todayIndex, habitLog) && !h.days[todayIndex] && !h.folderId && !isRoutineLinked(h)).map((h) => h.name)

    /* Routines, as their own thing the assistant can name and point him at --
       never as a "habit" to offer to tick, which was the whole complaint.
       Same due/kept/open shape as habits on purpose, so the model reads them
       the same way and briefText needs no new format. A routine with no
       required steps yet cannot be "run", so it never counts as due. */
    const activeRoutines = routines.filter((r) => !r.archivedAt && requiredSteps(r).length > 0)
    const routineOpen = activeRoutines.filter((r) => !routineComplete(r, periodKeyFor(r.cadence)))
    const routinesBrief = { due: activeRoutines.length, kept: activeRoutines.length - routineOpen.length, open: routineOpen.slice(0, 6).map((r) => r.title) }
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
      routines: routinesBrief,
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
export function Speak({ id, text }: { id: string; text: string }): JSX.Element {
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
    /* live.current is the store as of the last RENDER, not as of the last
       loop iteration -- addTask's own update lands on the next render, which
       has not happened yet while this synchronous loop is still running. Two
       "add" actions for the same title in the one response (his report,
       2026-09-08: the model itself answering both attempts of a 400-then-
       retry turn) both saw the store BEFORE either add, and the check below
       against s2.tasks alone would miss a duplicate created earlier in this
       exact call. Titles added so far in THIS run close the gap. */
    const addedThisRun = new Set<string>()
    for (const a of actions) {
      const s2 = live.current
      const day = localDateKey()
      if (a.kind === 'add') {
        const slot = a.list === 'backlog' ? undefined : a.slot
        const list = a.list ?? (a.slot ? 'today' : 'backlog')
        /* No guard here duplicated the row the moment "add" ran twice for the
           same title (his report, 2026-09-08) -- and it now can, the same way
           a rate-limited or 400-then-retried turn already runs the WHOLE
           request twice: a model that answers on both attempts, or a
           question asked again before the first answer was back, means two
           real "do" arrays, not one. Every other action here is written to be
           safe run twice ("habit" above answers "already kept" rather than
           toggling itself back off); "add" is the one place creating the
           second row was silent. An exact, still-open title is treated as the
           same request repeated, not two things he actually wants. */
        const key = a.title.trim().toLowerCase()
        const dupe = addedThisRun.has(key) || s2.tasks.some((t) => !t.done && t.title.trim().toLowerCase() === key)
        if (dupe) { out.push({ ok: true, text: `Already on the list: ${a.title}` }); continue }
        addedThisRun.add(key)
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

export interface Turn { who: 'you' | 'it'; text: string; reply?: Reply; done?: Done[] }

/* Everything ONE conversation actually is: the turns, what the canvas is
   showing, the in-flight/error state, and the one function that drives all
   of it. Pulled out of AssistantPage untouched (2026-09-08) so the dock's
   own compact panel (assistantdock.tsx) can carry a real conversation --
   the rate-limit retry, the provider-named errors, the canvas card
   selection, all of it -- rather than a second, thinner copy of "ask a
   question" built next to this one. Every caller gets its OWN turns: this
   is not a shared store, so the dock's quick exchange and the full page's
   are two different threads, the same way leaving the full page today
   already forgets what was asked on it -- nothing here removes a
   continuity that existed before it. */
export function useAssistantThread() {
  const brief = useBrief()
  const run = useDoer()
  const [turns, setTurns] = useState<Turn[]>([])
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
      /* Named for whichever provider is actually active (Settings' toggle),
         not hardcoded to Groq -- a Z.ai key rejected read as "That Groq key
         was rejected", which sends him to fix the wrong field. */
      const provider = PROVIDERS[getAiProvider()]
      setErr(
        out.reason === 'no-key' ? `No ${provider.label} key yet.`
          : out.reason === 'rejected' ? `That ${provider.label} key was rejected.`
            : out.reason === 'offline' ? 'Could not reach the model.'
              : out.reason === 'rate-limit' ? 'Too many questions in the last minute.'
                : out.detail ?? 'The answer came back unreadable.',
      )
      setErrHint(
        out.reason === 'no-key' ? 'Add one in Settings. It stays on this device.'
          : out.reason === 'rejected' ? `Check it in Settings, or generate a new one at ${provider.getKeyUrl}.`
            : out.reason === 'model-gone' ? 'The model this app used was retired. This build already moved to its replacement, so reload the page.'
              : out.reason === 'offline' ? 'Check the connection and ask again.'
                : out.reason === 'rate-limit' ? (out.detail ? `Wait about ${out.detail}s and ask again.` : 'Wait a few seconds and ask again.')
                  : 'Ask again, or rephrase it.',
      )
    }
    setBusy(false); setLive('')
    return out.ok ? out.reply.say : ''
  }

  return { brief, turns, setTurns, busy, err, errHint, canvas, setCanvas, live, send }
}
