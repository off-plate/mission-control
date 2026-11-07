// Mission Control as a Claude connector (MCP over Streamable HTTP).
//
// Claude (web, desktop, mobile, Claude Code) adds this URL as a custom connector:
//   https://<project>.supabase.co/functions/v1/mc-mcp
// and signs in through Supabase's OAuth server (consent page: /oauth/consent on the
// dashboard site). Every tool runs as HIM: the client below is scoped to his token,
// so the database's own row-level rules keep it to his data. The service-role client
// the library also offers (supabaseAdmin) is never touched here.
//
// Deployed with --no-verify-jwt: the gateway would otherwise reject the unauthenticated
// discovery request before withOAuthProtectedResource can answer it. withSupabase
// verifies the token itself, against the project's signing keys.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { createMcpHandler, McpServer } from 'npm:@modelcontextprotocol/server@^2.0.0'
import { pipeline } from 'npm:@supabase/middleware@1'
import { withOAuthProtectedResource, withSupabase } from 'npm:@supabase/server@1'
import { z } from 'npm:zod@^4.3.6'

import { commit, readState } from './commit.ts'
import * as ops from './ops.ts'

const INSTRUCTIONS = `This is Michael's Mission Control: his personal life dashboard (tasks, habits, notes, projects, goals, people, bills).
- Start with get_overview or get_day. Dates are YYYY-MM-DD in Prague time; times are HH:MM, 24 hour.
- Name a task, note, habit or project only by an id or title you read from a list or lookup. Ids are exact; titles must match one row or the tool refuses and lists the candidates.
- A change tool changes his real data and returns what it did. Never claim something changed unless the tool said so.
- Work (the "work" space) is his job at Big Time. Everything else is "personal". Off-Plate and Michael's Corner are projects inside personal.
- Some things the app does are not available here yet (the focus timer, the time a task took, quit habits, measured habits, routines, bills). The tool says so instead of guessing.`

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] })
const fail = (e: unknown) => {
  if (e instanceof ops.McError) return { isError: true, content: [{ type: 'text' as const, text: e.message }] }
  // Never echo internals or his data: log the shape, answer plainly.
  console.error('mc-mcp unexpected error', e instanceof Error ? `${e.name}: ${e.message}` : String(e))
  return { isError: true, content: [{ type: 'text' as const, text: 'Something went wrong on the server. Nothing was changed.' }] }
}

const space = z.enum(['personal', 'work'])
const slot = z.enum(['morning', 'noon', 'afternoon', 'evening'])
const ref = { id: z.string().optional().describe('Exact id from a list (preferred)'), title: z.string().optional().describe('Part of the title, if no id. Must match exactly one row.') }
const steps = z.array(z.object({ title: z.string(), minutes: z.number().int().min(1).optional() })).max(40)
const RO = { readOnlyHint: true, openWorldHint: false } as const
const W = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const
const WI = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const
const D = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const

