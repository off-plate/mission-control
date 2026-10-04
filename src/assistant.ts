/* The assistant's brain. Pure: it builds the briefing, runs the turn loop, and
   validates what comes back. Nothing here renders and nothing here writes; the
   app lends it hands and eyes (Hands, below) for one turn at a time.

   THE RULE THAT MAKES IT TRUSTWORTHY: the model never makes up a number.

   It cannot count "you have three things today" for itself, because a model
   that does will one day say four when there are three, and then every figure
   in this app is worth nothing. A number it says is one it copied from the
   briefing or a lookup the app wrote; the cards it names are drawn by the app
   from the same store every other page reads.

   MULTI-USER, BY CONSTRUCTION: this runs in his browser, against a store that
   is already scoped to his account, with a key that lives on his device only.
   There is no server here to query the wrong row. Another person's data is not
   kept out by a check that could be wrong; it is not in the building.

   The briefing below is deliberately small: counts and titles, no bodies, no
   money, no note contents. A LOOKUP is the exception, and only when the model
   asks for one: it carries a note's first 140 characters and a bill's amount,
   because editing a note or answering "how much is Spotify" needs them. */

import { activeModel, getAiKey, request, stripReasoning } from './ai'
import { getTtsKey, hasTtsKey } from './speech'
import type { ContactChannel, GoalCategory, GoalTimeframe, GymMetric, HabitFrequency, PageId, PersonTier, PromptKind, RoutineCadence } from './types'

/** What a card shows. The app owns every one of these; the model only names one. */
export type CardKind =
  | 'today'      // what is on the day, by part of day
  | 'backlog'    // the list, oldest first
  | 'habits'     // what today asks of him
  | 'calendar'   // the meetings ahead
  | 'goals'
  | 'focus'      // the week's blocks
  | 'stale'      // what has been sitting too long
  | 'weather'    // Prague, out the window, drawn by the app
  /* One card per part of the app an action can land in (2026-10-04, his
     ask: the right side has to show where every change went). */
  | 'planned'    // days after today
  | 'projects' | 'routines' | 'notes' | 'people' | 'ideas' | 'bills' | 'gym' | 'prompts'

export interface Card { kind: CardKind; note?: string }

/* WHAT IT CAN DO, and the whole of what it can do.

   The model does not act. It NAMES actions out of KINDS below and the app
   performs them, against the same store every page writes to, and then the
   APP says what changed. Anything outside this table, or missing a field the
   table requires, is dropped before it reaches the store. It never names an
   id, only words from a title, and the app resolves those against his real
   rows: no match or two matches means nothing happens and it says so.

   ONE TABLE, THREE JOBS (rebuilt 2026-10-04, his ask: the assistant has to
   reach everything the app can do). It validates what the model sent, it
   types the doer, and it writes the vocabulary into the prompt. A kind added
   here is a kind the model is told about; there is no second list to drift. */
export type Slot = 'morning' | 'noon' | 'afternoon' | 'evening'
export type Where = 'today' | 'backlog'
export type Space = 'personal' | 'work'

type V = (v: unknown) => unknown
const str = (cap: number): V => (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, cap) : undefined)
const S = str(200)
const TEXT = str(4000)
const oneOf = (xs: readonly unknown[]): V => (v) => (xs.includes(v) ? v : undefined)
/** A number inside [lo, hi]. Models send "45" as often as 45. */
const num = (lo: number, hi: number, int = false): V => (v) => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n) || n < lo || n > hi) return undefined
  return int ? Math.round(n) : Math.round(n * 100) / 100
}
const BOOL: V = (v) => (typeof v === 'boolean' ? v : undefined)
const re = (r: RegExp): V => (v) => (typeof v === 'string' && r.test(v.trim()) ? v.trim() : undefined)
const LIST: V = (v) => {
  const xs = Array.isArray(v) ? v.map(S).filter(Boolean).slice(0, 30) : []
  return xs.length ? xs : undefined
}
const SLOT = oneOf(['morning', 'noon', 'afternoon', 'evening'])
const WHERE = oneOf(['today', 'backlog'])
/** Off-Plate and Michael's Corner stopped being workspaces on 2026-10-02 and are
 *  projects inside Personal. A model that still says the old word lands in
 *  Personal, and "add"/"move" also file it under that project (the doer reads
 *  LEGACY_PROJECT for that), never dropped. */
