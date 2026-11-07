/* Planning the day, time tracking and the calendar. Logic: ops-planning.ts. */
import { McError } from './ops.ts'
import * as p from './ops-planning.ts'
import type { Reg } from './reg.ts'

export function register(r: Reg): void {
  const { z, read, write, safe, ann, s } = r
  const { slot, ref, date, time } = s

  r.tool('plan_day', {
    title: 'Plan the day (many tasks at once)',
    description: 'Place several tasks on days / times / parts of the day in ONE all-or-nothing change. Each item names a task (id, or part of its title that matches exactly one) and any of: date (YYYY-MM-DD), at (HH:MM, which also sets the part of the day), slot (morning, noon, afternoon, evening), minutes (the estimate), list ("backlog" sends it back to the list; cannot be combined with date/at/slot). A task still on the list that gets a time or part of the day goes on today unless you give a date. If ANY item is unknown, ambiguous, already done, contradictory (at and slot disagree) or twice in the batch, NOTHING changes and the first problem is named. Same rules as update_task. Max 40 items. Not supported: unpinning a time (use update_task with at: null), creating tasks (add_task). Afterwards the answer says if a part of the day is over its hours or holds tasks with no estimate; check with day_capacity.',
    inputSchema: z.object({
      items: z.array(z.object({
        ...ref,
        date: date.optional(), at: time.optional(), slot: slot.optional(),
        minutes: z.number().int().min(1).max(480).optional().describe('Estimate in minutes, only if he gave one'),
        list: z.enum(['today', 'backlog']).optional(),
      })).min(1).max(40),
    }),
    annotations: ann.WI,
  }, ({ items }) => write((b) => p.planDay(b, items)))

  r.tool('day_capacity', {
    title: 'How full is a day',
    description: 'For one day (default today): minutes planned in each part of the day (morning 06-12, noon 12-14, afternoon 14-18, evening 18-24) against the hours that part really holds, tasks pinned to a clock time, and the free windows between pinned tasks. A task with no estimate counts as 0 minutes and is listed as unestimated: a part containing one is "unknown", never "fits". Open tasks only; done tasks are counted separately. To also cut meetings out of the free windows, read get_calendar and pass them as busy. It does not know what time it is now.',
    inputSchema: z.object({
      date: date.optional(),
      busy: z.array(z.object({ from: time, to: time })).max(30).optional().describe('Meetings or other blocked time that day, HH:MM to HH:MM, e.g. from get_calendar'),
    }),
    annotations: ann.RO,
  }, ({ date: d, busy }) => read((b) => p.dayCapacity(b, d, busy)))

  r.tool('log_task_time', {
    title: 'Log how long a task took',
    description: 'Finish a task AND record the real time, exactly as the app does when he ticks it off with a number: marks it done, stores the minutes, writes the ledger row (estimate vs actual, feeds estimate accuracy) and a focus block for those minutes, and moves a weekly goal the task feeds. Pass minutes (1-480). For a task with steps, pass step (id or title of one step) to log that step only; logging the LAST step finishes the task and writes one ledger row for the whole; without step, all steps are ticked done. If time was already logged on the task only the number changes (no second row). Use this instead of complete_task when he told you how long it took. Not supported: a running focus timer (client-side).',
    inputSchema: z.object({
      ...ref, minutes: z.number().int().min(1).max(480),
      step: z.object(ref).optional().describe('One step of the task (id or part of its title)'),
    }),
    annotations: ann.W,
  }, ({ id, title, minutes, step }) => write((b) => p.logTaskTime(b, { id, title }, minutes, step)))

  r.tool('log_focus', {
    title: 'Log focus he already did',
    description: 'Record a focus block that already happened: minutes (1-480), optional label, date (default today, not in the future), at (HH:MM Prague time when it ENDED; default now). Writes the focus session and its ledger row like the app. If the label is exactly the title of a task (or of a step) the block is filed under that task\'s space; otherwise pass space (personal or work), because the app uses the space he is viewing, which this connector cannot see. Refuses the same block logged twice within two minutes. Not supported: starting or stopping the live timer (it runs in the app), editing or deleting a block.',
    inputSchema: z.object({
      minutes: z.number().int().min(1).max(480), label: z.string().max(200).optional(),
      date: date.optional(), at: time.optional(), space: s.space.optional(),
    }),
    annotations: ann.W,
  }, (i) => write((b) => p.logFocus(b, i)))

  r.tool('focus_stats', {
    title: 'Focus time per day or week',
    description: 'Finished focus blocks from `from` to `to` (default the last 7 days), as minutes and blocks per day (by: "day") or ISO week (by: "week"), newest first, plus today\'s total and the labels with the most time. Optional space filter. A timer running right now is not included.',
    inputSchema: z.object({ from: date.optional(), to: date.optional(), by: z.enum(['day', 'week']).optional(), space: s.space.optional() }),
    annotations: ann.RO,
  }, (i) => read((b) => p.focusStats(b, i)))

  r.tool('get_calendar', {
    title: 'Meetings from the work calendar',
    description: 'Entries of his work calendar for a day or a range (from, to; default today), read live from the calendar feed the app uses: time, title, place, who is invited, call link, and meeting = other people are in it or it has a call link (otherwise it is an hour he blocked for himself). Reaches from today up to 31 days ahead, never the past. If the calendar is not set up, signed out or unreachable, this says so; it NEVER means the day is empty. A day with no entries is reported as read-and-empty. Read-only; creating or moving events is not supported.',
    inputSchema: z.object({ from: date.optional(), to: date.optional(), only_meetings: z.boolean().optional().describe('Leave out his own focus/gym blocks') }),
    annotations: { ...ann.RO, openWorldHint: true },
  }, ({ from, to, only_meetings }) => safe(async () => {
    const w = p.calendarWindow({ from, to })
    const fns = (r.db as any).functions
    if (!fns || typeof fns.invoke !== 'function') throw new McError('The calendar cannot be reached from here (no function access). Tell Michael; do not assume his day is free.')
    let res: { data?: unknown; error?: any }
    try { res = await fns.invoke(`calendar?days=${w.days}`, { method: 'GET' }) } catch (e) {
      throw new McError(`The calendar could not be reached (${e instanceof Error ? e.message : 'network'}). I do not know what is on his day.`)
    }
    if (res.error) {
      const ctx = res.error.context
      const status = typeof ctx?.status === 'number' ? ctx.status : undefined
      let body = ''
      try { if (ctx && typeof ctx.clone === 'function') body = String(await ctx.clone().text()) } catch { /* generic message stands */ }
      if (status === 503 || /No calendar configured/i.test(body)) throw new McError('No work calendar is set up (the calendar feed address is not configured). I cannot say what is on his day.')
      if (status === 401) throw new McError('The calendar refused this sign-in: it only answers his own session. I cannot say what is on his day.')
      throw new McError(`The calendar could not be read${status ? ` (${status})` : ''}${body && body.length < 200 ? `: ${body}` : ''}. I do not know what is on his day.`)
    }
    return p.shapeCalendar(res.data, w, only_meetings)
  }))
}
