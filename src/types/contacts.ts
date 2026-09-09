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
  /** Unset for an ordinary relationship. Set the moment someone becomes a
   *  business prospect, and from then on this -- not tag, not status -- is
   *  where they live: the Pipeline view, not the People view. Stage names
   *  and order come from the CRM Pipeline board already kept in Obsidian
   *  (Company HQ/CRM), not invented here. */
  stage?: PipelineStage
  /** When the current stage was entered. Drives stageDaysSince below --
   *  "three weeks in Contacted" is the number the CRM Client card note says
   *  matters, not when the contact itself was created. */
  stageAt?: string
  /** Lost's whole point, per the same note: the reason is worth more than
   *  any strategy document. Free text, no required-field nagging -- it's a
   *  soft prompt on drop, not a gate. */
  lostReason?: string
  /** Present only on a contact that came from the lead engine rather than
   *  from someone he actually knows. Everything a sourced prospect carries
   *  that a person does not: what was measured about them, and the offer
   *  that measurement supports. A hand-added contact never has one. */
  lead?: LeadInfo
}

/** The offer the evidence supports, carried on the lead rather than looked up
 *  from a catalogue in the bundle. Off-Plate's price list is not something to
 *  commit to a public repo, and the import file is local, so the text travels
 *  with the row it belongs to. Nine fields because [OP] Offers requires nine:
 *  an offer missing any of them is a service description, not an offer. */
export interface LeadOffer {
  key: string
  name: string
  price: string
  stepDown: string
  whoFor: string
  problem: string
  result: string
  included: string
  howLong: string
  riskReversal: string
  whyNow: string
}

/** What the lead engine measured about a business, in the shape the Contacts
 *  page reads it. `placeKey` is Google's own stable place id and is what makes
 *  a re-import update a row instead of duplicating it, so running the importer
 *  again after another city finishes is safe. */
export interface LeadInfo {
  placeKey: string
  source: string
  market: string
  city: string
  category?: string
  /** The Google Maps score and how many reviews are behind it. Rating alone is
   *  close to meaningless in Albania, where 4.9 is ordinary, so the count is
   *  never dropped. */
  rating?: number
  reviews?: number
  website?: string
  webPresence?: string
  mapsUrl?: string
  instagram?: string
  /** Out of 100, and the band it falls in. A sort order, not a verdict. */
  score: number
  band: string
  /** The one specific broken thing, measured, which is what [OP] Client
   *  Acquisition says a first message opens on. */
  evidence: string
  evidenceAll?: string[]
  /** Points into the leadOffers catalogue rather than carrying the offer text.
   *  Nine offers cover a whole market, so embedding them on every row cost
   *  1.8 kB of the 2.18 kB a lead weighed, and the whole app state is one JSON
   *  row inside a browser quota his notes and tasks already share. Namespaced
   *  by market, because cz and al both have a "mobile_broken" and they are not
   *  the same offer or the same price. */
  offerKey?: string
  importedAt: string
}

/** The offer catalogue, one entry per market-and-key, held once for the whole
 *  app instead of once per lead. Arrives with an import and is merged, never
 *  replaced, so importing Albania does not drop the Czech offers. */
export type LeadOffers = Record<string, LeadOffer>

/** One row of the lead engine's export, as the importer receives it. Only the
 *  fields a Contact can actually hold; everything else in the export file is
 *  for the HTML report, not for here. */
export interface ImportedLead {
  name: string
  phone?: string
  email?: string
  company?: string
  lead: LeadInfo
}

/** What the importer reads: the catalogue once, then the rows that point at it. */
export interface LeadImportFile {
  offers: LeadOffers
  leads: ImportedLead[]
}

export type ContactStatus = 'quiet' | 'soon' | 'track'

/** The Off-Plate sales pipeline, verbatim from Company HQ/CRM/[CRM]
 *  Pipeline.md -- not a taxonomy invented for this page. "Contacted" covers
 *  every touch up to a reply on purpose: how many sit there, and for how
 *  long, is the number that says whether the opener works, not something a
 *  split into "1st touch"/"2nd touch" lanes would show any better. */
export type PipelineStage = 'reach_out' | 'contacted' | 'conversation' | 'acquired' | 'lost'
export const PIPELINE_STAGES: PipelineStage[] = ['reach_out', 'contacted', 'conversation', 'acquired', 'lost']
export const STAGE_LABEL: Record<PipelineStage, string> = {
  reach_out: 'To reach out', contacted: 'Contacted', conversation: 'In conversation', acquired: 'Acquired', lost: 'Lost',
}

export function stageDaysSince(c: Contact): number {
  const at = c.stageAt ?? c.createdAt
  return Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 86400000))
}

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

