/* Bike / Run / Stairs keeps itself. Bike and run come from Intervals.icu (the
   watch syncs Zepp into it); stairs come from Hevy, where the stair machine is
   logged as an exercise. The habit is never ticked by hand. */
import type { Session } from './health'
import type { HabitDef } from './types'

export const CARDIO_HABIT_NAME = 'bike / run / stairs'
export const isCardioHabit = (h: HabitDef): boolean => h.name.trim().toLowerCase() === CARDIO_HABIT_NAME

const INTERVALS_TYPES = new Set(['Ride', 'VirtualRide', 'EBikeRide', 'GravelRide', 'MountainBikeRide', 'Run', 'VirtualRun', 'TrailRun'])

/** Every local day with a bike or run in Intervals, plus the Hevy stair days. */
export function cardioDays(sessions: Session[], stairDays: string[]): string[] {
  const days = new Set(stairDays)
  for (const s of sessions) {
    if (!s.type || !INTERVALS_TYPES.has(s.type)) continue
    const day = (s.start_date_local ?? s.start_date ?? '').slice(0, 10)
    if (day) days.add(day)
  }
  return [...days]
}
