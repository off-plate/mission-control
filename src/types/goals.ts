import { goalPeriodKey, goalPeriodRange } from '../util'
import type { SpaceId } from './core'
import { quitKeptDays, keptDaysIn, type FocusSession, type HabitDef, type HabitSlip, type HabitTick } from './habits'

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
  /* ---- age ----
     The app's one real accountability mechanism is AGE: a task open seven days
     is named out loud, oldest first, with two honest answers under it. That
     mechanism was wired to tasks and to nothing else, so a GOAL could sit
     untouched for four months and nothing here would ever mention it. These
     two fields are what let the same rule reach it.

     Deliberately not a deadline. Nothing counts down, nothing goes red on a
     date, and the question it eventually asks is the same one a stale task
     gets: is this still yours, or is it time to let it go. */
  /** The day it was set. */
  createdAt?: string
  /** The last day anything about it moved: edited, a milestone ticked, its
   *  number changed by hand. Untouched is the fact worth knowing; a goal that
   *  fills itself from a habit is being kept, not neglected. */
  touchedAt?: string
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

