import { type Note } from '../types'

/** A URL pasted straight into a task title reads fine as a link on his own
 *  list, and reads as noise once a sentence has to carry it -- on screen as a
 *  wall of characters, out loud as a wall of syllables. Stripped here rather
 *  than asked of the model, so a title with a link in it cannot come back
 *  verbatim no matter how the model chooses to write the sentence around it. */
export const dropUrl = (title: string) => title.replace(/https?:\/\/\S+/gi, '').replace(/\s{2,}/g, ' ').trim()

/** Loose enough to find "the noon testing task" from "test testing website",
 *  strict enough to refuse when two rows could both be meant. Accents are
 *  folded because half his titles are Czech and he types them without. */
export const fold = (t: string) =>
  t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

/** The one tier of rows pick()/pickAll() actually decide on -- exact title,
 *  else substring, else every word present in any order, whichever of the
 *  three is the first to turn up anything at all. Split out from pick()
 *  itself (2026-09-08) so pickAll() can share the exact same tiering
 *  without a second, drifting copy of it. */
export function candidates<T extends { title: string }>(rows: T[], match: string): T[] {
  const m = fold(match)
  if (!m) return []
  const exact = rows.filter((r) => fold(r.title) === m)
  if (exact.length === 1) return exact
  const has = rows.filter((r) => fold(r.title).includes(m))
  if (has.length >= 1) return has
  /* Last resort: every word he used has to appear, in any order. This is what
     turns "noon testing task" into the row actually called "test testing
     website", and it is deliberately the LAST thing tried. */
  const words = m.split(' ').filter((w) => w.length > 2)
  return words.length ? rows.filter((r) => words.every((w) => fold(r.title).includes(w))) : []
}

export function pick<T extends { title: string }>(rows: T[], match: string): { row?: T; why?: string } {
  if (!fold(match)) return { why: 'nothing to look for' }
  const found = candidates(rows, match)
  if (found.length === 1) return { row: found[0] }
  if (found.length > 1) return { why: `${found.length} of them match "${match}"` }
  return { why: `nothing here is called "${match}"` }
}

/** A note has no reliable title -- most are just typed text -- so it is named
 *  the way its own list names it: the title, else its first line. */
export const noteName = (n: Note) => n.title || n.body.split('\n')[0].slice(0, 60)
