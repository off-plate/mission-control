/* Goals, and the task <-> goal bridge. Every tool is a port of what the app (or its in-app assistant)
   does; the file and function are named in ops-goals.ts.

   NOT supported (the descriptions say so, so Claude does not promise it): a goal's colour or icon (no page of the
   app sets them), a number set by hand on a goal that counts itself from a habit or is measured in its
   milestones (derived), changing a finished goal's period, habit or milestones (history). */
import * as g from './ops-goals.ts'
import type { Reg } from './reg.ts'

export function register(r: Reg): void {
  const { z, read, write, ann, s } = r
  const { space, ref } = s
  const tf = z.enum(['weekly', 'monthly', 'quarter', 'half'])
  const cat = z.enum(['money', 'health', 'life', 'work', 'offplate', 'habits'])
  const goalRef = { id: ref.id, title: z.string().optional().describe('Part of the goal name, if no id. Must match exactly one goal (a running goal is preferred over a finished one of the same name).') }
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
    description: 'Create a goal for the CURRENT period of its timeframe (default monthly), or for another period with period_key (like 2026-W46, 2026-12, 2026-Q4, 2026-H2) to plan ahead. Either a target number with a unit (target 40000, unit "CZK"), a checklist of milestones (then the target is their count and the unit "milestones"), or counted from one of his habits (habit: name or id; it counts itself from the habit\'s check-offs or focus time, so give a target and no unit or milestones; the name defaults to the habit\'s). Optional: why, deadline (free text such as "End of July"), category (default life), space (default personal, or the habit\'s). Refuses a duplicate open goal of the same name and period unless allow_duplicate is true. Not settable anywhere in the app, so not here: colour, icon.',
    inputSchema: z.object({ name: z.string().max(200).optional(), target: z.number().min(1).max(1e7).optional(), unit: z.string().max(40).optional(), timeframe: tf.optional(), category: cat.optional(), why: z.string().max(300).optional().describe('Why it matters'), deadline: z.string().max(100).optional(), space: space.optional(), milestones: z.array(z.string().max(200)).max(30).optional(), habit: z.string().optional().describe('A habit (id or part of its name) the goal counts itself from'), period_key: z.string().optional(), allow_duplicate: z.boolean().optional() }),
    annotations: ann.W,
  }, ({ allow_duplicate, period_key, ...i }) => write((b) => g.addGoal(b, { ...i, periodKey: period_key, allowDuplicate: allow_duplicate })))

  r.tool('edit_goal', {
    title: 'Change a goal',
    description: 'Change anything the Goals page\'s edit sheet changes. Only the fields you pass change: name, target, unit, why and deadline (empty string clears), category, timeframe, milestones, habit. timeframe moves the goal to the period RUNNING NOW for the new timeframe (as saving the sheet does; the logged entries and the number are kept, the period key changes); move_to_current_period: true does the same without changing the timeframe. milestones is the FULL list of labels the goal should have (a label that stays keeps its tick; the target becomes their count). habit (name or id) makes it count itself from that habit; habit: null goes back to logging by hand and keeps the number it showed. A finished goal can still have its name, target, unit, why, deadline and category corrected, but not its period, habit or milestones (use repeat_goal to run it again). A goal measured in its milestones keeps target = their count.',
    inputSchema: z.object({ ...goalRef, name: z.string().max(200).optional(), target: z.number().min(1).max(1e7).optional(), unit: z.string().max(40).optional(), why: z.string().max(300).nullable().optional(), deadline: z.string().max(100).nullable().optional(), category: cat.optional(), timeframe: tf.optional(), milestones: z.array(z.string().max(200)).max(30).optional(), habit: z.string().nullable().optional(), move_to_current_period: z.boolean().optional() }),
    annotations: ann.WI,
  }, ({ id, title, move_to_current_period, ...p }) => write((b) => g.editGoal(b, { id, title }, { ...p, moveToCurrentPeriod: move_to_current_period })))

  r.tool('close_ended_goals', {
    title: 'Close goals whose period has ended',
    description: 'What the app does by itself every time it is opened: every running goal whose period is over is closed and keeps the number it finished on (counted from its habit over its own period when it has one); a finished goal that counts itself from a habit is renewed for the period running now. Nothing is deleted. list_goals shows which goals are "ended" but not yet closed. Safe to repeat.',
    inputSchema: z.object({}),
    annotations: ann.WI,
  }, () => write((b) => g.closeEndedGoals(b)))

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
    description: 'Tie a task to a goal: finishing the task adds amount (default 1, at least 1) to the goal, reopening takes it back. Omit goal to remove the link. The link lives on the task only. Works for any running goal, weekly or not (the app\'s plan menu only offers this week\'s, but its credit rule feeds any running goal). Refused for finished, habit-fed or milestone-measured goals (the app never credits those). The credit is applied by complete_task / complete_tasks and taken back by reopen_task / reopen_tasks.',
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
    description: 'Delete a project. mode "move" (default): its tasks stay as ordinary tasks of the space. mode "delete": all its tasks are deleted with it, however many (the answer says how many; they cannot be brought back from here). Confirm with the user first unless they asked.',
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
