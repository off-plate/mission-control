import { goalPeriodKey, goalPeriodRange } from '../util'
import type { PageId, SpaceId, TimeSlot } from './core'

/** One of the ways a step can be answered. Which one he picked is worth keeping:
 *  a month of "caffeine" every morning is the routine telling him something. */
export interface RoutineAlt {
  id: string
  title: string
  note?: string
}

export interface RoutineStep {
  id: string
  title: string
  /** 'timer' shows a countdown; 'do' is a guided step you mark done. */
  kind: 'timer' | 'do'
  seconds?: number
  note?: string
  /** e.g. a tongue-twister to read aloud. */
  example?: string
  /** Worth doing, not required. It does not hold the routine open and it does
   *  not count towards the routine's own total, so skipping it costs nothing
   *  and doing it never leaves the count short of the finish line. */
  optional?: boolean
  /** A habit this step keeps. Ticking the step keeps the habit for the day and
   *  unticking gives it back, without the step's routine having to own it: the
   *  same habit can be fed by a step in several routines. */
  habitId?: string
  /** Two ways to answer one step. "Move or caffeine" is a single step with a
   *  choice inside it, not two steps of which one gets skipped every day.
   *  Picking any one of them satisfies the step. */
  alts?: RoutineAlt[]
  /** optional external tool to open (typing test, etc.). */
  link?: string
  linkLabel?: string
  /** A page of this app the step opens, for a step whose work IS a page here,
   *  rather than a second place asking the same question. */
  goto?: PageId
  gotoLabel?: string
}

/** How often a habit is meant to happen. Drives its weekly target. */
export type HabitFrequency = 'daily' | 'weekdays' | 'times-per-week' | 'weekly' | 'monthly'

export const HABIT_FREQUENCIES: { id: HabitFrequency; label: string }[] = [
  { id: 'daily', label: 'Every day' },
  { id: 'weekdays', label: 'Monday to Friday' },
  { id: 'times-per-week', label: 'A few times a week' },
  { id: 'weekly', label: 'Once a week' },
  { id: 'monthly', label: 'Once a month' },
]

/* Two opposite things are both called habits. One you are trying to keep, and
   every day you do it is a win. One you are trying to stop, and every day you
   do NOT do it is the win. They cannot share a scoreboard. */
export type HabitKind = 'build' | 'break' | 'measured'

/** What fills a measured habit. Focus time is the only source for now; the shape
 *  is here so a second one does not need a migration. */
export type HabitSource = 'focus'

/** A habit nothing has to tick: it is kept by something the app already
 *  measures. Focus time is the first, and the threshold is the habit's own. */
export interface AutoRule { from: 'focus'; minutes: number }

export type CountPeriod = 'day' | 'week' | 'month'

export const COUNT_PERIODS: { id: CountPeriod; label: string }[] = [
  { id: 'day', label: 'a day' },
  { id: 'week', label: 'a week' },
  { id: 'month', label: 'a month' },
]

/** True when a measured habit counts occurrences rather than minutes. */
export function isCounted(h: HabitDef): boolean {
  return h.kind === 'measured' && h.measure === 'times'
}

/** How many of a counted habit he is aiming for in its period. */
export function countTarget(h: HabitDef): number {
  return Math.max(1, h.targetCount ?? 1)
}

/** How many times a habit was logged inside a window. Every row counts, not
 *  every day: three walks on Tuesday are three, which is the whole point of a
 *  target written in times rather than in days. */
export function countIn(log: HabitTick[], habitId: string, from: string, to: string): number {
  return log.filter((t) => t.habitId === habitId && t.day >= from && t.day <= to).length
}

/**
 * A day a habit was kept. This is the durable record; `days[]` on the habit is a
 * cache of the current week rebuilt from these on load. The week array alone
 * cannot answer "how have I done over a hundred days", and `history[]` is twelve
 * undated counts, so neither could ever be the truth.
 */
/** One day a habit was kept. `src` names the routine step that ticked it, as
 *  `routineId:stepId`. Two routines can keep the same habit on the same day
 *  (meditation sits in the morning routine AND in Out Brain Rot), and undoing
 *  one of them must not undo the other, so each writes its own row. A tick he
 *  made by hand on the Habits page has no src. The day is kept as long as any
 *  row survives; counting the rows is how often he did it. */
