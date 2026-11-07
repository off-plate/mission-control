/* Bulk task tools: a dictated list in ONE call, all or nothing. Each item is handled by the same
   single-task function the one-task tools use (ops-tasks.ts), so nothing a batch does is new. One
   bad item (unknown task, ambiguous words, a duplicate, a bad date) refuses the whole batch, names
   the item by its place in the list, and changes nothing. At most 60 items per call. */
import * as t from './ops-tasks.ts'
import type { Reg } from './reg.ts'

export function register(r: Reg): void {
  const { z, write, ann, s } = r
  const { space, slot, ref, steps } = s
  const tf = z.enum(['weekly', 'monthly', 'quarter', 'half'])
  const MAX = t.BULK_MAX
  const refs = z.array(z.object(ref)).min(1).max(MAX)

  r.tool('add_tasks', {
    title: 'Add many tasks',
    description: `Create up to ${MAX} tasks in one go, all or nothing: if any item is refused (empty title, bad date or time, unknown project, a duplicate of an open task or of an earlier item in the same list) NOTHING is added and the answer names the first bad item. Each item takes the same fields as add_task (title, space, project, date, at, slot, minutes, steps, list, allow_duplicate); the tasks end up in the order given. Extras per item: horizon (+ period_key) puts it on a period of the Goals page, goal (+ goal_amount) makes finishing it count toward a goal (any running hand-counted goal). Minutes only when he said how long.`,
    inputSchema: z.object({ items: z.array(z.object({ title: z.string(), space: space.optional(), project: z.string().optional(), date: z.string().optional(), at: z.string().optional(), slot: slot.optional(), minutes: z.number().int().min(1).optional(), steps: steps.optional(), list: z.enum(['today', 'backlog']).optional(), allow_duplicate: z.boolean().optional(), horizon: tf.optional(), period_key: z.string().optional(), goal: z.string().optional().describe('Goal id or part of its name'), goal_amount: z.number().min(1).max(1000).optional() })).min(1).max(MAX) }),
    annotations: ann.W,
  }, ({ items }) => write((b) => t.addTasks(b, items.map(({ allow_duplicate, period_key, goal, goal_amount, ...i }: any) => ({
    ...i, allowDuplicate: allow_duplicate, periodKey: period_key, goalAmount: goal_amount,
    ...(goal ? { goal: b.goals?.some((g: any) => g.id === goal) ? { id: goal } : { title: goal } } : {}),
  })))))

  r.tool('complete_tasks', {
    title: 'Finish many tasks',
    description: `Mark up to ${MAX} tasks done in one go, all or nothing (an unknown or ambiguous task refuses the whole list and names it). Each task is found by id or by part of its title. Credits the goal each one counts toward exactly as complete_task does, once per task that was open. Does not log time.`,
    inputSchema: z.object({ tasks: refs }),
    annotations: ann.WI,
  }, ({ tasks }) => write((b) => t.completeTasks(b, tasks)))

  r.tool('reopen_tasks', {
    title: 'Reopen many tasks',
    description: `Mark up to ${MAX} finished tasks as not done in one go, all or nothing. Takes back what each added to its goal, exactly as reopen_task does.`,
    inputSchema: z.object({ tasks: refs }),
    annotations: ann.WI,
  }, ({ tasks }) => write((b) => t.reopenTasks(b, tasks)))

  r.tool('delete_tasks', {
    title: 'Delete many tasks',
    description: `Delete up to ${MAX} tasks for good in one go, all or nothing (an unknown or ambiguous task refuses the whole list and nothing is deleted). The same task named twice is deleted once. Confirm the list with the user first unless they asked for exactly this.`,
    inputSchema: z.object({ tasks: refs }),
    annotations: ann.D,
  }, ({ tasks }) => write((b) => t.deleteTasks(b, tasks)))

  r.tool('update_tasks', {
    title: 'Change many tasks',
    description: `Change up to ${MAX} tasks in one go, all or nothing. Each item names its task (id, or part of the title) and the fields to change, as update_task: new_title, minutes, space, project (null leaves its project), at (null unpins), slot, list, date. Only the fields given change. Tasks are found as they are NOW, before any item is applied; the same task in two items is refused (put all its changes in one item).`,
    inputSchema: z.object({ items: z.array(z.object({ ...ref, new_title: z.string().optional(), minutes: z.number().int().min(1).optional(), space: space.optional(), project: z.string().nullable().optional(), at: z.string().nullable().optional(), slot: slot.optional(), list: z.enum(['today', 'backlog']).optional(), date: z.string().optional() })).min(1).max(MAX) }),
    annotations: ann.WI,
  }, ({ items }) => write((b) => t.updateTasks(b, items.map(({ new_title, ...i }: any) => ({ ...i, newTitle: new_title })))))
}