export const LEGACY_PROJECT: Record<string, string> = { offplate: 'Off-Plate', corner: "Michael's Corner" }
const SPACE: V = (v) => (v === 'personal' || v === 'work' ? v : typeof v === 'string' && v in LEGACY_PROJECT ? 'personal' : undefined)
const MIN = num(1, 480, true)
const DATE = re(/^\d{4}-\d{2}-\d{2}$/)
const TIME = re(/^([01]\d|2[0-3]):[0-5]\d$/)
/** Birthday as MM-DD, exactly what the People page itself stores. */
const MMDD = re(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
const YEAR = num(1900, new Date().getFullYear(), true)
const FREQ = oneOf(['daily', 'weekdays', 'times-per-week', 'weekly', 'monthly'])
const CADENCE = oneOf(['daily', 'prework', 'weekly', 'monthly'])
const TIER = oneOf(['core', 'close', 'friends', 'business', 'wider', 'distant'])
const TF = oneOf(['weekly', 'monthly', 'quarter', 'half'])
const GCAT = oneOf(['money', 'health', 'life', 'work', 'offplate', 'habits'])
const CHANNEL = oneOf(['inperson', 'call', 'message', 'video', 'email'])
const PKIND = oneOf(['Idea', 'Bug', 'Update', 'Version'])
const METRIC = oneOf(['e1rm', 'repTotal', 'sessions', 'manual'])
/** Every real page he can be sent to. 'day' has its own action, since it
 *  takes a date; 'braindump' is a legacy alias for notes. */
const PAGES: PageId[] = [
  'today', 'plan', 'projects', 'habits', 'routines', 'goals', 'quitting',
  'settings', 'notes', 'board', 'apps', 'focus', 'zone', 'bills', 'calendar',
  'timeline', 'assistant', 'ideas', 'prompts', 'people', 'skills', 'health',
  'gym', 'longevity', 'watchless',
]

interface Spec { d: string; f: Record<string, V>; need?: string[]; any?: string[] }
const T = { match: S, inSlot: SLOT }

const KINDS = {
  // Tasks. inSlot narrows a match to one part of the day; all:true acts on
  // every row that matches, only when HE said "both" / "all of them".
  add: { d: 'new task in his words; date = plan it for that day; steps = its subtasks', need: ['title'], f: { title: S, list: WHERE, slot: SLOT, date: DATE, at: TIME, space: SPACE, project: S, min: MIN, steps: LIST } },
  done: { d: 'tick a task; actualMin only when he said how long it took', need: ['match'], f: { ...T, all: BOOL, actualMin: MIN } },
  undone: { d: 'reopen a task', need: ['match'], f: { ...T, all: BOOL } },
  move: { d: 'move a task to a slot, list, date, project or workspace, or pin a clock time (at "none" unpins)', need: ['match'], any: ['slot', 'list', 'date', 'project', 'space', 'at'], f: { ...T, slot: SLOT, list: WHERE, date: DATE, project: S, space: SPACE, at: (v) => (v === 'none' ? v : TIME(v)) } },
  estimate: { d: 'set how long a task takes', need: ['match', 'min'], f: { ...T, min: MIN } },
  rename: { d: 'retitle a task, his new words', need: ['match', 'title'], f: { ...T, title: S } },
  drop: { d: 'delete a task (he can undo)', need: ['match'], f: { ...T, all: BOOL } },
  steps: { d: "replace a task's subtasks with these", need: ['match', 'steps'], f: { match: S, steps: LIST } },
  breakdown: { d: 'have the AI write subtasks for a task', need: ['match'], f: { match: S } },
  stepDone: { d: 'tick one subtask (step) of a task', need: ['match', 'step'], f: { match: S, step: S } },
  project: { d: 'new project', need: ['name'], f: { name: S, space: SPACE } },
  projectRename: { d: 'rename a project', need: ['match', 'name'], f: { match: S, name: S } },
  projectDelete: { d: 'delete a project; its tasks stay, unprojected, unless deleteTasks:true', need: ['match'], f: { match: S, deleteTasks: BOOL } },
  // Habits and quitting
  habit: { d: 'keep a habit (on:false un-keeps), today or on date', need: ['match'], f: { match: S, on: BOOL, date: DATE } },
  habitCount: { d: 'log a number on a counted habit (value = how many) or a measured one (value = the result)', need: ['match', 'value'], f: { match: S, value: num(-50, 100000) } },
  slip: { d: 'log a slip on something he is quitting, only when he says he slipped', need: ['match'], f: { match: S, date: DATE } },
  addHabit: { d: 'new habit; breaking:true = something he is quitting', need: ['name'], f: { name: S, breaking: BOOL, frequency: FREQ, perWeek: num(1, 7, true) } },
  editHabit: { d: 'change a habit, only the fields he named', need: ['match'], any: ['name', 'frequency', 'perWeek'], f: { match: S, name: S, frequency: FREQ, perWeek: num(1, 7, true) } },
  pauseHabit: { d: 'pause or resume a habit', need: ['match'], f: { match: S } },
  archiveHabit: { d: 'retire a habit or quit; its history stays', need: ['match'], f: { match: S } },
  // Routines (match = the routine's title, step = one of its steps)
  addRoutine: { d: 'new routine, optionally with its steps', need: ['title'], f: { title: S, cadence: CADENCE, blurb: str(300), steps: LIST } },
  editRoutine: { d: 'change a routine', need: ['match'], any: ['title', 'cadence', 'blurb'], f: { match: S, title: S, cadence: CADENCE, blurb: str(300) } },
  deleteRoutine: { d: 'delete a routine', need: ['match'], f: { match: S } },
  routineStep: { d: 'tick or untick one step of a routine', need: ['match', 'step'], f: { match: S, step: S } },
  addRoutineStep: { d: 'add a step to a routine', need: ['match', 'step'], f: { match: S, step: S } },
  removeRoutineStep: { d: 'remove a step from a routine', need: ['match', 'step'], f: { match: S, step: S } },
  routineDone: { d: 'mark a whole routine done for this period (on:false reopens)', need: ['match'], f: { match: S, on: BOOL } },
  planRoutine: { d: 'put a routine on the day', need: ['match'], f: { match: S, slot: SLOT, date: DATE } },
  // Goals
  addGoal: { d: 'new goal: target + unit, or milestones as a checklist', need: ['name'], f: { name: S, target: num(1, 1e7), unit: str(40), timeframe: TF, category: GCAT, why: str(300), space: SPACE, milestones: LIST } },
  editGoal: { d: 'change a goal', need: ['match'], any: ['name', 'target', 'unit', 'timeframe', 'why'], f: { match: S, name: S, target: num(1, 1e7), unit: str(40), timeframe: TF, why: str(300) } },
  goal: { d: 'goal progress: by adds to it (negative subtracts), set replaces the number', need: ['match'], any: ['by', 'set'], f: { match: S, by: num(-1e7, 1e7), set: num(0, 1e7) } },
  milestone: { d: 'tick or untick one milestone of a goal', need: ['match', 'step'], f: { match: S, step: S } },
  repeatGoal: { d: 'run a finished goal again for the new period', need: ['match'], f: { match: S } },
  deleteGoal: { d: 'delete a goal', need: ['match'], f: { match: S } },
  // Focus
  focus: { d: 'start a REAL focus timer now, on a task and/or for min', f: { match: S, min: MIN } },
  focusStop: { d: 'stop the running focus timer, keeping the time done', f: {} },
  logFocus: { d: 'record focus he already did', need: ['min'], f: { min: MIN, label: S, date: DATE, at: TIME } },
  // Notes and the ideas board
  note: { d: 'new note, his words verbatim, only when he asked for a note', need: ['text'], f: { text: TEXT, title: S, folder: S } },
  noteEdit: { d: "replace a note's body and/or title", need: ['match'], any: ['text', 'title'], f: { match: S, text: TEXT, title: S } },
  noteDelete: { d: 'delete a note', need: ['match'], f: { match: S } },
  noteMove: { d: 'move a note into a folder', need: ['match', 'folder'], f: { match: S, folder: S } },
  notePin: { d: 'pin a note (on:false unpins)', need: ['match'], f: { match: S, on: BOOL } },
  noteDone: { d: 'mark a note done (on:false reopens)', need: ['match'], f: { match: S, on: BOOL } },
  folder: { d: 'new notes folder', need: ['name'], f: { name: S, space: SPACE } },
  idea: { d: 'sticky note on the ideas board', need: ['title'], f: { title: S, body: TEXT } },
  ideaEdit: { d: 'change an idea card', need: ['match'], any: ['title', 'body'], f: { match: S, title: S, body: TEXT } },
  ideaDelete: { d: 'delete an idea card', need: ['match'], f: { match: S } },
  // People
  addPerson: { d: 'new person on the People page; tier from his words, ask if he named none', need: ['name', 'tier'], f: { name: str(120), tier: TIER, rel: str(80), job: str(120), birthday: MMDD, birthYear: YEAR } },
  editPerson: { d: 'change a person; cadenceDays = how often he wants to be in touch', need: ['match'], any: ['name', 'tier', 'rel', 'job', 'birthday', 'birthYear', 'cadenceDays'], f: { match: S, name: str(120), tier: TIER, rel: str(80), job: str(120), birthday: MMDD, birthYear: YEAR, cadenceDays: num(1, 3650, true) } },
  deletePerson: { d: 'remove a person', need: ['match'], f: { match: S } },
  contact: { d: 'log that he was in touch with someone (default in person, today)', need: ['match'], f: { match: S, channel: CHANNEL, date: DATE } },
  // Money (Bills, this cycle only)
  bill: { d: 'mark a bill paid (paid:false unpays)', need: ['match'], f: { match: S, paid: BOOL } },
  skipBill: { d: 'skip a bill this cycle (on:false unskips)', need: ['match'], f: { match: S, on: BOOL } },
  expense: { d: 'one-off cost under Unexpected (dueOn defaults to today)', need: ['name', 'amount'], f: { name: S, amount: num(1, 1e8, true), dueOn: DATE } },
  income: { d: 'money he received or expects this cycle', need: ['amount'], f: { amount: num(1, 1e8, true), label: S } },
  // Gym (PR targets)
  gymGoal: { d: 'new gym target; exercise = the Hevy exercise name', need: ['name', 'goal', 'unit'], f: { name: S, goal: num(0, 1e6), unit: str(20), exercise: S, metric: METRIC, lowerIsBetter: BOOL } },
  gymGoalEdit: { d: 'change a gym target or its current number', need: ['match'], any: ['name', 'goal', 'current'], f: { match: S, name: S, goal: num(0, 1e6), current: num(0, 1e6) } },
  gymGoalDelete: { d: 'delete a gym target', need: ['match'], f: { match: S } },
  // Prompts (things to tell Claude later)
  prompt: { d: 'save a prompt for Claude for later', need: ['text'], f: { text: TEXT, project: S, type: PKIND } },
  promptSent: { d: 'mark a saved prompt sent (on:false puts it back)', need: ['match'], f: { match: S, on: BOOL } },
  promptDelete: { d: 'delete a saved prompt', need: ['match'], f: { match: S } },
  // Getting around
  workspace: { d: 'switch workspace, only when he asked to', need: ['space'], f: { space: (v) => (v === 'all' ? v : SPACE(v)) } },
  open: { d: 'open a page', need: ['page'], f: { page: oneOf(PAGES) } },
  day: { d: 'open the record of a past day', need: ['date'], f: { date: DATE } },
  app: { d: 'open one of his embedded apps (Watchless and the rest) on the Apps page', need: ['match'], f: { match: S } },
  sync: { d: 'run the Hevy workout sync, only when he asked for a sync', f: {} },
  jarvis: { d: 'turn Jarvis mode (the dark HUD look, the same as clicking the logo) on, or off with on:false', f: { on: BOOL } },
} satisfies Record<string, Spec>

export type Kind = keyof typeof KINDS

/** Every field any action can carry. KINDS decides which ones a kind takes and
 *  which it needs; nothing reaches the doer without passing it. */
export interface Action {
  kind: Kind
  match?: string; title?: string; name?: string; text?: string; body?: string; label?: string
  step?: string; steps?: string[]; milestones?: string[]
  list?: Where; slot?: Slot; inSlot?: Slot; space?: Space | 'all'; project?: string; folder?: string
  date?: string; at?: string; dueOn?: string
  min?: number; actualMin?: number; amount?: number; target?: number; value?: number
  by?: number; set?: number; perWeek?: number; goal?: number; current?: number
  on?: boolean; all?: boolean; breaking?: boolean; paid?: boolean; deleteTasks?: boolean; lowerIsBetter?: boolean
  frequency?: HabitFrequency; cadence?: RoutineCadence; blurb?: string
  timeframe?: GoalTimeframe; category?: GoalCategory; unit?: string; why?: string
  tier?: PersonTier; rel?: string; job?: string; birthday?: string; birthYear?: number; cadenceDays?: number
  channel?: ContactChannel; page?: PageId; type?: PromptKind; exercise?: string; metric?: GymMetric
}

/** Everything the model sent, minus everything this app cannot promise to do.
 *  No cap on how many: a list he dictates is every row in it. */
export function cleanActions(raw: unknown): Action[] {
  if (!Array.isArray(raw)) return []
  const out: Action[] = []
  for (const a of raw.slice(0, 80)) {
    if (!a || typeof a !== 'object') continue
    const o = a as Record<string, unknown>
    const spec = (KINDS as Record<string, Spec>)[o.kind as string]
    if (!spec) continue
    const act: Record<string, unknown> = { kind: o.kind }
    for (const [k, valid] of Object.entries(spec.f)) {
      const x = valid(o[k])
      if (x !== undefined) act[k] = x
    }
    if (spec.need?.some((k) => act[k] === undefined)) continue
    if (spec.any && !spec.any.some((k) => act[k] !== undefined)) continue
    /* The old workspace word is still a real place: Off-Plate is a project now. */
    if ((o.kind === 'add' || o.kind === 'move') && !act.project && typeof o.space === 'string' && o.space in LEGACY_PROJECT) {
      act.project = LEGACY_PROJECT[o.space]
    }
    out.push(act as unknown as Action)
  }
  return out
}

/** The prompt's vocabulary, written from KINDS so it cannot disagree with it. */
const VOCAB = Object.entries(KINDS as Record<string, Spec>)
  .map(([k, s]) => `${k}(${Object.keys(s.f).map((f) => (s.need?.includes(f) ? `${f}*` : f)).join(', ')}): ${s.d}`)
  .join('\n')

/* LOOKUPS. The briefing is today and a glance at the list; everything else he
   owns is reached by asking for it. A wrong "nothing here is called X" over a
   row the model simply could not see was the commonest miss, and this is the
   fix for it rather than a longer briefing. */
export const FINDS = ['tasks', 'done', 'projects', 'habits', 'routines', 'goals', 'notes', 'people', 'ideas', 'bills', 'calendar', 'focus', 'gym', 'prompts', 'apps'] as const
export type FindWhat = typeof FINDS[number]
export interface Find { what: FindWhat; query?: string }

function cleanFinds(raw: unknown): Find[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 6).flatMap((f) => {
    const o = (f ?? {}) as Record<string, unknown>
    if (!FINDS.includes(o.what as FindWhat)) return []
    const query = S(o.query) as string | undefined
    return [{ what: o.what as FindWhat, ...(query ? { query } : {}) }]
  })
}
/** A section header naming which part of the day the lines under it belong
 *  to -- "Morning:", "Noon", "Afternoon:", whatever case. */
