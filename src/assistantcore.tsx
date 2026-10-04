import { Orb, OrbChip, type OrbState } from './orb'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './store'
import { isMeeting, useCalendar } from './calendar'
import { SPACE_LABELS } from './mock'
import { MORNING, ask, parseBulkPlan, type Action, type Brief, type CardKind, type Find, type Reply } from './assistant'
import { breakdownTask, getAiProvider, PROVIDERS } from './ai'
import { engineName, speakingLevel, speakingMeasured, speechState, stop as stopSpeaking, subscribe, toggle } from './speech'
import {
  enter as enterVoice, exit as exitVoice, subscribe as subscribeVoice,
  voiceHeard, voiceLevel, voiceModeAvailable, voicePhase,
} from './voicemode'
import { getWeather, weatherLine } from './weather'
import { useAssistantBills } from './assistantbills'
import { hasHevyKey, syncHevy } from './hevy'
import { usePomodoro } from './pomodoro'
import {
  SLOTS, dueOn, habitsDueToday, goalCurrent, habitStepKey, routineComplete, requiredSteps,
  daysClean, spaceFolderId,
  type GoalTimeframe, type HabitDef, type HabitFrequency, type Note, type PageId, type RoutineCadence, type SpaceId, type Task,
} from './types'
import { localDateKey, fmtDuration, taskMinutes, goalPeriodKey, goalPeriodRange, periodKeyFor, type GoalTf } from './util'
import { nextPersonSlot, TIER_CADENCE, TIER_LABEL } from './peoplelayout'
import { useFirstMove } from './ui'
import { APPS } from './apps'
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
   Dictate) anywhere in this file. assistantpage.tsx imports this module too,
   so there is exactly one copy of each, never a fork.

   VoicePanel and its startVoice/runSkill/endVoice glue (useVoiceGlue, at the
   bottom) joined this file the same day, on his second ask: the dock's quick
   panel is "primarily voice", not text-first with voice as an afterthought,
   so voice mode has to be as eager as everything else here -- a real,
   deliberate cost this time, not the accident the first pass over this file
   was written to undo. Dictation stayed behind in assistantpage.tsx: nothing
   in his ask mentioned typed dictation for the quick panel, only voice. */

const dayLabel = () => new Date().toLocaleDateString('en-GB', { weekday: 'long' })
/** Which workspace a thing came from, in words the model can repeat back. */
/** Where a task lives, for the briefing: its project's name when it has one
 *  (Off-Plate and Michael's Corner are projects now), otherwise its workspace. */
const labelOf = (t: { space?: SpaceId; projectId?: string }, projects: { id: string; name: string }[]) =>
  projects.find((p) => p.id === t.projectId)?.name ?? (t.space ? SPACE_LABELS[t.space] : 'Unfiled')
/** A URL pasted straight into a task title reads fine as a link on his own
 *  list, and reads as noise once a sentence has to carry it -- on screen as a
 *  wall of characters, out loud as a wall of syllables. Stripped here rather
 *  than asked of the model, so a title with a link in it cannot come back
 *  verbatim no matter how the model chooses to write the sentence around it. */
const dropUrl = (title: string) => title.replace(/https?:\/\/\S+/gi, '').replace(/\s{2,}/g, ' ').trim()

function useBrief(): Brief {
  const { tasks, projects, habits, habitLog, routines, focusSessions, goals, todayIndex, slips, plan } = useStore()
  const { state: cal } = useCalendar()
  /* Fetched once when the page opens. It is a garnish on the brief, so it never
     blocks anything and a failure just means no weather line. */
  const [sky, setSky] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void getWeather().then((w) => { if (live && w) setSky(weatherLine(w)) })
    return () => { live = false }
  }, [])
  /* Real Bills data, the same account/cycle read the Bills page itself does
     (2026-09-08 report: the assistant had nothing to say when asked whether
     a bill was paid). Also a garnish, same treatment as weather: null when
     signed out or not yet loaded, never something this briefing waits on. */
  const { brief: billsBrief } = useAssistantBills()
  /* "What am I having next" -- the exact same derivation Today and the Zone
     already point at (useFirstMove, ui.tsx), so the model's answer can
     never disagree with the one thing the app itself would put in front of
     him next. */
  const firstMove = useFirstMove()
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
      items: onDay.filter((t) => t.slot === s.id).map((t) => ({ title: dropUrl(t.title) || t.title, done: !!t.done, min: t.estimateMin ?? 0, space: labelOf(t, projects) })),
    }))
    const unsorted = onDay.filter((t) => !t.slot)
    if (unsorted.length) planned.unshift({ slot: 'Unsorted', items: unsorted.map((t) => ({ title: dropUrl(t.title) || t.title, done: !!t.done, min: t.estimateMin ?? 0, space: labelOf(t, projects) })) })
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
    /* His report, 2026-09-08: a real, existing habit (a weekly one, not due
       on that specific day) came back "I can't find a habit called X"
       because "open" above is deliberately today-only. Break-kind (quitting)
       excluded -- those already have their own list below and their own
       action ("slip"), never "habit". */
    const allHabits = visible.filter((h) => h.kind !== 'break' && !isRoutineLinked(h)).map((h) => h.name)

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
      backlog: backlog.slice(0, 25).map((t) => ({ title: dropUrl(t.title), space: labelOf(t, projects) })).filter((t) => t.title),
      oldest: [...backlog].sort((a, b) => age(b) - age(a)).slice(0, 3).map((t) => ({ title: dropUrl(t.title), days: age(t), space: labelOf(t, projects) })).filter((t) => t.title),
      habits: { due, kept, open: open.slice(0, 6) },
      allHabits: allHabits.slice(0, 40),
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
        .slice(0, 12).map((t) => ({ title: dropUrl(t.title), space: labelOf(t, projects) })).filter((t) => t.title),
      tomorrowMeetings: (cal.status === 'ok'
        ? cal.events.filter((e) => e.day === tomorrowKey && e.start !== null && isMeeting(e))
        : []).map((e) => ({ at: at(e), title: e.title })),
      unfinishedYesterday: (plan.returnedOn === day
        ? tasks.filter((t) => new Set(plan.returnedIds ?? []).has(t.id) && !t.done && t.list !== 'today')
        : []
      ).slice(0, 12).map((t) => ({ title: dropUrl(t.title), space: labelOf(t, projects) })).filter((t) => t.title),
      /* By doneAt, not plannedOn: the rollover clears plannedOn off finished
         work on its way to the ledger (see roll.ts), so that field is already
         gone by the time this runs. doneAt is a real timestamp and survives.
         Titles pass through dropUrl and the blank-after-stripping filter, same
         as every other list here: a task named only a pasted link should not
         hand the model a bullet with nothing left to say. */
      completedYesterday: tasks
        .filter((t) => t.done && t.doneAt && localDateKey(new Date(t.doneAt)) === yesterdayKey)
        .slice(0, 12).map((t) => ({ title: dropUrl(t.title), space: labelOf(t, projects) })).filter((t) => t.title),
      weather: sky,
      goals: goals.filter((g) => !g.closed).slice(0, 4).map((g) => {
        const tf = (g.timeframe ?? 'quarter') as GoalTf
        const range = goalPeriodRange(tf, g.periodKey ?? goalPeriodKey(tf))
        const cur = goalCurrent(g, habits, habitLog, range, slips, focusSessions)
        return { name: g.name, pct: g.target > 0 ? Math.round((cur / g.target) * 100) : 0 }
      }),
      bills: billsBrief,
      quitting: habits
        .filter((h) => h.kind === 'break' && !h.archivedAt)
        .map((h) => ({ name: h.name, days: daysClean(h, slips) ?? 0 })),
      nextTask: firstMove ? dropUrl(firstMove.title) || firstMove.title : null,
    }
  }, [tasks, habits, habitLog, routines, focusSessions, goals, todayIndex, slips, cal, sky, plan, billsBrief, firstMove, projects])
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
  /** Set on the actions common enough, and safe enough, to take straight back:
   *  a real add, move, estimate or done/undone. His report (2026-09-10): a
   *  bulk paste that under-did itself with no way to see what actually landed
   *  or send it back. Not every kind gets one -- a logged slip or a
   *  posted expense has no clean inverse, and this is a real per-row undo, not
   *  a promise the app cannot keep, so those lines simply carry none. Only
   *  the full assistant page renders a button for this; the dock popup shows
   *  the same line with no way to act on it, on purpose (his instruction). */
  undo?: () => void
  /** Set once undo has actually been used on this line, so a second render
   *  shows what happened rather than offering the same button again. Page
   *  state, not something the doer above ever sets itself. */
  undone?: boolean
  /** Where it landed: the card that holds it and the row's id (or name), so
   *  the canvas can open there and mark it (2026-10-04, his ask: the right
   *  side shows where every change went). A task's card is worked out after
   *  the write, from where the row actually ended up. */
  at?: { card?: CardKind; key?: string }
}