export interface HabitTick {
  habitId: string
  day: string
  src?: string
  /** The moment the tick was made, only when it was made ON its day. A past
   *  day ticked by hand on Friday has no honest clock time, so it gets none. */
  at?: string
}

/** How many times a habit was kept on one day, not merely whether it was. */
export function habitCountOn(log: HabitTick[], habitId: string, day: string): number {
  return log.filter((t) => t.habitId === habitId && t.day === day).length
}

/** The days a habit was kept inside a window, as a set of ISO dates. */
export function keptDaysIn(log: HabitTick[], habitId: string, from: string, to: string): Set<string> {
  return new Set(log.filter((t) => t.habitId === habitId && t.day >= from && t.day <= to).map((t) => t.day))
}

/**
 * The run of consecutive days up to today. Today not being ticked yet does not
 * break a run: at nine in the morning nothing is done, and telling him a hundred
 * day streak is over because he has not done it *yet* is a lie with a guilt
 * mechanic attached.
 */
export function currentStreak(log: HabitTick[], habitId: string, today = new Date()): number {
  const kept = new Set(log.filter((t) => t.habitId === habitId).map((t) => t.day))
  const key = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (!kept.has(key(d))) d.setDate(d.getDate() - 1)  // today is still open
  let n = 0
  while (kept.has(key(d))) { n++; d.setDate(d.getDate() - 1) }
  return n
}

/** The longest run this habit has ever had. */
export function bestStreak(log: HabitTick[], habitId: string): number {
  const days = [...new Set(log.filter((t) => t.habitId === habitId).map((t) => t.day))].sort()
  let best = 0, run = 0, prev = ''
  for (const day of days) {
    if (prev) {
      const [y, m, d] = prev.split('-').map(Number)
      const next = new Date(y, m - 1, d + 1)
      const nextKey = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
      run = day === nextKey ? run + 1 : 1
    } else run = 1
    prev = day
    if (run > best) best = run
  }
  return best
}

/** A day a routine was finished, kept so "which day did I do it" has an answer. */
/** One completed run of a routine. `run` counts runs within the period, so a
 *  routine done three times in a day leaves three rows rather than one row
 *  overwritten twice. Finishing it again must never cost him the earlier one. */
export interface RoutineDone { routineId: string; day: string; periodKey: string; run?: number; at?: string }

/** How many times a routine was finished on one day. */
export function routineRunsOn(log: RoutineDone[], routineId: string, day: string): number {
  return log.filter((r) => r.routineId === routineId && r.day === day).length
}

/**
 * A number a routine step recorded on a day: today's typing speed, and anything
 * else measured the same way later. `stepData` holds only the current period and
 * `records` only the all-time maximum, so every score between the first and the
 * best was thrown away and no progression could ever be drawn.
 */
/** One step of one routine, ticked on one day. The routine's own doneStepIds is
 *  wiped at every rollover, so without this a routine he got halfway through on
 *  Monday is indistinguishable on Tuesday from one he never opened. Value-free:
 *  StepEntry next door records NUMBERS a step produced, which is a different
 *  question and must not be polluted with ones and zeroes. */
export interface StepTick {
  routineId: string
  stepId: string
  day: string
}

export interface StepEntry {
  routineId: string
  stepId: string
  day: string
  /** The moment it was logged. Two runs in one day are two runs. */
  at?: string
  value: number
}

/** How a single day's plan actually went, stamped once at rollover, before the
 *  leftover tasks lose their day and become un-attributable backlog. Written
 *  going forward only -- there is nothing to backfill for a day that already
 *  rolled before this existed. */
export interface DayTaskLog {
  date: string
  planned: number
  done: number
}

/** Every run of one step, oldest first. It used to keep one per day, so a second
 *  attempt the same morning erased the first one. */
export function stepSeries(log: StepEntry[], routineId: string, stepId: string): StepEntry[] {
  return log
    .filter((e) => e.routineId === routineId && e.stepId === stepId)
    .sort((a, b) => (a.at ?? a.day).localeCompare(b.at ?? b.day))
}

