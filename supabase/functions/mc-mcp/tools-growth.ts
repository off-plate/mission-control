/* Growth: habits, quitting habits, routines (a routine is a folder of habits), slips, amount and
   times habits. Ports of src/store/growth.ts, see ops-growth.ts for the rule behind each tool.

   This module OWNS tick_habit and list_habits. At integration, core's tick_habit, list_habits and
   ops.tickHabit are removed in favour of these (same parameters id / title / day / done, plus alt). */
import * as g from './ops-growth.ts'
import type { Reg } from './reg.ts'

export function register(r: Reg): void {
  const { z, read, write, ann, s } = r
  const { ref, slot } = s
  const idOrWords = { id: ref.id, title: ref.title }
  const stepRef = {
    step_id: z.string().optional().describe('Exact step id from list_routines (preferred)'),
    step: z.string().optional().describe('Part of the step title, if no step_id. Must match exactly one step.'),
  }
  const daypart = z.enum(['morning', 'noon', 'afternoon', 'evening'])
  const freq = z.enum(['daily', 'weekdays', 'times-per-week', 'weekly', 'monthly'])
  const cadence = z.enum(['daily', 'prework', 'weekly', 'monthly'])
  const per = z.enum(['day', 'week', 'month'])

  /* ---------------- reads ---------------- */
  r.tool('list_habits', {
    title: 'List habits',
    description: 'Every habit (not the archived ones) with HOW it is kept, which decides the tool: track "check" = tick_habit; "count" = habit_count; "amount" = log_habit_amount; "quit" = log_slip only when he slipped; "alts" = tick_habit with alt; "gated" = a number he must reach (habit_count); "routine" = the streak of a routine, set by its steps; "auto" = fills itself from focus minutes, nothing to do. Shows today, the streak, quit days clean, counts and amounts. Use it first to get real ids.',
    inputSchema: z.object({ query: z.string().optional().describe('Words in the habit name'), space: s.space.optional() }), annotations: ann.RO,
  }, (i) => read((b) => g.listHabits(b, i)))
  r.tool('list_routines', {
    title: 'List routines',
    description: 'Routines (a routine is a folder of steps) with each step, whether it is done this period, progress, whether the routine is finished, any planned slot, and which steps are locked or need a chosen alternative. Use it first to get real routine and step ids.',
    inputSchema: z.object({ query: z.string().optional().describe('Words in the routine title') }), annotations: ann.RO,
  }, (i) => read((b) => g.listRoutines(b, i)))

  /* ---------------- ticking ---------------- */
  r.tool('tick_habit', {
    title: 'Keep a habit',
    description: 'Tick a habit for a day (default today, never a future day), or untick it with done: false. A habit that is a step of a routine also updates that routine (its step, its progress, and the routine finishing). Unticking leaves a tombstone so a stale device cannot hand the tick back. REFUSES with the reason: quit habits (log_slip), counted habits (habit_count), amount habits (log_habit_amount), habits kept by focus minutes, a routine\'s own streak for today (use routine_step / routine_done), a gated habit today (needs the real number via habit_count), a paused habit. A habit with alternatives takes alt (an alternative id or words): picking another replaces the choice, picking the same one again clears it. Not supported: choosing a day for an alternative.',
    inputSchema: z.object({ ...idOrWords, day: z.string().optional().describe('YYYY-MM-DD, not in the future'), done: z.boolean().optional(), alt: z.string().optional().describe('For a habit with alternatives: the alternative id or words in its title') }), annotations: ann.WI,
  }, ({ id, title, day, done, alt }) => write((b) => g.tickHabit(b, { id, title }, { day, done, alt })))

  r.tool('habit_count', {
    title: 'Count a habit',
    description: 'For a COUNTED habit (list_habits track "count"): value 1 = he did it once, value 2 = twice, value -1 = take the last one back (today only; one at a time). For a habit that is a routine step with a recorded number (the typing test): value = his real result, which keeps the day only if it reaches the gate (75 WPM). Only with a number he actually gave. Not for ticked, amount or quit habits.',
    inputSchema: z.object({ ...idOrWords, value: z.number().describe('How many (counted habit) or his real result (a step number)') }), annotations: ann.W,
  }, ({ id, title, value }) => write((b) => g.habitCount(b, { id, title }, value)))

  r.tool('log_habit_amount', {
    title: 'Log an amount',
    description: 'For an AMOUNT habit (water in ml, pages, ...): add what he did today, e.g. 250. The day counts as kept once the total reaches the habit\'s target. Only an amount he gave. Today only.',
    inputSchema: z.object({ ...idOrWords, amount: z.number().positive() }), annotations: ann.W,
  }, ({ id, title, amount }) => write((b) => g.logAmount(b, { id, title }, amount)))
  r.tool('remove_habit_amount', {
    title: 'Take back an amount',
    description: 'Remove one logged amount from an amount habit: the newest entry made today, or a specific one by its entry id (src from browse habitLog). One entry per call. Only for amount habits.',
    inputSchema: z.object({ ...idOrWords, entry: z.string().optional().describe('The src of the entry, e.g. amt#...') }), annotations: ann.D,
  }, ({ id, title, entry }) => write((b) => g.removeAmount(b, { id, title }, entry)))

  /* ---------------- quitting ---------------- */
  r.tool('log_slip', {
    title: 'Log a slip',
    description: 'Record a slip on a habit he is QUITTING (a habit with breaking: true). Only when he says he slipped. Default today, or a past day since he stopped. One slip per day; it restarts his clean-days count. Quit habits need no daily tick: every day since he stopped counts as kept.',
    inputSchema: z.object({ ...idOrWords, day: z.string().optional().describe('YYYY-MM-DD, not in the future, not before he stopped') }), annotations: ann.WI,
  }, ({ id, title, day }) => write((b) => g.logSlip(b, { id, title }, day)))
  r.tool('undo_slip', {
    title: 'Take back a slip',
    description: 'Remove a slip that was logged by mistake (what the app\'s undo toast does). Leaves a tombstone. Only when he says it was a mistake: a real slip is a fact.',
    inputSchema: z.object({ ...idOrWords, day: z.string().optional().describe('YYYY-MM-DD, default today') }), annotations: ann.D,
  }, ({ id, title, day }) => write((b) => g.undoSlip(b, { id, title }, day)))

  /* ---------------- habits: add, edit, pause, archive ---------------- */
  r.tool('add_habit', {
    title: 'Add a habit',
    description: 'Create a habit. Plain tick habit by default. breaking: true = something he is QUITTING (every day since quit_since counts as kept; allowed with name, space, quit_since, daily_cost only). track "count" = counted (count_target per count_per, default 1 a day); track "amount" = needs unit and target_amount (and optional presets). started_on (not older than 366 days) marks the days from then until yesterday as kept, because "I have been doing this since June" is a claim about days. Refuses a name that already exists. Not supported: colours, icons, focus-minute habits, gated habits.',
    inputSchema: z.object({
      name: z.string(), space: s.space.optional(), daypart: daypart.optional(), frequency: freq.optional(), per_week: z.number().int().min(1).max(7).optional().describe('Only with frequency times-per-week'),
      breaking: z.boolean().optional(), quit_since: z.string().optional().describe('YYYY-MM-DD, default today'), daily_cost: z.number().min(0).optional().describe('A quit\'s cost per day, for money saved'),
      started_on: z.string().optional().describe('YYYY-MM-DD, default today'),
      track: z.enum(['check', 'count', 'amount']).optional(), count_target: z.number().int().min(1).optional(), count_per: per.optional(),
      unit: z.string().optional(), target_amount: z.number().positive().optional(), presets: z.array(z.number().positive()).max(12).optional(),
    }), annotations: ann.W,
  }, ({ per_week, quit_since, daily_cost, started_on, count_target, count_per, target_amount, ...i }) =>
    write((b) => g.addHabit(b, { ...i, perWeek: per_week, quitSince: quit_since, dailyCost: daily_cost, startedOn: started_on, countTarget: count_target, countPer: count_per, targetAmount: target_amount })))
  r.tool('edit_habit', {
    title: 'Change a habit',
    description: 'Change only the fields passed: new_name, frequency, per_week, daypart (null = any time of day), count_target / count_per (counted habits), quit_since / daily_cost (quit habits), started_on (moving it EARLIER marks the newly covered days kept; later never un-ticks a day). A routine\'s own streak habit follows its routine (name and frequency are refused). Not supported: changing the kind of habit, unit or target amount.',
    inputSchema: z.object({
      ...idOrWords, new_name: z.string().optional(), frequency: freq.optional(), per_week: z.number().int().min(1).max(7).optional(), daypart: daypart.nullable().optional(),
      count_target: z.number().int().min(1).optional(), count_per: per.optional(), quit_since: z.string().optional(), daily_cost: z.number().min(0).optional(), started_on: z.string().optional(),
    }), annotations: ann.WI,
  }, ({ id, title, new_name, per_week, count_target, count_per, quit_since, daily_cost, started_on, ...p }) =>
    write((b) => g.editHabit(b, { id, title }, { ...p, newName: new_name, perWeek: per_week, countTarget: count_target, countPer: count_per, quitSince: quit_since, dailyCost: daily_cost, startedOn: started_on })))
  r.tool('pause_habit', {
    title: 'Pause or resume a habit',
    description: 'Pause a habit (it stops being due) or resume it. paused: true / false is explicit; leave it out to flip the current state, as the app\'s menu does. Not supported: pausing a whole routine.',
    inputSchema: z.object({ ...idOrWords, paused: z.boolean().optional() }), annotations: ann.W,
  }, ({ id, title, paused }) => write((b) => g.pauseHabit(b, { id, title }, paused)))
  r.tool('archive_habit', {
    title: 'Archive a habit',
    description: 'Retire a habit or quit: it leaves his lists, its history stays. Confirm first unless he asked. Refuses a routine\'s own streak habit (delete the routine). Restoring is only possible in the app.',
    inputSchema: z.object(idOrWords), annotations: ann.D,
  }, ({ id, title }) => write((b) => g.archiveHabit(b, { id, title })))

  /* ---------------- routines ---------------- */
  r.tool('add_routine', {
    title: 'Add a routine',
    description: 'Create a routine (a folder of steps) with its own streak habit, optionally with steps in order. cadence: daily (default), prework (weekdays), weekly, monthly. Steps added here live on the routine card; the app\'s own routine builder is where per-step habits are made. Refuses a title that already exists.',
    inputSchema: z.object({ title: z.string(), cadence: cadence.optional(), blurb: z.string().max(300).optional(), daypart: daypart.optional(), space: s.space.optional(), steps: z.array(z.string()).max(40).optional() }), annotations: ann.W,
  }, (i) => write((b) => g.addRoutine(b, i)))
  r.tool('edit_routine', {
    title: 'Change a routine',
    description: 'Change a routine\'s title (its streak habit is renamed too), cadence or blurb. Only the fields passed change. Changing the cadence takes effect when the next period starts.',
    inputSchema: z.object({ ...idOrWords, new_title: z.string().optional(), cadence: cadence.optional(), blurb: z.string().max(300).optional() }), annotations: ann.WI,
  }, ({ id, title, new_title, ...p }) => write((b) => g.editRoutine(b, { id, title }, { ...p, title: new_title })))
  r.tool('delete_routine', {
    title: 'Delete a routine',
    description: 'Delete a routine and its streak habit (they are archived: their history stays). Confirm first unless he asked. Refuses when a goal counts off the routine\'s habit (unlink the goal first). Habits made from its steps are left as habits.',
    inputSchema: z.object(idOrWords), annotations: ann.D,
  }, ({ id, title }) => write((b) => g.deleteRoutine(b, { id, title })))
  r.tool('routine_step', {
    title: 'Tick a routine step',
    description: 'Tick or untick one step of a routine (done: true / false; leave it out to flip it). Updates the step\'s habit, the routine\'s progress and record, and the routine\'s own streak when the last required step lands. REFUSES: the typing test until 75 WPM, a step whose habit is gated by a number (habit_count), and a step with alternatives unless alt is given (alternative id or words). Un-finishing a routine by unticking its last step removes two records at once and is refused: untick another step first, or use the app.',
    inputSchema: z.object({ ...idOrWords, ...stepRef, done: z.boolean().optional(), alt: z.string().optional() }), annotations: ann.W,
  }, ({ id, title, step_id, step, done, alt }) => write((b) => g.routineStep(b, { id, title }, { stepId: step_id, step }, { done, alt })))
  r.tool('add_routine_step', {
    title: 'Add a routine step',
    description: 'Append a step to a routine. A new required step reopens a routine that was already finished this period (the result says so). At most 40 steps; refuses a duplicate step title. Not supported: inserting in the middle, or making the step its own habit (the app\'s routine builder does that).',
    inputSchema: z.object({ ...idOrWords, step: z.string() }), annotations: ann.W,
  }, ({ id, title, step }) => write((b) => g.addRoutineStep(b, { id, title }, step)))
  r.tool('remove_routine_step', {
    title: 'Remove a routine step',
    description: 'Remove one step from a routine. The step\'s own habit, if it has one, stays (archive_habit removes it). Confirm first unless asked.',
    inputSchema: z.object({ ...idOrWords, ...stepRef }), annotations: ann.D,
  }, ({ id, title, step_id, step }) => write((b) => g.removeRoutineStep(b, { id, title }, { stepId: step_id, step })))
  r.tool('routine_done', {
    title: 'Finish or reopen a routine',
    description: 'done: true (default) ticks every REQUIRED step of the routine for this period (optional steps he did not tick are not claimed; a step that must be earned with a number, like the typing test, is left open so the routine then stays unfinished). done: false reopens everything; with many ticked steps that removes too many records at once and is refused, so untick steps one at a time instead.',
    inputSchema: z.object({ ...idOrWords, done: z.boolean().optional() }), annotations: ann.WI,
  }, ({ id, title, done }) => write((b) => g.routineDone(b, { id, title }, done !== false)))
  r.tool('plan_routine', {
    title: 'Plan a routine on the day',
    description: 'Put a routine on a day\'s list at a part of the day (slot) without starting it. date defaults to today, never a past day. clear: true removes the plan. A routine reaches the day by being planned or started; nothing is copied.',
    inputSchema: z.object({ ...idOrWords, slot: slot.optional(), date: z.string().optional().describe('YYYY-MM-DD'), clear: z.boolean().optional() }), annotations: ann.WI,
  }, ({ id, title, slot: sl, date, clear }) => write((b) => g.planRoutine(b, { id, title }, { slot: sl, date, clear })))
}
