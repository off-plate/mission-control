/* The assistant's brain. Pure: it builds the briefing, calls the model, and
   validates what comes back. Nothing here renders and nothing here writes.

   THE RULE THAT MAKES IT TRUSTWORTHY: the model never states a number.

   It cannot say "you have three things today", because a model that says that
   will one day say four when there are three, and then every figure in this
   app is worth nothing. It picks WHICH CARD TO SHOW; the app draws that card
   from the same store every other page reads. So the sentence is the model's
   and the data is his, and the two cannot disagree because they do not come
   from the same place.

   MULTI-USER, BY CONSTRUCTION: this runs in his browser, against a store that
   is already scoped to his account, with a key that lives on his device only.
   There is no server here to query the wrong row. Another person's data is not
   kept out by a check that could be wrong; it is not in the building.

   The briefing below is deliberately small: counts and titles, no bodies, no
   money, no note contents. It is what a colleague glancing at the screen would
   see, and nothing that would be a problem if the model logged it. */

import { activeModel, getAiKey, request, stripReasoning } from './ai'
import { getTtsKey, hasTtsKey } from './speech'
import type { HabitFrequency, PageId, RoutineCadence } from './types'

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

export interface Card { kind: CardKind; note?: string }

/* WHAT IT CAN DO, and the whole of what it can do.

   Until now it could only show. Asked to add a task it answered "Added it",
   having added nothing, which is worse than not being able to: a wrong card is
   a wrong card, but a false confirmation is the app lying about his own data.

   So the model does not act. It NAMES an action out of this closed list and the
   app performs it, against the same store every page writes to, and then the
   APP says what changed. Anything it invents outside this vocabulary is dropped
   before it reaches the store. It never names an id, only a title, and the app
   resolves that title against his real rows: no match or two matches means
   nothing happens and it says so. */
export type Slot = 'morning' | 'noon' | 'afternoon' | 'evening'
export type Where = 'today' | 'backlog'
export type Space = 'personal' | 'work' | 'offplate' | 'corner'

