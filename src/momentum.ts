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

   NOT MODELLED YET: the workout. Mission Control holds no session data; Hevy
   syncs into Jarvis, not into this app. `SOURCES.workout` is wired and weighted
   and currently always scores zero, so the day it arrives it is one function.
   It is left visible rather than hidden so the baseline is honest about what it
   is not counting. */
import { localDateKey } from './util'
import { quitKeptDays, type HabitDef, type HabitSlip, type HabitTick, type FocusSession, type SpaceId, type Task } from './types'

/** What one of each thing is worth, and the most any of them can be worth in a day. */
export const POINTS = {
  habit: 10,        // one build habit kept
  quit: 8,          // one break habit held clean for the day
  task: 6,          // one task finished
  focusPer10: 4,    // per ten minutes of focus
  workout: 25,      // reserved: see the note above
} as const
export const CAPS = {
  habit: 5,         // see HABIT_TARGET below
  task: 5,          // five tasks is a full day of tasks; the sixth is free
  focusMin: 240,    // four hours is a full day of focus
} as const

/* THE BASELINE DOES NOT SCALE WITH HOW MANY HABITS HE TRACKS, and this is the
   most important decision in the file.

   The first version asked for every daily habit. He tracks more than forty, so
   a genuinely good day scored about a seventh of the bar, every day came out a
   penalty, and the wheel sat at zero on thirty days of real effort. That is the
   same failure as the page that told him 11 of 42: arithmetically defensible,
   useless to look at, and it punishes him for the crime of tracking things.

   So a full day is a FIXED, reachable shape: five habits, three tasks, two
   hours of focus, and whatever break habits he is holding. Tracking a sixth
   habit cannot make yesterday worse. */
export const HABIT_TARGET = 5
export const QUIT_TARGET = 3
export const TASK_TARGET = 3
export const FOCUS_TARGET_MIN = 120

/** How a day's ratio moves the wheel. His shape: reward the full day, pay a
 *  little for most of it, and charge for the rest. */
export const GAIN = 4.2
export const FRICTION = 0.985      // what the wheel loses to a day simply passing
export const EMPTY_WIPE = 0.5      // a day with nothing logged halves it
export const CEILING = 100

export type DayScore = {
  day: string
  earned: number
  baseline: number
  ratio: number
  parts: { habits: number; quits: number; tasks: number; focus: number; workout: number }
  counts: { habits: string; quits: string; tasks: number; focusMin: number }
  /** What this day did to the wheel, in momentum points. Negative is a penalty. */
  delta: number
  momentum: number
}

type Input = {
  habits: HabitDef[]
  habitLog: HabitTick[]
  slips: HabitSlip[]
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
  const { habits, habitLog, slips, tasks, focusSessions, inView } = input

  const build = habits.filter((h) => inView(h.space) && !h.archivedAt && !h.paused && h.kind !== 'break' && h.frequency === 'daily')
  const quits = habits.filter((h) => inView(h.space) && !h.archivedAt && h.kind === 'break' && h.quitSince)
  const buildIds = new Set(build.map((h) => h.id))

  const from = localDateKey(addDays(today, -days))
  const to = localDateKey(today)

  /* One pass each, then every day below is a lookup rather than a scan. */
  const keptByDay = new Map<string, Set<string>>()
  for (const t of habitLog) {
    if (!buildIds.has(t.habitId)) continue
    if (!keptByDay.has(t.day)) keptByDay.set(t.day, new Set())
    keptByDay.get(t.day)!.add(t.habitId)
  }
  const cleanByQuit = new Map<string, Set<string>>()
  for (const h of quits) cleanByQuit.set(h.id, quitKeptDays(h, slips, from, to))

  const doneByDay = new Map<string, number>()
  for (const t of tasks) {
    if (!t.done || !t.doneAt || !inView(t.space)) continue
    const k = localDateKey(new Date(t.doneAt))
    doneByDay.set(k, (doneByDay.get(k) ?? 0) + 1)
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
    Math.min(build.length, HABIT_TARGET) * POINTS.habit +
    Math.min(quits.length, QUIT_TARGET) * POINTS.quit +
    TASK_TARGET * POINTS.task +
    (FOCUS_TARGET_MIN / 10) * POINTS.focusPer10

  const out: DayScore[] = []
  let m = 0
  for (let i = days; i >= 0; i--) {
    const day = localDateKey(addDays(today, -i))
    const hkRaw = keptByDay.get(day)?.size ?? 0
    const hk = Math.min(CAPS.habit, hkRaw)
    const qkRaw = quits.reduce((a, h) => a + (cleanByQuit.get(h.id)?.has(day) ? 1 : 0), 0)
    const qk = Math.min(QUIT_TARGET, qkRaw)
    const tk = Math.min(CAPS.task, doneByDay.get(day) ?? 0)
    const fm = Math.min(CAPS.focusMin, focusByDay.get(day) ?? 0)

    const parts = {
      habits: hk * POINTS.habit,
      quits: qk * POINTS.quit,
      tasks: tk * POINTS.task,
      focus: Math.round((fm / 10) * POINTS.focusPer10),
      workout: 0,                            // see the note at the top
    }
    const earned = parts.habits + parts.quits + parts.tasks + parts.focus + parts.workout
    const ratio = baseline > 0 ? earned / baseline : 0

    /* THE WIPE TESTS ACTIVE EFFORT, NOT EARNED POINTS, and the difference is not
       a detail. Holding a break habit is PASSIVE: he earns those points by not
       doing something, which on a day he did nothing at all he satisfies by
       definition. Testing `earned` therefore meant a completely empty day still
       scored, the wipe never fired, and the harshest rule in the model was
       silently unreachable. Caught by the test that asserted it. */
    const active = parts.habits + parts.tasks + parts.focus + parts.workout

    const before = m
    m *= FRICTION
    if (active === 0) m *= EMPTY_WIPE
    else m += GAIN * curveFor(ratio)
    m = Math.max(0, Math.min(CEILING, m))

    out.push({
      day, earned, baseline, ratio, parts,
      /* Raw counts. The ladder renders them against the target; the flywheel
         card renders the bare number, because `7/5` reads as a bug. */
      counts: { habits: `${hkRaw}/${Math.min(build.length, HABIT_TARGET)}`, quits: `${qkRaw}/${Math.min(quits.length, QUIT_TARGET)}`, tasks: doneByDay.get(day) ?? 0, focusMin: focusByDay.get(day) ?? 0 },
      delta: +(m - before).toFixed(2),
      momentum: +m.toFixed(2),
    })
  }
  return out
}

/** Where the wheel stands right now. */
export function momentumNow(run: DayScore[]): number {
  return run.length ? run[run.length - 1].momentum : 0
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
