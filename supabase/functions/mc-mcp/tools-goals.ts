/* Goals, and the task <-> goal bridge. Every tool is a port of what the app (or its in-app assistant)
   does; the file and function are named in ops-goals.ts.

   NOT supported (the descriptions say so, so Claude does not promise it):
   - changing a goal's timeframe (the app leaves its period behind), editing or adding milestones
     after creation, a deadline, colour or icon, tying a goal to a habit
   - setting a number on a goal that counts itself from a habit, or on one measured in its milestones
   - the app also CLOSES a goal when its period has ended; that happens when the app is opened and
     is not done from here
   - deleting a project together with more than one task (the writer's safety stop) */
import * as g from './ops-goals.ts'
import type { Reg } from './reg.ts'

export function register(r: Reg): void {
  const { z, read, write, ann, s } = r
  const { space, ref } = s
  const tf = z.enum(['weekly', 'monthly', 'quarter', 'half'])
  const cat = z.enum(['money', 'health', 'life', 'work', 'offplate', 'habits'])
  const goalRef = { id: ref.id, title: z.string().optional().describe('Part of the goal name, if no id. Must match exactly one open goal.') }
  const projRef = { id: ref.id, name: z.string().optional().describe('Part of the project name, if no id. Must match exactly one project.') }
  const projOf = (i: any) => ({ id: i.id, title: i.name })

  /* ---------------- read ---------------- */
  r.tool('list_goals', {
    title: 'List goals',
    description: 'Goals with their real progress, the way the Goals page counts it: a goal tied to a habit is counted from that habit over the goal\'s own period (never the stored number), a closed goal keeps the number it finished on. Shows the period (key and dates), milestones, the last amounts logged, the tasks that feed it (finishing them adds to it) and the tasks committed to its period. where: open (default), closed, all. Start here to get goal ids.',
    inputSchema: z.object({ where: z.enum(['open', 'closed', 'all']).optional(), timeframe: tf.optional(), space: space.optional(), query: z.string().optional().describe('Words in the name or the why'), limit: z.number().int().min(1).max(200).optional() }),
    annotations: ann.RO,
  }, (i) => read((b) => g.listGoals(b, i)))

  /* ---------------- goals ---------------- */
  r.tool('add_goal', {
    title: 'Add a goal',
    description: 'Create a goal for the CURRENT period of its timeframe (default monthly): either a target number with a unit (target 40000, unit "CZK") or a checklist of milestones (then the target is their count and the unit "milestones"). Category defaults to life, space to personal. A goal is a specific outcome, not an activity. Refuses a duplicate open goal of the same name and period unless allow_duplicate is true. Not supported here: deadline, colour, icon, tying it to a habit.',
    inputSchema: z.object({ name: z.string().max(200), target: z.number().min(1).max(1e7).optional(), unit: z.string().max(40).optional(), timeframe: tf.optional(), category: cat.optional(), why: z.string().max(300).optional().describe('Why it matters'), space: space.optional(), milestones: z.array(z.string().max(200)).max(30).optional(), allow_duplicate: z.boolean().optional() }),
    annotations: ann.W,
  }, ({ allow_duplicate, ...i }) => write((b) => g.addGoal(b, { ...i, allowDuplicate: allow_duplicate })))

  r.tool('edit_goal', {
    title: 'Change a goal',
    description: 'Change the name, target, unit or why of an open goal. Only the fields you pass change. A finished (closed) goal is history and is refused. The timeframe cannot be changed (the goal is bound to its period): make a new goal instead. A goal measured in its milestones keeps its target equal to their count.',
    inputSchema: z.object({ ...goalRef, name: z.string().max(200).optional(), target: z.number().min(1).max(1e7).optional(), unit: z.string().max(40).optional(), why: z.string().max(300).optional() }),
    annotations: ann.WI,
  }, ({ id, title, ...p }) => write((b) => g.editGoal(b, { id, title }, p)))

  r.tool('set_goal_progress', {
    title: 'Move a goal\'s number',
    description: 'Change the number of a hand-counted goal: by adds to it (negative subtracts, never below 0 or above the target), set replaces it (0 up to 10 million, may pass the target). Pass exactly one. Refused for a goal that counts itself from a habit, one measured in milestones (use tick_milestone), and a finished goal. For money-like goals where each amount should be on record, use log_goal_amount instead.',
    inputSchema: z.object({ ...goalRef, by: z.number().min(-1e7).max(1e7).optional(), set: z.number().min(0).max(1e7).optional() }),
    annotations: ann.W,
  }, ({ id, title, by, set }) => write((b) => g.setGoalProgress(b, { id, title }, { by, set })))

  r.tool('log_goal_amount', {
    title: 'Log an amount on a goal',
    description: 'Add a dated entry to a goal (optionally with a note such as who paid) and move its total by that amount; negative takes away, the total never goes below 0 and is NOT capped at the target. This is the goal\'s own ledger, and remove_goal_entry takes an entry back. Same refusals as set_goal_progress.',
    inputSchema: z.object({ ...goalRef, amount: z.number().min(-1e7).max(1e7), note: z.string().max(200).optional() }),
    annotations: ann.W,
  }, ({ id, title, amount, note }) => write((b) => g.logGoalAmount(b, { id, title }, amount, note)))

  r.tool('remove_goal_entry', {
    title: 'Take back a goal entry',
    description: 'Remove one logged entry from a goal and take its amount back out of the total. Get entry ids from list_goals (lastEntries).',
    inputSchema: z.object({ ...goalRef, entry_id: z.string() }),
    annotations: ann.D,
  }, ({ id, title, entry_id }) => write((b) => g.removeGoalEntry(b, { id, title }, entry_id)))

  r.tool('tick_milestone', {
    title: 'Tick a milestone',
    description: 'Tick or untick one milestone of an open goal, found by words in its label. done: true or false makes it safe to repeat; leave it out to flip. When the goal is measured in its milestones its number follows the ticked count.',
    inputSchema: z.object({ ...goalRef, milestone: z.string().describe('Part of the milestone label (or its id)'), done: z.boolean().optional() }),
    annotations: ann.WI,
  }, ({ id, title, milestone, done }) => write((b) => g.tickMilestone(b, { id, title }, { title: milestone }, done)))

  r.tool('repeat_goal', {
    title: 'Run a goal again',
    description: 'Set a finished goal again for the period we are in now: same name, target, unit, milestones (unticked), number back to 0. Safe to repeat: if this period already has it, nothing is added and that goal is returned. The old goal stays as history.',
    inputSchema: z.object(goalRef),
    annotations: ann.W,
  }, ({ id, title }) => write((b) => g.repeatGoal(b, { id, title })))

  r.tool('delete_goal', {
    title: 'Delete a goal',
    description: 'Delete a goal for good (its history goes with it). Confirm with the user first unless they asked. Tasks that fed it keep their link but stop counting.',
    inputSchema: z.object(goalRef),
    annotations: ann.D,
  }, ({ id, title }) => write((b) => g.deleteGoal(b, { id, title })))

  /* ---------------- task <-> goal ---------------- */
  r.tool('set_task_goal', {
    title: 'Make a task count toward a goal',
    description: 'Tie a task to one of THIS WEEK\'s weekly goals: finishing the task adds amount (default 1, at least 1) to the goal, reopening takes it back. Omit goal to remove the link. The link lives on the task only. Refused for non-weekly, past, finished, habit-fed or milestone goals. NOTE: the credit is applied when the task is finished; check that complete_task in this connector credits goals before relying on it, otherwise the goal must be moved by hand.',
    inputSchema: z.object({ ...ref, goal_id: z.string().optional(), goal: z.string().optional().describe('Part of the goal name, if no goal_id'), amount: z.number().min(1).max(1000).optional() }),
    annotations: ann.WI,
  }, ({ id, title, goal_id, goal, amount }) => write((b) => g.setTaskGoal(b, { id, title }, goal_id || goal ? { id: goal_id, title: goal } : null, amount)))

  r.tool('commit_task', {
    title: 'Commit a task to a period',
    description: 'Put a task on a period of the Goals page ("one of the things this month is for"), or take it off with horizon: null. horizon is weekly, monthly, quarter or half; the period is the current one unless period_key (like 2026-W45, 2026-11, 2026-Q4, 2026-H2) pins another. It is the same task, not a copy.',
    inputSchema: z.object({ ...ref, horizon: tf.nullable(), period_key: z.string().optional() }),
    annotations: ann.WI,
  }, ({ id, title, horizon, period_key }) => write((b) => g.commitTask(b, { id, title }, horizon, period_key)))

  /* ---------------- projects ---------------- */
  r.tool('delete_project', {
    title: 'Delete a project',
    description: 'Delete a project. mode "move" (default and safe): its tasks stay as ordinary tasks of the space. mode "delete": the tasks go too, but only when the project holds at most ONE task (more is refused; delete them one by one first). Confirm with the user first unless they asked.',
    inputSchema: z.object({ ...projRef, mode: z.enum(['move', 'delete']).optional() }),
    annotations: ann.D,
  }, (i) => write((b) => g.deleteProject(b, projOf(i), i.mode ?? 'move')))

  r.tool('set_project_tag', {
    title: 'Set a project\'s hashtag',
    description: 'Give a project a hand-picked hashtag (letters, digits, - and _, no #). If another project already answers to it, a number is added (home becomes home2) and the answer says so. An empty tag puts it back to following the project name.',
    inputSchema: z.object({ ...projRef, tag: z.string().max(60) }),
    annotations: ann.WI,
  }, (i) => write((b) => g.setProjectTag(b, projOf(i), i.tag)))

  r.tool('set_project_color', {
    title: 'Set a project\'s colour',
    description: `Pick a project's colour from the app's palette: ${g.HUE_IDS.join(', ')}.`,
    inputSchema: z.object({ ...projRef, color: z.enum(g.HUE_IDS) }),
    annotations: ann.WI,
  }, (i) => write((b) => g.setProjectHue(b, projOf(i), i.color)))

}
