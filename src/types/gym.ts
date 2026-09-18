/* THE GYM GOALS on the Health page: the "how close am I" numbers he had in
   Forge (PROVING GROUND) and wants back, permanent PR targets rather than
   the weekly/monthly/quarter goals the main Goals page tracks -- a bench
   e1RM target has no period to close at the end of, so it doesn't belong in
   that system, which rotates and closes goals by periodKey. This is its own
   small, deliberately simple collection instead. */

export interface GymGoal {
  id: string
  /** His own name for it ("Bench e1RM", "Sessions logged"). */
  name: string
  current: number
  goal: number
  unit: string
  /** Why it matters or how it's measured, his own words, optional. */
  note?: string
  createdAt: number
  updatedAt: number
}