/** A finished focus block. Kept as history, not just a count, so a measured
 *  habit can be filled from it and the week can be looked back at. */
export interface FocusSession {
  id: string
  /** Local date, so a block at 23:50 belongs to that day and not to UTC's. */
  day: string
  minutes: number
  /** What it was for, when it was started from a task. */
  label?: string
  space: SpaceId
  /** The ledger row this block wrote, so editing or deleting the block can keep
   *  the ledger honest instead of leaving an orphan behind. */
  ledgerId?: string
  /** When the block finished, so the history can say when as well as how long. */
  at?: string
}

export interface HabitDef {
  id: string
  /** Which space this habit belongs to. */
  space: SpaceId
  /** Building something, or quitting something. Undefined behaves as 'build'. */
  kind?: HabitKind
  /** The day it was retired. An archived habit is off the page but its history
   *  stays readable, so deleting a habit no longer erases the days you kept it. */
  archivedAt?: string
  /** Migrated away: the last day you slipped, as one overwritable date. Slips
   *  are HabitSlip records now; this is read once on load and then left alone. */
  lastSlip?: string
  /** The day he stopped. Every day since counts itself as kept. */
  quitSince?: string
  /** The day he started keeping it: the Keep and Amount answer to quitSince. A
   *  habit added today did not fail the ninety days before it existed, so the
   *  trail counts its chances from here and the card says when it began. */
  startedOn?: string
  /** The start date whose days have already been written into the log. Kept so
   *  the fill happens once per date: a day he unticks afterwards stays
   *  unticked, and a date he moves gets its new stretch filled. */
  filledSince?: string
  name: string
  /** Mon..Sun of the current week. */
  days: boolean[]
  paused: boolean
  /** Checkoffs per week for the last 12 weeks, oldest first (0-7). */
  history?: number[]
  /** Part of day this habit belongs to; undefined = anytime. */
  daypart?: TimeSlot
  /** How often it is meant to happen; undefined behaves as daily. */
  frequency?: HabitFrequency
  /** Days a week you are aiming for, when frequency is 'times-per-week'. */
  targetPerWeek?: number
  /** For a 'measured' habit: minutes a day you are aiming for. */
  dailyTargetMin?: number
  /** What a measured habit counts. Minutes come from focus sessions, so they
   *  only ever fitted work you sit and time. Times are things you DO, logged one
   *  tap each, which is what most of them actually are. Absent means minutes,
   *  because that is what every measured habit was before this existed. */
  measure?: 'minutes' | 'times'
  /** For a 'times' habit: the stretch the target is counted over. */
  per?: CountPeriod
  /** For a 'times' habit: how many in that stretch. */
  targetCount?: number
  /** Kept automatically once the day's measured total reaches the threshold.
   *  He should not have to tick a box to confirm what the app already timed. */
  auto?: AutoRule
  /** What fills it, when it fills itself. */
  source?: HabitSource

  /* ---- a habit inside a folder ----
     His model, 2026-08-11: "routines are just a folder of different habits.
     Together in the folder they make a routine. If a habit doesn't have a
     folder it is just a habit." So a routine IS a folder (the Routine row
     carries its id, title, space and cadence), and what used to be its STEPS
     are habits pointing back at it. Everything below is what a step carried
     and a habit did not, kept because he asked for it by name: "it should
     still consist of short description if it was previously... there is
     links for typing tests, so there should be link to that still. The video
     doesn't have to be video, it has to be a link to that video." */
  /** The folder (routine) this habit belongs to. Absent = a loose habit. */
  folderId?: string
  /** Its order inside the folder, so a routine keeps the sequence he wrote. */
  folderOrder?: number
  /** The step's short description. */
  note?: string
  /** e.g. a tongue-twister to read aloud. */
  example?: string
  /** An external tool the step opened: the typing test, a video. */
  link?: string
  linkLabel?: string
  /** A page of this app the step opened, when the work IS a page here. */
  goto?: PageId
  gotoLabel?: string
  /** Worth doing, not required: it never holds its folder open. */
  optional?: boolean
  /** Two ways to answer one habit ("move or caffeine"). Doing either keeps it.
   *  One habit, not two, because it is one either-or and not two streaks. */
  alts?: RoutineAlt[]
  /** A timer step's length, so the length survives the move to a habit. */
  seconds?: number
  /** Cannot be ticked by hand until something is true elsewhere (the typing
   *  test is earned at 75 WPM). Without this it becomes a box he can just
   *  tick, which is not what the step meant. */
  gatedBy?: 'typing-wpm'
  /** The step this habit was made from. A number logged against the habit has
   *  to land in the SAME dated series the step writes, or the typing scores
   *  from before the merge and the ones after it become two unrelated lines
   *  about the same test. */
  srcStepId?: string
  /** Content the step generated fresh for the day, which no note and no link
   *  can stand in for: today's real news paragraphs to read aloud, today's
   *  tongue twisters. Without this the habit is a checkbox where the work used
   *  to be. */
  runner?: 'pronunciation' | 'stretch'
}

