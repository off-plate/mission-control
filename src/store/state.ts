/* The shape of the store: what is saved (PersistedState), what the app can
   read and do (Store), and the two localStorage keys. Types only, plus the
   keys. Moved out of store.tsx unchanged (2026-11-12). */
import type { LastWrite, Tomb } from '../sync-merge'
import type { Undoable } from './undo'
import type { IdeaBoardSlice } from './ideaboard'
import type { RemindersSlice } from './reminders'
import type { PromptsSlice } from './prompts'
import type { PeopleSlice } from './people'
import type { ProspectsSlice } from './prospects'
import type { InvoicesSlice } from './invoices'
import type { GymSlice } from './gym'
import type {
  ViewId, FocusSession, HabitSlip, HabitTick, RoutineDone, StepEntry, StepTick, RoutineCadence,
  AssistantEntry, CoachSession, DayTaskLog, Goal, Idea, IdeaCard, Reminder, ReminderList, PromptItem,
  Person, PersonBond, PersonContact, Prospect, GymGoal, Invoice, InvoiceClient, InvoiceProfile,
  Note, NoteFolder, Routine, HabitDef, LedgerEntry, PageId, PlanState, Project, ReviewState, SpaceId, Task,
} from '../types'

export const STORAGE_KEY = 'mission-control-demo-v12'
/** The untouched copy of whatever was saved before this build migrated it. */
export const BACKUP_KEY = 'mission-control-backup-v3'

export interface PersistedState {
  version: 3
  tasks: Task[]
  habits: HabitDef[]
  goals: Goal[]
  /** Rooms inside a Space. Optional so an old saved blob without any still
   *  reads as an empty list rather than failing to parse. */
  projects?: Project[]
  /** People. Optional for the same reason projects is. */
  ledger: LedgerEntry[]
  plan: PlanState
  review: ReviewState
  assistantLog: AssistantEntry[]
  coachSessions: CoachSession[]
  routines: Routine[]
  ideas: Idea[]
  /** Notes, and the folders he made for them. Workspace folders are derived,
   *  not stored, so `noteFolders` only ever holds his own. */
  notes?: Note[]
  noteFolders?: NoteFolder[]
  /** ISO week the habit checkmarks belong to; a new week archives and clears them. */
  weekKey?: string
  /** One-time data repairs already applied to this saved state. */
  fixes?: number
  /** Personal bests, keyed by `routineId:stepId`. Survives every rollover. */
  records?: Record<string, number>
  savedAt?: number
  /** Which device saved this copy. Read by the OTHER devices. */
  lastWrite?: LastWrite
  /** Which storage schema wrote this. A row from an older one is not reused. */
  schema?: string
  /** Seeded habits and routines he deleted on purpose; never re-seeded. */
  removedSeeds?: string[]
  /** Every finished focus block, so a measured habit has something to count. */
  focusSessions?: FocusSession[]
  /** Every day a habit was kept, dated. The durable record behind days[]. */
  habitLog?: HabitTick[]
  /** Every day a routine was finished, dated. */
  routineLog?: RoutineDone[]
  /** Every day he slipped on a habit he is quitting, dated. */
  slips?: HabitSlip[]
  /** Every number a routine step recorded, dated. `records` keeps only the best. */
  stepLog?: StepEntry[]
  /** How each day's plan actually went: planned vs. done, stamped at
   *  rollover before the leftovers lose their day. Written going forward
   *  only; nothing before this existed can be backfilled. */
  dayLog?: DayTaskLog[]
  /** Every step ticked, dated. The routine's own doneStepIds is wiped at
   *  rollover, so this is the only thing that can say a routine was HALF done
   *  on a day that is no longer today. */
  stepTicks?: StepTick[]
  /** The last day the rollover ran. Everything after it is unsealed. */
  lastRollDay?: string
  /** The last day the daily review was walked, and the last day it was waved
   *  off. Two fields rather than one, so "not today" is remembered as a choice
   *  and does not read on the next open as though he had done it. */
  dailyDone?: string
  dailySkipped?: string
  /** How many rows had no space and were filed as Personal on migration. */
  spaceGuessed?: number
  /** Keys of rows deliberately deleted, so a merge cannot resurrect them. */
  graveyard?: Tomb[]
  /** THE TWO LIVES FOOTAGE. One link per pane per stop, keyed `<stop>-drift`
   *  or `<stop>-push`. It lives in the synced blob rather than on the device
   *  because the screen he opens when he wants to quit has to be the same
   *  screen on the phone at midnight as on the laptop at noon. */
  twoLives?: Record<string, string>
  /** THE REEL LIBRARY he pasted in. Hundreds of links, merged with the curated
   *  list in `reels.ts` at read time. In the synced blob because a library he
   *  built on the laptop has to be there on the phone at midnight. */
  reels?: string[]
  /** His own focus-music links for the Zone's player. */
  tunes?: string[]
  /** Instagram link -> the file reel-fetch downloaded for it, once. Synced so
   *  the download that already happened on one device is a lookup on every
   *  other, not a second fetch. */
  reelFiles?: Record<string, string>
  /** The Ideas board: every sticky and where he left it. */
  ideaBoard?: IdeaCard[]
  reminders?: Reminder[]
  reminderLists?: ReminderList[]
  /** Prompts waiting for the Claude usage window. */
  prompts?: PromptItem[]
  /** The People page: who, who knows whom, and every logged contact. */
  people?: Person[]
  personBonds?: PersonBond[]
  personContacts?: PersonContact[]
  /** People's Business view: every business he is reaching out to. */
  prospects?: Prospect[]
  /** The Health page's own permanent PR targets -- see types/gym.ts for why
   *  these are separate from the main Goals page's periodic ones. */
  gymGoals?: GymGoal[]
  /** Invoices, the contacts he bills, and his own supplier row. */
  invoices?: Invoice[]
  invoiceClients?: InvoiceClient[]
  invoiceProfile?: InvoiceProfile[]
  /** The Pomodoro block running right now, synced so it shows the same on
   *  every device rather than living only in this tab's
   *  localStorage. Null means nothing is running. */
  activeFocus?: ActiveFocus | null
}

