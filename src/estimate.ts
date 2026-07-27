/* Time estimates for a task, generated from what the task actually says.
   Two things are being corrected here: the blank-page problem of guessing a
   number, and the optimism that makes every guess too low. The buffer is the
   same one the breakdown uses, so both paths agree.

   This is the local stand-in. The real build sends the title to a model and
   calibrates the buffer from his own logged estimate-vs-actual. */

import type { TaskCategory } from './types'

/** Optimism correction. One constant, shared with the breakdown. */
export const BUFFER = 1.3

/** Base minutes by the kind of work, before the title is read. */
const BASE: Record<TaskCategory, number> = { quick: 10, call: 15, admin: 20, deep: 45 }

/** Phrases that reliably mean more or less work than the category suggests. */
const SIGNALS: { match: RegExp; mul: number }[] = [
  { match: /\b(quick|krátk|rychl|just|jen)\b/i, mul: 0.6 },
  { match: /\b(reply|respond|odepsat|odpov)\b/i, mul: 0.8 },
  { match: /\b(read|přečíst|check|zkontrolovat)\b/i, mul: 0.8 },
  { match: /\b(draft|write|napsat|sepsat)\b/i, mul: 1.4 },
  { match: /\b(plan|plán|prepare|připravit|research|rešerš)\b/i, mul: 1.6 },
  { match: /\b(review|projít|audit|revize)\b/i, mul: 1.3 },
  { match: /\b(call|zavolat|phone|telefon)\b/i, mul: 1.1 },
  { match: /\b(form|formulář|application|žádost|tax|daň)\b/i, mul: 1.5 },
  { match: /\b(and|a také|plus|then|potom)\b/i, mul: 1.25 },
]

export interface Estimate {
  minutes: number
  /** Plain sentence explaining where the number came from. */
  reason: string
}

export function estimateFor(title: string, category: TaskCategory): Estimate {
  const base = BASE[category]
  const hits = SIGNALS.filter((s) => s.match.test(title))
  const mul = hits.reduce((a, s) => a * s.mul, 1)
  // Longer descriptions tend to be more work; capped so a wordy title cannot run away.
  const lengthBump = Math.min(1.4, 1 + Math.max(0, title.trim().split(/\s+/).length - 6) * 0.04)
  const raw = base * mul * lengthBump
  const minutes = Math.max(5, Math.round((raw * BUFFER) / 5) * 5)
  return {
    minutes,
    reason: `${category} work starts at ${base} min, adjusted for what the task says, then the ${BUFFER}x buffer you keep needing.`,
  }
}
