/* Why this file exists: the state syncs as ONE blob, and twice in one weekend a
   staler copy of it overwrote a newer one, taking a finished routine and an
   evening of focus with it. A phone tab left open since the afternoon saves
   once, and the night's work is gone, remotely at once and locally on the next
   boot, because boot hydrated the remote blob over localStorage wholesale.

   The rule now: WORK IS NEVER THE LOSER. The dated logs, which is where work
   lives, are the union of both sides. Everything else (structure: tasks,
   habits, routines, goals, settings) follows the side that saved last, because
   structure is edited deliberately and rarely races. The one cost is that
   deleting a log row on one device can be undone by an older device that still
   holds the row; a resurrected tick is an annoyance, a vanished evening is why
   this file exists. */

type Row = Record<string, unknown>
interface BlobState {
  savedAt?: number
  schema?: string
  records?: Record<string, number>
  [k: string]: unknown
}

/** Identity per log, so the union never duplicates what both sides agree on. */
const LOG_KEYS: Record<string, (r: Row) => string> = {
  focusSessions: (r) => String(r.id),
  ledger: (r) => String(r.id),
  habitLog: (r) => `${r.habitId}|${r.day}|${r.src ?? ''}`,
  routineLog: (r) => `${r.routineId}|${r.periodKey}|${r.run ?? 0}|${r.day}`,
  stepLog: (r) => `${r.routineId}|${r.stepId}|${r.at ?? r.day}`,
  slips: (r) => `${r.habitId}|${r.day}`,
}

/** Merge two serialized states. The newer side (by savedAt) wins structure;
 *  the logs are the union of both. Falls back to `a` when anything is off. */
export function mergeStates(a: string, b: string): string {
  try {
    const A = JSON.parse(a) as BlobState
    const B = JSON.parse(b) as BlobState
    if (!A || typeof A !== 'object') return b
    if (!B || typeof B !== 'object') return a
    // Different schemas cannot be merged row-wise; the newer one stands alone.
    if (A.schema !== B.schema) return (A.savedAt ?? 0) >= (B.savedAt ?? 0) ? a : b
    const newer = (A.savedAt ?? 0) >= (B.savedAt ?? 0) ? A : B
    const older = newer === A ? B : A
    const out: BlobState = { ...newer }
    for (const [field, keyOf] of Object.entries(LOG_KEYS)) {
      const seen = new Map<string, Row>()
      for (const row of [...((newer[field] as Row[]) ?? []), ...((older[field] as Row[]) ?? [])]) {
        const k = keyOf(row)
        if (!seen.has(k)) seen.set(k, row)
      }
      out[field] = [...seen.values()]
    }
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
