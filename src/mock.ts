import type {
  AgendaEvent,
  ExceptionItem,
  Habit,
  LedgerEntry,
  SpaceId,
  Task,
  WidgetDef,
  WidgetInstance,
  WidgetType,
} from './types'

/* All data in this file is invented for the demo. No real accounts,
   no real balances, no real creditors. The real app reads Supabase. */

export const WIDGET_DEFS: Record<WidgetType, WidgetDef> = {
  agenda: {
    type: 'agenda', title: 'Agenda', description: 'Next events from Google Calendar',
    supportedSizes: ['M', 'T', 'L'], defaultSize: 'T', freshMinutes: 4, staleAfter: 60,
  },
  tasks: {
    type: 'tasks', title: 'Due today', description: 'TickTick and Trello, one list',
    supportedSizes: ['M', 'L', 'XL'], defaultSize: 'L', freshMinutes: 2, staleAfter: 60,
  },
  mail: {
    type: 'mail', title: 'Mail', description: 'Unread counts across accounts',
    supportedSizes: ['S', 'M', 'T'], defaultSize: 'M', freshMinutes: 11, staleAfter: 60,
  },
  finance: {
    type: 'finance', title: 'Money', description: 'Compass: cycle budget and next obligation',
    supportedSizes: ['M', 'L'], defaultSize: 'M', freshMinutes: 60 * 7, staleAfter: 60 * 26,
  },
  habits: {
    type: 'habits', title: 'Habits', description: 'Today’s checkoffs, no guilt attached',
    supportedSizes: ['M', 'L'], defaultSize: 'M', freshMinutes: null, staleAfter: Infinity,
  },
  training: {
    type: 'training', title: 'Training', description: 'Hevy: last session and weekly volume',
    supportedSizes: ['S', 'M', 'L'], defaultSize: 'M', freshMinutes: 95, staleAfter: 60 * 26,
  },
  goals: {
    type: 'goals', title: 'Quarter goals', description: 'Q3 targets and drift',
    supportedSizes: ['T', 'L'], defaultSize: 'L', freshMinutes: null, staleAfter: Infinity,
  },
  timesaved: {
    type: 'timesaved', title: 'Time saved', description: 'Estimate minus actual, from your own log',
    supportedSizes: ['S', 'M'], defaultSize: 'S', freshMinutes: 0, staleAfter: Infinity,
  },
  claude: {
    type: 'claude', title: 'Claude', description: 'Sessions and tokens this week',
    supportedSizes: ['S', 'M'], defaultSize: 'S', freshMinutes: 32, staleAfter: 60 * 26,
  },
  social: {
    type: 'social', title: 'Audience', description: 'Followers and last post, entered weekly',
    supportedSizes: ['M', 'L'], defaultSize: 'M', freshMinutes: 60 * 24 * 9, staleAfter: 60 * 24 * 8,
  },
  sources: {
    type: 'sources', title: 'Sync health', description: 'Every connected source and its state',
    supportedSizes: ['S', 'T', 'M'], defaultSize: 'S', freshMinutes: 0, staleAfter: Infinity,
  },
}

let n = 0
const wid = (t: WidgetType) => `${t}-${++n}`

export const DEFAULT_SPACES: Record<SpaceId, WidgetInstance[]> = {
  personal: [
    { id: wid('agenda'), type: 'agenda', size: 'T' },
    { id: wid('tasks'), type: 'tasks', size: 'L' },
    { id: wid('habits'), type: 'habits', size: 'M' },
    { id: wid('finance'), type: 'finance', size: 'M' },
    { id: wid('timesaved'), type: 'timesaved', size: 'S' },
    { id: wid('training'), type: 'training', size: 'S' },
    { id: wid('mail'), type: 'mail', size: 'M' },
    { id: wid('goals'), type: 'goals', size: 'L' },
    { id: wid('claude'), type: 'claude', size: 'S' },
    { id: wid('sources'), type: 'sources', size: 'S' },
  ],
  work: [
    { id: wid('agenda'), type: 'agenda', size: 'T' },
    { id: wid('tasks'), type: 'tasks', size: 'XL' },
    { id: wid('mail'), type: 'mail', size: 'M' },
    { id: wid('timesaved'), type: 'timesaved', size: 'S' },
    { id: wid('claude'), type: 'claude', size: 'S' },
  ],
  offplate: [
    { id: wid('social'), type: 'social', size: 'L' },
    { id: wid('tasks'), type: 'tasks', size: 'L' },
    { id: wid('mail'), type: 'mail', size: 'S' },
    { id: wid('goals'), type: 'goals', size: 'T' },
    { id: wid('timesaved'), type: 'timesaved', size: 'S' },
  ],
}

