import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SUPABASE_ENABLED, deleteRemoteState, loadRemoteState, saveRemoteState } from './supabase'
import { roll } from './roll'
import { bodyHash, mergeStates, rowKey, type Tomb } from './sync-merge'
import { dayIndexOf, dayOfWeekKey, goalPeriodKey, goalPeriodRange, isoWeekKey, localDateKey, periodIsPast, periodKeyFor, slotForTime, type GoalTf } from './util'
import {
  DEFAULT_SPACES,
  MOCK_GOALS,
  MOCK_HABITS,
  MOCK_IDEAS,
  MOCK_LEDGER,
  LATE_STEPS,
  MOCK_ROUTINES,
  MOCK_SOCIAL,
  MOCK_SOURCES,
  MOCK_TASKS,
  WIDGET_DEFS,
} from './mock'
import { goalCurrent, isTimeFed, requiredSteps, routineComplete, stepLocked } from './types'
import { isSpace, SPACES, spaceFolderId } from './types'
import type {
  ViewId,
  FocusSession,
  HabitSlip,
  HabitTick,
  RoutineDone,
  StepEntry,
  RoutineCadence,
  AssistantEntry,
  CoachFacts,
  CoachSession,
  Goal,
  Idea,
  Note,
  NoteFolder,
  Routine,
  HabitDef,
  LedgerEntry,
  PageId,
  PlanState,
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
  /** The last day the rollover ran. Everything after it is unsealed. */
  lastRollDay?: string
  /** How many rows had no space and were filed as Personal on migration. */
  spaceGuessed?: number
  /** Keys of rows deliberately deleted, so a merge cannot resurrect them. */
  graveyard?: Tomb[]
}

/** A delete you can still take back: what it was, and how to put it back. */
export interface Undoable { id: string; label: string; restore: () => void }

interface Store extends PersistedState {
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
  /** The day being looked back at, when the route names one. */
  dayKey: string | null
  openDay: (iso: string) => void
  editing: boolean
  setEditing: (v: boolean) => void
  focusTaskId: string | null
  setFocusTaskId: (id: string | null) => void
  coachOpen: string | null
  setCoachOpen: (id: string | null) => void

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
  addTask: (t: Omit<Task, 'id' | 'done'>) => void
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

  toggleHabitDay: (id: string, day: number) => void
  /** Assert or retract a PAST day of a routine-driven habit by hand. The
   *  routine owns today; the record of a day already gone is his to correct,
   *  because a lost write must never be a permanent lie. */
  assertRoutineDay: (habitId: string, dayIndex: number) => void
  markHabitDay: (id: string, day: number, value: boolean) => void
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
  repeatGoal: (id: string) => void

  setSocial: (entries: SocialEntry[]) => void
  toggleSource: (id: string) => void

  commitPlan: (taskIds: string[], firstMoveId: string | null) => void
  /** Close a window: any range, one act. Its outcomes land in the backlog. */
  closeReview: (window: { id: string; label: string; from: string; to: string }, wins: string[], outcomes: string[], drifted?: string) => void

  assistantLog: AssistantEntry[]
  applyDictation: (text: string, items: { kind: 'task' | 'goal' | 'done'; text: string; estimateMin?: number }[]) => void
  revertAssistantItem: (entryId: string, itemId: string) => void

  coachSessions: CoachSession[]
  startCoachSession: (input: { title: string; facts: CoachFacts; firstStep: string; firstStepMin: number; category: TaskCategory }) => void
  reflectCoachSession: (id: string, didIt: boolean, felt: CoachSession['felt'], reflection: string) => void
  deleteCoachSession: (id: string) => void

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

  /* ---- Notes ----
     The folder is the note's address and its workspace both: move a note into
     another workspace's folder and it changes workspace, because two places
     recording the same fact is how they end up disagreeing. */
  notes: Note[]
  noteFolders: NoteFolder[]
  /** Makes an empty note in that folder and hands back its id to open. */
  addNote: (folderId: string, body?: string) => string
  updateNote: (id: string, patch: Partial<Pick<Note, 'title' | 'body' | 'color' | 'pinned'>>) => void
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

