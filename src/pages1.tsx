import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { SpaceGrid } from './Grid'
import { MOCK_AGENDA, SPACE_LABELS, exceptionsFor, globalExceptions, momentum } from './exceptions'
import { MOCK_MONEY, fakeDecompose } from './mock'
import { useStore } from './store'
import { usePomodoro } from './pomodoro'
import { useCompass } from './compass'
import { useCalendar } from './calendar'
import { MorningRoutine } from './morning'
import { BreakdownSheet, Sheet } from './modals'
import { Linkify } from './widgets'
import { HabitRun, habitHasRun } from './habitrun'
import { PrecedentCard } from './precedentcard'
import type { PageId } from './types'
import { habitsDueToday, GOAL_CATEGORIES, GOAL_TIMEFRAMES, HABIT_FREQUENCIES, SLOTS, SPACES, bestCleanRun, bestStreak, dueOn, currentStreak, daysClean, keptDaysIn, quitDays, quitKeptDays, slipCount, slipDays, focusMinutesOn, goalCurrent, isTimeFed, habitFrequencyLabel, habitTarget, countIn, countTarget, habitCountOn, habitGate, habitLocked, isCounted, COUNT_PERIODS, requiredSteps, routineComplete, routineProgress, routineRunsOn, slotMinutes, stepLocked, TYPING_TARGET_WPM, type AgendaEvent, type GoalCategory, type GoalTimeframe, type Goal, type GoalMilestone, type HabitDef, type HabitFrequency, type CountPeriod, type HabitKind, type Routine, type RoutineCadence, type SpaceId, type SubTask, type Task, type TaskCategory, type TimeSlot } from './types'
import { WeekStrip } from './dayface'
import { useFirstMove, useOpenToday } from './ui'
import { estimateFor } from './estimate'
import { estimateTask } from './ai'
import { goalPeriodKey, goalPeriodRange, habitPeriodRange, periodIsPast, periodKeyFor, periodLabel, shiftPeriodKey, type GoalTf, fmtDuration, fmtNum, fmtSigned, goalPace, fmtTime, fmtTimeShort, fmtWhen, dayOfWeekKey, gcalUrl, isEstimated, localDateKey, slotForMoment, taskMinutes, toMin } from './util'

/* The shared primitives live in ui.tsx now, the app's one component location.
   Imported and re-exported here so older call sites keep working while they are
   moved over; new code imports from './ui'. */
import { AutoTextarea, Band, Chip, Dropdown, Empty, SectionHead, Segmented, Select, SpaceMark, WriteTo } from './ui'
export { AutoTextarea, Band, Dropdown, SpaceMark, WriteTo }

/* Page helpers, not primitives: these read the mock agenda and this app's own
   idea of what "yesterday" means, so they belong to the pages that ask. */
/* The line at the top of Today. It reads the SAME feed the calendar widget
   reads, so the header and the tile can never disagree about what is next.
   It used to read MOCK_AGENDA, which is empty for every workspace, so it has
   said "none today" every day since it was written. */
function useNextEvent(): { v: string; k: string } {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => tick((x) => x + 1), 30_000)
    return () => window.clearInterval(t)
  }, [])
  const { state } = useCalendar()
  if (state.status !== 'ok') return { v: 'none today', k: 'next event' }
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const todays = state.events.filter((e) => e.day === localDateKey() && e.start !== null)
  const ongoing = todays.find((e) => (e.start as number) <= nowMin && nowMin < (e.end ?? e.start as number))
  if (ongoing) return { v: `${ongoing.title.split(':')[0]} until ${hm(ongoing.end ?? ongoing.start as number)}`, k: 'now' }
  const next = todays.find((e) => (e.start as number) > nowMin)
  if (!next) return { v: 'none today', k: 'next event' }
  return { v: `${hm(next.start as number)} ${next.title.split(':')[0]}`, k: 'next event' }
}

/** Yesterday's date. Stepping the calendar day, not subtracting 24 hours, so
 *  the clocks changing does not land it on the wrong day twice a year. */
const prevDay = (): string => dayPlus(-1)

/** Tomorrow's date, stepped the same careful way. */
const nextDay = (): string => dayPlus(1)

/** Any date `n` days from today, local calendar, careful about DST and month
 *  ends the same way every other date arithmetic in this file already is. */
function dayPlus(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return localDateKey(d)
}

/** How far he can step the day panel forward: today plus this many days. His
 *  ask, 2026-08-28: "instead of today, tomorrow... it would show... seven
 *  days ahead." Today is the first of the seven, so six more follow it. */
const PLAN_AHEAD_DAYS = 6

/** What the week card's ring calls a full day: four hours planned, the same
 *  reachable shape the momentum work on Timeline settled on rather than a
 *  number invented fresh here. */
const WEEK_CAPACITY_MIN = 240

const dateLine = () =>
  new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

/** 'Mon 3 Aug' for a date key, for the head of the day being planned. */
const shortDay = (key: string): string => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

/** 'Friday, 28 August', for the title of the day panel. He asked (2026-08-28)
 *  for the date OUT of the day switcher's own header and onto the page title
 *  instead, in words rather than the switcher's short numerals. */
const longDay = (key: string): string => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

/** 'Mon 24 – Sun 30 Aug', or 'Mon 31 Aug – Sun 6 Sep' across a month end: the
 *  month is dropped from the first date only when it would just repeat the
 *  second one right next to it. */
const weekRangeLabel = (from: string, to: string): string => {
  const [, fm] = from.split('-')
  const [, tm] = to.split('-')
  const first = shortDay(from)
  return `${fm === tm ? first.replace(/ \w+$/, '') : first} – ${shortDay(to)}`
}

/** 'Today', 'Tomorrow', or 'Fri': the word for a pill in the day switcher. */
const offsetWord = (n: number): string => {
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  const [y, m, d] = dayPlus(n).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short' })
}
/** The date under the word, blank for Today/Tomorrow where the word already
 *  says enough and a number under it would be noise. */
const offsetDate = (n: number): string => {
  if (n <= 1) return ''
  const [, , d] = dayPlus(n).split('-')
  return String(Number(d))
}


/* ---------------- TODAY ---------------- */

export function TodayPage() {
  const nextEvent = useNextEvent()
  const open = useOpenToday()

  /* One surface. The paper widget grid that used to sit under the room is gone,
     and so are its Edit grid and Add widget buttons.

     It was not a styling problem. NOW repeated the countdown, the date and the
     week; DUE TODAY repeated On the clock; HABITS and GOALS repeated the two
     figures at the bottom of the room. Michael, seeing it: "why did you not
     redesign this". He was right, and I had already spotted it and handed the
     decision back to him instead of making it. Habits, goals and the week are
     inside the room now, in the room's language, each said once. */
  return (
    <div className="page">
      <Band
        title="Today"
        metrics={[
          { v: nextEvent.v, k: nextEvent.k, tone: 'info' as const },
          { v: String(open.length), k: 'tasks open' },
        ]}
      />
      <TodayRoom />
    </div>
  )
}

/* Uses the shared Sheet so it inherits Escape-to-close, the way every other
   dialog in the app behaves. */
function AddWidgetInline({ onClose }: { onClose: () => void }) {
  const { spaces, space, addWidget, inView } = useStore()
  const present = new Set(spaces[space].map((w) => w.type))
  return (
    <Sheet
      title="Add a widget"
      onClose={onClose}
    >
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
    </Sheet>
  )
}

import { WIDGET_DEFS } from './mock'
import * as Icon from './icons'
import { TodayRoom } from './todayroom'
const WIDGET_DEFS_LIST = WIDGET_DEFS

/* ---------------- PLAN ---------------- */

const HOUR_PX = 42             // tall enough that a 30-minute block fits its own label
/* The whole day, midnight to midnight. He wants to see the full day, not a
   window I decided was the interesting part of it. */
const START_H = 0
const END_H = 24

/** The task/event name IS the link; clicking opens (or schedules) it in Google Calendar. */
function TaskName({ title, start, end, className }: { title: string; start?: string; end?: string; className?: string }) {
  return (
    <a className={`task-link${className ? ' ' + className : ''}`} href={gcalUrl(title, start, end)} target="_blank" rel="noreferrer" title="Open in Google Calendar">
      {title}
    </a>
  )
}