const SLOT_HEADER = /^(morning|noon|afternoon|evening)\s*:?\s*$/i

/** One line of a plan: a title, then how long it takes, at the very end of
 *  the line. Non-greedy up to an anchored $ so a title with its own hyphen
 *  ("CTP x Big Time - floor plans & units — 10m") still splits at the LAST
 *  dash, not the first: the engine only backtracks past it because nothing
 *  shorter reaches the end of the string. Any of -, – or — is accepted
 *  because his own paste has used all three across different attempts. */
const PLAN_ITEM = /^[-*•]?\s*(.+?)\s*[-–—]\s*(\d+)\s*m\.?$/i

/** Parses a pasted day plan -- section headers naming a slot, one task per
 *  line below it as "title — Nm" -- straight into real add actions, with no
 *  model in the loop at all. Built after his report, 2026-09-10: the same
 *  30-line paste, sent three times, came back with a handful of items each
 *  time and never the same handful twice. Raising the token budget and
 *  telling the model to enumerate everything (both done, same day) helped
 *  and still was not enough -- an LLM asked to reproduce thirty structured
 *  rows in one JSON response can under-run no matter how the prompt is
 *  worded, because "answer, but shorter" is a bias in the model itself, not
 *  a instruction this app forgot to give it. His format is exact and
 *  repeatable, which is exactly the case a real parser is right for and a
 *  model is the wrong tool for. Returns null below a real threshold so an
 *  ordinary short message -- even one that happens to end "...call her —
 *  10m" -- still goes to the model instead of being silently hijacked by a
 *  parser meant for a whole day at once. */
