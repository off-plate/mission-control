import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { SPACE_LABELS } from '../mock'
import { type Action, type CardKind } from '../assistant'
import { breakdownTask } from '../ai'
import { useAssistantBills } from '../assistantbills'
import { hasHevyKey, syncHevy } from '../hevy'
import { usePomodoro } from '../pomodoro'
import {
    SLOTS, habitStepKey, spaceFolderId,
    type GoalTimeframe, type HabitFrequency, type PageId, type ProspectPerson, type RoutineCadence, type SpaceId, type Task, type TouchStep
} from '../types'
import { localDateKey, fmtDuration, taskMinutes, goalPeriodKey } from '../util'
import { nextPersonSlot, TIER_CADENCE, TIER_LABEL } from '../peoplelayout'
import { STEPS, cleanDomain, label } from '../prospectcalc'
import { APPS } from '../apps'
import { similarTo, spaceFrom } from '../similar'
import { candidates, dropUrl, fold, noteName, pick } from './shared'

/* WHAT HAPPENED, in the app's words rather than the model's.

   `ok` is what actually changed. `no` is a change that could not be made, and
   it says why in the same breath, because "Added it" over a task that was never
   added is the failure this whole mechanism exists to prevent. */
export interface Done {
  ok: boolean
  text: string
  /** Set only for a 'done' action on a task with no actual time logged yet.
   *  The thread renders the same "how long did it take?" prompt the task list
   *  itself shows, rather than marking it done and moving on: he asked for
   *  this specifically because a task he finishes by telling the assistant
   *  was going in with no actual time recorded, and no page open to fix it. */
  needsActual?: { taskId: string; est: number }
  /** Set on the actions common enough, and safe enough, to take straight back:
   *  a real add, move, estimate or done/undone. His report (2026-09-10): a
   *  bulk paste that under-did itself with no way to see what actually landed
   *  or send it back. Not every kind gets one -- a logged slip or a
   *  posted expense has no clean inverse, and this is a real per-row undo, not
   *  a promise the app cannot keep, so those lines simply carry none. Only
   *  the full assistant page renders a button for this; the dock popup shows
   *  the same line with no way to act on it, on purpose (his instruction). */
  undo?: () => void
  /** Set once undo has actually been used on this line, so a second render
   *  shows what happened rather than offering the same button again. Page
   *  state, not something the doer above ever sets itself. */
  undone?: boolean
  /** Where it landed: the card that holds it and the row's id (or name), so
   *  the canvas can open there and mark it (2026-10-04, his ask: the right
   *  side shows where every change went). A task's card is worked out after
   *  the write, from where the row actually ended up. */
  at?: { card?: CardKind; key?: string; shape?: 'prospect' }
}

/** pick()'s counterpart for when he named more than one himself ("both",
 *  "all three"): every row still in the same tier pick() would have refused
 *  on, rather than one row or nothing. Never invents a row pick() would not
 *  also have found -- the difference is only in what happens once several
 *  real ones turn up. */
export function pickAll<T extends { title: string }>(rows: T[], match: string): { found: T[]; why?: string } {
  if (!fold(match)) return { found: [], why: 'nothing to look for' }
  const found = candidates(rows, match)
  return found.length ? { found } : { found: [], why: `nothing here is called "${match}"` }
}

/** The app's own name for each page an 'open' action can land on -- not the
 *  route id, and not the model's own guess at a label. */
export const OPEN_LABELS: Partial<Record<PageId, string>> = {
  today: 'Today', plan: 'Plan', projects: 'Projects', habits: 'Habits',
  routines: 'Routines', goals: 'Goals', quitting: 'Quitting', settings: 'Settings',
  notes: 'Notes', board: 'the board', apps: 'Apps', focus: 'Focus', zone: 'the Zone',
  bills: 'Bills', calendar: 'Calendar', timeline: 'Jar', ideas: 'Ideas',
  prompts: 'Prompts', people: 'People', gym: 'Gym', longevity: 'Longevity',
  assistant: 'the Assistant', skills: 'Skills', health: 'Health', watchless: 'Watchless',
}

export const slotWord = (s?: string) => SLOTS.find((x) => x.id === s)?.label.toLowerCase()

/** pick() for rows whose name is not called `title`. */
export function pickBy<T>(rows: T[], name: (r: T) => string, match: string): { row?: T; why?: string } {
  const { row, why } = pick(rows.map((r) => ({ r, title: name(r) })), match)
  return { row: row?.r, why }
}

export const no = (text: string): Done => ({ ok: false, text })

export const yes = (text: string, undo?: () => void): Done => ({ ok: true, text, ...(undo ? { undo } : {}) })

/** Which card shows each kind's result. 'task' is resolved from the row
 *  itself after the write (today, a later day, or the list); null shows
 *  nothing, because the action is a move around the app, not a change. */