/** Mirrors just enough of pomodoro.tsx's own local state to redraw the clock
 *  elsewhere: which task, how long the block is, and the wall-clock deadline
 *  it ends at (never a countdown number, which would drift the moment the
 *  reader's own clock ticks even one second out of step). `dev` is whichever
 *  device last wrote this, so that device's own effect can tell "I said this"
 *  from "someone else did" and never fights its own echo on the way back down
 *  from Supabase. */
export interface ActiveFocus {
  phase: 'focus' | 'break'
  /** Epoch ms this phase ends at, while running. Null while paused --
   *  pausedLeft is the number that means something then, same split
   *  pomodoro.tsx's own endsAt/pausedLeft pair makes, and for the same
   *  reason: a paused block has no deadline to read a countdown from. */
  endsAt: number | null
  /** Seconds left, frozen, while paused. Null while running. */
  pausedLeft: number | null
  /** Epoch ms this phase started at. */
  startedAt: number
  /** Minutes the running block was started for -- not a setting, the actual
   *  length, same distinction pomodoro.tsx's own blockMin makes. */
  blockMin: number
  /** What it's for, when started from a task. */
  focusLabel: string | null
  /** Which task, if any -- lets a reader (another device) show or
   *  act on the real row rather than just the label text. */
  taskId?: string
  space?: SpaceId
  dev: string
  updatedAt: number
}

export type { Undoable }

