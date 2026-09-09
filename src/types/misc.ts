import type { PageId, SpaceId, TaskCategory } from './core'

export interface LedgerEntry {
  id: string
  title: string
  category: TaskCategory
  estimateMin: number
  actualMin: number
  when: string
  /** Which profile the work belonged to (older rows have none). */
  space?: SpaceId
  /** ISO week, so "time saved this week" means this week. */
  weekKey?: string
}

export interface AgendaEvent {
  id: string
  start: string
  end: string
  title: string
  where?: string
}

export interface Obligation {
  id: string
  name: string
  monthly: string
  remaining: string
  progressPct: number
  state: 'agreed' | 'waiting' | 'action needed'
  next: string
}

export interface SocialEntry {
  platform: string
  followers: number
  change: number
  lastPost: string
}

export interface SourceState {
  id: string
  name: string
  kind: string
  status: 'connected' | 'off' | 'manual'
  detail: string
}

/** Where the assistant put a dictated item, so you can see and undo it. */
export interface AssistantItem {
  id: string
  kind: 'task' | 'goal' | 'done'
  label: string
  tab: PageId
}
export interface AssistantEntry {
  id: string
  text: string
  when: string
  items: AssistantItem[]
}

/* `lastWeekKey` and `previous` used to live here. Nothing read either: the first
   was written on every close and never asked for, the second was declared and
   never written at all. Fields that look like state but are not are how the next
   change gets built on a lie, so they are gone. `reflections` is the record. */
export interface ReviewState {
  lastDoneDate: string | null
  wins: string[]
  outcomes: string[]
  /** Every window he has closed, newest first. One shape for all of them, so a
   *  week and a month are the same act over a different span. */
  reflections?: Reflection[]
}

export interface Reflection {
  id: string
  /** Set when a later close replaced this one. Nothing is ever removed. */
  supersededBy?: string
  /** Which window it covered, in words, e.g. 'Last week, Mon 20 Jul to Sun 26 Jul'. */
  label: string
  from: string
  to: string
  /** The day he closed it. */
  when: string
  wins: string[]
  /** The honest "what drifted" note. Its own field: it used to ride in wins[3],
   *  and with an empty win above it the reopen loader promoted self-criticism
   *  into a win. */
  drifted?: string
  outcomes: string[]
}
