/* Is a new task the same thing as one already open, said in other words?

   Built 2026-10-16 after he asked for it outright: he dictates whole days and
   says the same task differently each time ("buy the MC domain", "finalize and
   buy the Michael's Corner domain"). An exact-title check (assistantcore's add)
   caught only word-for-word repeats, so every rephrasing became a duplicate.

   Words, not meaning: lowercase, accents off, filler dropped, each word cut to
   its first five letters so "reminders" meets "reminder" and Czech endings
   meet each other. Two titles are similar when most of the shorter one's
   words are in the longer one. The model handles meaning (MC = Michael's
   Corner); this catches what it misses, against every open task, not only
   the 25 the briefing shows. */

const FILLER = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'about', 'that', 'this', 'out', 'off', 'all', 'some', 'our', 'my', 'your',
  'need', 'have', 'get', 'got', 'make', 'do', 'does', 'done', 'want', 'try', 'finish', 'finalize', 'start', 'new',
  'today', 'tomorrow', 'next', 'way', 'how', 'what', 'figure', 'find', 'thing', 'things', 'stuff', 'also', 'more',
  /* Verbs and objects half his tasks share; two of them alone matched
     "Send prospect reminder emails" to "Send 10 outreach emails". */
  'send', 'email', 'emails', 'mail', 'call', 'write', 'check', 'update', 'review', 'prepare', 'plan', 'set', 'task',
  'pro', 'na', 'do', 'se', 'si', 'je', 'to', 'ze', 'od', 'po', 'za', 'jak', 'aby', 'dnes', 'zitra', 'udelat', 'nove',
])

export function stems(title: string): string[] {
  const words = title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/https?:\/\/\S+/g, ' ').split(/[^a-z0-9]+/)
  const out = new Set<string>()
  for (const w of words) if (w.length >= 3 && !FILLER.has(w)) out.add(w.slice(0, 5))
  return [...out]
}

/** The open title that looks most like `title`, or null. Two words in common
 *  at the least, so one shared word ("email", "website") is never enough. */
export function similarTo<T extends { title: string }>(title: string, open: T[]): T | null {
  const mine = stems(title)
  let best: T | null = null, score = 0
  for (const t of open) {
    const theirs = new Set(stems(t.title))
    const shared = mine.filter((w) => theirs.has(w)).length
    if (shared < 2) continue
    const s = shared / Math.min(mine.length, theirs.size)
    if (s >= 0.6 && s > score) { best = t; score = s }
  }
  return best
}

/** Which workspace a new task belongs in, judged from where his most similar
 *  task already lives (done ones count: they are his history). One shared word
 *  is enough here, because this only picks a side, it never blocks anything. */
export function spaceFrom<S, T extends { title: string; space?: S }>(title: string, all: T[]): S | undefined {
  const mine = stems(title)
  let best: S | undefined, score = 0
  for (const t of all) {
    if (!t.space) continue
    const theirs = new Set(stems(t.title))
    const shared = mine.filter((w) => theirs.has(w)).length
    if (shared > score) { best = t.space; score = shared }
  }
  return best
}
