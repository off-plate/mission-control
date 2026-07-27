export type SpaceId = 'personal' | 'work' | 'offplate'

/** One shared on-track threshold, so Goals, Review and the widget never disagree. */
export const ON_TRACK_PCT = 50

export type PageId =
  | 'today'
  | 'plan'
  | 'assistant'
  | 'habits'
  | 'routines'
  | 'goals'
  | 'money'
  | 'review'
  | 'coach'
  | 'stats'
  | 'settings'
  | 'brand'
  | 'braindump'

export type WidgetType =
  | 'agenda'
  | 'tasks'
  | 'mail'
  | 'finance'
  | 'habits'
  | 'training'
  | 'goals'
  | 'timesaved'
  | 'claude'
  | 'social'
  | 'sources'
  | 'outreach'

export type SizeKey = 'S' | 'M' | 'T' | 'L' | 'XL'

/** Widget sizes in grid cells (one cell is roughly 230px square). */
export const SIZE_UNITS: Record<SizeKey, { w: number; h: number }> = {
  S: { w: 1, h: 1 },
  M: { w: 2, h: 1 },
  T: { w: 1, h: 2 },
  L: { w: 2, h: 2 },
  XL: { w: 4, h: 2 },
}

export interface WidgetInstance {
  id: string
  type: WidgetType
  size: SizeKey
}

export interface WidgetDef {
  type: WidgetType
  title: string
  description: string
  supportedSizes: SizeKey[]
  defaultSize: SizeKey
  /** Freshness in minutes at demo load; null means human-entered data. */
  freshMinutes: number | null
  staleAfter: number
  /** Page this widget deep-links to. */
  page: PageId
}

export type TaskCategory = 'call' | 'admin' | 'deep' | 'quick'

export type TimeSlot = 'morning' | 'noon' | 'afternoon' | 'evening'

export const SLOTS: { id: TimeSlot; label: string; hint: string }[] = [
  { id: 'morning', label: 'Morning', hint: 'before noon' },
  { id: 'noon', label: 'Noon', hint: '12 to 2 PM' },
  { id: 'afternoon', label: 'Afternoon', hint: '2 to 6 PM' },
  { id: 'evening', label: 'Evening', hint: 'after 6 PM' },
]

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
  /** Which time-of-day bucket on the Today plan; undefined = not yet placed. */
  slot?: TimeSlot
  /** Optional breakdown; the task's real estimate is the sum of these when present. */
  subtasks?: SubTask[]
  /** 'HH:MM' if the user pinned it to a clock time (feeds the Calendar link). */
  at?: string
  /** ISO date the task first appeared. Ageing is how avoidance gets detected. */
  createdAt?: string
  /** How many days it has been carried forward without being finished. */
  carried?: number
}

export interface RoutineStep {
  id: string
  title: string
  /** 'timer' shows a countdown; 'do' is a guided step you mark done. */
  kind: 'timer' | 'do'
  seconds?: number
  note?: string
  /** e.g. a tongue-twister to read aloud. */
  example?: string
  /** optional external tool to open (typing test, etc.). */
  link?: string
  linkLabel?: string
}

/** How often a habit is meant to happen. Drives its weekly target. */
export type HabitFrequency = 'daily' | 'weekdays' | 'times-per-week' | 'weekly' | 'monthly'

export const HABIT_FREQUENCIES: { id: HabitFrequency; label: string }[] = [
  { id: 'daily', label: 'Every day' },
  { id: 'weekdays', label: 'Monday to Friday' },
  { id: 'times-per-week', label: 'A few times a week' },
  { id: 'weekly', label: 'Once a week' },
  { id: 'monthly', label: 'Once a month' },
]

export interface HabitDef {
  id: string
  /** Which space this habit belongs to. */
  space: SpaceId
  name: string
  /** Mon..Sun of the current week. */
  days: boolean[]
  paused: boolean
  /** Checkoffs per week for the last 12 weeks, oldest first (0-7). */
  history?: number[]
  /** Part of day this habit belongs to; undefined = anytime. */
  daypart?: TimeSlot
  /** How often it is meant to happen; undefined behaves as daily. */
  frequency?: HabitFrequency
  /** Days a week you are aiming for, when frequency is 'times-per-week'. */
  targetPerWeek?: number
}

/** Days a week this habit is actually aiming for. The X/7 was a lie for
 *  anything that was never meant to happen seven days a week. */
export function habitTarget(h: HabitDef): number {
  if (h.frequency === 'weekdays') return 5
  if (h.frequency === 'weekly' || h.frequency === 'monthly') return 1
  if (h.frequency === 'times-per-week') return Math.max(1, Math.min(7, h.targetPerWeek ?? 3))
  return 7
}