export interface Store extends PersistedState {
  /** Set or clear one Two Lives link. An empty string removes the key. */
  setTwoLives: (key: string, url: string) => void
  /** Replace the reel library with this list, already parsed and deduplicated. */
  setReels: (list: string[]) => void
  tunes: string[]
  setTunes: (list: string[]) => void
  prompts: PromptItem[]
  addPrompt: PromptsSlice['addPrompt']
  updatePrompt: PromptsSlice['updatePrompt']
  setPromptSent: PromptsSlice['setPromptSent']
  deletePrompt: PromptsSlice['deletePrompt']
  ideaBoard: IdeaCard[]
  addIdeaCard: IdeaBoardSlice['addIdeaCard']
  updateIdeaCard: IdeaBoardSlice['updateIdeaCard']
  deleteIdeaCard: IdeaBoardSlice['deleteIdeaCard']
  reminders: Reminder[]
  reminderLists: ReminderList[]
  addReminder: RemindersSlice['addReminder']
  updateReminder: RemindersSlice['updateReminder']
  toggleReminder: RemindersSlice['toggleReminder']
  deleteReminder: RemindersSlice['deleteReminder']
  addReminderList: RemindersSlice['addReminderList']
  updateReminderList: RemindersSlice['updateReminderList']
  deleteReminderList: RemindersSlice['deleteReminderList']
  people: Person[]
  personBonds: PersonBond[]
  personContacts: PersonContact[]
  addPerson: PeopleSlice['addPerson']
  updatePerson: PeopleSlice['updatePerson']
  deletePerson: PeopleSlice['deletePerson']
  addPersonBond: PeopleSlice['addPersonBond']
  setBondLabel: PeopleSlice['setBondLabel']
  removePersonBond: PeopleSlice['removePersonBond']
  logContact: PeopleSlice['logContact']
  removeContact: PeopleSlice['removeContact']
  prospects: Prospect[]
  addProspect: ProspectsSlice['addProspect']
  updateProspect: ProspectsSlice['updateProspect']
  deleteProspect: ProspectsSlice['deleteProspect']
  logTouch: ProspectsSlice['logTouch']
  removeTouch: ProspectsSlice['removeTouch']
  applyOutreach: ProspectsSlice['applyOutreach']
  gymGoals: GymGoal[]
  addGymGoal: GymSlice['addGymGoal']
  updateGymGoal: GymSlice['updateGymGoal']
  deleteGymGoal: GymSlice['deleteGymGoal']
  invoices: Invoice[]
  invoiceClients: InvoiceClient[]
  invoiceSupplier: InvoiceProfile | undefined
  saveInvoice: InvoicesSlice['saveInvoice']
  patchInvoice: InvoicesSlice['patchInvoice']
  deleteInvoice: InvoicesSlice['deleteInvoice']
  saveInvoiceClient: InvoicesSlice['saveInvoiceClient']
  deleteInvoiceClient: InvoicesSlice['deleteInvoiceClient']
  saveInvoiceProfile: InvoicesSlice['saveInvoiceProfile']
  /** Record where reel-fetch put the downloaded file for an Instagram link. */
  setReelFile: (originalUrl: string, fileUrl: string) => void
  /** What he is looking at. 'all' shows every space at once. */
  view: ViewId
  setView: (v: ViewId) => void
  /** Where a newly created thing lands. In a single space that is the space he is
   *  in; in All it is whichever space he last worked in, and he can change it. */
  space: SpaceId
  setSpace: (s: SpaceId) => void
  /** Does this record belong in what he is looking at? One predicate, so a page
   *  never has to know whether it is in a single space or in All. */
  inView: (s?: SpaceId) => boolean
  page: PageId
  setPage: (p: PageId) => void
  projects: Project[]
  addProject: (name: string, space: SpaceId) => string | undefined
  setProjectTag: (id: string, tag: string) => void
  renameProject: (id: string, name: string) => void
  setProjectHue: (id: string, hue: string) => void
  /** 'move' (default meaning, always pass explicitly) clears projectId on its
   *  tasks and leaves them in the Space's own Plan; 'delete' removes them too. */
  deleteProject: (id: string, mode: 'move' | 'delete') => void
  /** Move a task into a project, or out of one back to the Space's own Plan
   *  with undefined. The task's own space never changes; a project only
   *  ever holds tasks that already belonged to it. */
  setTaskProject: (id: string, projectId: string | undefined) => void
  /** Tie a task to a weekly goal: finishing it adds goalAmt to the goal. */
  setTaskGoal: (id: string, goalId: string | undefined, goalAmt?: number) => void
  /** Move a task into a different workspace outright, clearing its project
   *  (a project only ever holds tasks from its own space, same rule
   *  setTaskProject already keeps). */
  setTaskSpace: (id: string, space: SpaceId) => void
  /** Which Project's Plan is open, or null for the Space's own Plan.
   *  Deliberately not persisted: a project stays a room you walk into, not a
   *  mode that survives a reload. Cleared automatically by setPage and
   *  setView, since every nav tab and every Space is a top-level destination
   *  a project scope should never survive navigating away to. */
  openProjectId: string | null
  setOpenProject: (id: string | null) => void
  /** People. Not filtered by Space or by inView, same as habits/goals --
   *  see the type's own note in types.ts for why. */
  /* True when this device can no longer save. Surfaced in the UI; never silent. */
  storageFull: boolean
  /** The one way in: opens a project's Plan without the id being wiped by
   *  setPage's own clearing (see setPage's note). */
  enterProject: (id: string) => void
  /** The day being looked back at, when the route names one. */
  dayKey: string | null
  openDay: (iso: string) => void
  editing: boolean
  setEditing: (v: boolean) => void
  focusTaskId: string | null
  /** Same handoff, for a routine: which one Today wants open and in view on
   *  the Routines page. Clears itself once read, same as focusTaskId. */
  focusRoutineId: string | null
  setFocusRoutineId: (id: string | null) => void
  /** Same handoff again, for an app: which one the header shelf wants opened
   *  straight into its frame rather than landing him back on the grid. */
  focusAppId: string | null
  setFocusAppId: (id: string | null) => void
  /** A note another page wants opened, handed over once. The Notes page owns
   *  which note is on screen; this is only how a link from elsewhere says
   *  "that one", and it clears itself the moment it is read so a later visit
   *  does not reopen a note he closed. */
  noteToOpen: string | null
  openNote: (id: string | null) => void
  setFocusTaskId: (id: string | null) => void