export const LANDS: Record<Action['kind'], CardKind | 'task' | null> = {
  add: 'task', done: 'task', undone: 'task', move: 'task', estimate: 'task', rename: 'task', drop: 'task',
  steps: 'task', breakdown: 'task', stepDone: 'task', focus: 'task',
  project: 'projects', projectRename: 'projects', projectDelete: 'projects',
  habit: 'habits', habitCount: 'habits', slip: 'habits', addHabit: 'habits', editHabit: 'habits', pauseHabit: 'habits', archiveHabit: 'habits',
  addRoutine: 'routines', editRoutine: 'routines', deleteRoutine: 'routines', routineStep: 'routines',
  addRoutineStep: 'routines', removeRoutineStep: 'routines', routineDone: 'routines', planRoutine: 'routines',
  addGoal: 'goals', editGoal: 'goals', goal: 'goals', milestone: 'goals', repeatGoal: 'goals', deleteGoal: 'goals',
  focusStop: 'focus', logFocus: 'focus',
  note: 'notes', noteEdit: 'notes', noteDelete: 'notes', noteMove: 'notes', notePin: 'notes', noteDone: 'notes', folder: 'notes',
  idea: 'ideas', ideaEdit: 'ideas', ideaDelete: 'ideas',
  addPerson: 'people', editPerson: 'people', deletePerson: 'people', contact: 'people',
  addProspect: 'business', editProspect: 'business', touch: 'business',
  bill: 'bills', skipBill: 'bills', expense: 'bills', income: 'bills',
  gymGoal: 'gym', gymGoalEdit: 'gym', gymGoalDelete: 'gym',
  prompt: 'prompts', promptSent: 'prompts', promptDelete: 'prompts',
  workspace: null, open: null, day: null, app: null, sync: null, jarvis: null,
}

/** Business pipeline actions: same People card, their own core shape. */
export const PROSPECT_KINDS = new Set<Action['kind']>(['addProspect', 'editProspect', 'touch'])

/** The card a task sits on right now. */
export const taskCard = (t: Task, day = localDateKey()): CardKind =>
  t.list === 'today' ? ((t.plannedOn ?? day) > day ? 'planned' : 'today') : 'backlog'

/** Runs what the model named, against the same store every page writes to, and
 *  reports what it actually did. Nothing here trusts a title: every match is
 *  resolved against his real rows first, and an unresolved one changes nothing. */
