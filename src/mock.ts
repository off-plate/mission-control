import type {
  AgendaEvent,
  CoachScenario,
  Goal,
  HabitDef,
  LedgerEntry,
  Obligation,
  SocialEntry,
  SourceState,
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
    supportedSizes: ['S', 'M', 'L'], defaultSize: 'M', freshMinutes: 95, staleAfter: 60 * 26, page: 'today',
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

export const MOCK_OUTREACH = [
  { name: 'Cold emails', state: '0 of 10 sent', ok: false },
  { name: 'First LinkedIn post', state: 'drafted, not shipped', ok: false },
  { name: 'Father briefing', state: 'materials ready', ok: true },
]

let n = 0
const wid = (t: WidgetType) => `${t}-${++n}`

export const DEFAULT_SPACES: Record<SpaceId, WidgetInstance[]> = {
  personal: [
    { id: wid('tasks'), type: 'tasks', size: 'L' },
    { id: wid('agenda'), type: 'agenda', size: 'T' },
    { id: wid('finance'), type: 'finance', size: 'M' },
    { id: wid('habits'), type: 'habits', size: 'M' },
    { id: wid('goals'), type: 'goals', size: 'L' },
    { id: wid('mail'), type: 'mail', size: 'M' },
    { id: wid('training'), type: 'training', size: 'M' },
  ],
  work: [
    { id: wid('tasks'), type: 'tasks', size: 'XL' },
    { id: wid('agenda'), type: 'agenda', size: 'T' },
    { id: wid('mail'), type: 'mail', size: 'M' },
    { id: wid('claude'), type: 'claude', size: 'M' },
  ],
  offplate: [
    { id: wid('outreach'), type: 'outreach', size: 'M' },
    { id: wid('tasks'), type: 'tasks', size: 'L' },
    { id: wid('social'), type: 'social', size: 'M' },
    { id: wid('goals'), type: 'goals', size: 'T' },
    { id: wid('mail'), type: 'mail', size: 'S' },
  ],
}

export const SPACE_LABELS: Record<SpaceId, string> = {
  personal: 'Personal',
  work: 'Work',
  offplate: 'Off-Plate',
}

export const MOCK_TASKS: Task[] = [
  { id: 't1', title: 'Reply to the accountant about missing documents', source: 'ticktick', estimateMin: 15, done: false, space: 'personal', list: 'today', category: 'admin', slot: 'morning', at: '09:30' },
  { id: 't2', title: 'Book car service before the Italy trip', source: 'ticktick', estimateMin: 10, done: false, space: 'personal', list: 'today', category: 'quick', slot: 'noon' },
  { id: 't3', title: 'Check Datová schránka', source: 'mc', estimateMin: 5, done: false, space: 'personal', list: 'today', category: 'admin', slot: 'morning' },
  { id: 't4', title: 'Move washing machine repair card to Done', source: 'trello', estimateMin: 5, done: true, actualMin: 3, space: 'personal', list: 'today', category: 'quick', slot: 'morning' },
  { id: 't10', title: 'Sort the insurance letters into one folder', source: 'mc', estimateMin: 20, done: false, space: 'personal', list: 'backlog', category: 'admin',
    subtasks: [
      { id: 't10a', title: 'Open the pile and split by sender', estimateMin: 4, done: false },
      { id: 't10b', title: 'Scan each into the Insurance folder', estimateMin: 10, done: false },
      { id: 't10c', title: 'Write down any deadline you spot', estimateMin: 6, done: false },
    ] },
  { id: 't11', title: 'Cancel the streaming service you never open', source: 'ticktick', estimateMin: 10, done: false, space: 'personal', list: 'backlog', category: 'quick' },
  { id: 't12', title: 'Plan the August budget with the trip included', source: 'mc', estimateMin: 40, done: false, space: 'personal', list: 'backlog', category: 'deep',
    subtasks: [
      { id: 't12a', title: 'List every fixed cost for August', estimateMin: 10, done: false },
      { id: 't12b', title: 'Add the trip line, about 20 000 Kč', estimateMin: 8, done: false },
      { id: 't12c', title: 'Subtract from expected income', estimateMin: 7, done: false },
      { id: 't12d', title: 'Set the safe-to-spend number', estimateMin: 5, done: false },
    ] },
  { id: 't5', title: 'Prep talking points for Tuesday sync', source: 'ticktick', estimateMin: 25, done: false, space: 'work', list: 'today', category: 'deep', slot: 'morning' },
  { id: 't6', title: 'Review the two open pull requests', source: 'jira', estimateMin: 40, done: false, space: 'work', list: 'today', category: 'deep', slot: 'afternoon' },
  { id: 't7', title: 'Close DASH-214: onboarding empty state', source: 'jira', estimateMin: 30, done: false, space: 'work', list: 'backlog', category: 'deep' },
  { id: 't8', title: 'Send follow-up to Thursday’s workshop lead', source: 'ticktick', estimateMin: 15, done: false, space: 'offplate', list: 'today', category: 'call', slot: 'morning' },
  { id: 't9', title: 'Draft next LinkedIn post from the outline', source: 'trello', estimateMin: 30, done: false, space: 'offplate', list: 'backlog', category: 'deep',
    subtasks: [
      { id: 't9a', title: 'Pick one concrete story from this week', estimateMin: 5, done: false },
      { id: 't9b', title: 'Draft 8 to 10 lines, no editing', estimateMin: 15, done: false },
      { id: 't9c', title: 'Cut a third and add one number', estimateMin: 10, done: false },
    ] },
]

/* Mon..Sun. Habits carry a part-of-day so the page groups the way the day runs. */
export const MOCK_HABITS: HabitDef[] = [
  {
    id: 'h-morning', name: 'Morning routine', daypart: 'morning', paused: false,
    days: [true, true, true, false, true, false, false],
    history: [2, 3, 3, 4, 4, 3, 5, 4, 5, 5, 4, 5],
    steps: [
      { id: 'mr1', title: 'Meditation', kind: 'timer', seconds: 600, note: 'Sit, eyes closed, follow the breath. Ten minutes, no phone.' },
      { id: 'mr2', title: 'Pronunciation test', kind: 'do', note: 'Read a short passage out loud, record it, listen back once.' },
      { id: 'mr3', title: 'Jazykolam mouth stretch', kind: 'do', note: 'Loosen the jaw and lips, then a tongue-twister three times, fast and clean.', example: 'Strč prst skrz krk.' },
      { id: 'mr4', title: 'Typing test', kind: 'do', note: 'One quick round to wake the hands up.', link: 'https://monkeytype.com', linkLabel: 'Open typing test' },
    ],
  },
  { id: 'h2', name: 'Morning check-in', daypart: 'morning', days: [true, true, true, false, true, true, true], paused: false, history: [3, 4, 4, 5, 5, 4, 6, 5, 6, 6, 5, 6] },
  { id: 'h3', name: '20 min movement', daypart: 'afternoon', days: [false, true, false, true, true, false, false], paused: false, history: [0, 1, 2, 1, 3, 2, 3, 4, 3, 3, 4, 3] },
  { id: 'h4', name: 'No screens at dinner', daypart: 'evening', days: [false, false, true, true, false, false, false], paused: false, history: [0, 0, 1, 1, 2, 1, 2, 2, 3, 2, 2, 2] },
  { id: 'h1', name: 'In bed before 1:00', daypart: 'evening', days: [true, true, false, true, false, true, false], paused: false, history: [1, 2, 2, 3, 2, 4, 3, 3, 4, 5, 4, 4] },
]

export const MOCK_GOALS: Goal[] = [
  // personal
  { id: 'g-w1', space: 'personal', name: 'Send the tax transfer', current: 0, target: 1, unit: 'done', note: 'Hard deadline Fri 31 Jul', timeframe: 'weekly', category: 'money' },
  { id: 'g-w2', space: 'personal', name: 'One honest money talk with GF', current: 0, target: 1, unit: 'done', note: 'No softening', timeframe: 'weekly', category: 'life' },
  { id: 'g-m1', space: 'personal', name: 'No new overdue debt', current: 1, target: 1, unit: 'held', note: 'Nothing slipped this month', timeframe: 'monthly', category: 'money' },
  { id: 'g-m2', space: 'personal', name: 'Gym 12 sessions', current: 7, target: 12, unit: 'sessions', note: 'Proving Ground block', timeframe: 'monthly', category: 'health' },
  { id: 'g1', space: 'personal', name: 'Every obligation on a payment plan', current: 1, target: 3, unit: 'plans agreed', note: 'Bank plan waiting, tax not sent', timeframe: 'quarter', category: 'money' },
  { id: 'g3', space: 'personal', name: 'Weekly reset every Sunday', current: 9, target: 12, unit: 'weeks kept', note: 'The ritual is the structure', timeframe: 'quarter', category: 'life' },
  { id: 'g-h1', space: 'personal', name: 'Debt down by 60 000 Kč', current: 22000, target: 60000, unit: 'Kč paid', note: 'Steady on the plans', timeframe: 'half', category: 'money' },
  { id: 'g-h2', space: 'personal', name: 'Restart Off-Plate from stable ground', current: 1, target: 3, unit: 'milestones', note: 'Only once debt is on rails', timeframe: 'half', category: 'life' },
  // work
  { id: 'g4', space: 'work', name: 'Ship onboarding revamp', current: 11, target: 20, unit: 'tickets closed', note: 'On track for August', timeframe: 'quarter', category: 'work' },
  { id: 'g-w-w', space: 'work', name: 'Clear the review backlog', current: 2, target: 5, unit: 'PRs', note: 'this week', timeframe: 'weekly', category: 'work' },
  // offplate
  { id: 'g-o-w', space: 'offplate', name: 'Send 10 cold emails', current: 0, target: 10, unit: 'sent', note: 'this week', timeframe: 'weekly', category: 'offplate' },
  { id: 'g5', space: 'offplate', name: 'Discovery calls this quarter', current: 3, target: 10, unit: 'calls booked', note: 'Cold emails feed this', timeframe: 'quarter', category: 'offplate' },
  { id: 'g6', space: 'offplate', name: 'Publish weekly on LinkedIn', current: 7, target: 12, unit: 'weeks kept', note: 'Batch drafts on Sunday', timeframe: 'quarter', category: 'offplate' },
]

export const MOCK_LEDGER: LedgerEntry[] = [
  { id: 'l1', title: 'Weekly plan drafted with AI breakdown', category: 'deep', estimateMin: 45, actualMin: 20, when: 'Mon' },
  { id: 'l2', title: 'Insurance call, script prepared in Coach', category: 'call', estimateMin: 30, actualMin: 12, when: 'Tue' },
  { id: 'l3', title: 'Inbox sweep with priority labels', category: 'admin', estimateMin: 25, actualMin: 21, when: 'Wed' },
  { id: 'l4', title: 'Invoice batch in Fakturoid', category: 'admin', estimateMin: 20, actualMin: 24, when: 'Thu' },
  { id: 'l5', title: 'Trip packing list generated and checked', category: 'quick', estimateMin: 30, actualMin: 11, when: 'Fri' },
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

export const MOCK_MAIL: Record<SpaceId, { addr: string; unread: number; top: string; age: string }[]> = {
  personal: [
    { addr: 'Personal · Gmail', unread: 4, top: 'Energy provider: July statement is ready', age: '2 h' },
    { addr: 'Off-Plate · Gmail', unread: 2, top: 'Workshop inquiry from the contact form', age: '1 d' },
  ],
  work: [
    { addr: 'Work · company mail', unread: 7, top: 'RE: Q3 roadmap comments before Thursday', age: '35 m' },
  ],
  offplate: [
    { addr: 'Off-Plate · Gmail', unread: 2, top: 'Workshop inquiry from the contact form', age: '1 d' },
  ],
}

export const MOCK_SOCIAL: SocialEntry[] = [
  { platform: 'LinkedIn', followers: 1284, change: 37, lastPost: '2.1k impressions' },
  { platform: 'Instagram', followers: 862, change: 12, lastPost: '318 reach' },
  { platform: 'Facebook', followers: 445, change: -3, lastPost: '96 reach' },
]

export const MOCK_TRAINING = {
  last: '18 sets · push day, Thu · bench 4x6 at 72.5',
  next: 'Pull day, tomorrow 17:30',
  weeklySets: [14, 18, 16, 20, 17, 19, 21, 18],
}

export const MOCK_CLAUDE = {
  sessionsToday: 6,
  tokensWeek: [310, 420, 180, 510, 460, 220, 390],
  note: 'estimated from local session logs',
}

/* Money page. Every figure is invented and deliberately generic. */
/* One consistent invented model: every schedule row derives from an obligation,
   percentages match remaining/total, and dates respect their own deadlines. */
export const MOCK_MONEY = {
  debt: {
    original: '218 500 Kč',
    remaining: '162 900 Kč',
    paid: '55 600 Kč',
    pct: 25,
    monthly: '5 500 Kč',
  },
  savings: {
    thisMonth: '4 200 Kč',
    total: '38 400 Kč',
    months: [1800, 2400, 2100, 3600, 4200],
    monthLabels: ['Mar', 'Apr', 'May', 'Jun', 'Jul'],
    note: 'after debt and fixed costs',
  },
  cycleLabel: 'Pay cycle',
  spentPct: 46,
  budgetLine: 'After rent and fixed costs, spending is on pace for day 12 of 30',
  safeToSpend: '4 200 Kč',
  safeUntil: 'until payday, 18 days',
  safeMath: 'This cycle\u2019s installments (18 000 Kč) are already reserved',
  totalRemaining: '162 900 Kč',
  nextObligation: 'Friday installment: 2 400 Kč, not sent',
  obligations: [
    { id: 'o1', name: 'Health insurance payment plan', monthly: '2 400 Kč / month', remaining: '62 400 Kč remaining of 96 000', progressPct: 35, state: 'agreed', next: 'Installment due Friday 24 Jul' },
    { id: 'o2', name: 'Bank loan payment plan', monthly: '3 100 Kč / month', remaining: '88 000 Kč remaining of 110 000', progressPct: 20, state: 'waiting', next: 'Written confirmation pending' },
    { id: 'o3', name: 'Tax office settlement', monthly: '12 500 Kč, one payment', remaining: '12 500 Kč remaining of 12 500', progressPct: 0, state: 'action needed', next: 'Deadline Aug 1, pay by Fri 31 Jul' },
  ] as Obligation[],
  schedule: [
    { date: 'Fri 24 Jul', name: 'Insurance installment', amount: '2 400 Kč', state: 'not sent' },
    { date: 'Fri 31 Jul', name: 'Tax office transfer, last business day before the Aug 1 deadline', amount: '12 500 Kč', state: 'action needed' },
    { date: 'Mon 3 Aug', name: 'Bank loan installment, plan confirmation pending', amount: '3 100 Kč', state: 'pending' },
    { date: 'Mon 24 Aug', name: 'Insurance installment', amount: '2 400 Kč', state: 'scheduled' },
  ],
}

export const MOCK_SOURCES: SourceState[] = [
  { id: 's1', name: 'Google Calendar', kind: 'calendar', status: 'connected', detail: 'Two accounts, sync every 15 min' },
  { id: 's2', name: 'TickTick', kind: 'tasks', status: 'connected', detail: 'Tasks and habits, sync every 5 min' },
  { id: 's3', name: 'Trello', kind: 'tasks', status: 'connected', detail: 'Cards assigned to you' },
  { id: 's4', name: 'Jira', kind: 'tasks', status: 'off', detail: 'Work space only, via server proxy' },
  { id: 's5', name: 'Gmail personal', kind: 'mail', status: 'connected', detail: 'Unread counts and top subject' },
  { id: 's6', name: 'Gmail Off-Plate', kind: 'mail', status: 'connected', detail: 'Unread counts and top subject' },
  { id: 's7', name: 'Compass', kind: 'money', status: 'connected', detail: 'Server-side ledger read, daily' },
  { id: 's8', name: 'Hevy', kind: 'training', status: 'connected', detail: 'Workouts, hourly' },
  { id: 's9', name: 'Claude usage', kind: 'stats', status: 'connected', detail: 'Local session logs, pushed by your Mac' },
  { id: 's10', name: 'Audience numbers', kind: 'social', status: 'manual', detail: 'Entered in the weekly review' },
  { id: 's11', name: 'Datová schránka', kind: 'admin', status: 'manual', detail: 'Checked by you, Sunday rule' },
]

export const MOCK_STATS = {
  weeklySavedMin: [34, 51, 42, 66, 58],
  weeklyAccuracy: [25, 40, 35, 55, 40],
  calibration: [
    { category: 'call', label: 'Calls', factor: 1.6, note: 'Cold calls run long; rehearsed ones beat the estimate' },
    { category: 'admin', label: 'Admin', factor: 1.2, note: 'Paperwork mostly behaves' },
    { category: 'deep', label: 'Deep work', factor: 1.4, note: 'Interruptions stretch every long block' },
    { category: 'quick', label: 'Quick wins', factor: 0.9, note: 'Usually faster than feared' },
  ],
}

/* ---- fake decomposition, so the demo shows the interaction ---- */

export interface DecomposedStep { title: string; why?: string; estimateMin: number; category?: 'call' | 'admin' | 'deep' | 'quick' }

const LIBRARY: { match: RegExp; steps: DecomposedStep[] }[] = [
  {
    match: /week|týden|plan/i,
    steps: [
      { title: 'Empty every inbox into one list', why: 'mail, TickTick, Trello, notes', estimateMin: 8 },
      { title: 'Pick three outcomes for the week', why: 'results you can check off, like: plan sent', estimateMin: 6 },
      { title: 'Slot the three outcomes into real calendar blocks', estimateMin: 7, category: 'admin' },
      { title: 'Book the unpleasant call first', why: 'hardest thing gets the best slot', estimateMin: 4 },
      { title: 'Set Sunday reminder for the next reset', estimateMin: 2 },
    ],
  },
  {
    match: /plan|payment|splátk|bank|insur|poji|call|zavol|phone/i,
    steps: [
      { title: 'Find the contract number and the last letter', estimateMin: 5 },
      { title: 'Write one sentence: what you are asking them for', estimateMin: 3 },
      { title: 'Rehearse the opening line in Coach', estimateMin: 4 },
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
  const base = hit ? hit.steps : GENERIC
  const count = 3 + (goal.length % 3)
  return base.slice(0, Math.max(3, Math.min(base.length, count + 2)))
}

/* ---- coach scenarios, canned for the demo ---- */

export const COACH_SCENARIOS: CoachScenario[] = [
  {
    id: 'datova-schranka',
    title: 'Open the Datová schránka',
    tag: 'avoided admin',
    blurb: 'Open it with a rule: read, list the deadlines, nothing else tonight.',
    resultTask: { title: 'Open Datová schránka, list every deadline', estimateMin: 10, category: 'admin' },
    steps: [
      { label: 'Frame', question: 'What are you actually afraid is in there?', body: 'Eight days unopened. Usually the fear is one specific letter. The rule for tonight: you only read and list. No replies, no payments, no decisions.' },
      {
        label: 'Script', question: 'The rule, said out loud',
        scripts: [
          { say: 'The rule', text: 'Otevřu to, přečtu, vypíšu termíny. Nic víc. Rozhodovat budu zítra s čistou hlavou.' },
        ],
      },
      {
        label: 'Rehearse', question: 'There is a scary letter inside. Now what?',
        scripts: [{ say: 'You do', text: 'Zapíšu si termín a úřad. Zítra v 9:40 tomu dám 15 minut. Dnes už nic.' }],
      },
      { label: 'Fallback', question: 'If it spirals', scripts: [{ say: 'Fallback', text: 'Patnáct minut a dost. Cokoliv dalšího počká do zítřka, termíny mám zapsané.' }] },
      { label: 'Commit', question: 'Lock it in', body: 'Ten minutes, tonight or tomorrow 9:40. Saved as a task; the alert on Today clears when you check it off.' },
    ],
  },
  {
    id: 'call-institution',
    title: 'Chase a silent institution',
    tag: 'phone call',
    blurb: 'Script the call, rehearse their pushback, leave with a date in writing.',
    resultTask: { title: 'Call: confirm the payment plan, script ready', estimateMin: 15, category: 'call' },
    steps: [
      { label: 'Frame', question: 'What is the situation, and what do you want out of it?', body: 'Example loaded: you filed a payment plan request three weeks ago and nobody confirmed it. You want written confirmation, or a clear answer on what is missing.' },
      {
        label: 'Script', question: 'Your opening, in your own voice',
        scripts: [
          { say: 'Opening', text: 'Dobrý den, volám ohledně žádosti o splátkový kalendář, kterou jsem podal 11. dubna. Potřebuji potvrzení, že je schválený.' },
          { say: 'Key line', text: 'Chápu, že to má svůj proces. Potřebuji ale písemnou odpověď do konce týdne.' },
          { say: 'If asked why', text: 'Chci mít jistotu, že další platba proběhne podle dohody, ne podle odhadu.' },
        ],
      },
      {
        label: 'Rehearse', question: 'They say: "Nevidíme tu vaši žádost v systému."',
        scripts: [{ say: 'You answer', text: 'Mám podací číslo a datum. Nadiktuji vám je. Prosím ověřte, kam se požadavek dostal.' }],
      },
      { label: 'Fallback', question: 'One line for when it goes sideways', scripts: [{ say: 'Fallback', text: 'Rozumím. Zavolám zítra v 10:00 a posílám mezitím zprávu datovou schránkou, ať je to dohledatelné.' }] },
      { label: 'Commit', question: 'Lock it in', body: 'Tomorrow 9:40, phone, 15 minutes planned. Saved as a task with an estimate. Logging the actual time feeds the same calibration loop as everything else.' },
    ],
  },
  {
    id: 'money-talk',
    title: 'The honest money talk',
    tag: 'relationship',
    blurb: 'Open with the plan you already started, agree on a monthly check-in.',
    resultTask: { title: 'Money talk: pick the evening and open honestly', estimateMin: 45, category: 'deep' },
    steps: [
      { label: 'Frame', question: 'What do you want her to know, and what do you want to happen next?', body: 'Example loaded: she should know the full picture, the plan you already started, and that you want her to see the numbers monthly. A briefing with a plan attached.' },
      {
        label: 'Script', question: 'Open with the plan, not the apology',
        scripts: [
          { say: 'Opening', text: 'Chci ti ukázat, jak na tom jsem s penězi. Není to hezké, ale mám plán a už běží.' },
          { say: 'Key line', text: 'Dva splátkové kalendáře jsou dohodnuté, třetí řeším. Každý měsíc ti ukážu, kde jsme.' },
        ],
      },
      {
        label: 'Rehearse', question: 'She asks: "Proč jsi mi to neřekl dřív?"',
        scripts: [{ say: 'You answer', text: 'Styděl jsem se a čekal, až to bude vypadat líp. To byla chyba. Proto to říkám teď, dokud to hezké není.' }],
      },
      { label: 'Fallback', question: 'If it gets heated', scripts: [{ say: 'Fallback', text: 'Nechci od toho utéct. Dej mi deset minut a dokončíme to dnes.' }] },
      { label: 'Commit', question: 'Lock it in', body: 'Pick the evening this week, no screens, numbers printed. Saved as a task so it cannot quietly slip to next month.' },
    ],
  },
  {
    id: 'chase-supplier',
    title: 'Nudge someone who went quiet',
    tag: 'email',
    blurb: 'Two sentences, a list of what is missing, and a date.',
    resultTask: { title: 'Send the status-check email, two sentences', estimateMin: 10, category: 'admin' },
    steps: [
      { label: 'Frame', question: 'Who went quiet, and what exactly do you need from them?', body: 'Example loaded: a supplier or accountant has not replied in three weeks. You need a list of what they are missing and a date.' },
      {
        label: 'Script', question: 'Two sentences, no padding',
        scripts: [
          { say: 'Email', text: 'Dobrý den, vracím se k podkladům z 11. dubna. Pošlete mi prosím do pátku seznam toho, co vám chybí, a termín, kdy to uzavřeme.' },
        ],
      },
      { label: 'Rehearse', question: 'They reply with something vague', scripts: [{ say: 'You answer', text: 'Díky. Potřebuji konkrétní seznam a datum. Jinak si zavoláme v úterý v 9:00, dám vám pozvánku.' }] },
      { label: 'Fallback', question: 'If silence continues', scripts: [{ say: 'Fallback', text: 'Ve čtvrtek volám. Pokud se nedovolám, hledám někoho, kdo kapacitu má.' }] },
      { label: 'Commit', question: 'Lock it in', body: 'Send it today, 10 minutes. Follow-up reminder lands automatically in three days.' },
    ],
  },
  {
    id: 'say-no',
    title: 'Say no without burning the bridge',
    tag: 'boundary',
    blurb: 'Decline this week, offer a real alternative, keep the relationship.',
    resultTask: { title: 'Send the no, offer the alternative', estimateMin: 10, category: 'quick' },
    steps: [
      { label: 'Frame', question: 'What are you declining, and what can you honestly offer instead?', body: 'Example loaded: a request that would eat your evenings this week. You can offer a later date or a smaller scope, not the whole thing.' },
      {
        label: 'Script', question: 'The no, clean',
        scripts: [
          { say: 'Opening', text: 'Tenhle týden to nezvládnu, mám plné večery. Nechci to odflaknout.' },
          { say: 'Alternative', text: 'Můžu se na to podívat příští středu, nebo teď poslat aspoň rychlou verzi. Co z toho pomůže víc?' },
        ],
      },
      { label: 'Rehearse', question: 'They push: "Zabere to jen hodinu."', scripts: [{ say: 'You answer', text: 'Právě proto to nabízím na středu. Když to vezmu teď, bude to odbyté a stejně to budeme dělat znovu.' }] },
      { label: 'Fallback', question: 'If guilt kicks in', scripts: [{ say: 'Připomeň si', text: 'Každé „ano“ tenhle týden je „ne“ hovorům o splátkách. To je ta skutečná cena.' }] },
      { label: 'Commit', question: 'Lock it in', body: 'Send the message now, 10 minutes. Done is better than dreaded.' },
    ],
  },
]
