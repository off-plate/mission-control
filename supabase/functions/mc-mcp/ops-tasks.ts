/* Bulk task operations: many tasks in ONE all-or-nothing commit.

   NO Deno, NO network. Each item is handled by the single-task function it is named after
   (ops.ts addTask / updateTask / completeTask / reopenTask / deleteTask, which are ports of
   src/store/planner.ts), so a batch can never do something one call could not. The writer
   (commit.ts) works on a copy and writes only if nothing threw, so one bad item means NOTHING
   was changed; the refusal names the first bad item by its place in the list.

   Rules:
   - every reference (id or words) is resolved against the state AS IT WAS, before any item
     is applied, so an earlier item cannot change what a later one means (a retitle, a delete)
   - at most BULK_MAX items
   - finishing / reopening credits the task's goal exactly as complete_task / reopen_task do
     (store.tsx toggleTask -> creditGoal, ops-goals.ts creditGoal)
   - deleting declares its cascade with allowShrink (exactly the extra rows it removes) and buries
     every key (the single deleteTask does the burying) */

import {
  McError, addTask, allowShrink, completeTask, deleteTask, findTask, reopenTask, updateTask,
  type AddTaskInput, type Blob, type Ref, type UpdateTaskInput,
} from './ops.ts'
import { commitTask, creditGoal, setTaskGoal, type GoalTf } from './ops-goals.ts'

export const BULK_MAX = 60

function sized(items: unknown, what: string): any[] {
  if (!Array.isArray(items) || !items.length) throw new McError(`Pass at least one item in ${what}.`)
  if (items.length > BULK_MAX) throw new McError(`${items.length} items is over the limit of ${BULK_MAX} per call. Split it into batches of ${BULK_MAX} or fewer. Nothing was changed.`)
  return items
}
/** Run one item; a refusal is re-thrown naming the item, so the whole batch stops. */
function item<T>(i: number, label: string, fn: () => T): T {
  try { return fn() } catch (e) {
    if (e instanceof McError) throw new McError(`Item ${i + 1} (${label}): ${e.message} Nothing was changed.`)
    throw e
  }
}
const labelOf = (r: { id?: string; title?: string }) => (r.id ? `id ${r.id}` : `"${r.title ?? ''}"`)

export interface BulkAddItem extends AddTaskInput {
  /** put it on a period of the Goals page (goals.tsx PeriodTasks "Add as a new task") */
  horizon?: GoalTf
  periodKey?: string
  /** make finishing it count toward a goal (planner.ts setTaskGoal) */
  goal?: Ref
  goalAmount?: number
}

/** Add many. A duplicate of an open task, or of an item earlier in the same batch, refuses the batch
 *  unless that item says allowDuplicate. The new tasks end up in the order they were given. */
export function addTasks(b: Blob, items: BulkAddItem[]): { text: string } {
  const list = sized(items, 'items')
  const made: { id: string; title: string; text: string }[] = []
  list.forEach((it: BulkAddItem, i) => item(i, `"${String(it?.title ?? '').slice(0, 60)}"`, () => {
    const { horizon, periodKey, goal, goalAmount, ...base } = it
    const res = addTask(b, base)
    if (horizon !== undefined) commitTask(b, { id: res.id }, horizon, periodKey)
    else if (periodKey !== undefined) throw new McError('period_key goes with a horizon.')
    if (goal) setTaskGoal(b, { id: res.id }, goal, goalAmount)
    else if (goalAmount !== undefined) throw new McError('goal_amount goes with a goal.')
    made.push({ id: res.id, title: String(b.tasks.find((t: any) => t.id === res.id)?.title ?? base.title), text: res.text })
  }))
  // addTask puts each new row on top, which would list the batch backwards; keep the order given.
  const fresh = b.tasks.splice(0, made.length).reverse()
  b.tasks.unshift(...fresh)
  return { text: `Added ${made.length} task${made.length === 1 ? '' : 's'}:\n${made.map((m) => `- ${m.title} (${m.id})`).join('\n')}` }
}

/** Resolve every reference first, against the untouched state. */
function resolve(b: Blob, refs: Ref[], what: string): any[] {
  return sized(refs, what).map((r: Ref, i) => item(i, labelOf(r ?? {}), () => findTask(b, r ?? {})))
}

export function completeTasks(b: Blob, refs: Ref[]): { text: string } {
  const tasks = resolve(b, refs, 'tasks')
  const lines: string[] = []
  tasks.forEach((t, i) => item(i, labelOf(refs[i]), () => {
    const was = !!t.done
    const res = completeTask(b, { id: t.id })
    const fed = !was ? creditGoal(b, t, 1) : null // store.tsx toggleTask: credit when it goes from open to done
    lines.push(fed ? `${res.text} Goal: ${fed}.` : res.text)
  }))
  return { text: `${tasks.length} task${tasks.length === 1 ? '' : 's'} processed:\n${lines.map((l) => `- ${l}`).join('\n')}` }
}

export function reopenTasks(b: Blob, refs: Ref[]): { text: string } {
  const tasks = resolve(b, refs, 'tasks')
  const lines: string[] = []
  tasks.forEach((t, i) => item(i, labelOf(refs[i]), () => {
    const was = !!t.done
    const res = reopenTask(b, { id: t.id })
    const fed = was ? creditGoal(b, t, -1) : null
    lines.push(fed ? `${res.text} Goal: ${fed}.` : res.text)
  }))
  return { text: `${tasks.length} task${tasks.length === 1 ? '' : 's'} processed:\n${lines.map((l) => `- ${l}`).join('\n')}` }
}

/** Delete many. The same task named twice is deleted once. */
export function deleteTasks(b: Blob, refs: Ref[]): { text: string } {
  const found = resolve(b, refs, 'tasks')
  const ids = [...new Set(found.map((t) => t.id as string))]
  const titles = ids.map((id) => String(found.find((t) => t.id === id)!.title))
  allowShrink(b, 'tasks', ids.length - 1) // the writer's stop already allows one removed row
  ids.forEach((id, i) => item(i, `"${titles[i]}"`, () => deleteTask(b, { id })))
  return { text: `Deleted ${ids.length} task${ids.length === 1 ? '' : 's'}:\n${titles.map((t) => `- ${t}`).join('\n')}\n(Not recoverable from here.)` }
}

/** Update many. Each item names its task (id or words in the title) and the fields to change; the
 *  new title, if any, is `title` in UpdateTaskInput, passed here as newTitle. */
export function updateTasks(b: Blob, items: (Ref & { newTitle?: string } & Omit<UpdateTaskInput, 'title'>)[]): { text: string } {
  const list = sized(items, 'items')
  const tasks = resolve(b, list.map((x) => ({ id: x.id, title: x.title })), 'items')
  const seen = new Map<string, number>()
  tasks.forEach((t, i) => {
    if (seen.has(t.id)) throw new McError(`Item ${i + 1} (${labelOf(list[i])}): this is the same task as item ${seen.get(t.id)! + 1}. Put all its changes in one item. Nothing was changed.`)
    seen.set(t.id, i)
  })
  const lines: string[] = []
  tasks.forEach((t, i) => item(i, labelOf(list[i]), () => {
    const { id: _id, title: _t, newTitle, ...rest } = list[i]
    lines.push(updateTask(b, { id: t.id }, { ...rest, ...(newTitle !== undefined ? { title: newTitle } : {}) }).text)
  }))
  return { text: `Updated ${tasks.length} task${tasks.length === 1 ? '' : 's'}:\n${lines.map((l) => `- ${l}`).join('\n')}` }
}