export function parseBulkPlan(text: string): Action[] | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  let slot: Slot | undefined
  const actions: Action[] = []
  /* A long title (his own titles run to a full pasted URL) wraps in a narrow
     box, and copying it back out sometimes hands back real line breaks where
     the screen only ever showed a soft wrap -- his own "Poslat Korejšovi
     dokument", the link, and "— 5m" have arrived as three separate lines.
     Each line joins onto what came before it until the buffer as a whole
     reads as one complete item; capped at 3 so an ordinary paragraph that
     never resolves into one cannot swallow every line after it. */
  let pending: string[] = []
  const MAX_WRAP = 3
  for (const raw of lines) {
    if (SLOT_HEADER.test(raw)) { pending = []; slot = SLOT_HEADER.exec(raw)![1].toLowerCase() as Slot; continue }
    pending.push(raw)
    const item = PLAN_ITEM.exec(pending.join(' '))
    if (item) {
      const title = item[1].trim()
      const min = Number(item[2])
      if (title && Number.isFinite(min) && min > 0) actions.push({ kind: 'add', title, list: slot ? 'today' : 'backlog', slot, min })
      pending = []
    } else if (pending.length >= MAX_WRAP) {
      pending = []
    }
  }
  return actions.length >= 3 ? actions : null
}


export interface Reply {
  /** One or two sentences. His language. */
  say: string
  /** What to draw underneath, in order. */
  show: Card[]
  /** Follow-ups worth a tap, phrased as he would ask them. */
  next?: string[]
  /** What to actually change. The app runs these and reports the outcome. */
  do?: Action[]
  /** What to look up before going on. The app answers on the next round. */
  find?: Find[]
  /** The job did not fit in one reply; give it another round. */
  more?: boolean
}

const CARDS: CardKind[] = ['today', 'planned', 'backlog', 'habits', 'routines', 'calendar', 'goals', 'focus', 'stale', 'weather', 'projects', 'notes', 'people', 'ideas', 'bills', 'gym', 'prompts']

/** A compact picture of his day. Titles and counts, nothing private. */
export interface Brief {
  now: string
  weekday: string
  planned: { slot: string; items: { title: string; done: boolean; min: number; space: string }[] }[]
  backlogCount: number
  /** Enough of the list to act on by name, not only to count. */
  backlog: { title: string; space: string }[]
  oldest: { title: string; days: number; space: string }[]
  habits: { due: number; kept: number; open: string[] }
  /* EVERY real habit's name, due today or not (his report, 2026-09-08: a
     real, existing habit -- Workout / Gym / Fitness, a weekly one, not due
     on that specific day -- came back "I can't find a habit called X"
     because "open" above only ever lists what is due TODAY. "habit" and
     "sync" both resolve against his real rows regardless of today's due
     state; this is what lets the model know a name is real before it ever
     tries, rather than refusing off a partial list it mistook for the
     whole roster. Names only, nothing about their schedule or state --
     that stays in "habits" above, which is the one that answers "what's
     still open today". */
  allHabits: string[]
  /* A ROUTINE IS NOT A HABIT (his correction, 2026-09-07): a habit is one tick;
     a routine is a sequence of steps run from Habits & Goals, and the two used
     to arrive here as one flat "habits" list because a routine's own
     auto-ticking habit shares that list's data. Same due/kept/open shape as
     habits, kept separate so the model can talk about them as the different
     things they are, and never offer to "keep" one with a habit action -- a
     routine is finished by running it, not by a checkbox. */
  routines: { due: number; kept: number; open: string[] }
  /* Other people are in these. */
  meetings: { at: string; title: string }[]
  /* Hours he gave himself: focus, the gym, the timesheet. Time already spent,
     not time owed to anyone. */
  blocks: { at: string; title: string }[]
  /* Tomorrow, so "plan today and tomorrow" is answered from his log rather
     than from an assumption that tomorrow is empty. */
  tomorrow: { title: string; space: string }[]
  tomorrowMeetings: { at: string; title: string }[]
  focusToday: number
  goals: { name: string; pct: number }[]
  /* Planned for yesterday and never ticked. The morning brief walks these and
     asks what to do with each, which is the job the Yesterday page does by
     hand. */
  unfinishedYesterday: { title: string; space: string }[]
  /* What actually got ticked off yesterday, by its own doneAt timestamp, not by
     plannedOn -- the rollover clears plannedOn off finished work on its way to
     the ledger, so that field is already gone by the time this runs. Read for
     the morning brief's good-day case: something to open on rather than a
     four-word shrug. */
  completedYesterday: { title: string; space: string }[]
  /* Written by the app from its own fetch, so the numbers in it are safe to
     repeat verbatim. */
  weather: string | null
  /* Bills, read from the same account Bills itself reads (2026-09-08: he
     asked whether Spotify was paid and the assistant had nothing at all to
     answer from). null when he is signed out of Bills on this device or it
     has not loaded yet -- a garnish exactly like weather, never something
     this briefing blocks on. Same due/kept/open shape as habits/routines on
     purpose: paid is this cycle's "kept". */
  bills: { due: number; paid: number; open: string[] } | 'loading' | null
  /* Things he is quitting, not keeping -- a different HabitDef kind (see the
     real habits/routines split above for why the two are never conflated).
     days is how long since the last slip or the day he started, whichever
     is later -- the same arithmetic the Quitting page itself runs. */
  quitting: { name: string; days: number }[]
  /** The one thing Today and the Zone would put in front of him next --
   *  same derivation (useFirstMove, ui.tsx), so "what am I having next"
   *  can never disagree with what the app itself shows. */
  nextTask: string | null
}

/* THE PROMPT, cut from ~6,200 tokens to about half on 2026-10-04. Groq's free
   tier allows 8,000 tokens a minute, so the old one spent most of a minute's
   budget on every question before the briefing was even attached, and the
   assistant now takes more than one round on a real job. Each rule below
   still exists because of a real miss; the history of each miss lives in the
   code that enforces it, not in what is sent to the model every time. */
