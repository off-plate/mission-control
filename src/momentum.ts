/* MOMENTUM.

   His model, 2026-08-27: the flywheel must turn itself. Every real thing he did
   that day earns points, the points make momentum, momentum is the speed of the
   wheel. Skipping is not merely a smaller gain, it is a penalty, and a day where
   he logged nothing at all takes half the wheel with it.

   TWO RULES THAT SHAPE EVERYTHING HERE.

   1. Momentum is DERIVED, never stored. It is recomputed by replaying the log
      day by day, so it can never drift out of step with the data, it survives a
      sync from another device, and correcting a missed tick three days late
      corrects the wheel too. A stored counter would have been half the code and
      permanently, quietly wrong.

   2. Every source is CAPPED. Without caps one twelve-hour Saturday outscores a
      fortnight of ordinary days, and the wheel would reward binges over exactly
      the consistency it exists to measure.

   HIS FIVE COLUMNS, revised 2026-08-27 after he read the first build:
   finances, health, tasks, focus, the hard thing. Two of those are display
   only and say so.

   FINANCES IS NOT SCORED. It is read from Compass and shown, because he asked
   to watch the big number move, but a debt payment is a standing order that
   fires once a month. Scoring it would spike the wheel on the 15th for
   something he did in March, which is the opposite of a consistency measure.

   HEALTH IS NOT SCORED YET. This app holds no session data; Hevy syncs into
   Jarvis. `POINTS.workout` is wired and weighted and always scores zero, left
   visible rather than hidden so the baseline is honest about what it is not
   counting.

   BREAK HABITS ARE GONE from the model, on his instruction the same day: the
   "held clean" column meant nothing to him and was never in the brief. They
   were also the only PASSIVE source here, earned by not doing something, which
   is what made the empty-day rule so awkward to get right the first time. */
import { localDateKey } from './util'
import { type HabitDef, type HabitTick, type FocusSession, type SpaceId, type Task } from './types'

/** What one of each thing is worth, and the most any of them can be worth in a day. */
export const POINTS = {
  habit: 10,        // one habit kept
  task: 6,          // one task finished
  focusPer10: 4,    // per ten minutes of focus
  hard: 12,         // the thing that had been waiting: see HARD_MIN_DAYS
  workout: 25,      // reserved: see the note above
} as const
export const CAPS = {
  habit: 5,         // see HABIT_TARGET below
  task: 5,          // five tasks is a full day of tasks; the sixth is free
  focusMin: 240,    // four hours is a full day of focus
} as const

/* THE HARD THING IS NOT A FIELD HE HAS TO FILL IN, and it is not invented.

   It is the oldest thing he finished that day. A task that sat on the list for
   nine days and finally went is the hard thing by definition; asking him to
   nominate one every evening would just be a sixth thing to skip. The rule the
   rest of the app already uses is that avoidance is measured by AGE, so this
   uses the same measure rather than a second one. */
export const HARD_MIN_DAYS = 7

/* THE BASELINE DOES NOT SCALE WITH HOW MANY HABITS HE TRACKS, and this is the
   most important decision in the file.

   The first version asked for every daily habit. He tracks more than forty, so
   a genuinely good day scored about a seventh of the bar, every day came out a
   penalty, and the wheel sat at zero on thirty days of real effort. That is the
   same failure as the page that told him 11 of 42: arithmetically defensible,
   useless to look at, and it punishes him for the crime of tracking things.

   So a full day is a FIXED, reachable shape: five habits, three tasks, two
   hours of focus, one thing that had been waiting. Tracking a sixth habit
   cannot make yesterday worse. */
export const HABIT_TARGET = 5
export const TASK_TARGET = 3
export const FOCUS_TARGET_MIN = 120
export const HARD_TARGET = 1

/** How a day's ratio moves the wheel. His shape: reward the full day, pay a
 *  little for most of it, and charge for the rest. */