Deno.serve(
  pipeline(
    [withOAuthProtectedResource(), withSupabase({ auth: 'user' })],
    async (req, { supabase, userClaims }) => {
      const uid = userClaims?.id
      if (!uid) return new Response('Unauthorized', { status: 401 })
      const read = <T>(fn: (b: ops.Blob) => T) => async () => { try { return text(fn(await readState(supabase, uid))) } catch (e) { return fail(e) } }
      const write = async <T extends { text: string }>(fn: (b: ops.Blob) => T) => { try { return text((await commit(supabase, uid, fn)).text) } catch (e) { return fail(e) } }

      const handler = createMcpHandler(() => {
        const server = new McpServer({ name: 'mission-control', version: '0.1.0' }, { instructions: INSTRUCTIONS })
        const tool = server.registerTool.bind(server)

        /* ---------------- reads ---------------- */
        tool('get_overview', { title: 'Overview', description: "Today at a glance: what is on the day, overdue, planned, backlog, habits kept, and counts of everything else.", inputSchema: z.object({}), annotations: RO }, read(ops.overview))
        tool('get_day', { title: 'A day\'s plan', description: 'The plan for one day, grouped by part of the day and in clock order. Defaults to today.', inputSchema: z.object({ date: z.string().optional().describe('YYYY-MM-DD') }), annotations: RO },
          async ({ date }) => read((b) => ops.getDay(b, date))())
        tool('list_tasks', {
          title: 'List tasks', description: 'Find tasks. where: open (default), today, planned (future days), backlog, done, all. Filter by space, project name, words in the title, or a date.',
          inputSchema: z.object({ where: z.enum(['open', 'today', 'planned', 'backlog', 'done', 'all']).optional(), date: z.string().optional(), space: space.optional(), project: z.string().optional(), query: z.string().optional(), limit: z.number().int().min(1).max(200).optional() }), annotations: RO,
        }, async (i) => read((b) => ops.listTasks(b, i))())
        tool('list_projects', { title: 'List projects', description: 'Projects with their hashtag, space and open task count.', inputSchema: z.object({}), annotations: RO }, read(ops.listProjects))
        tool('list_habits', { title: 'List habits', description: 'Habits, whether each is kept today, and whether this connector can tick it (plain habits only).', inputSchema: z.object({}), annotations: RO }, read(ops.listHabits))
        tool('list_notes', { title: 'List notes', description: 'Notes, newest edited first, optionally filtered by words in the title or body.', inputSchema: z.object({ query: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }), annotations: RO }, async (i) => read((b) => ops.listNotes(b, i))())
        tool('get_note', { title: 'Read a note', description: 'The full text of one note.', inputSchema: z.object(ref), annotations: RO }, async (i) => read((b) => ops.getNote(b, i))())
        tool('browse', {
          title: 'Browse other data', description: `Read-only. Return rows as stored from: ${ops.BROWSABLE.join(', ')}. Use query to filter by words anywhere in a row.`,
          inputSchema: z.object({ collection: z.enum(ops.BROWSABLE), query: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }), annotations: RO,
        }, async (i) => read((b) => ops.browse(b, i))())

        /* ---------------- tasks ---------------- */
        tool('add_task', {
          title: 'Add a task', description: 'Create a task. Give a date (YYYY-MM-DD) and/or at (HH:MM) to put it on a day; otherwise it goes on the list. A project name files it there (and in that project\'s space). Refuses a duplicate of an open task unless allow_duplicate is true. Minutes only if he said how long.',
          inputSchema: z.object({ title: z.string(), space: space.optional(), project: z.string().optional(), date: z.string().optional(), at: z.string().optional(), slot: slot.optional(), minutes: z.number().int().min(1).optional(), steps: steps.optional(), list: z.enum(['today', 'backlog']).optional(), allow_duplicate: z.boolean().optional() }), annotations: W,
        }, async ({ allow_duplicate, ...i }) => write((b) => ops.addTask(b, { ...i, allowDuplicate: allow_duplicate })))
        tool('update_task', {
          title: 'Change a task', description: 'Retitle, estimate, move between days or back to the list, pin or unpin a time, change space or project. Only the fields you pass change. project: null takes it out of its project; at: null unpins the time.',
          inputSchema: z.object({ ...ref, new_title: z.string().optional(), minutes: z.number().int().min(1).optional(), space: space.optional(), project: z.string().nullable().optional(), at: z.string().nullable().optional(), slot: slot.optional(), list: z.enum(['today', 'backlog']).optional(), date: z.string().optional() }), annotations: WI,
        }, async ({ id, title, new_title, ...p }) => write((b) => ops.updateTask(b, { id, title }, { ...p, ...(new_title !== undefined ? { title: new_title } : {}) })))
        tool('complete_task', { title: 'Finish a task', description: 'Mark a task done. Does not log how long it took (not supported here yet).', inputSchema: z.object(ref), annotations: WI }, async (i) => write((b) => ops.completeTask(b, i)))
        tool('reopen_task', { title: 'Reopen a task', description: 'Mark a finished task as not done.', inputSchema: z.object(ref), annotations: WI }, async (i) => write((b) => ops.reopenTask(b, i)))
        tool('set_task_steps', { title: 'Set a task\'s steps', description: 'Replace a task\'s subtasks. An empty list removes them.', inputSchema: z.object({ ...ref, steps }), annotations: WI }, async ({ id, title, steps: s }) => write((b) => ops.setSteps(b, { id, title }, s)))
        tool('delete_task', { title: 'Delete a task', description: 'Delete a task for good. Confirm with the user first unless they asked for it.', inputSchema: z.object(ref), annotations: D }, async (i) => write((b) => ops.deleteTask(b, i)))

        /* ---------------- projects ---------------- */
        tool('add_project', { title: 'Add a project', description: 'Create a project (a room inside personal or work).', inputSchema: z.object({ name: z.string(), space }), annotations: W }, async ({ name, space: s }) => write((b) => ops.addProject(b, name, s)))
        tool('rename_project', { title: 'Rename a project', description: 'Rename a project, found by its id or name.', inputSchema: z.object({ project: z.string(), new_name: z.string() }), annotations: WI }, async ({ project, new_name }) => write((b) => ops.renameProject(b, project, new_name)))

        /* ---------------- notes ---------------- */
        tool('add_note', { title: 'Add a note', description: 'Save a new note. The first line becomes its title.', inputSchema: z.object({ body: z.string(), space: space.optional() }), annotations: W }, async ({ body, space: s }) => write((b) => ops.addNote(b, { body, space: s })))
        tool('append_to_note', { title: 'Add to a note', description: 'Append text to the end of an existing note. Safe: never loses what was there.', inputSchema: z.object({ ...ref, text: z.string() }), annotations: W }, async ({ id, title, text: t }) => write((b) => ops.appendNote(b, { id, title }, t)))
        tool('replace_note', { title: 'Rewrite a note', description: 'Replace the whole text of a note. Read it with get_note first, and keep what should stay.', inputSchema: z.object({ ...ref, body: z.string() }), annotations: D }, async ({ id, title, body }) => write((b) => ops.replaceNote(b, { id, title }, body)))
        tool('set_note_done', { title: 'Tick a note', description: 'Mark a note done (or reopen it).', inputSchema: z.object({ ...ref, done: z.boolean() }), annotations: WI }, async ({ id, title, done }) => write((b) => ops.setNoteDone(b, { id, title }, done)))
        tool('delete_note', { title: 'Delete a note', description: 'Delete a note for good. Confirm first unless asked.', inputSchema: z.object(ref), annotations: D }, async (i) => write((b) => ops.deleteNote(b, i)))

        /* ---------------- habits ---------------- */
        tool('tick_habit', {
          title: 'Keep a habit', description: 'Tick a plain habit for a day (default today), or untick it with done: false. Refuses quit, measured, gated or routine-linked habits and says why; list_habits shows which are tickable.',
          inputSchema: z.object({ ...ref, day: z.string().optional().describe('YYYY-MM-DD, not in the future'), done: z.boolean().optional() }), annotations: WI,
        }, async ({ id, title, day, done }) => write((b) => ops.tickHabit(b, { id, title }, { day, done })))

        return server
      }, { onerror: (error: unknown) => console.error('MCP request failed', error instanceof Error ? error.message : String(error)) })

      return handler.fetch(req)
    },
  ),
)
