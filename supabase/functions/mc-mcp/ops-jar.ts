/* The Cookie Jar, shaped for Claude. Pure: the state blob and the training days in, an answer out.
   The numbers come from momentum-app.ts (the app's own engine, verbatim); this file only picks
   what the page shows and words "what is left today" from the same targets. */
import { arr, dateKey, type Blob, type Row } from './ops.ts'
import {
  CAPS, FOCUS_TARGET_MIN, HABIT_TARGET, HARD_MIN_DAYS, KEPT_AT, OUTREACH_TARGET, POINTS, TASK_TARGET,
  chainOf, momentumNow, momentumRun, project, rollUp, stateFor, type DayScore, type Zoom,
} from './momentum-app.ts'

/** src/timeline.tsx WINDOW: the page replays 120 days. */
export const WINDOW = 120
const ROWS: Record<Zoom, number> = { d: 14, w: 8, m: 4 }

/** src/health.ts dayOf, over zepp_activities rows. */
export const sessionDays = (rows: Row[]): string[] =>
  [...new Set(rows.map((s) => String(s.start_date_local ?? s.start_date ?? '').slice(0, 10)).filter(Boolean))]

const brief = (d: DayScore) => ({
  day: d.day, points: d.earned, fullDay: d.baseline, pct: Math.round(d.ratio * 100), kept: d.kept, empty: d.empty,
  momentum: d.momentum, change: d.delta,
  habits: d.counts.habits, tasks: d.counts.tasks, focusMin: d.counts.focusMin, outreach: d.counts.outreach, workout: d.counts.workout,
  ...(d.hard ? { hardThing: `${d.hard.title} (waited ${d.hard.waited} days)` } : {}),
})

export interface JarInput { zoom?: Zoom; rows?: number; days?: number; workoutDays?: string[] | null }

export function cookieJar(b: Blob, i: JarInput, now = new Date()): Row {
  // Prague's noon today: the engine steps back whole days from it, and noon never crosses midnight on a DST change.
  const today = new Date(`${dateKey(now)}T12:00:00Z`)
  const prospects = arr(b, 'prospects')
  const run = momentumRun({
    habits: arr(b, 'habits') as any, habitLog: arr(b, 'habitLog') as any, tasks: arr(b, 'tasks') as any, focusSessions: arr(b, 'focusSessions') as any,
    inView: () => true, workoutDays: i.workoutDays ?? [],
    outreach: prospects.flatMap((p) => (Array.isArray(p.touches) ? p.touches : [])),
  }, WINDOW, today)
  const m = momentumNow(run)
  const chain = chainOf(run)
  const t = run[run.length - 1]
  const zoom = i.zoom ?? 'd'
  const periods = rollUp(run, zoom).reverse().slice(0, i.rows ?? ROWS[zoom])
  const fut = project(run, chain.current, i.days ?? 30)

  // What a kept day still needs, in the engine's own points (KEPT_AT of a full day keeps it, 100% is a full day).
  const toKeep = Math.max(0, Math.ceil(t.baseline * KEPT_AT - t.earned))
  const toFull = Math.max(0, t.baseline - t.earned)
  const missing: string[] = []
  if (t.counts.habits < t.counts.habitTarget) missing.push(`${t.counts.habitTarget - t.counts.habits} more habit(s) (${POINTS.habit} pts each)`)
  if (t.counts.tasks < TASK_TARGET) missing.push(`${TASK_TARGET - t.counts.tasks} more task(s) (${POINTS.task} pts each)`)
  if (t.counts.focusMin < FOCUS_TARGET_MIN) missing.push(`${FOCUS_TARGET_MIN - t.counts.focusMin} more focus minutes (${POINTS.focusPer10} pts per 10)`)
  if (!t.hard) missing.push(`a hard thing: finish a task that has waited ${HARD_MIN_DAYS}+ days (${POINTS.hard} pts)`)
  if (t.counts.outreachScored && t.counts.outreach < OUTREACH_TARGET) missing.push(`${OUTREACH_TARGET - t.counts.outreach} more outreach touch(es) (${POINTS.outreach} pts each)`)

  const workoutKnown = i.workoutDays != null
  return {
    momentum: m, state: stateFor(m),
    chain: { current: chain.current, longest: chain.longest, todayStillOpen: chain.todayPending, daysToBeatRecord: chain.toBeat },
    today: {
      ...brief(t),
      targets: { habits: t.counts.habitTarget, tasks: TASK_TARGET, focusMin: FOCUS_TARGET_MIN, hardThing: 1, ...(t.counts.outreachScored ? { outreach: OUTREACH_TARGET } : {}) },
      caps: { habits: CAPS.habit, tasks: CAPS.task, focusMin: CAPS.focusMin, outreach: CAPS.outreach },
      pointsToKeepDay: toKeep, pointsToFullDay: toFull,
      stillMissing: missing,
    },
    ladder: {
      zoom, rungs: periods.map((p) => ({
        label: p.label, sub: p.sub, points: p.earned, fullDay: p.baseline, pct: Math.round(p.ratio * 100), keptDays: p.keptDays, days: p.totalDays,
        momentum: p.momentum, change: +p.delta.toFixed(2), habits: p.counts.habits, tasks: p.counts.tasks, focusMin: p.counts.focusMin,
        outreach: p.counts.outreach, workoutDays: p.counts.workoutDays, hardThings: p.hardCount, ...(p.hard ? { biggestHardThing: p.hard.title } : {}),
      })),
    },
    futures: {
      days: fut.days, basedOnDays: fut.from, recentPctOfFullDay: Math.round(fut.rate * 100), assumedFullDays: fut.assumed,
      keepGoing: fut.push, stop: fut.drift, momentumHitsZeroAfterDays: fut.stoppedOn,
    },
    note: `Momentum is replayed from the log over the last ${WINDOW} days, every space, exactly as the Cookie Jar page does. A day is kept at ${Math.round(KEPT_AT * 100)}% of a full day. Workout days are read only (not scored).${workoutKnown ? '' : ' The health pipeline could not be read, so workout days count only the ticked Workout habit.'}`,
  }
}