/** Where a habit's numbers are filed: the routine it came out of and the step
 *  it used to be. Kept as one function because three surfaces need the same
 *  answer and a second copy of this rule is a second answer. */
export function habitStepKey(h: HabitDef): { routineId: string; stepId: string } | null {
  if (!h.srcStepId) return null
  return { routineId: h.folderId ?? h.id, stepId: h.srcStepId }
}

/** The number this habit has to beat, when it is judged by a number and not by
 *  a tick. Null means it is an ordinary habit. */
export function habitGate(h: HabitDef): { unit: string; target: number } | null {
  if (h.gatedBy !== 'typing-wpm') return null
  return { unit: 'WPM', target: TYPING_TARGET_WPM }
}

/** The best number this habit recorded on one day, or null if it recorded none.
 *  The best and not the last: two attempts in a morning and the faster one is
 *  the one he did, exactly as the routine used to read it. */
export function habitNumberOn(log: StepEntry[], h: HabitDef, day: string): number | null {
  const key = habitStepKey(h)
  if (!key) return null
  const runs = log.filter((e) => e.routineId === key.routineId && e.stepId === key.stepId && e.day === day)
  return runs.length ? Math.max(...runs.map((e) => e.value)) : null
}

/** A gated habit stays locked until the day's number clears the target. This is
 *  the rule the old routine ran and the merge dropped: without it the typing
 *  test is a box he can tick, which is not what the step meant. */
export function habitLocked(h: HabitDef, log: StepEntry[], day: string): boolean {
  const gate = habitGate(h)
  if (!gate) return false
  return (habitNumberOn(log, h, day) ?? 0) < gate.target
}

/** Minutes of focus logged on a given day, in this habit's profile. */
export function focusMinutesOn(sessions: FocusSession[], day: string, space: SpaceId): number {
  return sessions.filter((s) => s.day === day && s.space === space).reduce((a, s) => a + s.minutes, 0)
}

/** How far through its daily target a measured habit is on a given day, 0..1. */
export function measuredProgress(h: HabitDef, sessions: FocusSession[], day: string): number {
  const target = h.dailyTargetMin ?? 60
  if (target <= 0) return 0
  return Math.min(1, focusMinutesOn(sessions, day, h.space) / target)
}

/** Minutes as h/m, kept here so the type layer can label itself. */
function fmtMins(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}

/** Days a week this habit is actually aiming for. The X/7 was a lie for
 *  anything that was never meant to happen seven days a week. */
/** Does this habit ask anything of the given weekday (0 = Monday)? The Habits
 *  page opens with this count and so does Today, so it lives in one place: two
 *  copies of the rule is two answers to "what is still open today". */
/** A weekly or monthly habit is kept for its period the moment the dated log has
 *  an entry inside that period's own date range, read straight off the log
 *  rather than off the 7-slot day-of-week cache. The cache only ever holds ONE
 *  week; a month is four or five of those, so "was it done this week" and "was
 *  it done this month" are different questions, and the cache can only answer
 *  the first one. Conflating them is what made a monthly review read as done
 *  on whichever day you happened to be looking, days after it actually was. */
