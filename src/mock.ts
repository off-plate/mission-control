import type {
  AgendaEvent,
  CoachScenario,
  Goal,
  HabitDef,
  Idea,
  LedgerEntry,
  Obligation,
  Routine,
  SocialEntry,
  SourceState,
  SpaceId,
  Task,
  WidgetDef,
  WidgetInstance,
  WidgetType,
} from './types'
import { fmtDayShort, lastBusinessDayOfMonth, nextDow } from './util'

/* All data in this file is invented for the demo. No real accounts,
   no real balances, no real creditors. The real app reads Supabase. */

export const WIDGET_DEFS: Record<WidgetType, WidgetDef> = {
  agenda: {
    type: 'agenda', title: 'Agenda', description: 'Next events from Google Calendar',
    supportedSizes: ['M', 'T', 'L'], defaultSize: 'T', freshMinutes: 4, staleAfter: 60, page: 'plan',
  },
  tasks: {
    type: 'tasks', title: 'Due today', description: 'TickTick and Trello, one list',
    supportedSizes: ['M', 'L', 'XL'], defaultSize: 'L', freshMinutes: 2, staleAfter: 60, page: 'plan',
  },
  mail: {
    type: 'mail', title: 'Mail', description: 'Unread counts across accounts',
    supportedSizes: ['S', 'M', 'T'], defaultSize: 'M', freshMinutes: 11, staleAfter: 60, page: 'settings',
  },
  finance: {
    type: 'finance', title: 'Money', description: 'Cycle budget and next obligation',
    supportedSizes: ['M', 'L'], defaultSize: 'M', freshMinutes: 60 * 7, staleAfter: 60 * 26, page: 'money',
  },
  habits: {
    type: 'habits', title: 'Habits', description: 'Today’s checkoffs, no guilt attached',
    supportedSizes: ['M', 'L'], defaultSize: 'M', freshMinutes: null, staleAfter: Infinity, page: 'habits',
  },
  training: {
    type: 'training', title: 'Training', description: 'Hevy: last session and weekly volume',
    supportedSizes: ['S', 'M', 'L'], defaultSize: 'M', freshMinutes: 95, staleAfter: 60 * 26, page: 'goals',
  },
  goals: {
    type: 'goals', title: 'Goals', description: 'Targets across timeframes and drift',
    supportedSizes: ['T', 'L'], defaultSize: 'L', freshMinutes: null, staleAfter: Infinity, page: 'goals',
  },
  timesaved: {
    type: 'timesaved', title: 'Time saved', description: 'Estimate minus actual, from your own log',
    supportedSizes: ['S', 'M'], defaultSize: 'S', freshMinutes: 0, staleAfter: Infinity, page: 'review',
  },
  claude: {
    type: 'claude', title: 'Claude', description: 'Sessions and tokens this week',
    supportedSizes: ['S', 'M'], defaultSize: 'S', freshMinutes: 32, staleAfter: 60 * 26, page: 'review',
  },
  social: {
    type: 'social', title: 'Audience', description: 'Followers and last post, entered weekly',
    supportedSizes: ['M', 'L'], defaultSize: 'M', freshMinutes: 60 * 24 * 9, staleAfter: 60 * 24 * 8, page: 'review',
  },
  sources: {
    type: 'sources', title: 'Sync health', description: 'Every connected source and its state',
    supportedSizes: ['S', 'T', 'M'], defaultSize: 'S', freshMinutes: 0, staleAfter: Infinity, page: 'settings',
  },
  outreach: {
    type: 'outreach', title: 'Outreach', description: 'The three live commitments and their state',
    supportedSizes: ['M', 'L'], defaultSize: 'M', freshMinutes: null, staleAfter: Infinity, page: 'goals',
  },
}

export const MOCK_OUTREACH: { name: string; state: string; ok: boolean }[] = []

let n = 0
const wid = (t: WidgetType) => `${t}-${++n}`

/* Only widgets backed by real state in this app. The rest stay available to add
   once their integration exists, rather than sitting on the page showing nothing. */
