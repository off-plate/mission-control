/* How a group of tools plugs into the server.

   Each area of the app (people, goals, routines, bills, ...) lives in its own
   tools-<area>.ts and exports `register(r: Reg)`. index.ts builds ONE Reg and
   calls every register(); the tests build the same Reg around a fake server and a
   fake database. Nothing in this file imports an npm package, so Node can run it.

   Rules every tool follows (they are why this layer exists):
   - a change goes through r.write(): compare-and-swap, safety stop, stamped Claude
   - a read goes through r.read(): never writes
   - a refusal is a McError: the person reads it, nothing was changed
   - an unexpected error is logged without data and answered plainly */

import { McError, type Blob } from './ops.ts'
import { commit, readState, type Db } from './commit.ts'

export interface ToolResult { content: { type: 'text'; text: string }[]; isError?: boolean }

export const text = (v: unknown): ToolResult => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] })
export const fail = (e: unknown): ToolResult => {
  if (e instanceof McError) return { isError: true, content: [{ type: 'text', text: e.message }] }
  console.error('mc-mcp unexpected error', e instanceof Error ? `${e.name}: ${e.message}` : String(e))
  return { isError: true, content: [{ type: 'text', text: 'Something went wrong on the server. Nothing was changed.' }] }
}

export interface Reg {
  /** zod */
  z: any
  /** supabase-js client scoped to HIS token (row-level security applies) */
  db: Db
  /** his user id (also the id of his mc_state row) */
  uid: string
  /** the MCP server's registerTool, already bound */
  tool: (name: string, config: Record<string, unknown>, cb: (args: any) => Promise<ToolResult> | ToolResult) => void
  /** a pure read of the state blob */
  read: <T>(fn: (b: Blob) => T) => Promise<ToolResult>
  /** a change to the state blob, as a compare-and-swap. fn returns { text } (what happened). */
  write: <T extends { text: string }>(fn: (b: Blob) => T) => Promise<ToolResult>
  /** anything else (another table): runs fn, a McError becomes a refusal, a string or object becomes the answer */
  safe: (fn: () => Promise<unknown> | unknown) => Promise<ToolResult>
  /** MCP tool annotations: RO read-only, W adds, WI idempotent change, D destructive */
  ann: { RO: Record<string, boolean>; W: Record<string, boolean>; WI: Record<string, boolean>; D: Record<string, boolean> }
  /** shared zod pieces */
  s: { space: any; slot: any; ref: Record<string, any>; steps: any; date: any; time: any }
}

export function makeReg(o: { server: { registerTool: (...a: any[]) => unknown }; z: any; db: Db; uid: string }): Reg {
  const { z, db, uid, server } = o
  return {
    z, db, uid,
    tool: (name, config, cb) => { server.registerTool(name, config, cb) },
    read: async (fn) => { try { return text(fn(await readState(db, uid))) } catch (e) { return fail(e) } },
    write: async (fn) => { try { return text((await commit(db, uid, fn)).text) } catch (e) { return fail(e) } },
    safe: async (fn) => { try { return text(await fn()) } catch (e) { return fail(e) } },
    ann: {
      RO: { readOnlyHint: true, openWorldHint: false },
      W: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      WI: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      D: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    s: {
      space: z.enum(['personal', 'work']),
      slot: z.enum(['morning', 'noon', 'afternoon', 'evening']),
      ref: { id: z.string().optional().describe('Exact id from a list (preferred)'), title: z.string().optional().describe('Part of the title or name, if no id. Must match exactly one row.') },
      steps: z.array(z.object({ title: z.string(), minutes: z.number().int().min(1).optional() })).max(40),
      date: z.string().describe('YYYY-MM-DD, Prague time'),
      time: z.string().describe('HH:MM, 24 hour'),
    },
  }
}