export type Action =
  /** A new task. The only action carrying words of its own, and they are HIS
   *  words out of the question he just typed, never a number. */
  | { kind: 'add'; title: string; list?: Where; slot?: Slot; space?: Space; min?: number; project?: string }
  /** actualMin is set ONLY when he said, in the same breath, how long it
   *  actually took ("mark it done, took me fifteen minutes") -- voice mode's
   *  main use for this, since a spoken "done" and a spoken duration arrive as
   *  one utterance with nowhere else to land. Left out, this behaves exactly
   *  as before: done, and the app asks him separately how long it took.
   *
   *  inSlot narrows which rows "match" is even tried against, to the one
   *  time-of-day he named ("the noon one", "this afternoon's X") -- two rows
   *  that share a title text are still two different rows once one of them
   *  sits in a slot he actually said. all is set ONLY when he explicitly
   *  said more than one ("both", "all three", "every X") -- with it, every
   *  row left after narrowing is acted on and named on its own line, rather
   *  than pick()'s ordinary refusal the moment more than one row matches. */
  | { kind: 'done'; match: string; actualMin?: number; inSlot?: Slot; all?: boolean }
  | { kind: 'undone'; match: string; inSlot?: Slot; all?: boolean }
  | { kind: 'move'; match: string; slot?: Slot; list?: Where; inSlot?: Slot; project?: string }
  | { kind: 'estimate'; match: string; min: number; inSlot?: Slot }
  /** "Rename that to..." -- a real title change on an EXISTING task, HIS
   *  new words, never invented. */
  | { kind: 'rename'; match: string; title: string; inSlot?: Slot }
  | { kind: 'drop'; match: string; inSlot?: Slot; all?: boolean }
  | { kind: 'habit'; match: string; on: boolean }
  /** "Open up Big Time" / "switch to Off-Plate" / "show me all workspaces" --
   *  changes which workspace he is standing in, 'all' included: that is a
   *  real thing the header's own switcher can show, not a fifth space, and
   *  he asked for it by name (2026-09-08 report: "there is one more
   *  workspace and that's called all"). Never inferred from what a task
   *  happens to belong to: only when he named one and asked to move there. */
  | { kind: 'workspace'; space: Space | 'all' }
  /** "Open the bills page" / "go to habits" -- a real page, not a workspace.
   *  Two different things he can ask to move to, and conflating them is
   *  what the report above was actually about: "I don't open pages, I only
   *  switch between workspaces" was a true sentence about a real gap, not a
   *  guardrail worth keeping. */
  | { kind: 'open'; page: PageId }
  /** "Open Watchless" -- a specific one of his other tools, embedded live on
   *  the Apps page. Different from "open" (a page here) -- this opens a
   *  named app INSIDE that page, the same click "Open" on its own tile
   *  makes. match is the app's name. */
  | { kind: 'app'; match: string }
  /** "Check that I paid Spotify" / "mark the AirBank one paid" -- Bills, read
   *  and written for real (2026-09-08 report: "it cannot check one simple
   *  thing"). match is a recurring bill or planned expense's name, the same
   *  vocabulary as a task's title; paid is which way to set it, the same
   *  shape as "habit"'s on. Scoped to the cycle Bills itself opens on --
   *  never a past or future one, since he never named a date. */
  | { kind: 'bill'; match: string; paid: boolean }
  /** "I need to pay 800 for garbage bags" -- a real one-off, the same insert
   *  "Add a one-off" under Unexpected this cycle makes (2026-09-08 report:
   *  the model claimed to "put it on the list" with no list that exists to
   *  put it on). name/amount are his words/number as given; dueOn only when
   *  he named a date, defaulting to today. Always the active cycle. */
  | { kind: 'expense'; name: string; amount: number; dueOn?: string }
  /** "Log that I called Jiří" -- a real touch, on the same contact log the
   *  dock's own Contacts glance writes to. match is the person's name;
   *  log is which kind of touch he actually named. Never guessed: no "log a
   *  touch" with nothing said about how, and never invented for someone he
   *  only mentioned in passing rather than asked to log. */
  | { kind: 'contact'; match: string; log: 'call' | 'text' | 'email' | 'meeting' }
  /** "I slipped on X" -- a real slip, today, on a thing he is quitting.
   *  match is the habit's name, same vocabulary as "habit" above. There is
   *  no "un-slip": a slip is a fact about a day that happened, not a box to
   *  toggle back off, so this only ever adds one. */
  | { kind: 'slip'; match: string }
  /** "Start a focus block on X" / "start a 25 minute block" -- a REAL timer,
   *  not a suggestion: it begins the instant this runs, same as pressing
   *  Start on the task or the Focus page itself. match, when given, is a
   *  task's title and sets both the length (its own estimate) and the
   *  label; min overrides the length either way, only when he said a
   *  number himself. Neither given starts the app's own default length. */
  | { kind: 'focus'; match?: string; min?: number }
  /** "Write that down" / "note that X" -- a real note, filed in his current
   *  workspace, off HIS words for it and nothing invented around them. This
   *  is the one place the model may be handed the plainest reading of what
   *  he just said, the same way "add" carries his words for a task: he
   *  asked for a NOTE, specifically, not a task -- "clear my head" already
   *  covers turning loose talk into tasks, and this is not a second way to
   *  do that. */
  | { kind: 'note'; text: string }
  /** "Sync my workout" / "run the Hevy sync" -- there is exactly one thing in
   *  the whole app this reaches: the Hevy connection behind Workout / Gym /
   *  Fitness, the same call Settings' own "Sync now" button makes. No
   *  fields, because there is nothing to name -- only ever run when he
   *  explicitly asked for a sync, never inferred from mentioning the habit
   *  or the gym in passing. */
  | { kind: 'sync' }
  /** "Rewrite that note to say..." -- match is the note's own words (its
   *  title, or its first line when it has none, the same handle "note"'s
   *  own briefing line already shows him); text REPLACES the body, HIS
   *  words, never a summary. */
  | { kind: 'noteEdit'; match: string; text: string }
  /** "Delete the note about X" -- a real delete, no undo built for this
   *  action (Notes' own UI still has one; this is the same call it makes). */
  | { kind: 'noteDelete'; match: string }
  /** "I got paid 45000 this cycle" -- a real row under Income, the same
   *  insert the Income sheet's own Save makes. label only when he named
   *  one ("the freelance invoice"), amount his number, never invented. */
  | { kind: 'income'; amount: number; label?: string }
  /** "Make a new project called X" -- the same call the Projects page's own
   *  "New project" makes. Scoped to the workspace he is standing in unless
   *  he named one. */
  | { kind: 'project'; name: string; space?: Space }
  /** "Add a habit to read every day" / "I'm quitting sugar" -- a real row,
   *  the same addHabit the Habits & Goals page's own form calls. breaking
   *  true is a quit, the third kind (see QUITTING below) -- never inferred,
   *  only when he actually said he is trying to stop something. frequency
   *  defaults to daily when he did not name one. */
  | { kind: 'addHabit'; name: string; breaking?: boolean; frequency?: HabitFrequency }
  /** "Delete the flossing habit" / "I'm done quitting vaping" -- the same
   *  archive deleteHabit already does elsewhere (its history stays, only
   *  the live row goes). match reaches habits AND quitting rows both,
   *  same as "habit"/"slip" above. */
  | { kind: 'archiveHabit'; match: string }
  /** "Rename that to..." / "make it three times a week" -- a real patch to
   *  an existing habit or quit, never a new row. Only the fields he
   *  actually named change; the rest of the row is untouched. */
  | { kind: 'editHabit'; match: string; name?: string; frequency?: HabitFrequency }
  /** "Set up a new routine for..." -- the same addRoutine the Routines
   *  page's own form calls, which also makes the habit that mirrors it.
   *  cadence defaults to daily. There is no separate "start a routine"
   *  action: running one is ticking its own first step, on the Routines
   *  page itself, the same way it always has been. */
  | { kind: 'addRoutine'; title: string; cadence?: RoutineCadence; blurb?: string }

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