export const SPACE_LABELS: Record<SpaceId, string> = {
  personal: 'Personal',
  work: 'Work',
  offplate: 'Off-Plate',
}

export const MOCK_TASKS: Task[] = [
  { id: 't1', title: 'Reply to the accountant about missing documents', source: 'ticktick', estimateMin: 15, done: false, space: 'personal' },
  { id: 't2', title: 'Book car service before the Italy trip', source: 'ticktick', estimateMin: 10, done: false, space: 'personal' },
  { id: 't3', title: 'Check Datová schránka', source: 'mc', estimateMin: 5, done: false, space: 'personal' },
  { id: 't4', title: 'Move washing machine repair card to Done', source: 'trello', estimateMin: 5, done: true, actualMin: 3, space: 'personal' },
  { id: 't5', title: 'Prep talking points for Tuesday sync', source: 'ticktick', estimateMin: 25, done: false, space: 'work' },
  { id: 't6', title: 'Review the two open pull requests', source: 'jira', estimateMin: 40, done: false, space: 'work' },
  { id: 't7', title: 'Close DASH-214: onboarding empty state', source: 'jira', estimateMin: 30, done: false, space: 'work' },
  { id: 't8', title: 'Send follow-up to Thursday’s workshop lead', source: 'ticktick', estimateMin: 15, done: false, space: 'offplate' },
  { id: 't9', title: 'Draft next LinkedIn post from the outline', source: 'trello', estimateMin: 30, done: false, space: 'offplate' },
]

export const MOCK_HABITS: Habit[] = [
  { id: 'h1', name: 'In bed before 1:00', done: false },
  { id: 'h2', name: 'Morning check-in', done: true },
  { id: 'h3', name: '20 min movement', done: false },
  { id: 'h4', name: 'No screens at dinner', done: false },
]

export const MOCK_LEDGER: LedgerEntry[] = [
  { id: 'l1', title: 'Weekly plan drafted with AI breakdown', estimateMin: 45, actualMin: 20, when: 'Mon' },
  { id: 'l2', title: 'Insurance call, script prepared in Coach', estimateMin: 30, actualMin: 12, when: 'Tue' },
  { id: 'l3', title: 'Inbox sweep with priority labels', estimateMin: 25, actualMin: 21, when: 'Wed' },
  { id: 'l4', title: 'Invoice batch in Fakturoid', estimateMin: 20, actualMin: 24, when: 'Thu' },
  { id: 'l5', title: 'Trip packing list generated and checked', estimateMin: 30, actualMin: 11, when: 'Fri' },
]

export const MOCK_AGENDA: Record<SpaceId, AgendaEvent[]> = {
  personal: [
    { id: 'e1', start: '17:30', end: '18:30', title: 'Gym: push day', where: 'Form Factory' },
    { id: 'e2', start: '19:30', end: '20:00', title: 'Call with Dad' },
    { id: 'e3', start: '21:00', end: '21:30', title: 'Evening shutdown, plan tomorrow' },
  ],
  work: [
    { id: 'e4', start: '09:30', end: '10:00', title: 'Standup', where: 'Meet' },
    { id: 'e5', start: '13:00', end: '14:00', title: 'Design review: onboarding' },
    { id: 'e6', start: '15:30', end: '16:00', title: '1:1 with Petra' },
  ],
  offplate: [
    { id: 'e7', start: '18:00', end: '19:00', title: 'Client call: workshop scope' },
  ],
}