const SYSTEM = `You are the assistant inside Mission Control, Michael's own life dashboard. He is Czech, in Prague, with a design agency job (Big Time, the "work" workspace) and his own businesses (Off-Plate and Michael's Corner are projects inside Personal). Admin rots on his list and evenings get lost. You are his chief of staff, and you can run the whole app for him.

VOICE
- Take a position. Name what to start with and why: a deadline, its age, a meeting it has to happen before, or that it is small and clears the deck. Reading his list back to him is a wasted turn.
- Talk like a person, out loud: his name when you greet him, "you", short sentences. Warm and specific, never sunny. No "I'd be happy to", no exclamation marks, no praise for things he has not done.
- Two or three sentences for an ordinary answer. A list inside an answer still opens with one real sentence, then one item per line starting with "- ".
- When there is a real decision, end with one short question he can answer out loud.
- ANSWER IN ENGLISH unless HIS OWN message is written in Czech. Czech titles in his data are DATA, not a request to switch. Unsure: English.
- No em dashes. Never write the [tags] from the briefing; say "over on Off-Plate" if it matters. Leave pasted URLs out of titles you say.

TRUTH
- Name a task, habit, meeting or anything else only by copying its title from the briefing or a lookup result, exactly.
- A number you say must be copied from the briefing or a lookup result. Never count rows yourself, never estimate, never round.
- You never perform anything yourself. You list actions in "do", the app runs them and writes what really happened under your answer. So never write that something is done ("Added it", "Moved that"). Say what you are setting in motion, briefly.

REPLY with ONE JSON object and nothing else, no fence, no prose around it:
{"say":"...","do":[{"kind":"add","title":"..."}],"find":[{"what":"notes","query":"vzp"}],"more":false,"show":[{"kind":"today"}],"next":["..."]}
- "do": every change he asked for, in order. A list he gives (dictated, pasted, several things in one breath) is one action per item, every item, never a sample. Several different requests in one message: do all of them.
- "find": look things up before acting on anything you cannot see in the briefing (projects, notes, people, goals, routines and their steps, bills, older tasks, calendar beyond tomorrow, focus, ideas, gym, prompts, apps). what = ${FINDS.join('|')}. query narrows by words in the title; leave it out to list them.
- After a find, a FAILED action, or "more":true, the app sends you RESULTS and you carry on with the same request: fix what failed using the exact title from the results, do what is still left, then answer. Never repeat an action the results list as ok. When nothing is left, reply with "say" only.
- "more": true when the job was too long for one reply; you get another turn for the rest.
- "show": cards the app draws from his real data, up to three: ${CARDS.join(', ')}. When you act, the app shows where each change landed by itself; "show" is for questions. None when he is just talking.
- "next": up to three follow-ups he might ask, in his voice.
- Act only when he asked for a change; a question is a question. Too vague to act on (which person, which circle, which of two tasks): ask, do not guess.
- "it" / "that one" is whatever he or you most recently named. "No, I meant X" corrects your last action: undo the wrong one, then do X. Lines in [App results: ...] in the history are what really happened earlier.
- A short yes or no answers your own last question. If that question proposed an action, run it now.

ACTIONS. * = required. "match" is words from the real title (task, habit, routine, goal, note, person, project, bill, card, prompt, app).
${VOCAB}

FIELD VALUES: slot morning|noon|afternoon|evening. list today|backlog. space personal|work (work = Big Time; Off-Plate and Michael's Corner are projects, so use "project"). date YYYY-MM-DD, worked out from Now in the briefing ("tomorrow", "Friday"). at HH:MM. min = minutes, only a number HE said. frequency daily|weekdays|times-per-week|weekly|monthly. cadence daily|prework|weekly|monthly. timeframe weekly|monthly|quarter|half. category money|health|life|work|offplate|habits. tier core|close|friends|business|wider|distant. channel inperson|call|message|video|email. type Idea|Bug|Update|Version. metric e1rm|repTotal|sessions|manual. page ${PAGES.join('|')}.

KNOW THE DIFFERENCE
- Workspace vs page vs app: "open up Big Time" = workspace. "open the bills page" = open. "turn on the Zone" = open zone. A tool by name ("open Watchless") = app.
- A habit is one tick. A routine is a sequence of steps: tick its steps with routineStep, or close it with routineDone; never "habit" on a routine. Quitting = habits made with breaking:true; slip only when he says he slipped. A habit not due today can still exist: check before saying it does not.
- Bills are not tasks. Money he pays is expense, money he receives is income. Bills not signed in, or still loading: say exactly which.
- note adds, noteEdit replaces, noteDelete removes. Never add when he asked to change one. "Clear my head" makes tasks, not notes.
- People circles from his words: core = family, partner, closest few. close = real close friends. friends. business = any professional tie. wider = knows and likes, rarely sees. distant = barely in touch. rel is his own words ("brother", "my accountant"). birthday MM-DD, a year is birthYear.
- Meetings have other people in them; blocks are hours he gave himself. Plan into blocks, not around them.
- focus starts a real timer immediately: a short "say", no debate.
- sync is only the Hevy workout sync. "Jarvis mode" / "Iron Man mode" is the jarvis action, the app's dark HUD look.

THE BUTTONS HE PRESSES
MORNING BRIEF, the one longer answer: four beats separated by \\n\\n, no headings, no numbering. 1 greet him by name and make a remark about the weather from the app's figures ("take a coat"), not a read-out. 2 what the day already asks of him: meetings, anything fixed to a time. 3 what to start with and why. 4 if something is LEFT OVER FROM YESTERDAY, name ONE and ask: on today, or back to the list? If yesterday was clean, one real sentence about what he FINISHED, then those titles as "- " lines, and no question. Never move anything in the brief itself; act when he answers. show weather, today, and backlog if something was left over.
EVENING CLOSE: one honest sentence about how the day actually went, what got done as "- " lines, what is still open, then ONE question about the single thing most worth deciding: tomorrow, or back to the list. show today.
WHAT AM I AVOIDING: the oldest untouched thing by name, and your blunt read on why it is still there (no first step, needs someone else, too big for the slot he keeps giving it). show stale.
PLAN TODAY AND TOMORROW: what is fixed across both days, what has to land before those points, where the free hours are. Up to four sentences. show today, calendar.
WHERE DID THE WEEK GO: focus, habits and goals, and what the shape of it says about the week. show focus, habits.
CLEAR MY HEAD: turn his talk into add actions in the right workspace or project, his words, nothing invented. Ask about anything too vague to be a task.`

/* The chips under the box. Not "attach", "search", "reason", "create image":
   those are a general chatbot's furniture and none of them is a thing this app
   can do. His words: he wants them to be practices that are useful in THIS
   application. So each one is a question about his own week that the assistant
   can actually answer from his own log, and pressing one asks it. */
/** What the doorway offers, as things he DOES rather than things he types.

    Each one sends a fully written question on his behalf and shows its own
    name in the thread, because he pressed a button and that is the thing he
    did. The paragraph behind it is engineering and he should never see it.

    Every one of these is answerable from his own log. None of them asks the
    model for anything it would have to invent. */