  toggleTask: (id: string) => void
  /** Rename a task or change its estimate. With a breakdown present the
   *  estimate is the sum of its steps, so only the title is editable then. */
  updateTask: (id: string, patch: { title?: string; estimateMin?: number }) => void
  logActual: (id: string, actualMin: number) => void
  /** Returns the new row's id. */
  addTask: (t: Omit<Task, 'id' | 'done'>) => string
  addTaskWithSubtasks: (parent: Omit<Task, 'id' | 'done' | 'subtasks'>, subs: { title: string; estimateMin: number }[]) => void
  /** Put a task on a period in Goals, or take it off again with no horizon. The
   *  key defaults to the period running now; a Goals column passes its own when
   *  he is standing in next week. */
  commitTask: (id: string, horizon?: import('../types').GoalTimeframe, key?: string) => void
  /** `day` plans it for a day other than today ('YYYY-MM-DD'), which is how
   *  Sunday evening gets to lay out Monday. */
  moveTaskList: (id: string, list: 'today' | 'backlog', day?: string) => void
  moveTasksToToday: (ids: string[], day?: string) => void
  assignSlot: (id: string, slot: import('../types').TimeSlot | undefined) => void
  /** Pin a task to a clock time ('HH:MM'), or undefined to unpin it. The slot
   *  follows the hour, so the two never disagree. */
  setTaskAt: (id: string, at: string | undefined) => void
  toggleSubtask: (taskId: string, subId: string) => void
  /** Rename a step of a task, or change how long it is expected to take. */
  updateSubtask: (taskId: string, subId: string, patch: { title?: string; estimateMin?: number }) => void
  /** Add one step to a task by hand. Minutes optional: the first step inherits the task's estimate, later ones default to 15. */
  addSubtask: (taskId: string, title: string, estimateMin?: number) => void
  /** Drop a step. A generated breakdown is a suggestion, not a contract. */
  deleteSubtask: (taskId: string, subId: string) => void
  logSubtaskActual: (taskId: string, subId: string, actualMin: number) => void
  deleteTask: (id: string) => void
  /** Attach generated steps to an existing task; its estimate becomes their sum. */
  setSubtasks: (taskId: string, subs: { title: string; estimateMin: number }[]) => void
  /** Ask for a fresh estimate of one task now (the model reads the title; the rule of thumb catches a failed call). */
  estimateNow: (taskId: string) => Promise<void>
  /** Set a task's own estimate (used by the per-task estimate action). */
  setEstimate: (taskId: string, minutes: number) => void
  /** The Pomodoro block running right now, synced across devices. Null
   *  clears it (used by stop/finish, and by anything remote that stopped
   *  it first). */
  activeFocus: ActiveFocus | null
  setActiveFocus: (f: ActiveFocus | null) => void