export const MOCK_EXCEPTIONS: ExceptionItem[] = [
  { id: 'x1', text: 'Payment plan installment due Friday. Not sent yet.', when: 'due in 3 days' },
  { id: 'x2', text: 'Datová schránka unchecked for 8 days. Sunday rule slipped.', when: '8 days', action: 'coach' },
]

export const MOCK_MAIL: Record<SpaceId, { addr: string; unread: number; top: string }[]> = {
  personal: [
    { addr: 'personal @gmail', unread: 4, top: 'Energy provider: July statement is ready' },
    { addr: 'side hustle @gmail', unread: 2, top: 'Workshop inquiry from the contact form' },
  ],
  work: [
    { addr: 'work @company', unread: 7, top: 'RE: Q3 roadmap comments before Thursday' },
  ],
  offplate: [
    { addr: 'side hustle @gmail', unread: 2, top: 'Workshop inquiry from the contact form' },
  ],
}

export const MOCK_GOALS: Record<SpaceId, { name: string; pct: number; drift: 'ok' | 'off'; note: string }[]> = {
  personal: [
    { name: 'Every obligation on a payment plan', pct: 66, drift: 'ok', note: '2 of 3 agreed' },
    { name: 'Sleep before 1:00, five nights a week', pct: 40, drift: 'off', note: '2 of 5 this week' },
    { name: 'Weekly reset every Sunday', pct: 75, drift: 'ok', note: '9 of 12 weeks' },
  ],
  work: [
    { name: 'Ship onboarding revamp', pct: 55, drift: 'ok', note: 'on track for Aug' },
  ],
  offplate: [
    { name: '10 discovery calls this quarter', pct: 30, drift: 'off', note: '3 of 10 booked' },
    { name: 'Publish weekly on LinkedIn', pct: 58, drift: 'ok', note: '7 of 12 weeks' },
  ],
}

export const MOCK_SOCIAL = [
  { platform: 'LinkedIn', followers: 1284, change: +37, lastPost: '2.1k impressions', label: 'entered Sunday' },
  { platform: 'Instagram', followers: 862, change: +12, lastPost: '318 reach', label: 'entered Sunday' },
  { platform: 'Facebook', followers: 445, change: -3, lastPost: '96 reach', label: 'entered Sunday' },
]

export const MOCK_TRAINING = {
  last: 'Push day, Thu: bench 4x6 at 72.5',
  next: 'Pull day, tomorrow 17:30',
  weeklySets: [14, 18, 16, 20, 17, 19, 21, 18],
}

export const MOCK_CLAUDE = {
  sessionsToday: 6,
  tokensWeek: [310, 420, 180, 510, 460, 220, 390],
  note: 'estimated from local session logs',
}

export const MOCK_FINANCE = {
  cycleLabel: 'Pay cycle, day 12 of 30',
  spentPct: 46,
  onPlan: true,
  nextObligation: 'Installment: payment plan, Friday',
  buffer: 'Buffer on plan',
}

export const MOCK_SOURCES: { name: string; state: 'live' | 'stale' | 'manual' }[] = [
  { name: 'Calendar', state: 'live' },
  { name: 'TickTick', state: 'live' },
  { name: 'Trello', state: 'live' },
  { name: 'Mail', state: 'live' },
  { name: 'Compass', state: 'live' },
  { name: 'Hevy', state: 'live' },
  { name: 'Audience', state: 'stale' },
  { name: 'Schránka', state: 'manual' },
]

/* ---- fake decomposition, so the demo shows the interaction ---- */

export interface DecomposedStep { title: string; why?: string; estimateMin: number }