export const GAIN = 4.2
export const FRICTION = 0.985      // what the wheel loses to a day simply passing
export const EMPTY_WIPE = 0.5      // a day with nothing logged halves it
export const CEILING = 100

/** Half a full day is what counts as a day kept, and what the chain is made of. */
export const KEPT_AT = 0.5

export type HardThing = { title: string; waited: number }

export type DayScore = {
  day: string
  earned: number
  baseline: number
  ratio: number
  parts: { habits: number; tasks: number; focus: number; hard: number; workout: number }
  counts: { habits: number; habitTarget: number; tasks: number; focusMin: number }
  hard: HardThing | null
  /** What this day did to the wheel, in momentum points. Negative is a penalty. */
  delta: number
  momentum: number
  /** Nothing at all was logged. The harshest case, and the one that halves it. */
  empty: boolean
  /** Did this day count towards the chain. */
  kept: boolean
}

type Input = {
  habits: HabitDef[]
  habitLog: HabitTick[]
  tasks: Task[]
  focusSessions: FocusSession[]
  /* Matches the store's own signature exactly. Widening it to `string` forces a
     cast at every call site and hides real type errors. */
  inView: (s?: SpaceId) => boolean
}

const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }

/** The curve. Full day pays, most of a day pays a little, half a day costs. */
export function curveFor(ratio: number): number {
  if (ratio >= 1) return 1
  if (ratio >= 0.75) return 0.6
  if (ratio >= 0.5) return 0.15
  if (ratio >= 0.25) return -0.25
  return -0.5                       // he did something, but barely
}

/**
 * Replay the log and return one row per day, oldest first, each carrying the
 * momentum as it stood at the end of that day.
 */
export function momentumRun(input: Input, days = 60, today = new Date()): DayScore[] {
  const { habits, habitLog, tasks, focusSessions, inView } = input

  const build = habits.filter((h) => inView(h.space) && !h.archivedAt && !h.paused && h.kind !== 'break' && h.frequency === 'daily')
  const buildIds = new Set(build.map((h) => h.id))
  const habitTarget = Math.min(build.length, HABIT_TARGET)

  /* One pass each, then every day below is a lookup rather than a scan. */
  const keptByDay = new Map<string, Set<string>>()
  for (const t of habitLog) {
    if (!buildIds.has(t.habitId)) continue
    if (!keptByDay.has(t.day)) keptByDay.set(t.day, new Set())
    keptByDay.get(t.day)!.add(t.habitId)
  }

  const doneByDay = new Map<string, number>()
  const hardByDay = new Map<string, HardThing>()
  for (const t of tasks) {
    if (!t.done || !t.doneAt || !inView(t.space)) continue
    const finished = new Date(t.doneAt)
    const k = localDateKey(finished)
    doneByDay.set(k, (doneByDay.get(k) ?? 0) + 1)
    /* How long it waited. `createdAt` is the day it first appeared; a task with
       no createdAt is not assumed old, it is assumed new, because guessing the
       other way would manufacture hard things out of imported rows. */
    if (!t.createdAt) continue
    const born = new Date(`${t.createdAt}T00:00:00`)
    const waited = Math.floor((finished.getTime() - born.getTime()) / 86400000)
    if (waited < HARD_MIN_DAYS) continue
    const held = hardByDay.get(k)
    if (!held || waited > held.waited) hardByDay.set(k, { title: t.title, waited })
  }

  const focusByDay = new Map<string, number>()
  for (const f of focusSessions) {
    if (!inView(f.space)) continue
    focusByDay.set(f.day, (focusByDay.get(f.day) ?? 0) + f.minutes)
  }

  /* What a full day asks of him. Fixed across the window so a day is scored
     against the same bar every time, and a day is never easier just because he
     happened to finish fewer tasks that week. */
  const baseline =
    habitTarget * POINTS.habit +
    TASK_TARGET * POINTS.task +
    (FOCUS_TARGET_MIN / 10) * POINTS.focusPer10 +
    HARD_TARGET * POINTS.hard

  const out: DayScore[] = []
  let m = 0
  for (let i = days; i >= 0; i--) {
    const day = localDateKey(addDays(today, -i))
    const hkRaw = keptByDay.get(day)?.size ?? 0
    const hk = Math.min(CAPS.habit, hkRaw)
    const tk = Math.min(CAPS.task, doneByDay.get(day) ?? 0)
    const fm = Math.min(CAPS.focusMin, focusByDay.get(day) ?? 0)
    const hard = hardByDay.get(day) ?? null

    const parts = {
      habits: hk * POINTS.habit,
      tasks: tk * POINTS.task,
      focus: Math.round((fm / 10) * POINTS.focusPer10),
      hard: hard ? POINTS.hard : 0,
      workout: 0,                            // see the note at the top
    }
    const earned = parts.habits + parts.tasks + parts.focus + parts.hard + parts.workout
    const ratio = baseline > 0 ? earned / baseline : 0

    const before = m
    m *= FRICTION
    if (earned === 0) m *= EMPTY_WIPE
    else m += GAIN * curveFor(ratio)
    m = Math.max(0, Math.min(CEILING, m))

    out.push({
      day, earned, baseline, ratio, parts, hard,
      counts: { habits: hkRaw, habitTarget, tasks: doneByDay.get(day) ?? 0, focusMin: focusByDay.get(day) ?? 0 },
      delta: +(m - before).toFixed(2),
      momentum: +m.toFixed(2),
      empty: earned === 0,
      kept: ratio >= KEPT_AT,
    })
  }
  return out
}