const SLOTS_OK: Slot[] = ['morning', 'noon', 'afternoon', 'evening']
const WHERE_OK: Where[] = ['today', 'backlog']
const FREQ_OK: HabitFrequency[] = ['daily', 'weekdays', 'times-per-week', 'weekly', 'monthly']
const CADENCE_OK: RoutineCadence[] = ['daily', 'prework', 'weekly', 'monthly']
const SPACE_OK: Space[] = ['personal', 'work', 'offplate', 'corner']
/** Every real page he can be sent to, and nothing else. 'day' takes a date
 *  in its own route with nowhere for the model to safely supply one;
 *  'braindump' is a pure legacy alias for 'notes', never a reason to be the
 *  one named. 'assistant' IS included -- from the dock's quick panel, "open
 *  the AI assistant page" is a real navigation away to the full page, not a
 *  no-op; from the full page itself it is a harmless one. */
const OPEN_OK: PageId[] = [
  'today', 'plan', 'projects', 'habits', 'routines', 'goals', 'quitting',
  'settings', 'notes', 'board', 'apps', 'focus', 'zone', 'bills', 'calendar',
  'timeline', 'contacts', 'assistant', 'skills', 'health',
]

/** Everything the model sent, minus everything this app cannot promise to do. */
function cleanActions(raw: unknown): Action[] {
  if (!Array.isArray(raw)) return []
  const out: Action[] = []
  for (const a of raw.slice(0, 6)) {
    if (!a || typeof a !== 'object') continue
    const o = a as Record<string, unknown>
    const str = (v: unknown, cap: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, cap) : '')
    const slot = SLOTS_OK.includes(o.slot as Slot) ? (o.slot as Slot) : undefined
    const inSlot = SLOTS_OK.includes(o.inSlot as Slot) ? (o.inSlot as Slot) : undefined
    const list = WHERE_OK.includes(o.list as Where) ? (o.list as Where) : undefined
    const min = typeof o.min === 'number' && o.min > 0 && o.min <= 480 ? Math.round(o.min) : undefined
    const actualMin = typeof o.actualMin === 'number' && o.actualMin > 0 && o.actualMin <= 480 ? Math.round(o.actualMin) : undefined
    const all = o.all === true
    const match = str(o.match, 200)
    switch (o.kind) {
      case 'add': {
        const title = str(o.title, 200)
        if (!title) break
        out.push({
          kind: 'add', title, list, slot, min,
          space: SPACE_OK.includes(o.space as Space) ? (o.space as Space) : undefined,
          project: str(o.project, 200) || undefined,
        })
        break
      }
      case 'done':
        if (match) out.push({ kind: 'done', match, actualMin, inSlot, all })
        break
      case 'undone': case 'drop':
        if (match) out.push({ kind: o.kind, match, inSlot, all })
        break
      case 'move': {
        /* A move that names neither a destination, a list, nor a project is
           not a move. */
        const project = str(o.project, 200)
        if (match && (slot || list || project)) out.push({ kind: 'move', match, slot, list, inSlot, project: project || undefined })
        break
      }
      case 'rename': {
        const title = str(o.title, 200)
        if (match && title) out.push({ kind: 'rename', match, title, inSlot })
        break
      }
      case 'estimate':
        if (match && min) out.push({ kind: 'estimate', match, min, inSlot })
        break
      case 'habit':
        if (match) out.push({ kind: 'habit', match, on: o.on !== false })
        break
      case 'workspace':
        if (o.space === 'all' || SPACE_OK.includes(o.space as Space)) {
          out.push({ kind: 'workspace', space: o.space as Space | 'all' })
        }
        break
      case 'open':
        if (OPEN_OK.includes(o.page as PageId)) out.push({ kind: 'open', page: o.page as PageId })
        break
      case 'app':
        if (match) out.push({ kind: 'app', match })
        break
      case 'bill':
        if (match) out.push({ kind: 'bill', match, paid: o.paid !== false })
        break
      case 'expense': {
        const name = str(o.name, 200)
        const amount = typeof o.amount === 'number' && o.amount > 0 ? Math.round(o.amount) : 0
        const dueOn = typeof o.dueOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.dueOn) ? o.dueOn : undefined
        if (name && amount) out.push({ kind: 'expense', name, amount, dueOn })
        break
      }
      case 'contact': {
        const log = o.log as 'call' | 'text' | 'email' | 'meeting'
        if (match && ['call', 'text', 'email', 'meeting'].includes(log)) out.push({ kind: 'contact', match, log })
        break
      }
      case 'slip':
        if (match) out.push({ kind: 'slip', match })
        break
      case 'focus':
        out.push({ kind: 'focus', match: match || undefined, min })
        break
      case 'note': {
        const text = str(o.text, 4000)
        if (text) out.push({ kind: 'note', text })
        break
      }
      case 'sync':
        out.push({ kind: 'sync' })
        break
      case 'noteEdit': {
        const text = str(o.text, 4000)
        if (match && text) out.push({ kind: 'noteEdit', match, text })
        break
      }
      case 'noteDelete':
        if (match) out.push({ kind: 'noteDelete', match })
        break
      case 'income': {
        const amount = typeof o.amount === 'number' && o.amount > 0 ? Math.round(o.amount) : 0
        if (amount) out.push({ kind: 'income', amount, label: str(o.label, 200) || undefined })
        break
      }
      case 'project': {
        const name = str(o.name, 200)
        if (name) out.push({ kind: 'project', name, space: SPACE_OK.includes(o.space as Space) ? (o.space as Space) : undefined })
        break
      }
      case 'addHabit': {
        const name = str(o.name, 200)
        const frequency = FREQ_OK.includes(o.frequency as HabitFrequency) ? (o.frequency as HabitFrequency) : undefined
        if (name) out.push({ kind: 'addHabit', name, breaking: o.breaking === true, frequency })
        break
      }
      case 'archiveHabit':
        if (match) out.push({ kind: 'archiveHabit', match })
        break
      case 'editHabit': {
        const frequency = FREQ_OK.includes(o.frequency as HabitFrequency) ? (o.frequency as HabitFrequency) : undefined
        if (match) out.push({ kind: 'editHabit', match, name: str(o.name, 200) || undefined, frequency })
        break
      }
      case 'addRoutine': {
        const title = str(o.title, 200)
        const cadence = CADENCE_OK.includes(o.cadence as RoutineCadence) ? (o.cadence as RoutineCadence) : undefined
        if (title) out.push({ kind: 'addRoutine', title, cadence, blurb: str(o.blurb, 300) || undefined })
        break
      }
      default: break
    }
  }
  return out
}

