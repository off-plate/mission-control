export type SpaceId = 'personal' | 'work' | 'offplate' | 'corner'

/** What you are looking at. 'all' is not a space anything can belong to: it is a
 *  view across the three. Storage always uses SpaceId, never this. */
export type ViewId = SpaceId | 'all'

export const SPACES: SpaceId[] = ['personal', 'work', 'offplate', 'corner']

export function isSpace(v: ViewId): v is SpaceId {
  return v !== 'all'
}

/** One shared on-track threshold, so Goals, Review and the widget never disagree. */
export const ON_TRACK_PCT = 50

export type PageId =
  | 'today'
  | 'plan'
  | 'assistant'
  | 'habits'
  | 'routines'
  | 'goals'
  | 'money'
  | 'review'
  | 'coach'
  | 'stats'
  | 'settings'
  | 'brand'
  | 'notes'
  /** The old address of the Brain Dump board. Kept so a bookmark still lands
   *  somewhere real: the route walks it to Notes. */
  | 'braindump'
  | 'calendar'
  | 'board'
  /** Focus blocks: the history, and the ones he wants to fix. */
  | 'focus'
  /** One day of the record, read-only. Carries a date in the route. */
  | 'day'

export type WidgetType =
  | 'clock'
  | 'agenda'
  | 'tasks'
  | 'mail'
  | 'finance'
  | 'habits'
  | 'training'
  | 'goals'
  | 'timesaved'
  | 'claude'
  | 'social'
  | 'sources'
  | 'outreach'

export type SizeKey = 'S' | 'M' | 'T' | 'L' | 'XL'

/** Widget sizes in grid cells (one cell is roughly 230px square). */
export const SIZE_UNITS: Record<SizeKey, { w: number; h: number }> = {
  S: { w: 1, h: 1 },
  M: { w: 2, h: 1 },
  T: { w: 1, h: 2 },
  L: { w: 2, h: 2 },
  XL: { w: 4, h: 2 },
}

export interface WidgetInstance {
  id: string
  type: WidgetType
  size: SizeKey
}

export interface WidgetDef {
  type: WidgetType
  title: string
  description: string
  supportedSizes: SizeKey[]
  defaultSize: SizeKey
  /** Freshness in minutes at demo load; null means human-entered data. */
  freshMinutes: number | null
  staleAfter: number
  /** Page this widget deep-links to. */
  page: PageId
}

export type TaskCategory = 'call' | 'admin' | 'deep' | 'quick'

export type TimeSlot = 'morning' | 'noon' | 'afternoon' | 'evening'

/* Each part of the day is a real span of hours, not a vague word: `from` and
   `to` are the clock, and the hint is written from them so the label and the
   capacity can never disagree. Morning starts at 6 and evening stops at
   midnight, which is his own bed-by-midnight rule, so a night that runs past it
   is over budget by definition. */
export const SLOTS: { id: TimeSlot; label: string; hint: string; from: number; to: number }[] = [
  { id: 'morning', label: 'Morning', hint: '6 AM to noon', from: 6, to: 12 },
  { id: 'noon', label: 'Noon', hint: '12 to 2 PM', from: 12, to: 14 },
  { id: 'afternoon', label: 'Afternoon', hint: '2 to 6 PM', from: 14, to: 18 },
  { id: 'evening', label: 'Evening', hint: '6 PM to midnight', from: 18, to: 24 },
]
/** How many minutes that part of the day actually holds. */
export const slotMinutes = (id: TimeSlot): number => {
  const s = SLOTS.find((x) => x.id === id)
  return s ? (s.to - s.from) * 60 : 0
}

export interface SubTask {
  id: string
  title: string
  estimateMin: number
  done: boolean
  /** Minutes it actually took, logged on completion. */
  actualMin?: number
}

export interface Task {
  id: string
  title: string
  source: 'ticktick' | 'trello' | 'jira' | 'mc'
  estimateMin: number
  done: boolean
  actualMin?: number
  space: SpaceId
  list: 'today' | 'backlog'
  category: TaskCategory
  /** Which time-of-day bucket on the Today plan; undefined = not yet placed. */
  slot?: TimeSlot
  /** Optional breakdown; the task's real estimate is the sum of these when present. */
  subtasks?: SubTask[]
  /** 'HH:MM' if the user pinned it to a clock time (feeds the Calendar link). */
  at?: string
  /** True once a real estimate exists, set by the estimate action or a breakdown.
   *  Without it a number is just a leftover default, so it is not shown as one. */
  estimated?: boolean
  /** ISO date the task first appeared. Ageing is how avoidance gets detected. */
  createdAt?: string
  /** The day it was put on the list. Without this, "today" means "every day I
   *  ever moved this to today", which is what it used to mean. */
  plannedOn?: string
  /** How many days it has been carried forward without being finished. */
  carried?: number
  /** The moment it was finished, so the day's record can say WHEN, not only
   *  that. Cleared if it is reopened. */
  doneAt?: string
  /** Committed to a period on the Goals page: "this is one of the things this
   *  month is for". There is no second copy of the task anywhere: finishing it
   *  in the plan is what finishes it there, because it is the same task.
   *  horizonKey pins WHICH month ('2026-08'), the same way a goal does, so a
   *  week that ends does not quietly drag its unfinished work into the next
   *  one as though he had planned it there. */
  horizon?: GoalTimeframe
  horizonKey?: string
}

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
  /** A page of this app the step opens, for a step whose work IS a page here:
   *  "review last week" belongs in Reflect, not in a second place that asks
   *  the same question. */
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

