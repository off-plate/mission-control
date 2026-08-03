/* Why this file exists: the state syncs as ONE blob, and twice in one weekend a
   staler copy of it overwrote a newer one, taking a finished routine and an
   evening of focus with it. A phone tab left open since the afternoon saves
   once, and the night's work is gone, remotely at once and locally on the next
   boot, because boot hydrated the remote blob over localStorage wholesale.

   The rule: WORK IS NEVER THE LOSER.

   The first version of this file united the dated LOGS and let everything else
   follow the side that saved last. That was still wholesale for tasks, habits,
   goals, routines and notes: add a task on the phone, add another on the
   laptop, and whichever saved second replaced the other's whole list. Two tabs
   of one browser did it to each other just as happily. So every collection is
   now merged ROW BY ROW, by its own identity.

   Which raises the only hard question a mergeable store has: if both sides are
   united, how does anything ever get deleted? A row missing from one side is
   indistinguishable from a row the other side has not seen yet. So deletion is
   recorded rather than inferred. The graveyard carries the key of everything
   deliberately deleted, it survives the merge like any other fact, and a buried
   key is dropped from both sides. Undo digs it back up.

   What still loses: two devices editing the SAME row. That row is one thing and
   the later edit wins it. Nothing else here is a conflict. */

type Row = Record<string, unknown>

/** What happened to a key, and when. `undone` is an un-delete: a tombstone can
 *  only ever be ADDED across devices, so without a dated opposite an undo on
 *  this device is overturned the moment another device that still holds the
 *  tombstone saves anything at all. Latest word per key wins. */
export interface Tomb { k: string; at: number; undone?: boolean }

interface BlobState {
  savedAt?: number
  schema?: string
  records?: Record<string, number>
  removedSeeds?: string[]
  graveyard?: Tomb[]
  [k: string]: unknown
}

/** Identity per dated log, so the union never duplicates what both sides agree
 *  on. These rows are the record of what he actually did. */
const LOG_KEYS: Record<string, (r: Row) => string> = {
  focusSessions: (r) => `focusSessions:${r.id}`,
  ledger: (r) => `ledger:${r.id}`,
  habitLog: (r) => `habitLog:${r.habitId}|${r.day}|${r.src ?? ''}`,
  routineLog: (r) => `routineLog:${r.routineId}|${r.periodKey}|${r.run ?? 0}|${r.day}`,
  stepLog: (r) => `stepLog:${r.routineId}|${r.stepId}|${r.at ?? r.day}`,
  slips: (r) => `slips:${r.habitId}|${r.day}`,
}

/** Identity per collection of things he made. Everything here is created with a
 *  unique id, so the id IS the identity and two sides can be united safely. */
const ENTITY_KEYS: Record<string, (r: Row) => string> = {
  tasks: (r) => `tasks:${r.id}`,
  habits: (r) => `habits:${r.id}`,
  goals: (r) => `goals:${r.id}`,
  routines: (r) => `routines:${r.id}`,
  ideas: (r) => `ideas:${r.id}`,
  coachSessions: (r) => `coachSessions:${r.id}`,
  assistantLog: (r) => `assistantLog:${r.id}`,
}

const ALL_KEYS: Record<string, (r: Row) => string> = { ...LOG_KEYS, ...ENTITY_KEYS }

/** The key a row is buried under, so the store can bury or dig up the same
 *  thing this file will look for. */
export function rowKey(field: string, row: Row): string {
  const f = ALL_KEYS[field]
  return f ? f(row) : `${field}:${String(row.id)}`
}

/** Merge two serialized states. Every collection is the union of both sides by
 *  row identity, a row both sides hold takes the newer side's version, and
 *  anything in either graveyard is dropped. Falls back to `a` when anything is
 *  off, because a merge that cannot be trusted must not be the one that wins. */
export function mergeStates(a: string, b: string): string {
  /* Each side is parsed on its own, so one unreadable blob leaves the readable
     one standing instead of taking it down with it. */
  const read = (j: string): BlobState | null => {
    try { const o = JSON.parse(j) as BlobState; return o && typeof o === 'object' ? o : null } catch { return null }
  }
  try {
    const A = read(a)
    const B = read(b)
    if (!A) return B ? b : a
    if (!B) return a
    // Different schemas cannot be merged row-wise; the newer one stands alone.
    if (A.schema !== B.schema) return (A.savedAt ?? 0) >= (B.savedAt ?? 0) ? a : b
    const newer = (A.savedAt ?? 0) >= (B.savedAt ?? 0) ? A : B
    const older = newer === A ? B : A
    const out: BlobState = { ...newer }

    /* The graveyard is itself a fact each side may know only half of, and the
       last word about a key is the one that counts: deleted, or dug back up. */
    const word = new Map<string, Tomb>()
    for (const t of [...(older.graveyard ?? []), ...(newer.graveyard ?? [])]) {
      if (!t || typeof t.k !== 'string') continue
      const prev = word.get(t.k)
      if (!prev || (t.at ?? 0) >= (prev.at ?? 0)) word.set(t.k, t)
    }
    out.graveyard = [...word.values()].slice(-900)
    const buried = new Set([...word.values()].filter((t) => !t.undone).map((t) => t.k))

    for (const [field, keyOf] of Object.entries(ALL_KEYS)) {
      // Absent on both sides stays absent, rather than becoming an empty list.
      if (newer[field] === undefined && older[field] === undefined) continue
      const seen = new Map<string, Row>()
      for (const row of [...((newer[field] as Row[]) ?? []), ...((older[field] as Row[]) ?? [])]) {
        if (!row || typeof row !== 'object') continue
        const k = keyOf(row)
        if (buried.has(k)) continue
        if (!seen.has(k)) seen.set(k, row)
      }
      out[field] = [...seen.values()]
    }

    /* Seeds he has deleted: a tombstone list already, so it unions. Losing an
       entry here brings a deleted seed back on the next boot. */
    out.removedSeeds = [...new Set([...(older.removedSeeds ?? []), ...(newer.removedSeeds ?? [])])]

    /* All-time bests: the best is the best, whichever side remembers it. */
    const records: Record<string, number> = { ...(older.records ?? {}), ...(newer.records ?? {}) }
    for (const [k, v] of Object.entries(older.records ?? {})) {
      if (typeof v === 'number' && typeof records[k] === 'number') records[k] = Math.max(records[k], v)
    }
    out.records = records
    return JSON.stringify(out)
  } catch {
    return a
  }
}
