/* Library area: note extras (edit / move / folders), Ideas board, Prompts, Gym goals.
   Ports of src/store/{notes,ideaboard,prompts,gym}.ts via ops-library.ts. */
import * as L from './ops-library.ts'
import { McError } from './ops.ts'
import type { Reg } from './reg.ts'

export function register(r: Reg): void {
  const { z, read, write, ann, s } = r
  const { ref } = s

  /* ---------- notes: extras (add/append/replace/done/delete/get/list live in tools-core) ---------- */
  r.tool('edit_note', {
    title: 'Edit a note: title, colour, pin', description: `Change a note's title, colour or pin; only the fields you pass change. A note's title IS its first line, so a new title rewrites the first line of the text (the rest is kept). Colours: ${L.NOTE_COLORS.join(', ')}. To change the text itself use replace_note or append_to_note; to tick it use set_note_done.`,
    inputSchema: z.object({ ...ref, new_title: z.string().optional(), color: z.enum(L.NOTE_COLORS as [string, ...string[]]).optional(), pinned: z.boolean().optional() }), annotations: ann.WI,
  }, ({ id, title, new_title, color, pinned }) => write((b) => L.editNote(b, { id, title }, { title: new_title, color, pinned })))
  r.tool('move_note', {
    title: 'Move a note to a folder', description: 'File a note in a folder. folder_id is a folder id from list_note_folders, or nf-space-personal / nf-space-work to put it back at the top of that workspace; or folder = part of a folder name (must match one). Moving never changes which workspace the note belongs to.',
    inputSchema: z.object({ ...ref, folder_id: z.string().optional(), folder: z.string().optional() }), annotations: ann.WI,
  }, ({ id, title, folder_id, folder }) => write((b) => {
    if (!folder_id && !folder) throw new McError('Say which folder: folder_id or folder.')
    return L.moveNote(b, { id, title }, { folder_id, folder })
  }))
  r.tool('list_note_folders', { title: 'List note folders', description: 'The two workspace folders (nf-space-personal, nf-space-work: derived, not stored, cannot be renamed or deleted) and every folder he made, with how many notes each holds.', inputSchema: z.object({}), annotations: ann.RO }, () => read(L.listNoteFolders))
  r.tool('add_note_folder', { title: 'Add a note folder', description: 'Make a folder inside the personal or work workspace. A folder of the same name in that workspace is refused.', inputSchema: z.object({ space: s.space, name: z.string() }), annotations: ann.W }, ({ space, name }) => write((b) => L.addNoteFolder(b, space, name)))
  r.tool('rename_note_folder', { title: 'Rename a note folder', description: 'Rename a folder he made, by id or name. Workspace folders cannot be renamed.', inputSchema: z.object({ ...ref, new_name: z.string() }), annotations: ann.WI }, ({ id, title, new_name }) => write((b) => L.renameNoteFolder(b, { id, title }, new_name)))
  r.tool('delete_note_folder', { title: 'Delete a note folder', description: 'Delete a folder he made. Its notes are NOT deleted: they move up to the workspace folder. Workspace folders cannot be deleted. Confirm first unless asked.', inputSchema: z.object(ref), annotations: ann.D }, (i) => write((b) => L.deleteNoteFolder(b, i)))

  /* ---------- ideas board ---------- */
  r.tool('list_ideas', { title: 'List ideas', description: 'Sticky cards on the Ideas board (projects he has in mind and no time for yet). Filter by words; done ones are included unless include_done is false.', inputSchema: z.object({ query: z.string().optional(), include_done: z.boolean().optional() }), annotations: ann.RO }, (i) => read((b) => L.listIdeas(b, i)))
  r.tool('add_idea', { title: 'Add an idea card', description: `Put a sticky on the Ideas board. It lands on the first free spot, like the app's own assistant does. Colours: ${L.IDEA_COLORS.join(', ')} (default amber). Refuses a second card with the same title.`, inputSchema: z.object({ title: z.string(), body: z.string().optional(), color: z.enum(L.IDEA_COLORS as [string, ...string[]]).optional() }), annotations: ann.W }, (i) => write((b) => L.addIdea(b, i)))
  r.tool('edit_idea', { title: 'Edit an idea card', description: 'Change an idea card (found by id or title words): title, body, colour, board position x/y, or mark it done (done: true) / open again (done: false). Only passed fields change.', inputSchema: z.object({ ...ref, new_title: z.string().optional(), body: z.string().optional(), color: z.enum(L.IDEA_COLORS as [string, ...string[]]).optional(), x: z.number().optional(), y: z.number().optional(), done: z.boolean().optional() }), annotations: ann.WI }, ({ id, title, new_title, ...p }) => write((b) => L.editIdea(b, { id, title }, { title: new_title, ...p })))
  r.tool('delete_idea', { title: 'Delete an idea card', description: 'Delete an idea card for good. Confirm first unless asked.', inputSchema: z.object(ref), annotations: ann.D }, (i) => write((b) => L.deleteIdea(b, i)))

  /* ---------- prompts ---------- */
  r.tool('list_prompts', { title: 'List saved prompts', description: 'Prompts saved to tell Claude later. state: queue (default, not yet sent), sent, or all. Filter by project (exact) or words in the text.', inputSchema: z.object({ state: z.enum(['queue', 'sent', 'all']).optional(), project: z.string().optional(), query: z.string().optional(), limit: z.number().int().min(1).max(200).optional() }), annotations: ann.RO }, (i) => read((b) => L.listPrompts(b, i)))
  r.tool('add_prompt', { title: 'Save a prompt for later', description: `Save a prompt to the Prompts page. kind: ${L.PROMPT_KINDS.join(' | ')} (default Idea). project and session are free text naming the Claude Code project and session; both default to "General".`, inputSchema: z.object({ text: z.string(), project: z.string().optional(), session: z.string().optional(), kind: z.enum(L.PROMPT_KINDS as [string, ...string[]]).optional() }), annotations: ann.W }, (i) => write((b) => L.addPrompt(b, i)))
  r.tool('edit_prompt', { title: 'Edit a saved prompt', description: 'Change a saved prompt (id, or words from its start): text, project, session or kind. Only passed fields change.', inputSchema: z.object({ ...ref, text: z.string().optional(), project: z.string().optional(), session: z.string().optional(), kind: z.enum(L.PROMPT_KINDS as [string, ...string[]]).optional() }), annotations: ann.D }, ({ id, title, ...p }) => write((b) => L.editPrompt(b, { id, title }, p)))
  r.tool('set_prompt_sent', { title: 'Mark a prompt sent', description: 'Mark a saved prompt sent, or put it back in the queue with sent: false.', inputSchema: z.object({ ...ref, sent: z.boolean() }), annotations: ann.WI }, ({ id, title, sent }) => write((b) => L.setPromptSent(b, { id, title }, sent)))
  r.tool('delete_prompt', { title: 'Delete a saved prompt', description: 'Delete a saved prompt for good. Confirm first unless asked.', inputSchema: z.object(ref), annotations: ann.D }, (i) => write((b) => L.deletePrompt(b, i)))

  /* ---------- gym goals ---------- */
  r.tool('list_gym_goals', { title: 'List gym goals', description: 'Gym targets with unit, metric, the linked Hevy exercise and (manual goals) the number he keeps by hand. For LIVE progress (current value and % from his real Hevy sets) use get_gym.', inputSchema: z.object({}), annotations: ann.RO }, () => read(L.listGymGoals))
  r.tool('add_gym_goal', {
    title: 'Add a gym goal', description: 'New gym target. metric: e1rm (best estimated 1RM ever of a lift) and repTotal (rep total of one session) read a Hevy exercise, so exercise is required: the EXACT Hevy title, e.g. "Bench Press (Barbell)" (it cannot be verified here). sessions counts training days. manual is a number he keeps himself (bodyweight). Default metric: e1rm if an exercise is given, else manual. lower_is_better for bodyweight-type goals.',
    inputSchema: z.object({ name: z.string(), goal: z.number().min(0).max(1e6), unit: z.string().max(20), exercise: z.string().optional(), metric: z.enum(L.GYM_METRICS as [string, ...string[]]).optional(), lower_is_better: z.boolean().optional() }), annotations: ann.W,
  }, (i) => write((b) => L.addGymGoal(b, i)))
  r.tool('edit_gym_goal', {
    title: 'Edit a gym goal', description: 'Change a gym goal (id or name words): name, goal, unit, exercise, metric, note (null clears), lower_is_better, or current. current is only accepted for manual goals (others read Hevy). Only passed fields change.',
    inputSchema: z.object({ ...ref, new_name: z.string().optional(), goal: z.number().min(0).max(1e6).optional(), current: z.number().min(0).max(1e6).optional(), unit: z.string().max(20).optional(), exercise: z.string().optional(), metric: z.enum(L.GYM_METRICS as [string, ...string[]]).optional(), note: z.string().nullable().optional(), lower_is_better: z.boolean().optional() }), annotations: ann.WI,
  }, ({ id, title, new_name, ...p }) => write((b) => L.editGymGoal(b, { id, title }, { name: new_name, ...p })))
  r.tool('delete_gym_goal', { title: 'Delete a gym goal', description: 'Delete a gym goal for good. Confirm first unless asked.', inputSchema: z.object(ref), annotations: ann.D }, (i) => write((b) => L.deleteGymGoal(b, i)))
}
