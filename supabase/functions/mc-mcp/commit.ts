/* Reading and writing his state row, safely.

   The state is ONE jsonb row (mc_state, id = his user id) and every device saves
   by reading it, merging its copy in, and writing it back (src/supabase.ts
   saveRemoteState). A second writer that is not careful loses work, which is the
   one thing this app is built never to do (src/sync-merge.ts: "WORK IS NEVER THE
   LOSER").

   So this writer is a COMPARE-AND-SWAP: read the row and its updated_at, apply
   the change to that copy, and write only if updated_at is still what was read.
   If another device saved in between, nothing is written and the change is
   re-applied to the fresh row. A change can therefore never overwrite an edit it
   did not see.

   One race remains that no server can close: a device that read the row BEFORE
   this write and saves AFTER it merges its own older copy, and for a row both
   copies hold the newer-saved copy wins. This writer stamps savedAt, as the
   Obsidian sync job does, so it counts as the newer side. It is the same window
   every phone and laptop already share.

   The db is any object shaped like a supabase-js client, so the tests can hand
   it a fake. */

import { McError, shrinkAllowance, type Blob } from './ops.ts'

export interface Db { from(table: string): any }
const TABLE = 'mc_state'

export interface Head { data: Blob; updated_at: string }

export async function readHead(db: Db, uid: string): Promise<Head | null> {
  const { data, error } = await db.from(TABLE).select('data, updated_at').eq('id', uid).maybeSingle()
  if (error) throw new McError(`Could not read Mission Control: ${error.message}`)
  if (!data?.data || typeof data.data !== 'object') return null
  return { data: data.data as Blob, updated_at: String(data.updated_at) }
}

/** For reads. Never writes. */
export async function readState(db: Db, uid: string): Promise<Blob> {
  const head = await readHead(db, uid)
  if (!head) throw new McError('No Mission Control data is saved for this account yet. Open the app once so it can sync, then ask again.')
  return head.data
}

/** The only invariant that matters: an operation here removes at most ONE row
 *  from a collection, and never drops a collection. A bug in an operation that
 *  would wipe a list stops here, before anything is written. */
export function guard(before: Blob, after: Blob): void {
  const allow = shrinkAllowance(after) // a cascading operation declares exactly how many extra rows it removes
  for (const [k, v] of Object.entries(before)) {
    if (!Array.isArray(v)) continue
    const now = after[k]
    if (!Array.isArray(now)) throw new McError(`Safety stop: "${k}" would have been removed. Nothing was written.`)
    if (now.length < v.length - 1 - (allow[k] ?? 0)) throw new McError(`Safety stop: "${k}" would have shrunk from ${v.length} to ${now.length}. Nothing was written.`)
  }
}

export async function commit<T>(
  db: Db, uid: string, mutate: (b: Blob) => T,
  opts: { tries?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const tries = opts.tries ?? 5
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  for (let n = 0; n < tries; n++) {
    const head = await readHead(db, uid)
    if (!head) throw new McError('No Mission Control data is saved for this account yet. Open the app once so it can sync, then try again. (This connector never creates your data from nothing.)')
    const work = structuredClone(head.data) as Blob
    const result = mutate(work) // a McError here propagates: nothing is written
    guard(head.data, work)
    const now = Date.now()
    work.lastWrite = { dev: 'claude-mcp', name: 'Claude', at: now } // so the app can say "Updated from Claude"
    work.savedAt = now // the merge picks the newer blob by this field; this write genuinely is the newest
    const { data, error } = await db.from(TABLE)
      .update({ data: work, updated_at: new Date().toISOString() })
      .eq('id', uid).eq('updated_at', head.updated_at)
      .select('id')
    if (error) throw new McError(`Could not save to Mission Control: ${error.message}`)
    if (Array.isArray(data) && data.length === 1) return result
    // Someone saved between the read and the write: take their copy and apply the change again.
    await sleep(60 * (n + 1))
  }
  throw new McError('Mission Control was changing at the same moment and the change could not be saved safely. Nothing was changed. Try again.')
}
