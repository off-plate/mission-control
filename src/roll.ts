import { goalPeriodRange, isoWeekKey, localDateKey } from './util'
import type { HabitDef, HabitTick, PlanState, Task } from './types'

/**
 * Sealing the days that have passed since the app was last open.
 *
 * This used to be several unrelated `if` blocks inside the loader, each asking
 * "is the saved week different from this week?" and each doing its work exactly
 * ONCE however long the gap was. Shut the laptop on a Friday and open it three
 * weeks later and two of those weeks were never sealed: their counts never
 * reached the twelve-week history, so the record simply skipped them.
 *
 * One function, one watermark. It walks from the last day it ran to today and
 * seals every period it crosses, so nine days shut seals nine days.
 */
export interface Rollable {
  /** The last day this ran. Everything after it is unsealed. */
  lastRollDay?: string
  weekKey?: string
  tasks?: Task[]
  habits?: HabitDef[]
  habitLog?: HabitTick[]
  plan?: PlanState
}

/** A laptop untouched for years must not spin here; twelve weeks is all history keeps. */
const MAX_WEEKS = 520

/* Before the watermark existed the only marker was the ISO week the state was
   saved in. A saved week that is not this week means that week is unsealed, so
   the walk starts at its Monday; otherwise there is nothing to seal. */
function seedWatermark(p: Rollable, now: Date): string {
  const today = localDateKey(now)
  if (!p.weekKey || p.weekKey === isoWeekKey(now)) return today
  try {
    return goalPeriodRange('weekly', p.weekKey).from
  } catch {
    return today
  }
}

/** ISO week keys that ended before today's week, from the watermark forward. */
function weeksToSeal(from: string, now: Date): { key: string; from: string; to: string }[] {
  const current = isoWeekKey(now)
  const out: { key: string; from: string; to: string }[] = []
  const [y, m, d] = from.split('-').map(Number)
  if (!y) return out
  const cur = new Date(y, m - 1, d)
  for (let i = 0; i < MAX_WEEKS; i++) {
    const key = isoWeekKey(cur)
    if (key === current) break
    const range = goalPeriodRange('weekly', key)
    out.push({ key, from: range.from, to: range.to })
    cur.setDate(cur.getDate() + 7)
  }
  return out
}

export function roll<T extends Rollable>(p: T, now = new Date()): T {
  const today = localDateKey(now)
  const from = p.lastRollDay ?? seedWatermark(p, now)
  if (from > today) {
    // A clock that went backwards. Seal nothing, and do not move the watermark
    // backwards either: the days it covers were sealed under the later date.
    return p
  }

  /* Each week that has ended gets its count into the twelve-week history, taken
     from the dated log rather than from whatever the week array happened to hold
     when the app was last closed. The array is a cache of ONE week; the log knows
     all of them, so a three-week gap now records three real numbers. */
  const weeks = weeksToSeal(from, now)
  if (weeks.length && p.habits) {
    const log = p.habitLog ?? []
    p.habits = p.habits.map((h) => {
      const counts = weeks.map((w) =>
        new Set(log.filter((t) => t.habitId === h.id && t.day >= w.from && t.day <= w.to).map((t) => t.day)).size,
      )
      return { ...h, history: [...(h.history ?? []), ...counts].slice(-12), days: [false, false, false, false, false, false, false] }
    })
  }

  /* THE DAY ROLLS OVER. Today's list has to mean today. Nothing ever cleared it,
     so a task moved to today stayed there for good and finished ones sat struck
     through underneath forever: a plan from forty days ago was still "today".

     Unfinished work goes back to the list rather than following him into the new
     day. Re-choosing it is the whole point of planning a day, and silently
     re-planning it is how the pile formed in the first place. Nothing is lost: it
     is in the list, and Plan says how many came back so it is not a silent
     disappearance. Finished work leaves the day list and lives in the ledger,
     which already carries its date. */
  const returned: string[] = []
  p.tasks = (p.tasks ?? []).map((t) => {
    if (t.list !== 'today') return t
    // A task with no stamp predates this rule; treat it as planned today so an
    // upgrade does not sweep his current list out from under him.
    const on = t.plannedOn ?? today
    if (on === today) return { ...t, plannedOn: on }
    if (t.done) return { ...t, list: 'backlog' as const, plannedOn: undefined }
    returned.push(t.id)
    return { ...t, list: 'backlog' as const, plannedOn: undefined, slot: undefined, at: undefined, carried: (t.carried ?? 0) + 1 }
  })
  const plan = p.plan ?? { committedDate: null, firstMoveId: null }
  p.plan = {
    ...plan,
    // Yesterday's first move is not today's.
    firstMoveId: plan.committedDate === today ? plan.firstMoveId : null,
    returnedOn: returned.length ? today : plan.returnedOn,
    returnedCount: returned.length ? returned.length : (plan.returnedOn === today ? plan.returnedCount : 0),
  }

  p.lastRollDay = today
  return p
}