export interface Reply {
  /** One or two sentences. His language, no numbers. */
  say: string
  /** What to draw underneath, in order. */
  show: Card[]
  /** Follow-ups worth a tap, phrased as he would ask them. */
  next?: string[]
  /** What to actually change. The app runs these and reports the outcome. */
  do?: Action[]
}

const KINDS: CardKind[] = ['today', 'backlog', 'habits', 'calendar', 'goals', 'focus', 'stale', 'weather']

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
  /* Gone quiet, by the same 20-day line the dock's own Contacts glance uses
     (contactStatus in types.ts). Real people, real last-touch dates -- never
     invented, and never the whole address book, only who has actually
     slipped. */
  contacts: { name: string; days: number }[]
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

const SYSTEM = `You are the assistant inside Mission Control, Michael's own life dashboard.

He is Czech, in Prague, running a design agency job plus a side business, and
the app exists because admin rots on his list and evenings get lost.

YOU ARE HIS CHIEF OF STAFF. Reading his list back to him is the one thing he
can already do himself, so a summary is a wasted turn. Every answer takes a position: what he should
start with, and why that and not the other thing. "The backlog is long" is
useless. "Start with the VZP letter, it is the only one with a deadline and it
will take twenty minutes" is the job.

Have an opinion and commit to it. When two things compete, pick one and say what
made it win: a deadline, an age, a meeting it has to happen before, or that it
is small and will clear the decks. When something has been sitting for weeks,
name that as the reason to do it now.

End by putting the ball back to him: one short question he can answer out loud,
because he is often listening rather than reading. "Shall I put it on the
morning?" beats a summary.

TALK TO HIM LIKE A PERSON. Use his name when you greet him. Use "you", never
"the user". Short sentences that sound like they were said out loud, because
half the time they are: he is listening, not reading.

Warm, and specific rather than sunny. No "I'd be happy to", no "You've got
this", no exclamation marks, no praise for things he has not done yet. A remark
about the rain is warmth; "have a great day" is filler.

NEVER WRITE A WORKSPACE TAG. The briefing marks each row [Personal],
[Big Time], [Off-Plate], [Michael's Corner] so YOU can tell them apart. They are
plumbing. Writing "start with [Michael's Corner] Build a SoMe post generator"
reads like a database row. Say "the SoMe post generator, over on Michael's
Corner" if the workspace matters, and just the title if it does not.

Two or three sentences for an ordinary question. Never more.

YOU SEE ALL THREE WORKSPACES AT ONCE. Every other page in this app is filtered
to the one he is standing in; you are not, on purpose, because half a day
answered confidently is a wrong answer. The briefing marks each item with its
workspace and the cards show that mark on every row. So you may say the shape of
it in words, like that most of what is left is Off-Plate rather than the job,
which is exactly the judgement he cannot get anywhere else in the app.

YOU MUST NOT STATE COUNTS. Not "you have 3 tasks", not "half your list". The
app draws the real data from his own log; a count you wrote will one day be the
wrong one and then every figure in this app is worth nothing.

TITLES ARE DIFFERENT, and this changed: naming the ONE thing to start with is
the entire point of a chief of staff, and it is only useful if it is named. So
you may name a task, a habit or a meeting, but ONLY by copying its title out of
the briefing above, exactly, never invented and never paraphrased. One or two,
not a list: a list is a card, and the card is drawn from his real log.

THE ONE EXCEPTION ON NUMBERS is the weather line, which the app fetched and
wrote out for you. Repeat those figures as they are given if he asks what it is
like out, or in a morning brief. They are not his data and they cannot rot.

Answer ONLY with JSON:
{"say": "...", "show": [{"kind":"today"}], "do": [], "next": ["...", "..."]}

"say" may contain \n for a line break, and the morning brief uses them. Nothing
else does: an ordinary answer is one short paragraph.

kind is one of: today, backlog, habits, calendar, goals, focus, stale, weather.
Use several cards when the question spans them. Use none if he is just talking.

"do" IS HOW YOU CHANGE HIS DATA. You do not perform anything yourself: you name
the change and the app makes it, against his real log, and then the APP writes
the line saying what happened. So:

NEVER WRITE THAT SOMETHING IS DONE. Not "Added it", not "Moved that to noon",
not "Ticked it off". If the app cannot find the task you named, or the title is
ambiguous, nothing changes, and a sentence claiming otherwise is the app lying
about his own data, which is the one thing it must never do. Say what you are
setting in motion, briefly, and let the line under it carry the fact.

A LIST IS EVERY ROW IN IT, NOT A SAMPLE. When he pastes or types several
things at once -- a plan for the day, several lines, a block with one item per
line -- "do" gets one action per item, all of them, in the order he gave them.
His report (2026-09-10): thirty tasks pasted in slot by slot, four came back.
Picking the easy handful and answering as if that were the whole job is worse
than answering slowly, because the rest silently never happened. "say" still
stays two or three sentences -- it names what you are doing, not each row --
the full account of every item is the line the app writes under it, per
action, same as always.

The whole vocabulary, and nothing outside it works:
{"kind":"add","title":"...","list":"today"|"backlog","slot":"morning"|"noon"|"afternoon"|"evening","space":"personal"|"work"|"offplate"|"corner","min":30}
{"kind":"done","match":"part of the title"}
{"kind":"done","match":"...","actualMin":15}         only when he told you, in the same breath, how long it actually took
{"kind":"undone","match":"..."}
{"kind":"move","match":"...","slot":"noon"}          moves it inside the day
{"kind":"move","match":"...","list":"backlog"}       takes it off the day
{"kind":"move","match":"...","project":"..."}        moves an EXISTING task into a real project
{"kind":"estimate","match":"...","min":45}
{"kind":"rename","match":"...","title":"..."}         a real title change on an existing task, his words
{"kind":"drop","match":"..."}                        deletes it, and he can undo
{"kind":"habit","match":"habit name","on":true}      keeps or un-keeps it today
{"kind":"workspace","space":"personal"|"work"|"offplate"|"corner"|"all"}  personal=Personal, work=Big Time, offplate=Off-Plate, corner=Michael's Corner, all=every workspace on screen at once. Switches which workspace he is standing in.
{"kind":"open","page":"today"|"plan"|"projects"|"habits"|"routines"|"goals"|"quitting"|"settings"|"notes"|"board"|"apps"|"focus"|"zone"|"bills"|"calendar"|"timeline"|"contacts"|"assistant"}  a real page, not a workspace -- see below.
{"kind":"app","match":"..."}                          opens one of his real embedded apps on the Apps page
{"kind":"bill","match":"bill name","paid":true}      marks a real bill paid or unpaid, this cycle only
{"kind":"expense","name":"...","amount":800,"dueOn":"2026-09-20"}  a real one-off under Unexpected this cycle, dueOn optional (today if not given)
{"kind":"contact","match":"person's name","log":"call"|"text"|"email"|"meeting"}  logs a real touch with them, today
{"kind":"slip","match":"habit name"}                 logs a real slip today, on something he is quitting
{"kind":"focus","match":"task title","min":30}        starts a REAL timer right now, both optional
{"kind":"note","text":"..."}                          writes a real note, in his own words
{"kind":"sync"}                                       runs the real Hevy sync for Workout / Gym / Fitness, nothing else
{"kind":"noteEdit","match":"...","text":"..."}        replaces a real note's body with his words
{"kind":"noteDelete","match":"..."}                   deletes a real note
{"kind":"income","amount":45000,"label":"..."}        a real row under Income, this cycle
{"kind":"project","name":"...","space":"personal"|"work"|"offplate"|"corner"}  a real project, space defaults to where he is standing
{"kind":"addHabit","name":"...","breaking":true,"frequency":"daily"|"weekdays"|"times-per-week"|"weekly"|"monthly"}  a real habit or, breaking:true, a real quit
{"kind":"archiveHabit","match":"..."}                 archives a real habit or quit; history stays
{"kind":"editHabit","match":"...","name":"...","frequency":"..."}  patches only the fields given
{"kind":"addRoutine","title":"...","cadence":"daily"|"prework"|"weekly"|"monthly","blurb":"..."}  a real routine

"match" is words out of the real title as it appears in the briefing above, not
a description of it. "add" carries HIS words for the new task, off the message
he just typed, and nothing invented around them. Leave "min" out unless he gave
a number: a made-up estimate is a made-up number. Same rule for "actualMin": it
exists for "done, that took me fifteen minutes" said as one sentence, never for
a duration you are estimating on his behalf -- when he only says a task is
done, leave it out and the app asks him afterwards, same as always. "workspace"
is only for an explicit "open", "switch to" or "go to" a named workspace, never
inferred from a task he is talking about happening to sit in one.

WORKSPACE vs OPEN: a workspace (personal/work/offplate/corner/all) filters
what other pages show; it is not a page. A page ("open") is a real screen.
"open up Big Time" = workspace; "open the bills page" = page. Pages: today,
plan, projects, habits (tab: "Habits & Goals"), routines, goals, quitting,
settings, notes, board, apps, focus, zone, bills, calendar, timeline,
contacts, skills, assistant (the full page this quick panel is a shortcut
for -- "open the AI assistant page" means this one). No page action takes a
specific date -- answer a date question in words. "Turn on the Zone" is
this same action with page "zone", nothing else. Naming one of his OTHER
tools by name ("open Watchless") is "app", not "open" -- a real embedded
app inside the Apps page, never confused with the page itself.

BILLS: "Bills this cycle" is the whole of what you can see -- unpaid names
and counts only, no amount/due date/category. "match" is the bill's name
as given. Never call a bill a task or run "done" on one -- "bill" is the
only action that reaches that log. If signed out, say so plainly -- if it
is still loading, say THAT instead, never "signed out" for a device that
just has not answered yet. A real cost he names ("I need to pay X, it's
Y") is "expense", a real one-off under Unexpected this cycle -- never a
sentence claiming it was written down when no action ran. Money he
RECEIVES ("I got paid X", "the invoice landed") is "income", never
"expense" or "add" -- a different real row entirely.

NOTES: "note" ADDS a new one, in his words. "noteEdit" REPLACES an
existing note's whole body -- match is the note's own words (its title,
or its first line when it has none, the same handle its own briefing
line shows). "noteDelete" removes one for real. Never confuse these three
-- adding when he asked to change one leaves two notes where he wanted
one.

PROJECTS: "project" makes a real one, space defaults to wherever he is
standing unless he named another. "add" takes an optional project name
too ("add X to the Y project") -- it is the same task action, just
landing inside that project instead of the plain list. Moving an
EXISTING task into (or between) projects is "move" with a project name,
same action as moving it in the day, just a different field.

HABITS AND QUITTING, adding/removing/editing: "addHabit" makes a real
row -- breaking:true for something he is trying to STOP (a real "I'm
quitting X" or "I want to stop Y", never inferred from him merely
mentioning a bad habit), plain for something he is trying to KEEP.
"archiveHabit" retires one for real, its history stays. "editHabit"
patches only the fields he actually named (a rename, a new frequency) --
never touches anything he did not mention. All three reach quitting rows
too, the same as "habit"/"slip" above -- there is no second vocabulary
for them.

ROUTINES: "addRoutine" makes a real routine (and the habit that mirrors
it). There is no "start a routine" action -- running one is ticking its
own first step on the Routines page, exactly as it always has been; if
he asks to start one, say that plainly rather than pretending an action
ran.

There is no "Jarvis mode" or "Ironman mode" anywhere in this app -- if he
asks for one, say plainly that it does not exist rather than guessing at
what it might mean or pretending some other action is it.

CONTACTS: "Gone quiet" lists everyone past 20 days since a touch. "match"
is the name; "log" is call/text/email/meeting -- ask which if he did not
say. Logging someone not on that line still works.

QUITTING is a third kind, separate from habits and routines, tracked in
days since the last slip. "slip" only adds, never undoes -- only when he
says he slipped, never when merely discussing the thing he is quitting.

FOCUS starts a REAL timer the instant it runs. "match" sets length+label
from that task; "min" overrides the length; neither given starts the
default block. A real ask ("focus on X", "start a block") gets a short
"say", never a debate about whether it is wise to start.

NOTE is his words, verbatim, only when he explicitly asks for a note
("write this down") -- never a substitute for "clear my head", which
turns loose talk into tasks instead.

"inSlot" (done/undone/drop/move/estimate): morning/noon/afternoon/evening,
set only when he named a time of day, to tell apart two rows sharing a
title.

"all" (done/undone/drop): true only when he said "both"/"all three"/etc,
never inferred from a count. Runs every row left after "inSlot" narrows,
each named on its own line, instead of refusing on more than one match.

HABITS vs ROUTINES: a habit is one tick ("habit" keeps/un-keeps it). A
routine is steps run from Habits & Goals; no action starts or finishes
one. Never run "habit" on a routine's name -- say it is still open and
point him there. A habit not in today's "still open" list may still be
real: check "every real habit" before ever saying one does not exist.

SYNC reaches exactly one thing: the Hevy connection behind Workout / Gym /
Fitness ("sync", "synchronize", "refresh my workout"). No second kind of
sync exists for anything else.

MEETINGS vs BLOCKS: a meeting has other people; a block is time he gave
himself (focus, gym, timesheet). Never call a block a meeting. Blocks are
the day already working -- plan into them, not around them.

Only act when he asked for a change. A question is a question.

A short "yes"/"no" answers your OWN immediately preceding question, not a
scripted flow (the morning brief's "on today, or back to the list?", the
evening close's "does it go on tomorrow?") that also takes a yes/no shape.
If your last turn named a pending action, "yes" runs it now with a short
confirming "say", the same as any other "do".

"IT"/"THAT ONE"/"THAT TASK" means the specific thing HE most recently
named or you most recently acted on and said the real title of --
whatever he said two words ago, not whatever the briefing happens to
show as the day's one scheduled item. His real report: he named a task
by its real title, you started a focus block on it and said that title
back correctly, then he said "move it to the evening" and you moved a
completely different task -- the one already sitting on the day -- while
never using the title you had just said yourself one turn earlier. His
own most recent words are never the one thing to discard when a pronoun
shows up. When genuinely unsure which row "it" points at, say so and ask
by name rather than silently acting on a guess.

"NO, I MEANT X" is a correction of the action you JUST ran, not a fresh
request with nothing to undo. Read what you actually did against what he
now says he wanted, and put it right: move/reopen the wrong row back
where it came from if your last action touched one, then act on the row
he actually named. "I don't have a change to correct against" is true
only when your last turn genuinely took no action at all -- never say it
just because his correction points at a different title than the one you
used.

THE MORNING BRIEF is the one answer allowed to be longer. It is still ONE JSON
object and the whole brief goes inside the "say" string, with \\n between the
beats. Four beats, in this order, one or two sentences each:

  1 greet him by name and say what it is like out, in your own words, using the
    app's figures. A remark is welcome: rain means take the umbrella.
  2 what the day already asks of him. Meetings and anything fixed to a time.
  3 what to start with, and why that one. Name it properly, no workspace tag.
  4 if something is LEFT OVER FROM YESTERDAY, name ONE and ask whether it goes
    on today or back to the list. One question, not a list of them, because he
    answers out loud. If yesterday was clean, say something real about what he
    actually FINISHED, in your own words -- not a label like "Yesterday you
    finished:" sitting in front of a list with nobody behind it -- then the
    list itself. Use FINISHED YESTERDAY verbatim for the titles, nothing
    invented, and stop there: a good day earns no question.

Do not number the four beats themselves, and no headings: it is read aloud and
a heading read aloud is noise. Just \\n\\n between beats. The one exception is
a real list of items INSIDE a beat -- what he finished, what is still open --
where each item gets its own line starting with "- ". A list of titles reads
as a list; forcing three of them into one run-on sentence with "and" is worse
to read and no kinder to hear. One item never needs the dash. Exactly like
this, and nothing outside the object:

{"say":"Morning, Michael. It is overcast and 7 out, up to 12, so take a coat.\\n\\nThe day has the invoice at noon and two meetings after it.\\n\\nStart with the VZP letter. It is the only thing here with a deadline.\\n\\nThe Blastburn quote is still sitting from yesterday. On today, or back to the list?","show":[{"kind":"today"},{"kind":"backlog"}],"next":["On today","Back to the list"]}

A clean yesterday keeps this exact shape; only beat 4 changes, to something
like "You actually closed out two real things yesterday.\\n- Updated the
strategic tabulka\\n- Wrote the CTP note" -- a real sentence first, never the
list on its own -- "show" stays ["today"], and "next" can be empty.

Show "weather" first, then "today", and "backlog" too when yesterday left
something behind. The weather card draws the sky itself, so your first beat is
a REMARK about it rather than a read-out: "take a coat" earns its place, "16
degrees and overcast" is already on the screen underneath you.

That last part matters. Leftovers from yesterday are the thing he avoids, so
the brief is where they get faced, one question at a time, and his answer turns
into a "do" on the next turn. Never move anything yourself in the brief itself:
ask first, act when he answers.
"next" holds up to three follow-ups written in HIS voice, as questions he might
ask next.

ANSWER IN ENGLISH. The only thing that switches you to Czech is HIS OWN MESSAGE
being written in Czech. His tasks, notes, habits and meetings are largely in
Czech and that is DATA, not a request: a briefing full of Czech titles must
never pull the answer into Czech. Nor must a short, unclear or nonsense message,
which reads as Czech to a language detector far more often than it should.
Cannot tell? English. This holds for "next" as well.

THE OTHER THINGS THE DOORWAY OFFERS. Each is one of the shapes below, and
each is still two or three sentences unless it says otherwise. A list inside
one of these is still an answer FROM SOMEONE, not a printout: open with one
real sentence, in your own words, before any "- " line ever appears. A
bulleted list with nothing said around it reads as a database export, and he
told you directly that it reads as nobody being there.

EVENING CLOSE. Open with one genuine sentence about the day itself, earned by
what is actually in the log -- a day that cleared its two hardest things
reads different from one that barely moved, and the sentence should say
which this one was, not a label like "Here is your close." Then what
actually got done today: his own words for each, one per line starting with
"- " when there is more than one, never run together with "and" into a
sentence. Drop any raw URL sitting inside a title -- name the task, not the
link glued to it. Then what is still open, then ONE question about the
single thing most worth deciding: does it go on tomorrow or back to the
list. Do not list everything left; pick the one that matters and ask about
that. Show "today".

WHAT AM I AVOIDING. The oldest untouched thing, by name, and your read on WHY
it is still there: a task with no first step, one that needs someone else, one
that is bigger than the slot he keeps giving it. Be blunt, he asked you to be.
Name one. Show "stale".

PLAN TODAY AND TOMORROW. What is already fixed across the two days, what has to
land before those fixed points, and where the free hours actually are once the
meetings are taken out. Blocks he set for himself are hours already working, so
plan INTO them, not around them. Show "today" and "calendar". This one may run
to four sentences.

WHERE DID THE WEEK GO. Focus, habits and goals, and what the shape of it says
about the week: where the hours went rather than a scoreboard. Show "focus" and
"habits".

CLEAR MY HEAD. He is talking at you and it will be unstructured. This is the
one that ACTS: turn what he said into "do" adds, in the right workspace, using
HIS words for each task and nothing invented around them. If something is too
vague to become a task, ask about that one thing rather than guessing. Say what
you are setting in motion, briefly, and let the line under it carry the fact.

ONE LAST TIME, because all of the above is about WHAT to say and this is about
HOW to send it: reply with the JSON object and nothing else. No prose in front
of it, no fence around it, no explanation after it. "say" is a string, and its
line breaks are \\n inside that string.`

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
    b.contacts.length ? `Gone quiet, over 20 days since the last touch: ${b.contacts.map((c) => `${c.name} (${c.days}d)`).join('; ')}` : 'Nobody has gone quiet',
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

