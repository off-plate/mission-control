/* The Gym numbers, shared by the Gym page and the phone shell so the two can never disagree: what each target is at right now, how far along
   it is, and the session ladder. Pure functions over what Hevy last synced onto this device. */
import { bestE1rmEver, bestRepTotalEver, prsOnDay, type ExerciseHistory, type HevyDayStats } from './hevy'
import type { GymGoal } from './types'

/* His real Forge goals (PROVING GROUND), carried over as the page's seed the
   first time it opens with none saved yet. Numbers are his own opening and
   target figures from that dashboard -- current is never re-typed here, it's
   computed live below from real Hevy history for every goal that has one. */
export const FORGE_SEED: (Omit<GymGoal, 'id' | 'createdAt' | 'updatedAt'>)[] = [
  { name: 'Bench e1RM', metric: 'e1rm', exerciseName: 'Bench Press (Barbell)', goal: 76, unit: 'kg' },
  { name: 'Deadlift e1RM', metric: 'e1rm', exerciseName: 'Deadlift (Barbell)', goal: 175, unit: 'kg' },
  { name: 'Incline Smith reps at 50', metric: 'repTotal', exerciseName: 'Incline Bench Press (Smith Machine)', goal: 15, unit: 'reps' },
  { name: 'Incline DB e1RM', metric: 'e1rm', exerciseName: 'Incline Bench Press (Dumbbell)', goal: 44, unit: 'kg' },
  { name: 'Pull-up day total', metric: 'repTotal', exerciseName: 'Pull Up', goal: 16, unit: 'reps' },
  {
    name: 'Stairmaster floors in 15:00', metric: 'manual', goal: 0, unit: 'floors', current: 0,
    note: "Forge never set a real target for this one -- it's here so it isn't lost, not because 0 means anything. Edit it once you have one.",
  },
  { name: 'Sessions logged', metric: 'sessions', goal: 20, unit: 'sessions' },
  { name: 'Bodyweight', metric: 'manual', goal: 91, unit: 'kg', current: 96, lowerIsBetter: true },
]

/** What the goal is at right now, live off real Hevy history for every
 *  metric except 'manual', which he sets himself. Null means never logged --
 *  a goal with nothing to show yet, not a zero it hasn't earned. */
export function currentFor(g: GymGoal, history: ExerciseHistory, sessionDays: number): number | null {
  switch (g.metric) {
    case 'e1rm': return g.exerciseName ? bestE1rmEver(history, g.exerciseName) : null
    case 'repTotal': return g.exerciseName ? bestRepTotalEver(history, g.exerciseName) : null
    case 'sessions': return sessionDays
    case 'manual': return g.current ?? null
  }
}

export function pctFor(g: GymGoal, current: number | null): number {
  if (current == null || g.goal <= 0) return 0
  if (g.lowerIsBetter) {
    /* Bodyweight-shaped: he starts above the goal and comes down to it. A
       manual goal with no real opening weight recorded yet has nothing to
       measure "how far down" against, so it reads as just started rather
       than guessing a start point that was never his. */
    const start = g.current ?? current
    if (start <= g.goal) return 1
    return Math.max(0, Math.min(1, (start - current) / (start - g.goal)))
  }
  return Math.max(0, Math.min(1, current / g.goal))
}

export function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

export interface GymDay { day: string; volumeKg: number; exercises: { name: string; weight: number; reps: number; e1rm: number; isPR: boolean }[]; prCount: number }


/** The session ladder: one row per Hevy day, newest first, with the exercises that were done and how many PRs fell on it. */
export function buildGymDays(history: ExerciseHistory, dayStats: Record<string, HevyDayStats>, limit = 20): GymDay[] {
  return Object.entries(dayStats)
    .map(([day, stats]): GymDay => {
      const exercises = Object.entries(history)
        .map(([name, rows]) => ({ name, row: rows.find((r) => r.day === day) }))
        .filter((x): x is { name: string; row: NonNullable<typeof x.row> } => !!x.row)
        .map((x) => ({ name: x.name, weight: x.row.weight, reps: x.row.reps, e1rm: x.row.e1rm, isPR: x.row.isPR }))
      return { day, volumeKg: stats.volumeKg, exercises, prCount: prsOnDay(history, day).length }
    })
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, limit)
}
