/* Precedent: the app recognising the shape of today, and telling him what
   happened the last time a day looked like this.

   Not a prediction and not advice. He does not take advice from software, and
   he is right not to. What he does take is his own handwriting from three
   weeks ago, produced at 21:40 on a night that is unmistakably going the same
   way as the last nine.

   THE FOUR LAWS, in order of how badly breaking them would end this feature.

   1. IT IS SILENT BY DEFAULT. An app that comments on every day is wallpaper
      by week three, and then it is wallpaper on the day it had something worth
      saying. It speaks when the match is strong AND the outcome was one-sided,
      and never more than once a day or three times a week. When in doubt it
      says nothing, and saying nothing is the normal case.
   2. IT NEVER INVENTS. Every number is counted from a dated row he wrote by
      living. Every quoted sentence is his own text, verbatim, with the day it
      was written. There is no model here, no API, no generated prose, so there
      is nothing that can hallucinate.
   3. IT COMPARES LIKE WITH LIKE. A day is fingerprinted AT AN HOUR, from what
      had already happened by that hour. Comparing this evening against whole
      past days would match on the wrong thing entirely.
   4. IT ENDS ON A DOOR, NOT A VERDICT. The last line is what the days that
      went differently actually did, counted, and a button that does it. If it
      cannot find that, it says nothing at all, because a bare "this usually
      goes badly" is a guilt mechanic with a timestamp on it.

   Pure, and separate from anything that renders it, so every sentence can be
   tested against a fabricated history with no browser in the room. */

export interface PBlob {
  focusSessions?: any[]
  habitLog?: any[]
  habits?: any[]
  tasks?: any[]
  notes?: any[]
  review?: any
}

/** Local date key, the app's own convention. */
const key = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Hour of day of an ISO instant, in local time. Rows without a stamp are
 *  skipped rather than guessed at: a tick with no clock time is a tick he made
 *  on some other day, and pretending it happened at midnight would put it in
 *  the wrong half of every comparison. */
const hourOf = (iso?: string): number | null => {
  if (!iso) return null
  const t = new Date(iso)
  return Number.isNaN(t.getTime()) ? null : t.getHours() + t.getMinutes() / 60
}

const dowOf = (k: string) => {
  const [y, m, d] = k.split('-').map(Number)
  return (new Date(y, m - 1, d).getDay() + 6) % 7
}

/** What had already happened on `day` by `hour`. */
export interface Shape {
  day: string
  focusBefore: number
  keptBefore: number
  finishedBefore: number
  hoursSinceBlock: number
  weekend: boolean
}

export function shapeOf(s: PBlob, day: string, hour: number): Shape {
  const blocks = (s.focusSessions ?? []).filter((f: any) => f.day === day)
  /* A block's `at` is when it ENDED, so its minutes belong before the cursor
     only if it had finished by then. */
  const before = blocks.filter((f: any) => { const h = hourOf(f.at); return h !== null && h <= hour })
  const focusBefore = before.reduce((a: number, f: any) => a + (f.minutes ?? 0), 0)
  const lastEnd = before.reduce((a: number, f: any) => Math.max(a, hourOf(f.at) ?? 0), -1)
  const keptBefore = (s.habitLog ?? []).filter((t: any) => {
    if (t.day !== day) return false
    const h = hourOf(t.at)
    return h !== null && h <= hour
  }).length
  const finishedBefore = (s.tasks ?? []).filter((t: any) => {
    if (!t.done || !t.doneAt) return false
    const dt = new Date(t.doneAt)
    if (Number.isNaN(dt.getTime()) || key(dt) !== day) return false
    return dt.getHours() + dt.getMinutes() / 60 <= hour
  }).length
  return {
    day,
    focusBefore,
    keptBefore,
    finishedBefore,
    hoursSinceBlock: lastEnd < 0 ? 12 : Math.min(12, Math.max(0, hour - lastEnd)),
    weekend: dowOf(day) >= 5,
  }
}

/** What happened on `day` AFTER `hour`. This is the outcome being matched on. */
export function restOf(s: PBlob, day: string, hour: number): { focusAfter: number; finishedAfter: number; firstBlockWithinHour: boolean } {
  const after = (s.focusSessions ?? []).filter((f: any) => {
    if (f.day !== day) return false
    const h = hourOf(f.at)
    return h !== null && h > hour
  })
  const focusAfter = after.reduce((a: number, f: any) => a + (f.minutes ?? 0), 0)
  /* Started within the hour: a block that ENDED within (hour, hour + 1 + its
     own length] began inside the next sixty minutes. */
  const firstBlockWithinHour = after.some((f: any) => {
    const h = hourOf(f.at) as number
    return h - (f.minutes ?? 0) / 60 <= hour + 1
  })
  const finishedAfter = (s.tasks ?? []).filter((t: any) => {
    if (!t.done || !t.doneAt) return false
    const dt = new Date(t.doneAt)
    if (Number.isNaN(dt.getTime()) || key(dt) !== day) return false
    return dt.getHours() + dt.getMinutes() / 60 > hour
  }).length
  return { focusAfter, finishedAfter, firstBlockWithinHour }
}

/** Nothing more of substance got done. Deliberately generous: fifteen minutes
 *  or one finished thing is enough to count as a day that kept going, so this
 *  only fires on evenings that genuinely stopped. */
const wentQuiet = (r: { focusAfter: number; finishedAfter: number }) =>
  r.focusAfter < 15 && r.finishedAfter === 0

