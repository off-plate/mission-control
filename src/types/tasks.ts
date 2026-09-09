import type { SpaceId, TaskCategory, TimeSlot } from './core'
import type { GoalTimeframe } from './goals'

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
  /** Which Project it belongs to, if any. A project is a room inside a Space,
   *  not a filter: this is the same standing as `space`, not a tag on top of
   *  it. Plan already reads every task in the active Space, so a task with a
   *  projectId shows up there and in All's Plan the same as any other. */
  projectId?: string
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
  /** When it was added, to the millisecond. createdAt is only a DAY, so it
   *  cannot order the things he added this morning against this afternoon,
   *  which is exactly the order he wants the list in: newest first. */
  addedAt?: number
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

/** A room inside a Space: Off-Plate holds clients, Corner holds workstreams,
 *  Personal holds Home and Car. It only ever scopes Plan. Today, Calendar,
 *  Habits, and Goals never learn this exists. */
export interface Project {
  id: string
  name: string
  space: SpaceId
  createdAt: string
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
