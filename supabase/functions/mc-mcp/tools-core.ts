/* v1: tasks, projects, notes, plain habits, and the reads over everything. */
import * as ops from './ops.ts'
import { creditGoal } from './ops-goals.ts'
import type { Reg } from './reg.ts'

export function register(r: Reg): void {
  const { z, read, write, ann, s } = r
  const { space, slot, ref, steps } = s

  /* ---------------- reads ---------------- */
  r.tool('get_overview', { title: 'Overview', description: 'Today at a glance: what is on the day, overdue, planned, backlog, habits kept, and counts of everything else.', inputSchema: z.object({}), annotations: ann.RO }, () => read(ops.overview))
  r.tool('get_day', { title: "A day's plan", description: 'The plan for one day, grouped by part of the day and in clock order. Defaults to today.', inputSchema: z.object({ date: z.string().optional().describe('YYYY-MM-DD') }), annotations: ann.RO }, ({ date }) => read((b) => ops.getDay(b, date)))
  r.tool('list_tasks', {
    title: 'List tasks', description: 'Find tasks. where: open (default), today, planned (future days), backlog, done, all. Filter by space, project name, words in the title, or a date.',
    inputSchema: z.object({ where: z.enum(['open', 'today', 'planned', 'backlog', 'done', 'all']).optional(), date: z.string().optional(), space: space.optional(), project: z.string().optional(), query: z.string().optional(), limit: z.number().int().min(1).max(200).optional() }), annotations: ann.RO,
  }, (i) => read((b) => ops.listTasks(b, i)))
  r.tool('list_projects', { title: 'List projects', description: 'Projects with their hashtag, space and open task count.', inputSchema: z.object({}), annotations: ann.RO }, () => read(ops.listProjects))
  r.tool('list_notes', { title: 'List notes', description: 'Notes, newest edited first, optionally filtered by words in the title or body.', inputSchema: z.object({ query: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }), annotations: ann.RO }, (i) => read((b) => ops.listNotes(b, i)))
  r.tool('get_note', { title: 'Read a note', description: 'The full text of one note, found by its id or by part of its title. Use list_notes first to find it.', inputSchema: z.object(ref), annotations: ann.RO }, (i) => read((b) => ops.getNote(b, i)))
  r.tool('browse', {
    title: 'Browse other data', description: `Read-only. Return rows as stored from: ${ops.BROWSABLE.join(', ')}. Use query to filter by words anywhere in a row.`,
    inputSchema: z.object({ collection: z.enum(ops.BROWSABLE), query: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }), annotations: ann.RO,
  }, (i) => read((b) => ops.browse(b, i)))

  /* ---------------- tasks ---------------- */
  r.tool('add_task', {
    title: 'Add a task', description: "Create a task. Give a date (YYYY-MM-DD) and/or at (HH:MM) to put it on a day; otherwise it goes on the list. A project name files it there (and in that project's space). Refuses a duplicate of an open task unless allow_duplicate is true. Minutes only if he said how long.",
    inputSchema: z.object({ title: z.string(), space: space.optional(), project: z.string().optional(), date: z.string().optional(), at: z.string().optional(), slot: slot.optional(), minutes: z.number().int().min(1).optional(), steps: steps.optional(), list: z.enum(['today', 'backlog']).optional(), allow_duplicate: z.boolean().optional() }), annotations: ann.W,
  }, ({ allow_duplicate, ...i }) => write((b) => ops.addTask(b, { ...i, allowDuplicate: allow_duplicate })))
  r.tool('update_task', {
    title: 'Change a task', description: 'Retitle, estimate, move between days or back to the list, pin or unpin a time, change space or project. Only the fields you pass change. project: null takes it out of its project; at: null unpins the time.',
    inputSchema: z.object({ ...ref, new_title: z.string().optional(), minutes: z.number().int().min(1).optional(), space: space.optional(), project: z.string().nullable().optional(), at: z.string().nullable().optional(), slot: slot.optional(), list: z.enum(['today', 'backlog']).optional(), date: z.string().optional() }), annotations: ann.WI,
  }, ({ id, title, new_title, ...p }) => write((b) => ops.updateTask(b, { id, title }, { ...p, ...(new_title !== undefined ? { title: new_title } : {}) })))
  /* store.tsx toggleTask: finishing a task feeds the weekly goal it counts toward, reopening takes it back. */
  r.tool('complete_task', { title: 'Finish a task', description: 'Mark a task done (and credit the weekly goal it counts toward). Does not log how long it took; use log_task_time for that.', inputSchema: z.object(ref), annotations: ann.WI }, (i) => write((b) => {
    const t = ops.findTask(b, i); const was = !!t.done
    const res = ops.completeTask(b, i)
    const fed = !was ? creditGoal(b, t, 1) : null
    return fed ? { ...res, text: `${res.text} Goal: ${fed}.` } : res
  }))
  r.tool('reopen_task', { title: 'Reopen a task', description: 'Mark a finished task as not done (and take back what it added to its weekly goal).', inputSchema: z.object(ref), annotations: ann.WI }, (i) => write((b) => {
    const t = ops.findTask(b, i); const was = !!t.done
    const res = ops.reopenTask(b, i)
    const fed = was ? creditGoal(b, t, -1) : null
    return fed ? { ...res, text: `${res.text} Goal: ${fed}.` } : res
  }))
  r.tool('set_task_steps', { title: "Set a task's steps", description: "Replace a task's subtasks. An empty list removes them.", inputSchema: z.object({ ...ref, steps }), annotations: ann.WI }, ({ id, title, steps: st }) => write((b) => ops.setSteps(b, { id, title }, st)))
  r.tool('delete_task', { title: 'Delete a task', description: 'Delete a task for good. Confirm with the user first unless they asked for it.', inputSchema: z.object(ref), annotations: ann.D }, (i) => write((b) => ops.deleteTask(b, i)))

  /* ---------------- projects ---------------- */
  r.tool('add_project', { title: 'Add a project', description: 'Create a project (a room inside personal or work).', inputSchema: z.object({ name: z.string(), space }), annotations: ann.W }, ({ name, space: sp }) => write((b) => ops.addProject(b, name, sp)))
  r.tool('rename_project', { title: 'Rename a project', description: 'Rename a project, found by its id or name.', inputSchema: z.object({ project: z.string(), new_name: z.string() }), annotations: ann.WI }, ({ project, new_name }) => write((b) => ops.renameProject(b, project, new_name)))

  /* ---------------- notes ---------------- */
  r.tool('add_note', { title: 'Add a note', description: 'Save a new note. The first line becomes its title.', inputSchema: z.object({ body: z.string(), space: space.optional() }), annotations: ann.W }, ({ body, space: sp }) => write((b) => ops.addNote(b, { body, space: sp })))
  r.tool('append_to_note', { title: 'Add to a note', description: 'Append text to the end of an existing note. Safe: never loses what was there.', inputSchema: z.object({ ...ref, text: z.string() }), annotations: ann.W }, ({ id, title, text: t }) => write((b) => ops.appendNote(b, { id, title }, t)))
  r.tool('replace_note', { title: 'Rewrite a note', description: 'Replace the whole text of a note. Read it with get_note first, and keep what should stay.', inputSchema: z.object({ ...ref, body: z.string() }), annotations: ann.D }, ({ id, title, body }) => write((b) => ops.replaceNote(b, { id, title }, body)))
  r.tool('set_note_done', { title: 'Tick a note', description: 'Mark a note done (or reopen it).', inputSchema: z.object({ ...ref, done: z.boolean() }), annotations: ann.WI }, ({ id, title, done }) => write((b) => ops.setNoteDone(b, { id, title }, done)))
  r.tool('delete_note', { title: 'Delete a note', description: 'Delete a note for good. Confirm first unless asked.', inputSchema: z.object(ref), annotations: ann.D }, (i) => write((b) => ops.deleteNote(b, i)))
}