  /** The last day the daily review was walked, and the last day it was skipped. */
  dailyDone?: string
  dailySkipped?: string
  closeDaily: (walked: boolean) => void
  /** Is the daily review on screen? Held here rather than inside it, so the
   *  header can open it from any page and not only Today. */
  dailyOpen: boolean
  openDaily: () => void
  toggleHabitDay: (id: string, day: number) => void
  /** The number a habit is judged by, for today. Logging it IS the tick when it
   *  clears the target, in one action: the typing test is not "did you open it",
   *  it is "did you hit the number", and asking him to type the score and then
   *  also tick a box would let him tick the box on a score that failed. */
  logHabitNumber: (habitId: string, value: number) => void
  /** Which of a habit's two answers he took today. One question, one answer:
   *  picking the other one is a change of mind, not a second thing done, and
   *  picking the same one again gives the day back. */
  pickHabitAlt: (habitId: string, altId: string) => void
  /** Mark a habit kept, or not kept, on a NAMED day. The index version above is
   *  a position in this week and cannot address last Sunday. */
  markHabitOn: (id: string, day: string, value: boolean) => void
  /** Record that a routine-kept habit was in fact done on a past day. */
  assertRoutineOn: (habitId: string, day: string, force?: boolean) => void
  /** A slip he is admitting to after the fact, on the day it happened. */
  logSlipOn: (id: string, day: string) => void
  /** Assert or retract a PAST day of a routine-driven habit by hand. The
   *  routine owns today; the record of a day already gone is his to correct,
   *  because a lost write must never be a permanent lie. */
  assertRoutineDay: (habitId: string, dayIndex: number) => void
  markHabitDay: (id: string, day: number, value: boolean) => void
  /** Many dates on one habit, one state update. See markDaysOn's own comment. */
  markHabitDaysOn: (id: string, days: string[], value: boolean) => void
  addHabit: (input: { name: string; daypart?: import('../types').TimeSlot; frequency: import('../types').HabitFrequency; targetPerWeek?: number; kind?: import('../types').HabitKind; dailyTargetMin?: number; measure?: 'minutes' | 'times' | 'amount'; per?: import('../types').CountPeriod; targetCount?: number; source?: import('../types').HabitSource; quitSince?: string; startedOn?: string; unit?: string; targetAmount?: number; presets?: number[]; color?: string; icon?: string; dailyCost?: number }) => void
  /** Record a slip on a habit you are trying to stop; resets the clean run. */
  logSlip: (id: string) => void
  togglePauseHabit: (id: string) => void
  updateHabit: (id: string, patch: Partial<Pick<HabitDef, 'name' | 'daypart' | 'frequency' | 'targetPerWeek' | 'kind' | 'dailyTargetMin' | 'measure' | 'per' | 'targetCount' | 'source' | 'quitSince' | 'startedOn'>>) => void
  deleteHabit: (id: string) => void

  addGoal: (g: Omit<Goal, 'id'>) => void
  updateGoal: (id: string, patch: Partial<Omit<Goal, 'id' | 'space'>>) => void
  bumpGoal: (id: string, delta: number) => void
  toggleGoalMilestone: (goalId: string, milestoneId: string) => void
  deleteGoal: (id: string) => void
  /** Start the same goal again for the current period. */
  /** Returns the id of the goal now sitting in the current period, whether
   *  freshly made or already there from an earlier click. */
  repeatGoal: (id: string) => string | null

  assistantLog: AssistantEntry[]

  /* Avoidance, the page, is gone. These sessions are not: they are dated
     records of things he faced, so they keep loading, keep syncing and keep
     showing on a day page. Nothing new writes to them. */
  coachSessions: CoachSession[]