/** Loose enough to find "the noon testing task" from "test testing website",
 *  strict enough to refuse when two rows could both be meant. Accents are
 *  folded because half his titles are Czech and he types them without. */
const fold = (t: string) =>
  t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

/** The one tier of rows pick()/pickAll() actually decide on -- exact title,
 *  else substring, else every word present in any order, whichever of the
 *  three is the first to turn up anything at all. Split out from pick()
 *  itself (2026-09-08) so pickAll() can share the exact same tiering
 *  without a second, drifting copy of it. */
function candidates<T extends { title: string }>(rows: T[], match: string): T[] {
  const m = fold(match)
  if (!m) return []
  const exact = rows.filter((r) => fold(r.title) === m)
  if (exact.length === 1) return exact
  const has = rows.filter((r) => fold(r.title).includes(m))
  if (has.length >= 1) return has
  /* Last resort: every word he used has to appear, in any order. This is what
     turns "noon testing task" into the row actually called "test testing
     website", and it is deliberately the LAST thing tried. */
  const words = m.split(' ').filter((w) => w.length > 2)
  return words.length ? rows.filter((r) => words.every((w) => fold(r.title).includes(w))) : []
}

function pick<T extends { title: string }>(rows: T[], match: string): { row?: T; why?: string } {
  if (!fold(match)) return { why: 'nothing to look for' }
  const found = candidates(rows, match)
  if (found.length === 1) return { row: found[0] }
  if (found.length > 1) return { why: `${found.length} of them match "${match}"` }
  return { why: `nothing here is called "${match}"` }
}

/** pick()'s counterpart for when he named more than one himself ("both",
 *  "all three"): every row still in the same tier pick() would have refused
 *  on, rather than one row or nothing. Never invents a row pick() would not
 *  also have found -- the difference is only in what happens once several
 *  real ones turn up. */