export function keptThisPeriod(h: HabitDef, log: HabitTick[], now = new Date()): boolean {
  if (h.frequency !== 'weekly' && h.frequency !== 'monthly') return false
  const tf = h.frequency === 'monthly' ? 'monthly' : 'weekly'
  const key = goalPeriodKey(tf, now)
  const range = goalPeriodRange(tf, key)
  return keptDaysIn(log, h.id, range.from, range.to).size > 0
}

export function dueOn(h: HabitDef, weekdayIndex: number, log: HabitTick[]): boolean {
  if (h.paused || h.kind === 'break') return false
  if (h.frequency === 'weekdays' && weekdayIndex >= 5) return false
  // Once a week or once a month, and already kept: nothing is due.
  if ((h.frequency === 'weekly' || h.frequency === 'monthly') && keptThisPeriod(h, log)) return false
  return true
}

export function habitTarget(h: HabitDef): number {
  if (h.frequency === 'weekdays') return 5
  if (h.frequency === 'weekly' || h.frequency === 'monthly') return 1
  if (h.frequency === 'times-per-week') return Math.max(1, Math.min(7, h.targetPerWeek ?? 3))
  return 7
}

/**
 * A day you slipped on a habit you are quitting. One record per day, kept for
 * good. `lastSlip` held ONE date, so the second slip erased the first: a quit
 * with four slips in it looked identical to one with a single slip, and the
 * clean run before each of them was gone. This is the same move as HabitTick,
 * for the same reason.
 */
export interface HabitSlip { habitId: string; day: string }

/** The days this habit was slipped on, as a set of ISO dates. */
export function slipDays(slips: HabitSlip[], habitId: string): Set<string> {
  return new Set(slips.filter((s) => s.habitId === habitId).map((s) => s.day))
}

const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * Which days of the current week count as kept for a habit you are quitting.
 * Every day from the day you stopped up to today is a day you did not do it, so
 * it fills itself; you only come back to it on a day you slip. Future days stay
 * blank because they have not happened.
 */
export function quitDays(h: HabitDef, slips: HabitSlip[], today = new Date()): boolean[] {
  const out = [false, false, false, false, false, false, false]
  if (h.kind !== 'break' || !h.quitSince) return out
  const [y, m, d] = h.quitSince.split('-').map(Number)
  if (!y) return out
  const since = new Date(y, m - 1, d)
  const slipped = slipDays(slips, h.id)
  const todayIdx = (today.getDay() + 6) % 7
  const monday = new Date(today)
  monday.setDate(monday.getDate() - todayIdx)
  for (let i = 0; i <= todayIdx; i++) {
    const day = new Date(monday)
    day.setDate(monday.getDate() + i)
    // Any slip on or after the quit date breaks that day; it is not kept.
    out[i] = day >= since && !slipped.has(isoOf(day))
  }
  return out
}

/** The days inside a window that a quit habit was kept, derived rather than
 *  ticked: every day from the day he stopped, minus every day he logged a slip. */
export function quitKeptDays(h: HabitDef, slips: HabitSlip[], from: string, to: string, today = isoOf(new Date())): Set<string> {
  const out = new Set<string>()
  if (h.kind !== 'break' || !h.quitSince) return out
  const start = h.quitSince > from ? h.quitSince : from
  const [y, m, d] = start.split('-').map(Number)
  if (!y) return out
  /* Only days that have actually happened. Counting the window's future days
     as clean handed a monthly quit goal all thirty days at birth, so it was
     REACHED on the 1st before the month had asked anything of him. */
  const end = to < today ? to : today
  const slipped = slipDays(slips, h.id)
  for (const cur = new Date(y, m - 1, d); ; cur.setDate(cur.getDate() + 1)) {
    const key = isoOf(cur)
    if (key > end) break
    if (!slipped.has(key)) out.add(key)
  }
  return out
}

/** Days clean, counted from the day he stopped, or from his most recent slip. */
export function daysClean(h: HabitDef, slips: HabitSlip[], today = new Date()): number | null {
  if (h.kind !== 'break') return null
  const last = [...slipDays(slips, h.id)].sort().pop()
  const from = last && h.quitSince && last > h.quitSince ? last : h.quitSince
  if (!from) return null
  const [y, m, d] = from.split('-').map(Number)
  if (!y) return null
  const then = new Date(y, m - 1, d)
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.max(0, Math.round((now.getTime() - then.getTime()) / 86400000))
}