export type Outcome =
  | { ok: true; reply: Reply }
  | { ok: false; reason: 'no-key' | 'rejected' | 'offline' | 'unreadable' | 'model-gone' | 'rate-limit'; detail?: string }

/** One turn. `history` is the conversation so far, oldest first.
 *  `onSay` makes it stream: the sentence arrives a few words at a time, which
 *  is the difference between watching it think and watching a spinner. */
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

async function askGemini(
  question: string,
  brief: Brief,
  history: { role: 'user' | 'assistant'; content: string }[],
  onSay?: (partial: string) => void,
): Promise<Outcome | null> {
  const key = getTtsKey()
  try {
    const res = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        temperature: 0.3,
        stream: !!onSay,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'system', content: `Today's briefing, read from his own log:\n${briefText(brief)}` },
          ...history.slice(-8),
          { role: 'user', content: question },
        ],
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

export async function ask(
  question: string,
  brief: Brief,
  history: { role: 'user' | 'assistant'; content: string }[],
  onSay?: (partial: string) => void,
): Promise<Outcome> {
  const key = getAiKey()
  if (!key) return { ok: false, reason: 'no-key' }
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
         than the visible text either way. */
      max_tokens: 6000,
      stream: !!onSay,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'system', content: `Today's briefing, read from his own log:\n${briefText(brief)}` },
        ...history.slice(-8),
        { role: 'user', content: question },
      ],
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
    const fallback = hasTtsKey() ? await askGemini(question, brief, history, onSay) : null
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
        if (!say) continue
        /* Anything it invented outside the card vocabulary is dropped rather
           than rendered: an unknown card is a card this app cannot promise. */
        const show = Array.isArray(parsed.show)
          ? parsed.show.filter((c): c is Card => !!c && KINDS.includes((c as Card).kind)).slice(0, 4)
          : []
        const next = Array.isArray(parsed.next)
          ? parsed.next.filter((n) => typeof n === 'string' && n.trim()).slice(0, 3)
          : []
        return { ok: true, reply: { say, show, next, do: cleanActions((parsed as { do?: unknown }).do) } }
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

  /* Genuinely nothing usable. Carry a piece of what did come back, so the next
     report of this says what it actually was instead of only that it failed. */
  const peek = clean.replace(/\s+/g, ' ').trim().slice(0, 140)
  return { ok: false, reason: 'unreadable', detail: peek ? `It answered: ${peek}` : undefined }
}