export function habitFrequencyLabel(h: HabitDef): string {
  if (h.frequency === 'weekdays') return 'Mon to Fri'
  if (h.frequency === 'weekly') return 'once a week'
  if (h.frequency === 'monthly') return 'once a month'
  if (h.frequency === 'times-per-week') return `${habitTarget(h)}x a week`
  return 'every day'
}

/** How often a routine runs. Drives the sections on the Routines page. */
export type RoutineCadence = 'daily' | 'prework' | 'weekly' | 'monthly'

/** A named checklist you run on repeat. Checking every step marks it done for
 *  the period; if it mirrors a habit, that habit checks off automatically. */
export interface Routine {
  id: string
  /** Which space this routine belongs to. */
  space: SpaceId
  title: string
  cadence: RoutineCadence
  blurb?: string
  steps: RoutineStep[]
  /** If set, completing this routine checks that habit off for today. */
  habitId?: string
  /** Step ids checked so far this period. */
  doneStepIds: string[]
  /** Which period the checks belong to (day / ISO week / month). When the
   *  current period differs, the checks reset automatically. */
  periodKey?: string
}

export type GoalTimeframe = 'weekly' | 'monthly' | 'quarter' | 'half'
export type GoalCategory = 'money' | 'health' | 'life' | 'work' | 'offplate' | 'habits'

export const GOAL_TIMEFRAMES: { id: GoalTimeframe; label: string; sub: string }[] = [
  { id: 'weekly', label: 'This week', sub: '7 days' },
  { id: 'monthly', label: 'This month', sub: '30 days' },
  { id: 'quarter', label: 'This quarter', sub: 'Q3 2026' },
  { id: 'half', label: 'Half year', sub: 'by year end' },
]

export const GOAL_CATEGORIES: { id: GoalCategory; label: string }[] = [
  { id: 'money', label: 'Money' },
  { id: 'health', label: 'Health' },
  { id: 'life', label: 'Life' },
  { id: 'work', label: 'Work' },
  { id: 'offplate', label: 'Off-Plate' },
  { id: 'habits', label: 'Habits' },
]

/** A sticky note on the Brain Dump board. Categories are #hashtags inside the text. */
export interface Idea {
  id: string
  /** Which space this note belongs to. */
  space: SpaceId
  text: string
  when: string
  color: string
}

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
}

/** Weeks of habit history a goal's timeframe covers. */
const TIMEFRAME_WEEKS: Record<GoalTimeframe, number> = { weekly: 1, monthly: 4, quarter: 13, half: 26 }

/**
 * A goal's real progress. When it is tied to a habit, the number is counted
 * from that habit's checkoffs over the goal's own window, so you never log the
 * same thing twice. Otherwise it is whatever the goal itself holds.
 */
export function goalCurrent(g: Goal, habits: HabitDef[]): number {
  if (!g.habitId) return g.current
  const h = habits.find((x) => x.id === g.habitId)
  if (!h) return g.current
  const thisWeek = h.days.filter(Boolean).length
  const weeks = TIMEFRAME_WEEKS[g.timeframe ?? 'quarter']
  const past = (h.history ?? []).slice(-(weeks - 1)).reduce((a, n) => a + n, 0)
  return Math.min(g.target, thisWeek + (weeks > 1 ? past : 0))
}

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

/** The factual look at an avoided thing: what it is, what it takes, what ignoring it costs. */
export interface CoachFacts {
  avoiding: string
  steps: string
  cost: string
}

/** A common avoided thing, pre-drafted so Coach can start from a real example. */
export interface CoachScenario {
  id: string
  title: string
  tag: string
  blurb: string
  facts: CoachFacts
  firstStep: string
  firstStepMin: number
  category: TaskCategory
}

/** A thing you actually faced: the facts you named, the first step you took, and,
 *  once you check back, whether you did it and how it really felt. */
export interface CoachSession {
  id: string
  /** Profile the loop was opened in (older sessions have none and show everywhere). */
  space?: SpaceId
  title: string
  facts: CoachFacts
  firstStep: string
  taskId: string | null
  when: string
  status: 'open' | 'closed'
  didIt?: boolean
  felt?: 'easier' | 'as-feared' | 'harder'
  reflection?: string
}

export interface PlanState {
  committedDate: string | null
  firstMoveId: string | null
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

export interface ReviewState {
  lastDoneDate: string | null
  /** ISO week the review was closed in; "closed" holds until the next week. */
  lastWeekKey?: string
  wins: string[]
  outcomes: string[]
  /** Last week's reflection, kept so this week can read what you said you'd change. */
  previous?: { weekKey: string; wins: string[]; outcomes: string[] }
}
