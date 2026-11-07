/* Reminders area: the Reminders page (src/remindersPage.tsx) and its store (src/store/reminders.ts)
   via ops-reminders.ts. */
import * as R from './ops-reminders.ts'
import type { Reg } from './reg.ts'

export function register(r: Reg): void {
  const { z, read, write, ann, s } = r
  const { ref } = s
  const stamp = z.string().describe('Local time YYYY-MM-DDTHH:MM, Prague wall time, 00:00 to 23:59, no zone (e.g. 2026-11-08T09:00). A reminder time is when it should remind him, not a deadline.')
  const repeat = z.enum(R.REPEATS as [string, ...string[]])
  const item = z.object({ title: z.string(), notes: z.string().optional(), list: z.string().optional().describe('List id or name words; default is the first list (Reminders)'), remind_at: stamp.optional(), repeat: repeat.optional(), flagged: z.boolean().optional() })

  r.tool('list_reminders', {
    title: 'List reminders',
    description: `Read the Reminders page. view = the page's smart lists: today (open ones with a time today or earlier), scheduled (open with a time), flagged, all (every open one), completed (done ones, newest first). Without view you get open reminders; include_completed adds done ones. Filter by list (id or name words) and by words in title/notes. Each row shows its list, remindAt (local Prague time), repeat, flag and overdue (the time has passed; the app only lists it, nothing turns red). The reply also carries the tile counts of the five smart lists. limit default 100, max 200.`,
    inputSchema: z.object({ list: z.string().optional(), view: z.enum(R.SMART_VIEWS as [string, ...string[]]).optional(), query: z.string().optional(), include_completed: z.boolean().optional(), limit: z.number().int().min(1).max(200).optional() }), annotations: ann.RO,
  }, (i) => read((b) => R.listReminders(b, i)))

  r.tool('add_reminder', {
    title: 'Add a reminder',
    description: 'Add a reminder. list = list id or name words (default: the first list, "Reminders"). remind_at is a local Prague time YYYY-MM-DDTHH:MM (optional). repeat (daily, weekly, monthly) needs remind_at, as in the app. flagged marks it. Duplicates are allowed, as in the app.',
    inputSchema: item, annotations: ann.W,
  }, (i) => write((b) => R.addReminder(b, i)))

  r.tool('add_reminders', {
    title: 'Add several reminders',
    description: `Add up to ${R.MAX_BULK} reminders in one go. All or nothing: if any item is invalid, none is added and the reply names the item. Same fields as add_reminder per item.`,
    inputSchema: z.object({ reminders: z.array(item).min(1).max(R.MAX_BULK) }), annotations: ann.W,
  }, ({ reminders }) => write((b) => R.addReminders(b, reminders)))

  r.tool('edit_reminder', {
    title: 'Edit a reminder',
    description: 'Change a reminder (id, or title words; completed ones too): new_title, notes, list (move it to another list, id or name words), remind_at (a time, or null to clear it; clearing the time also clears the repeat, as the app does), repeat (daily, weekly, monthly, or none; needs a time), flagged. Only passed fields change.',
    inputSchema: z.object({ ...ref, new_title: z.string().optional(), notes: z.string().optional(), list: z.string().optional(), remind_at: stamp.nullable().optional(), repeat: z.enum([...R.REPEATS, 'none'] as [string, ...string[]]).optional(), flagged: z.boolean().optional() }), annotations: ann.WI,
  }, ({ id, title, ...p }) => write((b) => R.editReminder(b, { id, title }, p)))

  r.tool('complete_reminder', {
    title: 'Complete a reminder',
    description: 'Tick an open reminder (id, or title words). Like ticking in the app: a repeating reminder with a time is marked done AND the next one appears at the next time (daily +1 day, weekly +7, monthly +1 month, same clock time); the reply says both. Already completed: nothing changes.',
    inputSchema: z.object(ref), annotations: ann.W,
  }, (i) => write((b) => R.completeReminders(b, [i])))

  r.tool('complete_reminders', {
    title: 'Complete several reminders',
    description: `Tick up to ${R.MAX_BULK} open reminders at once, each by id or title words. All or nothing: any that cannot be found or is ambiguous stops the lot. Repeating ones create their next occurrence exactly as complete_reminder.`,
    inputSchema: z.object({ reminders: z.array(z.object(ref)).min(1).max(R.MAX_BULK) }), annotations: ann.W,
  }, ({ reminders }) => write((b) => R.completeReminders(b, reminders)))

  r.tool('reopen_reminder', {
    title: 'Reopen a completed reminder',
    description: 'Untick a completed reminder (id, or title words). Only the done mark is cleared. If it repeated, the next occurrence made when it was ticked stays, as in the app.',
    inputSchema: z.object(ref), annotations: ann.WI,
  }, (i) => write((b) => R.reopenReminder(b, i)))

  r.tool('delete_reminder', { title: 'Delete a reminder', description: 'Delete a reminder for good (id, or title words). Confirm first unless asked.', inputSchema: z.object(ref), annotations: ann.D }, (i) => write((b) => R.deleteReminder(b, i)))

  r.tool('list_reminder_lists', { title: 'List reminder lists', description: 'His reminder lists with colour and how many open / completed reminders each holds, and the colours a list can have.', inputSchema: z.object({}), annotations: ann.RO }, () => read(R.listReminderLists))

  r.tool('add_reminder_list', {
    title: 'Add a reminder list',
    description: `Make a reminder list. Colours: ${R.REMINDER_COLORS.join(', ')} (default ${R.NEW_LIST_COLOR}, as the page starts it). Same names are allowed, as in the app.`,
    inputSchema: z.object({ name: z.string(), color: z.enum(R.REMINDER_COLORS as [string, ...string[]]).optional() }), annotations: ann.W,
  }, ({ name, color }) => write((b) => R.addReminderList(b, name, color)))

  r.tool('edit_reminder_list', {
    title: 'Edit a reminder list',
    description: 'Rename a list and/or change its colour (list = id or name words).',
    inputSchema: z.object({ list: z.string(), new_name: z.string().optional(), color: z.enum(R.REMINDER_COLORS as [string, ...string[]]).optional() }), annotations: ann.WI,
  }, ({ list, new_name, color }) => write((b) => R.editReminderList(b, list, { name: new_name, color })))

  r.tool('delete_reminder_list', {
    title: 'Delete a reminder list and its reminders',
    description: 'Delete a list (id or name words) TOGETHER WITH ALL its reminders, open and completed, exactly as the app does. The last remaining list cannot be deleted. The reply says how many reminders went. Confirm first unless asked.',
    inputSchema: z.object({ list: z.string() }), annotations: ann.D,
  }, ({ list }) => write((b) => R.deleteReminderList(b, list)))
}