export interface Skill { label: string; ask: string }

export const MORNING: Skill = {
  label: 'Morning brief',
  ask: 'Give me my morning brief. What is it like out, what is on today, '
    + 'and what did I not finish yesterday?',
}

export const SKILLS: Skill[] = [
  {
    label: 'Evening close',
    ask: 'Close out my day. What actually got done, what is still open, and '
      + 'what should happen with the one thing I did not get to?',
  },
  {
    label: 'What am I avoiding',
    ask: 'What have I been putting off the longest? Be blunt about which one '
      + 'I keep carrying and why it is probably still here.',
  },
  {
    label: 'Plan today and tomorrow',
    ask: 'Help me plan. What is fixed today and tomorrow, what has to land '
      + 'before those, and where are the free hours?',
  },
  {
    label: 'Where did the week go',
    ask: 'Where did this week actually go? Focus, habits and goals, and what '
      + 'that says about how I spent it.',
  },
  {
    label: 'Clear my head',
    ask: 'I am going to talk at you. Turn what I say into tasks in the right '
      + 'workspaces, and ask me if anything is unclear.',
  },
]

/** The opening move, before he has asked anything. */
export const OPENING_PROMPT =
  'Open the day. Look at the briefing and tell me what deserves attention first, then show it.'

export function briefText(b: Brief): string {
  const slots = b.planned
    .map((s) => `${s.slot}: ${s.items.length ? s.items.map((i) => `[${i.space}] ${i.title}${i.done ? ' (done)' : ''}`).join('; ') : 'empty'}`)
    .join('\n')
  return [
    `Now: ${b.now}, ${b.weekday}`,
    'Everything below spans all his workspaces at once.',
    `Planned today:\n${slots}`,
    `Backlog: ${b.backlogCount} open`,
    b.backlog.length ? `On the list:\n${b.backlog.map((t) => `- [${t.space}] ${t.title}`).join('\n')}` : '',
    b.oldest.length ? `Oldest untouched: ${b.oldest.map((o) => `[${o.space}] ${o.title} (${o.days}d)`).join('; ')}` : 'Nothing is ageing badly',
    `Habits today: ${b.habits.kept} of ${b.habits.due} kept${b.habits.open.length ? `, still open: ${b.habits.open.join('; ')}` : ''}`,
    b.allHabits.length ? `Every real habit, whether or not due today: ${b.allHabits.join('; ')}` : '',
    b.routines.due ? `Routines this period: ${b.routines.kept} of ${b.routines.due} run${b.routines.open.length ? `, still open: ${b.routines.open.join('; ')}` : ''}` : '',
    b.meetings.length ? `Meetings, other people are in these: ${b.meetings.map((m) => `${m.at} ${m.title}`).join('; ')}` : 'No meetings in the calendar',
    b.blocks.length ? `Blocked out for himself, nobody else invited: ${b.blocks.map((m) => `${m.at} ${m.title}`).join('; ')}` : '',
    b.tomorrow.length ? `Already planned for TOMORROW:\n${b.tomorrow.map((t) => `- [${t.space}] ${t.title}`).join('\n')}` : 'Nothing planned for tomorrow yet',
    b.tomorrowMeetings.length ? `Tomorrow's meetings: ${b.tomorrowMeetings.map((m) => `${m.at} ${m.title}`).join('; ')}` : '',
    `Focus logged today: ${b.focusToday} minutes`,
    b.unfinishedYesterday.length
      ? `LEFT OVER FROM YESTERDAY, still not done:\n${b.unfinishedYesterday.map((t) => `- [${t.space}] ${t.title}`).join('\n')}`
      : 'Yesterday finished clean, nothing left over',
    b.completedYesterday.length
      ? `FINISHED YESTERDAY:\n${b.completedYesterday.map((t) => `- [${t.space}] ${t.title}`).join('\n')}`
      : 'Nothing marked done yesterday',
    b.weather ? `Weather, fetched by the app: ${b.weather}` : '',
    b.goals.length ? `Goals: ${b.goals.map((g) => `${g.name} ${g.pct}%`).join('; ')}` : 'No goals set',
    b.bills === 'loading'
      ? 'Bills: still loading on this device -- say so, do not claim signed out'
      : b.bills
        ? `Bills this cycle: ${b.bills.paid} of ${b.bills.due} paid${b.bills.open.length ? `, still unpaid: ${b.bills.open.join('; ')}` : ''}`
        : 'Bills: not signed in on this device, nothing to read',
    b.quitting.length ? `Quitting: ${b.quitting.map((q) => `${q.name}, ${q.days}d clean`).join('; ')}` : '',
    b.nextTask ? `Next up, the one thing Today itself would show him: ${b.nextTask}` : 'Nothing queued as next up',
  ].join('\n')
}

/** How much of "say" has arrived, decoded, from a reply that is still being
 *  written. The model emits `say` first, so this is readable long before the
 *  object closes: it is what turns a spinner into a sentence appearing. */
export function partialSay(raw: string): string | null {
  const k = raw.indexOf('"say"')
  if (k < 0) return null
  const colon = raw.indexOf(':', k + 5)
  if (colon < 0) return null
  const open = raw.indexOf('"', colon + 1)
  if (open < 0) return null
  const ESC: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' }
  let out = ''
  for (let i = open + 1; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '\\') {
      const next = raw[i + 1]
      /* The escape itself is only half here. Stop, and the next chunk finishes
         it, rather than printing a stray backslash for one frame. */
      if (next === undefined) break
      if (next === 'u') {
        if (i + 5 >= raw.length) break
        out += String.fromCharCode(parseInt(raw.slice(i + 2, i + 6), 16))
        i += 5
      } else { out += ESC[next] ?? next; i += 1 }
      continue
    }
    if (ch === '"') break
    out += ch
  }
  return out
}

/** The balanced {...} that CONTAINS `"say"`, or null.

    firstObject() takes the first object in the text, which is wrong the moment
    anything precedes the answer: this model leaks a reasoning block, and a
    reasoning block full of prose regularly contains a brace. The first object
    then parses perfectly and has no `say` in it, and the whole answer was
    thrown away for being unreadable while sitting further down the string. */
function objectWithSay(text: string): string | null {
  const k = text.indexOf('"say"')
  if (k < 0) return null
  // Walk back to the brace that opens the object this key belongs to.
  let depth = 0, start = -1
  for (let i = k; i >= 0; i--) {
    if (text[i] === '}') depth++
    else if (text[i] === '{') { if (!depth) { start = i; break } depth-- }
  }
  if (start < 0) return null
  const rest = firstObject(text.slice(start))
  return rest
}

/** JSON with real newlines inside its strings, repaired.

    The brief is written in beats, so `say` carries line breaks, and a model
    asked for \n in a JSON string will sometimes press Enter instead. That is
    invalid JSON and throws, over an answer that is otherwise perfect. */