function pickAll<T extends { title: string }>(rows: T[], match: string): { found: T[]; why?: string } {
  if (!fold(match)) return { found: [], why: 'nothing to look for' }
  const found = candidates(rows, match)
  return found.length ? { found } : { found: [], why: `nothing here is called "${match}"` }
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

/* The mark is a thinking orb now (2026-10-04, his ask): the same four moods,
   each its own animation instead of one blob changing speed. */
const ORB_FOR: Record<MarkState, OrbState> = { idle: 'searching', thinking: 'working', listening: 'listening', speaking: 'composing' }
export function Mark({ state = 'idle', size = 96 }: { state?: MarkState; size?: number }): JSX.Element {
  const label = state === 'thinking' ? 'Thinking' : state === 'listening' ? 'Listening' : state === 'speaking' ? 'Speaking' : 'Jarvis'
  /* Small, it is a status: the reference's capsule with the word beside it. */
  if (size < 48) return <OrbChip state={ORB_FOR[state]} label={label} />
  /* Large, it is the assistant's face: a dense orb straight on the page. */
  return (
    <span className={`as-orbmark as-mark is-${state}`} style={{ width: size, height: size }}>
      <Orb state={ORB_FOR[state]} size={Math.min(64, Math.round(size * 0.8))} dots={1.6} label={label} />
    </span>
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

/** The app's own name for each page an 'open' action can land on -- not the
 *  route id, and not the model's own guess at a label. */
const OPEN_LABELS: Partial<Record<PageId, string>> = {
  today: 'Today', plan: 'Plan', projects: 'Projects', habits: 'Habits',
  routines: 'Routines', goals: 'Goals', quitting: 'Quitting', settings: 'Settings',
  notes: 'Notes', board: 'the board', apps: 'Apps', focus: 'Focus', zone: 'the Zone',
  bills: 'Bills', calendar: 'Calendar', timeline: 'Jar', ideas: 'Ideas',
  prompts: 'Prompts', people: 'People', gym: 'Gym', longevity: 'Longevity',
  assistant: 'the Assistant', skills: 'Skills', health: 'Health', watchless: 'Watchless',
}

const slotWord = (s?: string) => SLOTS.find((x) => x.id === s)?.label.toLowerCase()
/** pick() for rows whose name is not called `title`. */
function pickBy<T>(rows: T[], name: (r: T) => string, match: string): { row?: T; why?: string } {
  const { row, why } = pick(rows.map((r) => ({ r, title: name(r) })), match)
  return { row: row?.r, why }
}
/** A note has no reliable title -- most are just typed text -- so it is named
 *  the way its own list names it: the title, else its first line. */
const noteName = (n: Note) => n.title || n.body.split('\n')[0].slice(0, 60)
const no = (text: string): Done => ({ ok: false, text })
const yes = (text: string, undo?: () => void): Done => ({ ok: true, text, ...(undo ? { undo } : {}) })

/** Which card shows each kind's result. 'task' is resolved from the row
 *  itself after the write (today, a later day, or the list); null shows
 *  nothing, because the action is a move around the app, not a change. */
const LANDS: Record<Action['kind'], CardKind | 'task' | null> = {
  add: 'task', done: 'task', undone: 'task', move: 'task', estimate: 'task', rename: 'task', drop: 'task',
  steps: 'task', breakdown: 'task', stepDone: 'task', focus: 'task',
  project: 'projects', projectRename: 'projects', projectDelete: 'projects',
  habit: 'habits', habitCount: 'habits', slip: 'habits', addHabit: 'habits', editHabit: 'habits', pauseHabit: 'habits', archiveHabit: 'habits',
  addRoutine: 'routines', editRoutine: 'routines', deleteRoutine: 'routines', routineStep: 'routines',
  addRoutineStep: 'routines', removeRoutineStep: 'routines', routineDone: 'routines', planRoutine: 'routines',
  addGoal: 'goals', editGoal: 'goals', goal: 'goals', milestone: 'goals', repeatGoal: 'goals', deleteGoal: 'goals',
  focusStop: 'focus', logFocus: 'focus',
  note: 'notes', noteEdit: 'notes', noteDelete: 'notes', noteMove: 'notes', notePin: 'notes', noteDone: 'notes', folder: 'notes',
  idea: 'ideas', ideaEdit: 'ideas', ideaDelete: 'ideas',
  addPerson: 'people', editPerson: 'people', deletePerson: 'people', contact: 'people',
  bill: 'bills', skipBill: 'bills', expense: 'bills', income: 'bills',
  gymGoal: 'gym', gymGoalEdit: 'gym', gymGoalDelete: 'gym',
  prompt: 'prompts', promptSent: 'prompts', promptDelete: 'prompts',
  workspace: null, open: null, day: null, app: null, sync: null,
}
/** The card a task sits on right now. */
export const taskCard = (t: Task, day = localDateKey()): CardKind =>
  t.list === 'today' ? ((t.plannedOn ?? day) > day ? 'planned' : 'today') : 'backlog'

/** Runs what the model named, against the same store every page writes to, and
 *  reports what it actually did. Nothing here trusts a title: every match is
 *  resolved against his real rows first, and an unresolved one changes nothing. */
function useDoer() {
  const st = useStore()
  const live = useRef(st)
  live.current = st
  const bills = useAssistantBills()
  /* Through a ref like the store: "start a block, then stop it" in one reply
     must see the block the first action started. */
  const pomoLive = usePomodoro()
  const pomoNow = useRef(pomoLive)
  pomoNow.current = pomoLive

  /* A CHAIN SEES ITS OWN WORK (2026-10-04). live.current is the store as of
     the last render, and every write lands on the NEXT one -- so "make project
     P and put X in it" looked for P before P existed and reported it missing,
     and every dependent pair in one reply failed the same way. After each
     action the doer now waits for that render (or 80ms, when the action
     changed nothing and no render is coming), so each action reads what the
     one before it wrote. */
  const waiters = useRef<(() => void)[]>([])
  useEffect(() => {
    const w = waiters.current
    waiters.current = []
    w.forEach((f) => f())
  })
  const settle = () => new Promise<void>((r) => { waiters.current.push(r); setTimeout(r, 80) })

  /** The row an action touched, for the canvas to mark. */
  let key: string | undefined
  const mark = (k: string) => { key = k }

  return async (actions: Action[]): Promise<Done[]> => {
    const out: Done[] = []
    /* Two "add"s for one title in one run (a retried turn answering twice)
       would otherwise both see the store before either landed. */
    const addedThisRun = new Set<string>()
    for (const a of actions) {
      key = undefined
      let got: Done[]
      try {
        const r = await step(a, addedThisRun)
        const lands = LANDS[a.kind]
        got = Array.isArray(r) ? r
          : [r.ok && lands && !r.at && (lands !== 'task' || key) ? { ...r, at: { card: lands === 'task' ? undefined : lands, key } } : r]
      } catch {
        /* A failed network write (Bills) is a failed line, not a dead turn. */
        got = [no(`${a.kind} could not be saved`)]
      }
      await settle()
      /* Tasks are placed after the write, from where the row really is now. */
      for (const d of got) {
        if (d.at && !d.at.card) {
          const t = live.current.tasks.find((x) => x.id === d.at!.key)
          d.at = { ...d.at, card: t ? taskCard(t) : 'today' }
        }
        out.push(d)
      }
    }
    return out
  }


  async function step(a: Action, addedThisRun: Set<string>): Promise<Done | Done[]> {
    const s = live.current
    const pomo = pomoNow.current
    const day = localDateKey()
    const space = s.space
    const m = a.match ?? ''
    const proj = (name: string) => pickBy(s.projects, (p) => p.name, name)
    const habitRows = s.habits.filter((h) => !h.archivedAt)
    const routineRows = s.routines.filter((r) => !r.archivedAt)

    switch (a.kind) {
      case 'add': {
        const title = a.title!
        const slot = a.list === 'backlog' ? undefined : a.slot
        const list = a.list ?? (a.slot || a.date || a.at ? 'today' : 'backlog')
        const on = list === 'today' ? (a.date ?? day) : undefined
        const where = a.date && a.date !== day ? a.date : slot ? slotWord(slot) : list === 'today' ? 'today' : 'the list'
        const key = title.trim().toLowerCase()
        if (addedThisRun.has(key)) return yes(`Already on the list: ${title}`)
        /* An open row with this exact title already exists (his report,
           2026-09-10): a repeated "add" is his placement for that row,
           restated, so it moves rather than duplicating or no-op'ing. It fills
           in an estimate only where the row has none of its own. */
        const existing = s.tasks.find((t) => !t.done && t.title.trim().toLowerCase() === key)
        if (existing) {
          addedThisRun.add(key)
          const fillsEstimate = a.min != null && !existing.estimated && !existing.estimateMin
          const alreadyThere = existing.list === list && (!slot || existing.slot === slot) && (!on || existing.plannedOn === on) && !fillsEstimate
          mark(existing.id)
          if (alreadyThere) return yes(`Already on the list: ${title}`)
          const wasList = existing.list, wasSlot = existing.slot, wasPlannedOn = existing.plannedOn, wasMin = existing.estimateMin
          if (list !== existing.list || (on && existing.plannedOn !== on)) s.moveTaskList(existing.id, list, on)
          if (slot) s.assignSlot(existing.id, slot)
          if (fillsEstimate) s.setEstimate(existing.id, a.min!)
          return yes(`Moved to ${where}: ${title}`, () => {
            s.moveTaskList(existing.id, wasList, wasPlannedOn)
            if (wasSlot) s.assignSlot(existing.id, wasSlot)
            if (fillsEstimate) s.setEstimate(existing.id, wasMin)
          })
        }
        /* "add X to the Y project": a real project or none. No match still
           adds the task, rather than failing the whole add over one word. */
        let projectId: string | undefined
        let projectNote = ''
        if (a.project) {
          const { row } = proj(a.project)
          if (row) { projectId = row.id; projectNote = ` in ${row.name}` } else projectNote = ` (no project called "${a.project}", added without one)`
        }
        addedThisRun.add(key)
        const est = a.min ?? 15
        const subs = a.steps ?? []
        const id = s.addTask({
          title, source: 'mc', estimateMin: est, estimated: a.min != null,
          space: (a.space as SpaceId | undefined) ?? space, list, category: 'admin', slot, plannedOn: on, projectId,
          ...(a.at ? { at: a.at } : {}),
          ...(subs.length ? {
            subtasks: subs.map((t, i) => ({ id: `${Date.now().toString(36)}s${i}`, title: t, estimateMin: Math.max(5, Math.round(est / subs.length)), done: false })),
          } : {}),
        })
        mark(id)
        return yes(`Added to ${where}${a.at ? ` at ${a.at}` : ''}${projectNote}: ${title}${subs.length ? ` (${subs.length} steps)` : ''}`, () => s.deleteTask(id))
      }

      case 'done': case 'undone': case 'drop': case 'move': case 'estimate': case 'rename': {
        /* inSlot narrows the field BEFORE matching: two rows sharing a title,
           one at noon and one in the afternoon, are only told apart by the
           slot he named. */
        const scoped = a.inSlot ? s.tasks.filter((t) => t.slot === a.inSlot) : s.tasks
        if (a.all && (a.kind === 'done' || a.kind === 'undone' || a.kind === 'drop')) {
          const { found, why } = pickAll(scoped, m)
          return found.length ? found.map((row) => taskStep(a, row)) : no(why ?? 'no task matched')
        }
        const { row, why } = pick(scoped, m)
        return row ? taskStep(a, row) : no(why ?? 'no task matched')
      }

      case 'steps': case 'breakdown': {
        const { row, why } = pick(s.tasks, m)
        if (!row) return no(why ?? 'no task matched')
        mark(row.id)
        if (row.subtasks?.some((x) => x.done)) return no(`${row.title} already has ticked steps, so they were left as they are`)
        let subs: { title: string; estimateMin: number }[]
        if (a.kind === 'steps') {
          const each = Math.max(5, Math.round(taskMinutes(row) / a.steps!.length))
          subs = a.steps!.map((title) => ({ title, estimateMin: each }))
        } else {
          const res = await breakdownTask(row.title, row.category)
          if (!res.ok) return no(`The breakdown did not come back (${res.reason})`)
          subs = res.steps.map((x) => ({ title: x.title, estimateMin: x.estimateMin }))
        }
        s.setSubtasks(row.id, subs)
        return yes(`${subs.length} steps on ${row.title}`)
      }
      case 'stepDone': {
        const { row, why } = pick(s.tasks, m)
        if (!row) return no(why ?? 'no task matched')
        mark(row.id)
        const sub = pickBy(row.subtasks ?? [], (x) => x.title, a.step!)
        if (!sub.row) return no(sub.why ?? `no step like that on ${row.title}`)
        s.toggleSubtask(row.id, sub.row.id)
        return yes(`${sub.row.done ? 'Reopened' : 'Ticked'} step: ${sub.row.title}`)
      }

      case 'project': {
        if (s.projects.some((p) => p.name.trim().toLowerCase() === a.name!.trim().toLowerCase())) return yes(`Already have a project called ${a.name}`)
        mark(a.name!)
        s.addProject(a.name!, (a.space as SpaceId | undefined) ?? space)
        return yes(`Made a new project: ${a.name}`)
      }
      case 'projectRename': {
        const { row, why } = proj(m)
        if (!row) return no(why ?? 'no project matched')
        mark(row.id)
        s.renameProject(row.id, a.name!)
        return yes(`Renamed project ${row.name} to ${a.name}`)
      }
      case 'projectDelete': {
        const { row, why } = proj(m)
        if (!row) return no(why ?? 'no project matched')
        s.deleteProject(row.id, a.deleteTasks ? 'delete' : 'move')
        return yes(`Deleted project ${row.name}${a.deleteTasks ? ' and its tasks' : ', its tasks kept'}`)
      }

      case 'habit': {
        const { row, why } = pickBy(habitRows, (h) => h.name, m)
        if (!row) return no(why ?? 'no habit matched')
        mark(row.id)
        const on = a.on !== false
        if (a.date && a.date !== day) {
          s.markHabitOn(row.id, a.date, on)
          return yes(`${on ? 'Kept' : 'Reopened'} on ${a.date}: ${row.name}`)
        }
        if (row.days[s.todayIndex] === on) return yes(`${row.name} was already ${on ? 'kept' : 'open'} today`)
        s.markHabitDay(row.id, s.todayIndex, on)
        return yes(`${on ? 'Kept today' : 'Reopened today'}: ${row.name}`)
      }
      case 'habitCount': {
        const { row, why } = pickBy(habitRows, (h) => h.name, m)
        if (!row) return no(why ?? 'no habit matched')
        mark(row.id)
        const v = a.value!
        if (habitStepKey(row)) { s.logHabitNumber(row.id, v); return yes(`Logged ${v} on ${row.name}`) }
        if (row.measure !== 'times') return no(`${row.name} is not counted, it is ticked or fed by focus time`)
        for (let i = 0; i < Math.abs(Math.round(v)); i++) { s.logCount(row.id, v < 0 ? -1 : 1); await settle() }
        return yes(`${v < 0 ? 'Took' : 'Counted'} ${Math.abs(Math.round(v))} ${v < 0 ? 'off' : 'on'} ${row.name}`)
      }
      case 'slip': {
        /* Only quitting rows, never an ordinary habit or a routine. A slip is
           a fact about a day, so there is no un-slip. */
        const { row, why } = pickBy(habitRows.filter((h) => h.kind === 'break'), (h) => h.name, m)
        if (!row) return no(why ?? 'nothing he is quitting matched')
        mark(row.id)
        if (a.date && a.date !== day) s.logSlipOn(row.id, a.date); else s.logSlip(row.id)
        return yes(`Logged a slip${a.date && a.date !== day ? ` on ${a.date}` : ''}: ${row.name}`)
      }
      case 'addHabit': {
        mark(a.name!)
        const frequency = a.frequency ?? (a.perWeek ? 'times-per-week' : 'daily')
        s.addHabit({ name: a.name!, frequency, targetPerWeek: a.perWeek, kind: a.breaking ? 'break' : 'build', quitSince: a.breaking ? day : undefined })
        return yes(a.breaking ? `Now tracking: quitting ${a.name}` : `Added a habit: ${a.name}`)
      }
      case 'editHabit': {
        const { row, why } = pickBy(habitRows, (h) => h.name, m)
        if (!row) return no(why ?? 'no habit matched')
        mark(row.id)
        /* Only the fields he named: updateHabit merges {...h, ...patch}, so a
           key present as undefined would wipe the field instead of skipping. */
        const patch: { name?: string; frequency?: HabitFrequency; targetPerWeek?: number } = {}
        if (a.name) patch.name = a.name
        if (a.frequency) patch.frequency = a.frequency
        if (a.perWeek) patch.targetPerWeek = a.perWeek
        s.updateHabit(row.id, patch)
        return yes(`Updated: ${a.name ?? row.name}`)
      }
      case 'pauseHabit': {
        const { row, why } = pickBy(habitRows, (h) => h.name, m)
        if (!row) return no(why ?? 'no habit matched')
        mark(row.id)
        s.togglePauseHabit(row.id)
        return yes(`${row.paused ? 'Resumed' : 'Paused'}: ${row.name}`)
      }
      case 'archiveHabit': {
        const { row, why } = pickBy(habitRows, (h) => h.name, m)
        if (!row) return no(why ?? 'no habit matched')
        mark(row.id)
        s.deleteHabit(row.id)
        return yes(`Archived: ${row.name}`)
      }

      case 'addRoutine': {
        mark(a.title!)
        s.addRoutine({ title: a.title!, cadence: a.cadence ?? 'daily', blurb: a.blurb })
        if (a.steps?.length) {
          await settle()
          const made = live.current.routines.filter((r) => r.title === a.title).at(-1)
          for (const title of made ? a.steps : []) { live.current.addRoutineStep(made!.id, { title }); await settle() }
        }
        return yes(`Made a new routine: ${a.title}${a.steps?.length ? ` (${a.steps.length} steps)` : ''}`)
      }
      case 'editRoutine': case 'deleteRoutine': case 'routineStep': case 'addRoutineStep': case 'removeRoutineStep': case 'routineDone': case 'planRoutine': {
        const { row: r, why } = pickBy(routineRows, (x) => x.title, m)
        if (!r) return no(why ?? 'no routine matched')
        mark(r.id)
        if (a.kind === 'editRoutine') {
          const patch: { title?: string; cadence?: RoutineCadence; blurb?: string } = {}
          if (a.title) patch.title = a.title
          if (a.cadence) patch.cadence = a.cadence
          if (a.blurb) patch.blurb = a.blurb
          s.updateRoutine(r.id, patch)
          return yes(`Updated routine: ${a.title ?? r.title}`)
        }
        if (a.kind === 'deleteRoutine') { s.deleteRoutine(r.id); return yes(`Deleted routine: ${r.title}`) }
        if (a.kind === 'addRoutineStep') { s.addRoutineStep(r.id, { title: a.step! }); return yes(`Added a step to ${r.title}: ${a.step}`) }
        if (a.kind === 'routineDone') { s.setRoutineDone(r.id, a.on !== false); return yes(`${a.on === false ? 'Reopened' : 'Done'}: ${r.title}`) }
        if (a.kind === 'planRoutine') {
          s.planRoutine(r.id, a.slot, a.date)
          return yes(`Planned ${r.title} for ${a.date && a.date !== day ? a.date : slotWord(a.slot) ?? 'today'}`)
        }
        const st2 = pickBy(r.steps, (x) => x.title, a.step!)
        if (!st2.row) return no(st2.why ?? `no step like that in ${r.title}`)
        if (a.kind === 'removeRoutineStep') { s.deleteRoutineStep(r.id, st2.row.id); return yes(`Removed from ${r.title}: ${st2.row.title}`) }
        const was = r.doneStepIds.includes(st2.row.id)
        s.toggleRoutineStep(r.id, st2.row.id)
        await settle()
        /* A gated step (the typing test) refuses a tick until it is passed,
           silently. Read it back rather than reporting a tick that never was. */
        const now = live.current.routines.find((x) => x.id === r.id)?.doneStepIds.includes(st2.row.id)
        if (now === was) return no(`${st2.row.title} is locked until its own test is passed`)
        return yes(`${was ? 'Unticked' : 'Ticked'} in ${r.title}: ${st2.row.title}`)
      }

      case 'addGoal': {
        const tf = a.timeframe ?? 'monthly'
        const ms = a.milestones ?? []
        mark(a.name!)
        if (!ms.length && !a.target) return no(`A goal needs a target number or milestones: ${a.name}`)
        s.addGoal({
          space: (a.space as SpaceId | undefined) ?? space, name: a.name!, current: 0, note: '',
          target: ms.length || a.target!, unit: ms.length ? 'milestones' : a.unit ?? 'steps',
          timeframe: tf, category: a.category ?? 'life', why: a.why, periodKey: goalPeriodKey(tf),
          milestones: ms.map((label, i) => ({ id: `ms-${Date.now().toString(36)}-${i}`, label, done: false })),
        })
        return yes(`Made a new goal: ${a.name}`)
      }
      case 'editGoal': case 'goal': case 'milestone': case 'repeatGoal': case 'deleteGoal': {
        /* An open goal wins over a closed one of the same name, except for
           repeat, which only makes sense on a closed one. */
        const rows = a.kind === 'repeatGoal' ? s.goals : s.goals.filter((g) => !g.closed)
        const { row: g, why } = pickBy(rows, (x) => x.name, m)
        if (!g) return no(why ?? 'no goal matched')
        mark(g.id)
        if (a.kind === 'deleteGoal') { s.deleteGoal(g.id); return yes(`Deleted goal: ${g.name}`) }
        if (a.kind === 'repeatGoal') return s.repeatGoal(g.id) ? yes(`Running again: ${g.name}`) : no(`${g.name} could not be repeated`)
        if (a.kind === 'editGoal') {
          const patch: { name?: string; target?: number; unit?: string; timeframe?: GoalTimeframe; why?: string } = {}
          if (a.name) patch.name = a.name
          if (a.target) patch.target = a.target
          if (a.unit) patch.unit = a.unit
          if (a.timeframe) patch.timeframe = a.timeframe
          if (a.why) patch.why = a.why
          s.updateGoal(g.id, patch)
          return yes(`Updated goal: ${a.name ?? g.name}`)
        }
        if (a.kind === 'milestone') {
          const ms = pickBy(g.milestones ?? [], (x) => x.label, a.step!)
          if (!ms.row) return no(ms.why ?? `no milestone like that on ${g.name}`)
          s.toggleGoalMilestone(g.id, ms.row.id)
          return yes(`${ms.row.done ? 'Reopened' : 'Ticked'} on ${g.name}: ${ms.row.label}`)
        }
        /* A goal fed by a habit counts itself; a number typed over it would
           be overwritten by the next tick and mean nothing meanwhile. */
        if (g.habitId) return no(`${g.name} counts itself from its habit, so there is no number to set`)
        const next = a.set != null ? a.set : g.current + (a.by ?? 0)
        if (a.set != null) s.updateGoal(g.id, { current: a.set }); else s.bumpGoal(g.id, a.by!)
        return yes(`${g.name}: ${next} of ${g.target} ${g.unit}`, () => s.updateGoal(g.id, { current: g.current }))
      }

      case 'focus': {
        /* A real timer, starting now. pomo lives in its own context, not the
           store, so it is read here rather than through s. */
        if (a.match) {
          const { row, why } = pick(s.tasks, a.match)
          if (!row) return no(why ?? 'no task matched')
          mark(row.id)
          pomo.startFocus(a.min ?? taskMinutes(row), row.title)
          return yes(`Focus started: ${row.title}`)
        }
        pomo.startFocus(a.min, undefined)
        return yes(a.min ? `Focus started, ${fmtDuration(a.min)}` : 'Focus started')
      }
      case 'focusStop':
        if (pomo.phase === 'idle') return yes('No focus block was running')
        pomo.stop()
        return yes('Focus stopped, the time so far is kept')
      case 'logFocus': {
        if (a.date || a.at) s.logFocusOn(a.date ?? day, a.min!, a.label, a.at); else s.logFocus(a.min!, a.label)
        return yes(`Logged ${fmtDuration(a.min!)} of focus${a.label ? ` on ${a.label}` : ''}${a.date && a.date !== day ? ` on ${a.date}` : ''}`)
      }

      case 'note': {
        /* Filed where he is standing, or in the folder he named. A folder that
           does not exist does not lose the note: it lands in the default. */
        const f = a.folder ? pickBy(s.noteFolders, (x) => x.name, a.folder) : null
        /* A note's title IS its first line (store/notes.ts noteTitle), so a
           title he named is written as that line, not a field that the store
           would overwrite from the body. */
        mark(s.addNote(f?.row?.id ?? spaceFolderId(space), a.title ? `${a.title}\n${a.text}` : a.text))
        return yes(`Noted${f?.row ? ` in ${f.row.name}` : ''}${f && !f.row ? ` (no folder called "${a.folder}", filed in the default)` : ''}`)
      }
      case 'noteEdit': case 'noteDelete': case 'noteMove': case 'notePin': case 'noteDone': {
        const { row, why } = pickBy(s.notes, noteName, m)
        if (!row) return no(why ?? 'no note matched')
        mark(row.id)
        const name = noteName(row)
        if (a.kind === 'noteDelete') { s.deleteNote(row.id); return yes(`Deleted note: ${name}`) }
        if (a.kind === 'notePin') { s.updateNote(row.id, { pinned: a.on !== false }); return yes(`${a.on === false ? 'Unpinned' : 'Pinned'}: ${name}`) }
        if (a.kind === 'noteDone') { s.setNoteDone(row.id, a.on !== false); return yes(`${a.on === false ? 'Reopened' : 'Done'}: ${name}`) }
        if (a.kind === 'noteMove') {
          const f = pickBy(s.noteFolders, (x) => x.name, a.folder!)
          if (!f.row) return no(f.why ?? 'no folder matched')
          s.moveNote(row.id, f.row.id)
          return yes(`Moved to ${f.row.name}: ${name}`)
        }
        const rest = row.body.split('\n').slice(1).join('\n')
        const body = a.text ? (a.title ? `${a.title}\n${a.text}` : a.text) : `${a.title}\n${rest}`
        s.updateNote(row.id, { body })
        return yes(`Updated note: ${a.title ?? name}`)
      }
      case 'folder':
        mark(s.addNoteFolder((a.space as SpaceId | undefined) ?? space, a.name!))
        return yes(`Made a notes folder: ${a.name}`)

      case 'idea': {
        /* First free spot on a grid from the board's home corner, so a
           dictated card never lands on top of one already there. */
        const taken = (x: number, y: number) => s.ideaBoard.some((c) => Math.abs(c.x - x) < 200 && Math.abs(c.y - y) < 160)
        let x = 40, y = 40
        for (let i = 0; i < 200 && taken(x, y); i++) { x = 40 + (i % 6) * 240; y = 40 + Math.floor(i / 6) * 200 }
        mark(a.title!)
        s.addIdeaCard({ title: a.title!, body: a.body ?? '', color: 'amber', /* IDEA_COLORS[0]; importing ideasdock here would pull dictation into the eager bundle */ x, y })
        return yes(`On the ideas board: ${a.title}`)
      }
      case 'ideaEdit': case 'ideaDelete': {
        const { row, why } = pickBy(s.ideaBoard, (c) => c.title, m)
        if (!row) return no(why ?? 'no idea card matched')
        mark(row.id)
        if (a.kind === 'ideaDelete') { s.deleteIdeaCard(row.id); return yes(`Deleted idea: ${row.title}`) }
        s.updateIdeaCard(row.id, { ...(a.title ? { title: a.title } : {}), ...(a.body ? { body: a.body } : {}) })
        return yes(`Updated idea: ${a.title ?? row.title}`)
      }

      case 'addPerson': {
        /* Same placement rule as the People page's own "+". */
        const tier = a.tier!
        const { x, y } = nextPersonSlot(s.people, tier)
        mark(a.name!)
        const id = s.addPerson({ name: a.name!, rel: a.rel ?? '', tier, cadenceDays: TIER_CADENCE[tier], x, y })
        if (a.job || a.birthday || a.birthYear) { await settle(); live.current.updatePerson(id, { job: a.job, birthday: a.birthday, birthYear: a.birthYear }) }
        return yes(`Added to ${TIER_LABEL[tier]}: ${a.name}`)
      }
      case 'editPerson': case 'deletePerson': case 'contact': {
        const { row, why } = pickBy(s.people, (p) => p.name, m)
        if (!row) return no(why ?? 'no person matched')
        mark(row.id)
        if (a.kind === 'deletePerson') { s.deletePerson(row.id); return yes(`Removed: ${row.name}`) }
        if (a.kind === 'contact') {
          s.logContact(row.id, a.date ?? day, a.channel ?? 'inperson')
          return yes(`Logged contact with ${row.name}${a.date && a.date !== day ? ` on ${a.date}` : ''}`)
        }
        const patch: Record<string, unknown> = {}
        for (const k of ['name', 'tier', 'rel', 'job', 'birthday', 'birthYear', 'cadenceDays'] as const) if (a[k] !== undefined) patch[k] = a[k]
        s.updatePerson(row.id, patch)
        return yes(`Updated: ${a.name ?? row.name}`)
      }

      case 'bill': case 'skipBill': {
        /* ensure(), not this hook's render: a request landing the instant
           Bills opens would otherwise read a fetch that has not resolved and
           report a signed-in device as signed out (his report, 2026-09-08). */
        const fresh = await bills.ensure()
        if (!fresh.ready) return no('Bills is not signed in on this device')
        const { row, why } = pickBy(fresh.items, (i) => i.name, m)
        if (!row) return no(why ?? 'no bill matched')
        mark(row.id)
        if (a.kind === 'skipBill') {
          await bills.setSkip(row.id, a.on !== false)
          return yes(`${a.on === false ? 'Unskipped' : 'Skipped this cycle'}: ${row.name}`)
        }
        const paid = a.paid !== false
        if (row.paid === paid) return yes(`${row.name} was already ${paid ? 'paid' : 'unpaid'}`)
        if (paid) await bills.markPaid(row); else await bills.markUnpaid(row)
        return yes(paid ? `Marked paid: ${row.name}` : `Marked unpaid: ${row.name}`)
      }
      case 'expense': case 'income': {
        const fresh = await bills.ensure()
        if (!fresh.ready) return no('Bills is not signed in on this device')
        if (a.kind === 'expense') {
          mark(a.name!)
          await bills.addExpense(a.name!, a.amount!, a.dueOn)
          return yes(`Added to Unexpected this cycle: ${a.name} (${a.amount} Kč)`)
        }
        await bills.addIncome(a.amount!, a.label)
        return yes(`Added to Income: ${a.amount} Kč${a.label ? ` (${a.label})` : ''}`)
      }

      case 'gymGoal':
        mark(a.name!)
        s.addGymGoal({ name: a.name!, goal: a.goal!, unit: a.unit!, metric: a.metric ?? (a.exercise ? 'e1rm' : 'manual'), exerciseName: a.exercise, lowerIsBetter: a.lowerIsBetter })
        return yes(`New gym target: ${a.name}`)
      case 'gymGoalEdit': case 'gymGoalDelete': {
        const { row, why } = pickBy(s.gymGoals, (g) => g.name, m)
        if (!row) return no(why ?? 'no gym target matched')
        mark(row.id)
        if (a.kind === 'gymGoalDelete') { s.deleteGymGoal(row.id); return yes(`Deleted gym target: ${row.name}`) }
        s.updateGymGoal(row.id, { ...(a.name ? { name: a.name } : {}), ...(a.goal != null ? { goal: a.goal } : {}), ...(a.current != null ? { current: a.current } : {}) })
        return yes(`Updated gym target: ${a.name ?? row.name}`)
      }

      case 'prompt':
        mark(s.addPrompt({ project: a.project ?? 'General', session: 'General', kind: a.type ?? 'Idea', text: a.text! }))
        return yes('Saved the prompt for later')
      case 'promptSent': case 'promptDelete': {
        const { row, why } = pickBy(s.prompts, (p) => p.text.slice(0, 120), m)
        if (!row) return no(why ?? 'no saved prompt matched')
        mark(row.id)
        if (a.kind === 'promptDelete') { s.deletePrompt(row.id); return yes('Deleted the prompt') }
        s.setPromptSent(row.id, a.on !== false)
        return yes(a.on === false ? 'Back in the queue' : 'Marked sent')
      }

      case 'workspace':
        /* setView, not setSpace: it is what the header's own switcher calls,
           so it changes what he SEES, not only an internal default. */
        s.setView(a.space!)
        return yes(`Switched to ${a.space === 'all' ? 'All' : SPACE_LABELS[a.space as SpaceId]}`)
      case 'open':
        s.setPage(a.page!)
        return yes(`Opened ${OPEN_LABELS[a.page!] ?? a.page}`)
      case 'day':
        s.openDay(a.date!)
        return yes(`Opened ${a.date}`)
      case 'app': {
        const { row, why } = pickBy(APPS, (x) => x.name, m)
        if (!row) return no(why ?? 'no app matched')
        s.setFocusAppId(row.id)
        s.setPage('apps')
        return yes(`Opened ${row.name}`)
      }
      case 'sync': {
        /* Exactly what Settings' own "Sync now" makes. */
        if (!hasHevyKey()) return no('No Hevy key set on this device')
        const res = await syncHevy(s.habits, s.markHabitDaysOn)
        return res.ok
          ? yes(`Synced Hevy: ${res.days} day${res.days === 1 ? '' : 's'} of workouts`)
          : no(res.reason === 'bad-key' ? 'That Hevy key was rejected'
            : res.reason === 'rate-limit' ? 'Hevy is rate limiting right now'
              : res.reason === 'no-habit' ? 'No habit named Workout / Gym / Fitness to tick'
                : 'Hevy could not be reached')
      }
    }
  }

  /** A task action, tagged with the row it touched. A deleted row cannot be
   *  found afterwards, so its card is the one it was on. */
  function taskStep(a: Action, row: Task): Done {
    const d = doTask(a, row)
    return d.ok ? { ...d, at: { key: row.id, card: a.kind === 'drop' ? taskCard(row) : undefined } } : d
  }

  /** One task row, one task action. Every write snapshots what it changes
   *  first, so its undo puts back exactly what was there. */
  function doTask(a: Action, row: Task): Done {
    const s = live.current
    const day = localDateKey()
    switch (a.kind) {
      case 'done': {
        if (row.done) return yes(`${row.title} was already done`)
        /* He said the real number in the same breath: log it outright.
           logActual also writes the ledger and focus rows; undo reverses the
           done flag only, the same trade logSlip makes. */
        if (a.actualMin != null) {
          s.logActual(row.id, a.actualMin)
          return yes(`Done: ${row.title}, ${fmtDuration(a.actualMin)}`, () => s.toggleTask(row.id))
        }
        s.toggleTask(row.id)
        return {
          ok: true,
          text: `Done: ${row.title}`,
          needsActual: row.actualMin == null ? { taskId: row.id, est: taskMinutes(row) } : undefined,
          undo: () => s.toggleTask(row.id),
        }
      }
      case 'undone':
        if (!row.done) return yes(`${row.title} was already open`)
        s.toggleTask(row.id)
        return yes(`Reopened: ${row.title}`, () => s.toggleTask(row.id))
      case 'move': {
        const was = { list: row.list, slot: row.slot, plannedOn: row.plannedOn, projectId: row.projectId, space: row.space, at: row.at }
        const said: string[] = []
        if (a.list && a.list !== row.list) { s.moveTaskList(row.id, a.list, a.list === 'today' ? a.date ?? day : undefined); said.push(a.list === 'today' ? 'today' : 'the list') }
        if (a.date && a.list !== 'backlog') { s.moveTaskList(row.id, 'today', a.date); said.push(a.date === day ? 'today' : a.date) }
        if (a.slot) {
          if (row.list !== 'today' && !a.list && !a.date) s.moveTaskList(row.id, 'today', day)
          s.assignSlot(row.id, a.slot)
          said.push(slotWord(a.slot) ?? a.slot)
        }
        if (a.at) { s.setTaskAt(row.id, a.at === 'none' ? undefined : a.at); said.push(a.at === 'none' ? 'no fixed time' : a.at) }
        if (a.space && a.space !== 'all' && a.space !== row.space) { s.setTaskSpace(row.id, a.space); said.push(SPACE_LABELS[a.space]) }
        let movedProject = false
        if (a.project) {
          const { row: p } = pickBy(s.projects, (x) => x.name, a.project)
          if (p) { s.setTaskProject(row.id, p.id); said.push(p.name); movedProject = true } else said.push(`(no project called "${a.project}")`)
        }
        return yes(`Moved to ${[...new Set(said)].join(', ')}: ${row.title}`, () => {
          s.moveTaskList(row.id, was.list, was.plannedOn)
          if (was.slot) s.assignSlot(row.id, was.slot)
          if (a.at) s.setTaskAt(row.id, was.at)
          if (was.space && a.space && a.space !== 'all') s.setTaskSpace(row.id, was.space)
          if (movedProject) s.setTaskProject(row.id, was.projectId)
        })
      }
      case 'estimate': {
        const wasMin = row.estimateMin
        s.setEstimate(row.id, a.min!)
        return yes(`${fmtDuration(a.min!)} on ${row.title}`, () => s.setEstimate(row.id, wasMin))
      }
      case 'rename': {
        const was = row.title
        s.updateTask(row.id, { title: a.title })
        return yes(`Renamed "${was}" to: ${a.title}`, () => s.updateTask(row.id, { title: was }))
      }
      case 'drop':
        s.deleteTask(row.id)
        return yes(`Deleted: ${row.title}`)
      default:
        return no('nothing here to run')
    }
  }
}

/** The model's eyes: one lookup over his real rows, answered in plain lines
 *  it can copy titles out of. Read from the latest render each time, so a
 *  lookup after an action sees what that action wrote. */
function useFinder() {
  const st = useStore()
  const { state: cal } = useCalendar()
  const bills = useAssistantBills()
  const live = useRef({ st, cal, bills })
  live.current = { st, cal, bills }

  return (q: Find): string => {
    const { st: s, cal: c, bills: b } = live.current
    const day = localDateKey()
    const qf = q.query ? fold(q.query) : ''
    const words = qf.split(' ').filter((w) => w.length > 2)
    const hit = (t: string) => !qf || fold(t).includes(qf) || (words.length > 0 && words.every((w) => fold(t).includes(w)))
    const projectName = (id?: string) => s.projects.find((p) => p.id === id)?.name
    const where = (t: { space?: SpaceId; projectId?: string }) => projectName(t.projectId) ?? (t.space ? SPACE_LABELS[t.space] : 'Unfiled')
    let rows: string[] = []
    switch (q.what) {
      case 'tasks':
        rows = s.tasks.filter((t) => !t.done && hit(t.title)).map((t) => [
          dropUrl(t.title) || t.title,
          t.list === 'today' ? `planned ${t.plannedOn ?? day}${t.slot ? ` ${t.slot}` : ''}${t.at ? ` at ${t.at}` : ''}` : 'on the list',
          where(t), `${taskMinutes(t)}m`,
          t.subtasks?.length ? `steps: ${t.subtasks.map((x) => `${x.title}${x.done ? ' (done)' : ''}`).join('; ')}` : '',
          t.createdAt ? `added ${t.createdAt}` : '',
        ].filter(Boolean).join(' | '))
        break
      case 'done':
        rows = s.tasks.filter((t) => t.done && hit(t.title))
          .sort((x, y) => (y.doneAt ?? '').localeCompare(x.doneAt ?? ''))
          .map((t) => `${dropUrl(t.title) || t.title} | done ${t.doneAt ? localDateKey(new Date(t.doneAt)) : '?'}${t.actualMin != null ? ` | took ${t.actualMin}m` : ''} | ${where(t)}`)
        break
      case 'projects':
        rows = s.projects.filter((p) => hit(p.name)).map((p) => `${p.name} | ${SPACE_LABELS[p.space]} | ${s.tasks.filter((t) => t.projectId === p.id && !t.done).length} open tasks`)
        break
      case 'habits':
        rows = s.habits.filter((h) => !h.archivedAt && hit(h.name)).map((h) => [
          h.name, h.kind === 'break' ? `quitting, ${daysClean(h, s.slips) ?? 0}d clean` : h.kind, h.frequency,
          h.paused ? 'paused' : '', h.kind !== 'break' ? (h.days[s.todayIndex] ? 'kept today' : 'open today') : '',
        ].filter(Boolean).join(' | '))
        break
      case 'routines':
        rows = s.routines.filter((r) => !r.archivedAt && hit(r.title)).map((r) => `${r.title} | ${r.cadence} | steps: ${r.steps.map((x) => `${x.title}${r.doneStepIds.includes(x.id) ? ' (done)' : ''}`).join('; ') || 'none yet'}`)
        break
      case 'goals':
        rows = s.goals.filter((g) => hit(g.name)).map((g) => {
          const tf = (g.timeframe ?? 'quarter') as GoalTf
          const cur = goalCurrent(g, s.habits, s.habitLog, goalPeriodRange(tf, g.periodKey ?? goalPeriodKey(tf)), s.slips, s.focusSessions)
          return [
            g.name, `${cur} of ${g.target} ${g.unit}`, tf, g.closed ? `closed ${g.closed.on}` : 'open',
            g.habitId ? 'counts itself from a habit' : '',
            g.milestones?.length ? `milestones: ${g.milestones.map((x) => `${x.label}${x.done ? ' (done)' : ''}`).join('; ')}` : '',
          ].filter(Boolean).join(' | ')
        })
        break
      case 'notes':
        rows = s.notes.filter((n) => hit(`${noteName(n)} ${n.body}`)).map((n) => [
          noteName(n), s.noteFolders.find((f) => f.id === n.folderId)?.name ?? SPACE_LABELS[n.space],
          n.pinned ? 'pinned' : '', n.done ? 'done' : '', n.body.replace(/\s+/g, ' ').slice(0, 140),
        ].filter(Boolean).join(' | '))
        rows.push(`Folders: ${s.noteFolders.map((f) => f.name).join('; ') || 'none'}`)
        break
      case 'people':
        rows = s.people.filter((p) => hit(`${p.name} ${p.rel ?? ''}`)).map((p) => {
          const last = s.personContacts.filter((x) => x.personId === p.id).map((x) => x.day).sort().at(-1)
          return [p.name, TIER_LABEL[p.tier], p.rel, p.job, p.birthday ? `birthday ${p.birthday}` : '', last ? `last in touch ${last}` : 'no contact logged'].filter(Boolean).join(' | ')
        })
        break
      case 'ideas':
        rows = s.ideaBoard.filter((x) => hit(`${x.title} ${x.body}`)).map((x) => `${x.title}${x.body ? ` | ${x.body.replace(/\s+/g, ' ').slice(0, 120)}` : ''}`)
        break
      case 'bills':
        if (b.loading) return 'Bills is still loading on this device.'
        if (!b.ready) return 'Bills is not signed in on this device.'
        rows = b.items.filter((i) => hit(i.name)).map((i) => `${i.name} | ${i.amount} Kč | ${i.paid ? 'paid' : i.overdue ? 'OVERDUE' : 'unpaid'}${i.dueOn ? ` | due ${i.dueOn}` : ''}`)
        break
      case 'calendar': {
        if (c.status !== 'ok') return 'The calendar is not connected or has not loaded.'
        const from = new Date(); from.setDate(from.getDate() - 7)
        const to = new Date(); to.setDate(to.getDate() + 21)
        rows = c.events.filter((e) => e.day >= localDateKey(from) && e.day <= localDateKey(to) && hit(e.title))
          .sort((x, y) => `${x.day}${String(x.start ?? 0).padStart(4, '0')}`.localeCompare(`${y.day}${String(y.start ?? 0).padStart(4, '0')}`))
          .map((e) => `${e.day}${e.start != null ? ` ${String(Math.floor(e.start / 60)).padStart(2, '0')}:${String(e.start % 60).padStart(2, '0')}` : ' all day'} | ${e.title} | ${isMeeting(e) ? 'meeting' : 'block'}`)
        break
      }
      case 'focus':
        rows = s.focusSessions.slice(-60).reverse().filter((f) => hit(f.label ?? '')).map((f) => `${f.day} | ${f.minutes}m${f.label ? ` | ${f.label}` : ''}`)
        break
      case 'gym':
        rows = s.gymGoals.filter((g) => hit(g.name)).map((g) => `${g.name} | ${g.current ?? '?'} of ${g.goal} ${g.unit}${g.exerciseName ? ` | ${g.exerciseName}` : ''}`)
        break
      case 'prompts':
        rows = s.prompts.filter((p) => hit(p.text)).map((p) => `${p.text.replace(/\s+/g, ' ').slice(0, 120)} | ${p.project} | ${p.kind}${p.sentAt ? ' | sent' : ''}`)
        break
      case 'apps':
        rows = APPS.filter((x) => hit(x.name)).map((x) => x.name)
        break
    }
    if (!rows.length) return `Nothing found${q.query ? ` for "${q.query}"` : ''}.`
    const CAP = 40
    return rows.slice(0, CAP).map((r) => `- ${r}`).join('\n') + (rows.length > CAP ? `\n(${rows.length - CAP} more: narrow the query)` : '')
  }
}

export interface Turn { who: 'you' | 'it'; text: string; reply?: Reply; done?: Done[]; touched?: string[] }

/** Where a turn's changes landed: the cards that hold them, in the order they
 *  happened, and the rows to mark. Empty when nothing it did has a place. */
function landed(done: Done[]): { kinds: CardKind[]; keys: string[] } {
  const ok = done.filter((d) => d.ok && d.at?.card)
  return {
    kinds: [...new Set(ok.map((d) => d.at!.card!))].slice(0, 3),
    keys: ok.flatMap((d) => (d.at?.key ? [d.at.key] : [])),
  }
}

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
  const find = useFinder()
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
  /** Rows the last change touched, marked on the canvas. */
  const [touched, setTouched] = useState<string[]>([])
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
    /* A real day plan, parsed straight into real rows -- no model asked to
       reproduce it, so nothing in it can be sampled, truncated or reordered.
       See parseBulkPlan's own note for why this exists at all. */
    const bulk = parseBulkPlan(text)
    if (bulk) {
      const done = await run(bulk)
      const say = `Slotting in ${bulk.length} item${bulk.length === 1 ? '' : 's'}, exactly as written -- no model in the loop for this one.`
      const where = landed(done)
      setTurns((t) => [...t, { who: 'it', text: say, done, touched: where.keys, reply: { say, show: where.kinds.map((kind) => ({ kind })) } }])
      if (where.kinds.length) { setCanvas(where.kinds); setTouched(where.keys) }
      setBusy(false); setLive('')
      return say
    }
    /* What the app actually did goes back into the history with each answer
       (2026-10-04). It used to send only the model's own sentences, so a turn
       later it had no idea which rows it had really touched: "move it to the
       evening" and "no, I meant X" were guesses about its own past. */
    const history = turns.map((t) => ({
      role: (t.who === 'you' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: t.done?.length ? `${t.text}\n[App results: ${t.done.map((d) => `${d.ok ? '' : 'FAILED '}${d.text}${d.undone ? ' (he undid this)' : ''}`).join('; ')}]` : t.text,
    }))
    /* Every line any round ran, kept here with its undo and its actual-time
       prompt; the loop itself only needs ok/text. The rate-limit wait lives
       inside ask() now, per round, so a limit hit halfway through a job
       resumes it instead of re-running its first half. */
    const done: Done[] = []
    const out = await ask(text, brief, history, {
      run: async (acts) => { const d = await run(acts); done.push(...d); return d },
      find,
    }, setLive)
    if (out.ok) {
      /* WHAT CHANGED DECIDES THE CANVAS, not the model's choice of card. He
         asked for a task and the canvas stayed on the day while the task went
         to the list (his report, 2026-10-04): every change now opens the card
         it landed on, with its row marked. The model's own cards are for
         questions, where nothing moved. */
      const where = landed(done)
      const reply = where.kinds.length ? { ...out.reply, show: where.kinds.map((kind) => ({ kind })) } : out.reply
      setTurns((t) => [...t, { who: 'it', text: reply.say, reply, done: done.length ? done : undefined, touched: where.keys }])
      setTouched(where.keys)
      let kinds = reply.show.map((c) => c.kind)
      /* The brief ALWAYS draws the sky, whether or not the model remembered to
         name it. He asked for the weather to be visible, and that is not a
         thing to leave to whether a sentence came back with the right card in
         it. The app owns this card's numbers anyway. */
      if (text === MORNING.ask && !kinds.includes('weather')) kinds = ['weather', ...kinds]
      if (kinds.length) setCanvas(kinds.slice(0, 3))
      /* A change he cannot see is a change he will not believe. Anything that
         touched the day puts the day on the canvas unless it named its own. */
      else if (done.some((d) => d.ok)) setCanvas(['today'])
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

  return { brief, turns, setTurns, busy, err, errHint, canvas, setCanvas, touched, setTouched, live, send }
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

export function VoicePanel({ onExit }: { onExit: () => void }): JSX.Element {
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
  /* His ask (2026-09-08): a long answer read out loud with no way to cut it
     short except a voice he cannot use while it is already talking over him
     -- "I should be able to interrupt... not with voice, just a click."
     stopSpeaking() (speech.ts) ends the playback outright; voicemode.ts's
     own send() is still sitting on `await say(...)` at that exact moment
     (it resolves the instant playback state returns to idle) and falls
     straight through to listen() itself, phase never having left
     'speaking' along the way -- so a tap here needs nothing from
     voicemode.ts at all, only to end the audio it is already watching for. */
  const interrupt = phase === 'speaking' ? () => stopSpeaking() : undefined
  const said = phase === 'thinking' ? 'Thinking'
    : phase === 'speaking' ? (mute ? 'Reading it out, no level from this voice' : 'Reading it out')
      : 'Listening'

  const wave = (
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
  )

  return (
    <div className={`as-voice is-${phase}`}>
      <div className="as-voice-head">
        <span className="as-voice-state">{said}{interrupt ? ' — tap to skip' : ''}</span>
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

          A real button only while speaking, wrapping the exact same wave --
          listening and thinking have nothing here worth interrupting, so
          the picture stays a picture (aria-hidden, named in words beside it)
          the rest of the time rather than a control that does nothing. */}
      {interrupt ? (
        <button
          type="button" className="as-wave-btn" onClick={interrupt}
          aria-label="Stop reading and listen again" title="Tap to stop reading and listen again"
        >
          {wave}
        </button>
      ) : wave}
      <p className="as-voice-heard" aria-live="polite">
        {heard || (live ? 'Say something.' : ' ')}
      </p>
    </div>
  )
}

/** The glue between a conversation (`send`, from useAssistantThread) and voice
 *  mode's own module-level state machine (voicemode.ts): whether the voice
 *  panel is on screen, starting it, falling back to a typed send when the
 *  browser cannot do voice, and hanging up. Shared by the full page and the
 *  dock's compact panel (2026-09-08, his ask that the quick-tap widget be
 *  "primarily voice") so a fix to one is a fix to both, not a fork.
 *
 *  `onBeforeSend` is for whatever the caller needs cleared before a voice
 *  session opens or a skill falls back to typing -- the full page cancels an
 *  in-progress dictation and clears its box; the dock panel has no dictation,
 *  only the box. `refocus` runs once voice hangs up, same reason each caller
 *  already refocuses its own box after an ordinary send. */
export function useVoiceGlue(
  send: (text: string, shown?: string) => Promise<string>,
  onBeforeSend: () => void,
  refocus: () => void,
  /* Passed straight through to voicemode's own enter(). Omitted, the full
     page keeps its exact existing behaviour (a silent hang-up after enough
     dead air) -- the dock passes 0 (his ask, 2026-09-08): the quick panel's
     session runs until HE ends it, closing the panel, holding a long press
     to the full page, or the voice panel's own Done button, never on
     silence alone. */
  idleHangupMs?: number,
) {
  const [voice, setVoice] = useState(false)
  /* Voice mode drives the SAME send as the button, so a spoken question is an
     ordinary turn in the thread and the answer it reads out is the answer he
     can also see. */
  const startVoice = async (opening?: string, openingLabel?: string) => {
    onBeforeSend()
    setVoice(true)
    const ok = await enterVoice(
      (text) => send(text, text === opening ? openingLabel : undefined),
      opening,
      idleHangupMs,
    )
    if (!ok) setVoice(false)
  }
  /* One path for every skill, including the brief. It opens voice mode when
     the browser can do it, because these are things he asks on the way
     somewhere, and falls back to a typed send when it cannot. Either way the
     thread shows the skill's NAME, never the paragraph behind it. */
  const runSkill = async (k: { label: string; ask: string }) => {
    if (voiceModeAvailable()) { await startVoice(k.ask, k.label); return }
    onBeforeSend()
    await send(k.ask, k.label)
  }
  const endVoice = () => { exitVoice(); setVoice(false); refocus() }
  /* Leaving the page (or closing the dock panel) hangs up. A microphone left
     open on something he has walked away from is the worst bug this feature
     could have. */
  useEffect(() => exitVoice, [])

  return { voice, startVoice, runSkill, endVoice }
}
