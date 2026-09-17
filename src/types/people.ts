/* The People page: everyone he keeps in his life, how close they are, and
   when he last spoke to them. Three collections rather than one nested row, so
   a contact logged on the phone and another on the laptop both survive the
   merge instead of one list of contacts replacing the other. */

/** Which ring a person sits on. The order is the order of the rings. */
export type PersonTier = 'core' | 'close' | 'friends' | 'business' | 'wider' | 'distant'

export interface Person {
  id: string
  name: string
  /** Who they are to him, in his words ("brother", "accountant"). */
  rel: string
  tier: PersonTier
  /** How often he wants to be in touch, in days. */
  cadenceDays: number
  /** Where he left them on the canvas, in canvas units, the centre being him. */
  x: number
  y: number
  createdAt: number
  updatedAt: number
}

/** Two people who know each other. Unordered. */
export interface PersonBond {
  id: string
  a: string
  b: string
  createdAt: number
}

export type ContactChannel = 'inperson' | 'call' | 'message' | 'video' | 'email'

/** One time he was actually in touch with someone. */
export interface PersonContact {
  id: string
  personId: string
  /** Local date, YYYY-MM-DD. */
  day: string
  channel: ContactChannel
  createdAt: number
}
