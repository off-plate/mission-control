/** One logged touch: a call, a text, an email, a meeting. Its own top-level
 *  synced collection (see contactActivity in store.tsx), unioned by id like
 *  habitLog/focusSessions -- NOT nested inside Contact, so two devices
 *  logging different touches on the same person between syncs never lose
 *  either entry to a wholesale "newer row wins" replacement, the way a
 *  nested array on a merged row would. The record IS the relationship's
 *  status -- see contactStatus below -- never a separate counter that can
 *  drift out of step with what actually happened. */
export interface ContactActivity {
  id: string
  contactId: string
  type: 'call' | 'text' | 'email' | 'meeting'
  at: string
  note?: string
}

/** A person, not filed under a Space -- same reasoning Habits and Goals
 *  already settled on: a relationship isn't Personal OR Off-Plate, it just
 *  is. projectId is the one optional exception, when a person genuinely is
 *  someone from a client's work (Eva, on Masér Jiří) rather than a name with
 *  no other context to hang off of. */
export interface Contact {
  id: string
  name: string
  tag: string
  projectId?: string
  phone?: string
  email?: string
  company?: string
  role?: string
  next?: string
  notes?: string
  createdAt: string
}

export type ContactStatus = 'quiet' | 'soon' | 'track'

/** Computed from the log, the moment it's asked for -- never stored, so it
 *  can never go stale the way a saved "last touch" field would the instant
 *  a new entry is logged somewhere else. Same rule habit streaks already
 *  follow: the record is the log, the number is just today's read of it.
 *  `activity` is the FULL contactActivity collection; filtered here rather
 *  than by the caller so every call site reads "since" the same way. */
export function contactDaysSince(c: Contact, activity: ContactActivity[]): number {
  const last = activity.reduce((max, a) => (a.contactId === c.id && a.at > max ? a.at : max), c.createdAt)
  const ms = Date.now() - new Date(last).getTime()
  return Math.max(0, Math.floor(ms / 86400000))
}
export function contactStatus(c: Contact, activity: ContactActivity[]): ContactStatus {
  const d = contactDaysSince(c, activity)
  return d <= 7 ? 'track' : d <= 20 ? 'soon' : 'quiet'
}