/** Where the wheel stands right now. */
export function momentumNow(run: DayScore[]): number {
  return run.length ? run[run.length - 1].momentum : 0
}

/* ------------------------------------------------------------------ chains */

export type Chain = {
  /** Days on the run right now. */
  current: number
  /** The best run inside the window. Not "ever": the window is what is loaded. */
  longest: number
  /** Today is not over. It has not broken the chain, it has not extended it. */
  todayPending: boolean
  /** How many more days at this rate to beat the record. 0 once it is beaten. */
  toBeat: number
}

/** The chain, counted off the end of the run.
 *
 *  TODAY IS NOT COUNTED AGAINST HIM. At nine in the morning today is empty by
 *  definition, and a chain that reads zero every morning and six every evening
 *  is a chain that punishes him for waking up. So today extends the chain when
 *  it is already kept and is otherwise left out of the arithmetic entirely. */
export function chainOf(run: DayScore[]): Chain {
  if (run.length === 0) return { current: 0, longest: 0, todayPending: false, toBeat: 0 }
  const today = run[run.length - 1]
  const past = run.slice(0, -1)

  let longest = 0, streak = 0
  for (const r of past) {
    if (r.kept) { streak++; if (streak > longest) longest = streak }
    else streak = 0
  }
  let current = streak
  const todayPending = !today.kept
  if (today.kept) { current += 1; if (current > longest) longest = current }

  return { current, longest, todayPending, toBeat: Math.max(0, longest - current + 1) }
}

/* --------------------------------------------------------------- roll-ups */

export type Zoom = 'd' | 'w' | 'm'

export type Period = {
  key: string
  /** The big figure on the rung: 27, or Wk 35, or Aug. */
  label: string
  /** The small one under it: Wed, or the date range. */
  sub: string
  earned: number
  baseline: number
  ratio: number
  counts: { habits: number; habitTarget: number; tasks: number; focusMin: number }
  /** How many hard things were done across the period, and the biggest one. */
  hardCount: number
  hard: HardThing | null
  keptDays: number
  totalDays: number
  delta: number
  momentum: number
  empty: boolean
  kept: boolean
  /** Every day inside it, newest first, so a card can open. */
  days: DayScore[]
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dateOf = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d) }