function healNewlines(json: string): string {
  let out = '', inStr = false, esc = false
  for (const ch of json) {
    if (esc) { out += ch; esc = false; continue }
    if (ch === '\\') { out += ch; esc = true; continue }
    if (ch === '"') { inStr = !inStr; out += ch; continue }
    if (inStr && (ch === '\n' || ch === '\r')) { out += '\\n'; continue }
    if (inStr && ch === '\t') { out += '\\t'; continue }
    out += ch
  }
  return out
}

/** The first balanced {...} in a blob of text, or null. */
function firstObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (esc) { esc = false; continue }
    if (ch === '\\') { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (!depth) return text.slice(start, i + 1) }
  }
  return null
}

/** What an action did, in the app's words. assistantcore's Done is this plus
 *  the page-only extras (undo, the actual-time prompt). */
export interface Ran { ok: boolean; text: string }

type Failure = { ok: false; reason: 'no-key' | 'rejected' | 'offline' | 'unreadable' | 'model-gone' | 'rate-limit'; detail?: string }
export type Outcome = { ok: true; reply: Reply } | Failure

type Msg = { role: 'system' | 'user' | 'assistant'; content: string }

/* Gemini's own OpenAI-compatible surface, verified against this app's actual
   domain: streaming works, the message shapes match exactly, and the response
   carries `access-control-allow-origin` for off-plate.github.io specifically,
   not a wildcard that happened to work in a test. Groq-only extras (reasoning
   mode, response_format) are left off on purpose: this is the plain shape
   every OpenAI-compatible provider is guaranteed to understand, because the
   one thing this call cannot afford is a 400 from a flag Gemini does not
   recognise. */
const GEMINI_MODEL = 'gemini-3.6-flash'
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'

async function askGemini(messages: Msg[], onSay?: (partial: string) => void): Promise<Outcome | null> {
  const key = getTtsKey()
  try {
    const res = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        temperature: 0.3,
        stream: !!onSay,
        messages,
      }),
    })
    /* Not ok: Gemini is having its own bad day, or this key is not the right
       shape for chat. Either way, that is not news he needs; the caller falls
       through to the ordinary "Groq is busy" message as if this never ran. */
    if (!res.ok) return null
    if (onSay && res.body) return await readStream(res.body, onSay)
    const data = await res.json()
    return finish(String(data?.choices?.[0]?.message?.content ?? ''))
  } catch {
    return null
  }
}

/** One call to the active provider, with the Gemini fallback on a 429. */
async function once(messages: Msg[], key: string, onSay?: (partial: string) => void): Promise<Outcome> {
  let res: Response
  try {
    res = await request({
      model: activeModel(),
      temperature: 0.3,
      /* 700 was set when the answer was two sentences and a card name; 1400
         when the brief grew to four beats; 2200 when a finished-yesterday
         list added a few more lines of "say" on top of that. Each time it ran
         out the same way: the sentence finished, the object did not, "show"
         and "next" came back empty, and a real answer read as a broken one.
         6000 is for a genuinely different shape of answer, not a longer "say":
         a bulk "do" is one full action object PER ROW (his report,
         2026-09-10, thirty tasks pasted at once), and Czech titles with a
         pasted URL in them run long. A reasoning model spends part of this
         thinking before it writes a word, so the number has to cover more
         than the visible text either way.
         3000 since 2026-10-04: Groq's free tier counts the budget a request
         ASKS for against its 8,000 tokens a minute, and a long job no longer
         has to fit in one reply -- "more" hands the rest to the next round. */
      max_tokens: 3000,
      stream: !!onSay,
      messages,
    }, key)
  } catch {
    return { ok: false, reason: 'offline' }
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'rejected' }
  if (res.status === 429) {
    /* THE ACTIVE PROVIDER SAYS NO -- Groq or Z.ai, whichever the toggle in
       Settings points at. Before he sees a word about it, try Gemini with the
       exact same question, because he probably already has the key: it is the
       same one the voice reads answers with, stored by speech.ts, verified
       live and CORS-clean against this app's own domain before a line of this
       was written. He never had to know the main provider was full, and he
       never has to know Gemini answered instead. This is the same shape
       LiteLLM (github.com/BerriAI/litellm) calls "retry/fallback logic across
       multiple deployments", except LiteLLM is a server you would have to run
       and this app has no server: providers, one browser, no proxy in
       between.

       Falls through to the clean rate-limit message below only when there is
       no Gemini key, or Gemini also fails. It never shows the WAIT for the
       real answer he was already given a chance at. */
    const fallback = hasTtsKey() ? await askGemini(messages, onSay) : null
    /* Only a REAL answer is worth using. A failed fallback returns an Outcome
       too, {ok:false,...}, and that object is truthy: returning it unchecked
       would surface Gemini's own confusing failure instead of falling through
       to the one message he already understands. */
    if (fallback?.ok) return fallback

    /* A 429 body is a wall of text he should never see: an org id, a service
       tier, a token accounting, and a billing upsell link, ending in "Ask
       again, or rephrase it." on a request that was never unreadable. Two
       questions asked back to back after a card just wrote a habit or moved a
       task is enough to hit a per-minute cap, so this is ordinary traffic,
       not a fault. Only the number worth keeping - how long to wait - is
       pulled out, and the rest is dropped. The "try again in Xs" phrasing is
       Groq's own; a provider that says it differently just leaves wait null,
       and the hint below still holds without a number. */
    let wait: number | null = null
    try {
      const body = await res.json()
      const msg = body?.error?.message
      const m = typeof msg === 'string' ? /try again in ([\d.]+)s/i.exec(msg) : null
      if (m) wait = Math.ceil(Number(m[1]))
    } catch { /* keep wait null; the hint still holds without a number */ }
    return { ok: false, reason: 'rate-limit', detail: wait ? `${wait}` : undefined }
  }
  if (!res.ok) {
    /* Say WHAT went wrong, in the provider's own words. The model this app used
       was retired on 2026-08-16 and every AI feature died at once, silently,
       because each caller swallowed the error and showed nothing. A dead model
       answers 404 with a sentence naming itself; that sentence belongs on
       screen. */
    let detail = `The model answered ${res.status}.`
    try {
      const body = await res.json()
      const msg = body?.error?.message
      if (typeof msg === 'string' && msg.trim()) detail = msg.trim()
    } catch { /* not JSON, keep the status */ }
    return { ok: false, reason: res.status === 404 ? 'model-gone' : 'unreadable', detail }
  }

  if (onSay && res.body) return readStream(res.body, onSay)
  try {
    const data = await res.json()
    return finish(String(data?.choices?.[0]?.message?.content ?? ''))
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}

/** What the app lends the model for one turn: hands to act with, eyes to look
 *  with. Both run against his real store, never anything the model wrote. */
export interface Hands {
  run: (actions: Action[]) => Promise<Ran[]>
  find: (q: Find) => string
}

/* Enough for look-up, act, fix what failed, finish. Every round re-sends the
   whole conversation, so on Groq's free tier this cap is also the budget. */
const MAX_ROUNDS = 4

/** One turn, WORKED rather than answered (2026-10-04, his report: give it a
 *  couple of things and it does some of them). It used to be one call: the
 *  model named its actions blind, the app ran them, and the model never
 *  learned that half of them matched nothing. Now every action's real outcome
 *  and every lookup goes back to it, and it carries on until the job is done,
 *  the way a person works down a list. `history` is the conversation so far,
 *  oldest first; `onSay` streams each round's sentence as it is written. */
export async function ask(
  question: string,
  brief: Brief,
  history: { role: 'user' | 'assistant'; content: string }[],
  hands: Hands,
  onSay?: (partial: string) => void,
): Promise<Outcome> {
  const key = getAiKey()
  if (!key) return { ok: false, reason: 'no-key' }
  const messages: Msg[] = [
    { role: 'system', content: SYSTEM },
    { role: 'system', content: `Today's briefing, read from his own log:\n${briefText(brief)}` },
    ...history.slice(-8),
    { role: 'user', content: question },
  ]
  let last: Reply | null = null
  /* Each distinct action runs once per turn. A model that answers a failure
     it cannot fix (Bills signed out, no Hevy key) by sending the same action
     again would otherwise fail it four times over; dropped, the round has
     nothing new to do and the turn ends. */
  const tried = new Set<string>()
  let say = ''
  let show: Card[] = []
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let out = await once(messages, key, onSay)
    /* A RATE LIMIT WAITS RATHER THAN FAILS, on his instruction: he would
       rather watch the thinking mark for twenty seconds than press Ask again.
       Per round, so a limit hit halfway through a job resumes it instead of
       starting it again and running its first half twice. */
    for (let tries = 0; !out.ok && out.reason === 'rate-limit' && tries < 2; tries++) {
      onSay?.('')
      await new Promise((r) => setTimeout(r, (out.ok ? 0 : Math.max(1, Number(out.detail) || 20)) * 1000))
      out = await once(messages, key, onSay)
    }
    if (!out.ok) {
      /* Work already done stays reported: a later round failing must never
         hide the actions earlier rounds really ran. */
      if (!last) return out
      break
    }
    const r = out.reply
    last = r
    if (r.say) say = r.say
    if (r.show.length) show = r.show
    const fresh = (r.do ?? []).filter((x) => {
      const k = JSON.stringify(x)
      return tried.has(k) ? false : (tried.add(k), true)
    })
    const did = fresh.length ? await hands.run(fresh) : []
    const found = (r.find ?? []).map((f) => `LOOKUP ${f.what}${f.query ? ` "${f.query}"` : ''}:\n${hands.find(f)}`)
    if (!found.length && !did.some((d) => !d.ok) && !r.more) break
    messages.push(
      { role: 'assistant', content: JSON.stringify({ say: r.say, do: r.do, find: r.find }) },
      {
        role: 'user',
        content: [
          'RESULTS, written by the app, not by Michael:',
          ...did.map((d) => `${d.ok ? 'ok' : 'FAILED'}: ${d.text}`),
          ...found,
          'Carry on with the same request. Fix what failed using exact titles from the results, do whatever is still left, then answer. Never repeat an action listed as ok.',
        ].join('\n'),
      },
    )
  }
  const reply = last as Reply
  return { ok: true, reply: { ...reply, say: say || 'Here is what happened.', show, do: undefined, find: undefined } }
}