export function useDoer() {
  const st = useStore()
  const live = useRef(st)
  live.current = st
  const bills = useAssistantBills()
  /* Through a ref like the store: "start a block, then stop it" in one reply
     must see the block the first action started. */
  const pomoLive = usePomodoro()
  const pomoNow = useRef(pomoLive)
  pomoNow.current = pomoLive

  /* A CHAIN SEES ITS OWN WORK (2026-10-04). live.current is the store as of
     the last render, and every write lands on the NEXT one -- so "make project
     P and put X in it" looked for P before P existed and reported it missing,
     and every dependent pair in one reply failed the same way. After each
     action the doer now waits for that render (or 80ms, when the action
     changed nothing and no render is coming), so each action reads what the
     one before it wrote. */
  const waiters = useRef<(() => void)[]>([])
  useEffect(() => {
    const w = waiters.current
    waiters.current = []
    w.forEach((f) => f())
  })
  const settle = () => new Promise<void>((r) => { waiters.current.push(r); setTimeout(r, 80) })

  /** The row an action touched, for the canvas to mark. */
  let key: string | undefined
  const mark = (k: string) => { key = k }

  return async (actions: Action[]): Promise<Done[]> => {
    const out: Done[] = []
    /* Two "add"s for one title in one run (a retried turn answering twice)
       would otherwise both see the store before either landed. */
    const addedThisRun = new Set<string>()
    for (const a of actions) {
      key = undefined
      let got: Done[]
      try {
        const r = await step(a, addedThisRun)
        const lands = LANDS[a.kind]
        got = Array.isArray(r) ? r
          : [r.ok && lands && !r.at && (lands !== 'task' || key) ? { ...r, at: { card: lands === 'task' ? undefined : lands, key, ...(PROSPECT_KINDS.has(a.kind) ? { shape: 'prospect' as const } : {}) } } : r]
      } catch {
        /* A failed network write (Bills) is a failed line, not a dead turn. */
        got = [no(`${a.kind} could not be saved`)]
      }
      await settle()
      /* Tasks are placed after the write, from where the row really is now. */
      for (const d of got) {
        if (d.at && !d.at.card) {
          const t = live.current.tasks.find((x) => x.id === d.at!.key)
          d.at = { ...d.at, card: t ? taskCard(t) : 'today' }
        }
        out.push(d)
      }
    }
    return out
  }


  async function step(a: Action, addedThisRun: Set<string>): Promise<Done | Done[]> {
    const s = live.current
    const pomo = pomoNow.current
    const day = localDateKey()
    const space = s.space
    const m = a.match ?? ''
    const proj = (name: string) => pickBy(s.projects, (p) => p.name, name)
    const habitRows = s.habits.filter((h) => !h.archivedAt)
    const routineRows = s.routines.filter((r) => !r.archivedAt)

    switch (a.kind) {
      case 'add': {
        const title = a.title!
        const slot = a.list === 'backlog' ? undefined : a.slot
        const list = a.list ?? (a.slot || a.date || a.at ? 'today' : 'backlog')
        const on = list === 'today' ? (a.date ?? day) : undefined
        const where = a.date && a.date !== day ? a.date : slot ? slotWord(slot) : list === 'today' ? 'today' : 'the list'
        const key = title.trim().toLowerCase()
        if (addedThisRun.has(key)) return yes(`Already on the list: ${title}`)
        /* An open row with this exact title already exists (his report,
           2026-09-10): a repeated "add" is his placement for that row,
           restated, so it moves rather than duplicating or no-op'ing. It fills
           in an estimate only where the row has none of its own. */
        const existing = s.tasks.find((t) => !t.done && t.title.trim().toLowerCase() === key)
        if (existing) {
          addedThisRun.add(key)
          const fillsEstimate = a.min != null && !existing.estimated && !existing.estimateMin
          const alreadyThere = existing.list === list && (!slot || existing.slot === slot) && (!on || existing.plannedOn === on) && !fillsEstimate
          mark(existing.id)
          if (alreadyThere) return yes(`Already on the list: ${title}`)
          const wasList = existing.list, wasSlot = existing.slot, wasPlannedOn = existing.plannedOn, wasMin = existing.estimateMin
          if (list !== existing.list || (on && existing.plannedOn !== on)) s.moveTaskList(existing.id, list, on)
          if (slot) s.assignSlot(existing.id, slot)
          if (fillsEstimate) s.setEstimate(existing.id, a.min!)
          return yes(`Moved to ${where}: ${title}`, () => {
            s.moveTaskList(existing.id, wasList, wasPlannedOn)
            if (wasSlot) s.assignSlot(existing.id, wasSlot)
            if (fillsEstimate) s.setEstimate(existing.id, wasMin)
          })
        }
        /* The same task in other words (his ask, 2026-10-16). Not added; the
           model is told which row it looks like, and moves it, asks him, or
           re-sends with fresh:true once he has said they are different. */
        if (!a.fresh) {
          const twin = similarTo(title, s.tasks.filter((t) => !t.done))
          if (twin) return no(`Not added: "${title}" looks like the open task "${dropUrl(twin.title) || twin.title}". Same task: move that one. Not sure: ask him. Different: he has to say so, then add with fresh:true`)
        }
        /* "add X to the Y project": a real project or none. No match still
           adds the task, rather than failing the whole add over one word. */
        let projectId: string | undefined
        let projectNote = ''
        if (a.project) {
          const { row } = proj(a.project)
          if (row) { projectId = row.id; projectNote = ` in ${row.name}` } else projectNote = ` (no project called "${a.project}", added without one)`
        }
        /* Never the workspace he happens to be looking at (his ask, 2026-10-16):
           the model names it from the task itself; failing that, where his most
           similar task lives; only then the current view. */
        const sp: SpaceId = (a.space as SpaceId | undefined) ?? (projectId ? s.projects.find((p) => p.id === projectId)?.space : undefined) ?? spaceFrom<SpaceId, Task>(title, s.tasks) ?? space
        addedThisRun.add(key)
        const est = a.min ?? 15
        const subs = a.steps ?? []
        const id = s.addTask({
          title, source: 'mc', estimateMin: est, estimated: a.min != null,
          space: sp, list, category: 'admin', slot, plannedOn: on, projectId,
          ...(a.at ? { at: a.at } : {}),
          ...(subs.length ? {
            subtasks: subs.map((t, i) => ({ id: `${Date.now().toString(36)}s${i}`, title: t, estimateMin: Math.max(5, Math.round(est / subs.length)), done: false })),
          } : {}),
        })
        mark(id)
        return yes(`Added to ${where}${a.at ? ` at ${a.at}` : ''}${projectNote}, ${SPACE_LABELS[sp]}: ${title}${subs.length ? ` (${subs.length} steps)` : ''}`, () => s.deleteTask(id))
      }

      case 'done': case 'undone': case 'drop': case 'move': case 'estimate': case 'rename': {
        /* inSlot narrows the field BEFORE matching: two rows sharing a title,
           one at noon and one in the afternoon, are only told apart by the
           slot he named. */
        const scoped = a.inSlot ? s.tasks.filter((t) => t.slot === a.inSlot) : s.tasks
        if (a.all && (a.kind === 'done' || a.kind === 'undone' || a.kind === 'drop')) {
          const { found, why } = pickAll(scoped, m)
          return found.length ? found.map((row) => taskStep(a, row)) : no(why ?? 'no task matched')
        }
        const { row, why } = pick(scoped, m)
        return row ? taskStep(a, row) : no(why ?? 'no task matched')
      }

      case 'steps': case 'breakdown': {
        const { row, why } = pick(s.tasks, m)
        if (!row) return no(why ?? 'no task matched')
        mark(row.id)
        if (row.subtasks?.some((x) => x.done)) return no(`${row.title} already has ticked steps, so they were left as they are`)
        let subs: { title: string; estimateMin: number }[]
        if (a.kind === 'steps') {
          const each = Math.max(5, Math.round(taskMinutes(row) / a.steps!.length))
          subs = a.steps!.map((title) => ({ title, estimateMin: each }))
        } else {
          const res = await breakdownTask(row.title, row.category)
          if (!res.ok) return no(`The breakdown did not come back (${res.reason})`)
          subs = res.steps.map((x) => ({ title: x.title, estimateMin: x.estimateMin }))
        }
        s.setSubtasks(row.id, subs)
        return yes(`${subs.length} steps on ${row.title}`)
      }
      case 'stepDone': {
        const { row, why } = pick(s.tasks, m)
        if (!row) return no(why ?? 'no task matched')
        mark(row.id)
        const sub = pickBy(row.subtasks ?? [], (x) => x.title, a.step!)
        if (!sub.row) return no(sub.why ?? `no step like that on ${row.title}`)
        s.toggleSubtask(row.id, sub.row.id)
        return yes(`${sub.row.done ? 'Reopened' : 'Ticked'} step: ${sub.row.title}`)
      }

      case 'project': {
        if (s.projects.some((p) => p.name.trim().toLowerCase() === a.name!.trim().toLowerCase())) return yes(`Already have a project called ${a.name}`)
        mark(a.name!)
        s.addProject(a.name!, (a.space as SpaceId | undefined) ?? space)
        return yes(`Made a new project: ${a.name}`)
      }
      case 'projectRename': {
        const { row, why } = proj(m)
        if (!row) return no(why ?? 'no project matched')
        mark(row.id)
        s.renameProject(row.id, a.name!)
        return yes(`Renamed project ${row.name} to ${a.name}`)
      }
      case 'projectDelete': {
        const { row, why } = proj(m)
        if (!row) return no(why ?? 'no project matched')
        s.deleteProject(row.id, a.deleteTasks ? 'delete' : 'move')
        return yes(`Deleted project ${row.name}${a.deleteTasks ? ' and its tasks' : ', its tasks kept'}`)
      }

      case 'habit': {
        const { row, why } = pickBy(habitRows, (h) => h.name, m)
        if (!row) return no(why ?? 'no habit matched')
        mark(row.id)
        const on = a.on !== false
        if (a.date && a.date !== day) {
          s.markHabitOn(row.id, a.date, on)
          return yes(`${on ? 'Kept' : 'Reopened'} on ${a.date}: ${row.name}`)
        }
        if (row.days[s.todayIndex] === on) return yes(`${row.name} was already ${on ? 'kept' : 'open'} today`)
        s.markHabitDay(row.id, s.todayIndex, on)
        return yes(`${on ? 'Kept today' : 'Reopened today'}: ${row.name}`)
      }
      case 'habitCount': {
        const { row, why } = pickBy(habitRows, (h) => h.name, m)
        if (!row) return no(why ?? 'no habit matched')
        mark(row.id)
        const v = a.value!
        if (habitStepKey(row)) { s.logHabitNumber(row.id, v); return yes(`Logged ${v} on ${row.name}`) }
        if (row.measure !== 'times') return no(`${row.name} is not counted, it is ticked or fed by focus time`)
        for (let i = 0; i < Math.abs(Math.round(v)); i++) { s.logCount(row.id, v < 0 ? -1 : 1); await settle() }
        return yes(`${v < 0 ? 'Took' : 'Counted'} ${Math.abs(Math.round(v))} ${v < 0 ? 'off' : 'on'} ${row.name}`)
      }
      case 'slip': {
        /* Only quitting rows, never an ordinary habit or a routine. A slip is
           a fact about a day, so there is no un-slip. */
        const { row, why } = pickBy(habitRows.filter((h) => h.kind === 'break'), (h) => h.name, m)
        if (!row) return no(why ?? 'nothing he is quitting matched')
        mark(row.id)
        if (a.date && a.date !== day) s.logSlipOn(row.id, a.date); else s.logSlip(row.id)
        return yes(`Logged a slip${a.date && a.date !== day ? ` on ${a.date}` : ''}: ${row.name}`)
      }
      case 'addHabit': {
        mark(a.name!)
        const frequency = a.frequency ?? (a.perWeek ? 'times-per-week' : 'daily')
        s.addHabit({ name: a.name!, frequency, targetPerWeek: a.perWeek, kind: a.breaking ? 'break' : 'build', quitSince: a.breaking ? day : undefined })
        return yes(a.breaking ? `Now tracking: quitting ${a.name}` : `Added a habit: ${a.name}`)
      }
      case 'editHabit': {
        const { row, why } = pickBy(habitRows, (h) => h.name, m)
        if (!row) return no(why ?? 'no habit matched')
        mark(row.id)
        /* Only the fields he named: updateHabit merges {...h, ...patch}, so a
           key present as undefined would wipe the field instead of skipping. */
        const patch: { name?: string; frequency?: HabitFrequency; targetPerWeek?: number } = {}
        if (a.name) patch.name = a.name
        if (a.frequency) patch.frequency = a.frequency
        if (a.perWeek) patch.targetPerWeek = a.perWeek
        s.updateHabit(row.id, patch)
        return yes(`Updated: ${a.name ?? row.name}`)
      }
      case 'pauseHabit': {
        const { row, why } = pickBy(habitRows, (h) => h.name, m)
        if (!row) return no(why ?? 'no habit matched')
        mark(row.id)
        s.togglePauseHabit(row.id)
        return yes(`${row.paused ? 'Resumed' : 'Paused'}: ${row.name}`)
      }
      case 'archiveHabit': {
        const { row, why } = pickBy(habitRows, (h) => h.name, m)
        if (!row) return no(why ?? 'no habit matched')
        mark(row.id)
        s.deleteHabit(row.id)
        return yes(`Archived: ${row.name}`)
      }

      case 'addRoutine': {
        mark(a.title!)
        s.addRoutine({ title: a.title!, cadence: a.cadence ?? 'daily', blurb: a.blurb })
        if (a.steps?.length) {
          await settle()
          const made = live.current.routines.filter((r) => r.title === a.title).at(-1)
          for (const title of made ? a.steps : []) { live.current.addRoutineStep(made!.id, { title }); await settle() }
        }
        return yes(`Made a new routine: ${a.title}${a.steps?.length ? ` (${a.steps.length} steps)` : ''}`)
      }
      case 'editRoutine': case 'deleteRoutine': case 'routineStep': case 'addRoutineStep': case 'removeRoutineStep': case 'routineDone': case 'planRoutine': {
        const { row: r, why } = pickBy(routineRows, (x) => x.title, m)
        if (!r) return no(why ?? 'no routine matched')
        mark(r.id)
        if (a.kind === 'editRoutine') {
          const patch: { title?: string; cadence?: RoutineCadence; blurb?: string } = {}
          if (a.title) patch.title = a.title
          if (a.cadence) patch.cadence = a.cadence
          if (a.blurb) patch.blurb = a.blurb
          s.updateRoutine(r.id, patch)
          return yes(`Updated routine: ${a.title ?? r.title}`)
        }
        if (a.kind === 'deleteRoutine') { s.deleteRoutine(r.id); return yes(`Deleted routine: ${r.title}`) }
        if (a.kind === 'addRoutineStep') { s.addRoutineStep(r.id, { title: a.step! }); return yes(`Added a step to ${r.title}: ${a.step}`) }
        if (a.kind === 'routineDone') { s.setRoutineDone(r.id, a.on !== false); return yes(`${a.on === false ? 'Reopened' : 'Done'}: ${r.title}`) }
        if (a.kind === 'planRoutine') {
          s.planRoutine(r.id, a.slot, a.date)
          return yes(`Planned ${r.title} for ${a.date && a.date !== day ? a.date : slotWord(a.slot) ?? 'today'}`)
        }
        const st2 = pickBy(r.steps, (x) => x.title, a.step!)
        if (!st2.row) return no(st2.why ?? `no step like that in ${r.title}`)
        if (a.kind === 'removeRoutineStep') { s.deleteRoutineStep(r.id, st2.row.id); return yes(`Removed from ${r.title}: ${st2.row.title}`) }
        const was = r.doneStepIds.includes(st2.row.id)
        s.toggleRoutineStep(r.id, st2.row.id)
        await settle()
        /* A gated step (the typing test) refuses a tick until it is passed,
           silently. Read it back rather than reporting a tick that never was. */
        const now = live.current.routines.find((x) => x.id === r.id)?.doneStepIds.includes(st2.row.id)
        if (now === was) return no(`${st2.row.title} is locked until its own test is passed`)
        return yes(`${was ? 'Unticked' : 'Ticked'} in ${r.title}: ${st2.row.title}`)
      }

      case 'addGoal': {
        const tf = a.timeframe ?? 'monthly'
        const ms = a.milestones ?? []
        mark(a.name!)
        if (!ms.length && !a.target) return no(`A goal needs a target number or milestones: ${a.name}`)
        s.addGoal({
          space: (a.space as SpaceId | undefined) ?? space, name: a.name!, current: 0, note: '',
          target: ms.length || a.target!, unit: ms.length ? 'milestones' : a.unit ?? 'steps',
          timeframe: tf, category: a.category ?? 'life', why: a.why, periodKey: goalPeriodKey(tf),
          milestones: ms.map((label, i) => ({ id: `ms-${Date.now().toString(36)}-${i}`, label, done: false })),
        })
        return yes(`Made a new goal: ${a.name}`)
      }
      case 'editGoal': case 'goal': case 'milestone': case 'repeatGoal': case 'deleteGoal': {
        /* An open goal wins over a closed one of the same name, except for
           repeat, which only makes sense on a closed one. */
        const rows = a.kind === 'repeatGoal' ? s.goals : s.goals.filter((g) => !g.closed)
        const { row: g, why } = pickBy(rows, (x) => x.name, m)
        if (!g) return no(why ?? 'no goal matched')
        mark(g.id)
        if (a.kind === 'deleteGoal') { s.deleteGoal(g.id); return yes(`Deleted goal: ${g.name}`) }
        if (a.kind === 'repeatGoal') return s.repeatGoal(g.id) ? yes(`Running again: ${g.name}`) : no(`${g.name} could not be repeated`)
        if (a.kind === 'editGoal') {
          const patch: { name?: string; target?: number; unit?: string; timeframe?: GoalTimeframe; why?: string } = {}
          if (a.name) patch.name = a.name
          if (a.target) patch.target = a.target
          if (a.unit) patch.unit = a.unit
          if (a.timeframe) patch.timeframe = a.timeframe
          if (a.why) patch.why = a.why
          s.updateGoal(g.id, patch)
          return yes(`Updated goal: ${a.name ?? g.name}`)
        }
        if (a.kind === 'milestone') {
          const ms = pickBy(g.milestones ?? [], (x) => x.label, a.step!)
          if (!ms.row) return no(ms.why ?? `no milestone like that on ${g.name}`)
          s.toggleGoalMilestone(g.id, ms.row.id)
          return yes(`${ms.row.done ? 'Reopened' : 'Ticked'} on ${g.name}: ${ms.row.label}`)
        }
        /* A goal fed by a habit counts itself; a number typed over it would
           be overwritten by the next tick and mean nothing meanwhile. */
        if (g.habitId) return no(`${g.name} counts itself from its habit, so there is no number to set`)
        const next = a.set != null ? a.set : g.current + (a.by ?? 0)
        if (a.set != null) s.updateGoal(g.id, { current: a.set }); else s.bumpGoal(g.id, a.by!)
        return yes(`${g.name}: ${next} of ${g.target} ${g.unit}`, () => s.updateGoal(g.id, { current: g.current }))
      }

      case 'focus': {
        /* A real timer, starting now. pomo lives in its own context, not the
           store, so it is read here rather than through s. */
        if (a.match) {
          const { row, why } = pick(s.tasks, a.match)
          if (!row) return no(why ?? 'no task matched')
          mark(row.id)
          pomo.startFocus(a.min ?? taskMinutes(row), row.title)
          return yes(`Focus started: ${row.title}`)
        }
        pomo.startFocus(a.min, undefined)
        return yes(a.min ? `Focus started, ${fmtDuration(a.min)}` : 'Focus started')
      }
      case 'focusStop':
        if (pomo.phase === 'idle') return yes('No focus block was running')
        pomo.stop()
        return yes('Focus stopped, the time so far is kept')
      case 'logFocus': {
        if (a.date || a.at) s.logFocusOn(a.date ?? day, a.min!, a.label, a.at); else s.logFocus(a.min!, a.label)
        return yes(`Logged ${fmtDuration(a.min!)} of focus${a.label ? ` on ${a.label}` : ''}${a.date && a.date !== day ? ` on ${a.date}` : ''}`)
      }

      case 'note': {
        /* Filed where he is standing, or in the folder he named. A folder that
           does not exist does not lose the note: it lands in the default. */
        const f = a.folder ? pickBy(s.noteFolders, (x) => x.name, a.folder) : null
        /* A note's title IS its first line (store/notes.ts noteTitle), so a
           title he named is written as that line, not a field that the store
           would overwrite from the body. */
        mark(s.addNote(f?.row?.id ?? spaceFolderId(space), a.title ? `${a.title}\n${a.text}` : a.text))
        return yes(`Noted${f?.row ? ` in ${f.row.name}` : ''}${f && !f.row ? ` (no folder called "${a.folder}", filed in the default)` : ''}`)
      }
      case 'noteEdit': case 'noteDelete': case 'noteMove': case 'notePin': case 'noteDone': {
        const { row, why } = pickBy(s.notes, noteName, m)
        if (!row) return no(why ?? 'no note matched')
        mark(row.id)
        const name = noteName(row)
        if (a.kind === 'noteDelete') { s.deleteNote(row.id); return yes(`Deleted note: ${name}`) }
        if (a.kind === 'notePin') { s.updateNote(row.id, { pinned: a.on !== false }); return yes(`${a.on === false ? 'Unpinned' : 'Pinned'}: ${name}`) }
        if (a.kind === 'noteDone') { s.setNoteDone(row.id, a.on !== false); return yes(`${a.on === false ? 'Reopened' : 'Done'}: ${name}`) }
        if (a.kind === 'noteMove') {
          const f = pickBy(s.noteFolders, (x) => x.name, a.folder!)
          if (!f.row) return no(f.why ?? 'no folder matched')
          s.moveNote(row.id, f.row.id)
          return yes(`Moved to ${f.row.name}: ${name}`)
        }
        const rest = row.body.split('\n').slice(1).join('\n')
        const body = a.text ? (a.title ? `${a.title}\n${a.text}` : a.text) : `${a.title}\n${rest}`
        s.updateNote(row.id, { body })
        return yes(`Updated note: ${a.title ?? name}`)
      }
      case 'folder':
        mark(s.addNoteFolder((a.space as SpaceId | undefined) ?? space, a.name!))
        return yes(`Made a notes folder: ${a.name}`)

      case 'idea': {
        /* First free spot on a grid from the board's home corner, so a
           dictated card never lands on top of one already there. */
        const taken = (x: number, y: number) => s.ideaBoard.some((c) => Math.abs(c.x - x) < 200 && Math.abs(c.y - y) < 160)
        let x = 40, y = 40
        for (let i = 0; i < 200 && taken(x, y); i++) { x = 40 + (i % 6) * 240; y = 40 + Math.floor(i / 6) * 200 }
        mark(a.title!)
        s.addIdeaCard({ title: a.title!, body: a.body ?? '', color: 'amber', /* IDEA_COLORS[0]; importing ideasdock here would pull dictation into the eager bundle */ x, y })
        return yes(`On the ideas board: ${a.title}`)
      }
      case 'ideaEdit': case 'ideaDelete': {
        const { row, why } = pickBy(s.ideaBoard, (c) => c.title, m)
        if (!row) return no(why ?? 'no idea card matched')
        mark(row.id)
        if (a.kind === 'ideaDelete') { s.deleteIdeaCard(row.id); return yes(`Deleted idea: ${row.title}`) }
        s.updateIdeaCard(row.id, { ...(a.title ? { title: a.title } : {}), ...(a.body ? { body: a.body } : {}) })
        return yes(`Updated idea: ${a.title ?? row.title}`)
      }

      case 'addPerson': {
        /* Same placement rule as the People page's own "+". */
        const tier = a.tier!
        const { x, y } = nextPersonSlot(s.people, tier)
        mark(a.name!)
        const id = s.addPerson({ name: a.name!, rel: a.rel ?? '', tier, cadenceDays: TIER_CADENCE[tier], x, y })
        if (a.job || a.birthday || a.birthYear) { await settle(); live.current.updatePerson(id, { job: a.job, birthday: a.birthday, birthYear: a.birthYear }) }
        return yes(`Added to ${TIER_LABEL[tier]}: ${a.name}`)
      }
      case 'editPerson': case 'deletePerson': case 'contact': {
        const { row, why } = pickBy(s.people, (p) => p.name, m)
        if (!row) return no(why ?? 'no person matched')
        mark(row.id)
        if (a.kind === 'deletePerson') { s.deletePerson(row.id); return yes(`Removed: ${row.name}`) }
        if (a.kind === 'contact') {
          s.logContact(row.id, a.date ?? day, a.channel ?? 'inperson')
          return yes(`Logged contact with ${row.name}${a.date && a.date !== day ? ` on ${a.date}` : ''}`)
        }
        const patch: Record<string, unknown> = {}
        for (const k of ['name', 'tier', 'rel', 'job', 'birthday', 'birthYear', 'cadenceDays'] as const) if (a[k] !== undefined) patch[k] = a[k]
        s.updatePerson(row.id, patch)
        return yes(`Updated: ${a.name ?? row.name}`)
      }

      case 'addProspect': case 'editProspect': {
        /* A named contact is matched by name inside the business, else added. */
        const person = (have: ProspectPerson[]): ProspectPerson[] => {
          if (!a.contact) return have
          const f = (x: string) => x.trim().toLowerCase()
          const fields = { name: a.contact, ...(a.role ? { role: a.role } : {}), ...(a.email ? { email: a.email } : {}), ...(a.phone ? { phone: a.phone } : {}), ...(a.decides !== undefined ? { decides: a.decides } : {}) }
          return have.some((x) => f(x.name) === f(a.contact!))
            ? have.map((x) => (f(x.name) === f(a.contact!) ? { ...x, ...fields } : x))
            : [...have, { id: `pp-${Date.now().toString(36)}`, ...fields }]
        }
        const fields = {
          ...(a.name ? { name: a.name } : {}), ...(a.domain ? { domain: cleanDomain(a.domain) } : {}), ...(a.source ? { source: a.source } : {}),
          ...(a.stage ? { stage: a.stage } : {}), ...(a.value !== undefined ? { value: a.value } : {}), ...(a.why ? { why: a.why } : {}),
          ...(a.lostReason ? { lostReason: a.lostReason } : {}),
        }
        if (a.kind === 'addProspect') {
          mark(a.name!)
          s.addProspect({ name: a.name!, source: a.source!, ...fields, people: person([]) })
          return yes(`Prospect added: ${a.name}`)
        }
        const { row, why } = pickBy(s.prospects, (p) => p.name, m)
        if (!row) return no(why ?? 'no prospect matched')
        mark(row.id)
        s.updateProspect(row.id, { ...fields, people: person(row.people) })
        return yes(`Updated: ${a.name ?? row.name}`)
      }
      case 'touch': {
        const { row, why } = pickBy(s.prospects, (p) => p.name, m)
        if (!row) return no(why ?? 'no prospect matched')
        mark(row.id)
        const to = a.to ? row.people.find((x) => x.name.toLowerCase().includes(a.to!.toLowerCase()))?.id : row.people.find((x) => x.decides)?.id
        const step = a.step as TouchStep
        s.logTouch(row.id, { step, day: a.date ?? day, ...(to ? { to } : {}), ...(a.subject ? { subject: a.subject } : {}), ...(a.body ? { body: a.body } : {}) })
        return yes(`Logged ${label(STEPS, step).toLowerCase()} for ${row.name}`)
      }

      case 'bill': case 'skipBill': {
        /* ensure(), not this hook's render: a request landing the instant
           Bills opens would otherwise read a fetch that has not resolved and
           report a signed-in device as signed out (his report, 2026-09-08). */
        const fresh = await bills.ensure()
        if (!fresh.ready) return no('Bills is not signed in on this device')
        const { row, why } = pickBy(fresh.items, (i) => i.name, m)
        if (!row) return no(why ?? 'no bill matched')
        mark(row.id)
        if (a.kind === 'skipBill') {
          await bills.setSkip(row.id, a.on !== false)
          return yes(`${a.on === false ? 'Unskipped' : 'Skipped this cycle'}: ${row.name}`)
        }
        const paid = a.paid !== false
        if (row.paid === paid) return yes(`${row.name} was already ${paid ? 'paid' : 'unpaid'}`)
        if (paid) await bills.markPaid(row); else await bills.markUnpaid(row)
        return yes(paid ? `Marked paid: ${row.name}` : `Marked unpaid: ${row.name}`)
      }
      case 'expense': case 'income': {
        const fresh = await bills.ensure()
        if (!fresh.ready) return no('Bills is not signed in on this device')
        if (a.kind === 'expense') {
          mark(a.name!)
          await bills.addExpense(a.name!, a.amount!, a.dueOn)
          return yes(`Added to Unexpected this cycle: ${a.name} (${a.amount} Kč)`)
        }
        await bills.addIncome(a.amount!, a.label)
        return yes(`Added to Income: ${a.amount} Kč${a.label ? ` (${a.label})` : ''}`)
      }

      case 'gymGoal':
        mark(a.name!)
        s.addGymGoal({ name: a.name!, goal: a.goal!, unit: a.unit!, metric: a.metric ?? (a.exercise ? 'e1rm' : 'manual'), exerciseName: a.exercise, lowerIsBetter: a.lowerIsBetter })
        return yes(`New gym target: ${a.name}`)
      case 'gymGoalEdit': case 'gymGoalDelete': {
        const { row, why } = pickBy(s.gymGoals, (g) => g.name, m)
        if (!row) return no(why ?? 'no gym target matched')
        mark(row.id)
        if (a.kind === 'gymGoalDelete') { s.deleteGymGoal(row.id); return yes(`Deleted gym target: ${row.name}`) }
        s.updateGymGoal(row.id, { ...(a.name ? { name: a.name } : {}), ...(a.goal != null ? { goal: a.goal } : {}), ...(a.current != null ? { current: a.current } : {}) })
        return yes(`Updated gym target: ${a.name ?? row.name}`)
      }

      case 'prompt':
        mark(s.addPrompt({ project: a.project ?? 'General', session: 'General', kind: a.type ?? 'Idea', text: a.text! }))
        return yes('Saved the prompt for later')
      case 'promptSent': case 'promptDelete': {
        const { row, why } = pickBy(s.prompts, (p) => p.text.slice(0, 120), m)
        if (!row) return no(why ?? 'no saved prompt matched')
        mark(row.id)
        if (a.kind === 'promptDelete') { s.deletePrompt(row.id); return yes('Deleted the prompt') }
        s.setPromptSent(row.id, a.on !== false)
        return yes(a.on === false ? 'Back in the queue' : 'Marked sent')
      }

      case 'workspace':
        /* setView, not setSpace: it is what the header's own switcher calls,
           so it changes what he SEES, not only an internal default. */
        s.setView(a.space!)
        return yes(`Switched to ${a.space === 'all' ? 'All' : SPACE_LABELS[a.space as SpaceId]}`)
      case 'open':
        s.setPage(a.page!)
        return yes(`Opened ${OPEN_LABELS[a.page!] ?? a.page}`)
      case 'day':
        s.openDay(a.date!)
        return yes(`Opened ${a.date}`)
      case 'app': {
        const { row, why } = pickBy(APPS, (x) => x.name, m)
        if (!row) return no(why ?? 'no app matched')
        s.setFocusAppId(row.id)
        s.setPage('apps')
        return yes(`Opened ${row.name}`)
      }
      case 'jarvis':
        /* The HUD lives in App's own state (per device, not synced), so the
           assistant asks for it with the same event App listens for. */
        window.dispatchEvent(new CustomEvent('mc:hud', { detail: a.on !== false }))
        return yes(a.on === false ? 'Back to Mission Control' : 'Jarvis mode on')
      case 'sync': {
        /* Exactly what Settings' own "Sync now" makes. */
        if (!hasHevyKey()) return no('No Hevy key set on this device')
        const res = await syncHevy(s.habits, s.markHabitDaysOn)
        return res.ok
          ? yes(`Synced Hevy: ${res.days} day${res.days === 1 ? '' : 's'} of workouts`)
          : no(res.reason === 'bad-key' ? 'That Hevy key was rejected'
            : res.reason === 'rate-limit' ? 'Hevy is rate limiting right now'
              : res.reason === 'no-habit' ? 'No habit named Workout / Gym / Fitness to tick'
                : 'Hevy could not be reached')
      }
    }
  }

  /** A task action, tagged with the row it touched. A deleted row cannot be
   *  found afterwards, so its card is the one it was on. */
  function taskStep(a: Action, row: Task): Done {
    const d = doTask(a, row)
    return d.ok ? { ...d, at: { key: row.id, card: a.kind === 'drop' ? taskCard(row) : undefined } } : d
  }

  /** One task row, one task action. Every write snapshots what it changes
   *  first, so its undo puts back exactly what was there. */
  function doTask(a: Action, row: Task): Done {
    const s = live.current
    const day = localDateKey()
    switch (a.kind) {
      case 'done': {
        if (row.done) return yes(`${row.title} was already done`)
        /* He said the real number in the same breath: log it outright.
           logActual also writes the ledger and focus rows; undo reverses the
           done flag only, the same trade logSlip makes. */
        if (a.actualMin != null) {
          s.logActual(row.id, a.actualMin)
          return yes(`Done: ${row.title}, ${fmtDuration(a.actualMin)}`, () => s.toggleTask(row.id))
        }
        s.toggleTask(row.id)
        return {
          ok: true,
          text: `Done: ${row.title}`,
          needsActual: row.actualMin == null ? { taskId: row.id, est: taskMinutes(row) } : undefined,
          undo: () => s.toggleTask(row.id),
        }
      }
      case 'undone':
        if (!row.done) return yes(`${row.title} was already open`)
        s.toggleTask(row.id)
        return yes(`Reopened: ${row.title}`, () => s.toggleTask(row.id))
      case 'move': {
        const was = { list: row.list, slot: row.slot, plannedOn: row.plannedOn, projectId: row.projectId, space: row.space, at: row.at }
        const said: string[] = []
        if (a.list && a.list !== row.list) { s.moveTaskList(row.id, a.list, a.list === 'today' ? a.date ?? day : undefined); said.push(a.list === 'today' ? 'today' : 'the list') }
        if (a.date && a.list !== 'backlog') { s.moveTaskList(row.id, 'today', a.date); said.push(a.date === day ? 'today' : a.date) }
        if (a.slot) {
          if (row.list !== 'today' && !a.list && !a.date) s.moveTaskList(row.id, 'today', day)
          s.assignSlot(row.id, a.slot)
          said.push(slotWord(a.slot) ?? a.slot)
        }
        if (a.at) { s.setTaskAt(row.id, a.at === 'none' ? undefined : a.at); said.push(a.at === 'none' ? 'no fixed time' : a.at) }
        if (a.space && a.space !== 'all' && a.space !== row.space) { s.setTaskSpace(row.id, a.space); said.push(SPACE_LABELS[a.space]) }
        let movedProject = false
        if (a.project) {
          const { row: p } = pickBy(s.projects, (x) => x.name, a.project)
          if (p) { s.setTaskProject(row.id, p.id); said.push(p.name); movedProject = true } else said.push(`(no project called "${a.project}")`)
        }
        return yes(`Moved to ${[...new Set(said)].join(', ')}: ${row.title}`, () => {
          s.moveTaskList(row.id, was.list, was.plannedOn)
          if (was.slot) s.assignSlot(row.id, was.slot)
          if (a.at) s.setTaskAt(row.id, was.at)
          if (was.space && a.space && a.space !== 'all') s.setTaskSpace(row.id, was.space)
          if (movedProject) s.setTaskProject(row.id, was.projectId)
        })
      }
      case 'estimate': {
        const wasMin = row.estimateMin
        s.setEstimate(row.id, a.min!)
        return yes(`${fmtDuration(a.min!)} on ${row.title}`, () => s.setEstimate(row.id, wasMin))
      }
      case 'rename': {
        const was = row.title
        s.updateTask(row.id, { title: a.title })
        return yes(`Renamed "${was}" to: ${a.title}`, () => s.updateTask(row.id, { title: was }))
      }
      case 'drop':
        s.deleteTask(row.id)
        return yes(`Deleted: ${row.title}`)
      default:
        return no('nothing here to run')
    }
  }
}
