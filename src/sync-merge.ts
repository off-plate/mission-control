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
   the later edit wins it. Nothing else here is a conflict.

   Notes are the exception, because a note is not a field he can retype: see
   resolveNote, where a body that loses is kept on the note instead of dropped. */

type Row = Record<string, unknown>

/** How many past bodies a note remembers. One entry per keystroke, so this is
 *  a few seconds of fast typing, not a few edits. It is a backstop now rather
 *  than the main defence: see the device check in resolveNote. */
export const HIST = 60

/** This install, so a note can tell its own earlier self from another device.
 *  Stable for the life of the browser profile; a fresh profile is genuinely a
 *  different device and should be treated as one. */
const DEVICE_KEY = 'mc-device'
let cachedDevice: string | null = null
export function deviceId(): string {
  if (cachedDevice) return cachedDevice
  try {
    const found = localStorage.getItem(DEVICE_KEY)
    if (found) return (cachedDevice = found)
    const made = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    localStorage.setItem(DEVICE_KEY, made)
    return (cachedDevice = made)
  } catch {
    // Private mode with no storage: one id for this session is still better
    // than none, since it is stable for as long as the tab is open.
    return (cachedDevice = 'd-session')
  }
}

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
  stepTicks: (r) => `stepTicks:${r.routineId}|${r.stepId}|${r.day}`,
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
  notes: (r) => `notes:${r.id}`,
  noteFolders: (r) => `noteFolders:${r.id}`,
  coachSessions: (r) => `coachSessions:${r.id}`,
  assistantLog: (r) => `assistantLog:${r.id}`,
}

const ALL_KEYS: Record<string, (r: Row) => string> = { ...LOG_KEYS, ...ENTITY_KEYS }

/** FNV-1a over a body, short and stable. Not security, just identity: two
 *  devices must agree on the hash of the same text without exchanging it. */
export function bodyHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(36)
}

/* A note is the one row where "the newer side wins" is not good enough. Every
   other row is a handful of fields he can retype in seconds; a note is the
   paragraph he wrote on the train, and losing it silently is the whole reason
   this file exists.

   The hard part is telling apart two cases that look identical in a blob:
   this device simply has not received the other's edit yet, and both devices
   edited since they last agreed. Declaring a conflict on the first would put a
   scary banner on a note every time an ordinary save propagates. So each note
   carries the hashes of the bodies it has already had. If the losing body is
   one of the winner's ancestors, the loser is merely behind, and the newer
   text stands alone. If it is not, they genuinely diverged, and the loser's
   body is kept on the note rather than thrown away. */
function resolveNote(a: Row, b: Row): Row {
  const at = (r: Row) => (typeof r.updatedAt === 'number' ? r.updatedAt : 0)
  const [win, lose] = at(b) > at(a) ? [b, a] : [a, b]
  const wb = String(win.body ?? '')
  const lb = String(lose.body ?? '')
  const hist = [...new Set([...(lose.hist as string[] ?? []), ...(win.hist as string[] ?? [])])].slice(-HIST)
  const out: Row = { ...win, hist }
  /* A conflict already on either side outlives this merge: it is unanswered
     work, and only he closes it. */
  const kept = (win.conflict ?? lose.conflict) as { body: string; at: number } | undefined
  if (kept) out.conflict = kept
  if (wb === lb || !lb) return out

  /* The banner says "another device". So one device can never conflict with
     ITSELF, and this is the check that makes that true.

     It was reported as a note raising the banner seconds after it was first
     typed, on a note that had never been opened anywhere else, and it was
     real. Every save pushes to Supabase, and every push merges the pushed
     copy against the remote head, which on a single device is that same
     device's own push from a moment ago. The ancestor test below should have
     recognised it, but `hist` records one entry per KEYSTROKE and is capped,
     so typing a sentence between two pushes rolls the older body off the end
     of its own history. The merge then sees an unfamiliar body and calls it
     divergence. */
  if (win.dev && lose.dev && win.dev === lose.dev) return out

  // The loser is an ancestor of the winner: ordinary propagation, nothing lost.
  if (hist.includes(bodyHash(lb))) return out
  /* Or it is one, without the hash to prove it: pure appending, which is what
     writing a note IS. Covers notes written before devices were stamped, and
     any history that has rolled over. */
  if (wb.startsWith(lb)) return out
  // Two lineages. Keep the newer text as the note and the older text beside it.
  if (!kept || kept.body !== lb) out.conflict = { body: lb, at: at(lose) }
  return out
}

/** Fields where being on the newer side is not enough to win outright. */
const RESOLVE: Record<string, (a: Row, b: Row) => Row> = { notes: resolveNote }

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
      const resolve = RESOLVE[field]
      const seen = new Map<string, Row>()
      /* The newer side goes in first, so whatever is already in the map came
         from it and the row in hand came from the older one. */
      for (const row of [...((newer[field] as Row[]) ?? []), ...((older[field] as Row[]) ?? [])]) {
        if (!row || typeof row !== 'object') continue
        const k = keyOf(row)
        if (buried.has(k)) continue
        const have = seen.get(k)
        if (!have) seen.set(k, row)
        else if (resolve) seen.set(k, resolve(have, row))
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

    /* The daily review's two once-a-day flags are dates, and the later date is
       the true one whichever side is carrying it. Letting them follow the newer
       blob meant a laptop that had been open since yesterday could save at nine
       and re-offer a review he had already walked on his phone at eight. */
    for (const k of ['dailyDone', 'dailySkipped'] as const) {
      const a2 = typeof older[k] === 'string' ? (older[k] as string) : ''
      const b2 = typeof newer[k] === 'string' ? (newer[k] as string) : ''
      const best = a2 > b2 ? a2 : b2
      if (best) out[k] = best
    }
    return JSON.stringify(out)
  } catch {
    return a
  }
}
