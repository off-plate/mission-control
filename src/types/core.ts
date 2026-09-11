export type SpaceId = 'personal' | 'work' | 'offplate' | 'corner'

/** What you are looking at. 'all' is not a space anything can belong to: it is a
 *  view across the three. Storage always uses SpaceId, never this. */
export type ViewId = SpaceId | 'all'

export const SPACES: SpaceId[] = ['personal', 'work', 'offplate', 'corner']

export function isSpace(v: ViewId): v is SpaceId {
  return v !== 'all'
}

/** One shared on-track threshold, so Goals and the widget never disagree. */
export const ON_TRACK_PCT = 50

export type PageId =
  | 'today'
  | 'plan'
  /** A directory of Projects, scoped by the active Space. Opening one sets
   *  openProjectId and lands on Plan, filtered; it is not its own data. */
  | 'projects'
  | 'habits'
  | 'routines'
  | 'goals'
  /* The third face of Habits & Goals. A quit is not a habit you tick and not a
     goal you reach: it is a count of days something has been true, so it gets
     its own pill and its own address rather than a section on a page about
     doing things. */
  | 'quitting'
  | 'settings'
  | 'notes'
  /** The old address of the Brain Dump board. Kept so a bookmark still lands
   *  somewhere real: the route walks it to Notes. */
  | 'braindump'
  | 'board'
  /** His other tools, embedded live. */
  | 'apps'
  /** Focus blocks: the history, and the ones he wants to fix. */
  | 'focus'
  /** One day of the record, read-only. Carries a date in the route. */
  | 'day'
  /** Full-screen focus room. Reached from the header only, never a nav tab. */
  | 'zone'
  /** Bills, ported from Compass. Reached from the header, next to Note --
   *  not a workspace page, not filtered by space, same shape as Notes and
   *  the Zone. */
  | 'bills'
  /** The work calendar, read from the feed. Big Time only: see NAV. */
  | 'calendar'
  /** Measured history above a now line, and the same rate carried forward. */
  | 'timeline'
  /** The assistant: asks about the day, and shows real cards rather than
   *  writing numbers into a sentence. */
  | 'assistant'
  /** Every real skill across every workspace (Jarvis, Sofia, ...), one place
   *  to remember what exists and what it does. Reached from the dock only,
   *  same shape as Bills/Timeline -- not a workspace page. */
  | 'skills'
  /** The body, read from the zepp_* tables the watch already feeds through
   *  Intervals.icu. Dock only, same shape as Bills/Timeline/Skills. */
  | 'health'
  /** A YouTube transcript, read instead of watched. The reading is fetched from
   *  the Watchless endpoint, which is the only thing holding keys and the only
   *  thing that can spend against its monthly cap. */
  | 'watchless'

export type WidgetType =
  | 'clock'
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

/* Each part of the day is a real span of hours, not a vague word: `from` and
   `to` are the clock, and the hint is written from them so the label and the
   capacity can never disagree. Morning starts at 6 and evening stops at
   midnight, which is his own bed-by-midnight rule, so a night that runs past it
   is over budget by definition. */
export const SLOTS: { id: TimeSlot; label: string; hint: string; from: number; to: number }[] = [
  { id: 'morning', label: 'Morning', hint: '6 AM to noon', from: 6, to: 12 },
  { id: 'noon', label: 'Noon', hint: '12 to 2 PM', from: 12, to: 14 },
  { id: 'afternoon', label: 'Afternoon', hint: '2 to 6 PM', from: 14, to: 18 },
  { id: 'evening', label: 'Evening', hint: '6 PM to midnight', from: 18, to: 24 },
]
/** How many minutes that part of the day actually holds. */
export const slotMinutes = (id: TimeSlot): number => {
  const s = SLOTS.find((x) => x.id === id)
  return s ? (s.to - s.from) * 60 : 0
}