/** Distance between two shapes. Each term is scaled to roughly 0..1 first so
 *  that four hours of focus does not drown out everything else. */
export function distance(a: Shape, b: Shape): number {
  const cap = (v: number, max: number) => Math.min(1, Math.max(0, v / max))
  const terms = [
    cap(a.focusBefore, 240) - cap(b.focusBefore, 240),
    cap(a.keptBefore, 8) - cap(b.keptBefore, 8),
    cap(a.finishedBefore, 5) - cap(b.finishedBefore, 5),
    cap(a.hoursSinceBlock, 12) - cap(b.hoursSinceBlock, 12),
    (a.weekend ? 1 : 0) - (b.weekend ? 1 : 0),
  ]
  return Math.sqrt(terms.reduce((s, t) => s + t * t, 0))
}

/** His own words from that day, verbatim. A note he wrote that day first,
 *  because it is the closest thing to a diary entry; failing that the honest
 *  "what drifted" line from a reflection whose window covers the day.
 *  Never paraphrased, never assembled, never generated. */
export function wordsOn(s: PBlob, day: string): { day: string; text: string } | null {
  const clean = (raw: string): string | null => {
    const line = String(raw ?? '')
      .replace(/<[^>]*>/g, ' ')
      .split('\n').map((l) => l.trim()).filter(Boolean)[0]
    if (!line) return null
    const t = line.trim()
    return t.length >= 12 ? t.slice(0, 180) : null
  }
  for (const n of s.notes ?? []) {
    if (n.when !== day) continue
    const t = clean(n.body)
    if (t) return { day, text: t }
  }
  const live = (s.review?.reflections ?? []).filter((r: any) => !r.supersededBy)
  for (const r of live) {
    if (!(r.from <= day && day <= r.to)) continue
    const t = clean(r.drifted ?? '')
    if (t) return { day: r.when ?? day, text: t }
  }
  return null
}

export interface Precedent {
  matched: number
  sameWay: number
  /** What usually happens from here, counted. */
  headline: string
  /** His own sentence, from one of those days. */
  quote: { day: string; text: string } | null
  /** What the days that went differently had in common. Null means stay quiet. */
  turn: string | null
}

/** How many past days must match before it is allowed to say anything. Five is
 *  the floor at which "seven of nine" stops being an anecdote. */
const MIN_MATCHES = 5
/** How one-sided the outcome has to be. */
const MIN_SHARE = 0.7
/** How close a past day has to be to count as the same shape. */
const MAX_DISTANCE = 0.34

const nice = (k: string) => {
  const [y, m, d] = k.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
}

/**
 * The whole mechanic. Returns null far more often than not, and that is the
 * design rather than a failure to find something.
 */
export function precedentFor(s: PBlob, now: Date): Precedent | null {
  const today = key(now)
  const hour = now.getHours() + now.getMinutes() / 60
  /* Before the evening there is not enough of a day to have a shape, and
     after midnight the question is moot. */
  if (hour < 17 || hour > 23.5) return null

  const here = shapeOf(s, today, hour)

  /* Every earlier day that has any dated record at all. A day with nothing on
     it is not evidence of a quiet evening, it is evidence of a day the app was
     not used, and counting those would make every comparison say "you stop". */
  const seen = new Set<string>()
  for (const f of s.focusSessions ?? []) if (f.day && f.day < today) seen.add(f.day)
  for (const t of s.habitLog ?? []) if (t.day && t.day < today && t.at) seen.add(t.day)
  for (const t of s.tasks ?? []) {
    if (!t.done || !t.doneAt) continue
    const d = new Date(t.doneAt)
    if (!Number.isNaN(d.getTime()) && key(d) < today) seen.add(key(d))
  }

  const near: { day: string; rest: ReturnType<typeof restOf> }[] = []
  for (const day of seen) {
    if (distance(here, shapeOf(s, day, hour)) > MAX_DISTANCE) continue
    near.push({ day, rest: restOf(s, day, hour) })
  }
  if (near.length < MIN_MATCHES) return null

  const quiet = near.filter((n) => wentQuiet(n.rest))
  const share = quiet.length / near.length
  if (share < MIN_SHARE) return null

  /* Law 4: it must be able to end on a door. The days that went differently
     have to actually have something in common, or there is nothing to offer
     and the whole thing collapses into a verdict. */
  const kept = near.filter((n) => !wentQuiet(n.rest))
  const started = kept.filter((n) => n.rest.firstBlockWithinHour).length
  const turn = kept.length > 0 && started / kept.length >= 0.5
    ? `The ${kept.length === 1 ? 'one' : kept.length} that went differently started a block within the hour.`
    : null
  if (!turn) return null

  /* His words, from the quiet days, most recent first: the nearest one to now
     is the one he will recognise. */
  let quote: { day: string; text: string } | null = null
  for (const n of [...quiet].sort((a, b) => (a.day < b.day ? 1 : -1))) {
    quote = wordsOn(s, n.day)
    if (quote) break
  }

  return {
    matched: near.length,
    sameWay: quiet.length,
    headline: `Today looks like ${near.length} evenings you have had before. On ${quiet.length} of them, nothing more got finished after this point.`,
    quote,
    turn,
  }
}

/** The one-line form used in the morning email, where there is no button to
 *  press and so no door to end on. */
export function precedentLine(p: Precedent): string {
  return p.quote
    ? `${p.headline} On ${nice(p.quote.day)} you wrote: "${p.quote.text}"`
    : p.headline
}