/**
 * The longest clean run since he stopped. With one overwritten date this could
 * only ever be the current run, so a quit that reached 60 days and then slipped
 * reported its best as 1. Every stretch between slips is now on the record.
 */
export function bestCleanRun(h: HabitDef, slips: HabitSlip[], today = new Date()): number {
  if (h.kind !== 'break' || !h.quitSince) return 0
  const [y, m, d] = h.quitSince.split('-').map(Number)
  if (!y) return 0
  const slipped = slipDays(slips, h.id)
  const end = isoOf(new Date(today.getFullYear(), today.getMonth(), today.getDate()))
  let best = 0, run = 0
  for (const cur = new Date(y, m - 1, d); isoOf(cur) <= end; cur.setDate(cur.getDate() + 1)) {
    if (slipped.has(isoOf(cur))) run = 0
    else if (++run > best) best = run
  }
  return best
}

/** How many days he has slipped since he stopped, so the honest count is visible. */
export function slipCount(h: HabitDef, slips: HabitSlip[]): number {
  const since = h.quitSince
  return [...slipDays(slips, h.id)].filter((d) => !since || d >= since).length
}

export function habitFrequencyLabel(h: HabitDef): string {
  if (h.auto?.from === 'focus') return `over ${Math.round(h.auto.minutes / 60 * 10) / 10}h of focus a day`
  if (isCounted(h)) return `${countTarget(h)}x ${COUNT_PERIODS.find((p) => p.id === (h.per ?? 'day'))!.label}`
  if (h.kind === 'measured') return `${fmtMins(h.dailyTargetMin ?? 60)} a day`
  if (h.frequency === 'weekdays') return 'Mon to Fri'
  if (h.frequency === 'weekly') return 'once a week'
  if (h.frequency === 'monthly') return 'once a month'
  if (h.frequency === 'times-per-week') return `${habitTarget(h)}x a week`
  return 'every day'
}

/** How often a routine runs. Drives the sections on the Routines page. */
export type RoutineCadence = 'daily' | 'prework' | 'weekly' | 'monthly'

/** A named checklist you run on repeat. Checking every step marks it done for
 *  the period; if it mirrors a habit, that habit checks off automatically. */
export interface Routine {
  id: string
  /** Which space this routine belongs to. */
  space: SpaceId
  /** The day it was retired. Its record of which days it was finished stays. */
  archivedAt?: string
  title: string
  cadence: RoutineCadence
  blurb?: string
  steps: RoutineStep[]
  /** If set, completing this routine checks that habit off for today. */
  habitId?: string
  /** Step ids checked so far this period. */
  doneStepIds: string[]
  /** Which period the checks belong to (day / ISO week / month). When the
   *  current period differs, the checks reset automatically. */
  periodKey?: string
  /** Numbers a step recorded this period, e.g. today's typing speed. Cleared
   *  with the checks when the period rolls over. */
  stepData?: Record<string, number>
  /** For a step that offers a choice, the alt he picked this period. */
  stepChoice?: Record<string, string>
  /** Can be run more than once in its period. The morning routine happens once
   *  and is then done for the day; Out Brain Rot is a reset he may need three
   *  times before dinner. Only a repeatable routine offers to start again, and
   *  starting again keeps every run before it. */
  repeatable?: boolean
  /** Which run of this period the current checks belong to. Runs before it are
   *  finished and recorded; this counter is what keeps their records apart. */
  run?: number
  /** The moment the first step was ticked, as an ISO timestamp. A routine is not
   *  on his day until he has actually started it, and it lands in the part of
   *  the day he started it in. Cleared with the checks at the period roll, so
   *  every day begins with nothing claiming to be underway. */
  startedAt?: string
  /** Put on a day's list on purpose, before it was started. Starting a routine
   *  files it under the clock; PLANNING one is the other direction, and its slot
   *  is where he wants it to happen rather than where it happened. Carries its
   *  day, so yesterday's plan cannot haunt this morning. */
  planned?: { day: string; slot?: TimeSlot }
  /** The day the mirror last ticked this routine's habit, as an ISO date. A
   *  weekly routine finished on Tuesday must clear TUESDAY when it is undone on
   *  Friday, not whatever day happens to be today. */
  completedOn?: string | null
}

