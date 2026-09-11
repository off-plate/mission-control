import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SUPABASE_ENABLED, deleteRemoteState, loadRemoteState } from './supabase'
import { outbox } from './sync'

/* Two blobs are the same work if they differ only in when they were saved.
   Used both to stop two tabs answering each other's saves forever, and to decide
   whether this device is holding anything the server has not got. */
function stripDates(j: string): string {
  try {
    const o = JSON.parse(j) as Record<string, unknown>
    delete o.savedAt
    /* Who wrote it is not part of the work either. Leaving it in would make
       every save differ from the last one by a fresh timestamp, and the two
       things this comparison protects, two tabs answering each other forever
       and a device pushing what the server already has, would both come back. */
    delete o.lastWrite
    return JSON.stringify(o)
  } catch { return j }
}
import { roll } from './roll'
import { deviceId, deviceName, mergeStates, rowKey, type LastWrite, type Tomb } from './sync-merge'
import { newId, todayKey } from './store/shared'
import { type Undoable, useUndo } from './store/undo'
import { useGraveyard } from './store/graveyard'
import { noteTitle, useNotesSlice } from './store/notes'
import { useContactsSlice } from './store/contacts'
import { useWidgetsSlice } from './store/widgets'
import { useTwoLivesSlice } from './store/twolives'
import { useConnectionsSlice } from './store/connections'
import { useCoachSlice } from './store/coach'
import { useAssistantSlice } from './store/assistant'
import { foldersFromRoutines, useGrowthSlice } from './store/growth'
import { usePlannerSlice } from './store/planner'
import { dayIndexOf, dayOfWeekKey, goalPeriodKey, goalPeriodRange, isoWeekKey, localDateKey, periodIsPast, periodKeyFor, type GoalTf } from './util'
import {
  DEFAULT_SPACES,
  MOCK_GOALS,
  MOCK_HABITS,
  MOCK_LEDGER,
  LATE_STEPS,
  MOCK_ROUTINES,
} from './mock'
import { goalCurrent, isTimeFed, routineComplete } from './types'
import { isSpace, SPACES, spaceFolderId } from './types'
import type { HabitFrequency } from './types'
import type {
  ViewId,
  Contact,
  ContactActivity,
  FocusSession,
  HabitSlip,
  HabitTick,
  RoutineDone,
  StepEntry,
  StepTick,
  RoutineCadence,
  AssistantEntry,
  CoachFacts,
  CoachSession,
  DayTaskLog,
  Goal,
  Idea,
  Note,
  NoteFolder,
  Routine,
  HabitDef,
  LedgerEntry,
  PageId,
  PlanState,
  Project,
  ReviewState,
  SizeKey,
  SocialEntry,
  SourceState,
  SpaceId,
  Task,
  TaskCategory,
  WidgetInstance,
  WidgetType,
} from './types'

export const STORAGE_KEY = 'mission-control-demo-v12'
/** The untouched copy of whatever was saved before this build migrated it. */
export const BACKUP_KEY = 'mission-control-backup-v3'

/* Saved state written by a NEWER build than this one. This build cannot read it,
   so it must not write either: seeding fresh and saving would replace whatever
   the newer device wrote with an empty start. The app runs, and says so. */
let futureBlob = false
export function isReadOnly(): boolean { return futureBlob }

interface PersistedState {
  version: 3
  spaces: Record<SpaceId, WidgetInstance[]>
  tasks: Task[]
  habits: HabitDef[]
  goals: Goal[]
  /** Rooms inside a Space. Optional so an old saved blob without any still
   *  reads as an empty list rather than failing to parse. */
  projects?: Project[]
  /** People. Optional for the same reason projects is. */
  contacts?: Contact[]
  /** Every logged touch, dated. Its own collection rather than nested on
   *  Contact -- see the type's own note in types.ts. */
  contactActivity?: ContactActivity[]
  ledger: LedgerEntry[]
  social: SocialEntry[]
  sources: SourceState[]
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
}

export type { Undoable }

interface Store extends PersistedState {
  /** Set or clear one Two Lives link. An empty string removes the key. */
  setTwoLives: (key: string, url: string) => void
  /** Replace the reel library with this list, already parsed and deduplicated. */
  setReels: (list: string[]) => void
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
  addProject: (name: string, space: SpaceId) => void
  renameProject: (id: string, name: string) => void
  /** 'move' (default meaning, always pass explicitly) clears projectId on its
   *  tasks and leaves them in the Space's own Plan; 'delete' removes them too. */
  deleteProject: (id: string, mode: 'move' | 'delete') => void
  /** Move a task into a project, or out of one back to the Space's own Plan
   *  with undefined. The task's own space never changes; a project only
   *  ever holds tasks that already belonged to it. */
  setTaskProject: (id: string, projectId: string | undefined) => void
  /** Which Project's Plan is open, or null for the Space's own Plan.
   *  Deliberately not persisted: a project stays a room you walk into, not a
   *  mode that survives a reload. Cleared automatically by setPage and
   *  setView, since every nav tab and every Space is a top-level destination
   *  a project scope should never survive navigating away to. */
  openProjectId: string | null
  setOpenProject: (id: string | null) => void
  /** People. Not filtered by Space or by inView, same as habits/goals --
   *  see the type's own note in types.ts for why. */
  contacts: Contact[]
  contactActivity: ContactActivity[]
  /* True when this device can no longer save. Surfaced in the UI; never silent. */
  storageFull: boolean
  addContact: (name: string) => string
  updateContact: (id: string, patch: Partial<Pick<Contact, 'name' | 'tag' | 'phone' | 'email' | 'company' | 'role' | 'next' | 'notes' | 'projectId'>>) => void
  deleteContact: (id: string) => void
  logContactActivity: (id: string, type: ContactActivity['type'], note?: string) => void
  /* A logged touch has to be removable. The log is what contactStatus reads, so one mis-click
     otherwise leaves a call on the record that never happened and no way to take it back. */
  deleteContactActivity: (activityId: string) => void
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

  reorderSpace: (space: SpaceId, order: string[]) => void
  resizeWidget: (space: SpaceId, id: string, size: SizeKey) => void
  removeWidget: (space: SpaceId, id: string) => void
  addWidget: (space: SpaceId, type: WidgetType) => void
  moveWidget: (space: SpaceId, id: string, dir: -1 | 1) => void

  toggleTask: (id: string) => void
  /** Rename a task or change its estimate. With a breakdown present the
   *  estimate is the sum of its steps, so only the title is editable then. */
  updateTask: (id: string, patch: { title?: string; estimateMin?: number }) => void
  logActual: (id: string, actualMin: number) => void
  /** Returns the new row's id. */
  addTask: (t: Omit<Task, 'id' | 'done'>) => string
  addTasks: (tasks: Omit<Task, 'id' | 'done'>[]) => void
  addTaskWithSubtasks: (parent: Omit<Task, 'id' | 'done' | 'subtasks'>, subs: { title: string; estimateMin: number }[]) => void
  /** Put a task on a period in Goals, or take it off again with no horizon. The
   *  key defaults to the period running now; a Goals column passes its own when
   *  he is standing in next week. */
  commitTask: (id: string, horizon?: import('./types').GoalTimeframe, key?: string) => void
  /** `day` plans it for a day other than today ('YYYY-MM-DD'), which is how
   *  Sunday evening gets to lay out Monday. */
  moveTaskList: (id: string, list: 'today' | 'backlog', day?: string) => void
  moveTasksToToday: (ids: string[], day?: string) => void
  assignSlot: (id: string, slot: import('./types').TimeSlot | undefined) => void
  /** Pin a task to a clock time ('HH:MM'), or undefined to unpin it. The slot
   *  follows the hour, so the two never disagree. */
  setTaskAt: (id: string, at: string | undefined) => void
  toggleSubtask: (taskId: string, subId: string) => void
  /** Rename a step of a task, or change how long it is expected to take. */
  updateSubtask: (taskId: string, subId: string, patch: { title?: string; estimateMin?: number }) => void
  /** Drop a step. A generated breakdown is a suggestion, not a contract. */
  deleteSubtask: (taskId: string, subId: string) => void
  logSubtaskActual: (taskId: string, subId: string, actualMin: number) => void
  deleteTask: (id: string) => void
  /** Attach generated steps to an existing task; its estimate becomes their sum. */
  setSubtasks: (taskId: string, subs: { title: string; estimateMin: number }[]) => void
  /** Set a task's own estimate (used by the per-task estimate action). */
  setEstimate: (taskId: string, minutes: number) => void

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
  /** Same write, dated rather than weekday-indexed, for a day outside the
   *  current week -- a Hevy backfill reaching six months back, say. Days
   *  inside the current week still update the days[] cache; older ones
   *  land only in habitLog, which is where a habit's real history lives. */
  markHabitDayOn: (id: string, day: string, value: boolean) => void
  /** Many dates on one habit, one state update. See markDaysOn's own comment
   *  for why a loop of markHabitDayOn calls is not the same thing. */
  markHabitDaysOn: (id: string, days: string[], value: boolean) => void
  addHabit: (input: { name: string; daypart?: import('./types').TimeSlot; frequency: import('./types').HabitFrequency; targetPerWeek?: number; kind?: import('./types').HabitKind; dailyTargetMin?: number; measure?: 'minutes' | 'times'; per?: import('./types').CountPeriod; targetCount?: number; source?: import('./types').HabitSource; quitSince?: string; startedOn?: string }) => void
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

  setSocial: (entries: SocialEntry[]) => void
  toggleSource: (id: string) => void

  commitPlan: (taskIds: string[], firstMoveId: string | null) => void
  /** Close a window: any range, one act. Its outcomes land in the backlog. */