export type GoalTimeframe = 'weekly' | 'monthly' | 'quarter' | 'half'
export type GoalCategory = 'money' | 'health' | 'life' | 'work' | 'offplate' | 'habits'

/* No `sub` here any more. It held "Q3 2026" and "by year end" as literal
   strings, so from October onwards the app would have been naming the wrong
   quarter with total confidence. Which period this is gets computed from the
   date at render time: see periodLabel(). */
export const GOAL_TIMEFRAMES: { id: GoalTimeframe; label: string }[] = [
  { id: 'weekly', label: 'This week' },
  { id: 'monthly', label: 'This month' },
  { id: 'quarter', label: 'This quarter' },
  { id: 'half', label: 'Half year' },
]

export const GOAL_CATEGORIES: { id: GoalCategory; label: string }[] = [
  { id: 'money', label: 'Money' },
  { id: 'health', label: 'Health' },
  { id: 'life', label: 'Life' },
  { id: 'work', label: 'Work' },
  { id: 'offplate', label: 'Off-Plate' },
  { id: 'habits', label: 'Habits' },
]

/** A sticky note on the old Brain Dump board. Kept only so a state saved before
 *  Notes existed can still be read and carried across; nothing writes one now. */
export interface Idea {
  id: string
  /** Which space this note belongs to. */
  space: SpaceId
  text: string
  when: string
  color: string
}

/* ---- Notes ----------------------------------------------------------------
   Two levels, and only two. The top level is one folder per workspace and it is
   NOT stored: it is computed from the spaces that exist. That way a workspace
   added later has its folder the moment it exists, two devices cannot each
   invent their own copy of the same folder, and there is no way to delete the
   floor a note is standing on. Everything in `noteFolders` is a folder he made
   himself, and every one of them names its workspace folder as its parent. */

/** The id of a workspace's top-level folder. Derived, never stored. */
export const spaceFolderId = (s: SpaceId) => `nf-space-${s}`

/** A folder he made, always inside a workspace folder. */
export interface NoteFolder {
  id: string
  space: SpaceId
  name: string
  /** The workspace folder it sits in. Always set: nothing nests deeper. */
  parentId: string
  order?: number
}

/** A note. Tags are NOT a field: they are read out of `body` every time it
 *  renders, so the text he typed is the only place a tag lives and the two can
 *  never drift apart. */
export interface Note {
  id: string
  /** Follows the folder. The folder decides the space; the row caches it. */
  space: SpaceId
  folderId: string
  title: string
  body: string
  color: string
  /** The day it was written. */
  when: string
  updatedAt: number
  pinned?: boolean
  /** Short hashes of the bodies this note has already had, oldest first. This is
   *  what lets the merge tell a copy that is merely behind from one that has
   *  genuinely diverged, instead of crying conflict on every ordinary save. */
  hist?: string[]
  /** A body from another device that lost the merge. Kept on the note, shown,
   *  and dropped only when he says so. Work is never the loser. */
  conflict?: { body: string; at: number }
}

export interface GoalMilestone {
  id: string
  label: string
  done: boolean
}

export interface Goal {
  id: string
  space: SpaceId
  /** The objective: a specific outcome, not an activity. */
  name: string
  current: number
  target: number
  unit: string
  note: string
  timeframe?: GoalTimeframe
  category?: GoalCategory
  /** Why it matters, the motivation that keeps it alive. */
  why?: string
  /** Target date within the timeframe. */
  deadline?: string
  /** The concrete steps that ladder up to the objective. */
  milestones?: GoalMilestone[]
  /** Track this goal straight off a habit: every checkoff counts toward it, so
   *  "twelve gym sessions" fills itself as you tick the gym habit. */
  habitId?: string
  /** The period this goal was set for: '2026-W31', '2026-07', '2026-Q3'. A goal
   *  for this week is for THIS week. Without it, a weekly goal was a rolling
   *  seven days that never ended and never went anywhere. */
  periodKey?: string
  /** Set when its period ended, with the number it finished on, so a past goal
   *  keeps its result instead of quietly continuing to count. */
  closed?: { on: string; final: number }
}

/** Weeks of habit history a goal's timeframe covers. */
const TIMEFRAME_WEEKS: Record<GoalTimeframe, number> = { weekly: 1, monthly: 4, quarter: 13, half: 26 }

/**
 * A goal's real progress. When it is tied to a habit, the number is counted
 * from that habit's checkoffs over the goal's own window, so you never log the
 * same thing twice. Otherwise it is whatever the goal itself holds.
 */
/** Does this habit measure TIME rather than days: kept by the focus clock, or
 *  filled by focus minutes. A goal on such a habit is a goal about hours. */
