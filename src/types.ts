export type SpaceId = 'personal' | 'work' | 'offplate'

export type PageId =
  | 'today'
  | 'plan'
  | 'tasks'
  | 'habits'
  | 'goals'
  | 'money'
  | 'review'
  | 'coach'
  | 'stats'
  | 'settings'

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
}

export interface HabitDef {
  id: string
  name: string
  /** Mon..Sun of the current week. */
  days: boolean[]
  paused: boolean
  /** Checkoffs per week for the last 12 weeks, oldest first (0-7). */
  history?: number[]
}

export interface Goal {
  id: string
  space: SpaceId
  name: string
  current: number
  target: number
  unit: string
  note: string
}

export interface LedgerEntry {
  id: string
  title: string
  category: TaskCategory
  estimateMin: number
  actualMin: number
  when: string
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

export interface CoachScenario {
  id: string
  title: string
  tag: string
  blurb: string
  steps: CoachStep[]
  resultTask: { title: string; estimateMin: number; category: TaskCategory }
}

export interface CoachStep {
  label: string
  question: string
  scripts?: { say: string; text: string }[]
  body?: string
}

export interface PlanState {
  committedDate: string | null
  firstMoveId: string | null
}

export interface ReviewState {
  lastDoneDate: string | null
  wins: string[]
  outcomes: string[]
}