  assistantLog: AssistantEntry[]
  applyDictation: (text: string, items: { kind: 'task' | 'goal' | 'done'; text: string; estimateMin?: number }[]) => void
  revertAssistantItem: (entryId: string, itemId: string) => void

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
  /** Open a fresh run of a repeatable routine, keeping every run before it. */
  startAgain: (routineId: string) => void
  /** Put a routine on a day's list before it is started, so a day can be planned
   *  and not only recorded. `slot` undefined takes it back off the list, and
   *  `day` defaults to today. */
  planRoutine: (routineId: string, slot?: import('./types').TimeSlot, day?: string) => void
  /** Log one occurrence of a counted habit, or take the last one back. */
  logCount: (habitId: string, delta: 1 | -1) => void
  /** A routine and the habit that mirrors it are created together, so finishing
   *  it always has somewhere to land. */
  addRoutine: (input: { title: string; cadence: RoutineCadence; blurb?: string; daypart?: import('./types').TimeSlot }) => void
  updateRoutine: (id: string, patch: Partial<Pick<Routine, 'title' | 'cadence' | 'blurb'>>) => void
  deleteRoutine: (id: string) => void
  addRoutineStep: (routineId: string, step: { title: string; note?: string; link?: string; linkLabel?: string }) => void
  updateRoutineStep: (routineId: string, stepId: string, patch: Partial<Pick<import('./types').RoutineStep, 'title' | 'note' | 'link' | 'linkLabel'>>) => void
  deleteRoutineStep: (routineId: string, stepId: string) => void
  moveRoutineStep: (routineId: string, stepId: string, dir: -1 | 1) => void
  /** Record a number against a routine step (today's typing speed). Keeps the
   *  all-time best in `records`, which never resets with the period. */
  setStepData: (routineId: string, stepId: string, value: number) => void
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

const Ctx = createContext<Store | null>(null)

function loadPersisted(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null

    /* Copy the raw blob aside before a single transform runs, and never touch it
       again. Everything below rewrites his saved state in place; if any of it is
       wrong, this is the copy that gets him back. */
    try {
      if (localStorage.getItem(BACKUP_KEY) !== raw) localStorage.setItem(BACKUP_KEY, raw)
    } catch { /* a full quota must not stop the app loading */ }

    const p = JSON.parse(raw) as PersistedState
    /* Refuse only a blob from a FUTURE version, which this build cannot
       understand. Refusing an older one returned null, which seeded the mock
       data and then wrote it straight over his real state on the first change.
       That was the most dangerous line in the file. */
    if ((p.version ?? 0) > 3) { futureBlob = true; return null }
    if (p.schema && p.schema !== STORAGE_KEY) return null
    p.version = 3
    /* A workspace added after this state was saved. His saved record only has
       the spaces that existed then, so a new one is filled from the defaults
       while every space he has arranged himself is handed back untouched. */
    if (p.spaces) p.spaces = { ...DEFAULT_SPACES, ...p.spaces }
    /* The clock, asked for on 2026-08-07 as a widget in the grid rather than a
       line in the header. His saved arrangement predates the widget, so it is
       added once, first in every space, which is where he asked for it. If he
       removes it later it stays removed: this runs once and never again. */
    p.removedSeeds = p.removedSeeds ?? []
    if (!p.removedSeeds.includes('fix:clock-widget')) {
      p.removedSeeds.push('fix:clock-widget')
      if (p.spaces) {
        for (const key of Object.keys(p.spaces)) {
          const list = p.spaces[key as SpaceId] ?? []
          if (list.some((w) => w.type === 'clock')) continue
          p.spaces[key as SpaceId] = [{ id: `clock-${key}`, type: 'clock' as const, size: 'S' as const }, ...list]
        }
      }
    }

    /* One-time repair of focus blocks logged at the wrong length. While the
       timer read its length from the SETTING, a block started from a task was
       recorded at the setting's minutes, not the task's. The truth is still in
       the plan: each block names what it was for, and the task, its steps or
       its ledger row still carry the estimate. Case-blind, because the label
       may have been typed back before the task was renamed. Runs once. */
    p.removedSeeds = p.removedSeeds ?? []
    if (!p.removedSeeds.includes('fix:focus-lengths')) {
      p.removedSeeds.push('fix:focus-lengths')
      const estimateFor = (label: string): number | null => {
        const want = label.trim().toLowerCase()
        for (const t of p.tasks ?? []) {
          if (t.title.trim().toLowerCase() === want) {
            return t.subtasks?.length ? t.subtasks.reduce((a, x) => a + x.estimateMin, 0) : t.estimateMin
          }
          const st = t.subtasks?.find((x) => x.title.trim().toLowerCase() === want)
          if (st) return st.estimateMin
        }
        const l = (p.ledger ?? []).find((x) => !x.title.startsWith('Focus:') && x.title.trim().toLowerCase() === want)
        return l ? l.estimateMin : null
      }
      p.focusSessions = (p.focusSessions ?? []).map((f) => {
        if (!f.label) return f
        const est = estimateFor(f.label)
        // Only ever raised: the bug truncated, it never inflated.
        if (est == null || f.minutes >= est) return f
        if (f.ledgerId) {
          p.ledger = (p.ledger ?? []).map((l) => (l.id === f.ledgerId ? { ...l, estimateMin: est, actualMin: est } : l))
        }
        return { ...f, minutes: est }
      })
    }

    /* Michael's own correction, 2026-08-01: the finish-the-app block actually
       ran 64 minutes, longer than the estimate the automatic repair raised it
       to, because he extended it. His number wins over any derived one. Once. */
    if (!p.removedSeeds.includes('fix:focus-64')) {
      p.removedSeeds.push('fix:focus-64')
      const f = (p.focusSessions ?? []).find((x) => /finish fil/i.test(x.label ?? ''))
      if (f) {
        f.minutes = 64
        if (f.ledgerId) p.ledger = (p.ledger ?? []).map((l) => (l.id === f.ledgerId ? { ...l, estimateMin: 64, actualMin: 64 } : l))
      }
    }

    /* A block logged across midnight was filed whole onto the day it FINISHED,
       handing today an hour that was mostly worked yesterday: wrong day record,
       wrong habit day, wrong goal hours, twice. Any session whose start
       (finish minus length) lands on an earlier day is split at midnight into
       two sessions, each on the day its minutes were actually worked. Runs
       once; the timer itself now banks at midnight so new ones arrive split. */
    if (!p.removedSeeds.includes('fix:focus-split')) {
      p.removedSeeds.push('fix:focus-split')
      const out: FocusSession[] = []
      for (const f of p.focusSessions ?? []) {
        if (!f.at) { out.push(f); continue }
        const end = new Date(f.at)
        const start = new Date(end.getTime() - f.minutes * 60000)
        const startDay = localDateKey(start)
        if (startDay >= f.day) { out.push(f); continue }
        const midnight = new Date(end.getFullYear(), end.getMonth(), end.getDate())
        const before = Math.round((midnight.getTime() - start.getTime()) / 60000)
        const after = f.minutes - before
        if (before < 1 || after < 1) { out.push(f); continue }
        const lid = `${f.ledgerId ?? f.id}-pre`
        out.push({ ...f, id: `${f.id}-pre`, day: startDay, minutes: before, ledgerId: lid, at: new Date(midnight.getTime() - 1000).toISOString() })
        out.push({ ...f, minutes: after })
        if (f.ledgerId) {
          p.ledger = (p.ledger ?? []).flatMap((l) => (l.id === f.ledgerId
            ? [{ ...l, id: lid, estimateMin: before, actualMin: before, when: startDay }, { ...l, estimateMin: after, actualMin: after }]
            : [l]))
        }
      }
      p.focusSessions = out
    }

    /* 2026-08-02: Michael finished Out Brain Rot on the evening of Aug 1 and
       the rows are simply not in his state; the load path provably keeps them,
       so the write itself was lost (most likely an older tab writing the blob
       over the newer one). His word is the record: the finish is put back. */
    if (!p.removedSeeds.includes('fix:obr-0801')) {
      p.removedSeeds.push('fix:obr-0801')
      const day = '2026-08-01'
      /* Evidence first: only a profile whose log already reaches back before
         the lost day can have lost it. On a fresh or wiped profile this wrote
         a first of August that never happened on that device, and Wipe
         everything quietly un-wiped. */
      const livedThrough = (p.habitLog ?? []).some((t) => t.day < day)
      if (livedThrough && !(p.habitLog ?? []).some((t) => t.habitId === 'h-brainrot' && t.day === day)) {
        p.habitLog = [...(p.habitLog ?? []), { habitId: 'h-brainrot', day }]
        p.routineLog = [...(p.routineLog ?? []), { routineId: 'r-brainrot', day, periodKey: day, run: 0 }]
      }
    }

    /* Reflect is gone, so the two review steps that learned to open it lose the
       pointer again. Only the pointer: his own words on the step are untouched,
       and it runs once. */
    if (!p.removedSeeds.includes('fix:review-goto-drop')) {
      p.removedSeeds.push('fix:review-goto-drop')
      p.routines = (p.routines ?? []).map((r) => ({
        ...r,
        steps: r.steps.map((st) => ((st.goto as string | undefined) === 'review' ? { ...st, goto: undefined, gotoLabel: undefined } : st)),
      }))
    }

    /* Meditation drops from ten minutes to five, 2026-08-02. The step is his
       once it exists, so the seed cannot reach it; this rewrites the timer ONLY
       while it still holds the old seeded value, so a length he chose himself
       is never touched, and it runs once. */
    if (!p.removedSeeds.includes('fix:mr1-5min')) {
      p.removedSeeds.push('fix:mr1-5min')
      p.routines = (p.routines ?? []).map((r) => (r.id !== 'r-morning' ? r : {
        ...r,
        steps: r.steps.map((st) => (st.id === 'mr1' && st.seconds === 600
          ? { ...st, seconds: 300, note: st.note?.includes('Ten minutes') ? st.note.replace('Ten minutes', 'Five minutes') : st.note }
          : st)),
      }))
    }

    /* Night work moves home to Off-Plate, 2026-08-02: it is business-evening
       work, not personal life. Space is not something the UI lets him edit on a
       routine, so this cannot be overriding a choice of his. Runs once. */
    if (!p.removedSeeds.includes('fix:nightwork-space')) {
      p.removedSeeds.push('fix:nightwork-space')
      p.routines = (p.routines ?? []).map((r) => (r.id === 'r-nightwork' && r.space === 'personal' ? { ...r, space: 'offplate' } : r))
      p.habits = (p.habits ?? []).map((h) => (h.id === 'h-nightwork' && h.space === 'personal' ? { ...h, space: 'offplate' } : h))
    }

    /* Creatine moves out of the morning routine and into After wake up,
       2026-08-02. Only the seeded step is pulled, and only while it still looks
       seeded, so a creatine step he rewrote himself stays where he put it. The
       habit is untouched: the new routine's step carries the same habitId, so
       every tick he has ever logged still belongs to it. */
    if (!p.removedSeeds.includes('fix:creatine-moves')) {
      p.removedSeeds.push('fix:creatine-moves', 'r-morning:step:mr0')
      p.routines = (p.routines ?? []).map((r) => (r.id !== 'r-morning' ? r : {
        ...r,
        steps: r.steps.filter((st) => !(st.id === 'mr0' && st.title === 'Take creatine')),
        doneStepIds: r.doneStepIds.filter((id) => id !== 'mr0'),
      }))
    }

    /* Night work moves from Off-Plate to Personal, his call on 2026-08-02. The
       workspace of a row he owns is never touched by the loader, so this is the
       explicit one-time move, habit included. Everything logged against either
       keeps its id and therefore its history; only which workspace shows it
       changes. */
    if (!p.removedSeeds.includes('fix:nightwork-personal')) {
      p.removedSeeds.push('fix:nightwork-personal')
      p.routines = (p.routines ?? []).map((r) => (r.id === 'r-nightwork' && r.space === 'offplate' ? { ...r, space: 'personal' } : r))
      p.habits = (p.habits ?? []).map((h) => (h.id === 'h-nightwork' && h.space === 'offplate' ? { ...h, space: 'personal' } : h))
    }

    /* Notes, 2026-08-03. The Brain Dump board becomes a real notes app, and
       everything already on that board comes across: each sticky becomes a
       note in a "Brain dumps" folder inside the workspace it was captured in,
       keeping its text, its colour and its date. His instruction was plain,
       keep whatever is in the brain dumps.

       The ideas array is left exactly where it is rather than deleted. A phone
       still running the old bundle renders that array, and an empty one would
       show him a board he never cleared. It costs a few hundred bytes and it
       stops a downgrade from looking like a data loss. Runs once. */
    if (!p.removedSeeds.includes('fix:notes-v1')) {
      p.removedSeeds.push('fix:notes-v1')
      const folders: NoteFolder[] = [...(p.noteFolders ?? [])]
      const notes: Note[] = [...(p.notes ?? [])]
      for (const i of p.ideas ?? []) {
        const id = `note-${i.id}`
        if (notes.some((n) => n.id === id)) continue
        const space: SpaceId = SPACES.includes(i.space) ? i.space : 'personal'
        const bin = `nf-braindump-${space}`
        if (!folders.some((f) => f.id === bin)) {
          folders.push({ id: bin, space, name: 'Brain dumps', parentId: spaceFolderId(space), order: 0 })
        }
        /* The seeded stickies carry the word 'idea' where a date belongs. */
        const day = /^\d{4}-\d{2}-\d{2}$/.test(i.when ?? '') ? i.when : localDateKey()
        const body = (i.text ?? '').trim()
        notes.push({
          id, space, folderId: bin, title: noteTitle(body), body,
          color: i.color ?? 'amber', when: day, updatedAt: Date.parse(day) || Date.now(),
        })
      }
      p.noteFolders = folders
      p.notes = notes
    }

    /* Michael's ask, 2026-08-03: the money gets looked at before bed, not
       discovered at the end of the month. The step is his once the routine
       exists, so the seed cannot reach it; this adds it once, after the to-do
       list, and only if it is not already there. */
    if (!p.removedSeeds.includes('fix:bed-compass')) {
      p.removedSeeds.push('fix:bed-compass')
      p.routines = (p.routines ?? []).map((r) => {
        if (r.id !== 'r-evening' || r.steps.some((st) => st.id === 'be8')) return r
        const step = { id: 'be8', title: 'Review Compass finances', kind: 'do' as const, link: 'https://compass-money.netlify.app', linkLabel: 'Open Compass' }
        const at = r.steps.findIndex((st) => st.id === 'be1')
        const steps = [...r.steps]
        steps.splice(at < 0 ? 0 : at + 1, 0, step)
        return { ...r, steps }
      })
    }

    /* Journaling added to the same routine, 2026-09-06. Last step, after the
       alarm is set -- the last thing before the light goes off. Same guard as
       fix:bed-compass just above: runs once, only adds it if it is not
       already there. */
    if (!p.removedSeeds.includes('fix:bed-journal')) {
      p.removedSeeds.push('fix:bed-journal')
      p.routines = (p.routines ?? []).map((r) => {
        if (r.id !== 'r-evening' || r.steps.some((st) => st.id === 'be9')) return r
        const step = { id: 'be9', title: 'Journal', kind: 'do' as const, note: 'A few lines on the day -- what happened, what’s still on your mind.' }
        return { ...r, steps: [...r.steps, step] }
      })
    }

    /* A plan is for a day. Yesterday's cannot be allowed to sit on this morning's
       list pretending it was chosen. Tomorrow's is a different matter: he put it
       there on purpose and it has not had its day yet, so only the past is
       swept. */
    {
      const today = localDateKey()
      p.routines = (p.routines ?? []).map((r) => (r.planned && r.planned.day < today ? { ...r, planned: undefined } : r))
    }

    /* Week rollover: when the saved state belongs to an earlier ISO week, each
       habit's checkmarks are archived into its 12-week history and cleared, so
       Monday always starts a fresh row instead of showing last week's ticks. */
    const wk = isoWeekKey()

    /* One-time migration to the dated habit log. Whatever is ticked in the week
       array right now becomes dated entries, so nothing he has logged is lost by
       moving to the durable record. history[] holds twelve undated weekly counts
       and stays exactly as it is: inventing dates for it would be fabrication,
       and the new log simply starts here and grows. */
    if (!p.habitLog) {
      const ticks: HabitTick[] = []
      // Ticks belong to the week the saved state was written in, not to this one.
      const base = p.weekKey === wk ? new Date() : null
      if (base) {
        for (const h of p.habits ?? []) {
          h.days.forEach((on, i) => { if (on) ticks.push({ habitId: h.id, day: dayOfWeekKey(i, base) }) })
        }
      }
      p.habitLog = ticks
    }
    /* The one date each quit habit was carrying becomes the first record in its
       slip history. Everything after it is appended rather than overwriting. */
    if (!p.slips) {
      p.slips = (p.habits ?? [])
        .filter((h) => h.kind === 'break' && h.lastSlip)
        .map((h) => ({ habitId: h.id, day: h.lastSlip as string }))
    }
    if (!p.stepLog) {
      /* What is in stepData belongs to the period it was recorded in, and the
         only date that period gives us for certain is a daily one. A weekly or
         monthly routine's current number has no day, so it starts the series
         from the next one he logs rather than inventing a date for it. */
      p.stepLog = (p.routines ?? []).flatMap((r) =>
        r.cadence === 'weekly' || r.cadence === 'monthly' || !r.periodKey
          ? []
          : Object.entries(r.stepData ?? {}).map(([stepId, value]) => ({ routineId: r.id, stepId, day: r.periodKey as string, value })),
      )
    }
    if (!p.routineLog) {
      // A routine that is currently complete carries the day it was completed.
      p.routineLog = (p.routines ?? [])
        .filter((r) => r.completedOn && routineComplete(r, periodKeyFor(r.cadence)))
        .map((r) => ({ routineId: r.id, day: r.completedOn as string, periodKey: r.periodKey ?? periodKeyFor(r.cadence) }))
    }

    /* A row written before spaces existed has no space, which used to mean it
       counted everywhere. Stamp it once, and record that it was a guess rather
       than something he chose, so the number is at least in one place only. */
    {
      let guessed = 0
      const stamp = <T extends { space?: SpaceId }>(rows: T[] | undefined) =>
        (rows ?? []).map((r) => (r.space ? r : (guessed++, { ...r, space: 'personal' as SpaceId })))
      p.ledger = stamp(p.ledger)
      p.coachSessions = stamp(p.coachSessions)
      p.focusSessions = stamp(p.focusSessions)
      if (guessed) p.spaceGuessed = (p.spaceGuessed ?? 0) + guessed
    }

    /* Everything that has to happen because time passed happens in one place,
       walking from the day it last ran. Each of these used to be its own "is the
       saved week this week?" test, each firing once no matter how long the gap. */
    roll(p)

    /* A goal whose period has ended stops counting and keeps the number it
       finished on. Nothing is deleted: it moves to the past, where he can look
       at how it went and set it again if he wants to. */
    const renewals: Goal[] = []
    p.goals = (p.goals ?? []).map((g) => {
      const tf = (g.timeframe ?? 'quarter') as GoalTf
      const key = g.periodKey ?? goalPeriodKey(tf)
      if (g.closed || !periodIsPast(tf, key)) return { ...g, periodKey: key }
      const range = goalPeriodRange(tf, key)
      const final = goalCurrent(g, p.habits ?? [], p.habitLog ?? [], range, p.slips ?? [], p.focusSessions ?? [])
      /* A goal that counts ITSELF renews itself: three hours of focus a week is
         a standing bar, not a one-off, and making him re-set it every Monday is
         how the bar quietly disappears. The closed one keeps its result; a
         fresh copy opens for the period we are in now. Hand-logged goals stay
         one-off, with "Set it again" for the ones he wants back. */
      if (g.habitId) {
        renewals.push({
          ...g, id: `${g.id}-r${goalPeriodKey(tf).replace(/[^0-9A-Za-z]/g, '')}`,
          current: 0, milestones: [], closed: undefined, periodKey: goalPeriodKey(tf),
        })
      }
      return { ...g, periodKey: key, closed: { on: range.to, final } }
    })
    for (const r of renewals) {
      const dupe = p.goals.some((g) => !g.closed && g.habitId === r.habitId && g.name === r.name
        && (g.timeframe ?? 'quarter') === (r.timeframe ?? 'quarter') && g.periodKey === r.periodKey)
      if (!dupe) p.goals.push(r)
    }

    /* A day that has not happened yet cannot have been kept. The week array has
       always been cleaned of future ticks; the log has to be cleaned the same way
       or the two disagree the moment a migration or a clock change writes one. */
    p.habitLog = (p.habitLog ?? []).filter((t) => t.day <= localDateKey())
    p.routineLog = (p.routineLog ?? []).filter((r) => r.day <= localDateKey())

    /* A start date that never got its days. The date field shipped one build
       before the filling did, so a habit he had been keeping since July sat at
       0/7 with the date sitting right there on its card. Every habit carrying a
       start it has not been filled for gets those days written now, up to
       yesterday. Marked by filledSince, so this runs once per date and a day he
       unticks afterwards stays unticked. Runs before the week cache below, which
       then picks it up for free. */
    {
      const today = localDateKey()
      const filled: HabitTick[] = []
      p.habits = (p.habits ?? []).map((h) => {
        if (h.kind === 'break' || !h.startedOn || h.filledSince) return h
        const have = new Set((p.habitLog ?? []).filter((t) => t.habitId === h.id).map((t) => t.day))
        const cursor = new Date(`${h.startedOn}T12:00:00`)
        const end = new Date(`${today}T12:00:00`)
        if (!Number.isNaN(cursor.getTime())) {
          while (cursor < end) {
            const key = localDateKey(cursor)
            if (!have.has(key)) filled.push({ habitId: h.id, day: key, src: 'since' })
            cursor.setDate(cursor.getDate() + 1)
          }
        }
        return { ...h, filledSince: h.startedOn }
      })
      if (filled.length) p.habitLog = [...(p.habitLog ?? []), ...filled]
    }

    /* The week array is a cache. Rebuilding it from the log on every load means
       the log is the one truth and the two can never drift apart. */
    {
      const thisWeek = new Set(
        (p.habitLog ?? [])
          .filter((t) => isoWeekKey(new Date(t.day)) === wk)
          .map((t) => `${t.habitId}|${t.day}`),
      )
      p.habits = p.habits.map((h) => ({
        ...h,
        days: Array.from({ length: 7 }, (_, i) => thisWeek.has(`${h.id}|${dayOfWeekKey(i)}`)),
      }))
    }

    /* A rename of a SEEDED row has to reach state that already exists. Renaming
       it in the seed alone did nothing here: routines and habits are his once
       they exist, so the loader never touches their titles, and the new name
       only ever appeared on a fresh install. This renames the seeded row only
       while it still carries the exact old name, so anything he has renamed
       himself is left alone and running it twice changes nothing. */
    {
      const renames: [string, string, string][] = [['r-evening', 'Evening shutdown', 'Before bed routine'], ['r-weekly', 'Weekly reset', 'Weekly review'], ['r-morningwork', 'Morning work routine', 'Morning Big Time work routine'], ['r-morning', 'Morning routine', 'Morning Preparation'], ['r-prework', 'Before work', 'Before work routine']]
      for (const [id, was, now] of renames) {
        p.routines = (p.routines ?? []).map((r) => (r.id === id && r.title === was ? { ...r, title: now } : r))
        const hid = (p.routines ?? []).find((r) => r.id === id)?.habitId
        p.habits = (p.habits ?? []).map((h) => ((h.id === hid || h.id === id.replace(/^r-/, 'h-')) && h.name === was ? { ...h, name: now } : h))
      }
    }

    /* Forward-fill fields added after this state was saved, so an existing
       install picks up new wiring (habit frequencies, habit-linked goals)
       without losing anything he has logged. Only ever fills a blank. */
    const seedH = new Map(MOCK_HABITS.map((h) => [h.id, h]))
    p.habits = p.habits.map((h) => {
      const s = seedH.get(h.id)
      return s ? { ...h, frequency: h.frequency ?? s.frequency, targetPerWeek: h.targetPerWeek ?? s.targetPerWeek } : h
    })
    // A seeded habit added later is missing entirely; append it rather than reseed.
    const removed = new Set(p.removedSeeds ?? [])
    for (const s of MOCK_HABITS) if (!removed.has(s.id) && !p.habits.some((h) => h.id === s.id)) p.habits.push(s)
    /* Same for a seeded ROUTINE added after this state was saved. Routines are
       his once they exist, so the loader hands his own list straight back and a
       new seed would otherwise only ever appear on a fresh install, which is
       exactly how the renamed evening routine went missing. Appending one row
       adds nothing to what he has already written, and a routine he deleted is
       in removedSeeds, so this cannot resurrect it. */
    p.routines = p.routines ?? []
    for (const s of MOCK_ROUTINES) if (!removed.has(s.id) && !p.routines.some((r) => r.id === s.id)) p.routines.push(s)

    /* Asked for again. The loader is right never to resurrect a routine on its
       own, so a routine deleted months ago stays deleted, and one of these was
       missing from his own state for exactly that reason. But him naming it
       again is not the same as never having deleted it: these four he asked for
       by name on 2026-08-02, so each comes back once with its habit, its
       deletion mark cleared, and behaves like any other seeded row afterwards.
       A routine still present is not touched. */
    if (!p.removedSeeds?.includes('fix:asked-again-2026-08-02')) {
      p.removedSeeds = [...(p.removedSeeds ?? []), 'fix:asked-again-2026-08-02']
      for (const id of ['r-prework', 'r-morningwork', 'r-nightwork', 'r-invoicing']) {
        const seed = MOCK_ROUTINES.find((r) => r.id === id)
        if (!seed || p.routines.some((r) => r.id === id)) continue
        p.removedSeeds = p.removedSeeds.filter((m) => m !== id && m !== seed.habitId)
        p.routines.push(seed)
        const h = MOCK_HABITS.find((x) => x.id === seed.habitId)
        if (h && !p.habits.some((x) => x.id === h.id)) p.habits.push(h)
      }
    }

    /* A step added to a seeded routine after this state was saved has to reach
       it, and a whole-list seed cannot do that once the routine has any steps at
       all. So each seeded step is handed over ONCE, at the position it holds in
       the seed, and the fact that it was handed over is remembered. Delete it
       afterwards and it stays deleted, which is the whole point of the marker:
       the app fills gaps, it does not overrule him. */
    p.removedSeeds = p.removedSeeds ?? []
    for (const s of MOCK_ROUTINES) {
      if (!s.steps.length) continue
      const mine = p.routines.find((r) => r.id === s.id)
      if (!mine) continue
      const block = `${s.id}:steps`
      /* The whole list, once, and only while he has written none of his own. */
      if (mine.steps.length === 0 && !p.removedSeeds.includes(block)) {
        p.routines = p.routines.map((r) => (r.id === s.id ? { ...r, steps: s.steps } : r))
        p.removedSeeds.push(block, ...s.steps.map((st) => `${s.id}:step:${st.id}`))
        continue
      }
      /* Into a list he already has, only a step that was added after that list
         was delivered, at the position it holds in the seed. Everything else was
         handed over long ago, so its absence means he deleted it. */
      let steps = mine.steps
      s.steps.forEach((st, i) => {
        const mark = `${s.id}:step:${st.id}`
        if (!LATE_STEPS.has(st.id) || p.removedSeeds!.includes(mark) || steps.some((x) => x.id === st.id)) return
        steps = [...steps.slice(0, i), st, ...steps.slice(i)]
        p.removedSeeds!.push(mark)
      })
      if (steps !== mine.steps) p.routines = p.routines.map((r) => (r.id === s.id ? { ...r, steps } : r))
    }

    /* Wiring a step gained after his list was saved: a habit it keeps, or the
       fact that it is optional. Steps are his, so this fills a blank and never
       overwrites, reaching the rows he already has without touching a word of
       what they say. */
    for (const s of MOCK_ROUTINES) {
      const seeded = new Map(s.steps.map((st) => [st.id, st]))
      p.routines = p.routines.map((r) => (r.id !== s.id ? r : {
        ...r,
        steps: r.steps.map((st) => {
          const from = seeded.get(st.id)
          if (!from) return st
          return {
            ...st,
            habitId: st.habitId ?? from.habitId,
            optional: st.optional ?? from.optional,
          }
        }),
      }))
    }

    /* A seeded step that has since MOVED in the seed. Order is his the moment he
       touches it, so this runs once and then never again: the marker is what
       stops a step he has deliberately dragged elsewhere from being pulled back
       into place on every reload. */
    const moves: [string, string, number][] = [['r-brainrot', 'br-ice', 0]]
    for (const [rid, sid, to] of moves) {
      const mark = `${rid}:step:${sid}:at${to}`
      if (p.removedSeeds.includes(mark)) continue
      p.removedSeeds.push(mark)
      p.routines = p.routines.map((r) => {
        if (r.id !== rid) return r
        const step = r.steps.find((x) => x.id === sid)
        if (!step) return r
        const rest = r.steps.filter((x) => x.id !== sid)
        return { ...r, steps: [...rest.slice(0, to), step, ...rest.slice(to)] }
      })
    }

    /* A day that has not happened yet cannot be done. Future ticks were also
       unreachable, since those dots are disabled, so they could never be undone. */
    const todayIdx = (new Date().getDay() + 6) % 7
    p.habits = p.habits.map((h) => ({ ...h, days: h.days.map((d, i) => (i > todayIdx ? false : d)) }))

    /* A habit a routine drives is a read-out of that routine, and its dots are
       not clickable, so a wrong value there can never be corrected by hand. It
       is therefore re-derived on every load, from HIS routines. It used to read
       LATE_STEPS,
  MOCK_ROUTINES, which meant the moment he wrote his own steps the mock's
       list (empty, for four of them) decided the answer: the tick was wiped on
       the next reload, or asserted for a routine he had not finished. */
    const savedRoutines = p.routines ?? []
    const drivenNow = new Map(
      /* A step-less routine owns nothing yet: its habit is hand-ticked until
         steps exist, and this pass must not wipe those ticks on every load. */
      savedRoutines.filter((r) => r.habitId && !r.archivedAt && r.steps.length > 0).map((r) => {
        const complete = routineComplete(r, periodKeyFor(r.cadence))
        return [r.habitId as string, { complete, on: complete ? (r.completedOn ?? localDateKey()) : null }]
      }),
    )
    const seededPastCleared = p.fixes ?? 0
    const thisWeek = isoWeekKey()
    p.habits = p.habits.map((h) => {
      const d = drivenNow.get(h.id)
      if (!d) return h
      /* The tick belongs to the day it was earned, not to today. A weekly
         routine finished on Tuesday keeps Tuesday's dot for the rest of the
         week, and loses THAT dot when it is undone on Friday. */
      const idx = d.on && isoWeekKey(new Date(d.on)) === thisWeek ? dayIndexOf(d.on) : null
      const days = h.days.map((day, i) => {
        if (!d.complete) return seededPastCleared >= 1 && i !== todayIdx ? day : false
        /* The real completion day may not be in THIS week at all: a monthly
           routine finished early in the month stays complete for weeks after,
           and there is no day in a 7-slot week to honestly place that on.
           Forcing today's dot here used to be the fallback, which is why a
           monthly review read as "done today" on every day it was reopened.
           keptThisPeriod (types.ts) is what now tells weekly/monthly consumers
           it is kept; this array only ever states a real day. */
        return idx !== null ? i === idx : day
      })
      return { ...h, days }
    })
    p.fixes = 1

    /* A goal already linked to a time habit was filed in 'checkoffs' before
       hours existed. The unit follows what the habit actually measures. */
    p.goals = (p.goals ?? []).map((g) => {
      const h = g.habitId ? (p.habits ?? []).find((x) => x.id === g.habitId) : undefined
      return h && isTimeFed(h) && g.unit === 'checkoffs' ? { ...g, unit: 'hours' } : g
    })

    const seedG = new Map(MOCK_GOALS.map((g) => [g.id, g]))
    p.goals = p.goals.map((g) => {
      const s = seedG.get(g.id)
      return s?.habitId && !g.habitId ? { ...g, habitId: s.habitId, unit: s.unit } : g
    })

    /* THE MERGE, on his instruction 2026-08-11: "routines and habits are
       basically the same thing. Routines are just a folder of different
       habits. Each item in the routine will be a new habit."

       A routine keeps its row and becomes the FOLDER. Every step it held
       becomes a real habit pointing back at it, carrying the things a step
       had and a habit did not: the description, the external link (the typing
       test, a video), the in-app page, optional, the either-or choice, a
       timer's length.

       History is not reset. Every dated step tick becomes a dated habit tick
       for the habit that step turned into, so a streak he has already earned
       is the streak he keeps. That is the whole reason this was safe to do.

       Runs once, and the untouched blob is already in BACKUP_KEY above. */
    if (!p.removedSeeds.includes('fix:habits-folders')) {
      p.removedSeeds.push('fix:habits-folders')
      const merged = foldersFromRoutines(p.routines ?? [], p.habits ?? [], p.stepTicks ?? [])
      p.habits = merged.habits
      /* Never a duplicate: a tick for this habit on this day already existing
         means the merge has partly run before, and his own tick wins. */
      const seen = new Set((p.habitLog ?? []).map((t) => `${t.habitId}|${t.day}`))
      p.habitLog = [...(p.habitLog ?? []), ...merged.ticks.filter((t) => !seen.has(`${t.habitId}|${t.day}`))]
    }

    /* The merge above shipped before the habits carried everything their steps
       could DO: which step they came from, so a number they record joins the
       series the step already writes, and the two bodies the app builds fresh
       each morning. Anyone who ran the first pass has habits without those, so
       the same function runs again and fills only what is missing. Habits only,
       because the ticks were already taken across. */
    /* Goals predate having an age at all. Stamped once, at the day this build
       first reads them, rather than back-dated: the app does not know when they
       were set and guessing would put a number on screen that is not true.
       The clock starts now, and says so. */
    if (!p.removedSeeds.includes('fix:goal-age')) {
      p.removedSeeds.push('fix:goal-age')
      const today = localDateKey()
      p.goals = (p.goals ?? []).map((g) => ({
        ...g,
        createdAt: g.createdAt ?? today,
        touchedAt: g.touchedAt ?? today,
      }))
    }

    if (!p.removedSeeds.includes('fix:habit-runners')) {
      p.removedSeeds.push('fix:habit-runners')
      p.habits = foldersFromRoutines(p.routines ?? [], p.habits ?? [], []).habits
    }
    return p
  } catch {
    return null
  }
}