export function isTimeFed(h: HabitDef): boolean {
  return h.auto?.from === 'focus' || (h.kind === 'measured' && h.source === 'focus')
}

export function goalCurrent(g: Goal, habits: HabitDef[], log?: HabitTick[], range?: { from: string; to: string }, slips: HabitSlip[] = [], sessions: FocusSession[] = []): number {
  // A closed goal keeps the number it finished on. It is history, not a counter.
  if (g.closed) return g.closed.final
  if (!g.habitId) return g.current
  const h = habits.find((x) => x.id === g.habitId)
  if (!h) return g.current
  /* Counted from the dated ticks inside the goal's own period. The old sum of
     this week's array plus N undated weekly counts was a rolling window that
     never ended, which is why a weekly goal never rolled over. */
  if (range && isTimeFed(h)) {
    /* HOURS of focus inside the period, not days it happened on: a goal of 3 on
       a time habit means three hours, and it fills itself from the blocks. */
    const mins = sessions.filter((s) => s.day >= range.from && s.day <= range.to && s.space === h.space)
      .reduce((a, s) => a + s.minutes, 0)
    return Math.min(g.target, Math.round((mins / 60) * 10) / 10)
  }
  if (log && range) {
    const kept = h.kind === 'break'
      ? quitKeptDays(h, slips, range.from, range.to).size
      : keptDaysIn(log, h.id, range.from, range.to).size
    return Math.min(g.target, kept)
  }
  const thisWeek = h.days.filter(Boolean).length
  const weeks = TIMEFRAME_WEEKS[g.timeframe ?? 'quarter']
  const past = (h.history ?? []).slice(-(weeks - 1)).reduce((a, n) => a + n, 0)
  return Math.min(g.target, thisWeek + (weeks > 1 ? past : 0))
}

export interface LedgerEntry {
  id: string
  title: string
  category: TaskCategory
  estimateMin: number
  actualMin: number
  when: string
  /** Which profile the work belonged to (older rows have none). */
  space?: SpaceId
  /** ISO week, so "time saved this week" means this week. */
  weekKey?: string
}

export interface AgendaEvent {
  id: string
  start: string
  end: string
  title: string
  where?: string
}

export interface Obligation {
  id: string
  name: string
  monthly: string
  remaining: string
  progressPct: number
  state: 'agreed' | 'waiting' | 'action needed'
  next: string
}

export interface SocialEntry {
  platform: string
  followers: number
  change: number
  lastPost: string
}

export interface SourceState {
  id: string
  name: string
  kind: string
  status: 'connected' | 'off' | 'manual'
  detail: string
}

/** The factual look at an avoided thing: what it is, what it takes, what ignoring it costs. */
export interface CoachFacts {
  avoiding: string
  steps: string
  cost: string
}

/** A common avoided thing, pre-drafted so Coach can start from a real example. */
export interface CoachScenario {
  id: string
  title: string
  tag: string
  blurb: string
  facts: CoachFacts
  firstStep: string
  firstStepMin: number
  category: TaskCategory
}

/** A thing you actually faced: the facts you named, the first step you took, and,
 *  once you check back, whether you did it and how it really felt. */
export interface CoachSession {
  id: string
  /** Profile the loop was opened in (older sessions have none and show everywhere). */
  space?: SpaceId
  title: string
  facts: CoachFacts
  firstStep: string
  taskId: string | null
  when: string
  status: 'open' | 'closed'
  didIt?: boolean
  felt?: 'easier' | 'as-feared' | 'harder'
  reflection?: string
}

export interface PlanState {
  /** The day work last came back to the list, and how much, so Plan can say so
   *  once rather than letting it happen silently. */
  returnedOn?: string
  returnedCount?: number
  /** Which ones. Without the ids, "show me" had nothing to show. */
  returnedIds?: string[]
  committedDate: string | null
  firstMoveId: string | null
}

/** Where the assistant put a dictated item, so you can see and undo it. */
export interface AssistantItem {
  id: string
  kind: 'task' | 'goal' | 'done'
  label: string
  tab: PageId
}
export interface AssistantEntry {
  id: string
  text: string
  when: string
  items: AssistantItem[]
}

/* `lastWeekKey` and `previous` used to live here. Nothing read either: the first
   was written on every close and never asked for, the second was declared and
   never written at all. Fields that look like state but are not are how the next
   change gets built on a lie, so they are gone. `reflections` is the record. */
export interface ReviewState {
  lastDoneDate: string | null
  wins: string[]
  outcomes: string[]
  /** Every window he has closed, newest first. One shape for all of them, so a
   *  week and a month are the same act over a different span. */
  reflections?: Reflection[]
}

export interface Reflection {
  id: string
  /** Set when a later close replaced this one. Nothing is ever removed. */
  supersededBy?: string
  /** Which window it covered, in words, e.g. 'Last week, Mon 20 Jul to Sun 26 Jul'. */
  label: string
  from: string
  to: string
  /** The day he closed it. */
  when: string
  wins: string[]
  /** The honest "what drifted" note. Its own field: it used to ride in wins[3],
   *  and with an empty win above it the reopen loader promoted self-criticism
   *  into a win. */
  drifted?: string
  outcomes: string[]
}
