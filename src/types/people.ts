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
  /** Off means don't run the reminder for this person: no health colour, no
   *  place in Who to reach, not counted in the tallies. On by default --
   *  it's set only when he's turned it off. */
  remindersOff?: boolean
  /** What they do. */
  job?: string
  /** Birthday as MM-DD, and the year when he knows it. */
  birthday?: string
  birthYear?: number
  /** The calendar name their name day follows, when their first name is not
   *  one ("Verů" celebrates Veronika). Empty means use the first name. */
  nameDayAs?: string
  /** Where he left them on the canvas, in canvas units, the centre being him. */
  x: number
  y: number
  createdAt: number
  updatedAt: number
}

/** Two people who know each other, and what they are to each other. Each side
 *  is its own word, because "brother" one way can be "sister" the other. */
export interface PersonBond {
  id: string
  a: string
  b: string
  /** What `a` is to `b` ("brother", "boss"). Empty when not set. */
  aToB?: string
  /** What `b` is to `a`. */
  bToA?: string
  createdAt: number
  updatedAt?: number
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

/* ---------- Business: prospects (his ask, 2026-10-04) ----------
   One row per business he is reaching out to. People and touches live inside
   the row, so a prospect syncs, merges and is deleted as one thing. */

/** The five lanes from his Obsidian CRM board, verbatim: To reach out,
 *  Contacted, In conversation, Acquired, Lost. */
export type ProspectStage = 'reach' | 'contacted' | 'talking' | 'won' | 'lost'
/** Where the lead came from. */
export type ProspectSource = 'found' | 'inbound' | 'friend' | 'referral' | 'met'
/** His outreach order: work email, reminder, personal email, then a call or a
 *  visit if it comes to that. */
export type TouchStep = 'work' | 'reminder' | 'personal' | 'call' | 'visit'

export interface ProspectPerson {
  id: string
  name: string
  role?: string
  email?: string
  phone?: string
  /** The one who can say yes. */
  decides?: boolean
}

export interface ProspectTouch {
  id: string
  step: TouchStep
  /** Local date, YYYY-MM-DD. */
  day: string
  /** ProspectPerson id it went to. */
  to?: string
  subject?: string
  /** What he actually sent, so the next message can build on it. */
  body?: string
}

export interface Prospect {
  id: string
  name: string
  /** Bare host, "pekarna.cz": no scheme, no www, no path. */
  domain?: string
  source: ProspectSource
  stage: ProspectStage
  /** How much value he can bring them, 0 to 100, his own judgement. */
  value?: number
  /** Why this business caught his eye. */
  why?: string
  lostReason?: string
  notes?: string
  people: ProspectPerson[]
  touches: ProspectTouch[]
  createdAt: number
  updatedAt: number
}