/** ISO week number, so a week that straddles a month still groups as one week. */
function isoWeek(d: Date): { year: number; week: number } {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() + 4 - (x.getDay() || 7))
  const start = new Date(x.getFullYear(), 0, 1)
  return { year: x.getFullYear(), week: Math.ceil(((x.getTime() - start.getTime()) / 86400000 + 1) / 7) }
}

function dayToPeriod(r: DayScore): Period {
  const d = dateOf(r.day)
  return {
    key: r.day,
    label: String(d.getDate()),
    sub: WD[d.getDay()],
    earned: r.earned, baseline: r.baseline, ratio: r.ratio,
    counts: r.counts,
    hardCount: r.hard ? 1 : 0, hard: r.hard,
    keptDays: r.kept ? 1 : 0, totalDays: 1,
    delta: r.delta, momentum: r.momentum,
    empty: r.empty, kept: r.kept,
    days: [r],
  }
}

/** A WEEK IS NOT SEVEN DAYS OF POINTS DIVIDED BY SEVEN, and that distinction is
 *  the whole reason the zoom is worth having.
 *
 *  The ratio of a period is its total earned over the total it was asked for, so
 *  a week with two blank days genuinely reads worse than one without, instead of
 *  a mean of ratios where a 0 and a 1 average out to a passable 0.5. The delta
 *  is the sum of what the days actually did to the wheel, and the momentum is
 *  where the wheel stood on the last day of the period, not an average of it. */
export function rollUp(run: DayScore[], zoom: Zoom): Period[] {
  if (zoom === 'd') return run.map(dayToPeriod)

  const groups = new Map<string, DayScore[]>()
  for (const r of run) {
    const d = dateOf(r.day)
    const key = zoom === 'w'
      ? (() => { const { year, week } = isoWeek(d); return `${year}-W${String(week).padStart(2, '0')}` })()
      : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(r)
  }

  return [...groups.entries()].map(([key, days]) => {
    const earned = days.reduce((a, r) => a + r.earned, 0)
    const baseline = days.reduce((a, r) => a + r.baseline, 0)
    const hardDays = days.filter((r) => r.hard)
    const biggest = hardDays.reduce<HardThing | null>((best, r) => (!best || r.hard!.waited > best.waited ? r.hard : best), null)
    const first = dateOf(days[0].day), last = dateOf(days[days.length - 1].day)
    return {
      key,
      label: zoom === 'w' ? `Wk ${key.slice(-2).replace(/^0/, '')}` : MO[last.getMonth()],
      sub: zoom === 'w'
        ? `${first.getDate()} ${MO[first.getMonth()]} – ${last.getDate()} ${MO[last.getMonth()]}`
        : String(last.getFullYear()),
      earned, baseline,
      ratio: baseline > 0 ? earned / baseline : 0,
      counts: {
        habits: days.reduce((a, r) => a + r.counts.habits, 0),
        habitTarget: days[0].counts.habitTarget * days.length,
        tasks: days.reduce((a, r) => a + r.counts.tasks, 0),
        focusMin: days.reduce((a, r) => a + r.counts.focusMin, 0),
      },
      hardCount: hardDays.length,
      hard: biggest,
      keptDays: days.filter((r) => r.kept).length,
      totalDays: days.length,
      delta: +days.reduce((a, r) => a + r.delta, 0).toFixed(2),
      momentum: days[days.length - 1].momentum,
      empty: earned === 0,
      kept: baseline > 0 && earned / baseline >= KEPT_AT,
      days: [...days].reverse(),
    }
  })
}

/** What the wheel is called at this speed. Thresholds are the story: nothing
 *  happens for a while, then things start coming loose one after another. */
export const STATES: { at: number; label: string }[] = [
  { at: 0, label: 'Cold' },
  { at: 8, label: 'Turning over' },
  { at: 22, label: 'Carrying itself' },
  { at: 48, label: 'Hard to stop' },
  { at: 78, label: 'Runs without you' },
]
export function stateFor(m: number): string {
  let s = STATES[0].label
  for (const x of STATES) if (m >= x.at) s = x.label
  return s
}