/** 'HH:MM' for a pixel offset down the day, snapped to the nearest quarter hour. */
function timeAtOffset(px: number): string {
  const mins = Math.round(((px / HOUR_PX) * 60) / 15) * 15 + START_H * 60
  const clamped = Math.max(START_H * 60, Math.min(END_H * 60 - 15, mins))
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`
}

/** Vertical day timeline: calendar events plus any task pinned to a clock time. Full height, no inner scroll. */
export function Schedule({ events, tasks, onDropAt }: { events: AgendaEvent[]; tasks: Task[]; onDropAt: (id: string, at: string) => void }) {
  const { setTaskAt, inView } = useStore()
  const pinned = tasks.filter((t) => t.at && !t.done)
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
  const startH = START_H
  const endH = END_H
  const DAY_START = startH * 60
  const hours = endH - startH
  const height = hours * HOUR_PX
  const y = (hhmm: string) => ((toMin(hhmm) - DAY_START) / 60) * HOUR_PX
  // Where the drop would land, shown as a line while you drag over the day.
  const [hoverAt, setHoverAt] = useState<string | null>(null)
  const offsetIn = (e: React.DragEvent<HTMLDivElement>) =>
    e.clientY - e.currentTarget.getBoundingClientRect().top
  return (
    <div className="vsched">
      <div
        className="vsched-inner"
        style={{ height }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setHoverAt(timeAtOffset(offsetIn(e))) }}
        onDragLeave={() => setHoverAt(null)}
        onDrop={(e) => {
          e.preventDefault()
          const id = e.dataTransfer.getData('text/plain')
          if (id) onDropAt(id, timeAtOffset(offsetIn(e)))
          setHoverAt(null)
        }}
      >
        {hoverAt && (
          <div className="vdrop" style={{ top: y(hoverAt) }} aria-hidden="true">
            <span className="vdrop-label mono">{fmtTime(hoverAt)}</span>
          </div>
        )}
        {Array.from({ length: hours + 1 }, (_, i) => {
          const h = startH + i
          return (
            <div key={h} className="hline" style={{ top: i * HOUR_PX }}>
              {h % 2 === 0 && h < 24 && <span className="hlabel">{fmtTimeShort(`${h}:00`)}</span>}
            </div>
          )
        })}
        {nowMin >= DAY_START && nowMin <= endH * 60 && (
          <div className="vnow" style={{ top: ((nowMin - DAY_START) / 60) * HOUR_PX }} aria-hidden="true">
            <span className="vnow-dot" /><span className="vnow-label mono">now</span>
          </div>
        )}
        {events.map((e) => (
          <div className="vev vev-cal" key={e.id} style={{ top: y(e.start) + 1, height: Math.max(((toMin(e.end) - toMin(e.start)) / 60) * HOUR_PX - 2, 42) }}>
            <TaskName title={e.title} start={e.start} end={e.end} className="t" />
            <span className="rng">{fmtTime(e.start)} – {fmtTime(e.end)}</span>
          </div>
        ))}
        {pinned.map((t) => (
          <div
            className="vev vev-task" key={t.id} draggable
            onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move' }}
            style={{ top: y(t.at!) + 1, height: Math.max((taskMinutes(t) / 60) * HOUR_PX - 2, 42) }}
          >
            <TaskName title={t.title} start={t.at} className="t" />
            <span className="rng">{fmtTime(t.at!)} · task</span>
            <button className="vev-x" aria-label={`Take ${t.title} off the clock`} onClick={() => setTaskAt(t.id, undefined)}>✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}

/* Each part of the day says WHICH hours it means, in the header, because
   "Morning" answers nothing about where 12:30 goes. */
const BUCKET_HINT: Record<string, string> = Object.fromEntries(SLOTS.map((s) => [s.id, s.hint]))
const BUCKETS: { id: TimeSlot | 'unsorted'; label: string }[] = [
  { id: 'unsorted', label: 'Unsorted' },
  ...SLOTS.map((s) => ({ id: s.id, label: s.label })),
]

/* A generated breakdown is a draft. The wording is the model's, the minutes are
   a guess, and sometimes a step is simply not his, so every one of them can be
   rewritten, re-estimated or thrown away. */
/* Edit or drop one step, from wherever it is shown. The list had this and the
   day did not, which is backwards: the day is where he finds out the number was
   wrong. Opens in place, saves on Enter or on Save, Escape puts it back. */
function SubEdit({ taskId, sub }: { taskId: string; sub: SubTask }) {
  const { updateSubtask, deleteSubtask } = useStore()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(sub.title)
  const [mins, setMins] = useState(String(sub.estimateMin))
  const save = () => {
    updateSubtask(taskId, sub.id, { title: title.trim() || sub.title, estimateMin: Number(mins) || sub.estimateMin })
    setEditing(false)
  }
  const cancel = () => { setTitle(sub.title); setMins(String(sub.estimateMin)); setEditing(false) }
  if (!editing) {
    return (
      <span className="sub-tools">
        <button className="sub-tool" aria-label={`Edit step: ${sub.title}`} onClick={() => setEditing(true)}>Edit</button>
        <button className="sub-tool" aria-label={`Remove step: ${sub.title}`} onClick={() => deleteSubtask(taskId, sub.id)}>Remove</button>
      </span>
    )
  }
  return (
    <div className="subtask-row is-editing" style={{ flex: '1 0 100%' }}>
      <input className="textinput sub-edit-title" value={title} autoFocus
        aria-label={`Step title: ${sub.title}`}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }} />
      <input className="textinput sub-edit-min mono" type="number" min={1} max={480} value={mins}
        aria-label={`Minutes for ${sub.title}`}
        onChange={(e) => setMins(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }} />
      <button className="btn btn-primary sub-btn" onClick={save}>Save</button>
    </div>
  )
}

function SubtaskRow({ taskId, sub }: { taskId: string; sub: SubTask }) {
  const { updateSubtask, deleteSubtask } = useStore()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(sub.title)
  const [mins, setMins] = useState(String(sub.estimateMin))

  const save = () => {
    const t = title.trim()
    // An empty title would leave a row with nothing in it; keep the old one.
    updateSubtask(taskId, sub.id, { title: t || sub.title, estimateMin: Number(mins) || sub.estimateMin })
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="subtask-row is-editing">
        <input className="textinput sub-edit-title" value={title} autoFocus aria-label="Step name" autoComplete="off"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setTitle(sub.title); setMins(String(sub.estimateMin)); setEditing(false) } }} />
        <input className="textinput sub-edit-min mono" type="number" inputMode="numeric" min={1} max={480} value={mins} aria-label="Minutes for this step"
          onChange={(e) => setMins(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
        <button className="btn btn-primary sub-btn" onClick={save}>Save</button>
      </div>
    )
  }
  /* Finished stays finished here. This row drew every step the same way, so a
     task sent back to the list showed work he had already done as untouched:
     the record was intact, the page simply refused to say so. */
  return (
    <div className={`subtask-row${sub.done ? ' is-done' : ''}`}>
      <span className="sub-tick" aria-hidden="true" />
      <span className="grow" style={{ fontSize: 'var(--text-sm)' }}><Linkify text={sub.title} /></span>
      <span className="chip tone-info">{sub.done && sub.actualMin != null ? `${fmtDuration(sub.actualMin)} taken` : fmtDuration(sub.estimateMin)}</span>
      <span className="sub-tools">
        <button className="sub-tool" aria-label={`Edit step: ${sub.title}`} onClick={() => setEditing(true)}>Edit</button>
        <button className="sub-tool" aria-label={`Remove step: ${sub.title}`} onClick={() => deleteSubtask(taskId, sub.id)}>Remove</button>
      </span>
    </div>
  )
}

/* Editing what a task says and how big it claims to be. Everything on the list
   is his, generated or typed, so every row can be corrected without a detour
   through delete-and-retype. */
function EditTaskSheet({ task, onClose }: { task: Task; onClose: () => void }) {
  const { updateTask } = useStore()
  const [title, setTitle] = useState(task.title)
  /* Only the words. The minutes already have a home of their own, on the
     estimate chip and on each step, and a second door to the same number is
     how two numbers disagree. */
  const save = () => {
    updateTask(task.id, { title })
    onClose()
  }
  return (
    <Sheet title="Edit this task" onClose={onClose}>
      <label className="field-label" htmlFor="et-title">What is it?</label>
      <input id="et-title" className="textinput" style={{ width: '100%' }} value={title} autoFocus
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) save() }} />
      <div className="sheet-actions">
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!title.trim()} onClick={save}>Save changes</button>
      </div>
    </Sheet>
  )
}

/** Inline "how long did it take?" logger shown when you finish a task or subtask.
 *  Also used by the assistant, under its own "Done: X" line, so this is the one
 *  place that ever asks the question -- not a second version of it there. */
export function ActualLog({ est, tracked, onLog, onSkip }: { est: number; tracked?: number | null; onLog: (m: number) => void; onSkip: () => void }) {
  const [custom, setCustom] = useState('')
  /* The timer already knows. Guesses off the estimate were the only offer here,
     so a block plus the ten minutes he extended it by got thrown away the moment
     he tapped "45m", and the day's saved-time went back to being fiction. What
     was actually clocked comes first, and it counts every block on this task
     today, extensions included. */
  const chips = Array.from(new Set([Math.max(1, Math.round(est / 2)), est, est * 2])).filter((m) => m !== tracked)
  return (
    <div className="actual-log" role="group" aria-label="How long did it take?">
      <span className="actual-log-q">How long?</span>
      {tracked ? (
        <button className="actual-chip is-tracked" onClick={() => onLog(tracked)}>
          {fmtDuration(tracked)} <span className="mono">tracked</span>
        </button>
      ) : null}
      {chips.map((m) => <button key={m} className="actual-chip" onClick={() => onLog(m)}>{m}m</button>)}
      <input
        className="actual-input" type="number" min={1} placeholder="min" value={custom}
        onChange={(e) => setCustom(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && Number(custom) > 0) onLog(Number(custom)) }}
        aria-label="Custom minutes"
      />
      <button className="actual-skip" onClick={onSkip}>skip</button>
    </div>
  )
}


/** The week card's load ring: a plain stroke circle with an accent arc laid
 *  over it for the share of a full day that is planned. Radius and stroke
 *  scale with the ring's own box so one component serves every card size. */
function WeekRing({ pct, size = 34 }: { pct: number; size?: number }) {
  const sw = Math.max(3, Math.round(size * 0.12))
  const r = size / 2 - sw
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--wk-line-2)" strokeWidth={sw} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--wk-hot)" strokeWidth={sw}
        strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  )
}

/* The estimate is a number you can argue with. Click it and type your own; the
   generated one is a starting point, not a verdict. */
function EstimateChip({ task }: { task: Task }) {
  const { setEstimate, inView } = useStore()
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState('')
  const fromSteps = !!task.subtasks?.length
  const mins = taskMinutes(task)

  if (editing) {
    const commit = () => {
      const n = Math.round(Number(val))
      if (Number.isFinite(n) && n > 0) setEstimate(task.id, n)
      setEditing(false)
    }
    return (
      <input
        className="est-input" type="number" min={1} autoFocus value={val}
        aria-label={`Minutes for ${task.title}`}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
      />
    )
  }
  if (fromSteps) return <span className="chip tone-info" title="Comes from the steps">{fmtDuration(mins)}</span>
  return (
    <button
      className={`chip tone-info est-edit${isEstimated(task) ? '' : ' is-none'}`}
      title="Click to set the minutes yourself"
      aria-label={isEstimated(task) ? `${mins} minutes, click to change` : `No estimate, click to set one`}
      onClick={() => { setVal(isEstimated(task) ? String(mins) : ''); setEditing(true) }}
    >
      {isEstimated(task) ? fmtDuration(mins) : 'no estimate'}
    </button>
  )
}

/* Breaking a task down and estimating it are actions on the task itself. */
function TaskActions({ task, onFocus }: { task: Task; onFocus?: () => void }) {
  const { setEstimate, inView } = useStore()
  const hasSubs = !!task.subtasks?.length
  const [thinking, setThinking] = useState(false)
  /* The AI reads the task; the local rule of thumb only catches the fall. A
     flat default dressed as an estimate taught him to ignore the button. */
  const estimate = async () => {
    if (thinking) return
    setThinking(true)
    try {
      const ai = await estimateTask(task.title, task.category)
      setEstimate(task.id, ai ?? estimateFor(task.title, task.category).minutes)
    } finally { setThinking(false) }
  }
  return (
    <span className="task-actions">
      {onFocus && (
        <button
          className="task-act task-focus"
          disabled={!isEstimated(task)}
          aria-label={isEstimated(task) ? `Focus on ${task.title} for ${taskMinutes(task)} minutes` : `Estimate ${task.title} before starting a focus block`}
          title={isEstimated(task) ? `Focus ${taskMinutes(task)}m on this` : 'Estimate it first'}
          onClick={onFocus}
        >
          <Icon.Play size={18} />
        </button>
      )}
      <button
        className="task-act"
        disabled={hasSubs}
        aria-label={hasSubs ? `${task.title} takes its estimate from its steps` : `Estimate how long ${task.title} takes`}
        title={hasSubs ? 'Estimate comes from the steps' : 'Estimate the time'}
        onClick={estimate}
      >
        {thinking
          ? <span className="est-thinking" aria-label="Estimating" />
          : (
            <Icon.Hourglass size={18} />
          )}
      </button>
    </span>
  )
}

/* A routine standing on the day's list. It is DERIVED from the routine, never a
   copy of it: a copied task would drift the moment either side changed, and the
   whole point is that finishing it here and finishing it on Routines are the
   same act. Its steps are the subtasks. */
/* A routine standing on the day's list. It is a task row, not a species of its
   own: same checkbox, same title, same expander, same menu. The only thing that
   marks it out is a small "repeats" tag, because a different layout for the same
   kind of thing reads as two different apps on one page. */
function RoutineOnDay({ routine, day }: { routine: Routine; day?: string }) {
  const { toggleRoutineStep, toggleRoutineAlt, setRoutineDone, planRoutine, setPage, inView, habits, stepLog } = useStore()
  const [open, setOpen] = useState(false)
  // Counts what the routine needs, so an optional step neither pads the total
  // nor keeps a finished routine one short of it.
  const { done, total } = routineProgress(routine)
  const complete = routineComplete(routine, periodKeyFor(routine.cadence))
  /* Every step is a habit now, and the gate lives on the habit, not on the
     routine's own stepData: that field stopped being written the day logging
     the number moved to the Habits page, so reading it here would have shown
     the typing step locked forever, passed or not. */
  const stepGated = (stepId: string): boolean => {
    const h = habits.find((x) => x.id === (routine.steps.find((s) => s.id === stepId)?.habitId ?? `h-${routine.id}-${stepId}`))
    return !!h && habitLocked(h, stepLog, localDateKey())
  }
  const gated = !complete && routine.steps.some((st) => !routine.doneStepIds.includes(st.id) && stepGated(st.id))

  return (
    <div className="today-item">
      <div className={`today-task${complete ? ' done' : ''}`}>
        {/* A routine is not dragged into a time, but its checkbox still has to
            line up with the ones under it. */}
        <span className="drag-grip is-blank" aria-hidden="true"><Icon.Grip /></span>
        <SpaceMark space={routine.space} />
        <button
          className="checkbox"
          role="checkbox"
          aria-checked={complete}
          disabled={total === 0 || gated}
          aria-label={complete ? `Reopen: ${routine.title}` : `Finish: ${routine.title}`}
          title={total === 0
            ? 'Write its steps first'
            : gated
              ? `Open it in Habits: one step has to be earned, not ticked (${TYPING_TARGET_WPM} WPM)`
              : undefined}
          onClick={() => setRoutineDone(routine.id, !complete)}
        >
          <Icon.Check size={12} strokeWidth={4} />
        </button>
        <span className="grow wrap2">{routine.title}</span>
        {/* One tag, saying the one thing it needs to: this is a routine, it put
            itself here. Cadence words were never asked for. */}
        <span className="repeat-tag">routine</span>
        {total > 0 && (
          <button className="expand-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Collapse steps' : 'Expand steps'}>
            {open ? '▾' : '▸'} {done}/{total}
          </button>
        )}
        <Dropdown label={`Options for ${routine.title}`}>
          {/* Moving it is the same menu as putting it here in the first place,
              so a routine can be planned into the evening and then pulled
              forward without leaving the day. */}
          {SLOTS.filter((s) => s.id !== routine.planned?.slot).map((s) => (
            <button key={s.id} role="menuitem" onClick={() => planRoutine(routine.id, s.id, day)}>Move to {s.label.toLowerCase()}</button>
          ))}
          <span className="kebab-sep" />
          <button role="menuitem" onClick={() => setPage('habits')}>Open in Habits</button>
          {routine.planned && !routine.startedAt && (
            <button role="menuitem" onClick={() => planRoutine(routine.id)}>Take it off</button>
          )}
        </Dropdown>
      </div>

      {total === 0 && (
        <p className="rod-empty">
          No steps yet.{' '}
          <button className="rod-link" onClick={() => setPage('habits')}>Write them</button>
        </p>
      )}

      {open && total > 0 && (
        <div className="subtask-list">
          {routine.steps.map((s) => {
            const checked = routine.doneStepIds.includes(s.id)
            const locked = !checked && stepGated(s.id)
            /* A step with a choice is ticked by picking one of its answers, so
               here it offers the answers instead of a checkbox that would have
               to guess which one he meant. */
            if (s.alts?.length) {
              return (
                <div key={s.id} className="subtask-wrap">
                  {s.alts.map((a) => {
                    const picked = routine.stepChoice?.[s.id] === a.id
                    return (
                      <button
                        key={a.id}
                        className={`subtask alt${picked ? ' done' : ''}`}
                        onClick={() => toggleRoutineAlt(routine.id, s.id, a.id)}
                      >
                        <span className="sub-tick" aria-hidden="true" />
                        <span className="grow">{a.title}</span>
                      </button>
                    )
                  })}
                </div>
              )
            }
            return (
              <div key={s.id} className="subtask-wrap">
                <button
                  className={`subtask${checked ? ' done' : ''}`}
                  disabled={locked}
                  title={locked ? `Open this in Habits and log ${TYPING_TARGET_WPM} WPM to check it off` : undefined}
                  onClick={() => (locked ? setPage('habits') : toggleRoutineStep(routine.id, s.id))}
                >
                  <span className="sub-tick" aria-hidden="true" />
                  <span className="grow">{s.title}</span>
                  {s.optional && <span className="step-optional mono">optional</span>}
                  {locked && <span className="rod-locked mono">{TYPING_TARGET_WPM} WPM to pass</span>}
                </button>
              </div>
            )
          })}
        </div>
      )}

    </div>
  )
}

export function PlanPage() {
  const todayIdx = (new Date().getDay() + 6) % 7
  const pomo = usePomodoro()
  const { startFocus } = pomo
  const { routines, habits } = useStore()
  const { space, tasks, toggleTask, logActual, assignSlot, toggleSubtask, logSubtaskActual, moveTasksToToday, moveTaskList, deleteTask, addTask, addTaskWithSubtasks, focusTaskId, setFocusTaskId, setTaskAt, plan, setPage, openDay, view, inView, focusSessions } = useStore()

  const spaceTasks = tasks.filter((t) => inView(t.space))
  const backlogOpen = spaceTasks.filter((t) => !t.done && t.list === 'backlog') // the to-do pool
  /* In All the three rooms would otherwise interleave into one undifferentiated
     pile. Grouped by room, in the order of the switcher above, so the list reads
     the same way the app is laid out. In a single room there is nothing to
     group, so his own order is left alone. */
  /* Newest first, full stop. His words: "every time I add something new into
     the to-do list, it should be the first item, based on time added."

     Two things used to push a new task down the page and both are gone. Work
     carried over from a planned day was hoisted above everything, so anything
     added today landed underneath it, which is the "somewhere in the middle"
     he saw. And in All view the list was then sorted by workspace, so where a
     new task appeared depended on which room it belonged to, which is the
     "random" one. The carried count is still on the row, because that fact is
     worth having; it just no longer decides the order.

     addedAt is a real timestamp. Tasks from before it existed have none, sort
     as 0, and keep their existing order below anything newly added, which is
     already newest-first because the store prepends. */
  const backlogSorted = [...backlogOpen].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
  /* Which day the right hand column is laying out. This used to be a single
     step, today or tomorrow, on the argument that Sunday evening is exactly
     when a week gets planned and Monday could not be touched until Monday. He
     asked for the rest of the week the same way (2026-08-28): PLAN_AHEAD_DAYS
     more days he can step onto and lay out, one at a time, the same panel he
     already knows. offset 0 is today, 1 is tomorrow, up to 6 days out. */
  const [dayOffset, setDayOffset] = useState(0)
  const planDay = dayPlus(dayOffset)
  const onDay = (t: Task) => t.list === 'today' && (t.plannedOn ?? localDateKey()) === planDay
  const todayAll = spaceTasks.filter(onDay)                      // the day incl. finished (they stay, struck)
  const todayTasks = todayAll.filter((t) => !t.done)             // still to do
  const doneUnsorted = todayAll.filter((t) => t.done && !t.slot) // finished, never scheduled

  /* A routine reaches the day by being started, not by existing. Until he ticks
     his first step it lives on the Routines page only, so Today opens as the
     work he chose rather than a wall of things the app put there. The moment it
     starts it files itself under the time he started it: this list is a record
     of the day, not a plan for it. */
  /* A day ahead's weekend is not today's: planning a Friday from a Tuesday must
     not hide the work routines it is planning. */
  const dayIdx = (todayIdx + dayOffset) % 7
  const isWeekend = dayIdx >= 5
  const today = localDateKey()
  const ahead = dayOffset > 0
  /* Started counts as on today only. A routine cannot have been started on a day
     that has not happened, so a day ahead shows exactly what he has planned
     onto it.

     "Started" has to mean started TODAY, not merely started at some point in
     the period still running. This read `!!r.startedAt`, and startedAt is only
     cleared when the PERIOD rolls over, which for a monthly routine is the
     turn of the month. So the Monthly review, begun once on an afternoon, sat
     on every single day for the rest of that month, in the slot matching the
     hour it was first opened, already finished, and "Take it off" could not
     shift it because that only clears `planned`. His report, exactly. */
  const startedOn = (r: Routine) => (r.startedAt ? localDateKey(new Date(r.startedAt)) : null)
  const onToday = (r: Routine) => (ahead
    ? r.planned?.day === planDay
    : (startedOn(r) === planDay || r.planned?.day === planDay))
  const dueRoutines = routines.filter((r) => inView(r.space) && !r.archivedAt && onToday(r) && !(r.cadence === 'prework' && isWeekend))
  /* A slot he chose wins over the clock: planning it for the evening and
     starting it early should not throw it back to the morning while he is
     looking at it. */
  const routineSlot = (r: Routine): TimeSlot | 'unsorted' =>
    r.planned?.day === planDay && r.planned.slot ? r.planned.slot
      : (!ahead && r.startedAt) ? slotForMoment(r.startedAt) : 'unsorted'
  const plannedMin = todayTasks.reduce((a, t) => a + taskMinutes(t), 0)

  /* Progress counts everything in the space, today included, and counts finished
     SUBTASK minutes too, so a task that is two thirds done moves the bar instead
     of reading as zero until the last step lands. */
  const pool = spaceTasks
  const totalMin = pool.reduce((a, t) => a + taskMinutes(t), 0)
  const doneMin = pool.reduce((a, t) => {
    if (t.done) return a + taskMinutes(t)
    return a + (t.subtasks?.filter((s) => s.done).reduce((x, s) => x + s.estimateMin, 0) ?? 0)
  }, 0)
  const doneCount = pool.filter((t) => t.done).length
  const donePct = totalMin ? Math.round((doneMin / totalMin) * 100) : 0

  /* Time saved today: estimate minus what it actually took. A task finished
     through the focus timer never had its minutes typed in, so its focus blocks
     ARE its actual; without that, an hour of overrun quietly vanished from the
     number and "saved" read positive on a day that ran long. */
  /* Every block clocked against this title today, plus the one still running if
     it carries the same name. A block finished and then extended is two rows,
     so this has to add them up rather than read the last one. */
  const trackedFor = (title: string) => {
    const want = title.trim().toLowerCase()
    const logged = focusSessions
      .filter((f) => f.day === localDateKey() && (f.label ?? '').trim().toLowerCase() === want && inView(f.space))
      .reduce((a, f) => a + f.minutes, 0)
    const live = pomo.phase === 'focus' && (pomo.focusLabel ?? '').trim().toLowerCase() === want
      ? Math.max(0, Math.floor((pomo.blockMin * 60 - pomo.secondsLeft) / 60))
      : 0
    const mins = logged + live
    return mins > 0 ? mins : null
  }
  const focusActual = (t: Task) => trackedFor(t.title)
  const actualOf = (t: Task) => t.actualMin ?? (t.done ? focusActual(t) : null)
  const loggedAny = todayAll.some((t) => actualOf(t) != null || t.subtasks?.some((x) => x.actualMin != null))
  const savedToday = todayAll.reduce((acc, t) => {
    if (t.subtasks?.length) return acc + t.subtasks.reduce((a, x) => a + (x.done && x.actualMin != null ? x.estimateMin - x.actualMin : 0), 0)
    const actual = actualOf(t)
    return acc + (t.done && actual != null ? t.estimateMin - actual : 0)
  }, 0)

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [dropKey, setDropKey] = useState<string | null>(null)
  /* DRAG A TASK, HOVER A DAY, IT OPENS ITSELF. His ask, 2026-08-29: sorting a
     few tasks across a few days meant a full click-drag-click-drag lap per
     task, because the only way onto Wednesday was to click its pill BEFORE
     picking the task up. Now the pill itself is a target: hold a drag over it
     for a second and this panel steps onto that day without letting go of
     what he is carrying, the same "spring-loaded folder" a file manager does.
     A plain click still switches instantly; this is additive, not a
     replacement. Touch has no drag to hover with, so it keeps the "Plan for a
     day" kebab shortcut built the same day. */
  const [armingDay, setArmingDay] = useState<number | null>(null)
  const armTimer = useRef<number | null>(null)
  const clearArm = () => {
    if (armTimer.current != null) { window.clearTimeout(armTimer.current); armTimer.current = null }
    setArmingDay(null)
  }
  const armDay = (n: number) => {
    if (n === dayOffset) return                 // already standing on it
    if (armingDay === n) return                  // already counting down to it
    clearArm()
    setArmingDay(n)
    armTimer.current = window.setTimeout(() => { setDayOffset(n); clearArm() }, 1000)
  }
  /* A drag can end mid-air over the pill without a dragleave ever firing (he
     drops right there, or the browser cancels it), which would otherwise
     leave the countdown running for a switch nobody is dragging toward any
     more. One window listener catches every way a drag can end. */
  useEffect(() => {
    const onEnd = () => clearArm()
    window.addEventListener('dragend', onEnd)
    window.addEventListener('drop', onEnd)
    return () => { window.removeEventListener('dragend', onEnd); window.removeEventListener('drop', onEnd) }
  }, [])
  const [logging, setLogging] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [flashIds, setFlashIds] = useState<string[]>([])
  const [listDropOver, setListDropOver] = useState(false)
  const [quick, setQuick] = useState('')
  const [breakdownFor, setBreakdownFor] = useState<Task | null>(null)
  const [editingTask, setEditingTask] = useState<Task | null>(null)

  /* On a laptop the four parts of the day run well past the fold, so each part
     folds away and the whole set folds with one button. Which ones are shut is a
     view he set rather than something that happened to his data, so it lives in
     localStorage and never goes near the sync. */
  const [shutSlots, setShutSlots] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('mc:shut-slots')
      return new Set(raw ? (JSON.parse(raw) as string[]) : [])
    } catch { return new Set() }
  })
  const keepShut = (next: Set<string>) => {
    setShutSlots(next)
    try { localStorage.setItem('mc:shut-slots', JSON.stringify([...next])) } catch { /* private mode */ }
  }
  const setShut = (id: string, on: boolean) => {
    const next = new Set(shutSlots)
    if (on) next.add(id); else next.delete(id)
    keepShut(next)
  }

  /* The returned work that is still actually waiting ON THE LIST. The bar
     reads from this, so replanning, finishing or deleting the last of it takes
     the bar away with it. Without the list check, pressing Replan moved both
     tasks and left the bar claiming they were back on a list that read
     "Nothing waiting" right underneath. */
  const returnedLeft = (plan.returnedIds ?? []).filter((id) => {
    const t = tasks.find((x) => x.id === id)
    return !!t && !t.done && t.list === 'backlog'
  })

  /* "Show me" points at the work that came back overnight: scroll the list into
     view and mark those rows for a couple of seconds. */
  const showReturned = () => {
    const ids = returnedLeft
    setFlashIds(ids)
    const first = document.querySelector(`[data-todo-id="${ids[0]}"]`)
    ;(first ?? document.querySelector('.todo-col'))?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    window.setTimeout(() => setFlashIds([]), 2600)
  }

  /* Today's "Start" hands the task over here: flash it so the eye lands on it. */
  useEffect(() => {
    if (!focusTaskId) return
    setFlashId(focusTaskId)
    setFocusTaskId(null)
    const el = document.querySelector(`[data-task-id="${focusTaskId}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const timer = window.setTimeout(() => setFlashId(null), 2600)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTaskId])

  const toggleExp = (id: string) =>
    setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  const generate = () => {
    if (!goal.trim() || busy) return
    setBusy(true)
    window.setTimeout(() => {
      const steps = fakeDecompose(goal)
      addTaskWithSubtasks(
        { title: goal.trim(), source: 'mc', estimateMin: 0, space, list: 'backlog', category: 'deep' },
        steps.map((s) => ({ title: s.title, estimateMin: s.estimateMin })),
      )
      setGoal(''); setBusy(false)
    }, 750)
  }

  /* One drop handler for both directions: into a time bucket moves the task to
     today and slots it; onto the list sends it back to the backlog. */
  const dropTo = (key: TimeSlot | 'unsorted', id: string) => {
    const t = tasks.find((x) => x.id === id)
    // Onto the day being shown, which is not always today.
    if (t && (t.list !== 'today' || (t.plannedOn ?? localDateKey()) !== planDay)) moveTaskList(id, 'today', planDay)
    assignSlot(id, key === 'unsorted' ? undefined : key)
  }
  const dropToList = (id: string) => {
    const t = tasks.find((x) => x.id === id)
    if (!t || t.list === 'backlog') return
    moveTaskList(id, 'backlog')
    assignSlot(id, undefined)
  }

  /* THE WEEK, on his instruction (2026-08-28): not the seven days ahead of the
     switcher above, which follows him and always starts on whichever day he
     opens the app, but the calendar week he is actually standing in, Monday to
     Sunday, so a Wednesday still shows what Monday looked like. Its own state:
     it does not track dayOffset, and stepping it does not move the day panel.

     READ ONLY BY DESIGN. The day panel above is already the tool for placing a
     task into a time of day; asking this grid to be forty nine more drop zones
     would make one job two half-built tools instead of one whole one. A day's
     header is the one thing here that does anything: click it and the day
     panel steps onto that day if it can, or opens that day's record if it
     already happened. */
  const [weekShift, setWeekShift] = useState(0)
  /* Folded shut on load, every time: the week is context for the day he's
     planning, not the first thing the page shows. His own mockup put it
     right under the header, above the to-do list and day panel, collapsed
     to one bar until he opens it. */
  const [weekOpen, setWeekOpen] = useState(false)
  /* THE ALMANAC. He picked this shape from three variants shown as artifacts,
     2026-08-30: a card per day with a ring for how full it is and its tasks
     grouped into slot chips, over the flat hairline table it replaces. A
     density cap with a "show every task" switch shipped first, then came
     out again on his word: he always wants every task visible, so there is
     no toggle left to default shut. */
  const weekAnchor = dayPlus(weekShift * 7)
  const weekDays = Array.from({ length: 7 }, (_, i) => dayOfWeekKey(i, new Date(`${weekAnchor}T12:00:00`)))
  const weekTasks = spaceTasks.filter((t) => t.list === 'today')
  /* How far a date sits from today, so a click knows whether to step the day
     panel (it can reach today plus PLAN_AHEAD_DAYS) or open the record of a
     day already gone. */
  const daysOut = (iso: string) => Math.round(
    (new Date(`${iso}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000,
  )
  const jumpToDay = (iso: string) => {
    const out = daysOut(iso)
    if (out < 0) { openDay(iso); return }
    setDayOffset(Math.min(out, PLAN_AHEAD_DAYS))
    document.querySelector('.day-switch')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  return (
    <div className="page">
      <Band
        title={`Plan ${longDay(planDay)}`}
        metrics={[
          { v: fmtDuration(plannedMin), k: `planned ${dayOffset === 0 ? 'today' : offsetWord(dayOffset).toLowerCase()}`, tone: 'info' as const },
          { v: pool.length ? `${donePct}%` : '—', k: pool.length ? 'of planned time done' : 'no tasks yet', tone: (pool.length && donePct > 0 ? 'pos' : 'info') as 'pos' | 'info' },
          ...(loggedAny ? [{ v: savedToday >= 0 ? fmtSigned(savedToday) : fmtDuration(-savedToday), k: savedToday >= 0 ? 'saved today' : 'over your estimates', tone: (savedToday >= 0 ? 'pos' : 'urgent') as 'pos' | 'urgent' }] : []),
        ]}
        /* The way back into the record. Every day before this one is addressable
           from here, and from there one arrow at a time. */
        actions={<button className="btn btn-ghost" onClick={() => openDay(prevDay())}>Yesterday</button>}
      />
      {/* THE WEEK. Moved above the to-do list and day panel on his instruction
          (2026-08-31, from his own mockup): folded to one bar by default, the
          week is context for the day he's about to plan, not the first thing
          the page shows in full. */}
      <div className={`panel weekplan${weekOpen ? ' is-open' : ''}`}>
        {/* The whole bar opens AND closes it -- one handler, both directions.
            The nav row (This week / prev) stops its own clicks from reaching
            this so paging a week doesn't also fold the thing shut. */}
        {/* A div, not a button: it holds real <button> nav controls inside it,
            and a button cannot nest inside a button -- the browser would just
            close the outer one early and break the layout. role+tabIndex give
            it the same keyboard reach a button would have. */}
        <div
          className="weekplan-bar"
          role="button"
          tabIndex={0}
          aria-expanded={weekOpen}
          onClick={() => setWeekOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setWeekOpen((v) => !v) }
          }}
        >
          <span className="weekplan-title">
            <span className="microcap">The week</span>
            <span className="weekplan-range mono">{weekRangeLabel(weekDays[0], weekDays[6])}</span>
          </span>
          {/* His sentence, verbatim in shape, tightened in wording: "9hours and
              10 minutes" read as a typo more than a choice, and this app
              already spells every other duration as fmtDuration does (Band's
              own "9h 10m" sits three lines above this bar on the same page). */}
          <span className="weekplan-sentence">
            {todayTasks.length === 0 ? (
              'Nothing planned for today yet.'
            ) : (
              <>
                You have <strong>{todayTasks.length} {todayTasks.length === 1 ? 'task' : 'tasks'}</strong> planned
                for today, taking <strong>{fmtDuration(plannedMin)}</strong> of your day.
              </>
            )}
          </span>
          <span className="weekplan-nav" onClick={(e) => e.stopPropagation()}>
            {weekOpen && (
              <button className="wk-navbtn" aria-label="Previous week" onClick={() => setWeekShift((n) => n - 1)}>
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 L6 8 L10 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            )}
            {weekOpen && (
              <button
                className="wk-navbtn is-word"
                disabled={weekShift === 0}
                aria-current={weekShift === 0 ? 'true' : undefined}
                onClick={() => setWeekShift(0)}
              >
                This week
              </button>
            )}
            {/* Same slot, two jobs. Shut, it's a redundant affordance for what
                the whole bar already does -- his words, "more of a show off
                than functional". Open, it becomes the real next-week arrow,
                which is why the icon swaps from a down chevron to a right one
                the moment the fold opens. */}
            <button
              className="wk-navbtn weekplan-toggle"
              aria-label={weekOpen ? 'Next week' : 'Show the week'}
              onClick={() => (weekOpen ? setWeekShift((n) => n + 1) : setWeekOpen(true))}
            >
              {weekOpen ? (
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3 L10 8 L6 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6 L8 10 L13 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              )}
            </button>
          </span>
        </div>
        {/* A CSS grid-rows tween, not a max-height guess: it animates to
            however tall the real content is, at any density, instead of
            snapping open or stopping short. The grid itself stays mounted
            through both states so the tween always has something to measure
            and a click inside it can never bubble up to the bar and fold it
            shut -- only the bar's own onClick can do that. */}
        <div className="weekplan-collapse" aria-hidden={!weekOpen}>
        <div className="weekplan-collapse-inner">
        <div className="weekplan-grid">
          {weekDays.map((iso) => {
            const [, , dnum] = iso.split('-')
            const name = new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })
            const dayTasks = weekTasks.filter((t) => (t.plannedOn ?? today) === iso)
            const totalMin = dayTasks.filter((t) => !t.done).reduce((a, t) => a + taskMinutes(t), 0)
            const pct = Math.min(100, Math.round((totalMin / WEEK_CAPACITY_MIN) * 100))
            const out = daysOut(iso)
            /* Past days lose plannedOn on roll (see roll.ts), so their tasks
               drop out of dayTasks entirely once the day turns over. doneAt
               survives that sweep, so it's the only honest source left for
               what actually got finished that day -- and he wants the tasks
               themselves crossed out here, not a count standing in for them. */
            const doneItems = out < 0
              ? spaceTasks.filter((t) => t.done && t.doneAt?.slice(0, 10) === iso)
              : []
            const doneCount = doneItems.length
            const reachable = out >= 0 && out <= PLAN_AHEAD_DAYS
            /* Unsorted is a fifth group now, not a count he cannot read. His
               words: "it doesn't mean if it's unsorted... you still have to
               show" it. Same shape as the other four, same cap, first in the
               list the way the day panel above already orders its own BUCKETS.
               Done is the sixth, past days only, built from doneItems instead
               of dayTasks since roll.ts already emptied that for these days. */
            const groups = [{ id: 'unsorted', label: 'Unsorted' }, ...SLOTS].map((sl) => ({
              slot: sl,
              here: dayTasks.filter((t) => (sl.id === 'unsorted' ? !t.slot : t.slot === sl.id)),
            })).filter((g) => g.here.length)
            if (doneItems.length) groups.push({ slot: { id: 'done', label: 'Done' }, here: doneItems })
            return (
              <div className={`weekplan-day${iso === today ? ' is-today' : ''}${out < 0 ? ' is-past' : ''}`} key={iso}>
                <button
                  className="weekplan-daybtn"
                  onClick={() => jumpToDay(iso)}
                  title={reachable ? `Plan ${name} ${Number(dnum)}` : out < 0 ? `See ${name} ${Number(dnum)}` : undefined}
                >
                  <WeekRing pct={pct} />
                  <span className="weekplan-daylabel">
                    <span className="weekplan-dayname">{name}</span>
                    <span className="weekplan-daynum mono">{Number(dnum)}</span>
                  </span>
                  <span className="weekplan-daymeta mono">
                    {out < 0
                      ? (doneCount > 0 ? `${doneCount} done` : '—')
                      : (totalMin > 0 ? fmtDuration(totalMin) : '—')}
                  </span>
                </button>
                {groups.length ? groups.map(({ slot: sl, here }) => (
                  <div className="weekplan-slot" key={sl.id}>
                    <span className="weekplan-slotname">{sl.label}</span>
                    {here.map((t) => (
                      <span className={`weekplan-item${t.done ? ' is-done' : ''}`} key={t.id} title={t.title}>
                        <span className={`cat-dot ${t.category}`} aria-hidden="true" />
                        {t.title}
                      </span>
                    ))}
                  </div>
                )) : <span className="weekplan-empty">Nothing planned</span>}
              </div>
            )
          })}
        </div>
        </div>
        </div>
      </div>
      {/* What came back overnight. Said once, on the day it happened, with the
          count and a way to take it back in one move. The alternative was work
          quietly vanishing from the day, which is worse than a wall of it. */}
      {/* Counted live against the tasks themselves: the bar names unfinished
          work, so finishing it (or deleting it) takes the bar away. A banner
          about work already done is nagging, not information. */}
      {plan.returnedOn === localDateKey() && returnedLeft.length > 0 && (
        <div className="handoff">
          <span className="grow">
            {returnedLeft.length === 1
              ? '1 thing you did not finish is back on the list.'
              : `${returnedLeft.length} things you did not finish are back on the list.`}
          </span>
          <button className="btn btn-quiet" onClick={() => openDay(prevDay())}>See yesterday</button>
          {/* This used to route to Plan from Plan, which is nothing happening.
              It now finds them on the list and marks them for a moment. */}
          <button className="btn btn-quiet" onClick={showReturned}>Show me</button>
          {/* Re-choosing them is the point of the rollover; re-dragging them one
              by one is just its tax. One press puts all of them back on today,
              unsorted, still his to place. */}
          <button className="btn btn-primary" onClick={() => { moveTasksToToday(returnedLeft); setDayOffset(0) }}>
            Replan {returnedLeft.length === 1 ? 'it' : `all ${returnedLeft.length}`} for today
          </button>
        </div>
      )}

      {/* The hourly schedule lives on Calendar now; Plan is the list and the day. */}
      <div className="grid-3 plan-cols plan-two">
        {/* 1. To-do list: everything you added, any day. Drag out to plan it,
            drag back to take it off today. */}
        <div
          className={`panel todo-col${listDropOver ? ' drop-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setListDropOver(true) }}
          onDragLeave={() => setListDropOver(false)}
          onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) dropToList(id); setListDropOver(false) }}
        >
          {/* One line that says what the list holds and what is left. The bar
              and the bare "10 here" were three tellings of half a fact. */}
          <div className="col-head">
            <span className="microcap">To-do list</span>
            {/* This head counts what the list below it shows. The whole pool's
                "0 of 5 done" over "Nothing waiting" was two truths about two
                different lists wearing one label. */}
            <span className="col-tot mono">{(() => {
              const mins = backlogOpen.reduce((a, t) => a + taskMinutes(t), 0)
              // "4 waiting · 0m" read like a bug; no estimates, no duration.
              return `${backlogOpen.length} waiting${mins > 0 ? ` · ${fmtDuration(mins)}` : ''}`
            })()}</span>
          </div>
          {/* Add a task; breaking it down is an action on the task itself. */}
          <div className="formrow" style={{ marginBottom: 'var(--s2)' }}>
            <input
              className="textinput"
              placeholder="Add something to the list…"
              value={quick}
              onChange={(e) => setQuick(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && quick.trim()) { addTask({ title: quick.trim(), source: 'mc', estimateMin: 0, space, list: 'backlog', category: 'quick' }); setQuick('') } }}
              aria-label="New task"
            />
            <button className="btn btn-quiet" disabled={!quick.trim()} onClick={() => { addTask({ title: quick.trim(), source: 'mc', estimateMin: 0, space, list: 'backlog', category: 'quick' }); setQuick('') }}>Add</button>
          </div>
          {backlogSorted.map((t) => {
            const isExp = expanded.has(t.id)
            const hasSubs = !!t.subtasks?.length
            const doneSubs = t.subtasks?.filter((s) => s.done).length ?? 0
            return (
              <div className="todo-item" key={t.id} data-todo-id={t.id}>
                <div
                  className={`todo-row${flashIds.includes(t.id) ? ' flash' : ''}`}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move' }}
                >
                  <span className="drag-grip" aria-hidden="true"><Icon.Grip /></span>
                  <SpaceMark space={t.space} />
                  <span className={`cat-dot ${t.category}`} aria-hidden="true" />
                  <span className="grow"><Linkify text={t.title} /></span>
                  {(t.carried ?? 0) > 0 && (
                    <span className="carried-tag mono" title={`Planned and not finished on ${t.carried} ${t.carried === 1 ? 'day' : 'days'}`}>
                      {t.carried === 1 ? 'came back' : `came back ${t.carried}x`}
                    </span>
                  )}
                  <EstimateChip task={t} />
                  {hasSubs && (
                    <button className="expand-btn" aria-expanded={isExp} aria-label={isExp ? 'Collapse subtasks' : 'Expand subtasks'} onClick={() => toggleExp(t.id)}>
                      {isExp ? '▾' : '▸'} {doneSubs}/{t.subtasks!.length}
                    </button>
                  )}
                  <TaskActions task={t} />
                  <Dropdown label={`Options for ${t.title}`}>
                    <button role="menuitem" onClick={() => setEditingTask(t)}>Edit</button>
                    <button role="menuitem" onClick={() => setBreakdownFor(t)}>Break it down</button>
                    {/* One trip per day, not one trip to today plus a drag
                        for everything else. The seven-day picker below still
                        drags one task at a time; this is for choosing the
                        whole day at once. */}
                    <span className="kebab-head">Plan for a day</span>
                    {Array.from({ length: PLAN_AHEAD_DAYS + 1 }, (_, n) => n).map((n) => (
                      <button key={n} role="menuitem" onClick={() => { moveTasksToToday([t.id], dayPlus(n)); setDayOffset(n) }}>
                        Move to {n <= 1 ? offsetWord(n).toLowerCase() : shortDay(dayPlus(n))}
                      </button>
                    ))}
                    {/* Straight into a part of today: today-then-slot used to
                        be two separate trips through this same menu. */}
                    <span className="kebab-head">Straight into today</span>
                    {SLOTS.map((sl) => (
                      <button key={sl.id} role="menuitem" onClick={() => dropTo(sl.id, t.id)}>{sl.label}</button>
                    ))}
                    <span className="kebab-sep" />
                    <button role="menuitem" className="danger" onClick={() => deleteTask(t.id)}>Delete</button>
                  </Dropdown>
                </div>
                {hasSubs && isExp && (
                  <div className="subtask-list">
                    {t.subtasks!.map((s) => (
                      <SubtaskRow key={s.id} taskId={t.id} sub={s} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {backlogOpen.length === 0 && <div className="empty">Nothing waiting. Add the first task above.</div>}
        </div>

        {/* 2. The day: drag tasks from Unsorted into a time of day */}
        <div className="panel">
          <div className="col-head">
            {/* Which day this column lays out. Two days is the whole range: the
                one he is in, and the one he is about to be in. */}
            {/* Seven pills, not two. He asked (2026-08-28) to lay out a
                week ahead rather than only the day right in front of him: each
                one steps this same panel onto that day, the way Today and
                Tomorrow always did. */}
            <span className="day-switch" role="group" aria-label="Which day to plan">
              {Array.from({ length: PLAN_AHEAD_DAYS + 1 }, (_, n) => n).map((n) => (
                <button
                  key={n}
                  className={`microcap${armingDay === n ? ' is-arming' : ''}`}
                  aria-pressed={dayOffset === n}
                  onClick={() => setDayOffset(n)}
                  onDragEnter={() => armDay(n)}
                  onDragOver={(e) => e.preventDefault()}
                  onDragLeave={() => { if (armingDay === n) clearArm() }}
                >
                  {offsetWord(n)}{offsetDate(n) && <i>{offsetDate(n)}</i>}
                </button>
              ))}
            </span>
            {(() => {
              const shown = BUCKETS.filter((b) => b.id !== 'unsorted' || todayAll.some((t) => !t.slot && !t.done)).map((b) => b.id)
              const allShut = shown.length > 0 && shown.every((id) => shutSlots.has(id))
              return (
                <button
                  className="fold-all"
                  onClick={() => keepShut(allShut ? new Set() : new Set(shown))}
                >
                  {allShut ? 'Expand all' : 'Collapse all'}
                </button>
              )
            })()}
          </div>
          {BUCKETS.map((b) => {
            // A finished task is not waiting to be scheduled, so it drops out of
            // Unsorted and joins the done group at the bottom.
            const inBucket = todayAll.filter((t) => (t.slot ?? 'unsorted') === b.id && !(b.id === 'unsorted' && t.done))
            // Dayless routines get their own group above; they are not tasks
            // waiting to be dragged into a time.
            const mine = b.id === 'unsorted' ? [] : dueRoutines.filter((r) => routineSlot(r) === b.id)
            if (b.id === 'unsorted' && inBucket.length === 0) return null
            /* One ordered list: what is still to do first, his own work ahead of
               the repeats, and everything finished sunk to the bottom. A ticked
               task sitting between two open ones is the list telling him he has
               work above AND below something already handled. */
            const rDone = (r: Routine) => routineComplete(r, periodKeyFor(r.cadence))
            const items = [
              ...inBucket.filter((x) => !x.done).map((task) => ({ kind: 'task' as const, task })),
              ...mine.filter((r) => !rDone(r)).map((routine) => ({ kind: 'repeat' as const, routine })),
              ...inBucket.filter((x) => x.done).map((task) => ({ kind: 'task' as const, task })),
              ...mine.filter(rDone).map((routine) => ({ kind: 'repeat' as const, routine })),
            ]
            const tot = inBucket.filter((t) => !t.done).reduce((a, t) => a + taskMinutes(t), 0)
            /* Unsorted is not a part of the day and has no hours to run out of. */
            const cap = b.id === 'unsorted' ? 0 : slotMinutes(b.id as TimeSlot)
            const over = cap > 0 ? tot - cap : 0
            const shut = shutSlots.has(b.id)
            const left = inBucket.filter((x) => !x.done).length + mine.filter((r) => !rDone(r)).length
            return (
              <div
                className={`bucket drop-zone${dropKey === b.id ? ' drop-over' : ''}${shut ? ' is-shut' : ''}`}
                key={b.id}
                /* A task cannot be dropped into a part of the day he cannot see,
                   so hovering one open is the only honest thing to do. */
                onDragOver={(e) => { e.preventDefault(); setDropKey(b.id); if (shut) setShut(b.id, false) }}
                onDragLeave={() => setDropKey((k) => (k === b.id ? null : k))}
                onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) dropTo(b.id, id); setDropKey(null) }}
              >
                <button
                  className="bucket-head"
                  aria-expanded={!shut}
                  aria-label={`${b.label}, ${shut ? 'expand' : 'collapse'}`}
                  onClick={() => setShut(b.id, !shut)}
                >
                  <span className="fold-caret" aria-hidden="true" />
                  <span className="bucket-name">{b.label}</span>
                  {BUCKET_HINT[b.id] && <span className="bucket-hours mono">{BUCKET_HINT[b.id]}</span>}
                  {/* Shut, the rows are gone and the count is the only thing left
                      saying whether there is anything in there. */}
                  {shut && left > 0 && <span className="bucket-left mono">{left} left</span>}
                  {/* What is planned against what the window actually holds, for
                      THIS workspace only. Four hours of work in a two hour
                      window is not ambition, it is a day that was over before it
                      started, and the app knew both numbers all along. */}
                  {tot > 0 && (over > 0
                    ? (
                      <span className="tot mono is-over" title={`${fmtDuration(tot)} planned, ${fmtDuration(cap)} in this part of the day`}>
                        {fmtDuration(tot)} of {fmtDuration(cap)}
                        <b>{fmtDuration(over)} over</b>
                      </span>
                    )
                    : <span className="tot mono">{fmtDuration(tot)}</span>)}
                </button>
                {shut ? null : items.length === 0 ? (
                  <p className="empty is-boxed">Drop a task here.</p>
                ) : (
                  items.map((it) => {
                    if (it.kind === 'repeat') {
                      const r = it.routine
                      return <RoutineOnDay key={r.id} routine={r} day={planDay} />
                    }
                    const t = it.task
                    const isExp = expanded.has(t.id)
                    const hasSubs = !!t.subtasks?.length
                    const doneSubs = t.subtasks?.filter((s) => s.done).length ?? 0
                    return (
                      <div className="today-item" key={t.id} data-task-id={t.id}>
                        <div
                          className={`today-task${t.done ? ' done' : ''}${flashId === t.id ? ' flash' : ''}`}
                          draggable={!t.done}
                          onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move' }}
                        >
                          <span className="drag-grip" aria-hidden="true"><Icon.Grip /></span>
                          <SpaceMark space={t.space} />
                          <button
                            className="checkbox" role="checkbox" aria-checked={t.done}
                            aria-label={t.done ? `Reopen: ${t.title}` : `Complete: ${t.title}`}
                            onClick={() => {
                              if (t.done) { toggleTask(t.id); return }  // reopen
                              // Subtasked or flat, it asks how long it took; ticking the
                              // parent ticks the steps inside it either way.
                              setLogging(t.id)
                            }}
                          >
                            <Icon.Check size={12} strokeWidth={4} />
                          </button>
                          <span className={`cat-dot ${t.category}`} aria-hidden="true" />
                          <span className="grow wrap2"><Linkify text={t.title} /></span>
                          {t.done && t.actualMin != null ? (
                            <span className="est-vs-actual mono">{fmtDuration(taskMinutes(t))} → {fmtDuration(t.actualMin)} <b className={taskMinutes(t) - t.actualMin >= 0 ? 'val-pos' : 'val-urgent'}>{taskMinutes(t) - t.actualMin >= 0 ? '+' : ''}{taskMinutes(t) - t.actualMin}m</b></span>
                          ) : (
                            <EstimateChip task={t} />
                          )}
                          {hasSubs && (
                            <button className="expand-btn" aria-expanded={isExp} aria-label={isExp ? 'Collapse subtasks' : 'Expand subtasks'} onClick={() => toggleExp(t.id)}>
                              {isExp ? '▾' : '▸'} {doneSubs}/{t.subtasks!.length}
                            </button>
                          )}
                          {!t.done && <TaskActions task={t} onFocus={() => startFocus(taskMinutes(t), t.title)} />}
                          <Dropdown label={`Options for ${t.title}`}>
                            {!t.done && <button role="menuitem" onClick={() => setBreakdownFor(t)}>Break it down</button>}
                            {!t.done && <span className="kebab-sep" />}
                            {!t.done && <span className="kebab-head">Move to</span>}
                            {!t.done && BUCKETS.map((mb) => (
                              <button key={mb.id} role="menuitemradio" aria-checked={(t.slot ?? 'unsorted') === mb.id} onClick={() => dropTo(mb.id, t.id)}>
                                {mb.label}
                              </button>
                            ))}
                            {!t.done && <span className="kebab-sep" />}
                            {/* Dragging onto the day is the fast way; on a phone
                                there is no drag, so the time can be typed. */}
                            {!t.done && <span className="kebab-head">At a time</span>}
                            {!t.done && (
                              <div className="kebab-timerow">
                                <input
                                  type="time" className="textinput" value={t.at ?? ''} step={900}
                                  aria-label={`Clock time for ${t.title}`}
                                  onChange={(e) => setTaskAt(t.id, e.target.value || undefined)}
                                />
                                {t.at && (
                                  <button className="linkish" onClick={() => setTaskAt(t.id, undefined)}>Clear</button>
                                )}
                              </div>
                            )}
                            {!t.done && <span className="kebab-sep" />}
                            {!t.done && (
                              <>
                                {/* Moving a task between times used to be drag
                                    only, and drag does not work with a thumb.
                                    That is most of why he said Plan "doesn't
                                    work at all" on a phone: he could get a
                                    task onto the day from the list, then never
                                    move it again. */}
                                <span className="kebab-head">Move to</span>
                                {SLOTS.filter((sl) => sl.id !== (t.slot ?? 'unsorted')).map((sl) => (
                                  <button key={sl.id} role="menuitem" onClick={() => assignSlot(t.id, sl.id)}>{sl.label}</button>
                                ))}
                                <span className="kebab-sep" />
                                <button role="menuitem" onClick={() => setEditingTask(t)}>Edit</button>
                                <button role="menuitem" onClick={() => { moveTaskList(t.id, 'backlog'); assignSlot(t.id, undefined); setTaskAt(t.id, undefined) }}>Back to the list</button>
                              </>
                            )}
                            <button role="menuitem" className="danger" onClick={() => deleteTask(t.id)}>Delete</button>
                          </Dropdown>
                        </div>
                        {logging === t.id && (
                          <ActualLog est={taskMinutes(t)} tracked={trackedFor(t.title)} onLog={(m) => { logActual(t.id, m); setLogging(null) }} onSkip={() => { toggleTask(t.id); setLogging(null) }} />
                        )}
                        {hasSubs && isExp && (
                          <div className="subtask-list">
                            {t.subtasks!.map((s) => (
                              <div key={s.id} className="subtask-wrap">
                                <button
                                  className={`subtask${s.done ? ' done' : ''}`}
                                  onClick={() => { if (s.done) toggleSubtask(t.id, s.id); else setLogging(`sub|${t.id}|${s.id}`) }}
                                >
                                  <span className="sub-tick" aria-hidden="true" />
                                  <span className="grow">{s.title}</span>
                                  {s.done && s.actualMin != null ? (
                                    <span className="est-vs-actual mono">{fmtDuration(s.estimateMin)} → {fmtDuration(s.actualMin)} <b className={s.estimateMin - s.actualMin >= 0 ? 'val-pos' : 'val-urgent'}>{s.estimateMin - s.actualMin >= 0 ? '+' : ''}{s.estimateMin - s.actualMin}m</b></span>
                                  ) : (
                                    <span className="chip tone-info">{fmtDuration(s.estimateMin)}</span>
                                  )}
                                </button>
                                {!s.done && (
                                  <button
                                    className="task-act task-focus sub-focus"
                                    aria-label={`Focus on ${s.title} for ${s.estimateMin} minutes`}
                                    title={`Focus ${s.estimateMin}m on this step`}
                                    onClick={() => startFocus(s.estimateMin, s.title)}
                                  >
                                    <Icon.Play size={17} />
                                  </button>
                                )}
                                {/* The same tools the list gives a step. A step
                                    could only be corrected before he planned it,
                                    so the day he actually works from was the one
                                    place a wrong number was stuck. */}
                                {!s.done && <SubEdit taskId={t.id} sub={s} />}
                                {logging === `sub|${t.id}|${s.id}` && (
                                  <ActualLog est={s.estimateMin} tracked={trackedFor(s.title)} onLog={(m) => { logSubtaskActual(t.id, s.id, m); setLogging(null) }} onSkip={() => { toggleSubtask(t.id, s.id); setLogging(null) }} />
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            )
          })}
          {/* No dayless group any more: a routine on the day has been started,
              and the moment it started is a real time, so it always has a slot. */}
          {/* Finished-but-unscheduled work, kept visible without asking to be planned. */}
          {doneUnsorted.length > 0 && (
            <div className="done-group">
              <div className="bucket-head">
                <span className="bucket-name">Done today</span>
                <span className="tot mono">{doneUnsorted.length}</span>
              </div>
              {doneUnsorted.map((t) => (
                <div className="today-task done" key={t.id} data-task-id={t.id}>
                  <button className="checkbox" role="checkbox" aria-checked aria-label={`Reopen: ${t.title}`} onClick={() => toggleTask(t.id)}>
                    <Icon.Check size={12} strokeWidth={4} />
                  </button>
                  <span className={`cat-dot ${t.category}`} aria-hidden="true" />
                  <span className="grow">{t.title}</span>
                  {t.actualMin != null
                    ? <span className="est-vs-actual mono">{fmtDuration(taskMinutes(t))} → {fmtDuration(t.actualMin)}</span>
                    : isEstimated(t)
                      ? <span className="chip tone-info">{fmtDuration(taskMinutes(t))}</span>
                      : <span className="chip tone-info is-none">no estimate</span>}
                </div>
              ))}
            </div>
          )}
          {todayAll.length === 0 && (
            <p className="col-note">
              <span className="hide-touch">Drag anything from the list into a time of day. Drag it back to take it off today.</span>
              <span className="only-touch">Use a task's ⋯ menu to put it into a time of day, or send it back to the list.</span>
            </p>
          )}
        </div>
      </div>


      {breakdownFor && <BreakdownSheet task={breakdownFor} onClose={() => setBreakdownFor(null)} />}
      {editingTask && <EditTaskSheet task={editingTask} onClose={() => setEditingTask(null)} />}

    </div>
  )
}

/* ---------------- HABITS ---------------- */

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']


/* A longer window than the week. One square a day, oldest on the left, so sixty
   or a hundred days reads as a shape rather than a wall of ticks. Green means
   kept, exactly as it does everywhere else; nothing marks a missed day, because
   a wall of misses is the guilt mechanic this app exists to avoid. */
function HabitTrail({ h, days }: { h: HabitDef; days: number }) {
  const { habitLog, slips, openDay } = useStore()
  const today = new Date()
  const from = new Date(today); from.setDate(from.getDate() - (days - 1))
  const fromKey = localDateKey(from)
  const toKey = localDateKey(today)
  const kept = h.kind === 'break'
    ? quitKeptDays(h, slips, fromKey, toKey)
    : keptDaysIn(habitLog, h.id, fromKey, toKey)
  // A slip is a fact on the record, so it is drawn as one rather than left to
  // read as an ordinary blank day.
  const slipped = h.kind === 'break' ? slipDays(slips, h.id) : new Set<string>()
  const cells = Array.from({ length: days }, (_, i) => {
    const d = new Date(from); d.setDate(from.getDate() + i)
    return localDateKey(d)
  })
  /* The day it began, either way round. A square before it is not a day he
     missed, it is a day the habit did not exist, so it is drawn as empty space
     and left out of the count underneath. */
  const began = h.kind === 'break' ? h.quitSince : h.startedOn
  const chances = began ? cells.filter((d) => d >= began) : cells
  /* Best run used to read the same number as the current one for a quit, because
     one overwritten date could only describe the run he is in now. */
  const run = h.kind === 'break' ? (daysClean(h, slips) ?? 0) : currentStreak(habitLog, h.id)
  const best = h.kind === 'break' ? bestCleanRun(h, slips) : bestStreak(habitLog, h.id)
  return (
    <div className="habit-trail-wrap">
      <div className={`habit-trail w${days}`}>
        {/* Every square is the day it stands for, so the answer to "what happened
            on that one" is one click away rather than nowhere. */}
        {cells.map((day) => (
          <button
            key={day}
            className={`trail-day${began && day < began ? ' before-start' : ''}${kept.has(day) ? ' kept' : ''}${slipped.has(day) ? ' slipped' : ''}${day === toKey ? ' is-today' : ''}`}
            title={`${fmtWhen(day)}${slipped.has(day) ? ', slipped' : kept.has(day) ? ', kept' : ''}`}
            aria-label={`${fmtWhen(day)}${slipped.has(day) ? ', slipped' : kept.has(day) ? ', kept' : ', not kept'}`}
            onClick={() => openDay(day)}
          />
        ))}
      </div>
      <div className="habit-foot">
        <span className="habit-weeks">{chances.filter((d) => kept.has(d)).length} of {chances.length} days</span>
        {/* Only when it lands inside the squares being drawn: there it is the
            fact that explains the empty ones. */}
        {began && began > fromKey && <span className="habit-weeks">from {fmtWhen(began)}</span>}
        <span className="habit-weeks">{run} now, {best} best</span>
      </div>
    </div>
  )
}

function HabitRow({ h, todayIndex, days: window = 7, actions, stateTag, drivenBy, progress, partOn, goal, qualify }: {
  h: HabitDef
  todayIndex: number
  /** The workspace, spelled out, when another visible habit has the same name. */
  qualify?: string
  /** "done today" / "paused". It goes in the foot column where words fit; in
   *  the menu column it shoved the kebab out of the panel. */
  stateTag?: string | null
  /** How many days back to show. Seven keeps the week of dots you can click. */
  days?: number
  actions?: React.ReactNode
  /** Name of the routine that ticks this habit, when one does. */
  drivenBy?: string
  /** Today's progress through the routine that drives this habit. */
  progress?: { done: number; total: number }
  /** How far through its routine each PAST day got, 0 to 100, keyed by date.
   *  Today's number comes from the live routine; every other day comes from the
   *  dated step record, because the routine itself no longer remembers. */
  partOn?: Map<string, number>
  /** A goal counting itself off this habit, if one exists. */
  goal?: Goal
}) {
  const { toggleHabitDay, assertRoutineDay, logSlip, logCount, setPage, focusSessions, habitLog, slips, stepLog, inView } = useStore()
  const [open, setOpen] = useState(false)
  /* The block on the clock counts toward today, so an hour reached while the
     timer is still running shows here rather than after it stops. */
  const pomo = usePomodoro()
  const liveFocusMin = pomo.phase === 'focus' && pomo.running ? Math.max(0, Math.floor((pomo.blockMin * 60 - pomo.secondsLeft) / 60)) : 0
  const kept = h.days.filter(Boolean).length
  const target = habitTarget(h)
  /* Once a week or once a month: a row of weekdays is the wrong instrument
     entirely, and the fraction underneath it was arithmetic between two
     different units. These rows get a strip of PERIODS instead. */
  const periodic = h.frequency === 'weekly' || h.frequency === 'monthly'
  const periodTf: GoalTf = h.frequency === 'monthly' ? 'monthly' : 'weekly'
  const periodWord = h.frequency === 'monthly' ? 'months' : 'weeks'
  const PERIOD_CELLS = 5
  /* The last five of its own periods, oldest first, this one last. */
  const periodCells = periodic
    ? Array.from({ length: PERIOD_CELLS }, (_, i) => {
      const key = shiftPeriodKey(periodTf, i - (PERIOD_CELLS - 1))
      const r = goalPeriodRange(periodTf, key)
      return { key, label: r.label, kept: keptDaysIn(habitLog, h.id, r.from, r.to).size > 0, now: i === PERIOD_CELLS - 1 }
    })
    : []
  /* Twice in a day is not the same as once. The log has held both since
     meditation started being fed by two routines; without this the card said
     the same thing either way. */
  const timesToday = habitCountOn(habitLog, h.id, localDateKey())
  // Weekdays-only habits do not expect the weekend, so those dots stay quiet.
  const expected = (i: number) => (h.frequency === 'weekdays' ? i < 5 : true)
  // How many of the last 12 weeks actually hit the target. This is the number
  // the row of bars was trying to say and never did.
  const weeks = h.history ?? []
  const hitWeeks = weeks.filter((n) => n >= target).length
  const avg = weeks.length ? weeks.reduce((a, n) => a + n, 0) / weeks.length : 0
  /* One week of history compares nothing, and "1 of the last 1 weeks" is not
     a sentence. A periodic habit's own strip already carries this. */
  const trend = weeks.length < 2 || periodic
    ? null
    : target <= 1
      ? `kept ${hitWeeks} of the last ${weeks.length} weeks`
      : `averaging ${avg.toFixed(1).replace(/\.0$/, '')} of ${target} a week`

  // Part-done shows as a partial fill on today's dot, so a routine you started
  // but did not finish is visible here instead of reading as untouched.
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  const partial = !!progress && progress.done > 0 && progress.done < progress.total
  /** How far through the routine that weekday got, 0 when it was not started or
   *  was finished outright. A finished day already reads as a full dot. */
  const partOf = (i: number): number => {
    if (h.days[i]) return 0
    if (i === todayIndex) return partial ? pct : 0
    return partOn?.get(dayOfWeekKey(i)) ?? 0
  }

  /* Measured: the dot is not yes/no, it is how far through the day's target you
     got. A morning that reached 40 of 60 minutes reads as most of the way there
     rather than as a failure. */
  /* Counted: a number of times inside a stretch, logged one tap each. Minutes
     only ever fitted work he sits and times; most things he wants more of are
     things he DOES, and asking him for "20 minutes of cold showers a day" was
     the wrong question dressed as a target. */
  /* Kept by the clock, not by him. It shows how far today has got and says what
     is keeping it, so a tick he cannot press never reads as a tick that failed. */
  if (h.auto?.from === 'focus') {
    const need = h.auto.minutes
    const todayMin = focusMinutesOn(focusSessions, localDateKey(), h.space) + liveFocusMin
    const kept7 = keptDaysIn(habitLog, h.id, dayOfWeekKey(0), dayOfWeekKey(6)).size
    return (
      <div className="habit-row is-count">
        <div className="habit-row-top">
          {/* Every row's name starts at the same indent, caret or none, so the
              foot row under it -- padded to clear a caret's width -- lines up
              with the name instead of drifting right of it. */}
          <span className="run-caret is-blank" aria-hidden="true" />
          <SpaceMark space={h.space} />
          <span className="habit-name">{h.name}{qualify && <span className="habit-qual">{qualify}</span>}</span>
          <span className="habit-count mono">
            {fmtDuration(todayMin)}<span className="habit-freq">of {fmtDuration(need)} today</span>
          </span>
        </div>
        <span className="habit-actions">{actions}</span>
        {/* One strip, and it is the week: the bar said today, the dots said the
            week and the line under them said the week again, so the row stated
            zero four times. */}
        <div className="habit-days">
          {DAY_LABELS.map((d, i) => {
            const on = keptDaysIn(habitLog, h.id, dayOfWeekKey(i), dayOfWeekKey(i)).size > 0
            const isToday = i === todayIndex
            return (
              <span className={`day-cell${isToday ? ' is-today' : ''}`} key={i}>
                <span
                  className={`daydot is-measure${on ? ' full' : isToday && todayMin > 0 ? ' partial' : ''}`}
                  style={isToday && !on ? ({ ['--fill' as string]: `${Math.min(100, Math.round((todayMin / need) * 100))}%` } as React.CSSProperties) : undefined}
                  aria-label={`${d}, ${on ? 'kept' : 'not kept'}`}
                />
              </span>
            )
          })}
        </div>
        <div className="habit-foot">{stateTag && <span className={`col-tot mono${stateTag === 'done today' ? ' val-pos' : ''}`}>{stateTag}</span>}
          <span className="habit-weeks">{kept7} of 7 this week</span>
          <button className="habit-auto" onClick={() => setPage('focus')}>Open Focus</button>
        </div>
      </div>
    )
  }

  if (isCounted(h)) {
    const per = h.per ?? 'day'
    const range = habitPeriodRange(per)
    const target = countTarget(h)
    const have = countIn(habitLog, h.id, range.from, range.to)
    const label = COUNT_PERIODS.find((p) => p.id === per)!.label
    return (
      <div className="habit-row is-count">
        <div className="habit-row-top">
          <span className="run-caret is-blank" aria-hidden="true" />
          <SpaceMark space={h.space} />
          <span className="habit-name">{h.name}{qualify && <span className="habit-qual">{qualify}</span>}</span>
          <span className="habit-count mono">
            {have}<span className="habit-freq">of {target} {label}</span>
          </span>
        </div>
        <span className="habit-actions">{actions}</span>
        <div className="count-bar" aria-hidden="true">
          <span style={{ width: `${Math.min(100, Math.round((have / target) * 100))}%` }} />
        </div>
        <div className="habit-foot">{stateTag && <span className={`col-tot mono${stateTag === 'done today' ? ' val-pos' : ''}`}>{stateTag}</span>}
          <span className="count-do">
            <button className="btn btn-primary count-add" onClick={() => logCount(h.id, 1)}>
              Did it
            </button>
            {have > 0 && (
              <button className="btn btn-ghost count-undo" onClick={() => logCount(h.id, -1)}>
                Take one back
              </button>
            )}
          </span>
          <span className="habit-weeks">{countIn(habitLog, h.id, dayOfWeekKey(0), dayOfWeekKey(6))} this week</span>
        </div>
      </div>
    )
  }

  if (h.kind === 'measured') {
    const target = h.dailyTargetMin ?? 60
    const todayMin = focusMinutesOn(focusSessions, localDateKey(), h.space)
    const weekMin = DAY_LABELS.reduce((a, _, i) => a + focusMinutesOn(focusSessions, dayOfWeekKey(i), h.space), 0)
    return (
      <div className="habit-row is-measured">
        <div className="habit-row-top">
          <span className="run-caret is-blank" aria-hidden="true" />
          <SpaceMark space={h.space} />
          <span className="habit-name">{h.name}{qualify && <span className="habit-qual">{qualify}</span>}</span>
          <span className="habit-count mono">
            {fmtDuration(todayMin)}<span className="habit-freq">of {fmtDuration(target)} today</span>
          </span>
        </div>
        <span className="habit-actions">{actions}</span>
        <div className="habit-days">
          {DAY_LABELS.map((d, i) => {
            const mins = focusMinutesOn(focusSessions, dayOfWeekKey(i), h.space)
            const pct = Math.min(100, Math.round((mins / target) * 100))
            return (
              <span className={`day-cell${i === todayIndex ? ' is-today' : ''}`} key={i}>
                <span
                  className={`daydot is-measure${pct >= 100 ? ' full' : pct > 0 ? ' partial' : ''}`}
                  style={{ ['--fill' as string]: `${pct}%` } as React.CSSProperties}
                  title={`${d}: ${fmtDuration(mins)} of ${fmtDuration(target)}`}
                  aria-label={`${d}, ${mins} of ${target} minutes`}
                />
              </span>
            )
          })}
        </div>
        <div className="habit-foot">{stateTag && <span className={`col-tot mono${stateTag === 'done today' ? ' val-pos' : ''}`}>{stateTag}</span>}
          <button className="habit-auto" onClick={() => setPage('plan')}>Fills itself from your focus blocks</button>
          <span className="habit-weeks">{fmtDuration(weekMin)} this week</span>
        </div>
      </div>
    )
  }

  /* A quit is a different scoreboard: days clean, and a single honest button
     for the day you slip. Day dots would be asking the wrong question. */
  if (h.kind === 'break') {
    const clean = daysClean(h, slips) ?? 0
    // The week fills itself from the day he stopped: a day he did not do it is a
    // day kept, so he never has to tick anything to be given credit for it.
    const quitWeek = quitDays(h, slips)
    const slipsSoFar = slipCount(h, slips)
    const best = bestCleanRun(h, slips)
    return (
      <div className="habit-row is-quit">
        <div className="habit-row-top">
          <span className="run-caret is-blank" aria-hidden="true" />
          <SpaceMark space={h.space} />
          <span className="habit-name">{h.name}{qualify && <span className="habit-qual">{qualify}</span>}</span>
          <span className="habit-count mono">{clean}<span className="habit-freq">{clean === 1 ? 'day' : 'days'} clean</span></span>
        </div>
        <span className="habit-actions">{actions}</span>
        {window > 7 ? <HabitTrail h={h} days={window} /> : (
          <div className="habit-days">
            {DAY_LABELS.map((d, i) => (
              <span key={i} className={`daydot is-measure${quitWeek[i] ? ' full' : ''}`} title={quitWeek[i] ? 'A day without it' : undefined}>
                <b>{d}</b>
              </span>
            ))}
          </div>
        )}
        <div className="habit-foot">{stateTag && <span className={`col-tot mono${stateTag === 'done today' ? ' val-pos' : ''}`}>{stateTag}</span>}
          <button className="quit-slip" onClick={() => logSlip(h.id)}>I slipped today</button>
          <span className="habit-weeks">
            {h.quitSince ? `since ${fmtWhen(h.quitSince)}` : ''}
            {slipsSoFar > 0 ? `, ${slipsSoFar} slip${slipsSoFar === 1 ? '' : 's'}` : ''}
            {best > clean ? `, ${best} best run` : ''}
          </span>
        </div>
      </div>
    )
  }

  /* The step's own rules, at the habit's address. A gated habit cannot be
     ticked until the day's number clears the target, and a habit with two
     answers is ticked by picking one of them, never by a checkbox that would
     have to guess which he meant. Both were true of the steps and neither
     survived the merge, which is what he caught. */
  const gate = habitGate(h)
  const locked = !!gate && habitLocked(h, stepLog, localDateKey())
  const byAnswer = !!h.alts?.length
  const hasRun = habitHasRun(h)
  const todayHeld = !!drivenBy || locked || byAnswer

  return (
    <div className={`habit-row${drivenBy ? ' is-auto' : ''}${open ? ' is-open' : ''}`}>
      <div className="habit-row-top">
        {hasRun ? (
          <button
            className="run-caret"
            aria-expanded={open}
            aria-label={open ? `Close ${h.name}` : `Open ${h.name}`}
            onClick={() => setOpen((v) => !v)}
          ><Icon.ChevronRight size={12} /></button>
        ) : <span className="run-caret is-blank" aria-hidden="true" />}
        <SpaceMark space={h.space} />
        <span className="habit-name">{h.name}{qualify && <span className="habit-qual">{qualify}</span>}</span>
        {/* The week's count belongs to the week. Showing 1/7 above a year of
            squares says two different things about the same habit. */}
        {/* A weekly habit has a target of one, and this counted DAYS in the
            week, so a weekly review ticked four times read "4/1". A period
            habit says whether the period is kept; a daily one keeps its
            fraction. */}
        {window === 7 && (
          <span className="habit-count mono">
            {/* A monthly habit is kept in a MONTH. Reading the week's cache
                let the word say "not yet" over a filled month. "kept" on its
                own read as a stray word next to the weekday legend built for
                the daily rows; that legend is gone for these now, and "done"
                pairs with the period-cell strip's own "months"/"weeks" label
                below it instead of repeating it. */}
            {periodic
              ? (periodCells[periodCells.length - 1]?.kept ? 'done' : 'not yet')
              : `${kept}/${target}`}
            {timesToday > 1 && <span className="habit-freq">{timesToday}x today</span>}
          </span>
        )}
      </div>
      <span className="habit-actions">{actions}</span>
      {window > 7 ? <HabitTrail h={h} days={window} /> : periodic ? (
        /* Five of its own periods. A once-a-month habit has no Mondays, and
           printing it under M T W T F S S said it did. */
        <div className="habit-days is-period">
          <span className="period-unit mono">{periodWord}</span>
          {periodCells.map((c) => (
            <span
              key={c.key}
              className={`periodcell${c.kept ? ' kept' : ''}${c.now ? ' is-now' : ''}`}
              title={`${c.label}${c.kept ? ', kept' : c.now ? ', not yet' : ', not kept'}`}
              aria-label={`${c.label}${c.kept ? ', kept' : c.now ? ', not yet' : ', not kept'}`}
            />
          ))}
        </div>
      ) : (
      <div className="habit-days">
        {DAY_LABELS.map((d, i) => (
          <span className={`day-cell${i === todayIndex ? ' is-today' : ''}`} key={i}>
            <button
              /* A part-done day is part-done whenever it was. Today's fraction
                 comes off the live routine, every earlier one off the dated
                 step record; a day already fully kept is never redrawn as
                 partial. */
              className={`daydot${expected(i) ? '' : ' off-day'}${drivenBy ? ' is-auto' : ''}${partOf(i) > 0 ? ' partial' : ''}${todayHeld && i === todayIndex ? ' is-locked' : ''}`}
              style={partOf(i) > 0 ? ({ ['--fill' as string]: `${partOf(i)}%` } as React.CSSProperties) : undefined}
              role="checkbox"
              aria-checked={h.days[i]}
              /* TODAY belongs to whatever earns it: the routine that owns the
                 habit, the number a gated habit has to hit, or the answer a
                 two-way habit needs picked. A day already gone is his to
                 correct, because a lost write must never become a permanent lie
                 about what he did. */
              disabled={i > todayIndex || (todayHeld && i === todayIndex)}
              aria-label={
                i !== todayIndex
                  ? (drivenBy ? `${h.name}, ${d}, correct this day by hand` : `${h.name}, ${d}`)
                  : drivenBy ? `${h.name}, ${d}, set by the ${drivenBy} routine`
                    : locked ? `${h.name}, ${d}, log ${gate!.target} ${gate!.unit} or better to keep it`
                      : byAnswer ? `${h.name}, ${d}, open it and pick an answer`
                        : `${h.name}, ${d}`
              }
              title={
                i !== todayIndex
                  ? (drivenBy ? `Done via ${drivenBy}? Set the record straight.` : undefined)
                  : drivenBy ? `Set by the ${drivenBy} routine`
                    : locked ? `Hit ${gate!.target} ${gate!.unit} to keep this today`
                      : byAnswer ? 'Open it and pick an answer'
                        : undefined
              }
              onClick={() => { if (drivenBy) { if (i < todayIndex) assertRoutineDay(h.id, i) } else toggleHabitDay(h.id, i) }}
            >
              <Icon.Check size={11} strokeWidth={4} />
            </button>
          </span>
        ))}
      </div>
      )}
      {/* One fact and one action, on one line. State, else the steps still
          waiting, else the trend: three of them stacked into a 200px column
          and the row read as three ragged lines. The row is already named
          after its routine, so the link is an action, not a sentence.

          The goal link lives INSIDE this row. It used to be its own element
          assigned the same `foot` grid cell, and two elements in one cell
          stack: "Feeding X" was drawn straight on top of "averaging N of 7
          a week", which is the overlapping text he reported. */}
      <div className="habit-foot">
        {stateTag
          ? <span className={`col-tot mono${stateTag === 'done today' ? ' val-pos' : ''}`}>{stateTag}</span>
          : progress && progress.total > 1 && progress.done > 0 && progress.done < progress.total
            ? <span className="habit-weeks">{progress.done} of {progress.total} steps</span>
            : trend ? <span className="habit-weeks">{trend}</span> : null}
        {goal && (
          <button className="habit-goal" onClick={() => setPage('goals')}>
            Feeding “{goal.name}”
          </button>
        )}
        {/* What the step carried and a habit did not. His instruction when the
            merge was agreed: "it should still consist of short description if
            it was previously... there is links for typing tests, so there
            should be link to that still. The video doesn't have to be video,
            it has to be a link to that video." */}
        {locked
          ? <span className="habit-weeks mono">{gate!.target} {gate!.unit} to pass</span>
          : h.note && <span className="habit-note" title={h.note}>{h.note}</span>}
        {h.link && (
          <a className="habit-auto" href={h.link} target="_blank" rel="noreferrer">
            {h.linkLabel ?? 'Open'} ↗
          </a>
        )}
        {h.goto && (
          <button className="habit-auto" onClick={() => setPage(h.goto as PageId)}>
            {h.gotoLabel ?? 'Open'}
          </button>
        )}
        {h.seconds ? <span className="habit-weeks mono">{Math.round(h.seconds / 60)}m</span> : null}
      </div>
      {open && hasRun && <HabitRun h={h} />}
    </div>
  )
}

/* Habits used to be grouped by the part of the day they belong to. That axis
   described nothing: ten of sixteen landed in "Anytime", which is the group
   that means no group, and it was printed first. The axis that decides what a
   row IS, and whether he can touch it, is who keeps it. Three groups, his own
   first, because those are the only ones with a live checkbox in them. */
type Keeper = 'you' | 'routine' | 'clock'
const KEEPER_GROUPS: { id: Keeper; label: string }[] = [
  { id: 'you', label: 'You keep these' },
  { id: 'routine', label: 'Your routines keep these' },
  { id: 'clock', label: 'The clock keeps these' },
]
/* Inside a group, the day still runs in order. */
const DAYPART_RANK: Record<string, number> = { morning: 0, noon: 1, afternoon: 2, evening: 3, anytime: 4 }

/* One sheet for adding and editing. A habit a routine drives keeps its name and
   frequency in step with that routine, so those fields are read-only here. */
function HabitSheet({ onClose, habit, drivenBy }: { onClose: () => void; habit?: HabitDef; drivenBy?: string }) {
  const { addHabit, updateHabit, inView } = useStore()
  const [name, setName] = useState(habit?.name ?? '')
  // Editing keeps whatever it had, including none. Only a new habit defaults.
  const [daypart, setDaypart] = useState<TimeSlot | ''>(habit ? (habit.daypart ?? '') : 'morning')
  const [frequency, setFrequency] = useState<HabitFrequency>(habit?.frequency ?? 'daily')
  const [perWeek, setPerWeek] = useState(habit?.targetPerWeek ?? 3)
  const [kind, setKind] = useState<HabitKind>(habit?.kind ?? 'build')
  const [targetMin, setTargetMin] = useState(habit?.dailyTargetMin ?? 60)
  const [measure, setMeasure] = useState<'minutes' | 'times'>(habit?.measure ?? 'times')
  const [per, setPer] = useState<CountPeriod>(habit?.per ?? 'day')
  const [count, setCount] = useState(habit?.targetCount ?? 1)
  const [since, setSince] = useState(habit?.quitSince ?? localDateKey())
  const [startedOn, setStartedOn] = useState(habit?.startedOn ?? localDateKey())
  const locked = !!drivenBy
  const quitting = kind === 'break'
  const measured = kind === 'measured'

  const submit = () => {
    if (!name.trim()) return
    const shape = {
      name: name.trim(),
      daypart: quitting ? undefined : (daypart || undefined),
      frequency,
      targetPerWeek: frequency === 'times-per-week' ? perWeek : undefined,
      kind,
      measure: measured ? measure : undefined,
      per: measured && measure === 'times' ? per : undefined,
      targetCount: measured && measure === 'times' ? Math.max(1, count) : undefined,
      dailyTargetMin: measured && measure === 'minutes' ? Math.max(5, targetMin) : undefined,
      // Focus blocks fill minutes. A count is his to log, so it has no source.
      source: measured && measure === 'minutes' ? ('focus' as const) : undefined,
      quitSince: quitting ? (since || localDateKey()) : undefined,
      startedOn: quitting ? undefined : (startedOn || localDateKey()),
    }
    if (habit) updateHabit(habit.id, locked ? { daypart: shape.daypart } : shape)
    else addHabit(shape)
    onClose()
  }

  return (
    <Sheet
      steady
      title={habit ? 'Edit this habit' : 'Add a habit'}
      onClose={onClose}
    >
      {/* Only when it is locked, and only because the form is about to refuse
          him: the fields are disabled and nothing else on screen says why. The
          other half of this was a definition of the word "habit". */}
      {locked && (
        <p className="sheet-warn" style={{ marginTop: 0 }}>
          The {drivenBy} routine keeps this habit, so its name and frequency follow that routine. You can still move it to a different part of the day.
        </p>
      )}
      <span className="field-label">Which kind is this?</span>
      <Segmented
        label="Which kind is this?"
        value={kind}
        options={[
          { id: 'build', label: 'Keep', hint: 'Something you want to do', disabled: locked },
          { id: 'break', label: 'Quit', hint: 'Something you want to stop', disabled: locked },
          { id: 'measured', label: 'Amount', hint: 'A number to hit, in times or minutes', disabled: locked },
        ]}
        onPick={(id) => setKind(id as HabitKind)}
      />

      <label className="field-label" style={{ marginTop: 'var(--s4)' }} htmlFor="hname">
        {quitting ? 'What are you quitting?' : measured ? 'What are you measuring?' : 'What is the habit?'}
      </label>
      <input
        id="hname" className="textinput" style={{ width: '100%' }} autoFocus={!locked} disabled={locked}
        placeholder={quitting ? 'e.g. Scrolling in bed' : 'e.g. 20 minutes of movement'}
        value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
      />

      {/* A thing you are quitting has no hour of the day; it has a day you
          stopped, and a rhythm for checking in on it. */}
      {quitting ? (
        <div className="sheet-grid" style={{ marginTop: 'var(--s4)' }}>
          <div>
            <label className="field-label" htmlFor="hsince">Not since</label>
            <input id="hsince" className="textinput" style={{ width: '100%' }} type="date" max={localDateKey()}
              value={since} onChange={(e) => setSince(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="hfreqq">Check in</label>
            <Select id="hfreqq" style={{ width: '100%' }} value={frequency} disabled={locked}
              onChange={(v) => setFrequency(v)}
              options={HABIT_FREQUENCIES.map((f) => ({ value: f.id, label: f.label }))} />
          </div>
        </div>
      ) : (
        <div className="sheet-grid" style={{ marginTop: 'var(--s4)' }}>
          <div>
            <label className="field-label" htmlFor="hpart">When in the day?</label>
            <Select id="hpart" style={{ width: '100%' }} value={daypart} onChange={(v) => setDaypart(v)}
              options={[...SLOTS.map((s) => ({ value: s.id as TimeSlot | '', label: `${s.label}, ${s.hint}` })), { value: '' as TimeSlot | '', label: 'Anytime' }]} />
          </div>
          <div>
            {measured ? (
              <>
                <label className="field-label" htmlFor="hmeasure">Counting what?</label>
                <Select id="hmeasure" style={{ width: '100%' }} value={measure}
                  onChange={(v) => setMeasure(v)}
                  options={[
                    { value: 'times' as const, label: 'Times you do it' },
                    { value: 'minutes' as const, label: 'Minutes of focus time' },
                  ]} />
              </>
            ) : frequency === 'times-per-week' ? (
              <>
                <label className="field-label" htmlFor="hper">Days a week</label>
                <input id="hper" className="textinput" style={{ width: '100%' }} type="number" min={1} max={7} value={perWeek}
                  onChange={(e) => setPerWeek(Math.max(1, Math.min(7, Number(e.target.value) || 1)))} />
              </>
            ) : (
              <>
                <label className="field-label" htmlFor="hfreq">How often?</label>
                <Select id="hfreq" style={{ width: '100%' }} value={frequency} disabled={locked}
                  onChange={(v) => setFrequency(v)}
                  options={HABIT_FREQUENCIES.map((f) => ({ value: f.id, label: f.label }))} />
              </>
            )}
          </div>
        </div>
      )}

      {/* The target itself, once he has said what he is counting. */}
      {measured && (
        <div className="sheet-grid" style={{ marginTop: 'var(--s4)' }}>
          {measure === 'times' ? (
            <>
              <div>
                <label className="field-label" htmlFor="hcount">How many times?</label>
                <input id="hcount" className="textinput" style={{ width: '100%' }} type="number" min={1} max={99} value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(99, Number(e.target.value) || 1)))} />
              </div>
              <div>
                <label className="field-label" htmlFor="hcper">In what stretch?</label>
                <Select id="hcper" style={{ width: '100%' }} value={per}
                  onChange={(v) => setPer(v)}
                  options={COUNT_PERIODS.map((o) => ({ value: o.id, label: o.label }))} />
              </div>
            </>
          ) : (
            <div>
              <label className="field-label" htmlFor="htarget">Minutes a day</label>
              <input id="htarget" className="textinput" style={{ width: '100%' }} type="number" min={5} max={600} step={5} value={targetMin}
                onChange={(e) => setTargetMin(Math.max(5, Math.min(600, Number(e.target.value) || 5)))} />
            </div>
          )}
        </div>
      )}

      {/* A Keep or an Amount gets the same date a Quit gets. Without it, one
          added today reads as ninety days of nothing, and a habit he has in
          fact been keeping since spring starts its count on the wrong day. */}
      {!quitting && (
        <div className="sheet-grid" style={{ marginTop: 'var(--s4)' }}>
          <div>
            <label className="field-label" htmlFor="hstart">Started on</label>
            <input id="hstart" className="textinput" style={{ width: '100%' }} type="date" max={localDateKey()}
              value={startedOn} onChange={(e) => setStartedOn(e.target.value)} />
          </div>
        </div>
      )}

      <div className="sheet-actions">
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!name.trim()} onClick={submit}>{habit ? 'Save changes' : 'Add habit'}</button>
      </div>
    </Sheet>
  )
}

/** How far back the habit page is looking. A week is the default because that is
 *  the rhythm; the longer windows are for the sixty and hundred day questions. */
const HABIT_WINDOWS = [
  { id: 7, label: 'A week' },
  { id: 30, label: '30 days' },
  { id: 90, label: '90 days' },
  { id: 365, label: 'A year' },
]

export function HabitsPage() {
  const { habits, goals, space, deleteHabit, togglePauseHabit, routines, stepTicks, habitLog, todayIndex, inView, focusRoutineId, setFocusRoutineId } = useStore()
  const [days, setDays] = useState(7)
  const [adding, setAdding] = useState(false)
  // Opening the goal sheet from a habit is the "set a goal on this" path.
  const [goalFor, setGoalFor] = useState<string | null>(null)
  const [editHabit, setEditHabit] = useState<HabitDef | null>(null)
  const goalOn = new Map(goals.filter((g) => g.habitId).map((g) => [g.habitId as string, g]))
  const spaceHabits = habits.filter((h) => inView(h.space) && !h.archivedAt)
  // A habit a routine drives cannot be deleted from here, or the routine would
  // mirror into nothing. Pausing stays available.
  /* Ownership needs something to own: a routine with no steps cannot be
     finished, so until steps exist its habit stays hand-tickable instead of
     sitting locked behind a checklist that is not written yet. */
  const drivenBy = new Map(routines.filter((r) => r.habitId && !r.archivedAt && r.steps.length > 0).map((r) => [r.habitId as string, r.title]))
  // Today's step progress for each routine-driven habit.
  const progressFor = new Map(routines.filter((r) => r.habitId && !r.archivedAt).map((r) => [
    r.habitId as string, routineProgress(r),
  ]))
  /* And every earlier day's, off the dated step record. The routine only ever
     remembers today, so a Monday he got two steps into used to read on Tuesday
     exactly like a Monday he never opened. Capped at 99 because a day that
     reached every step is a day that was KEPT, and that is a full dot. */
  const partFor = new Map<string, Map<string, number>>()
  for (const r of routines) {
    if (!r.habitId || r.archivedAt) continue
    const total = requiredSteps(r).length
    if (!total) continue
    const byDay = new Map<string, Set<string>>()
    for (const t of stepTicks) {
      if (t.routineId !== r.id) continue
      const seen = byDay.get(t.day) ?? new Set<string>()
      seen.add(t.stepId)
      byDay.set(t.day, seen)
    }
    const pcts = partFor.get(r.habitId) ?? new Map<string, number>()
    for (const [day, ids] of byDay) {
      const pc = Math.min(99, Math.round((ids.size / total) * 100))
      /* Two routines can feed one habit. The one that got furthest that day is
         the honest answer, not whichever happened to be read last. */
      if (pc > (pcts.get(day) ?? 0)) pcts.set(day, pc)
    }
    partFor.set(r.habitId, pcts)
  }
  /* What the page opens with used to be kept-this-week over the sum of every
     habit's weekly target: 49 of 90, a number mixing dailies, weekdays and
     monthlies across four workspaces that he could not reconstruct from
     anything on screen. What he wants on a Sunday morning is what is still
     open TODAY. */
  /* Folders, not raw rows: the same function Today's headline uses. This page
     used to count every habit and open with "1/64" while Today said "1/14"
     about the same morning. */
  const { due: dueCount, kept: doneToday } = habitsDueToday(spaceHabits, routines, habitLog, todayIndex)

  /* Grouped by who keeps it, and inside a group what is still open comes
     first, because a habit already ticked is a record and not a thing
     still to do. */
  const keeperOf = (h: HabitDef): Keeper =>
    (h.auto?.from === 'focus' || h.kind === 'measured') ? 'clock' : drivenBy.has(h.id) ? 'routine' : 'you'
  const rank = (h: HabitDef) =>
    (h.paused ? 2 : h.days[todayIndex] ? 1 : 0) * 10 + (DAYPART_RANK[h.daypart ?? 'anytime'] ?? 4)
  /* Three habits called "Focus for 30 minutes" differed by a coloured bar and a
     single letter. In All they are indistinguishable, so the workspace gets
     said. */
  const nameCount = new Map<string, number>()
  for (const h of spaceHabits) nameCount.set(h.name, (nameCount.get(h.name) ?? 0) + 1)
  const qualifyOf = (h: HabitDef) => ((nameCount.get(h.name) ?? 0) > 1 ? SPACE_LABELS[h.space] : undefined)
  /* Folders first, then whatever is loose. His model: a routine IS a folder of
     habits, and "if a habit doesn't have a folder it is basically just the
     habit". Inside a folder the sequence he wrote is the order, because a
     morning routine is a running order, not a ranked list; loose habits keep
     the old open-first ranking, which is what a flat list wants. */
  const folderGroups = routines
    .filter((r) => !r.archivedAt && inView(r.space))
    .map((r) => ({
      id: r.id,
      label: r.title,
      folder: r,
      list: spaceHabits
        .filter((h) => h.folderId === r.id)
        .sort((a, b) => (a.folderOrder ?? 0) - (b.folderOrder ?? 0)),
    }))
    .filter((g) => g.list.length > 0)
  /* The habit a routine already kept ("did I finish Morning Preparation
     today") is the FOLDER's own streak, not a habit sitting beside it. Left in
     the loose list every routine appeared twice, once as its folder and once
     as a row of the same name. It keeps its history and its id, it just is not
     a second row. */
  const folderHabitIds = new Set(routines.map((r) => r.habitId).filter(Boolean) as string[])
  const looseList = spaceHabits
    .filter((h) => !h.folderId && !folderHabitIds.has(h.id))
    .sort((a, b) => rank(a) - rank(b))
  /* A thing you are quitting reads nothing like a thing you are building --
     no target, no streak, a slip button instead of a week of dots. Mixed
     into one list they broke its rhythm; split, each list is one shape. */
  const looseBuild = looseList.filter((h) => h.kind !== 'break')
  const looseQuit = looseList.filter((h) => h.kind === 'break')
  /* Routines on the left, loose habits on the right, and neither side moves
     when the other changes height. A single CSS multi-column flow balanced
     both by total height, so opening one routine could shift every section
     after it into the other column -- "Monthly review" jumping sides just
     from opening "Morning Preparation" above it. Two real, independent
     columns fix that: each one is its own block flow, so a routine's open
     state can only ever move things within its own column. */
  const routineCols: { id: string; label: string; folder?: Routine; list: HabitDef[] }[] = folderGroups
  const looseCols: { id: string; label: string; folder?: Routine; list: HabitDef[] }[] = [
    ...(looseBuild.length ? [{ id: 'loose', label: 'On their own', list: looseBuild }] : []),
    ...(looseQuit.length ? [{ id: 'quitting', label: 'Quitting', list: looseQuit }] : []),
  ]
  /* How far through a folder today is. Optional habits never hold it open, so
     a folder of five with one optional reads 4/4 when the four that matter are
     done, not 4/5 forever. */
  const folderDone = (list: HabitDef[]) => {
    const need = list.filter((h) => !h.optional)
    return { done: need.filter((h) => h.days[todayIndex]).length, total: need.length }
  }
  const [shutFolders, setShutFolders] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('mc:shut-folders') ?? '[]') as string[]) } catch { return new Set() }
  })
  useEffect(() => {
    try { localStorage.setItem('mc:shut-folders', JSON.stringify([...shutFolders])) } catch { /* private mode */ }
  }, [shutFolders])
  const toggleFolder = (id: string) => setShutFolders((prev) => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  /* One click to shut every routine and see only the ones he reopens by hand,
     for a workspace with enough of them that scrolling past open ones to find
     the one he wants is the actual problem. Any open -> shut them all first;
     only once they are all already shut does the same control open them. */
  const allShut = folderGroups.length > 0 && folderGroups.every((g) => shutFolders.has(g.id))
  const toggleAllFolders = () => setShutFolders(allShut ? new Set() : new Set(folderGroups.map((g) => g.id)))
  /* Today's routine strip hands a routine over here the same way it hands a
     task to Plan: open its folder if he had shut it, scroll to it, flash it,
     then forget it -- clicking "Before work routine" on Today should not
     just land on this page, it should land ON that folder. */
  const [flashFolderId, setFlashFolderId] = useState<string | null>(null)
  useEffect(() => {
    if (!focusRoutineId) return
    setShutFolders((prev) => { const next = new Set(prev); next.delete(focusRoutineId); return next })
    setFlashFolderId(focusRoutineId)
    setFocusRoutineId(null)
    const el = document.querySelector(`[data-routine-id="${focusRoutineId}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const timer = window.setTimeout(() => setFlashFolderId(null), 2600)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRoutineId])

  return (
    <div className="page">
      <Band
        title="Habits"
        leading={folderGroups.length > 0 && (
          <button className="btn btn-ghost band-collapseall" onClick={toggleAllFolders}>
            {allShut ? 'Expand all' : 'Collapse all'}
          </button>
        )}
        metrics={[{ v: `${doneToday}/${dueCount}`, k: 'done today', tone: (doneToday > 0 ? 'pos' : 'info') as 'pos' | 'info' }]}
        actions={
          <>
            <Select
              className="rangepick" value={days} ariaLabel="How far back to look"
              onChange={(v) => setDays(v)}
              options={HABIT_WINDOWS.map((w) => ({ value: w.id, label: w.label }))}
            />
            <WriteTo />
            <button className="btn btn-primary" onClick={() => setAdding(true)}>Add a habit</button>
          </>
        }
      />

      {/* One panel per group, hairline separated rows inside it, the same shape
          the rest of the app uses for a list. Sixteen identical bordered cards
          in a grid left two thirds of every card empty, stranded the last card
          of each group in a row of its own, and gave nothing on the page a rank.
          The weekday letters are printed once at the top of the list instead of
          once per row, which is where 112 of them came from. */}
      <div className="habit-cols">
        <div className="habit-col">{routineCols.map(renderCol)}</div>
        <div className="habit-col">{looseCols.map(renderCol)}</div>
      </div>
      {routineCols.length === 0 && looseCols.length === 0 && <div className="empty">No habits in this space yet. Add one from the button above.</div>}

      {adding && <HabitSheet onClose={() => setAdding(false)} />}
      {editHabit && <HabitSheet habit={editHabit} drivenBy={drivenBy.get(editHabit.id)} onClose={() => setEditHabit(null)} />}
      {goalFor && <GoalSheet presetHabitId={goalFor} thenGoToGoals onClose={() => setGoalFor(null)} />}
    </div>
  )

  /* One render for either side of the split: a routine's folder card and a
     loose list's plain header differ only in what c.folder holds. Declared a
     function (not const), so its hoisting lets the JSX above call it before
     this point in the file reads as its definition. */
  function renderCol(c: { id: string; label: string; folder?: Routine; list: HabitDef[] }) {
    return (
      <section className="habit-section" key={c.id}>
          <div className={`panel habit-list${days === 7 ? ' w7' : ''}${flashFolderId === c.id ? ' flash' : ''}`} data-routine-id={c.folder ? c.id : undefined}>
            {c.folder ? (
              /* A folder: the routine's name, how far through today it is, and
                 a disclosure. Collapsed by default is wrong here, so it opens
                 and he shuts what he does not want to look at. */
              <button
                className="col-head folder-head"
                aria-expanded={!shutFolders.has(c.id)}
                onClick={() => toggleFolder(c.id)}
              >
                <Icon.ChevronRight size={12} className="folder-caret" />
                <span className="folder-name">{c.label}</span>
                <span className="folder-when microcap">{habitFrequencyLabel({ frequency: c.list[0]?.frequency } as HabitDef)}</span>
                {(() => {
                  const { done, total } = folderDone(c.list)
                  const own = c.folder?.habitId ? habits.find((h) => h.id === c.folder!.habitId) : undefined
                  const streak = own ? currentStreak(habitLog, own.id) : 0
                  return (
                    <>
                      {streak > 1 && <span className="folder-streak mono" title={`${streak} in a row`}>{streak}</span>}
                      <span className={`col-tot mono${done === total && total > 0 ? ' val-pos' : ''}`}>{done}/{total}</span>
                    </>
                  )
                })()}
              </button>
            ) : (
              <div className="col-head">
                <span className="microcap">{c.label}</span>
                <span className="col-tot mono">{c.list.length}</span>
              </div>
            )}
            {/* The weekday letters ride the same grid as the rows, so they can
                never drift out of line with the dots underneath them. A
                weekly/monthly routine has no Mondays either -- the legend
                printed seven weekday letters over a folder of period-cell
                rows regardless, which is where the unclickable-looking grid
                on "Invoicing routine" came from. */}
            {days === 7 && !(c.folder && shutFolders.has(c.id))
              && !(c.folder && (c.list[0]?.frequency === 'weekly' || c.list[0]?.frequency === 'monthly')) && (
              <div className="habit-row is-legend" aria-hidden="true">
                <span className="habit-row-top" />
                <span className="habit-days">
                  {DAY_LABELS.map((d, i) => (
                    <span className={`day-lab${i === todayIndex ? ' today' : ''}`} key={i}>{d[0]}</span>
                  ))}
                </span>
              </div>
            )}
            {(c.folder && shutFolders.has(c.id) ? [] : c.list).map((h) => (
              <div className={`habit-line is-${h.kind ?? 'build'}${h.paused ? ' is-paused' : ''}`} key={h.id}>
                <HabitRow h={h} todayIndex={todayIndex} days={days} qualify={qualifyOf(h)} drivenBy={drivenBy.get(h.id)} progress={progressFor.get(h.id)} partOn={partFor.get(h.id)} goal={goalOn.get(h.id)} stateTag={h.paused ? 'paused' : h.days[todayIndex] ? 'done today' : null} actions={
                  <>
                  <Dropdown label={`Options for ${h.name}`} className="habit-kebab">
                    <button role="menuitem" onClick={() => setEditHabit(h)}>Edit this habit</button>
                    <button role="menuitem" onClick={() => togglePauseHabit(h.id)}>{h.paused ? 'Resume it' : 'Pause it'}</button>
                    {goalOn.has(h.id) ? (
                      <span className="kebab-note">Goal: {goalOn.get(h.id)!.name}</span>
                    ) : (
                      <button role="menuitem" onClick={() => setGoalFor(h.id)}>Set a goal on this</button>
                    )}
                    <span className="kebab-sep" />
                    {drivenBy.has(h.id) ? (
                      <span className="kebab-note">Deleted with “{drivenBy.get(h.id)}”</span>
                    ) : (
                      <button role="menuitem" className="danger" onClick={() => deleteHabit(h.id)}>Delete this habit</button>
                    )}
                  </Dropdown>
                  </>
                } />
              </div>
            ))}
          </div>
        </section>
    )
  }
}

/* ---------------- ROUTINES ---------------- */

const CADENCE_ORDER: RoutineCadence[] = ['daily', 'prework', 'weekly', 'monthly']
/* The seeded routines in the order a day actually runs: wake, get to work,
   reset when the brain fries, wind the night down, go to bed, then the longer
   loops. His own routines slot in by cadence near their kin. */
const DAY_FLOW = ['r-wakeup', 'r-morning', 'r-prework', 'r-morningwork', 'r-brainrot', 'r-nightwork', 'r-evening', 'r-weekly', 'r-monthly']
const flowRank = (r: Routine): number => {
  const i = DAY_FLOW.indexOf(r.id)
  if (i !== -1) return i
  return ({ daily: 4.5, prework: 2.5, weekly: 6.5, monthly: 7.5 } as Record<string, number>)[r.cadence] ?? 9
}
const CADENCE_LABEL: Record<RoutineCadence, string> = { daily: 'Daily', prework: 'Before work', weekly: 'Weekly', monthly: 'Monthly' }
/** "done today" would be wrong on a monthly routine; each cadence names its own period. */
export const DONE_LABEL: Record<RoutineCadence, string> = {
  daily: 'done today', prework: 'done today', weekly: 'done this week', monthly: 'done this month',
}

/* Writing the steps of a routine. Editing is a mode on the card rather than a
   separate screen, because the thing you are editing is the thing you look at. */
function StepEditor({ routine }: { routine: Routine }) {
  const { addRoutineStep, updateRoutineStep, deleteRoutineStep, moveRoutineStep, inView } = useStore()
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')

  const add = () => {
    if (!title.trim()) return
    addRoutineStep(routine.id, { title: title.trim(), note: note.trim() || undefined })
    setTitle(''); setNote('')
  }

  return (
    <div className="step-editor">
      {routine.steps.map((s, i) => (
        <div className="step-edit-row" key={s.id}>
          <span className="step-order">
            <button aria-label={`Move ${s.title} up`} disabled={i === 0} onClick={() => moveRoutineStep(routine.id, s.id, -1)}>↑</button>
            <button aria-label={`Move ${s.title} down`} disabled={i === routine.steps.length - 1} onClick={() => moveRoutineStep(routine.id, s.id, 1)}>↓</button>
          </span>
          <span className="step-edit-fields">
            <input className="textinput" value={s.title} aria-label={`Step ${i + 1} title`}
              onChange={(e) => updateRoutineStep(routine.id, s.id, { title: e.target.value })} />
            <input className="textinput step-note" value={s.note ?? ''} placeholder="What it involves, if it needs saying…"
              aria-label={`Step ${i + 1} note`}
              onChange={(e) => updateRoutineStep(routine.id, s.id, { note: e.target.value })} />
          </span>
          <button className="step-drop" aria-label={`Delete ${s.title}`} onClick={() => deleteRoutineStep(routine.id, s.id)}>×</button>
        </div>
      ))}

      <div className="step-add">
        <input className="textinput" placeholder="Add a step…" value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }} aria-label="New step" />
        <input className="textinput step-note" placeholder="Note, optional…" value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }} aria-label="New step note" />
        <button className="btn btn-primary" disabled={!title.trim()} onClick={add}>Add</button>
      </div>
    </div>
  )
}

function AddRoutineSheet({ onClose }: { onClose: () => void }) {
  const { addRoutine, inView } = useStore()
  const [title, setTitle] = useState('')
  const [cadence, setCadence] = useState<RoutineCadence>('daily')
  const [daypart, setDaypart] = useState<TimeSlot | ''>('morning')

  const submit = () => {
    if (!title.trim()) return
    addRoutine({ title: title.trim(), cadence, daypart: daypart || undefined })
    onClose()
  }

  return (
    <Sheet title="Add a routine" onClose={onClose}>
      <label className="field-label" htmlFor="rtitle">What is the routine?</label>
      {/* Not a description of the sheet: the one thing that happens which he
          cannot see from this form. A habit appears, with this name. */}
      <p className="field-hint">Finishing every step checks off a habit of the same name, created with it.</p>
      <input id="rtitle" className="textinput" style={{ width: '100%' }} autoFocus placeholder="e.g. Evening shutdown…"
        value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />

      <div className="sheet-grid" style={{ marginTop: 'var(--s4)' }}>
        <div>
          <label className="field-label" htmlFor="rcad">How often does it run?</label>
          <Select id="rcad" style={{ width: '100%' }} value={cadence} onChange={(v) => setCadence(v)}
            options={[
              { value: 'daily' as const, label: 'Every day' },
              { value: 'prework' as const, label: 'Before work, on weekdays' },
              { value: 'weekly' as const, label: 'Once a week' },
              { value: 'monthly' as const, label: 'Once a month' },
            ]} />
        </div>
        <div>
          <label className="field-label" htmlFor="rpart">When in the day?</label>
          <Select id="rpart" style={{ width: '100%' }} value={daypart} onChange={(v) => setDaypart(v)}
            options={[...SLOTS.map((s) => ({ value: s.id as TimeSlot | '', label: s.label })), { value: '' as TimeSlot | '', label: 'Anytime' }]} />
        </div>
      </div>

      <p className="assist-note" style={{ marginTop: 'var(--s3)' }}>You write the steps on the card once it exists.</p>

      <div className="sheet-actions">
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!title.trim()} onClick={submit}>Add routine</button>
      </div>
    </Sheet>
  )
}


/* No window picker and no history trail here. Routines are the thing you run;
   how often you have run it is a habits question, and it is answered on Habits.
*/

/* Real columns, not a grid. A grid re-flows every card after the one that grew,
   so opening the first routine threw the last one into a different column while
   he was looking at it. Here each card is dealt a column and stays in it: only
   the cards UNDER the one he opened move, and only inside that column. Reading
   order across the first row is still left to right, day order first. */
const COL_MIN = 340
/* A callback ref, not a ref object: the second list only exists once he stands
   in a single workspace, and an effect keyed on mount alone never measured it,
   so it stayed at one column and its cards ran the width of the page. */
function useColumns(): [(el: HTMLDivElement | null) => void, number] {
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const [cols, setCols] = useState(1)
  useEffect(() => {
    if (!node) return
    const fit = () => {
      const w = node.clientWidth
      if (w) setCols(Math.max(1, Math.min(6, Math.floor((w + 16) / (COL_MIN + 16)))))
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(fit)
    ro.observe(node)
    return () => ro.disconnect()
  }, [node])
  return [setNode, cols]
}

/** Deal the cards left to right across the columns, so reading order survives. */
function dealt<T>(items: T[], cols: number): T[][] {
  const out: T[][] = Array.from({ length: cols }, () => [])
  items.forEach((it, i) => out[i % cols].push(it))
  return out
}

/* Every routine, in every workspace, on one page. A day is not lived one
   workspace at a time: the morning ritual, the Big Time start and the night
   session all belong to the same day, and hiding two thirds of them behind the
   switcher made him hunt for a card he had already written. So the switcher
   ORDERS this page instead of filtering it: the space he is standing in comes
   first, in the order a day runs, then the rest. The colour bar and letter stay
   on permanently here, because they are what tells the two halves apart. */
const SPACE_RANK: Record<SpaceId, number> = { personal: 0, work: 1, offplate: 2, corner: 3 }

export function RoutinesPage() {
  const { routines, view, space, toggleRoutineStep, toggleRoutineAlt, startAgain, planRoutine, setPage, routineLog, deleteRoutine, habits } = useStore()
  const today = localDateKey()
  const tomorrow = nextDay()
  /* On a day means on either day he can plan: today, or the one he laid out
     last night. */
  /* Same rule as Today's: started means started ON one of these days, not
     merely underway inside a period that happens to be a whole month. */
  const onDay = (r: Routine) => {
    const began = r.startedAt ? localDateKey(new Date(r.startedAt)) : null
    return began === today || began === tomorrow || r.planned?.day === today || r.planned?.day === tomorrow
  }
  /* Where it goes when he puts it on the day: the part of the day it belongs to
     if it has one, otherwise the part of the day it is now. Either way he can
     move it from the list itself. */
  const plannedSlotFor = (r: Routine): TimeSlot =>
    (habits.find((h) => h.id === r.habitId)?.daypart ?? slotForMoment(new Date().toISOString())) as TimeSlot
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  /* As many open as he wants, and they stay open. Leaving for Habits and coming
     back to find every card shut again was the page throwing away the one thing
     he had told it: this is the routine I am running. Which cards are open is a
     view, so it lives in its own key and never touches the synced data. */
  const [open, setOpen] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('mc:open-routines')
      return new Set(raw ? (JSON.parse(raw) as string[]) : [])
    } catch { return new Set() }
  })
  useEffect(() => {
    try { localStorage.setItem('mc:open-routines', JSON.stringify([...open])) } catch { /* private mode */ }
  }, [open])
  const isOpen = (id: string) => open.has(id) || editingId === id
  const setOpenId = (id: string | null, on = true) => setOpen((prev) => {
    const next = new Set(prev)
    if (id === null) return new Set()
    if (on) next.add(id); else next.delete(id)
    return next
  })
  /* A card shuts itself the moment it is FINISHED, not while it is finished:
     the difference matters, because reopening a routine he has already done is
     how he looks at what he did, and closing it again in his face was the app
     arguing with him. So this fires on the transition only, and a card he opens
     afterwards stays open. */
  const wasDone = useRef<Record<string, boolean>>({})
  useEffect(() => {
    const shutting: string[] = []
    for (const r of routines) {
      const done = routineComplete(r, periodKeyFor(r.cadence))
      const before = wasDone.current[r.id]
      if (done && before === false && open.has(r.id) && editingId !== r.id) shutting.push(r.id)
      wasDone.current[r.id] = done
    }
    if (!shutting.length) return
    const t = window.setTimeout(() => setOpen((prev) => {
      const next = new Set(prev)
      for (const id of shutting) next.delete(id)
      return next
    }), 700)
    return () => window.clearTimeout(t)
  }, [routines, open, editingId])
  const [hereRef, hereCols] = useColumns()
  const [elseRef, elseCols] = useColumns()
  const live = routines.filter((r) => !r.archivedAt)
  const byFlow = (a: Routine, b: Routine) => flowRank(a) - flowRank(b)
  /* In All nothing is "elsewhere": one list, day order, as before. */
  const here = (view === 'all' ? live : live.filter((r) => r.space === view)).sort(byFlow)
  const elsewhere = (view === 'all' ? [] : live.filter((r) => r.space !== view))
    .sort((a, b) => SPACE_RANK[a.space] - SPACE_RANK[b.space] || byFlow(a, b))

  /* The same menu wherever the card is, open or shut. */
  const menu = (r: Routine) => (
    <Dropdown label={`Options for ${r.title}`}>
      <button role="menuitem" onClick={() => { setEditingId(editingId === r.id ? null : r.id); setOpenId(r.id) }}>
        {editingId === r.id ? 'Done editing' : 'Edit the steps'}
      </button>
      {/* On the day's list before it is started, so a day can be planned and
          not only recorded. It lands in the part of the day it belongs to and
          can be moved from there. */}
      {onDay(r)
        ? (r.planned && !r.startedAt
          ? <button role="menuitem" onClick={() => planRoutine(r.id)}>Take it off {r.planned.day === today ? 'today' : 'tomorrow'}</button>
          : <button role="menuitem" onClick={() => setPage('plan')}>See it on today</button>)
        : (
          <>
            <button role="menuitem" onClick={() => planRoutine(r.id, plannedSlotFor(r))}>Add to today</button>
            <button role="menuitem" onClick={() => planRoutine(r.id, plannedSlotFor(r), tomorrow)}>Add to tomorrow</button>
          </>
        )}
      <span className="kebab-sep" />
      <button role="menuitem" className="danger" onClick={() => deleteRoutine(r.id)}>
        Delete this routine
      </button>
    </Dropdown>
  )

  /* The state of a routine in one line: how far through it is, or that it is
     done for its period, and twice through says so. */
  const status = (r: Routine) => {
    const { done, total } = routineProgress(r)
    if (!routineComplete(r, periodKeyFor(r.cadence))) return <span className="routine-progress mono">{done}/{total}</span>
    const runs = routineRunsOn(routineLog, r.id, localDateKey())
    return <span className="col-tot mono val-pos">{runs > 1 ? `done ${runs}x today` : DONE_LABEL[r.cadence]}</span>
  }

  const card = (r: Routine) => {
          /* Shut by default. A routine is a thing you run, not a thing you read:
             open the one you are doing, work down it, and it shuts itself the
             moment it is finished. Ten open cards was a page you had to scroll
             past to find the one you wanted. */
          if (!isOpen(r.id)) {
            const complete = routineComplete(r, periodKeyFor(r.cadence))
            /* The first step it is still asking for. */
            const next = complete ? null : r.steps.find((s) => !r.doneStepIds.includes(s.id))
            return (
              <div className={`panel routine-card is-shut${complete ? ' is-complete' : ''}`} key={r.id}>
                <div className="routine-tag">
                  <button className="routine-open" onClick={() => setOpenId(r.id)} aria-expanded={false}>
                    <SpaceMark space={r.space} always />
                    <span className="routine-card-title">{r.title}</span>
                  </button>
                  {status(r)}
                  {menu(r)}
                </div>
                {/* The step itself, drawn exactly as it is drawn inside the
                    routine, checkbox and all, so the first thing it asks of him
                    can be ticked without opening anything. */}
                <div className="routine-steplist is-peek">
                  {next ? (
                    <div className="routine-step">
                      {next.alts?.length ? (
                        <span className="routine-check is-blank" aria-hidden="true" />
                      ) : (
                        <button
                          className="routine-check"
                          role="checkbox"
                          aria-checked={false}
                          aria-label={next.title}
                          disabled={stepLocked(r, next.id)}
                          onClick={() => toggleRoutineStep(r.id, next.id)}
                        >
                          <Icon.Check size={12} strokeWidth={4.4} />
                        </button>
                      )}
                      <span className="routine-step-body">
                        <span className="l">
                          {next.title}
                          {next.kind === 'timer' && next.seconds ? <span className="routine-dur mono">{Math.round(next.seconds / 60)}m</span> : null}
                          {next.optional && <span className="step-optional mono">optional</span>}
                        </span>
                      </span>
                    </div>
                  ) : (
                    <p className="routine-peek-note">{complete ? 'All of it, done.' : 'No steps yet. Open the menu and write them.'}</p>
                  )}
                </div>
              </div>
            )
          }
          /* Every MORNING ritual gets the same guided format, whatever its
             workspace: one look for one kind of thing. A morning routine with
             no steps yet keeps the plain card, which is where steps are added. */
          if ((r.id === 'r-morning' || r.id === 'r-morningwork') && r.steps.length > 0 && editingId !== r.id) {
            return <MorningRoutine routine={r} key={r.id} onEdit={() => setEditingId(r.id)} onShut={() => setOpenId(r.id, false)} />
          }
          const { total } = routineProgress(r)
          const complete = routineComplete(r, periodKeyFor(r.cadence))
          return (
            <div className={`panel routine-card${complete ? ' is-complete' : ''}`} key={r.id}>
              <div className="routine-tag">
                <button className="routine-open is-open" onClick={() => { setOpenId(r.id, false); setEditingId(null) }} aria-expanded>
                  <SpaceMark space={r.space} always />
                  <span className="routine-card-title">{r.title}</span>
                </button>
                {editingId !== r.id && status(r)}
                {menu(r)}
              </div>
              {r.blurb && <p className="routine-blurb">{r.blurb}</p>}
              {editingId === r.id ? (
                <>
                  <StepEditor routine={r} />
                  <div className="routine-card-foot" style={{ marginTop: 'var(--s3)' }}>
                    <span className="assist-note">Changes save as you type.</span>
                    <button className="btn btn-primary routine-reset" onClick={() => setEditingId(null)}>Done</button>
                  </div>
                </>
              ) : (
              <>
              {/* One sentence; the card footer already says what finishing does. */}
              {total === 0 && (
                <p className="routine-empty">No steps yet. Open the menu and write them.</p>
              )}
              <div className="routine-steplist">
                {r.steps.map((s) => {
                  const checked = r.doneStepIds.includes(s.id)
                  return (
                    <div className={`routine-step${checked ? ' checked' : ''}`} key={s.id}>
                      {/* A step answered by a choice has no checkbox of its own:
                          it is ticked by the answer, and a second control that
                          could disagree with the answer is a bug waiting. */}
                      {s.alts?.length ? (
                        <span className="routine-check is-blank" aria-hidden="true" />
                      ) : (
                        <button className="routine-check" role="checkbox" aria-checked={checked} aria-label={s.title} onClick={() => toggleRoutineStep(r.id, s.id)}>
                          <Icon.Check size={12} strokeWidth={4.4} />
                        </button>
                      )}
                      <span className="routine-step-body">
                        <span className="l">
                          {s.title}
                          {s.kind === 'timer' && s.seconds ? <span className="routine-dur mono">{Math.round(s.seconds / 60)}m</span> : null}
                          {/* Says why this row is not in the count above. */}
                          {s.optional && <span className="step-optional mono">optional</span>}
                        </span>
                        {s.note && <span className="h">{s.note}</span>}
                        {s.example && <span className="ex mono">{s.example}</span>}
                        {s.link && <a className="routine-link" href={s.link} target="_blank" rel="noreferrer">{s.linkLabel ?? 'Open'} ↗</a>}
                        {/* A step whose work is a page of this app opens it,
                            rather than describing where to go. */}
                        {s.goto && (
                          <button className="routine-link" onClick={() => setPage(s.goto!)}>{s.gotoLabel ?? 'Open it'}</button>
                        )}
                        {s.alts?.length ? (
                          <span className="alt-set">
                            {s.alts.map((a, i) => {
                              const picked = r.stepChoice?.[s.id] === a.id
                              return (
                                <Fragment key={a.id}>
                                  {i > 0 && <span className="alt-or">or</span>}
                                  <button
                                    className={`alt-opt${picked ? ' picked' : ''}`}
                                    aria-pressed={picked}
                                    onClick={() => toggleRoutineAlt(r.id, s.id, a.id)}
                                  >
                                    <span className="alt-tick" aria-hidden="true" />
                                    <span className="alt-body">
                                      <span className="alt-l">{a.title}</span>
                                      {a.note && <span className="alt-h">{a.note}</span>}
                                    </span>
                                  </button>
                                </Fragment>
                              )
                            })}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  )
                })}
              </div>
              <div className="routine-card-foot">
                {/* No line about the habit it checks off. He knows: he wrote the
                    routine, and the same sentence on every card was noise. */}
                <span />
                {/* No reset. Clearing the checks used to un-finish the routine,
                    which deleted its row from the log and took back its habit
                    tick: a button that erased the fact he had done it. Starting
                    again is the only thing that ever made sense here, and only
                    for a routine meant to be run more than once a period. */}
                {complete && r.repeatable && (
                  <button className="btn btn-ghost routine-reset" onClick={() => startAgain(r.id)}>Do it again</button>
                )}
              </div>
              </>
              )}
            </div>
          )
  }

  return (
    <div className="page">
      <Band
        title="Routines"
        actions={
          <>
            <WriteTo />
            <button className="btn btn-primary" onClick={() => setAdding(true)}>Add a routine</button>
          </>
        }
      />
      <div className="routine-cards" ref={hereRef}>
        {here.length === 0 && <div className="empty">No routines in this workspace yet. Add one from the button above.</div>}
        {dealt(here, hereCols).map((col, i) => (
          <div className="routine-col" key={i}>{col.map(card)}</div>
        ))}
      </div>
      {elsewhere.length > 0 && (
        <>
          <div className="routine-split"><span className="mono">Other workspaces</span></div>
          <div className="routine-cards" ref={elseRef}>
            {dealt(elsewhere, elseCols).map((col, i) => (
              <div className="routine-col" key={i}>{col.map(card)}</div>
            ))}
          </div>
        </>
      )}

      {adding && <AddRoutineSheet onClose={() => setAdding(false)} />}
    </div>
  )
}

/* ---------------- GOALS ---------------- */


/* One sheet for creating and editing. `goal` edits an existing one; `presetHabitId`
   opens it prefilled from a habit, which is how "set a goal on this habit" works. */
function GoalSheet({ onClose, goal, presetHabitId, thenGoToGoals, periodOffsets }: {
  onClose: () => void
  goal?: Goal
  presetHabitId?: string
  /** Opened from a habit: show him the goal he just made, rather than saving
   *  it silently and leaving him staring at the page he started on. */
  thenGoToGoals?: boolean
  /** Where each column is looking. A goal added while browsing next week is
   *  FOR next week; that is what planning forward means. */
  periodOffsets?: Record<string, number>
}) {
  const { space, habits, addGoal, updateGoal, setPage } = useStore()
  const preset = habits.find((h) => h.id === presetHabitId)
  const [d, setD] = useState({
    name: goal?.name ?? (preset ? preset.name : ''),
    why: goal?.why ?? '',
    target: goal?.target ?? (preset ? habitTarget(preset) * 4 : 3),
    unit: goal?.unit ?? 'steps',
    deadline: goal?.deadline ?? '',
    timeframe: goal?.timeframe ?? ('monthly' as GoalTimeframe),
    category: goal?.category ?? ('life' as GoalCategory),
    habitId: goal?.habitId ?? presetHabitId ?? '',
  })
  /* Milestones existed in the data and on the card, but no sheet ever offered
     them, so the feature was unreachable. A goal made of milestones counts
     itself by ticking them: the target follows the list. */
  const [milestones, setMilestones] = useState<GoalMilestone[]>(goal?.milestones ?? [])
  const [msDraft, setMsDraft] = useState('')
  const addMs = () => {
    const t = msDraft.trim()
    if (!t) return
    setMilestones((prev) => [...prev, { id: `ms-${Date.now().toString(36)}-${prev.length}`, label: t, done: false }])
    setMsDraft('')
  }
  /* Only habits from the profile this goal is being written into. In All every
     habit was on offer, so a goal filed under Personal could count off a Work
     habit and then show a number nothing on that page could explain. */
  const linkable = [...habits.filter((h) => h.space === space && !h.paused && !h.archivedAt)].reverse()
  const linked = linkable.find((h) => h.id === d.habitId)

  const submit = () => {
    if (!d.name.trim()) return
    const shape = {
      name: d.name.trim(), target: Math.max(1, d.target),
      unit: d.habitId ? (linked && isTimeFed(linked) ? 'hours' : 'checkoffs') : (d.unit.trim() || 'steps'),
      why: d.why.trim() || undefined, deadline: d.deadline.trim() || undefined,
      timeframe: d.timeframe, category: d.category,
      habitId: d.habitId || undefined,
      periodKey: shiftPeriodKey(d.timeframe as GoalTf, d.timeframe === 'half' ? 0 : (periodOffsets?.[d.timeframe] ?? 0)),
      milestones,
      ...(milestones.length && !d.habitId ? { target: milestones.length, unit: 'milestones' } : {}),
    }
    if (goal) updateGoal(goal.id, shape)
    else addGoal({ space, current: 0, note: '', ...shape })
    onClose()
    if (thenGoToGoals) setPage('goals')
  }

  const tracking = Boolean(d.habitId)
  /* The name follows the habit until he writes his own, then it is his and the
     picker stops touching it. */
  const [namedByHand, setNamedByHand] = useState(Boolean(goal?.name))

  return (
    <Sheet title={goal ? 'Edit this goal' : 'Add a goal'} onClose={onClose}>
      {/* The first decision, not a dropdown three fields down: is this a goal you
          log yourself, or one of your habits counting itself? Asking it last is
          why it kept reading as "there is no way to pick a habit". */}
      <label className="field-label">What kind of goal?</label>
      <div className="kindpick">
        <button type="button" className={!tracking ? 'on' : ''} onClick={() => setD({ ...d, habitId: '' })}>
          <b>Something new</b>
          <span>You log the progress yourself</span>
        </button>
        <button
          type="button" className={tracking ? 'on' : ''}
          disabled={linkable.length === 0}
          title={linkable.length === 0 ? 'Create a habit first' : undefined}
          onClick={() => {
            const h = linkable.find((x) => x.id === d.habitId) ?? linkable[0]
            setD({ ...d, habitId: h?.id ?? '', name: namedByHand ? d.name : (h?.name ?? '') })
          }}
        >
          <b>Track one of my habits</b>
          <span>{linkable.length === 0 ? 'No habits yet' : 'It counts itself as you keep it'}</span>
        </button>
      </div>

      {tracking && (
        <>
          <label className="field-label" style={{ marginTop: 'var(--s4)' }} htmlFor="ghabit">Which habit?</label>
          <Select id="ghabit" style={{ width: '100%' }} value={d.habitId}
            onChange={(habitId) => {
              const h = linkable.find((x) => x.id === habitId)
              setD({ ...d, habitId, name: namedByHand ? d.name : (h?.name ?? '') })
            }}
            options={linkable.map((h) => ({ value: h.id, label: `${h.name}${h.kind === 'break' ? ' (quitting)' : ''}` }))} />
          <p className="assist-note" style={{ marginTop: 6 }}>
            {linked ? `Every time “${linked.name}” is kept, this goal moves. Nothing to log twice.` : ''}
          </p>
        </>
      )}

      <label className="field-label" style={{ marginTop: 'var(--s4)' }} htmlFor="gname">What is the outcome?</label>
      <input id="gname" className="textinput" style={{ width: '100%' }} autoFocus
        placeholder="e.g. Twelve gym sessions…" value={d.name}
        onChange={(e) => { setNamedByHand(true); setD({ ...d, name: e.target.value }) }}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />

      <label className="field-label" style={{ marginTop: 'var(--s4)' }} htmlFor="gwhy">Why does it matter?</label>
      <input id="gwhy" className="textinput" style={{ width: '100%' }}
        placeholder="The thing that keeps it alive when you do not feel like it…"
        value={d.why} onChange={(e) => setD({ ...d, why: e.target.value })} />

      {/* No area-of-life question. The category survives on the row only as a
         stored default; a goal already knows which space it lives in. */}
      <div style={{ marginTop: 'var(--s4)' }}>
        <label className="field-label" htmlFor="gtf">Timeframe</label>
        <Select id="gtf" style={{ width: '100%' }} value={d.timeframe}
          onChange={(v) => setD({ ...d, timeframe: v })}
          options={GOAL_TIMEFRAMES.map((t) => ({ value: t.id, label: `${t.label} · ${periodLabel(t.id as GoalTf)}` }))} />
      </div>

      <div className="sheet-grid" style={{ marginTop: 'var(--s4)' }}>
        <div>
          <label className="field-label" htmlFor="gtarget">Target</label>
          <div className="sheet-inline">
            <input id="gtarget" className="numinput" type="number" min={1} value={d.target}
              onChange={(e) => setD({ ...d, target: Math.max(1, Number(e.target.value) || 1) })} />
            {d.habitId
              ? <span className="sheet-unit">{linked && isTimeFed(linked) ? 'hours of focus' : 'checkoffs'}</span>
              : <input className="textinput" placeholder="unit, e.g. sessions…" value={d.unit}
                  onChange={(e) => setD({ ...d, unit: e.target.value })} aria-label="Unit" />}
          </div>
        </div>
        <div>
          <label className="field-label" htmlFor="gdl">By when</label>
          <input id="gdl" className="textinput" style={{ width: '100%' }} placeholder="e.g. End of July…"
            value={d.deadline} onChange={(e) => setD({ ...d, deadline: e.target.value })} />
        </div>
      </div>

      {/* Only for hand-logged goals: a habit-linked goal already counts itself. */}
      {!d.habitId && (
        <div style={{ marginTop: 'var(--s4)' }}>
          <label className="field-label" htmlFor="gms">Milestones, if it comes in steps</label>
          {milestones.length > 0 && (
            <div className="ms-list">
              {milestones.map((m) => (
                <div className="ms-row" key={m.id}>
                  <span className="grow">{m.label}</span>
                  <button className="sub-tool" aria-label={`Remove milestone: ${m.label}`}
                    onClick={() => setMilestones((prev) => prev.filter((x) => x.id !== m.id))}>Remove</button>
                </div>
              ))}
            </div>
          )}
          <div className="formrow">
            <input id="gms" className="textinput" style={{ flex: 1 }} placeholder="e.g. Outline written…"
              value={msDraft} onChange={(e) => setMsDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMs() } }} />
            <button className="btn btn-quiet" disabled={!msDraft.trim()} onClick={addMs}>Add</button>
          </div>
          {milestones.length > 0 && <p className="assist-note">The target becomes {milestones.length}: one per milestone, ticked on the goal card.</p>}
        </div>
      )}

      <div className="sheet-actions">
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!d.name.trim()} onClick={submit}>{goal ? 'Save changes' : 'Add goal'}</button>
      </div>
    </Sheet>
  )
}

/** What "move it to the one running now" is called, per timeframe. */
const TF_NOW: Record<GoalTimeframe, string> = {
  weekly: 'this week', monthly: 'this month', quarter: 'this quarter', half: 'this half',
}

/* What a period promised and did not deliver. A week that ends must not drop
   the things he put on it: they are still on his to-do list, but the PROMISE
   needs an answer, so it stands here until he gives one. Two answers, both
   honest: carry it into the period running now, or admit it is not happening
   and take it off. Nothing here is stored: acting on it removes it. */
function LeftBehind() {
  const { tasks, commitTask, inView } = useStore()
  const left = tasks.filter((t) => !t.done && inView(t.space) && t.horizon && t.horizonKey
    && periodIsPast(t.horizon as GoalTf, t.horizonKey))
  if (!left.length) return null
  return (
    <div className="panel left-behind">
      <div className="col-head">
        <span className="microcap">Left behind</span>
        <span className="col-tot mono">{left.length}</span>
      </div>
      {left.map((t) => {
        const tf = t.horizon as GoalTf
        return (
          <div className="lb-row" key={t.id}>
            <SpaceMark space={t.space} />
            <span className="grow">{t.title}</span>
            <span className="meta mono">{goalPeriodRange(tf, t.horizonKey!).label}</span>
            <button className="btn btn-quiet" onClick={() => commitTask(t.id, t.horizon, goalPeriodKey(tf))}>
              Move to {TF_NOW[t.horizon!]}
            </button>
            <button className="sub-tool" onClick={() => commitTask(t.id)}>Take off</button>
          </div>
        )
      })}
    </div>
  )
}

/* The work a period is for. Not a goal with a number on it and not a second
   copy of anything: the same tasks he already keeps in the plan, standing under
   the week or the month he promised them to. He ticks one in the plan and it is
   ticked here, because there is only ever one of it. */
function PeriodTasks({ tf, periodKey }: { tf: GoalTimeframe; periodKey: string }) {
  const { tasks, toggleTask, commitTask, addTask, space, inView } = useStore()
  const [adding, setAdding] = useState(false)
  const [q, setQ] = useState('')
  const mine = tasks.filter((t) => inView(t.space) && t.horizon === tf && t.horizonKey === periodKey)
  const list = [...mine.filter((t) => !t.done), ...mine.filter((t) => t.done)]
  const doneN = mine.filter((t) => t.done).length
  const term = q.trim().toLowerCase()
  /* What he can put here: anything open that is not already promised to a
     period. Something already promised to this month is not offered to this
     week as well, because then finishing it would fill two promises at once. */
  const offer = tasks
    .filter((t) => inView(t.space) && !t.done && !t.horizon && (!term || t.title.toLowerCase().includes(term)))
    .slice(0, 6)
  const put = (id: string) => { commitTask(id, tf, periodKey); setQ(''); setAdding(false) }
  const create = () => {
    const title = q.trim()
    if (!title) return
    addTask({ title, source: 'mc', estimateMin: 0, space, list: 'backlog', category: 'quick', horizon: tf, horizonKey: periodKey })
    setQ('')
    setAdding(false)
  }
  return (
    <div className="period-tasks">
      <div className="ptask-head">
        <span className="microcap">Tasks</span>
        {mine.length > 0 && <span className="col-tot mono">{doneN} of {mine.length} done</span>}
        <button
          className="goal-nav-btn ptask-add"
          aria-label={adding ? 'Close' : 'Put a task on this period'}
          aria-expanded={adding}
          onClick={() => { setAdding((a) => !a); setQ('') }}
        >
          {adding ? '×' : '+'}
        </button>
      </div>
      {list.map((t) => (
        <div className={`ptask${t.done ? ' done' : ''}`} key={t.id}>
          <button
            className="goal-ms-check"
            role="checkbox"
            aria-checked={t.done}
            aria-label={`${t.title}, ${t.done ? 'done' : 'not done'}`}
            onClick={() => toggleTask(t.id)}
          >
            {t.done && <Icon.Check size={10} strokeWidth={4.4} />}
          </button>
          <SpaceMark space={t.space} />
          <span className="grow">{t.title}</span>
          <button className="sub-tool" aria-label={`Take “${t.title}” off this period`} onClick={() => commitTask(t.id)}>Take off</button>
        </div>
      ))}
      {adding && (
        <div className="ptask-add-box">
          <input
            className="textinput"
            autoFocus
            placeholder="Find a task, or write a new one…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setAdding(false); setQ('') }
              if (e.key !== 'Enter') return
              e.preventDefault()
              // The one it is showing him wins; otherwise the words he typed
              // become a new task on the to-do list, promised to this period.
              if (offer.length === 1 && term) put(offer[0].id); else create()
            }}
            aria-label="Find a task, or write a new one"
          />
          {offer.length > 0 && (
            <div className="ptask-offer">
              {offer.map((t) => (
                <button key={t.id} className="ptask-offer-row" onClick={() => put(t.id)}>
                  <SpaceMark space={t.space} />
                  <span className="grow">{t.title}</span>
                  <span className="mono meta">{t.list === 'today' ? 'today' : 'to-do'}</span>
                </button>
              ))}
            </div>
          )}
          {term && <button className="btn btn-quiet ptask-new" onClick={create}>Add “{q.trim()}” as a new task</button>}
        </div>
      )}
    </div>
  )
}

export function GoalsPage() {
  const { space, goals, habits, habitLog, focusSessions, slips, bumpGoal, toggleGoalMilestone, deleteGoal, repeatGoal, inView } = useStore()
  const all = goals.filter((g) => inView(g.space))
  /* A goal belongs to a period. The ones whose period has ended are not deleted
     and do not keep counting: they sit below with the number they finished on. */
  const spaceGoals = all.filter((g) => !g.closed)
  const past = all.filter((g) => g.closed).sort((a, b) => (a.closed!.on < b.closed!.on ? 1 : -1))
  /* Which period each column is looking at, as steps from now. Zero is today;
     back shows what a finished period ended on, forward is where next week's
     goals are planned before next week exists. Half-year stays put. */
  const [offsets, setOffsets] = useState<Record<string, number>>({})
  const shift = (tf: string, d: number) => setOffsets((o) => ({ ...o, [tf]: (o[tf] ?? 0) + d }))
  const nowOf = (g: Goal) => goalCurrent(g, habits, habitLog, goalPeriodRange((g.timeframe ?? 'quarter') as GoalTf, g.periodKey ?? goalPeriodKey((g.timeframe ?? 'quarter') as GoalTf)), slips, focusSessions)
  const done = spaceGoals.filter((g) => nowOf(g) >= g.target).length
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Goal | null>(null)
  /* "Set it again" used to give no sign a click had landed -- same page,
     same list, nothing visibly changed -- so he clicked it a dozen times
     and got a dozen duplicate goals before he noticed. Flashing the goal
     it lands on (new or already there) is the fix he asked for: it does
     not have to disappear from Finished periods, there just has to be a
     visible answer to "did that work." */
  const [flashGoalId, setFlashGoalId] = useState<string | null>(null)
  const setAgain = (id: string) => {
    const landedId = repeatGoal(id)
    if (!landedId) return
    setFlashGoalId(landedId)
    document.querySelector(`[data-goal-id="${landedId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    window.setTimeout(() => setFlashGoalId((cur) => (cur === landedId ? null : cur)), 2600)
  }

  return (
    <div className="page">
      <Band
        title="Goals"
        metrics={[{ v: `${done}/${spaceGoals.length}`, k: 'reached', tone: (done > 0 ? 'pos' : 'info') as 'pos' | 'info' }]}
        actions={<><WriteTo /><button className="btn btn-primary" onClick={() => setAdding(true)}>Add a goal</button></>}
      />

      <LeftBehind />

      {/* THE LADDER, his pick from the redesign artifact on 2026-08-26.

          The four stretches were four cards, each holding whatever it held and
          each drawing its own header, so no two lines ever aligned and three of
          them were usually empty. They are BANDS now, week at the top through
          half year at the bottom, and a goal is a ROW in one shared grid. That
          is the actual fix for the misalignment he reported: alignment is
          structural rather than something to keep tidying by hand.

          Everything the cards carried is still here. A row keeps the space
          mark, the category dot, the pace badge and the menu; the why, the
          habit link, the milestones and the manual logger drop to a second line
          under the row that only exists when there is something to put in it. */}
      <div className="goal-ladder">
        {GOAL_TIMEFRAMES.map((tfr) => {
          const off = tfr.id === 'half' ? 0 : (offsets[tfr.id] ?? 0)
          const shownKey = shiftPeriodKey(tfr.id as GoalTf, off)
          const inTf = all.filter((g) => (g.timeframe ?? 'quarter') === tfr.id
            && (g.periodKey ?? goalPeriodKey(tfr.id as GoalTf)) === shownKey)
          const reached = inTf.filter((g) => (g.closed ? g.closed.final : nowOf(g)) >= g.target).length
          return (
            <section className="goal-band" key={tfr.id}>
              <header className="gb-head">
                {/* Paged away from now, "This week" would be a lie over last
                    week's dates. The label follows the period being shown. */}
                <h2 className="gb-name">
                  {off === 0 ? tfr.label : `${off < 0 ? 'An earlier' : 'A coming'} ${tfr.id === 'weekly' ? 'week' : tfr.id === 'monthly' ? 'month' : 'quarter'}`}
                </h2>
                <span className="gb-range">{periodLabel(tfr.id as GoalTf, shownKey)}</span>
                {inTf.length > 0 && (
                  <span className="gb-tally">{reached}<i>/{inTf.length}</i> reached</span>
                )}
                {tfr.id !== 'half' && (
                  <span className="gb-nav">
                    <button className="goal-nav-btn" aria-label={`Earlier ${tfr.label.toLowerCase()}`} onClick={() => shift(tfr.id, -1)}>‹</button>
                    {off !== 0 && <button className="goal-nav-btn now" onClick={() => setOffsets((o) => ({ ...o, [tfr.id]: 0 }))}>now</button>}
                    <button className="goal-nav-btn" aria-label={`Later ${tfr.label.toLowerCase()}`} onClick={() => shift(tfr.id, 1)}>›</button>
                  </span>
                )}
              </header>

              {inTf.length === 0 && (
                <p className="gb-none">
                  {off < 0 ? 'No goals were set for this one.'
                    : off > 0 ? 'Nothing planned here yet.'
                      : 'Nothing set for this stretch.'}
                </p>
              )}

              {inTf.map((g) => {
                const current = nowOf(g)
                const fromHabit = habits.find((h) => h.id === g.habitId)
                const pct = Math.min(100, Math.round((current / g.target) * 100))
                const dailyCap = !!fromHabit && !isTimeFed(fromHabit)
                const status = goalPace(current, g.target, g.timeframe ?? 'quarter', new Date(), dailyCap)
                const milestoneDriven = !!g.milestones?.length && g.target === g.milestones.length
                const statusLabel = off > 0 ? 'planned'
                  : g.closed ? (g.closed.final >= g.target ? 'reached' : `ended at ${fmtNum(g.closed.final)}`)
                    : status === 'done' ? 'reached' : status === 'behind' ? 'needs a push' : 'on pace'
                const hasDetail = !!g.why || !!fromHabit || !!g.deadline || !!(g.milestones && g.milestones.length)
                return (
                  <div className={`goal-item${flashGoalId === g.id ? ' flash' : ''}`} key={g.id} data-goal-id={g.id}>
                    <div className="goal-row">
                      <span className="gr-name">
                        <SpaceMark space={g.space} />
                        <span className={`cat-dot goalcat-${g.category ?? 'life'}`} aria-hidden="true" />
                        <span className="gr-obj">{g.name}</span>
                      </span>
                      <span className="gr-count mono">{fmtNum(current)}<i>/{fmtNum(g.target)}</i></span>
                      <span className={`bar prog${status === 'behind' ? ' warn' : ''}`}><i style={{ width: `${pct}%` }} /></span>
                      <span className="gr-pct">{pct}<i>%</i></span>
                      <span className={`goal-status s-${status}`}>{statusLabel}</span>
                      {!milestoneDriven && !g.habitId ? (
                        <span className="goal-bump" role="group" aria-label={`Log progress for ${g.name}`}>
                          <button onClick={() => bumpGoal(g.id, -1)} disabled={current <= 0} aria-label="Less">−</button>
                          <button onClick={() => bumpGoal(g.id, 1)} disabled={current >= g.target} aria-label="More">+</button>
                        </span>
                      ) : <span />}
                      <Dropdown label={`Options for ${g.name}`}>
                        <button role="menuitem" onClick={() => setEditing(g)}>Edit this goal</button>
                        <button role="menuitem" className="danger" onClick={() => deleteGoal(g.id)}>Delete this goal</button>
                      </Dropdown>
                    </div>
                    {hasDetail && (
                      <div className="goal-detail">
                        {g.why && <p className="goal-why">{g.why}</p>}
                        {fromHabit && <p className="goal-linked">Counts itself from the “{fromHabit.name}” habit.</p>}
                        {g.deadline && <p className="goal-deadline">by {/^\d{4}-\d{2}-\d{2}$/.test(g.deadline) ? fmtWhen(g.deadline) : g.deadline}</p>}
                        {g.milestones && g.milestones.length > 0 && (
                          <ul className="goal-ms">
                            {g.milestones.map((m) => (
                              <li className={`goal-ms-item${m.done ? ' done' : ''}`} key={m.id}>
                                <button
                                  className="goal-ms-check"
                                  role="checkbox"
                                  aria-checked={m.done}
                                  aria-label={`${m.label}, ${m.done ? 'done' : 'not done'}`}
                                  onClick={() => toggleGoalMilestone(g.id, m.id)}
                                >
                                  {m.done && <Icon.Check size={10} strokeWidth={4.4} />}
                                </button>
                                <span>{m.label}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              <PeriodTasks tf={tfr.id} periodKey={shownKey} />
            </section>
          )
        })}
      </div>

      {/* Where last week's goals went. They keep the number they finished on, and
          any of them can be set again for the period we are in now. */}
      {past.length > 0 && (
        <>
          <div className="sechead" style={{ marginTop: 'var(--s6)' }}>
            <span className="microcap">Finished periods</span>
            <span className="section-count mono">{past.length}</span>
          </div>
          <div className="panel">
            <div className="rowlist">
              {past.map((g) => {
                const tf = (g.timeframe ?? 'quarter') as GoalTf
                const label = goalPeriodRange(tf, g.periodKey ?? '').label
                const hit = g.closed!.final >= g.target
                return (
                  <div className="rowitem past-goal" key={g.id}>
                    <span className="grow">{g.name}</span>
                    <span className="meta">{label}</span>
                    <span className={`mono ${hit ? 'val-pos' : 'val-urgent'}`}>{fmtNum(g.closed!.final)} of {fmtNum(g.target)}</span>
                    <button className="btn btn-quiet" onClick={() => setAgain(g.id)}>Set it again</button>
                    <Dropdown label={`Options for ${g.name}`}>
                      <button role="menuitem" className="danger" onClick={() => deleteGoal(g.id)}>Delete this goal</button>
                    </Dropdown>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {adding && <GoalSheet periodOffsets={offsets} onClose={() => setAdding(false)} />}
      {editing && <GoalSheet goal={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
