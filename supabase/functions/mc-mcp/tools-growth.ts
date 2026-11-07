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
  const color = z.enum(g.PALETTE as [string, ...string[]]).describe('One of the Habits page\'s swatches (hex)')
  const icon = z.enum(g.ICON_KEYS as [string, ...string[]]).describe('One of the Habits page\'s icons')

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
    description: 'Tick a habit for a day (default today, never a future day), or untick it with done: false. A paused habit can be ticked, as in the app. A habit that is a step of a routine also updates that routine (its step, its progress, and the routine finishing); unticking a step of a finished routine takes back the routine\'s finish and its own streak too. A routine\'s OWN streak habit: today it is done through the routine (this calls routine_done), a past day is corrected directly. Unticking leaves a tombstone so a stale device cannot hand the tick back. A habit with alternatives takes alt (an alternative id or words): picking another replaces the choice, picking the same one again clears it, and done: false clears whichever he picked. REFUSES, with the reason and the tool to use: quit habits (log_slip), counted habits (habit_count), amount habits (log_habit_amount), habits kept by focus minutes (nothing to tick), a gated habit today (needs the real number via habit_count), and a habit with alternatives ticked without saying which one.',
    inputSchema: z.object({ ...idOrWords, day: z.string().optional().describe('YYYY-MM-DD, not in the future'), done: z.boolean().optional(), alt: z.string().optional().describe('For a habit with alternatives: the alternative id or words in its title') }), annotations: ann.WI,
  }, ({ id, title, day, done, alt }) => write((b) => g.tickHabit(b, { id, title }, { day, done, alt })))
  r.tool('tick_habits', {
    title: 'Keep several habits',
    description: 'Tick (or untick) several habits in ONE change, all or nothing: if any one is refused, nothing is written and the answer says which. Each item is exactly one tick_habit call (id or title, optional day, done, alt). Up to 40. Use it when he reports a batch ("I did stretch, read and meditate").',
    inputSchema: z.object({ habits: z.array(z.object({ ...idOrWords, day: z.string().optional().describe('YYYY-MM-DD, not in the future'), done: z.boolean().optional(), alt: z.string().optional() })).min(1).max(40) }), annotations: ann.WI,
  }, ({ habits }) => write((b) => g.tickHabits(b, habits)))

  r.tool('habit_count', {
    title: 'Count a habit',
    description: 'For a COUNTED habit (list_habits track "count"): value 1 = he did it once, value 2 = twice, value -1 = take the last one back, -2 = the last two (today only; up to as many as are logged today). For a habit that is a routine step with a recorded number (the typing test): value = his real result, which keeps the day only if it reaches the gate (75 WPM). Works on a paused habit too, as in the app. Only with a number he actually gave. Not for ticked, amount or quit habits.',
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
    description: 'Create a habit. Plain tick habit by default. breaking: true = something he is QUITTING (every day since quit_since counts as kept; takes name, space, quit_since, daily_cost, and frequency / per_week for how often to check in, plus colour and icon). track "count" = counted (count_target 1-99 per count_per, default 1 a day); track "amount" = needs unit and target_amount (and optional presets); track "minutes" = kept by focus minutes (minutes_target 5-600 a day, default 60; it fills itself from his focus blocks). started_on marks the days from then until yesterday as kept, because "I have been doing this since June" is a claim about days; like the app it has no limit on how far back (only a typo guard before 2000). color / icon are the Habits page\'s own swatches and icons. Refuses a name that already exists. Not supported: gated habits (they come from a routine step).',
    inputSchema: z.object({
      name: z.string(), space: s.space.optional(), daypart: daypart.optional(), frequency: freq.optional(), per_week: z.number().int().min(1).max(7).optional().describe('Only with frequency times-per-week'),
      breaking: z.boolean().optional(), quit_since: z.string().optional().describe('YYYY-MM-DD, default today'), daily_cost: z.number().min(0).optional().describe('A quit\'s cost per day, for money saved'),
      started_on: z.string().optional().describe('YYYY-MM-DD, default today'),
      track: z.enum(['check', 'count', 'amount', 'minutes']).optional(), count_target: z.number().int().min(1).max(99).optional(), count_per: per.optional(),
      unit: z.string().optional(), target_amount: z.number().positive().optional(), presets: z.array(z.number().positive()).max(12).optional(),
      minutes_target: z.number().min(5).max(600).optional().describe('Minutes of focus a day, with track minutes'),
      color: color.optional(), icon: icon.optional(),
    }), annotations: ann.W,
  }, ({ per_week, quit_since, daily_cost, started_on, count_target, count_per, target_amount, minutes_target, ...i }) =>
    write((b) => g.addHabit(b, { ...i, perWeek: per_week, quitSince: quit_since, dailyCost: daily_cost, startedOn: started_on, countTarget: count_target, countPer: count_per, targetAmount: target_amount, minutesTarget: minutes_target })))
  r.tool('edit_habit', {
    title: 'Change a habit',
    description: 'Change only the fields passed, every one the Habits page edits: new_name, kind (keep = plain tick, quit, count, minutes; not for an amount habit), frequency, per_week, daypart (null = any time of day), count_target 1-99 / count_per (counted habits), minutes_target 5-600 (focus-minute habits), quit_since / daily_cost (quit habits; daily_cost null clears it), started_on (moving it EARLIER marks the newly covered days kept; later never un-ticks a day), presets (amount habits\' quick buttons), color, icon. A routine\'s own streak habit follows its routine: only daypart, colour and icon change (name, frequency, kind and start follow the routine, edit_routine). Not supported: an amount habit\'s unit or daily target (the app has no editor for them).',
    inputSchema: z.object({
      ...idOrWords, new_name: z.string().optional(), kind: z.enum(['keep', 'quit', 'count', 'minutes']).optional(), frequency: freq.optional(), per_week: z.number().int().min(1).max(7).optional(), daypart: daypart.nullable().optional(),
      count_target: z.number().int().min(1).max(99).optional(), count_per: per.optional(), minutes_target: z.number().min(5).max(600).optional(),
      quit_since: z.string().optional(), daily_cost: z.number().min(0).nullable().optional(), started_on: z.string().optional(),
      presets: z.array(z.number().positive()).max(12).optional(), color: color.optional(), icon: icon.optional(),
    }), annotations: ann.WI,
  }, ({ id, title, new_name, per_week, count_target, count_per, minutes_target, quit_since, daily_cost, started_on, ...p }) =>
    write((b) => g.editHabit(b, { id, title }, { ...p, newName: new_name, perWeek: per_week, countTarget: count_target, countPer: count_per, minutesTarget: minutes_target, quitSince: quit_since, dailyCost: daily_cost, startedOn: started_on })))
  r.tool('pause_habit', {
    title: 'Pause or resume a habit',
    description: 'Pause a habit (it stops being due, but it can still be ticked) or resume it. paused: true / false is explicit; leave it out to flip the current state, as the app\'s menu does. Not supported: pausing a whole routine (the app pauses habits, not routines).',
    inputSchema: z.object({ ...idOrWords, paused: z.boolean().optional() }), annotations: ann.W,
  }, ({ id, title, paused }) => write((b) => g.pauseHabit(b, { id, title }, paused)))
  r.tool('archive_habit', {
    title: 'Archive a habit',
    description: 'Retire a habit or quit: it leaves his lists, its history stays. Confirm first unless he asked. A routine\'s own streak habit cannot be deleted alone in the app ("deleted with the routine"), so archiving it deletes the routine, with everything delete_routine does. Restoring a retired habit has no operation in the app.',
    inputSchema: z.object(idOrWords), annotations: ann.D,
  }, ({ id, title }) => write((b) => g.archiveHabit(b, { id, title })))

  /* ---------------- routines ---------------- */
  r.tool('add_routine', {
    title: 'Add a routine',
    description: 'Create a routine (a folder of steps) with its own streak habit. cadence: daily (default), prework (weekdays), weekly, monthly; repeatable: true = "whenever I need it" (a daily routine he runs when the need comes up). With steps (in order) it is made the way the Habits page\'s New > Routine does: every step is also a habit in the routine\'s folder, with the part of the day (daypart) and colour/icon passed. Without steps it is an empty routine to add steps to. Refuses a title that already exists.',
    inputSchema: z.object({ title: z.string(), cadence: cadence.optional(), blurb: z.string().max(300).optional(), daypart: daypart.optional(), space: s.space.optional(), steps: z.array(z.string()).max(40).optional(), repeatable: z.boolean().optional(), color: color.optional(), icon: icon.optional() }), annotations: ann.W,
  }, (i) => write((b) => g.addRoutine(b, i)))
  r.tool('edit_routine', {
    title: 'Change a routine',
    description: 'Change a routine\'s title (its streak habit is renamed too), cadence, blurb, colour or icon. Only the fields passed change. Changing the cadence takes effect when the next period starts.',
    inputSchema: z.object({ ...idOrWords, new_title: z.string().optional(), cadence: cadence.optional(), blurb: z.string().max(300).optional(), color: color.optional(), icon: icon.optional() }), annotations: ann.WI,
  }, ({ id, title, new_title, ...p }) => write((b) => g.editRoutine(b, { id, title }, { ...p, title: new_title })))
  r.tool('delete_routine', {
    title: 'Delete a routine',
    description: 'Delete a routine and its streak habit (they are archived: their history stays). Confirm first unless he asked. A goal that counted off the routine\'s habit keeps the progress it earned and goes back to being logged by hand (as the app does; its unit "checkoffs" becomes "done"). Habits made from its steps are left as habits.',
    inputSchema: z.object(idOrWords), annotations: ann.D,
  }, ({ id, title }) => write((b) => g.deleteRoutine(b, { id, title })))
  r.tool('routine_step', {
    title: 'Tick a routine step',
    description: 'Tick or untick one step of a routine (done: true / false; leave it out to flip it). Updates the step\'s habit, the routine\'s progress and record, and the routine\'s own streak when the last required step lands. Unticking a step of a finished routine takes back the routine\'s finish and streak day as well (several records at once, as in the app). A step with alternatives is ticked by picking one (alt: id or words), and unticked by done: false (clears the chosen one). REFUSES: the typing test until 75 WPM, a step whose habit is gated by a number (habit_count), and ticking a step with alternatives without saying which one.',
    inputSchema: z.object({ ...idOrWords, ...stepRef, done: z.boolean().optional(), alt: z.string().optional() }), annotations: ann.W,
  }, ({ id, title, step_id, step, done, alt }) => write((b) => g.routineStep(b, { id, title }, { stepId: step_id, step }, { done, alt })))
  r.tool('add_routine_step', {
    title: 'Add a routine step',
    description: 'Append a step to a routine; it is also made as a habit in the routine\'s folder, the way the Habits page makes them. A new required step reopens a routine that was already finished this period (the result says so). At most 40 steps; refuses a duplicate step title. Not supported: inserting in the middle (the app only appends).',
    inputSchema: z.object({ ...idOrWords, step: z.string() }), annotations: ann.W,
  }, ({ id, title, step }) => write((b) => g.addRoutineStep(b, { id, title }, step)))
  r.tool('remove_routine_step', {
    title: 'Remove a routine step',
    description: 'Remove one step from a routine. The step\'s own habit, if it has one, stays, as in the app (archive_habit removes it). Removing the only open step finishes the routine. Confirm first unless asked.',
    inputSchema: z.object({ ...idOrWords, ...stepRef }), annotations: ann.D,
  }, ({ id, title, step_id, step }) => write((b) => g.removeRoutineStep(b, { id, title }, { stepId: step_id, step })))
  r.tool('routine_done', {
    title: 'Finish or reopen a routine',
    description: 'done: true (default) ticks every REQUIRED step of the routine for this period (optional steps he did not tick are not claimed; a step that must be earned with a number, like the typing test, is left open so the routine then stays unfinished). done: false reopens everything: every step is unticked and the routine\'s finish and streak day are taken back (many records at once, as in the app). day (a PAST day, done true only): what the daily review\'s "I finished it" does, marking every required step habit and the routine\'s own day for that date.',
    inputSchema: z.object({ ...idOrWords, done: z.boolean().optional(), day: z.string().optional().describe('YYYY-MM-DD, a past day, with done true') }), annotations: ann.WI,
  }, ({ id, title, done, day }) => write((b) => g.routineDone(b, { id, title }, done !== false, day)))
  r.tool('plan_routine', {
    title: 'Plan a routine on the day',
    description: 'Put a routine on a day\'s list at a part of the day (slot) without starting it. date defaults to today, never a past day. clear: true removes the plan. A routine reaches the day by being planned or started; nothing is copied.',
    inputSchema: z.object({ ...idOrWords, slot: slot.optional(), date: z.string().optional().describe('YYYY-MM-DD'), clear: z.boolean().optional() }), annotations: ann.WI,
  }, ({ id, title, slot: sl, date, clear }) => write((b) => g.planRoutine(b, { id, title }, { slot: sl, date, clear })))
  r.tool('close_daily_review', {
    title: 'Close the daily review',
    description: 'Record that today\'s daily review was walked (walked: true) or skipped (walked: false). This is all the app stores about the review itself; the fixes made inside it are tick_habit with a past day, log_slip with a day, and routine_done with a day. Only when he says he did or skipped it.',
    inputSchema: z.object({ walked: z.boolean() }), annotations: ann.WI,
  }, ({ walked }) => write((b) => g.closeDaily(b, walked)))
}
