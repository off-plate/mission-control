/* The dock's own popularity contest (his ask, 2026-09-12, after reviewing
   three interactive directions in an artifact and picking "The Trimmed
   Stack"): only the 3 tools he actually reaches for most show as pills, the
   rest live one tap behind a fourth "More" pill. "Popularity" here means a
   score per tool that goes up when he opens it and fades back down on its
   own -- his words were "I might be using the same items for a week
   straight, but then... other items... I would look at it within each of
   the day maybe" -- so a stale favorite has to visibly lose ground to
   whatever he's actually been reaching for lately, not just accumulate
   forever. A half-life, not a fixed decay-per-day: it keeps working exactly
   the same whether the dock goes untouched for six hours or six days,
   rather than needing a "how many days since last visit" branch of its own.

   Kept entirely separate from dock.tsx's own state: this only ever reads
   and writes localStorage, so ranking survives a reload the same way every
   other piece of his data already does, and dock.tsx never has to think
   about persistence at all. */

const KEY = 'mission-control-dockrank-v1'
// Roughly his own "within each of the day maybe": a score halves about
// every 4 days, so a tool he hasn't opened in a week has already faded to
// under a third of what it was, while one from yesterday barely moved.
const HALF_LIFE_MS = 4 * 24 * 60 * 60 * 1000

type Row = { score: number; at: number }
type Store = Record<string, Row>

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function write(store: Store) {
  try { localStorage.setItem(KEY, JSON.stringify(store)) } catch { /* private mode, quota -- ranking just resets */ }
}

// Never persisted on its own -- a read that only wants current standing
// (rankDockItems) has no reason to write anything back, only a real open
// (bumpDockRank) does.
function decayedScore(row: Row | undefined, now: number): number {
  if (!row) return 0
  const elapsed = Math.max(0, now - row.at)
  return row.score * Math.pow(0.5, elapsed / HALF_LIFE_MS)
}

// Call once per real open of a tool -- a click on its pill, a hold through
// to its full page, or a switch to it from another open panel. Every OTHER
// row is left untouched: its own `at` is what decay reads from later, so it
// only needs to move the day IT is actually opened.
export function bumpDockRank(id: string): void {
  const now = Date.now()
  const store = read()
  store[id] = { score: decayedScore(store[id], now) + 1, at: now }
  write(store)
}

// Highest current score first. An id with no history at all reads as 0 and
// sorts last, in the order it was given -- Array#sort is stable, so a dock
// he's never touched still renders in the same order the panels array
// always has.
export function rankDockItems<T extends { id: string }>(items: T[]): T[] {
  const now = Date.now()
  const store = read()
  return [...items].sort((a, b) => decayedScore(store[b.id], now) - decayedScore(store[a.id], now))
}
