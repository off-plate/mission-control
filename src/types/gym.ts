/* THE GYM PAGE: the "how close am I" goals he had in Forge (PROVING
   GROUND), permanent PR targets rather than the weekly/monthly/quarter
   goals the main Goals page tracks -- a bench e1RM target has no period to
   close at the end of, so it doesn't belong in that system.

   Seeded once from his real Forge goals (gympage.tsx), then LIVE against
   real Hevy history from there on -- current is never typed in by hand for
   an exercise-linked goal, it's computed every time the page opens, so it
   can never drift stale the way a copied-in number would. */

/** Which real number answers "how close is he": a lift's best e1RM ever
 *  (Epley, from Hevy's actual sets), a single session's rep total (a
 *  pull-up day, four sets summed), how many days he's trained inside a
 *  window, or a plain number he keeps himself (bodyweight, a floor count
 *  Hevy has no idea about). */
export type GymMetric = 'e1rm' | 'repTotal' | 'sessions' | 'manual'

export interface GymGoal {
  id: string
  /** His own name for it ("Bench e1RM"). */
  name: string
  goal: number
  unit: string
  metric: GymMetric
  /** The exact Hevy exercise title this reads from -- required for
   *  metric 'e1rm' and 'repTotal', ignored otherwise. Matched exactly, the
   *  same string Hevy itself uses ("Bench Press (Barbell)"). */
  exerciseName?: string
  /** Only read for metric 'manual': he sets this by hand. */
  current?: number
  /** Bodyweight, not a lift: closer to the goal means a SMALLER number.
   *  Everything else on this page is a bigger-is-closer PR target. */
  lowerIsBetter?: boolean
  note?: string
  createdAt: number
  updatedAt: number
}