    /* The two review steps learn to open Reflect. The step is his once it
       exists, so the seed cannot reach it; this adds the pointer without
       touching his words, and runs once. */
    if (!p.removedSeeds.includes('fix:review-goto')) {
      p.removedSeeds.push('fix:review-goto')
      const GOTO: Record<string, { goto: 'review'; gotoLabel: string }> = {
        wr2: { goto: 'review', gotoLabel: 'Open last week in Reflect' },
        mo0: { goto: 'review', gotoLabel: 'Open the month in Reflect' },
      }
      p.routines = (p.routines ?? []).map((r) => (r.id !== 'r-weekly' && r.id !== 'r-monthly' ? r : {
        ...r,
        steps: r.steps.map((st) => (GOTO[st.id] && !st.goto ? { ...st, ...GOTO[st.id] } : st)),
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
        if (idx !== null) return i === idx
        return i === todayIdx
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
  const pages: PageId[] = ['today', 'plan', 'assistant', 'habits', 'routines', 'goals', 'money', 'review', 'coach', 'stats', 'settings', 'brand', 'notes', 'focus', 'calendar', 'board']
  return { page: (pages as string[]).includes(h) ? (h as PageId) : 'today', day: null }
}

/* The first line of a note is its title, the way it is in every notes app worth
   using: no second field to fill in, nothing to keep in step with the text, and
   an untitled note is simply one whose first line is short. Cached on the row so
   the list and the search do not re-derive it for every note on every keystroke. */
function noteTitle(body: string): string {
  const first = body.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? ''
  return first.replace(/^#{1,3}\s+/, '').replace(/^[-*]\s+(\[[ xX]\]\s*)?/, '').slice(0, 120)
}

/** Which workspace a folder belongs to. A workspace folder says so in its id;
 *  one he made says so on the row. Either way there is one answer, and a note's
 *  workspace is read from here rather than being a second thing to keep in step. */
function spaceOfFolder(id: string, folders: NoteFolder[]): SpaceId | null {
  const m = id.match(/^nf-space-(.+)$/)
  if (m && (SPACES as string[]).includes(m[1])) return m[1] as SpaceId
  return folders.find((f) => f.id === id)?.space ?? null
}

/* What a profile that has never saved anything starts with. The seeded stickies
   become notes on exactly the terms the migration uses, so a fresh install and a
   migrated one are the same shape. */
function seedNoteFolders(): NoteFolder[] {
  const spaces = [...new Set(MOCK_IDEAS.map((i) => i.space))]
  return spaces.map((s) => ({ id: `nf-braindump-${s}`, space: s, name: 'Brain dumps', parentId: spaceFolderId(s), order: 0 }))
}

function seedNotes(): Note[] {
  return MOCK_IDEAS.map((i) => ({
    id: `note-${i.id}`,
    space: i.space,
    folderId: `nf-braindump-${i.space}`,
    title: noteTitle(i.text),
    body: i.text,
    color: i.color,
    when: localDateKey(),
    updatedAt: Date.now(),
  }))
}

/* Ids must survive reloads without colliding: a plain counter restarts at the
   same numbers and duplicates ids already persisted (then one delete removes
   two rows). Time-based prefix + burst counter is collision-proof. */
let seq = 0
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}`
const todayKey = () => localDateKey()

export function StoreProvider({ children }: { children: ReactNode }) {
  const persisted = useMemo(loadPersisted, [])
  const seedTodayIdx = (new Date().getDay() + 6) % 7
  /* Seed: past days keep the mock pattern, future days are empty. Today starts
     UNCHECKED for any habit a routine mirrors, so the two pages never disagree
     on a fresh load: you earn today by running the routine. */
  const seededHabits = useMemo(() => {
    const mirrored = new Set(MOCK_ROUTINES.map((r) => r.habitId).filter(Boolean) as string[])
    return MOCK_HABITS.map((h) => ({
      ...h,
      days: h.days.map((d, i) => (i > seedTodayIdx ? false : i === seedTodayIdx && mirrored.has(h.id) ? false : d)),
    }))
  }, [seedTodayIdx])
  const seededGoals = MOCK_GOALS
  // Routine step definitions come from the mock (canonical); only the user's checks
  // (doneStepIds) are their state, so new/removed steps show up without a reseed.
  // Checks carry the period they were made in (day / week / month); a check from
  // an earlier period is dropped, so routines reset themselves on schedule.
  /* Routines are his once they exist: the mock only seeds an empty install. This
     used to be the other way round, rebuilding every routine from the mock on
     each load, which threw away any step he wrote the moment he reloaded.
     Checks carry the period they were made in; one from an earlier period is
     dropped, so a routine resets itself on schedule. */
  const seededRoutines = useMemo(() => {
    const prior = persisted?.routines
    const base = prior && prior.length ? prior : MOCK_ROUTINES
    return base.map((r) => {
      const key = periodKeyFor(r.cadence)
      // A new period starts nothing: the checks, the choices and the moment it
      // was started all belong to the period they were made in.
      if (r.periodKey !== key) return { ...r, doneStepIds: [], stepData: {}, stepChoice: {}, startedAt: undefined, run: 0, periodKey: key }
      const doneStepIds = r.doneStepIds.filter((id) => r.steps.some((st) => st.id === id))
      return {
        ...r,
        doneStepIds,
        stepData: r.stepData ?? {},
        stepChoice: r.stepChoice ?? {},
        // A routine whose every tick was deleted with its steps is not underway.
        startedAt: doneStepIds.length ? r.startedAt : undefined,
        periodKey: key,
      }
    })
  }, [persisted])
  const [spaces, setSpaces] = useState(persisted?.spaces ?? DEFAULT_SPACES)
  const [tasks, setTasks] = useState(persisted?.tasks ?? MOCK_TASKS)
  const [habits, setHabits] = useState(persisted?.habits ?? seededHabits)
  const [goals, setGoals] = useState(persisted?.goals ?? seededGoals)
  const [ledger, setLedger] = useState(persisted?.ledger ?? MOCK_LEDGER)
  const [social, setSocialState] = useState(persisted?.social ?? MOCK_SOCIAL)
  const [sources, setSources] = useState(persisted?.sources ?? MOCK_SOURCES)
  const [plan, setPlan] = useState<PlanState>(persisted?.plan ?? { committedDate: null, firstMoveId: null })
  const [review, setReview] = useState<ReviewState>(persisted?.review ?? { lastDoneDate: null, wins: [], outcomes: [] })
  const [assistantLog, setAssistantLog] = useState<AssistantEntry[]>(persisted?.assistantLog ?? [])
  const [coachSessions, setCoachSessions] = useState<CoachSession[]>(persisted?.coachSessions ?? [])
  const [routines, setRoutines] = useState<Routine[]>(seededRoutines)
  const [ideas, setIdeas] = useState<Idea[]>(persisted?.ideas ?? MOCK_IDEAS)
  /* A fresh profile has never run the migration, so the seeded stickies are
     turned into notes here on the same terms: same folder, same text. */
  const [notes, setNotes] = useState<Note[]>(persisted?.notes ?? seedNotes())
  const [noteFolders, setNoteFolders] = useState<NoteFolder[]>(persisted?.noteFolders ?? seedNoteFolders())
  const [records, setRecords] = useState<Record<string, number>>(persisted?.records ?? {})
  // Seeded ids he has deleted, so the forward-fill never resurrects them.
  const [removedSeeds, setRemovedSeeds] = useState<string[]>(persisted?.removedSeeds ?? [])
  const [focusSessions, setFocusSessions] = useState<FocusSession[]>(persisted?.focusSessions ?? [])
  const [habitLog, setHabitLog] = useState<HabitTick[]>(persisted?.habitLog ?? [])
  const [routineLog, setRoutineLog] = useState<RoutineDone[]>(persisted?.routineLog ?? [])
  const [slips, setSlips] = useState<HabitSlip[]>(persisted?.slips ?? [])
  const [stepLog, setStepLog] = useState<StepEntry[]>(persisted?.stepLog ?? [])
  /* What he deliberately deleted. Every collection is united across devices
     now, so a row missing here is only "not seen yet" unless something says
     otherwise: this is that something. Without it, deleting a task on the
     laptop lets any phone that still holds the row put it back. */
  const [graveyard, setGraveyard] = useState<Tomb[]>(persisted?.graveyard ?? [])
  const bury = (...keys: string[]) =>
    setGraveyard((g) => [...g.filter((t) => !keys.includes(t.k)), ...keys.map((k) => ({ k, at: Date.now() }))].slice(-900))
  /* Not a removal: a dated opposite. Another device that still holds the
     tombstone would otherwise re-bury this the next time it saved anything. */
  const digUp = (...keys: string[]) =>
    setGraveyard((g) => [...g.filter((t) => !keys.includes(t.k)), ...keys.map((k) => ({ k, at: Date.now(), undone: true }))].slice(-900))
  const [spaceGuessed] = useState<number>(persisted?.spaceGuessed ?? 0)
  const [lastRollDay] = useState<string | undefined>(persisted?.lastRollDay)
  /* The last thing you deleted, held long enough to take it back. Deliberately
     not persisted: a delete you can still undo after a reload is not a delete. */
  const [undoable, setUndoable] = useState<Undoable | null>(null)
  const remoteSaveTimer = useRef<number | undefined>(undefined)
  const latestJson = useRef<string>('')
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
  const setSpace = (s: SpaceId) => setWriteSpace(s)
  const setView = (v: ViewId) => { setViewState(v); if (isSpace(v)) setWriteSpace(v) }
  /* A record belongs to exactly one space. The old form treated a space-less row
     as belonging to all three at once, so the same ledger row was counted in
     Personal AND Work AND Off-Plate and every time-saved figure was wrong. Rows
     written before spaces existed are stamped on load instead. */
  const inView = (s?: SpaceId) => view === 'all' || s === view
  const [route, setRoute] = useState(routeFromHash)
  const { page, day: dayKey } = route
  const setPageState = (p: PageId) => setRoute({ page: p, day: null })
  const [editing, setEditing] = useState(false)
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null)
  const [coachOpen, setCoachOpen] = useState<string | null>(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-space', view)
    try {
      localStorage.setItem('mc-view', view)
      localStorage.setItem('mc-space', writeSpace)
    } catch { /* noop */ }
  }, [view, writeSpace])

  /* Date watcher: if the app sits open across midnight (or a laptop wakes up
     the next morning), reload once so routines, habits and "today" all roll
     over to the new day instead of showing yesterday frozen in place. */
  useEffect(() => {
    const bootDay = localDateKey()
    const check = () => { if (localDateKey() !== bootDay) location.reload() }
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
    location.hash = `/${p}`
    setRoute({ page: p, day: null })
    window.scrollTo({ top: 0 })
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
      version: 3, spaces, tasks, habits, goals, ledger, social, sources, plan, review, assistantLog, coachSessions, routines, ideas,
      notes, noteFolders,
      savedAt: Date.now(), weekKey: isoWeekKey(), records, fixes: 1, schema: STORAGE_KEY, removedSeeds, focusSessions,
      habitLog, routineLog, slips, stepLog, spaceGuessed, graveyard, lastRollDay: lastRollDay ?? localDateKey(),
    }
    const json = JSON.stringify(state)
    latestJson.current = json
    try {
      localStorage.setItem(STORAGE_KEY, json)
    } catch {
      /* localStorage full or unavailable; Supabase (if configured) is the source of truth */
    }
    // Mirror to Supabase when configured, debounced so rapid edits collapse into one write.
    if (SUPABASE_ENABLED) {
      window.clearTimeout(remoteSaveTimer.current)
      remoteSaveTimer.current = window.setTimeout(() => { void saveRemoteState(json) }, 800)
    }
  }, [spaces, tasks, habits, goals, ledger, social, sources, plan, review, assistantLog, coachSessions, routines, ideas, notes, noteFolders, records, removedSeeds, focusSessions, habitLog, routineLog, slips, stepLog, graveyard])

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
    const strip = (j: string) => { try { const o = JSON.parse(j) as Record<string, unknown>; delete o.savedAt; return JSON.stringify(o) } catch { return j } }
    if (mine && strip(merged) === strip(mine)) return
    if (p.tasks) setTasks(p.tasks)
    if (p.habits) setHabits(p.habits)
    if (p.goals) setGoals(p.goals)
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
    if (p.coachSessions) setCoachSessions(p.coachSessions)
    if (p.assistantLog) setAssistantLog(p.assistantLog)
    if (p.spaces) setSpaces(p.spaces)
    if (p.plan) setPlan(p.plan)
    if (p.review) setReview(p.review)
    if (p.records) setRecords(p.records)
    if (p.removedSeeds) setRemovedSeeds(p.removedSeeds)
    if (p.graveyard) setGraveyard(p.graveyard)
  }

  /* Another tab of the same browser. It writes localStorage; this fires there
     and nowhere else, which is exactly the signal needed. */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue || futureBlob) return
      applyExternal(e.newValue)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  })

  /* Another device. A tab left open all afternoon held a copy of the morning
     and would eventually push it; now it catches up whenever he looks at it,
     and once a minute while he is looking. */
  useEffect(() => {
    if (!SUPABASE_ENABLED || futureBlob) return
    let stop = false
    const pull = async () => {
      if (document.visibilityState !== 'visible') return
      const remote = await loadRemoteState()
      if (!stop && remote) applyExternal(remote)
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
  })

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
        void saveRemoteState(latestJson.current)
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

  /* A counted habit is logged one tap at a time: three walks on Tuesday are
     three rows, not one day ticked. Taking one back removes the most recent row
     rather than the day, because the day may still hold two more. */
  const logCount = (habitId: string, delta: 1 | -1) => {
    const day = todayKey()
    const idx = (new Date().getDay() + 6) % 7
    let next = habitLog
    if (delta === 1) {
      next = [...habitLog, { habitId, day, src: `count#${Date.now()}${Math.round(performance.now())}`, at: new Date().toISOString() }]
    } else {
      const mine = habitLog.filter((t) => t.habitId === habitId && t.day === day)
      const last = mine[mine.length - 1]
      if (!last) return
      const at = habitLog.lastIndexOf(last)
      next = [...habitLog.slice(0, at), ...habitLog.slice(at + 1)]
    }
    setHabitLog(next)
    const held = next.some((t) => t.habitId === habitId && t.day === day)
    setHabits((prev) => prev.map((h) => (h.id === habitId
      ? { ...h, days: h.days.map((d, i) => (i === idx ? held : d)) }
      : h)))
  }

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

  /* The hand-correction path for a routine-kept day. Writes BOTH records, the
     habit row and the routine's own finish, so the calendar, the goals and the
     day page agree with the dot. */
  const assertRoutineDay = (habitId: string, dayIndex: number) => {
    const day = dayOfWeekKey(dayIndex)
    if (day >= todayKey()) return
    const r = routines.find((x) => x.habitId === habitId && !x.archivedAt)
    const has = habitLog.some((t) => t.habitId === habitId && t.day === day)
    markDay(habitId, dayIndex, !has)
    if (!r) return
    const pk = r.cadence === 'weekly' ? isoWeekKey(new Date(`${day}T12:00:00`))
      : r.cadence === 'monthly' ? day.slice(0, 7) : day
    setRoutineLog((prev) => (has
      ? prev.filter((x) => !(x.routineId === r.id && x.day === day))
      : [...prev, { routineId: r.id, day, periodKey: pk, run: 0 }]))
  }

  /* "I have been keeping this since June" is a claim about days, so it is
     written as days: every day from the start to YESTERDAY is marked kept, in
     the log and in this week's cache. Today is deliberately left alone, because
     a habit added this morning has not been done yet and a green dot for it
     would be a lie. A day he already has a row for is never touched, so this
     cannot double-tick, cannot overwrite a day he corrected by hand, and running
     it twice changes nothing. */
  const backfillKept = (habitId: string, from?: string, until?: string) => {
    const today = todayKey()
    const stop = until && until < today ? until : today
    if (!from || from >= stop) return
    const have = new Set(habitLog.filter((t) => t.habitId === habitId).map((t) => t.day))
    const rows: HabitTick[] = []
    const cursor = new Date(`${from}T12:00:00`)
    const end = new Date(`${stop}T12:00:00`)
    if (Number.isNaN(cursor.getTime())) return
    while (cursor < end) {
      const key = localDateKey(cursor)
      if (!have.has(key)) rows.push({ habitId, day: key, src: 'since' })
      cursor.setDate(cursor.getDate() + 1)
    }
    const filled = new Set(rows.map((r) => r.day))
    if (rows.length) setHabitLog((prev) => [...prev, ...rows])
    setHabits((prev) => prev.map((h) => (h.id !== habitId ? h : {
      ...h,
      // The date is now accounted for, whether or not it needed any new rows.
      filledSince: from,
      days: h.days.map((v, i) => v || filled.has(dayOfWeekKey(i))),
    })))
  }

  /** Tick or untick one day of one habit, in the log and in the week cache. */
  const markDay = (habitId: string, dayIndex: number, value: boolean) => {
    const day = dayOfWeekKey(dayIndex)
    setHabitLog((prev) => {
      const without = prev.filter((t) => !(t.habitId === habitId && t.day === day))
      return value ? [...without, { habitId, day, at: day === todayKey() ? new Date().toISOString() : undefined }] : without
    })
    setHabits((prev) => prev.map((h) => (h.id === habitId
      ? { ...h, days: h.days.map((d, i) => (i === dayIndex ? value : d)) }
      : h)))
  }

  /* A habit kept by a routine STEP rather than by a whole routine. Each step
     writes its own row for the day, so meditating in the morning routine and
     again inside Out Brain Rot leaves two rows: the day stays kept while either
     is ticked, undoing one does not undo the other, and the number of rows is
     how often he actually did it. */
  const syncStepHabits = (changes: { habitId: string; src: string; on: boolean }[]) => {
    if (!changes.length) return
    const day = todayKey()
    /* Applied as one batch rather than one call per step: ticking a whole
       routine changes several steps in a single event, and one-at-a-time each
       would compute its result from the same stale log and undo the last. */
    let next = habitLog
    for (const c of changes) {
      next = next.filter((t) => !(t.habitId === c.habitId && t.day === day && t.src === c.src))
      if (c.on) next = [...next, { habitId: c.habitId, day, src: c.src, at: new Date().toISOString() }]
    }
    setHabitLog(next)
    const idx = (new Date().getDay() + 6) % 7
    const held = new Map(changes.map((c) => [c.habitId, next.some((t) => t.habitId === c.habitId && t.day === day)]))
    setHabits((prev) => prev.map((h) => (held.has(h.id)
      ? { ...h, days: h.days.map((d, i) => (i === idx ? held.get(h.id)! : d)) }
      : h)))
  }

  /* A routine reaches his day by being started, not by existing. The first tick
     stamps the moment, and that moment decides which part of the day it files
     itself under. Ticking a second step must not move it, so the stamp is only
     ever written when there is none. Undoing back to nothing ticked takes the
     stamp away again: a routine he opened and closed was not started. */
  const stamped = (r: Routine): Routine => ({
    ...r,
    startedAt: r.doneStepIds.length === 0 ? undefined : (r.startedAt ?? new Date().toISOString()),
  })

  /* Apply a change to a routine and re-derive its habit from the result. The
     tick is written to the day it was earned and cleared from that same day, so
     a weekly routine undone three days later does not clear the wrong dot. */
  const applyRoutine = (routineId: string, change: (r: Routine) => Routine) => {
    const before = routines.find((x) => x.id === routineId)
    if (!before) return
    const after = change(before)
    const key = periodKeyFor(after.cadence)
    const wasComplete = routineComplete(before, periodKeyFor(before.cadence))
    const isComplete = routineComplete(after, key)
    const completedOn = isComplete ? (wasComplete ? before.completedOn ?? todayKey() : todayKey()) : null
    setRoutines((prev) => prev.map((x) => (x.id === routineId ? { ...after, periodKey: key, completedOn } : x)))

    /* A step that keeps a habit reports itself on every toggle, not only when
       the routine as a whole flips: meditation counts the moment he meditates,
       whatever the other four steps are doing. */
    syncStepHabits(after.steps.flatMap((st) => {
      if (!st.habitId) return []
      const was = before.doneStepIds.includes(st.id)
      const is = after.doneStepIds.includes(st.id)
      return was === is ? [] : [{ habitId: st.habitId, src: `${routineId}:${st.id}#${after.run ?? 0}`, on: is }]
    }))

    if (wasComplete === isComplete) return

    /* Which day this routine was finished, kept for good. completedOn holds only
       the most recent one, so on its own it could never answer "which day did I
       do it" for any day but the last.

       Rows are keyed by the RUN they belong to, not by the period. Finishing a
       repeatable routine a second time therefore adds a second row instead of
       replacing the first, and undoing the run he is in cannot reach the runs he
       already finished. */
    const run = after.run ?? 0
    setRoutineLog((prev) => {
      const without = prev.filter((r) => !(r.routineId === routineId && r.periodKey === key && (r.run ?? 0) === run))
      return isComplete
        ? [...without, { routineId, day: todayKey(), periodKey: key, run, at: new Date().toISOString() }]
        : without
    })

    if (!before.habitId) return
    const hid = before.habitId
    const clearIdx = before.completedOn && isoWeekKey(new Date(before.completedOn)) === isoWeekKey()
      ? dayIndexOf(before.completedOn)
      : todayIndex
    /* An earlier run of this period still counts. Undoing the run in progress
       must not take back a routine he genuinely finished this morning. */
    const earlier = routineLog.some((r) => r.routineId === routineId && r.periodKey === key && (r.run ?? 0) !== run)
    // Through markDay, so a routine-driven tick lands in the durable log too.
    markDay(hid, isComplete ? todayIndex : clearIdx, isComplete || earlier)
  }

  /* Arming an undo replaces whatever was armed before: one step back, not a
     history. The window is generous because a delete you notice a beat late is
     exactly the one worth taking back. */
  const armUndo = (label: string, restore: () => void) => setUndoable({ id: newId('u'), label, restore })

  const value: Store = {
    version: 3,
    spaces, tasks, habits, goals, ledger, social, sources, plan, review, routines, ideas,
    focusSessions, habitLog, routineLog, slips, stepLog,
    view, setView, inView,
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
    coachOpen, setCoachOpen,

    reorderSpace: (sp, order) =>
      setSpaces((prev) => {
        const byId = new Map(prev[sp].map((w) => [w.id, w]))
        const next = order.map((id) => byId.get(id)).filter(Boolean) as WidgetInstance[]
        for (const w of prev[sp]) if (!order.includes(w.id)) next.push(w)
        return { ...prev, [sp]: next }
      }),

    resizeWidget: (sp, id, size) =>
      setSpaces((prev) => ({ ...prev, [sp]: prev[sp].map((w) => (w.id === id ? { ...w, size } : w)) })),

    removeWidget: (sp, id) =>
      setSpaces((prev) => ({ ...prev, [sp]: prev[sp].filter((w) => w.id !== id) })),

    addWidget: (sp, type) =>
      setSpaces((prev) => ({
        ...prev,
        [sp]: [...prev[sp], { id: newId(type), type, size: WIDGET_DEFS[type].defaultSize }],
      })),

    moveWidget: (sp, id, dir) =>
      setSpaces((prev) => {
        const list = [...prev[sp]]
        const i = list.findIndex((w) => w.id === id)
        const j = i + dir
        if (i < 0 || j < 0 || j >= list.length) return prev
        ;[list[i], list[j]] = [list[j], list[i]]
        return { ...prev, [sp]: list }
      }),

    /* Reopening a task clears the time that was logged against it, so "skip"
       genuinely means no time recorded instead of resurfacing an old number. */
    /* A task with steps is done when you say it is done, so its steps go with it.
       Leaving them unticked underneath a finished parent was the app disagreeing
       with itself. Reopening puts them all back. */
    toggleTask: (id) =>
      setTasks((prev) => prev.map((t) => {
        if (t.id !== id) return t
        const done = !t.done
        return {
          ...t,
          done,
          // Finishing is a moment, and the calendar wants to know which one.
          doneAt: done ? new Date().toISOString() : undefined,
          actualMin: t.done ? undefined : t.actualMin,
          subtasks: t.subtasks?.map((sub) => ({ ...sub, done, actualMin: done ? sub.actualMin : undefined })),
        }
      })),
    updateTask: (id, patch) =>
      setTasks((prev) => prev.map((t) => {
        if (t.id !== id) return t
        const title = patch.title !== undefined && patch.title.trim() ? patch.title.trim() : t.title
        // A breakdown owns the estimate; a bare number only applies without one.
        const est = patch.estimateMin !== undefined && !t.subtasks?.length
          ? { estimateMin: Math.max(1, Math.round(patch.estimateMin)), estimated: true }
          : {}
        return { ...t, title, ...est }
      })),

    logActual: (id, actualMin) => {
      const t = tasks.find((x) => x.id === id)
      setTasks((prev) => prev.map((x) => (x.id === id
        ? { ...x, done: true, doneAt: x.doneAt ?? new Date().toISOString(), actualMin, subtasks: x.subtasks?.map((sub) => ({ ...sub, done: true })) }
        : x)))
      if (t && t.actualMin === undefined) {
        setLedger((prev) => [
          { id: newId('l'), title: t.title, category: t.category, estimateMin: t.estimateMin, actualMin, when: todayKey(), space: t.space, weekKey: isoWeekKey() },
          ...prev,
        ])
      }
    },

    addTask: (t) => setTasks((prev) => [{ ...t, id: newId('t'), done: false, createdAt: todayKey() }, ...prev]),
    addTasks: (ts) =>
      setTasks((prev) => [...ts.map((t) => ({ ...t, id: newId('t'), done: false, createdAt: todayKey() })), ...prev]),
    addTaskWithSubtasks: (parent, subs) =>
      setTasks((prev) => {
        const pid = newId('t')
        const subtasks = subs.map((sub, i) => ({ id: `${pid}s${i}`, title: sub.title, estimateMin: sub.estimateMin, done: false }))
        const est = subtasks.reduce((a, s) => a + s.estimateMin, 0)
        return [{ ...parent, id: pid, done: false, createdAt: todayKey(), estimateMin: est, estimated: true, subtasks }, ...prev]
      }),
    commitTask: (id, horizon, key) =>
      setTasks((prev) => prev.map((t) => (t.id === id
        ? {
          ...t,
          horizon,
          horizonKey: horizon ? (key ?? goalPeriodKey(horizon as GoalTf)) : undefined,
        }
        : t))),
    moveTaskList: (id, list, day) =>
      setTasks((prev) => prev.map((t) => (t.id === id
        ? { ...t, list, plannedOn: list === 'today' ? (day ?? todayKey()) : undefined }
        : t))),
    moveTasksToToday: (ids, day) =>
      setTasks((prev) => prev.map((t) => (ids.includes(t.id) ? { ...t, list: 'today', slot: undefined, plannedOn: day ?? todayKey() } : t))),
    assignSlot: (id, slot) =>
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, slot } : t))),
    /* A clock time implies a part of the day, so setting one moves the task into
       the matching bucket. Leaving them free to disagree meant a task could read
       9 AM on the schedule and sit under Evening in the list. */
    /* Giving a task a time puts it on today. TAKING the time away must not:
       "Back to the list" clears the time as part of sending a task away, and
       this forced list back to 'today' every time, so the task never left. */
    setTaskAt: (id, at) =>
      setTasks((prev) => prev.map((t) => {
        if (t.id !== id) return t
        if (!at) return { ...t, at: undefined }
        return { ...t, at, list: 'today' as const, plannedOn: t.plannedOn ?? todayKey(), slot: slotForTime(at) }
      })),
    /* A breakdown is generated, so it is a first draft: wrong wording, wrong
       minutes, sometimes a step that is not his at all. Both edits re-derive the
       parent's estimate, because with a breakdown present the parent's number IS
       the sum of its steps, and leaving it stale would quietly misreport the day. */
    updateSubtask: (taskId, subId, patch) =>
      setTasks((prev) => prev.map((t) => {
        if (t.id !== taskId || !t.subtasks) return t
        const subtasks = t.subtasks.map((s) => (s.id === subId
          ? { ...s, ...(patch.title !== undefined ? { title: patch.title } : {}), ...(patch.estimateMin !== undefined ? { estimateMin: Math.max(1, patch.estimateMin) } : {}) }
          : s))
        return { ...t, subtasks, estimateMin: subtasks.reduce((a, s) => a + s.estimateMin, 0), estimated: true }
      })),
    deleteSubtask: (taskId, subId) => {
      const before = tasks
      const t = tasks.find((x) => x.id === taskId)
      const gone = t?.subtasks?.find((s) => s.id === subId)
      armUndo(gone ? `Removed "${gone.title}"` : 'Step removed', () => setTasks(before))
      setTasks((prev) => prev.map((x) => {
        if (x.id !== taskId || !x.subtasks) return x
        const subtasks = x.subtasks.filter((s) => s.id !== subId)
        /* The last step going leaves a plain task. Its estimate came from the
           steps, so with none left the number is whatever the final step
           happened to be, which is not the size of the task: keep it as a
           starting point but stop calling it an estimate. */
        if (!subtasks.length) return { ...x, subtasks: undefined, estimated: false }
        return { ...x, subtasks, estimateMin: subtasks.reduce((a, s) => a + s.estimateMin, 0), estimated: true }
      }))
    },
    toggleSubtask: (taskId, subId) =>
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId && t.subtasks
            ? { ...t, subtasks: t.subtasks.map((s) => (s.id === subId ? { ...s, done: !s.done, actualMin: s.done ? undefined : s.actualMin } : s)) }
            : t,
        ),
      ),
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
        setLedger((prev) => [
          { id: newId('l'), title: parent.title, category: parent.category, estimateMin: est, actualMin: act, when: todayKey(), space: parent.space, weekKey: isoWeekKey() },
          ...prev,
        ])
      }
    },
    deleteTask: (id) => {
      const before = tasks
      const gone = tasks.find((t) => t.id === id)
      setTasks((prev) => prev.filter((t) => t.id !== id))
      bury(rowKey('tasks', { id }))
      armUndo(gone ? `Deleted "${gone.title}"` : 'Task deleted', () => { setTasks(before); digUp(rowKey('tasks', { id })) })
    },
    setSubtasks: (taskId, subs) =>
      setTasks((prev) => prev.map((t) => {
        if (t.id !== taskId) return t
        const subtasks = subs.map((s, i) => ({ id: `${taskId}s${i}${Date.now().toString(36)}`, title: s.title, estimateMin: s.estimateMin, done: false }))
        return { ...t, subtasks, estimateMin: subtasks.reduce((a, x) => a + x.estimateMin, 0), estimated: true }
      })),
    setEstimate: (taskId, minutes) =>
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, estimateMin: Math.max(1, Math.round(minutes)), estimated: true } : t))),

    /* Both of these write the dated log first: that is the record that survives
       the week rolling over. days[] is a cache of the current week and is kept in
       step here, and rebuilt from the log on every load. */
    assertRoutineDay,
    toggleHabitDay: (id, day) => {
      const h = habits.find((x) => x.id === id)
      if (!h) return
      markDay(id, day, !h.days[day])
    },
    markHabitDay: (id, day, value) => markDay(id, day, value),
    addHabit: (input) => {
      const id = newId('h')
      setHabits((prev) => [...prev, {
        id, space, name: input.name, daypart: input.daypart,
        frequency: input.frequency, targetPerWeek: input.targetPerWeek,
        kind: input.kind ?? 'build',
        dailyTargetMin: input.dailyTargetMin,
        /* Copied across explicitly, like every other field here. A row built
           field by field drops anything the shape gains later, silently. */
        measure: input.measure,
        per: input.per,
        targetCount: input.targetCount,
        source: input.source,
        // A quit runs from the day he says he stopped, not from the day he got
        // round to typing it in.
        quitSince: input.kind === 'break' ? (input.quitSince ?? todayKey()) : undefined,
        // And the same courtesy the other way round: a habit he has been keeping
        // since June starts in June, not on the day he typed it in here.
        startedOn: input.kind === 'break' ? undefined : (input.startedOn ?? todayKey()),
        filledSince: input.kind === 'break' ? undefined : (input.startedOn ?? todayKey()),
        days: [false, false, false, false, false, false, false], paused: false,
      }])
      // Started before today means those days were kept. Say so in the record.
      if (input.kind !== 'break') backfillKept(id, input.startedOn)
    },
    /* A slip is a dated record, appended. It used to overwrite one field, so the
       second slip erased the first and the clean run before it went with it.
       Saying it out loud is hard enough without it also being irreversible, so
       it can be taken back like any other change. */
    logSlip: (id) => {
      const day = todayKey()
      if (slips.some((s) => s.habitId === id && s.day === day)) return
      const before = slips
      setSlips((prev) => [...prev, { habitId: id, day }])
      armUndo('Slip logged for today', () => setSlips(before))
    },
    updateHabit: (id, patch) => {
      setHabits((prev) => prev.map((h) => (h.id === id ? { ...h, ...patch } : h)))
      /* Moving the start date EARLIER claims the days it just reached back
         over, and only those. Saving the sheet again with the same date must
         not re-tick a day he has since unticked, and moving the date later
         never deletes a day already logged: a day recorded as kept is his, and
         no edit here is allowed to take one back. */
      if (patch.startedOn && patch.kind !== 'break') {
        const had = habits.find((h) => h.id === id)?.filledSince
        if (patch.startedOn !== had) backfillKept(id, patch.startedOn, had)
      }
    },
    togglePauseHabit: (id) =>
      setHabits((prev) => prev.map((h) => (h.id === id ? { ...h, paused: !h.paused } : h))),
    /* Retired, not erased. Removing the row removed the only thing that could
       name its ticks, so a hundred days of a habit he stopped became a hundred
       orphan records: still on disk, unreadable, and gone from every day he
       looked back at. It comes off the page; its history stays legible. */
    deleteHabit: (id) => {
      const beforeH = habits, beforeSeeds = removedSeeds
      const gone = habits.find((h) => h.id === id)
      setHabits((prev) => prev.map((h) => (h.id === id ? { ...h, archivedAt: todayKey() } : h)))
      setRemovedSeeds((prev) => (prev.includes(id) ? prev : [...prev, id]))
      armUndo(gone ? `Deleted "${gone.name}"` : 'Habit deleted', () => {
        setHabits(beforeH); setRemovedSeeds(beforeSeeds)
      })
    },

    /* A goal is set for a period. Without one it was a rolling window that never
       ended, so "this week's goals" quietly became "goals, forever". */
    addGoal: (g) => setGoals((prev) => [...prev, {
      ...g,
      id: newId('g'),
      periodKey: g.periodKey ?? goalPeriodKey((g.timeframe ?? 'quarter') as GoalTf),
    }]),
    /** Set the same goal again for the period we are in now. */
    repeatGoal: (id) => {
      const g = goals.find((x) => x.id === id)
      if (!g) return
      const tf = (g.timeframe ?? 'quarter') as GoalTf
      setGoals((prev) => [...prev, {
        ...g,
        id: newId('g'),
        periodKey: goalPeriodKey(tf),
        current: 0,
        closed: undefined,
        milestones: g.milestones?.map((m) => ({ ...m, done: false })),
      }])
      setPageState('goals')
    },
    /* Editing a goal is how a habit gets attached to one that already exists.
       Clearing the link keeps whatever the habit had counted, so the number
       does not jump backwards when you switch to logging by hand. */
    updateGoal: (id, patch) =>
      setGoals((prev) => prev.map((g) => {
        if (g.id !== id) return g
        const next = { ...g, ...patch }
        if ('habitId' in patch && !patch.habitId && g.habitId) next.current = g.current
        return next
      })),
    bumpGoal: (id, delta) =>
      setGoals((prev) =>
        prev.map((g) =>
          g.id === id ? { ...g, current: Math.max(0, Math.min(g.target, g.current + delta)) } : g,
        ),
      ),
    /* Ticking a milestone advances the goal itself when the goal is measured in
       its milestones (target equals their count); other units keep their own
       counter and only the milestone list changes. Strict math, no fudging. */
    toggleGoalMilestone: (goalId, milestoneId) =>
      setGoals((prev) =>
        prev.map((g) => {
          if (g.id !== goalId || !g.milestones) return g
          const milestones = g.milestones.map((m) => (m.id === milestoneId ? { ...m, done: !m.done } : m))
          const doneCount = milestones.filter((m) => m.done).length
          const current = g.target === milestones.length ? doneCount : g.current
          return { ...g, milestones, current }
        }),
      ),
    deleteGoal: (id) => {
      const before = goals
      const gone = goals.find((g) => g.id === id)
      setGoals((prev) => prev.filter((g) => g.id !== id))
      bury(rowKey('goals', { id }))
      armUndo(gone ? `Deleted "${gone.name}"` : 'Goal deleted', () => { setGoals(before); digUp(rowKey('goals', { id })) })
    },

    setSocial: (entries) => setSocialState(entries),
    /* Connecting a source is a real OAuth flow, not a boolean. Until one
       exists, nothing in the app may flip a status to "connected". */
    toggleSource: () => {},

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

    /* One close for any window. A window that ends today and started this week
       also marks the weekly ritual done, so the Sunday nudge keeps working. */
    closeReview: (w, wins, outcomes, drifted) => {
      setReview((prev) => {
        /* Closing the same window again appends and supersedes. It used to drop
           the previous one, so a second close with empty boxes erased what he
           had written the first time. */
        const prior = (prev.reflections ?? []).find((r) => r.from === w.from && r.to === w.to && !r.supersededBy)
        const id = newId('rf')
        const kept = (prev.reflections ?? []).map((r) => (r.id === prior?.id ? { ...r, supersededBy: id } : r))
        const entry = { id, label: w.label, from: w.from, to: w.to, when: todayKey(), wins, drifted: drifted?.trim() || undefined, outcomes }
        const isThisWeek = w.from === dayOfWeekKey(0) && w.to === todayKey()
        return {
          ...prev,
          lastDoneDate: isThisWeek ? todayKey() : prev.lastDoneDate,
          wins: isThisWeek ? wins : prev.wins,
          outcomes: isThisWeek ? outcomes : prev.outcomes,
          // No cap. This is a handful of sentences a week, and it is his writing.
          reflections: [entry, ...kept],
        }
      })
      setTasks((prev) => [
        ...outcomes.filter(Boolean).map((o) => ({
          id: newId('t'),
          title: o,
          source: 'mc' as const,
          estimateMin: 30,
          done: false,
          createdAt: todayKey(),
          space,
          list: 'backlog' as const,
          category: 'admin' as const,
        })),
        ...prev,
      ])
    },


    assistantLog,
    applyDictation: (text, items) => {
      const created: AssistantEntry['items'] = []
      const newTasks: Task[] = []
      const newGoals: Goal[] = []
      items.forEach((it) => {
        const id = newId('a')
        if (it.kind === 'goal') {
          newGoals.push({ id, space, name: it.text, current: 0, target: 1, unit: 'done', note: 'added by assistant', timeframe: 'weekly', category: 'life', periodKey: goalPeriodKey('weekly') })
          created.push({ id, kind: 'goal', label: it.text, tab: 'goals' })
        } else {
          const done = it.kind === 'done'
          /* A dictated "done" carries no measured time. Stamping actualMin with
             the default estimate would invent a perfect log and pollute the
             accuracy figure, so it stays undefined unless you said a number. */
          newTasks.push({ id, title: it.text, source: 'mc', estimateMin: it.estimateMin ?? 15, done, actualMin: done ? it.estimateMin : undefined, createdAt: todayKey(), plannedOn: todayKey(), space, list: 'today', category: 'quick' })
          created.push({ id, kind: it.kind, label: it.text, tab: done ? 'today' : 'plan' })
        }
      })
      if (newTasks.length) setTasks((prev) => [...newTasks, ...prev])
      if (newGoals.length) setGoals((prev) => [...prev, ...newGoals])
      setAssistantLog((prev) => [{ id: newId('log'), text, when: todayKey(), items: created }, ...prev])
    },
    revertAssistantItem: (entryId, itemId) => {
      const entry = assistantLog.find((e) => e.id === entryId)
      const item = entry?.items.find((i) => i.id === itemId)
      if (item) {
        if (item.kind === 'goal') setGoals((p) => p.filter((g) => g.id !== item.id))
        else setTasks((p) => p.filter((t) => t.id !== item.id))
      }
      setAssistantLog((prev) => prev.map((e) => (e.id === entryId ? { ...e, items: e.items.filter((i) => i.id !== itemId) } : e)).filter((e) => e.items.length))
    },

    coachSessions,
    startCoachSession: (input) => {
      const taskId = newId('t')
      setTasks((prev) => [
        { id: taskId, title: input.firstStep, source: 'mc', estimateMin: input.firstStepMin, done: false, createdAt: todayKey(), plannedOn: todayKey(), space, list: 'today', category: input.category },
        ...prev,
      ])
      setCoachSessions((prev) => [
        { id: newId('cs'), space, title: input.title, facts: input.facts, firstStep: input.firstStep, taskId, when: todayKey(), status: 'open' },
        ...prev,
      ])
    },
    /* Saying you did it also ticks the task off Today (with its estimate logged),
       so the loop closes in one place instead of two. Saying "not yet" leaves the
       loop OPEN on purpose: an unfaced thing should keep showing up. */
    reflectCoachSession: (id, didIt, felt, reflection) => {
      const s = coachSessions.find((x) => x.id === id)
      setCoachSessions((prev) =>
        prev.map((x) => (x.id === id ? { ...x, status: didIt ? 'closed' : 'open', didIt, felt: didIt ? felt : undefined, reflection } : x)),
      )
      if (didIt && s?.taskId) {
        const t = tasks.find((x) => x.id === s.taskId)
        if (t && !t.done) value.logActual(t.id, t.estimateMin)
      }
    },
    /* Dropping an OPEN loop removes the task it queued. A closed one only clears
       the history record: the work is already done, deleting it would rewrite it. */
    deleteCoachSession: (id) => {
      const s = coachSessions.find((x) => x.id === id)
      if (s?.taskId && s.status === 'open') {
        const t = tasks.find((x) => x.id === s.taskId)
        if (t && !t.done) setTasks((prev) => prev.filter((x) => x.id !== s.taskId))
      }
      setCoachSessions((prev) => prev.filter((x) => x.id !== id))
    },

    /* Every path that can change whether a routine is complete goes through
       this, so the habit can never disagree with the routine. Adding, deleting
       or reordering a step changes completeness just as ticking one does, and
       those used to skip the mirror entirely. */
    toggleRoutineStep: (routineId, stepId) => {
      const r = routines.find((x) => x.id === routineId)
      if (!r) return
      // A gated step (the typing test) obeys the same rule on every surface.
      if (!r.doneStepIds.includes(stepId) && stepLocked(r, stepId)) return
      const has = r.doneStepIds.includes(stepId)
      const doneStepIds = has ? r.doneStepIds.filter((x) => x !== stepId) : [...r.doneStepIds, stepId]
      applyRoutine(routineId, (x) => stamped({ ...x, doneStepIds }))
    },
    /* Picking one of a step's alternatives IS ticking that step. The choice is
       kept so the day record can say which way he went, and picking the same one
       again clears it, which is the only way to undo a step that has no checkbox
       of its own. */
    toggleRoutineAlt: (routineId, stepId, altId) => {
      applyRoutine(routineId, (r) => {
        const off = r.stepChoice?.[stepId] === altId
        const stepChoice = { ...(r.stepChoice ?? {}) }
        if (off) delete stepChoice[stepId]
        else stepChoice[stepId] = altId
        const doneStepIds = off
          ? r.doneStepIds.filter((x) => x !== stepId)
          : r.doneStepIds.includes(stepId) ? r.doneStepIds : [...r.doneStepIds, stepId]
        return stamped({ ...r, stepChoice, doneStepIds })
      })
    },
    records,
    /* Logging the number IS completing the step, in one action. Keeping them
       apart meant the gate read the old score and refused the very result that
       had just satisfied it. */
    setStepData: (routineId, stepId, value) => {
      applyRoutine(routineId, (r) => {
        const stepData = { ...(r.stepData ?? {}), [stepId]: value }
        const passes = !stepLocked({ ...r, stepData }, stepId)
        const doneStepIds = passes && !r.doneStepIds.includes(stepId)
          ? [...r.doneStepIds, stepId]
          : !passes ? r.doneStepIds.filter((x) => x !== stepId) : r.doneStepIds
        return stamped({ ...r, stepData, doneStepIds })
      })
      /* Every run is kept, with the moment it happened. Keying by day and
         replacing meant a second attempt erased the first: run 76 in the
         morning and 83 in the evening and the 76 was gone, which is the same
         thing `records` was already doing wrong at a slower rate. */
      setStepLog((prev) => [...prev, { routineId, stepId, day: todayKey(), at: new Date().toISOString(), value }])
      const key = `${routineId}:${stepId}`
      setRecords((prev) => (value > (prev[key] ?? 0) ? { ...prev, [key]: value } : prev))
    },
    addRoutine: (input) => {
      const hid = newId('h')
      const rid = newId('r')
      setHabits((prev) => [...prev, {
        id: hid, space, name: input.title, daypart: input.daypart, kind: 'build',
        frequency: input.cadence === 'weekly' ? 'weekly' : input.cadence === 'monthly' ? 'monthly' : input.cadence === 'prework' ? 'weekdays' : 'daily',
        days: [false, false, false, false, false, false, false], paused: false, history: [],
      }])
      setRoutines((prev) => [...prev, {
        id: rid, space, title: input.title, cadence: input.cadence, blurb: input.blurb,
        steps: [], doneStepIds: [], habitId: hid, periodKey: periodKeyFor(input.cadence), stepData: {},
      }])
    },
    updateRoutine: (id, patch) => {
      setRoutines((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
      // The mirrored habit carries the routine's name, so keep them in step.
      const r = routines.find((x) => x.id === id)
      if (r?.habitId && patch.title) setHabits((hs) => hs.map((h) => (h.id === r.habitId ? { ...h, name: patch.title as string } : h)))
    },
    /* Deleting a routine takes its habit with it: a habit only a routine could
       tick would otherwise sit there permanently unfinishable. */
    deleteRoutine: (id) => {
      const r = routines.find((x) => x.id === id)
      // A routine takes its habit and its goal's link with it, so undo has to
      // put all three back, not just the routine.
      const beforeR = routines, beforeH = habits, beforeG = goals, beforeSeeds = removedSeeds
      armUndo(r ? `Deleted "${r.title}"` : 'Routine deleted', () => {
        setRoutines(beforeR); setHabits(beforeH); setGoals(beforeG); setRemovedSeeds(beforeSeeds)
      })
      setRoutines((prev) => prev.map((x) => (x.id === id ? { ...x, archivedAt: todayKey() } : x)))
      if (r?.habitId) {
        const hid = r.habitId
        setHabits((hs) => hs.map((h) => (h.id === hid ? { ...h, archivedAt: todayKey() } : h)))
        /* A goal counting off that habit keeps the progress it earned and goes
           back to being logged by hand, rather than pointing at nothing and
           freezing forever. */
        setGoals((gs) => gs.map((g) => (g.habitId === hid
          ? { ...g, habitId: undefined, current: goalCurrent(g, habits), unit: g.unit === 'checkoffs' ? 'done' : g.unit }
          : g)))
        setRemovedSeeds((prev) => (prev.includes(hid) ? prev : [...prev, hid]))
      }
      setRemovedSeeds((prev) => (prev.includes(id) ? prev : [...prev, id]))
    },
    addRoutineStep: (routineId, step) =>
      applyRoutine(routineId, (r) => ({ ...r, steps: [...r.steps, { id: newId('st'), kind: 'do' as const, ...step }] })),
    updateRoutineStep: (routineId, stepId, patch) =>
      setRoutines((prev) => prev.map((r) => (r.id === routineId
        ? { ...r, steps: r.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) }
        : r))),
    deleteRoutineStep: (routineId, stepId) =>
      applyRoutine(routineId, (r) => ({
        ...r,
        steps: r.steps.filter((s) => s.id !== stepId),
        doneStepIds: r.doneStepIds.filter((x) => x !== stepId),
      })),
    moveRoutineStep: (routineId, stepId, dir) =>
      setRoutines((prev) => prev.map((r) => {
        if (r.id !== routineId) return r
        const steps = [...r.steps]
        const i = steps.findIndex((s) => s.id === stepId)
        const j = i + dir
        if (i < 0 || j < 0 || j >= steps.length) return r
        ;[steps[i], steps[j]] = [steps[j], steps[i]]
        return { ...r, steps }
      })),
    /* Not a reset. The run he just finished stays in the log, keeps its habit
       tick and keeps whatever its steps recorded; this only opens a fresh run on
       top of it. Nothing he has done can be taken back by starting again. */
    logCount,
    startAgain: (routineId) => applyRoutine(routineId, (r) => ({
      ...r, run: (r.run ?? 0) + 1, doneStepIds: [], stepData: {}, stepChoice: {}, startedAt: undefined,
    })),
    /* Planning is the other direction from starting: starting files a routine
       under the clock that has already run, planning says where he intends it to
       go. Nothing is copied, so the row on the day IS the routine and ticking a
       step in either place is one act. */
    planRoutine: (routineId, slot, day) => applyRoutine(routineId, (r) => ({
      ...r, planned: slot ? { day: day ?? todayKey(), slot } : undefined,
    })),
    /* Ticking the routine itself ticks everything inside it, minus any step that
       has to be earned elsewhere (the typing gate), which stays his to pass. */
    /* Finishing the routine finishes what it needs. An optional step is not
       claimed on his behalf, because ticking "wash your face" for him would be
       the app putting words in his mouth, but one he has already ticked stays. */
    setRoutineDone: (routineId, done) => applyRoutine(routineId, (r) => stamped({
      ...r,
      doneStepIds: done
        ? [...new Set([
          ...r.doneStepIds.filter((id) => r.steps.some((st) => st.id === id && st.optional)),
          ...requiredSteps(r).filter((st) => !stepLocked(r, st.id)).map((st) => st.id),
        ])]
        : [],
      stepChoice: done ? r.stepChoice : {},
    })),

    notes, noteFolders,
    addNote: (folderId, body = '') => {
      const id = newId('note')
      const sp = spaceOfFolder(folderId, noteFolders) ?? space
      setNotes((prev) => [{
        id, space: sp, folderId, title: noteTitle(body), body,
        color: 'amber', when: todayKey(), updatedAt: Date.now(), hist: [],
      }, ...prev])
      return id
    },
    /* Every body this note has had leaves its hash behind. That trail is what
       lets a merge on another device tell "I am behind" from "we both wrote",
       so the cost of keeping it is one small string per edit. */
    updateNote: (id, patch) => setNotes((prev) => prev.map((n) => {
      if (n.id !== id) return n
      const bodyChanged = patch.body !== undefined && patch.body !== n.body
      return {
        ...n, ...patch,
        title: patch.body !== undefined ? noteTitle(patch.body) : n.title,
        hist: bodyChanged ? [...(n.hist ?? []), bodyHash(n.body)].slice(-40) : n.hist,
        updatedAt: Date.now(),
      }
    })),
    moveNote: (id, folderId) => setNotes((prev) => prev.map((n) => (n.id === id
      ? { ...n, folderId, space: spaceOfFolder(folderId, noteFolders) ?? n.space, updatedAt: Date.now() }
      : n))),
    deleteNote: (id) => {
      const before = notes
      setNotes((prev) => prev.filter((n) => n.id !== id))
      bury(rowKey('notes', { id }))
      armUndo('Note deleted', () => { setNotes(before); digUp(rowKey('notes', { id })) })
    },
    /* The other device's paragraph joins this one under a rule, rather than him
       having to copy it out by hand before it can be dismissed. */
    keepNoteConflict: (id) => setNotes((prev) => prev.map((n) => (n.id === id && n.conflict
      ? {
        ...n,
        body: `${n.body}\n\n--- from another device ---\n${n.conflict.body}`,
        title: n.title,
        hist: [...(n.hist ?? []), bodyHash(n.body), bodyHash(n.conflict.body)].slice(-40),
        conflict: undefined,
        updatedAt: Date.now(),
      }
      : n))),
    dropNoteConflict: (id) => setNotes((prev) => prev.map((n) => (n.id === id
      ? { ...n, conflict: undefined, hist: [...(n.hist ?? []), ...(n.conflict ? [bodyHash(n.conflict.body)] : [])].slice(-40), updatedAt: Date.now() }
      : n))),

    addNoteFolder: (sp, name) => {
      const id = newId('nf')
      const order = noteFolders.filter((f) => f.space === sp).length
      setNoteFolders((prev) => [...prev, { id, space: sp, name: name.trim() || 'New folder', parentId: spaceFolderId(sp), order }])
      return id
    },
    renameNoteFolder: (id, name) => setNoteFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name: name.trim() || f.name } : f))),
    /* Deleting a shelf does not burn the books: its notes go up to the workspace
       folder, where he can still find every one of them. */
    deleteNoteFolder: (id) => {
      const folder = noteFolders.find((f) => f.id === id)
      if (!folder) return
      const beforeFolders = noteFolders
      const beforeNotes = notes
      setNoteFolders((prev) => prev.filter((f) => f.id !== id))
      setNotes((prev) => prev.map((n) => (n.folderId === id ? { ...n, folderId: folder.parentId, updatedAt: Date.now() } : n)))
      bury(rowKey('noteFolders', { id }))
      const moved = notes.filter((n) => n.folderId === id).length
      armUndo(moved ? `Folder deleted, ${moved} ${moved === 1 ? 'note' : 'notes'} moved up` : 'Folder deleted', () => {
        setNoteFolders(beforeFolders); setNotes(beforeNotes); digUp(rowKey('noteFolders', { id }))
      })
    },
    renameNoteTag: (from, to) => {
      const clean = to.replace(/^#/, '').replace(/[^\p{L}\d_/-]/gu, '')
      if (!clean) return
      /* Not \b: that boundary is spelled in ASCII, so #test would reach inside
         #testů and rename half a Czech word. The lookahead asks the real
         question, which is whether the tag actually ends there. */
      const esc = from.replace(/^#/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`#${esc}(?![\\p{L}\\d_/-])`, 'giu')
      setNotes((prev) => prev.map((n) => {
        const body = n.body.replace(re, `#${clean}`)
        if (body === n.body) return n
        return { ...n, body, title: noteTitle(body), hist: [...(n.hist ?? []), bodyHash(n.body)].slice(-40), updatedAt: Date.now() }
      }))
    },

    undoable,
    undoDelete: () => { undoable?.restore(); setUndoable(null) },
    dismissUndo: () => setUndoable(null),

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