/* One route carries an argument: a past day. '#/day/2026-07-14' is a real
   address, so a date anywhere in the app can simply link to the day it names. */
function routeFromHash(): { page: PageId; day: string | null } {
  const h = location.hash.replace('#/', '')
  const m = h.match(/^day\/(\d{4}-\d{2}-\d{2})$/)
  if (m) return { page: 'day', day: m[1] }
  // The board's old address still resolves: a bookmark lands on its successor.
  if (h === 'braindump') return { page: 'notes', day: null }
  /* Achievements, Money, Reflect and Brand & guidelines were removed (the
     last on his instruction, 2026-09-06: a design-system reference nobody
     consults from the app itself). Their addresses land on Today rather than
     on nothing, the same courtesy braindump gets above. */
  if (h === 'achievements' || h === 'money' || h === 'review' || h === 'stats' || h === 'brand') return { page: 'today', day: null }
  const pages: PageId[] = ['today', 'plan', 'projects', 'habits', 'routines', 'goals', 'quitting', 'settings', 'notes', 'bills', 'focus', 'board', 'zone', 'apps', 'calendar', 'assistant', 'timeline', 'contacts', 'skills', 'health', 'watchless']
  return { page: (pages as string[]).includes(h) ? (h as PageId) : 'today', day: null }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const persisted = useMemo(loadPersisted, [])
  const widgetsSlice = useWidgetsSlice(persisted)
  const { spaces, setSpaces } = widgetsSlice
  const [storageFull, setStorageFull] = useState(false)
  const [ledger, setLedger] = useState(persisted?.ledger ?? MOCK_LEDGER)
  const connectionsSlice = useConnectionsSlice(persisted)
  const { social, setSocial, sources, setSources, toggleSource, ideas, setIdeas } = connectionsSlice
  const coachSlice = useCoachSlice(persisted)
  const { coachSessions, setCoachSessions } = coachSlice
  const [focusSessions, setFocusSessions] = useState<FocusSession[]>(persisted?.focusSessions ?? [])
  /* What he deliberately deleted. Every collection is united across devices
     now, so a row missing here is only "not seen yet" unless something says
     otherwise: this is that something. Without it, deleting a task on the
     laptop lets any phone that still holds the row put it back. */
  /* An empty link is a removal, not a blank entry, so the key does not linger
     and win a merge against a device that still holds the real one. */
  const twoLivesSlice = useTwoLivesSlice(persisted)
  const { twoLives, setTwoLivesRaw, setTwoLives, reels, setReelsRaw, setReels } = twoLivesSlice
  const [spaceGuessed] = useState<number>(persisted?.spaceGuessed ?? 0)
  const [lastRollDay] = useState<string | undefined>(persisted?.lastRollDay)
  const remoteSaveTimer = useRef<number | undefined>(undefined)
  const latestJson = useRef<string>('')
  /* Where the copy on screen last came from, when that was somewhere else.
     Deliberately NOT persisted: it answers "did my phone's edit land here yet",
     which is a question about this device right now, and a stored answer would
     survive into a session where it is no longer true.

     It is set when a change actually arrives from another device and cleared
     the moment he edits anything here, so the topbar reads "updated from your
     iPhone" until he writes something himself, then goes back to plain. */
  const [syncOrigin, setSyncOrigin] = useState<{ name: string; at: number } | null>(null)
  /* Set by applyExternal so the save effect it triggers can tell "this arrived
     from elsewhere" from "he typed something", which look identical from inside
     a state update. */
  const fromExternal = useRef(false)
  /* The view and the write-space survive a reload, kept out of the synced blob on
     purpose so working on the phone does not flip the desktop. All is the default:
     the whole point is that nothing hides in a profile he did not open. */
  const [view, setViewState] = useState<ViewId>(() => {
    try {
      const v = localStorage.getItem('mc-view')
      return v === 'work' || v === 'offplate' || v === 'personal' || v === 'corner' || v === 'all' ? v : 'all'
    } catch { return 'all' }
  })
  const [writeSpace, setWriteSpace] = useState<SpaceId>(() => {
    try {
      const s = localStorage.getItem('mc-space')
      return s === 'work' || s === 'offplate' || s === 'personal' || s === 'corner' ? s : 'personal'
    } catch { return 'personal' }
  })
  // In a single space, new things land there. In All he picks, and the pick sticks.
  const space: SpaceId = isSpace(view) ? view : writeSpace
  const [route, setRoute] = useState(routeFromHash)
  const { page, day: dayKey } = route
  const setPageState = (p: PageId) => setRoute({ page: p, day: null })
  /* Undo and the graveyard are genuinely cross-domain -- every slice that
     deletes something calls armUndo/bury/digUp -- so they are composed in
     here, ahead of the domains that need them, rather than owned by any
     one of those domains. */
  const { undoable, armUndo, undoDelete, dismissUndo } = useUndo()
  const { graveyard, setGraveyard, bury, digUp } = useGraveyard(persisted?.graveyard)
  const notesSlice = useNotesSlice(persisted, { space, armUndo, bury, digUp })
  const { notes, setNotes, noteFolders, setNoteFolders } = notesSlice
  const contactsSlice = useContactsSlice(persisted, { armUndo, bury, digUp })
  const { contacts, setContacts, contactActivity, setContactActivity } = contactsSlice
  const growthSlice = useGrowthSlice(persisted, { space, armUndo, bury, digUp, setPageState })
  const {
    habits, setHabits, goals, setGoals, routines, setRoutines,
    records, setRecords, removedSeeds, setRemovedSeeds,
    habitLog, setHabitLog, routineLog, setRoutineLog, slips, setSlips,
    stepLog, setStepLog, dayLog, setDayLog, stepTicks, setStepTicks,
    dailyOpen, dailyDone, setDailyDone, dailySkipped, setDailySkipped, plan, setPlan, review, setReview,
  } = growthSlice
  const [openProjectId, setOpenProject] = useState<string | null>(null)
  const plannerSlice = usePlannerSlice(persisted, { armUndo, bury, digUp, openProjectId, setOpenProject, setPlan })
  const { tasks, setTasks, projects, setProjects } = plannerSlice
  const assistantSlice = useAssistantSlice(persisted, { space, setTasks, setGoals })
  const { assistantLog, setAssistantLog, applyDictation, revertAssistantItem } = assistantSlice
  const setSpace = (s: SpaceId) => setWriteSpace(s)
  const setView = (v: ViewId) => { setViewState(v); if (isSpace(v)) setWriteSpace(v); setOpenProject(null) }
  /* A record belongs to exactly one space. The old form treated a space-less row
     as belonging to all three at once, so the same ledger row was counted in
     Personal AND Work AND Off-Plate and every time-saved figure was wrong. Rows
     written before spaces existed are stamped on load instead. */
  const inView = (s?: SpaceId) => view === 'all' || s === view
  const [editing, setEditing] = useState(false)
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null)
  const [focusRoutineId, setFocusRoutineId] = useState<string | null>(null)
  const [focusAppId, setFocusAppId] = useState<string | null>(null)
  const [noteToOpen, setNoteToOpen] = useState<string | null>(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-space', view)
    try {
      localStorage.setItem('mc-view', view)
      localStorage.setItem('mc-space', writeSpace)
    } catch { /* noop */ }
  }, [view, writeSpace])

  /* Date watcher: if the app sits open across midnight (or a laptop wakes up
     the next morning), reload once so routines, habits and "today" all roll
     over to the new day instead of showing yesterday frozen in place.

     Only while the tab is actually VISIBLE. His report (2026-09-06): away
     since Friday, opened Sunday, no "3 things came back" banner. The interval
     used to fire unconditionally, so the desktop build sitting open and
     backgrounded over the weekend reloaded itself at Saturday's midnight with
     nobody looking, ran roll() right then, and stamped plan.returnedOn to
     Saturday. By Sunday that record no longer matched today and the banner
     (gated on returnedOn === today, on his instruction: said once, on the day
     it happened) stayed silent -- correctly silent about a day he never saw.
     Gating the reload on visibility means a backgrounded app does nothing at
     midnight; roll() only runs once, when he actually looks, spanning the
     whole gap in one pass and landing the banner on the day he is there for
     it. An app that is genuinely open and visible across midnight is
     unaffected -- the interval still catches it within the minute. */
  useEffect(() => {
    const bootDay = localDateKey()
    const check = () => { if (document.visibilityState === 'visible' && localDateKey() !== bootDay) location.reload() }
    const t = window.setInterval(check, 60_000)
    document.addEventListener('visibilitychange', check)
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', check) }
  }, [])

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const setPage = (p: PageId) => {
    /* Every tab in the nav is a top-level destination, Plan included: the ONLY
       way into a project's Plan is enterProject, below. Without this, clicking
       Plan while standing inside a project did nothing (already on 'plan'),
       which read as the nav lying about where he was and left no fast way out. */
    setOpenProject(null)
    location.hash = `/${p}`
    setRoute({ page: p, day: null })
    window.scrollTo({ top: 0 })
  }
  /** The one door into a project's Plan. Order matters: setPage clears
   *  openProjectId as part of leaving wherever he was, so the id has to be set
   *  AFTER, not before, or it would be wiped by its own navigation. */
  const enterProject = (id: string) => {
    setPage('plan')
    setOpenProject(id)
  }
  /** Open one day of the record. Today goes to Today, which is the live one. */
  const openDay = (iso: string) => {
    if (iso === todayKey()) { setPage('today'); return }
    location.hash = `/day/${iso}`
    setRoute({ page: 'day', day: iso })
    window.scrollTo({ top: 0 })
  }

  useEffect(() => {
    // Refuse to write over state a newer build saved.
    if (futureBlob) return

    const state: PersistedState = {
      version: 3, spaces, tasks, habits, goals, projects, contacts, contactActivity, ledger, social, sources, plan, review, assistantLog, coachSessions, routines, ideas,
      notes, noteFolders,
      savedAt: Date.now(), lastWrite: { dev: deviceId(), name: deviceName(), at: Date.now() },
      weekKey: isoWeekKey(), records, fixes: 1, schema: STORAGE_KEY, removedSeeds, focusSessions,
      habitLog, routineLog, slips, stepLog, stepTicks, dayLog, dailyDone, dailySkipped, spaceGuessed, graveyard, twoLives, reels, lastRollDay: lastRollDay ?? localDateKey(),
    }
    const json = JSON.stringify(state)
    /* His own writing is the one thing that makes "updated from your iPhone"
       stale, so it is what takes the line down. The save that applyExternal
       itself triggers is not his writing, and says so through the flag. */
    if (fromExternal.current) fromExternal.current = false
    else setSyncOrigin(null)
    latestJson.current = json
    try {
      localStorage.setItem(STORAGE_KEY, json)
      if (storageFull) setStorageFull(false)
    } catch {
      /* This used to be swallowed. With Supabase off, a full quota means every edit from here on
         is lost on reload and nothing on screen says so. Measured after importing one city of
         leads: the state and its backup mirror together reach 3.8 MB of a ~5.2 MB quota, so this
         is a reachable state rather than a theoretical one. */
      if (!storageFull) setStorageFull(true)
    }
    /* Mirror to Supabase when configured, debounced so rapid edits collapse into
       one write. The outbox owns the write from here: a failure is retried on a
       backoff and on reconnect rather than dropped, and the intent to sync is
       persisted so quitting while offline does not lose it. */
    if (SUPABASE_ENABLED) {
      window.clearTimeout(remoteSaveTimer.current)
      remoteSaveTimer.current = window.setTimeout(() => { outbox.push(json) }, 800)
    }
  }, [spaces, tasks, habits, goals, projects, contacts, contactActivity, ledger, social, sources, plan, review, assistantLog, coachSessions, routines, ideas, notes, noteFolders, records, removedSeeds, focusSessions, habitLog, routineLog, slips, stepLog, stepTicks, dayLog, dailyDone, dailySkipped, graveyard, twoLives, reels])

  /* ---- state that arrived from somewhere else ----
     Another tab of this browser, or this account on another device. Merged in,
     never pasted over: what is in memory here is one side of the merge and his
     work on this device survives it. Applying it makes the save effect fire,
     which is how the merged truth goes back out to everyone. */
  const applyExternal = (incoming: string) => {
    const mine = latestJson.current || localStorage.getItem(STORAGE_KEY) || ''
    if (!incoming || incoming === mine) return
    const merged = mine ? mergeStates(mine, incoming) : incoming
    let p: PersistedState
    try { p = JSON.parse(merged) as PersistedState } catch { return }
    if (p.schema !== STORAGE_KEY) return
    /* Nothing new once the dates are set aside: stop, or two tabs would answer
       each other's saves forever. */
    if (mine && stripDates(merged) === stripDates(mine)) return
    /* Something genuinely arrived. Read the stamp off the INCOMING blob rather
       than the merged one: the merge keeps the newer side's stamp, which on a
       pull that this device wins is this device, and "updated from the Mac" is
       not news to the Mac. */
    try {
      const inc = JSON.parse(incoming) as PersistedState
      const w = inc.lastWrite
      if (w && w.dev && w.dev !== deviceId()) setSyncOrigin({ name: w.name, at: w.at })
    } catch { /* a stamp is a nicety; never let it stop the merge */ }
    fromExternal.current = true
    if (p.tasks) setTasks(p.tasks)
    if (p.habits) setHabits(p.habits)
    if (p.goals) setGoals(p.goals)
    if (p.projects) setProjects(p.projects)
    if (p.contacts) setContacts(p.contacts)
    if (p.contactActivity) setContactActivity(p.contactActivity)
    if (p.routines) setRoutines(p.routines)
    if (p.ideas) setIdeas(p.ideas)
    /* Arrays, not truthiness: deleting the last note on the other device has to
       arrive here too, and an empty array is a real answer. */
    if (Array.isArray(p.notes)) setNotes(p.notes)
    if (Array.isArray(p.noteFolders)) setNoteFolders(p.noteFolders)
    if (p.ledger) setLedger(p.ledger)
    if (p.focusSessions) setFocusSessions(p.focusSessions)
    if (p.habitLog) setHabitLog(p.habitLog)
    if (p.routineLog) setRoutineLog(p.routineLog)
    if (p.slips) setSlips(p.slips)
    if (p.stepLog) setStepLog(p.stepLog)
    if (p.dayLog) setDayLog(p.dayLog)
    if (Array.isArray(p.stepTicks)) setStepTicks(p.stepTicks)
    /* The latest day either way: a review walked on the phone must not be
       re-offered on the laptop, and a skip must not undo a walk. */
    if (p.dailyDone && (!dailyDone || p.dailyDone > dailyDone)) setDailyDone(p.dailyDone)
    if (p.dailySkipped && (!dailySkipped || p.dailySkipped > dailySkipped)) setDailySkipped(p.dailySkipped)
    if (p.coachSessions) setCoachSessions(p.coachSessions)
    if (p.assistantLog) setAssistantLog(p.assistantLog)
    if (p.spaces) setSpaces(p.spaces)
    if (p.plan) setPlan(p.plan)
    if (p.review) setReview(p.review)
    if (p.records) setRecords(p.records)
    if (p.removedSeeds) setRemovedSeeds(p.removedSeeds)
    if (p.graveyard) setGraveyard(p.graveyard)
    if (p.twoLives) setTwoLivesRaw(p.twoLives)
    /* An array, not truthiness: clearing the library on one device has to
       arrive here too, and an empty list is a real answer. */
    if (Array.isArray(p.reels)) setReelsRaw(p.reels)
  }
  /* applyExternal itself is a plain closure rebuilt every render (it reads
     dailyDone/dailySkipped by value, not by ref) but the two effects below
     now mount once and never rebuild. Route them through a ref that's kept
     current every render, so they always call this render's applyExternal
     instead of freezing the one from mount. */
  const applyExternalRef = useRef(applyExternal)
  applyExternalRef.current = applyExternal

  /* Another tab of the same browser. It writes localStorage; this fires there
     and nowhere else, which is exactly the signal needed.

     Empty deps on purpose: this listener is registered once, for the life of
     the provider. It used to have no deps array at all, which meant React
     tore it down and re-added it on every render -- harmless here since
     addEventListener is idempotent per-instance, but see the pull effect
     below for why that pattern is not always free. */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue || futureBlob) return
      applyExternalRef.current(e.newValue)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  /* Another device. A tab left open all afternoon held a copy of the morning
     and would eventually push it; now it catches up whenever he looks at it,
     and once a minute while he is looking.

     Found 2026-09-04: this had no deps array, so StoreProvider re-rendering
     for ANY reason (every keystroke in a note, every habit tick) tore the
     interval down and started a fresh one -- the 60s pull almost never
     survived long enough to fire, and the in-flight pull's result was
     discarded by the `if (stop) return` on teardown. Empty deps now, so this
     sets up exactly once. futureBlob can flip true after mount (loading a
     blob from a newer app version), so it's checked fresh inside pull()
     itself rather than only once here at setup. */
  useEffect(() => {
    if (!SUPABASE_ENABLED) return
    let stop = false
    const pull = async () => {
      if (futureBlob || document.visibilityState !== 'visible') return
      const remote = await loadRemoteState()
      if (stop) return
      if (remote) applyExternalRef.current(remote)
      /* And the other direction. Without this, work done offline never leaves the
         device: applyExternal finds local is already a superset of the stale
         remote, changes no state, and so never fires the save effect. The device
         stayed correct and the server stayed behind, silently, until he happened
         to edit something else while connected. */
      const mine = latestJson.current
      if (!mine) return
      const united = remote ? mergeStates(mine, remote) : mine
      if (!remote || stripDates(united) !== stripDates(remote)) outbox.push(mine)
    }
    const onWake = () => { void pull() }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)
    const id = window.setInterval(onWake, 60000)
    return () => {
      stop = true
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('focus', onWake)
      window.clearInterval(id)
    }
  }, [])

  /* The auto pass follows the sessions: history that predates the rule, blocks
     edited elsewhere, or a merge that brought rows back all resolve on the next
     change, not only on the next visit. Idempotent, so re-running is free. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { autoFrom(focusSessions, 0) }, [focusSessions])

  /* Closing the tab inside the debounce window must not lose the last change:
     flush the pending remote write the moment the page starts hiding. */
  useEffect(() => {
    if (!SUPABASE_ENABLED) return
    const flush = () => {
      if (remoteSaveTimer.current !== undefined && latestJson.current) {
        window.clearTimeout(remoteSaveTimer.current)
        remoteSaveTimer.current = undefined
        outbox.push(latestJson.current)
      }
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
    return () => window.removeEventListener('pagehide', flush)
  }, [])

  /* Demo pretends today is Sunday when the real weekday is irrelevant;
     habits use the real weekday so checking off feels true. */
  const todayIndex = (new Date().getDay() + 6) % 7

  /* "This week" means this week: only rows from the current ISO week count, and
     only from the profile you are looking at. Rows seeded by the demo carry no
     week/space and are treated as this week's so the demo still shows numbers.
     Net, including overruns; the headline equals the sum of the visible rows. */
  const weekLedger = ledger.filter(
    (e) => (!e.weekKey || e.weekKey === isoWeekKey()) && inView(e.space),
  )
  const savedMin = weekLedger.reduce((acc, e) => acc + (e.estimateMin - e.actualMin), 0)
  const accuracyPct = Math.round(
    (weekLedger.filter((e) => Math.abs(e.actualMin - e.estimateMin) <= e.estimateMin * 0.25).length /
      Math.max(1, weekLedger.length)) * 100,
  )

  /* A habit the app keeps for him. Focus minutes are already measured, so a
     habit that only says "did you focus for an hour" should never need a tick:
     it reads the total and answers itself. `extra` is the block currently on the
     clock, because an hour that is still running is still an hour. The rule runs
     over every day in the record, so correcting or deleting a block takes back a
     day it no longer earns. */
  const autoFrom = (sessions: FocusSession[], extra: number, extraLabel?: string) => {
    // Declared below in this scope; only ever CALLED after both exist.
    const extraSpace = extra > 0 ? spaceOfLabel(extraLabel) : null
    const today = todayKey()
    const rules = habits.filter((h) => h.auto?.from === 'focus' && !h.archivedAt)
    if (!rules.length) return
    const days = new Set(sessions.map((s) => s.day))
    days.add(today)
    let next = habitLog
    for (const h of rules) {
      const src = `auto:focus:${h.id}`
      for (const day of days) {
        const mins = sessions.filter((s) => s.day === day && s.space === h.space).reduce((a, s) => a + s.minutes, 0)
          + (day === today && extraSpace === h.space ? extra : 0)
        const has = next.some((t) => t.habitId === h.id && t.day === day && t.src === src)
        const earns = mins >= (h.auto?.minutes ?? 60)
        if (earns && !has) next = [...next, { habitId: h.id, day, src, at: day === today ? new Date().toISOString() : undefined }]
        if (!earns && has) next = next.filter((t) => !(t.habitId === h.id && t.day === day && t.src === src))
      }
    }
    if (next === habitLog) return
    setHabitLog(next)
    const idx = (new Date().getDay() + 6) % 7
    setHabits((prev) => prev.map((h) => (rules.some((r) => r.id === h.id)
      ? { ...h, days: h.days.map((d, i) => (i === idx ? next.some((t) => t.habitId === h.id && t.day === today) : d)) }
      : h)))
  }

  /* One writer for finished focus, whatever day it belongs to. A block that
     crosses midnight banks its first half onto yesterday through this exact
     path, so both halves look identical to everything downstream. */
  /* Which workspace a block's WORK belongs to: the task it names, wherever he
     happened to be standing when the timer rang. Big Time work done while the
     app showed Personal is still Big Time work. */
  const spaceOfLabel = (label?: string): SpaceId => {
    if (label) {
      const want = label.trim().toLowerCase()
      const t = tasks.find((x) => x.title.trim().toLowerCase() === want)
      if (t) return t.space
      const holder = tasks.find((x) => x.subtasks?.some((st) => st.title.trim().toLowerCase() === want))
      if (holder) return holder.space
    }
    return space
  }

  const logFocusOn = (day: string, minutes: number, label?: string, at?: string) => {
    if (minutes <= 0) return
    const mins = Math.round(minutes)
    const lid = newId('l')
    const next = [{ id: newId('f'), day, minutes: mins, label, space: spaceOfLabel(label), ledgerId: lid, at: at ?? new Date().toISOString() }, ...focusSessions]
    setFocusSessions(next)
    setLedger((prev) => [
      { id: lid, title: label ? `Focus: ${label}` : 'Focus block', category: 'deep' as TaskCategory,
        estimateMin: mins, actualMin: mins, when: day, space, weekKey: isoWeekKey(new Date(`${day}T12:00:00`)) },
      ...prev,
    ])
    autoFrom(next, 0)
  }

  const value: Store = {
    version: 3,
    spaces, tasks, habits, goals, projects, contacts, contactActivity, storageFull, ledger, social, sources, plan, review, routines, ideas,
    openProjectId, setOpenProject, enterProject,
    addProject: plannerSlice.addProject,
    renameProject: plannerSlice.renameProject,
    deleteProject: plannerSlice.deleteProject,
    setTaskProject: plannerSlice.setTaskProject,
    addContact: contactsSlice.addContact, updateContact: contactsSlice.updateContact, deleteContact: contactsSlice.deleteContact,
    logContactActivity: contactsSlice.logContactActivity, deleteContactActivity: contactsSlice.deleteContactActivity,
    focusSessions, habitLog, routineLog, slips, stepLog, stepTicks, dayLog,
    view, setView, inView,
    twoLives, setTwoLives, reels, setReels,
    /* A finished block is recorded once, and everything that cares reads from
       here: measured habits fill from it, and the ledger gets it so focus time
       counts toward estimate accuracy instead of vanishing. */
    logFocus: (minutes, label) => logFocusOn(todayKey(), minutes, label, new Date().toISOString()),
    logFocusOn,
    updateFocus: (id, patch) => {
      const next = focusSessions.map((f) => (f.id === id
        ? { ...f, ...(patch.minutes !== undefined ? { minutes: Math.max(1, Math.round(patch.minutes)) } : {}), ...(patch.label !== undefined ? { label: patch.label } : {}) }
        : f))
      setFocusSessions(next)
      const f = next.find((x) => x.id === id)
      // The ledger row is the same block seen from the other side; keep them equal.
      if (f?.ledgerId) {
        setLedger((prev) => prev.map((l) => (l.id === f.ledgerId
          ? { ...l, estimateMin: f.minutes, actualMin: f.minutes, title: f.label ? `Focus: ${f.label}` : 'Focus block' }
          : l)))
      }
      autoFrom(next, 0)
    },
    deleteFocus: (id) => {
      const gone = focusSessions.find((f) => f.id === id)
      const beforeF = focusSessions, beforeL = ledger, beforeH = habitLog
      const keys = [rowKey('focusSessions', { id }), ...(gone?.ledgerId ? [rowKey('ledger', { id: gone.ledgerId })] : [])]
      armUndo(gone ? `Removed a ${gone.minutes}m focus block` : 'Focus block removed', () => {
        setFocusSessions(beforeF); setLedger(beforeL); setHabitLog(beforeH); digUp(...keys)
      })
      const next = focusSessions.filter((f) => f.id !== id)
      setFocusSessions(next)
      bury(...keys)
      if (gone?.ledgerId) setLedger((prev) => prev.filter((l) => l.id !== gone.ledgerId))
      autoFrom(next, 0)
    },
    syncAutoHabits: (extraMin = 0, label) => autoFrom(focusSessions, extraMin, label),
    space, setSpace,
    page, setPage, dayKey, openDay,
    editing, setEditing,
    focusTaskId, setFocusTaskId,
    focusRoutineId, setFocusRoutineId,
    focusAppId, setFocusAppId,
    noteToOpen, openNote: setNoteToOpen,

    reorderSpace: widgetsSlice.reorderSpace,
    resizeWidget: widgetsSlice.resizeWidget,
    removeWidget: widgetsSlice.removeWidget,
    addWidget: widgetsSlice.addWidget,
    moveWidget: widgetsSlice.moveWidget,

    toggleTask: plannerSlice.toggleTask,
    updateTask: plannerSlice.updateTask,

    logActual: (id, actualMin) => {
      const t = tasks.find((x) => x.id === id)
      setTasks((prev) => prev.map((x) => (x.id === id
        ? { ...x, done: true, doneAt: x.doneAt ?? new Date().toISOString(), actualMin, subtasks: x.subtasks?.map((sub) => ({ ...sub, done: true })) }
        : x)))
      if (t && t.actualMin === undefined) {
        const lid = newId('l')
        setLedger((prev) => [
          { id: lid, title: t.title, category: t.category, estimateMin: t.estimateMin, actualMin, when: todayKey(), space: t.space, weekKey: isoWeekKey() },
          ...prev,
        ])
        /* Real time on a task is real time whether or not the Pomodoro timer
           ran for it. His report: he often works a task with Focus never
           started, then logs the true minutes when he ticks it off, and
           every counter that reads focusSessions -- Today, the measured
           habits, Goals fed by one -- was blind to that time because this
           path never wrote one. Sharing lid keeps the block attached to the
           same ledger row logActual already writes, rather than a second,
           orphaned one. */
        const next = [{ id: newId('f'), day: todayKey(), minutes: actualMin, label: t.title, space: t.space, ledgerId: lid, at: new Date().toISOString() }, ...focusSessions]
        setFocusSessions(next)
        autoFrom(next, 0)
      }
    },

    addTask: plannerSlice.addTask,
    addTasks: plannerSlice.addTasks,
    addTaskWithSubtasks: plannerSlice.addTaskWithSubtasks,
    commitTask: plannerSlice.commitTask,
    moveTaskList: plannerSlice.moveTaskList,
    moveTasksToToday: plannerSlice.moveTasksToToday,
    assignSlot: plannerSlice.assignSlot,
    setTaskAt: plannerSlice.setTaskAt,
    updateSubtask: plannerSlice.updateSubtask,
    deleteSubtask: plannerSlice.deleteSubtask,
    toggleSubtask: plannerSlice.toggleSubtask,
    /* Logging the LAST subtask closes the parent task and writes one ledger row
       for the whole thing, so subtasked work reaches Review the same as flat work. */
    logSubtaskActual: (taskId, subId, actualMin) => {
      const parent = tasks.find((x) => x.id === taskId)
      const subs = (parent?.subtasks ?? []).map((s) => (s.id === subId ? { ...s, done: true, actualMin } : s))
      const allDone = subs.length > 0 && subs.every((s) => s.done)
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId && t.subtasks
          ? { ...t, subtasks: subs, done: allDone || t.done, doneAt: allDone && !t.done ? new Date().toISOString() : t.doneAt }
          : t)),
      )
      if (parent && allDone && !parent.done) {
        const est = subs.reduce((a, s) => a + s.estimateMin, 0)
        const act = subs.reduce((a, s) => a + (s.actualMin ?? s.estimateMin), 0)
        const lid = newId('l')
        setLedger((prev) => [
          { id: lid, title: parent.title, category: parent.category, estimateMin: est, actualMin: act, when: todayKey(), space: parent.space, weekKey: isoWeekKey() },
          ...prev,
        ])
        /* Same as the flat-task path in logActual: the steps' real minutes
           count as focus even when Focus was never started for them. */
        const next = [{ id: newId('f'), day: todayKey(), minutes: act, label: parent.title, space: parent.space, ledgerId: lid, at: new Date().toISOString() }, ...focusSessions]
        setFocusSessions(next)
        autoFrom(next, 0)
      }
    },
    deleteTask: plannerSlice.deleteTask,
    setSubtasks: plannerSlice.setSubtasks,
    setEstimate: plannerSlice.setEstimate,

    /* Both of these write the dated log first: that is the record that survives
       the week rolling over. days[] is a cache of the current week and is kept in
       step here, and rebuilt from the log on every load. */
    assertRoutineDay: growthSlice.assertRoutineDay,
    toggleHabitDay: growthSlice.toggleHabitDay,
    markHabitDay: growthSlice.markHabitDay,
    markHabitDayOn: growthSlice.markHabitDayOn,
    markHabitDaysOn: growthSlice.markHabitDaysOn,
    logHabitNumber: growthSlice.logHabitNumber,
    pickHabitAlt: growthSlice.pickHabitAlt,
    dailyDone,
    dailySkipped,
    dailyOpen,
    openDaily: growthSlice.openDaily,
    closeDaily: growthSlice.closeDaily,
    markHabitOn: growthSlice.markHabitOn,
    assertRoutineOn: growthSlice.assertRoutineOn,
    logSlipOn: growthSlice.logSlipOn,
    addHabit: growthSlice.addHabit,
    logSlip: growthSlice.logSlip,
    updateHabit: growthSlice.updateHabit,
    togglePauseHabit: growthSlice.togglePauseHabit,
    deleteHabit: growthSlice.deleteHabit,

    addGoal: growthSlice.addGoal,
    repeatGoal: growthSlice.repeatGoal,
    updateGoal: growthSlice.updateGoal,
    bumpGoal: growthSlice.bumpGoal,
    toggleGoalMilestone: growthSlice.toggleGoalMilestone,
    deleteGoal: growthSlice.deleteGoal,

    setSocial,
    toggleSource,

    commitPlan: (taskIds, firstMoveId) => {
      setTasks((prev) =>
        prev.map((t) =>
          t.space !== space ? t : {
            ...t,
            list: taskIds.includes(t.id) ? 'today' : t.done ? t.list : 'backlog',
            plannedOn: taskIds.includes(t.id) ? todayKey() : t.done ? t.plannedOn : undefined,
          },
        ),
      )
      setPlan({ committedDate: todayKey(), firstMoveId })
    },


    assistantLog,
    applyDictation,
    revertAssistantItem,

    coachSessions,
    toggleRoutineStep: growthSlice.toggleRoutineStep,
    toggleRoutineAlt: growthSlice.toggleRoutineAlt,
    records,
    setStepData: growthSlice.setStepData,
    addRoutine: growthSlice.addRoutine,
    updateRoutine: growthSlice.updateRoutine,
    deleteRoutine: growthSlice.deleteRoutine,
    addRoutineStep: growthSlice.addRoutineStep,
    updateRoutineStep: growthSlice.updateRoutineStep,
    deleteRoutineStep: growthSlice.deleteRoutineStep,
    moveRoutineStep: growthSlice.moveRoutineStep,
    logCount: growthSlice.logCount,
    startAgain: growthSlice.startAgain,
    planRoutine: growthSlice.planRoutine,
    setRoutineDone: growthSlice.setRoutineDone,

    syncOrigin,
    notes, noteFolders,
    addNote: notesSlice.addNote, updateNote: notesSlice.updateNote, setNoteDone: notesSlice.setNoteDone,
    moveNote: notesSlice.moveNote, deleteNote: notesSlice.deleteNote,
    keepNoteConflict: notesSlice.keepNoteConflict, dropNoteConflict: notesSlice.dropNoteConflict,
    addNoteFolder: notesSlice.addNoteFolder, renameNoteFolder: notesSlice.renameNoteFolder,
    deleteNoteFolder: notesSlice.deleteNoteFolder, renameNoteTag: notesSlice.renameNoteTag,

    undoable, undoDelete, dismissUndo,

    todayIndex,
    weekLedger,
    savedMin,
    accuracyPct,
    resetDemo: () => {
      // Cancel any pending mirror first, or it would rewrite the row we just deleted.
      window.clearTimeout(remoteSaveTimer.current)
      remoteSaveTimer.current = undefined
      try { localStorage.removeItem(STORAGE_KEY) } catch { /* noop */ }
      const finish = () => { location.hash = ''; location.reload() }
      if (SUPABASE_ENABLED) { void deleteRemoteState().finally(finish) } else finish()
    },
  }

  return <Ctx.Provider value={value}>{children}<UndoToast /></Ctx.Provider>
}

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore outside provider')
  return s
}

/* The bar that lets a delete be taken back. It sits above the tab bar on the
   phone and clear of the Pomodoro badge on the desktop, and it goes away by
   itself after ten seconds, which is long enough to notice and act. */
function UndoToast() {
  const { undoable, undoDelete, dismissUndo } = useStore()
  useEffect(() => {
    if (!undoable) return
    const t = window.setTimeout(dismissUndo, 10000)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoable?.id])
  if (!undoable) return null
  return (
    <div className="undo-bar" role="status">
      <span className="undo-what">{undoable.label}</span>
      <button className="undo-do" onClick={undoDelete}>Undo</button>
      <button className="undo-x" onClick={dismissUndo} aria-label="Dismiss">✕</button>
    </div>
  )
}