/* ------------------------------------------------------------- projection */

/* THE TWO FUTURES ARE COMPUTED, NOT WRITTEN.

   The give-up screen used five hand-written stops, which meant the same five
   sentences whatever he had actually been doing. Both lives are now run
   forward from HIS rate through the same model that scores the past, so the
   difference on the screen is the difference his own log implies and nothing
   else. If he improves, the good side improves. If he has been coasting, it
   says so, and the screen is worth less to him, which is correct.

   THE DRIFT SIDE COMES FROM THE SAME MODEL. It is the empty-day rule applied
   day after day: friction, then half of what is left. */

export type Future = {
  momentum: number
  chain: number
  tasks: number
  focusMin: number
  hard: number
}

export type Projection = {
  days: number
  /** His own recent share of a full day, 0..1. The engine of the good side. */
  rate: number
  /** How many days of log the rate was taken from. Zero means no evidence. */
  from: number
  push: Future
  drift: Future
  /** The day the wheel reads zero if he stops. 0 when it already does. */
  stoppedOn: number
  /** True when there is no rate to run forward and the good side is showing
   *  what a FULL day every day would build instead of what he has been doing.
   *  The screen has to say so; a projection off no evidence presented as his
   *  own is the one lie this file could tell. */
  assumed: boolean
}

/**
 * Run both lives forward `days` from today.
 *
 * `window` is how far back the rate is read from. Twenty eight days is long
 * enough that one bad week cannot define him and short enough that a month he
 * has left behind does not flatter him.
 */
export function project(run: DayScore[], chainNow: number, days: number, window = 28): Projection {
  const recent = run.slice(-window)
  const from = recent.length
  const mean = (f: (r: DayScore) => number) => (from ? recent.reduce((a, r) => a + f(r), 0) / from : 0)
  const rate = mean((r) => r.ratio)
  const tasksPerDay = mean((r) => r.counts.tasks)
  const focusPerDay = mean((r) => r.counts.focusMin)
  const hardPerDay = mean((r) => (r.hard ? 1 : 0))
  const keptShare = from ? recent.filter((r) => r.kept).length / from : 0

  /* NO RATE, NO PROJECTION OF HIS OWN. On a fresh log both sides come out as
     noughts and the screen says nothing at all, which is worst on exactly the
     day he most needs it. Below a floor of evidence the good side shows a full
     day every day instead, and `assumed` makes the screen admit it. */
  const assumed = rate < 0.05
  const useRate = assumed ? 1 : rate
  const useKept = assumed ? 1 : keptShare
  const useTasks = assumed ? TASK_TARGET : tasksPerDay
  const useFocus = assumed ? FOCUS_TARGET_MIN : focusPerDay
  const useHard = assumed ? HARD_TARGET : hardPerDay

  const start = momentumNow(run)
  let up = start, down = start, stoppedOn = down < 0.5 ? 0 : -1
  for (let d = 1; d <= days; d++) {
    up = Math.max(0, Math.min(CEILING, up * FRICTION + GAIN * curveFor(useRate)))
    down = Math.max(0, down * FRICTION * EMPTY_WIPE)
    if (stoppedOn < 0 && down < 0.5) stoppedOn = d
  }

  return {
    days, rate, from, assumed,
    push: {
      momentum: +up.toFixed(1),
      /* Days kept, not days elapsed: at his own rate the chain grows by the
         share of days he actually keeps, and claiming every one of them would
         be the only invented figure on the screen. */
      chain: chainNow + Math.round(days * useKept),
      tasks: Math.round(useTasks * days),
      focusMin: Math.round(useFocus * days),
      hard: Math.round(useHard * days),
    },
    drift: { momentum: +down.toFixed(1), chain: 0, tasks: 0, focusMin: 0, hard: 0 },
    stoppedOn: stoppedOn < 0 ? days : stoppedOn,
  }
}

/** Whole days between two local date keys. */
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`), b = new Date(`${to}T00:00:00`)
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}