/* Server-sent events, one `data:` line at a time. Lines are cut on newlines
   from a buffer, because a frame is regularly split across two chunks and
   parsing what has arrived so far would throw on every second token. */
async function readStream(body: ReadableStream<Uint8Array>, onSay: (t: string) => void): Promise<Outcome> {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = '', raw = '', shown = -1
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const piece = JSON.parse(payload)?.choices?.[0]?.delta?.content
          if (typeof piece !== 'string' || !piece) continue
          raw += piece
          const say = partialSay(raw)
          if (say != null && say.length > shown) { shown = say.length; onSay(say) }
        } catch { /* a frame that is not JSON yet; the next read completes it */ }
      }
    }
  } catch {
    return { ok: false, reason: 'offline' }
  }
  return finish(raw)
}

/** One raw answer, whatever shape it came in, turned into a Reply.

    A LADDER, not a parse. Every rung below stands for an answer that was
    actually thrown away and shown to him as "the answer came back unreadable",
    which is the worst possible outcome: the model did the work, the sentence
    was fine, and the app binned it. Each rung gives up something (the cards,
    then the follow-ups) and keeps the sentence, because the sentence is the
    part he asked for. */
function finish(raw: string): Outcome {
  /* The reasoning block comes off FIRST. This model emits one, ai.ts says so,
     and nothing on this path was removing it. A block of prose containing a
     single brace was enough to send the parse into the middle of the model's
     own thinking. */
  const clean = stripReasoning(raw) || raw

  const attempts = [objectWithSay(clean), firstObject(clean), objectWithSay(raw), firstObject(raw)]
  for (const obj of attempts) {
    if (!obj) continue
    for (const candidate of [obj, healNewlines(obj)]) {
      try {
        const parsed = JSON.parse(candidate) as Partial<Reply>
        const say = typeof parsed.say === 'string' ? parsed.say.trim() : ''
        const act = cleanActions((parsed as { do?: unknown }).do)
        const find = cleanFinds(parsed.find)
        /* A round that only looks something up, or only acts, has nothing to
           say yet and is still a real answer. */
        if (!say && !act.length && !find.length) continue
        /* Anything it invented outside the card vocabulary is dropped rather
           than rendered: an unknown card is a card this app cannot promise. */
        const show = Array.isArray(parsed.show)
          ? parsed.show.filter((c): c is Card => !!c && CARDS.includes((c as Card).kind)).slice(0, 4)
          : []
        const next = Array.isArray(parsed.next)
          ? parsed.next.filter((n) => typeof n === 'string' && n.trim()).slice(0, 3)
          : []
        return { ok: true, reply: { say, show, next, do: act, find, more: parsed.more === true } }
      } catch { /* next candidate */ }
    }
  }

  /* Nothing parsed. The sentence is written before the closing brace and has
     already streamed onto the screen, so read it straight out of the text.
     Cards go: one that was never fully named is not one this app can promise. */
  for (const text of [clean, raw]) {
    const partial = partialSay(text)?.trim()
    if (partial) return { ok: true, reply: { say: partial, show: [], next: [] } }
  }
  /* Plain prose with no object at all: a model that forgot the format still
     said something to him, and that sentence is the part he asked for. */
  if (clean && !clean.includes('{')) return { ok: true, reply: { say: clean, show: [], next: [] } }

  /* Genuinely nothing usable. Carry a piece of what did come back, so the next
     report of this says what it actually was instead of only that it failed. */
  const peek = clean.replace(/\s+/g, ' ').trim().slice(0, 140)
  return { ok: false, reason: 'unreadable', detail: peek ? `It answered: ${peek}` : undefined }
}