  routines: Routine[]
  toggleRoutineStep: (routineId: string, stepId: string) => void
  /** Pick one of a step's alternatives, which ticks the step. Picking the same
   *  one again unpicks it. */
  toggleRoutineAlt: (routineId: string, stepId: string, altId: string) => void
  /** Finish or reopen a whole routine at once, the way ticking a task with
   *  subtasks finishes all of them. */
  setRoutineDone: (routineId: string, done: boolean) => void
  /** Put a routine on a day's list before it is started, so a day can be planned
   *  and not only recorded. `slot` undefined takes it back off the list, and
   *  `day` defaults to today. */
  planRoutine: (routineId: string, slot?: import('../types').TimeSlot, day?: string) => void
  /** Log one occurrence of a counted habit, or take the last one back. */
  logCount: (habitId: string, delta: 1 | -1) => void
  /** An amount habit (water in ml): one dated row per log. Returns the row's
   *  src, which is what removeAmount takes to undo exactly that log. */
  logAmount: (habitId: string, v: number) => string | undefined
  removeAmount: (habitId: string, src: string) => void
  /** A typed amount on a goal, with an optional note. Returns the entry id. */
  logGoalAmount: (id: string, v: number, note?: string) => string
  removeGoalEntry: (id: string, entryId: string) => void
  addRoutineWithSteps: (input: { title: string; cadence: RoutineCadence; daypart?: import('../types').TimeSlot; steps: string[]; color?: string; icon?: string; repeatable?: boolean }) => void
  setLook: (kind: 'habit' | 'routine' | 'goal', id: string, look: { color?: string; icon?: string; dailyCost?: number; presets?: number[]; name?: string; daypart?: import('../types').TimeSlot | null }) => void
  /** A routine and the habit that mirrors it are created together, so finishing
   *  it always has somewhere to land. */
  addRoutine: (input: { title: string; cadence: RoutineCadence; blurb?: string; daypart?: import('../types').TimeSlot }) => void
  updateRoutine: (id: string, patch: Partial<Pick<Routine, 'title' | 'cadence' | 'blurb'>>) => void
  deleteRoutine: (id: string) => void
  addRoutineStep: (routineId: string, step: { title: string; note?: string; link?: string; linkLabel?: string }) => void
  deleteRoutineStep: (routineId: string, stepId: string) => void
  /** Personal bests, keyed by `routineId:stepId`. Never cleared by a rollover. */
  records: Record<string, number>

  /** Finished focus blocks, newest first. Trimmed to a year. */
  focusSessions: FocusSession[]
  /** Called when a focus block finishes; feeds measured habits and the ledger. */
  logFocus: (minutes: number, label?: string) => void
  /** Log a finished stretch of focus onto a SPECIFIC day. The half of a block
   *  worked before midnight belongs to the day it was worked on. */
  logFocusOn: (day: string, minutes: number, label?: string, at?: string) => void
  /** Correct a focus block: its length, or what it was for. */
  updateFocus: (id: string, patch: { minutes?: number; label?: string }) => void
  /** Remove a focus block, and the ledger row it wrote with it. */
  deleteFocus: (id: string) => void
  /** Keep any auto habit whose measured total has reached its threshold. The
   *  running block counts: `extraMin` is what the timer has on the clock now. */
  syncAutoHabits: (extraMin?: number, label?: string) => void

  /** Every dated habit tick and routine completion. The record days[] caches. */
  habitLog: HabitTick[]
  routineLog: RoutineDone[]
  /** Every dated slip, and every dated number a routine step recorded. */
  slips: HabitSlip[]
  stepLog: StepEntry[]
  stepTicks: StepTick[]
  dayLog: DayTaskLog[]

  /* Where the copy on screen last came from, when that was another device.
     Null means this one, which is the ordinary case and needs no words. */
  syncOrigin: { name: string; at: number } | null

  /* ---- Notes ----
     The folder is the note's address and its workspace both: move a note into
     another workspace's folder and it changes workspace, because two places
     recording the same fact is how they end up disagreeing. */
  notes: Note[]
  noteFolders: NoteFolder[]
  /** Makes an empty note in that folder and hands back its id to open. */
  addNote: (folderId: string, body?: string) => string
  updateNote: (id: string, patch: Partial<Pick<Note, 'title' | 'body' | 'color' | 'pinned'>>) => void
  /** Tick a note off, or put it back. */
  setNoteDone: (id: string, done: boolean) => void
  moveNote: (id: string, folderId: string) => void
  deleteNote: (id: string) => void
  /** The losing body from another device: take it into this note, or drop it. */
  keepNoteConflict: (id: string) => void
  dropNoteConflict: (id: string) => void
  addNoteFolder: (space: SpaceId, name: string) => string
  renameNoteFolder: (id: string, name: string) => void
  /** Deletes the folder only. Its notes move up to the workspace folder, because
   *  a folder is a shelf and emptying a shelf does not burn the books. */
  deleteNoteFolder: (id: string) => void
  /** Rewrites a tag everywhere it appears. A tag you cannot rename is a tag you
   *  stop using once it is misspelled. */
  renameNoteTag: (from: string, to: string) => void

  /** The last delete, still takeable back. Null once it is taken back or expires. */
  undoable: Undoable | null
  undoDelete: () => void
  dismissUndo: () => void

  todayIndex: number
  /** This week's ledger rows for the active profile; savedMin/accuracy derive from it. */
  weekLedger: LedgerEntry[]
  savedMin: number
  accuracyPct: number
  resetDemo: () => void
}