export const DEFAULT_SPACES: Record<SpaceId, WidgetInstance[]> = {
  personal: [
    { id: wid('tasks'), type: 'tasks', size: 'L' },
    { id: wid('habits'), type: 'habits', size: 'M' },
    { id: wid('goals'), type: 'goals', size: 'L' },
  ],
  work: [
    { id: wid('tasks'), type: 'tasks', size: 'L' },
    { id: wid('goals'), type: 'goals', size: 'M' },
  ],
  offplate: [
    { id: wid('tasks'), type: 'tasks', size: 'L' },
    { id: wid('goals'), type: 'goals', size: 'M' },
  ],
  corner: [
    { id: wid('tasks'), type: 'tasks', size: 'L' },
    { id: wid('goals'), type: 'goals', size: 'M' },
  ],
}

export const SPACE_LABELS: Record<SpaceId, string> = {
  personal: 'Personal',
  work: 'Big Time',
  offplate: 'Off-Plate',
  corner: 'Michael\u2019s Corner',
}

/** Seed ages, so the ageing detector has real history on a fresh install. */
const ago = (d: number) => { const x = new Date(); x.setDate(x.getDate() - d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}` }

export const MOCK_TASKS: Task[] = []

/* Only the habits a routine drives. Everything here is earned by running the
   routine, so no day is pre-ticked and no history is invented. */
export const MOCK_HABITS: HabitDef[] = [
  { id: 'h-morning', space: 'personal', name: 'Morning Preparation', daypart: 'morning', frequency: 'daily', paused: false, days: [false, false, false, false, false, false, false], history: [] },
  { id: 'h-wakeup', space: 'personal', name: 'After wake up', daypart: 'morning', frequency: 'daily', paused: false, days: [false, false, false, false, false, false, false], history: [] },
  /* Fed by a step of the after-wake-up routine, same wiring as meditation. */
  { id: 'h-creatine', space: 'personal', name: 'Take creatine', daypart: 'morning', frequency: 'daily', paused: false, days: [false, false, false, false, false, false, false], history: [] },
  { id: 'h-prework', space: 'personal', name: 'Before work routine', frequency: 'weekdays', paused: false, days: [false, false, false, false, false, false, false], history: [] },
  { id: 'h-evening', space: 'personal', name: 'Before bed routine', daypart: 'evening', frequency: 'daily', paused: false, days: [false, false, false, false, false, false, false], history: [] },
  { id: 'h-nightwork', space: 'personal', name: 'Night work routine', daypart: 'evening', frequency: 'daily', paused: false, days: [false, false, false, false, false, false, false], history: [] },
  /* No daypart: brain rot does not keep office hours, so this sits in Anytime
     until he decides it belongs to a part of the day. */
  { id: 'h-brainrot', space: 'personal', name: 'Out Brain Rot', frequency: 'daily', paused: false, days: [false, false, false, false, false, false, false], history: [] },
  /* Fed by a STEP, not by a whole routine: the meditation in the morning
     routine and the one in Out Brain Rot both keep it, and either is enough. */
  { id: 'h-meditation', space: 'personal', name: 'Meditation', frequency: 'daily', paused: false, days: [false, false, false, false, false, false, false], history: [] },
  /* Kept by the focus timer itself. Nothing to tick: the app already knows how
     long he focused, so asking him to confirm it would be asking twice. */
  { id: 'h-focus1h', space: 'personal', name: 'Focus for more than 1h', frequency: 'daily', paused: false, auto: { from: 'focus', minutes: 60 }, days: [false, false, false, false, false, false, false], history: [] },
  { id: 'h-morningwork', space: 'work', name: 'Morning Big Time work routine', daypart: 'morning', frequency: 'weekdays', paused: false, days: [false, false, false, false, false, false, false], history: [] },
  /* One per working workspace, all fed by the clock: thirty minutes of focus
     on that workspace's OWN tasks keeps it, partial blocks included, because a
     banked half-block is still minutes worked. */
  { id: 'h-focus-work', space: 'work', name: 'Focus for 30 minutes', frequency: 'daily', paused: false, auto: { from: 'focus', minutes: 30 }, days: [false, false, false, false, false, false, false], history: [] },
  { id: 'h-focus-offplate', space: 'offplate', name: 'Focus for 30 minutes', frequency: 'daily', paused: false, auto: { from: 'focus', minutes: 30 }, days: [false, false, false, false, false, false, false], history: [] },
  { id: 'h-focus-corner', space: 'corner', name: 'Focus for 30 minutes', frequency: 'daily', paused: false, auto: { from: 'focus', minutes: 30 }, days: [false, false, false, false, false, false, false], history: [] },
  { id: 'h-weekly', space: 'personal', name: 'Weekly review', frequency: 'weekly', paused: false, days: [false, false, false, false, false, false, false], history: [] },
  { id: 'h-invoicing', space: 'work', name: 'Invoicing routine', frequency: 'monthly', paused: false, days: [false, false, false, false, false, false, false], history: [] },
  { id: 'h-monthly', space: 'personal', name: 'Monthly review', frequency: 'monthly', paused: false, days: [false, false, false, false, false, false, false], history: [] },
]

export const MOCK_IDEAS: Idea[] = [
  { id: 'idea-rubberband', space: 'personal', text: 'Rubber band on my wrist, snap it whenever I catch myself doing something I do not want to do (doomscroll, avoidance, overstimulation). A pattern interrupt, not punishment. Later: track the catches so they trend down over time. #tools', when: 'idea', color: 'amber' },
]

export const MOCK_ROUTINES: Routine[] = [
  /* The first ten minutes of being awake: what happens before the day's
     ritual starts. Creatine lives here now, next to the glass Before bed
     leaves on the counter. */
  {
    id: 'r-wakeup', space: 'personal', title: 'After wake up', cadence: 'daily', habitId: 'h-wakeup',
    doneStepIds: [],
    steps: [
      { id: 'wu0', title: 'No social media or YouTube before this routine is done', kind: 'do', note: 'The first scroll of the day sets the tone for every other one.' },
      { id: 'wu1', title: 'Make the bed', kind: 'do', optional: true, note: 'Skip it if she is still in it, or already did it.' },
      { id: 'wu2', title: 'Take creatine', kind: 'do', habitId: 'h-creatine', note: 'The glass you left on the counter last night.' },
      { id: 'wu3', title: 'Eat a breakfast', kind: 'do' },
      { id: 'wu4', title: 'Brush the teeth', kind: 'do' },
    ],
  },
  {
    id: 'r-morning', space: 'personal', title: 'Morning Preparation', cadence: 'daily', habitId: 'h-morning',
    
    doneStepIds: [],
    steps: [
      { id: 'mr1', title: 'Meditation', kind: 'timer', seconds: 300, habitId: 'h-meditation', note: 'Sit, eyes closed, follow the breath. Five minutes, no phone.', link: 'https://www.youtube.com/watch?v=1ZYbU82GVz4', linkLabel: 'Open the soundtrack' },
      { id: 'mr2', title: 'Pronunciation test', kind: 'do', note: 'Read a short passage out loud, record it, listen back once.' },
      { id: 'mr3', title: 'Jazykolam mouth stretch', kind: 'do', note: 'Loosen the jaw and lips, then a tongue-twister three times, fast and clean.', example: 'Strč prst skrz krk.' },
      { id: 'mr4', title: 'Typing test', kind: 'do', note: 'One quick round to wake the hands up.', link: 'https://monkeytype.com', linkLabel: 'Open typing test' },
      { id: 'mr5', title: 'Remind yourself of your goals', kind: 'do', note: 'Look at what you are actually working toward before the day pulls you elsewhere.' },
    ],
  },
  {
    id: 'r-prework', space: 'personal', title: 'Before work routine', cadence: 'prework', habitId: 'h-prework',
    doneStepIds: [],
    steps: [
      { id: 'pw1', title: 'Clean up the workdesk', kind: 'do' },
      { id: 'pw2', title: 'Bring water to the desk', kind: 'do' },
      { id: 'pw3', title: 'Define the specific task', kind: 'do' },
      { id: 'pw4', title: 'Find ambient music', kind: 'do', optional: true },
      { id: 'pw5', title: 'Set the focus for the time you want the task to take', kind: 'do' },
    ],
  },
  /* Big Time's own morning ritual. Weekday-gated like Before work: a work
     routine has no Saturday. Steps are his to write. */
  {
    id: 'r-morningwork', space: 'work', title: 'Morning Big Time work routine', cadence: 'prework', habitId: 'h-morningwork',
    doneStepIds: [],
    steps: [
      { id: 'mw1', title: 'See yesterday’s and last week’s focuses', kind: 'do', note: 'In Google Calendar. Move whatever you did not finish to today or this week.' },
      { id: 'mw2', title: 'Go through the email notifications and clean the inbox', kind: 'do' },
      { id: 'mw3', title: 'Go through the Trello notifications and updates', kind: 'do' },
      { id: 'mw4', title: 'Go through the Jira updates', kind: 'do' },
      { id: 'mw5', title: 'Define today’s focuses in the calendar', kind: 'do', note: 'And plan ahead, if you can.' },
    ],
  },
  /* Invoicing is a Big Time job with an order to it, and the order is the point:
     the hours have to be right before a description is written for them. */
  {
    id: 'r-invoicing', space: 'work', title: 'Invoicing routine', cadence: 'monthly', habitId: 'h-invoicing',
    repeatable: true,
    doneStepIds: [],
    steps: [
      { id: 'in1', title: 'Go through every project in Costlocker', kind: 'do' },
      { id: 'in2', title: 'Review the hours inside each project', kind: 'do' },
      { id: 'in3', title: 'Prepare placeholders wherever there will be external expenses', kind: 'do' },
      { id: 'in4', title: 'Prepare the descriptions for the invoicing', kind: 'do' },
    ],
  },
  {
    id: 'r-evening', space: 'personal', title: 'Before bed routine', cadence: 'daily', habitId: 'h-evening',
    doneStepIds: [],
    steps: [
      { id: 'be1', title: 'Prepare to-do list for tomorrow', kind: 'do' },
      { id: 'be8', title: 'Review Compass finances', kind: 'do', link: 'https://compass-money.netlify.app', linkLabel: 'Open Compass' },
      { id: 'be2', title: 'Prepare clothes for tomorrow', kind: 'do', note: 'Laid out and ready.' },
      { id: 'be3', title: 'Prepare creatine', kind: 'do', note: 'Scoop into the glass, water in, leave it on the counter.' },
      { id: 'be4', title: 'Brush teeth', kind: 'do' },
      { id: 'be7', title: 'Light stretching', kind: 'timer', seconds: 600, note: 'Ten minutes, easy. Nothing that wakes you up.' },
      { id: 'be5', title: 'Fold today\u2019s clothes', kind: 'do', note: 'Off, folded, put away.' },
      { id: 'be6', title: 'Set the alarm', kind: 'do' },
    ],
  },
  /* Night work is Off-Plate work: evening business sessions, ended on purpose.
     The end time is a step because the midnight rule is policy, not mood. */
  {
    id: 'r-nightwork', space: 'personal', title: 'Night work routine', cadence: 'daily', habitId: 'h-nightwork',
    doneStepIds: [],
    steps: [
      { id: 'nw1', title: 'Define the tasks for the night', kind: 'do', note: 'Off today\u2019s list.' },
      { id: 'nw2', title: 'Set the end time', kind: 'do', note: 'Decide when you stop before you start.' },
      { id: 'nw3', title: 'Clear the desk', kind: 'do', note: 'Phone out of reach. Nothing else open.' },
      { id: 'nw4', title: 'Start with the first task', kind: 'do' },
      { id: 'nw5', title: 'Stop at the end time', kind: 'do', note: 'Write one line: where you stopped and what\u2019s next.' },
    ],
  },
  {
    id: 'r-brainrot', space: 'personal', title: 'Out Brain Rot', cadence: 'daily', habitId: 'h-brainrot', repeatable: true,
    doneStepIds: [],
    steps: [
      /* The first step in the app that can be answered two ways. Whether he
         moved or reached for coffee is the interesting part, so the choice is
         recorded rather than flattened into one tick. */
      { id: 'br-ice', title: 'Wash your face in ice cold water', kind: 'do', optional: true },
      { id: 'br1', title: 'Move or caffeine', kind: 'do', alts: [
        { id: 'br1-move', title: 'Move', note: 'Time available, so something hard: run, StairMaster, heavy gym session.' },
        { id: 'br1-caffeine', title: 'Caffeine', note: 'No time, so coffee. Take it immediately, do not wait for it to kick in.' },
      ] },
      { id: 'br2', title: 'To-do list', kind: 'do', note: 'Sit down. Write what you want to do and what your focus is. Kill all distractions, phone away, no screens for at least 10 minutes.' },
      { id: 'br3', title: 'Pick one task', kind: 'do', note: 'One. Off the list you just wrote.' },
      { id: 'br4', title: 'Meditate', kind: 'timer', seconds: 300, habitId: 'h-meditation', note: 'Calm music. Minimum 5 minutes.' },
      { id: 'br5', title: 'Start', kind: 'do', note: 'Work on the one task.' },
    ],
  },
  {
    id: 'r-weekly', space: 'personal', title: 'Weekly review', cadence: 'weekly', habitId: 'h-weekly',
    doneStepIds: [],
    steps: [
      { id: 'wr1', title: 'Refill vitamins in the GymBeam box', kind: 'do' },
      { id: 'wr2', title: 'Review last week: goals and what stayed undone', kind: 'do', note: 'The journal and Mission Control, both.', goto: 'review', gotoLabel: 'Open last week in Reflect' },
      { id: 'wr3', title: 'Plan next week’s goals', kind: 'do' },
      { id: 'wr4', title: 'Plan Monday’s tasks', kind: 'do' },
    ],
  },
  {
    id: 'r-monthly', space: 'personal', title: 'Monthly review', cadence: 'monthly', habitId: 'h-monthly',
    doneStepIds: [],
    steps: [
      { id: 'mo0', title: 'Reflect the month', kind: 'do', goto: 'review', gotoLabel: 'Open the month in Reflect' },
      { id: 'mo1', title: 'Review last month’s goals', kind: 'do' },
      { id: 'mo2', title: 'Plan next month’s goals', kind: 'do' },
      { id: 'mo3', title: 'Review the finances', kind: 'do', note: 'Savings, total spent, total received, debt update.' },
    ],
  },
]

/* Steps added to a seeded routine AFTER its list had already been handed over.
   Only these are inserted into a routine that already has steps. Without the
   list, every seeded step would look like one that had gone missing, and a step
   he deleted months ago would reappear the next time he opened the app. */
export const LATE_STEPS = new Set(['br-ice', 'wu0', 'be7', 'mo0'])

export const MOCK_GOALS: Goal[] = []

export const MOCK_LEDGER: LedgerEntry[] = []

export const MOCK_AGENDA: Record<SpaceId, AgendaEvent[]> = { personal: [], work: [], offplate: [], corner: [] }

export const MOCK_MAIL: Record<SpaceId, { addr: string; unread: number; top: string; age: string }[]> = { personal: [], work: [], offplate: [], corner: [] }

export const MOCK_SOCIAL: SocialEntry[] = []

export const MOCK_TRAINING: { last: string; next: string; weeklySets: number[] } | null = null

export const MOCK_CLAUDE: { sessionsToday: number; tokensWeek: number[]; note: string } | null = null

/* No invented balances. The real figures live in Compass; until that link
   exists this is empty and the page says so rather than showing fiction. */
export const MOCK_MONEY: {
  debt: { original: string; remaining: string; paid: string; pct: number; monthly: string }
  savings: { thisMonth: string; total: string; months: number[]; monthLabels: string[]; note: string }
  debtTrend: number[]
  debtMonths: string[]
  spentPct: number
  budgetLine: string
  safeToSpend: string
  safeUntil: string
  safeMath: string
  obligations: Obligation[]
  schedule: { date: string; name: string; amount: string; state: string }[]
} | null = null

/* The integrations this app is meant to read. None are wired yet, and saying
   "connected" when nothing is would be the same lie as inventing the data. */
export const MOCK_SOURCES: SourceState[] = [
  { id: 's1', name: 'Google Calendar', kind: 'calendar', status: 'off', detail: 'Not connected yet' },
  { id: 's2', name: 'TickTick', kind: 'tasks', status: 'off', detail: 'Not connected yet' },
  { id: 's5', name: 'Gmail personal', kind: 'mail', status: 'off', detail: 'Not connected yet' },
  { id: 's6', name: 'Gmail Off-Plate', kind: 'mail', status: 'off', detail: 'Not connected yet' },
  { id: 's7', name: 'Compass', kind: 'money', status: 'off', detail: 'Not connected yet' },
  { id: 's8', name: 'Hevy', kind: 'training', status: 'off', detail: 'Not connected yet' },
]

export const MOCK_STATS: { weeklySavedMin: number[]; weeklyAccuracy: number[]; calibration: { category: string; label: string; factor: number; note: string }[] } = { weeklySavedMin: [], weeklyAccuracy: [], calibration: [] }

export interface DecomposedStep { title: string; why?: string; estimateMin: number; category?: 'call' | 'admin' | 'deep' | 'quick' }

/* Order matters: the most specific matcher must come first. A generic /plan/
   used to sit at the top and swallowed "set up the bank payment plan", which is
   the field's own placeholder, so the money steps were unreachable. */
const LIBRARY: { match: RegExp; steps: DecomposedStep[] }[] = [
  {
    match: /payment|splátk|bank|insur|poji|invoice|faktur|tax|daň|call|zavol|phone/i,
    steps: [
      { title: 'Find the contract number and the last letter', estimateMin: 5 },
      { title: 'Write one sentence: what you are asking them for', estimateMin: 3 },
      { title: 'Rehearse the opening line in Avoidance', estimateMin: 4 },
      { title: 'Make the call before 11:00', why: 'queues are shortest in the morning', estimateMin: 15, category: 'call' },
      { title: 'Log the agreed next step and date', estimateMin: 3 },
    ],
  },
  {
    match: /post|linkedin|article|video/i,
    steps: [
      { title: 'Pick one concrete story from this week', estimateMin: 5 },
      { title: 'Draft 8 to 10 lines, no editing', estimateMin: 12, category: 'deep' },
      { title: 'Cut a third of it', why: 'shorter always reads better', estimateMin: 6 },
      { title: 'Add one specific number or receipt', estimateMin: 4 },
      { title: 'Schedule for tomorrow 8:30', estimateMin: 3 },
    ],
  },
  {
    match: /week|týden|reset|review|plan the/i,
    steps: [
      { title: 'Empty every inbox into one list', why: 'mail, TickTick, Trello, notes', estimateMin: 8 },
      { title: 'Pick three outcomes for the week', why: 'results you can check off, like: plan sent', estimateMin: 6 },
      { title: 'Slot the three outcomes into real calendar blocks', estimateMin: 7, category: 'admin' },
      { title: 'Book the unpleasant call first', why: 'hardest thing gets the best slot', estimateMin: 4 },
      { title: 'Set Sunday reminder for the next reset', estimateMin: 2 },
    ],
  },
]

const GENERIC: DecomposedStep[] = [
  { title: 'Name what done looks like, one sentence', estimateMin: 3 },
  { title: 'List what you already have and what is missing', estimateMin: 6 },
  { title: 'Do the smallest missing piece first', why: 'a 10 minute starter breaks the avoidance', estimateMin: 10 },
  { title: 'Do the main chunk in one sitting', estimateMin: 25, category: 'deep' },
  { title: 'Check the result against the first sentence', estimateMin: 4 },
]

export function fakeDecompose(goal: string): DecomposedStep[] {
  const hit = LIBRARY.find((l) => l.match.test(goal))
  return hit ? hit.steps : GENERIC
}

/* ---- coach scenarios, canned for the demo ---- */

export const COACH_SCENARIOS: CoachScenario[] = []