/** Is this routine finished for the period it is currently in? An empty routine
 *  is never complete: there is nothing to have done. */
export function routineComplete(r: Routine, currentPeriodKey: string): boolean {
  if (r.periodKey !== currentPeriodKey) return false
  return r.steps.length > 0 && requiredSteps(r).every((s) => r.doneStepIds.includes(s.id))
}

/** The steps that actually have to happen. A routine made entirely of optional
 *  steps would otherwise be finished before it started, so in that case every
 *  step counts and the word optional means nothing, which is the honest read. */
export function requiredSteps(r: Routine): RoutineStep[] {
  const need = r.steps.filter((s) => !s.optional)
  return need.length ? need : r.steps
}

/** How far through a routine he is, counting only what it needs. Counting the
 *  optional ones too would park a finished routine at five of six. */
export function routineProgress(r: Routine): { done: number; total: number } {
  const need = requiredSteps(r)
  return { done: need.filter((s) => r.doneStepIds.includes(s.id)).length, total: need.length }
}

/** What today actually asks of him, counted in FOLDERS rather than in raw
 *  habits, plus how many of them are done.
 *
 *  Since routines became folders of habits there are two honest ways to count
 *  the same morning and they give wildly different answers: fifty-odd habits,
 *  or the fourteen things those habits actually group into. A folder is ONE
 *  thing to do, the way the routine it came from was, so fourteen is the
 *  number a person can hold in their head and feel move.
 *
 *  It lives here because both Today and the Habits page print it as a headline
 *  and they were computing it separately: Today collapsed folders and said
 *  "1/14" while Habits counted raw rows and said "1/64", on the same screen,
 *  about the same day. Today's file even carried a comment promising the rule
 *  was "imported rather than rewritten, so the two can never disagree". It was
 *  not imported. Now it is, and that comment is true.
 *
 *  `visible` is the caller's already-filtered list (workspace, not archived),
 *  because each page has its own idea of what is on screen and only the
 *  counting rule is shared. */
export function habitsDueToday(
  visible: HabitDef[],
  routines: { id: string; habitId?: string }[],
  log: HabitTick[],
  todayIndex: number,
): { due: number; kept: number } {
  const dueRaw = visible.filter((h) => dueOn(h, todayIndex, log))
  const folderIds = new Set(dueRaw.map((h) => h.folderId).filter(Boolean) as string[])
  /* A routine's own habit belongs to the folder as its streak, so it never
     appears as a row of its own. */
  const folderHabitIds = new Set(routines.map((r) => r.habitId).filter(Boolean) as string[])
  const folders = [...folderIds]
    .map((id) => {
      // Optional habits never hold a folder open.
      const need = dueRaw.filter((h) => h.folderId === id && !h.optional)
      return { total: need.length, done: need.filter((h) => h.days[todayIndex]).length }
    })
    .filter((f) => f.total > 0)
  const loose = dueRaw.filter((h) => !h.folderId && !folderHabitIds.has(h.id))
  return {
    due: folders.length + loose.length,
    kept: folders.filter((f) => f.done === f.total).length + loose.filter((h) => h.days[todayIndex]).length,
  }
}

/** Steps that cannot be ticked by hand until something is true. The typing test
 *  is earned at 75 WPM, and that has to hold on every surface, not only on the
 *  one where the rule happens to be written. */
export function stepLocked(r: Routine, stepId: string): boolean {
  if (stepId !== 'mr4') return false
  return (r.stepData?.mr4 ?? 0) < TYPING_TARGET_WPM
}

/** The typing step is only done once you actually hit the number. */
export const TYPING_TARGET_WPM = 75

/** What a measured step's number means, so a chart of it can label its own axis
 *  and draw the line you are chasing. Steps not listed here are just numbers. */
export const STEP_UNITS: Record<string, { unit: string; target?: number }> = {
  mr4: { unit: 'WPM', target: TYPING_TARGET_WPM },
}