const LIBRARY: { match: RegExp; steps: DecomposedStep[] }[] = [
  {
    match: /week|týden|plan/i,
    steps: [
      { title: 'Empty every inbox into one list', why: 'mail, TickTick, Trello, notes', estimateMin: 8 },
      { title: 'Pick three outcomes for the week', why: 'outcomes, not activities', estimateMin: 6 },
      { title: 'Slot the three outcomes into real calendar blocks', estimateMin: 7 },
      { title: 'Book the unpleasant call first', why: 'hardest thing gets the best slot', estimateMin: 4 },
      { title: 'Set Sunday reminder for the next reset', estimateMin: 2 },
    ],
  },
  {
    match: /call|zavol|phone|vzp|bank/i,
    steps: [
      { title: 'Write down the one outcome you want from the call', estimateMin: 3 },
      { title: 'Open Coach and generate the opening line', estimateMin: 4 },
      { title: 'Find contract number and last letter', estimateMin: 5 },
      { title: 'Make the call before 11:00', why: 'queues are shortest in the morning', estimateMin: 15 },
      { title: 'Log the agreed next step and date', estimateMin: 3 },
    ],
  },
  {
    match: /post|linkedin|article|video/i,
    steps: [
      { title: 'Pick one concrete story from this week', estimateMin: 5 },
      { title: 'Draft 8 to 10 lines, no editing', estimateMin: 12 },
      { title: 'Cut a third of it', why: 'shorter always reads better', estimateMin: 6 },
      { title: 'Add one specific number or receipt', estimateMin: 4 },
      { title: 'Schedule for tomorrow 8:30', estimateMin: 3 },
    ],
  },
]

const GENERIC: DecomposedStep[] = [
  { title: 'Name what done looks like, one sentence', estimateMin: 3 },
  { title: 'List what you already have and what is missing', estimateMin: 6 },
  { title: 'Do the smallest missing piece first', why: 'a 10 minute starter breaks the avoidance', estimateMin: 10 },
  { title: 'Do the main chunk in one sitting', estimateMin: 25 },
  { title: 'Check the result against the first sentence', estimateMin: 4 },
]

export function fakeDecompose(goal: string): DecomposedStep[] {
  const hit = LIBRARY.find((l) => l.match.test(goal))
  const base = hit ? hit.steps : GENERIC
  const count = 3 + (goal.length % 3)
  return base.slice(0, Math.max(3, Math.min(base.length, count + 2)))
}

/* ---- coach scenario, canned for the demo ---- */

export interface CoachStep {
  label: string
  question: string
  scripts?: { say: string; text: string }[]
  body?: string
}

export const COACH_DEMO: CoachStep[] = [
  {
    label: 'Frame',
    question: 'What is the situation, and what do you want out of it?',
    body: 'Example loaded: calling the insurance office about a payment plan you proposed three weeks ago and they never confirmed. You want written confirmation, or a clear answer on what is missing.',
  },
  {
    label: 'Script',
    question: 'Your opening, in your own voice',
    scripts: [
      { say: 'Opening', text: 'Dobrý den, volám ohledně splátkového kalendáře, který jsem podal 11. dubna. Potřebuji potvrzení, že je schválený.' },
      { say: 'Key line', text: 'Chápu, že to má svůj proces. Potřebuji ale písemnou odpověď do konce týdne.' },
      { say: 'If asked why', text: 'Chci mít jistotu, že další platba proběhne podle dohody, ne podle odhadu.' },
    ],
  },
  {
    label: 'Rehearse',
    question: 'They say: "We cannot see your request in the system."',
    scripts: [
      { say: 'You answer', text: 'Mám podací číslo a datum. Nadiktuji vám ho. Prosím ověřte, kam se požadavek dostal.' },
    ],
    body: 'In the real app the model plays the counterpart for two or three exchanges and suggests each answer. It never invents institutional facts; when unsure it tells you to verify directly.',
  },
  {
    label: 'Fallback',
    question: 'One line for when it goes sideways',
    scripts: [
      { say: 'Fallback', text: 'Rozumím. Zavolám zítra v 10:00 a posílám mezitím zprávu datovou schránkou, ať je to dohledatelné.' },
    ],
  },
  {
    label: 'Commit',
    question: 'Lock it in',
    body: 'Tomorrow 9:40, phone, 15 minutes planned. Saved as a task with an estimate. When you log the actual time, it feeds the same calibration loop as everything else.',
  },
]
