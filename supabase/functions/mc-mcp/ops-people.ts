/* People (relationships) and prospects (the Business pipeline), as plain functions on the state blob.

   NO Deno, NO network. A port of what Michael's in-app assistant does for addPerson, editPerson,
   deletePerson, contact, addProspect, editProspect and touch (src/assistant.ts KINDS,
   src/assistantcore.tsx step()), through the app's own store rules:
     src/store/people.ts, src/store/prospects.ts, src/types/people.ts,
     src/peoplelayout.ts, src/prospectcalc.ts, and the People page (src/people.tsx) for
     "last contact", "overdue" and what changing a person's circle does.

   Merge facts (src/sync-merge.ts): people, personBonds and prospects resolve a conflict by
   updatedAt, so every edit stamps updatedAt: Date.now(), exactly as the store does.
   personContacts are identity-keyed by id. A deleted row is buried (graveyard). */
import {
  McError, arr, bury, dateKey, ensure, fold, isDate, newId, rowKey,
  type Blob, type Row,
} from './ops.ts'

/* ============================ the app's tables, ported ====================== */

export type Tier = 'core' | 'close' | 'friends' | 'business' | 'wider' | 'distant'
export const TIERS: Tier[] = ['core', 'close', 'friends', 'business', 'wider', 'distant']
/** src/peoplelayout.ts TIER_RADIUS */
export const TIER_RADIUS: Record<Tier, number> = { core: 150, close: 255, friends: 355, business: 450, wider: 545, distant: 640 }
/** src/peoplelayout.ts TIER_CADENCE */
export const TIER_CADENCE: Record<Tier, number> = { core: 7, close: 14, friends: 30, business: 30, wider: 90, distant: 365 }
/** src/peoplelayout.ts TIER_LABEL */
export const TIER_LABEL: Record<Tier, string> = { core: 'inner circle', close: 'close', friends: 'friends', business: 'business', wider: 'wider circle', distant: 'distant' }
/** src/people.tsx TIERS[].size, needed by BAND */
const TIER_SIZE: Record<Tier, number> = { core: 30, close: 26, friends: 23, business: 22, wider: 21, distant: 19 }
export const CHANNELS = ['inperson', 'call', 'message', 'video', 'email'] as const
export type Channel = typeof CHANNELS[number]

/** src/peoplelayout.ts nextPersonSlot: the widest free gap on the tier's ring. */
export function nextPersonSlot(people: Row[], tier: Tier): { x: number; y: number } {
  const r = TIER_RADIUS[tier]
  const angles = people.filter((p) => p.tier === tier && Number.isFinite(p.x) && Number.isFinite(p.y)).map((p) => Math.atan2(p.y, p.x)).sort((a, b) => a - b)
  let a = -Math.PI / 2
  let best = -1
  angles.forEach((cur, i) => {
    const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + Math.PI * 2
    if (next - cur > best) { best = next - cur; a = cur + (next - cur) / 2 }
  })
  return { x: Math.cos(a) * r, y: Math.sin(a) * r }
}

/** src/people.tsx BAND + inBand: each circle owns the band halfway to its neighbours. */
function band(tier: Tier): [number, number] {
  const i = TIERS.indexOf(tier)
  const lo = i === 0 ? 40 + TIER_SIZE[tier] + 12 : (TIER_RADIUS[TIERS[i - 1]] + TIER_RADIUS[tier]) / 2 + 8
  const hi = i === TIERS.length - 1 ? TIER_RADIUS[tier] + 60 : (TIER_RADIUS[tier] + TIER_RADIUS[TIERS[i + 1]]) / 2 - 8
  return [lo, hi]
}
function inBand(tier: Tier, x: number, y: number): { x: number; y: number } {
  const [lo, hi] = band(tier)
  const d = Math.hypot(x, y)
  if (d >= lo && d <= hi) return { x, y }
  const a = d === 0 ? -Math.PI / 2 : Math.atan2(y, x)
  const r = Math.min(hi, Math.max(lo, d))
  return { x: Math.cos(a) * r, y: Math.sin(a) * r }
}

/* ---- src/prospectcalc.ts ---- */
export const SHEET_STATUSES = [
  'Prospect', 'Audit to create', 'Audited', 'Build', 'Ready to contact', 'Contacted', '1st reminder sent',
  '2nd reminder sent (personal)', 'Letter reminder sent', 'Call / visit', 'Responded waiting', 'Meeting planned',
  'On hold', 'Acquired', 'Lost', 'Rejected', 'Dropped',
] as const
const TALKING = 'Responded waiting'
const NOT_OPEN: string[] = [TALKING, 'Meeting planned', 'On hold', 'Acquired', 'Lost', 'Rejected', 'Dropped']
export const stageRank = (s: string): number => {
  const i = (SHEET_STATUSES as readonly string[]).indexOf(s)
  return i >= 0 ? i : SHEET_STATUSES.indexOf(TALKING) - 0.5
}
const LEGACY: Record<string, string> = {
  reach: 'Ready to contact', contacted: 'Contacted', talking: TALKING, won: 'Acquired', lost: 'Lost',
  'Audit to review': 'Audited', 'Build: ideas to review': 'Build', 'Build: building': 'Build',
  'Email to prepare': 'Ready to contact', 'In conversation': TALKING,
}
export const normStage = (s: unknown): string => (typeof s === 'string' && s.trim() ? LEGACY[s.trim()] ?? s.trim() : 'Prospect')
export const SOURCES = ['found', 'inbound', 'friend', 'referral', 'met'] as const
export const SOURCE_LABEL: Record<string, string> = { found: 'Found them', inbound: 'They reached out', friend: 'Friend', referral: 'Friend of a friend', met: 'Met in person' }
export const STEPS = ['work', 'reminder', 'personal', 'call', 'visit'] as const
export const STEP_LABEL: Record<string, string> = { work: 'Work email', reminder: 'Reminder', personal: 'Personal email', call: 'Call', visit: 'Visit' }
const isOpen = (p: Row): boolean => !NOT_OPEN.includes(p.stage)
const inSequence = (p: Row): boolean => isOpen(p) && stageRank(p.stage) >= stageRank('Ready to contact')
export const cleanDomain = (s: string): string => s.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '')
export function nextStep(p: Row): string | null {
  if (!inSequence(p)) return null
  const done = new Set(arr({ t: p.touches }, 't').map((t) => t.step))
  for (const s of ['work', 'reminder', 'personal']) if (!done.has(s)) return s
  return done.has('call') || done.has('visit') ? null : 'callOrVisit'
}
const DAY = 86_400_000
const noonMs = (day: string): number => Date.parse(`${day}T12:00:00Z`)
export const daysBetween = (from: string, to: string): number => Math.round((noonMs(to) - noonMs(from)) / DAY)
/** prospectcalc age(): days since the last touch, or since it was added. */
export function age(p: Row, today: string): { days: number; since: 'touch' | 'added' } {
  const last = arr({ t: p.touches }, 't').map((t) => t.day).sort().at(-1)
  return { days: Math.max(0, daysBetween(last ?? dateKey(new Date(p.createdAt ?? Date.now())), today)), since: last ? 'touch' : 'added' }
}
const GAP_DAYS = 2
/** prospectcalc isReady(): Contacted, and the next step's 2 days have passed. */
export function isReady(p: Row, today: string): boolean {
  if (!isOpen(p) || !arr({ t: p.touches }, 't').length) return false
  const n = nextStep(p)
  return n !== null && n !== 'work' && age(p, today).days >= GAP_DAYS
}

/* ============================== helpers ====================================== */

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}...` : s)

/** The app's own cap on how many rows one operation may remove from a collection (commit.ts guard). */
export const CASCADE_MAX = 1

/** One row by id or by words. Order: id; the whole name; the name containing the words; every
 *  word of the query somewhere in the name (so "Shadek Milan" finds "Milan Šádek"). Never guesses:
 *  several matches and no match are both refusals that name rows. */
function findRow(rows: Row[], ref: { id?: string; title?: string }, label: string, nameOf: (r: Row) => string, extra?: (r: Row) => string): Row {
  if (ref.id) {
    const hit = rows.find((r) => r.id === ref.id)
    if (!hit) throw new McError(`No ${label} has the id "${ref.id}". List them first to get a real id.`)
    return hit
  }
  const q = fold(ref.title ?? '')
  if (!q) throw new McError(`Say which ${label}: pass its id, or part of the name.`)
  const full = (r: Row) => fold(nameOf(r))
  const words = q.split(/\s+/).filter((w) => w.length >= 2)
  // Transliteration he may type instead of the accent: "Shadek" for "Šádek", "Zhelezny" for "Železný".
  const loose = (t: string) => fold(t).replace(/sh/g, 's').replace(/zh/g, 'z').replace(/ch/g, 'c').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  const lq = loose(q)
  const lwords = lq.split(' ').filter((w) => w.length >= 2)
  const near1 = (a: string, b: string) => { // edit distance <= 1
    if (a === b) return true
    if (Math.abs(a.length - b.length) > 1) return false
    let i = 0
    while (i < a.length && i < b.length && a[i] === b[i]) i++
    return a.slice(i + 1) === b.slice(i + 1) || a.slice(i) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i)
  }
  const stages: ((r: Row) => boolean)[] = [
    (r) => full(r) === q,
    (r) => full(r).includes(q),
    (r) => !!extra && fold(extra(r)) === q,
    (r) => words.length > 0 && words.every((w) => full(r).includes(w)),
    (r) => lwords.length > 0 && lwords.every((w) => loose(nameOf(r)).includes(w)),
    (r) => lwords.length > 0 && lwords.every((w) => loose(nameOf(r)).split(' ').some((n) => (w.length >= 4 && n.length >= 4 ? near1(w, n) : n === w))),
  ]
  for (const ok of stages) {
    const hits = rows.filter(ok)
    if (hits.length === 1) return hits[0]
    if (hits.length > 1) {
      const names = hits.slice(0, 8).map((r) => `${r.id}: ${nameOf(r)}`).join(' | ')
      throw new McError(`"${ref.title}" matches ${hits.length} ${label}s (${names}${hits.length > 8 ? ' ...' : ''}). Pass the id of the one you mean.`)
    }
  }
  const near = rows.filter((r) => words.some((w) => w.length >= 3 && full(r).includes(w))).slice(0, 5).map((r) => `${r.id}: ${nameOf(r)}`)
  throw new McError(`No ${label} matches "${ref.title}".${near.length ? ` Similar: ${near.join(' | ')}.` : ''}`)
}
const findPerson = (b: Blob, ref: { id?: string; title?: string }): Row => findRow(arr(b, 'people'), ref, 'person', (p) => String(p.name ?? ''))
const findProspect = (b: Blob, ref: { id?: string; title?: string }): Row =>
  findRow(arr(b, 'prospects'), ref, 'prospect', (p) => String(p.name ?? ''), (p) => String(p.domain ?? ''))

const text = (v: unknown, cap: number, what: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw new McError(`${what} cannot be empty.`)
  return v.trim().slice(0, cap)
}
const MMDD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
function checkBirthday(v: unknown): string {
  if (typeof v !== 'string' || !MMDD.test(v.trim())) throw new McError(`birthday must be MM-DD (like 03-27), got "${String(v)}".`)
  return v.trim()
}
function checkYear(v: unknown): number {
  const n = typeof v === 'number' ? v : NaN
  if (!Number.isInteger(n) || n < 1900 || n > Number(dateKey().slice(0, 4))) throw new McError(`birthYear must be a whole year from 1900 to this year, got "${String(v)}".`)
  return n
}
function checkTier(v: unknown): Tier {
  if (!TIERS.includes(v as Tier)) throw new McError(`tier must be one of ${TIERS.join(', ')}. (core = family, partner, closest few; close = real close friends; friends; business = any professional tie; wider = knows and likes, rarely sees; distant = barely in touch.)`)
  return v as Tier
}

/* ============================== PEOPLE ======================================= */

export interface AddPersonInput { name: string; tier: Tier; rel?: string; job?: string; birthday?: string; birthYear?: number; allowDuplicate?: boolean }

/** assistantcore addPerson + store/people.ts addPerson (+ the follow-up updatePerson for job/birthday). */
export function addPerson(b: Blob, i: AddPersonInput): { id: string; text: string } {
  const name = text(i.name, 120, 'A person needs a name, it')
  const tier = checkTier(i.tier)
  const people = ensure(b, 'people')
  const dupe = people.find((p) => fold(String(p.name)) === fold(name))
  if (dupe && !i.allowDuplicate) throw new McError(`There is already a person "${dupe.name}" (id ${dupe.id}). Edit that one, or pass allow_duplicate: true if this is a different person.`)
  const { x, y } = nextPersonSlot(people, tier)
  const now = Date.now()
  const row: Row = {
    id: newId('person'), name, rel: (i.rel ?? '').trim().slice(0, 80), tier, cadenceDays: TIER_CADENCE[tier],
    x: Math.round(x), y: Math.round(y), createdAt: now, updatedAt: now,
  }
  if (i.job?.trim()) row.job = i.job.trim().slice(0, 120)
  if (i.birthday !== undefined) row.birthday = checkBirthday(i.birthday)
  if (i.birthYear !== undefined) row.birthYear = checkYear(i.birthYear)
  people.push(row) // the store appends
  return { id: row.id, text: `Added to ${TIER_LABEL[tier]}: ${name}${row.rel ? ` (${row.rel})` : ''}. Check-in every ${row.cadenceDays} days.` }
}

export interface EditPersonInput {
  name?: string; tier?: Tier; rel?: string
  /** null clears */ job?: string | null; birthday?: string | null; birthYear?: number | null; nameDayAs?: string | null
  cadenceDays?: number; remindersOff?: boolean
}

/** assistantcore editPerson + store updatePerson; a circle change also moves the dot the way the
 *  People card does (people.tsx onTier), so he does not float between rings. */
export function editPerson(b: Blob, ref: { id?: string; title?: string }, p: EditPersonInput): { id: string; text: string } {
  const row = findPerson(b, ref)
  const did: string[] = []
  const set = (k: string, v: unknown) => { row[k] = v; did.push(k) }
  const clear = (k: string) => { delete row[k]; did.push(`${k} cleared`) }
  const was = row.name
  if (p.name !== undefined) set('name', text(p.name, 120, 'A name'))
  if (p.rel !== undefined) set('rel', p.rel.trim().slice(0, 80))
  if (p.job !== undefined) { if (p.job === null || !p.job.trim()) clear('job'); else set('job', p.job.trim().slice(0, 120)) }
  if (p.birthday !== undefined) { if (p.birthday === null) clear('birthday'); else set('birthday', checkBirthday(p.birthday)) }
  if (p.birthYear !== undefined) { if (p.birthYear === null) clear('birthYear'); else set('birthYear', checkYear(p.birthYear)) }
  if (p.nameDayAs !== undefined) { if (p.nameDayAs === null || !p.nameDayAs.trim()) clear('nameDayAs'); else set('nameDayAs', p.nameDayAs.trim().slice(0, 120)) }
  if (p.cadenceDays !== undefined) {
    if (!Number.isInteger(p.cadenceDays) || p.cadenceDays < 1 || p.cadenceDays > 3650) throw new McError('cadenceDays must be a whole number of days from 1 to 3650.')
    set('cadenceDays', p.cadenceDays)
  }
  if (p.remindersOff !== undefined) set('remindersOff', p.remindersOff)
  if (p.tier !== undefined) {
    const tier = checkTier(p.tier)
    if (tier !== row.tier) {
      const from = TIER_RADIUS[row.tier as Tier] ?? TIER_RADIUS[tier]
      const a = Math.atan2(row.y ?? 0, row.x ?? 0)
      const dist = Math.hypot(row.x ?? 0, row.y ?? 0) || from
      const r = dist * (TIER_RADIUS[tier] / from)
      const pos = inBand(tier, Math.cos(a) * r, Math.sin(a) * r)
      row.tier = tier; row.x = Math.round(pos.x); row.y = Math.round(pos.y)
      did.push(`circle: ${TIER_LABEL[tier]}`)
    }
  }
  if (!did.length) throw new McError('Nothing to change: pass at least one field that differs from what is stored.')
  row.updatedAt = Date.now() // people resolve conflicts by updatedAt
  return { id: row.id, text: `Updated ${was}${was !== row.name ? ` (now ${row.name})` : ''}: ${did.join(', ')}.` }
}

/** assistantcore deletePerson + store/people.ts deletePerson: the person, their bonds and their logged
 *  contacts go, and every key is buried. The writer's safety stop lets an operation remove ONE row per
 *  collection, so a person with more than that is refused here, in words, rather than by the stop. */
export function deletePerson(b: Blob, ref: { id?: string; title?: string }): { id: string; text: string } {
  const row = findPerson(b, ref)
  const bonds = arr(b, 'personBonds').filter((x) => x.a === row.id || x.b === row.id)
  const contacts = arr(b, 'personContacts').filter((c) => c.personId === row.id)
  if (bonds.length > CASCADE_MAX || contacts.length > CASCADE_MAX) {
    throw new McError(`${row.name} has ${contacts.length} logged contacts and ${bonds.length} links to other people. Removing a person removes all of those too, and this connector's safety stop allows only ${CASCADE_MAX} row per list per change, so it will not do it from here. Remove ${row.name} in the app's People page (it also offers undo). Nothing was changed.`)
  }
  b.people = arr(b, 'people').filter((p) => p.id !== row.id)
  b.personBonds = arr(b, 'personBonds').filter((x) => x.a !== row.id && x.b !== row.id)
  b.personContacts = arr(b, 'personContacts').filter((c) => c.personId !== row.id)
  bury(b, rowKey('people', row), ...bonds.map((x) => rowKey('personBonds', x)), ...contacts.map((c) => rowKey('personContacts', c)))
  return { id: row.id, text: `Removed ${row.name}${bonds.length || contacts.length ? ` (and ${contacts.length} contact${contacts.length === 1 ? '' : 's'}, ${bonds.length} link${bonds.length === 1 ? '' : 's'})` : ''}.` }
}

/** assistantcore contact + store logContact. Default channel in person, default day today.
 *  Tightened on purpose: not in the future, and the same person/day/channel twice is a retry, not a new contact. */
export function logContact(b: Blob, ref: { id?: string; title?: string }, o: { channel?: Channel; date?: string }): { id: string; text: string } {
  const person = findPerson(b, ref)
  const channel = o.channel ?? 'inperson'
  if (!CHANNELS.includes(channel)) throw new McError(`channel must be one of ${CHANNELS.join(', ')}.`)
  const today = dateKey()
  const day = o.date ?? today
  if (!isDate(day)) throw new McError(`date must be YYYY-MM-DD, got "${day}".`)
  if (day > today) throw new McError('A contact cannot be logged for a day that has not happened yet.')
  const have = arr(b, 'personContacts').find((c) => c.personId === person.id && c.day === day && c.channel === channel)
  if (have) throw new McError(`Contact with ${person.name} on ${day} (${channel}) is already logged (id ${have.id}).`)
  const row: Row = { id: newId('contact'), personId: person.id, day, channel, createdAt: Date.now() }
  ensure(b, 'personContacts').push(row)
  return { id: row.id, text: `Logged contact with ${person.name}${day !== today ? ` on ${day}` : ''} (${channel}).` }
}

/** store/people.ts removeContact: a wrongly logged contact. Buried. */
export function removeContact(b: Blob, o: { contactId?: string; person?: { id?: string; title?: string }; date?: string; channel?: Channel }): { id: string; text: string } {
  const all = arr(b, 'personContacts')
  let hit: Row
  if (o.contactId) {
    const h = all.find((c) => c.id === o.contactId)
    if (!h) throw new McError(`No logged contact has the id "${o.contactId}".`)
    hit = h
  } else {
    if (!o.person || !o.date) throw new McError('Pass contact_id, or the person and the date of the contact to remove.')
    const p = findPerson(b, o.person)
    const hits = all.filter((c) => c.personId === p.id && c.day === o.date && (!o.channel || c.channel === o.channel))
    if (!hits.length) throw new McError(`No contact with ${p.name} is logged on ${o.date}.`)
    if (hits.length > 1) throw new McError(`${hits.length} contacts with ${p.name} on ${o.date} (${hits.map((c) => `${c.id}: ${c.channel}`).join(' | ')}). Pass contact_id.`)
    hit = hits[0]
  }
  const who = arr(b, 'people').find((p) => p.id === hit.personId)
  b.personContacts = all.filter((c) => c.id !== hit.id)
  bury(b, rowKey('personContacts', hit))
  return { id: hit.id, text: `Removed the ${hit.day} contact with ${who?.name ?? 'someone'}.` }
}

export interface ListPeopleInput { query?: string; tier?: Tier; overdueOnly?: boolean; birthdaysWithinDays?: number; limit?: number }

/** People page order ("Who to reach"): most overdue first (no contact = first), tracked before untracked. */
export function listPeople(b: Blob, i: ListPeopleInput): Row {
  const today = dateKey()
  const people = arr(b, 'people')
  const contacts = arr(b, 'personContacts')
  const bonds = arr(b, 'personBonds')
  const nameById = new Map(people.map((p) => [p.id, p.name]))
  const q = i.query ? fold(i.query) : ''
  const view = people.map((p) => {
    const mine = contacts.filter((c) => c.personId === p.id)
    // people.tsx lastContact: the most recent day (ties: the latest logged)
    const last = [...mine].sort((a, c) => (a.day === c.day ? (a.createdAt ?? 0) - (c.createdAt ?? 0) : a.day < c.day ? -1 : 1)).at(-1) ?? null
    const days = last ? Math.max(0, daysBetween(last.day, today)) : null
    const left = last ? p.cadenceDays - (days as number) : -Infinity
    const tracked = !p.remindersOff
    const knows = bonds.filter((x) => x.a === p.id || x.b === p.id).map((x) => {
      const other = x.a === p.id ? x.b : x.a
      const word = x.a === p.id ? x.bToA : x.aToB // what the other one is to this person
      return { with: nameById.get(other) ?? other, isToThem: word || undefined }
    })
    let birthdayIn: number | undefined
    if (p.birthday && MMDD.test(p.birthday)) {
      const y = Number(today.slice(0, 4))
      const next = [y, y + 1].map((yy) => `${yy}-${p.birthday}`).find((d) => d >= today)
      if (next) birthdayIn = daysBetween(today, next)
    }
    return {
      p, tracked, left, birthdayIn,
      row: {
        id: p.id, name: p.name, rel: p.rel || undefined, tier: p.tier, job: p.job, birthday: p.birthday, birthYear: p.birthYear,
        cadenceDays: p.cadenceDays, tracked,
        lastContact: last ? { day: last.day, channel: last.channel, daysAgo: days } : null,
        overdue: tracked && (last === null || left < 0),
        daysOverdue: tracked && last && left < 0 ? -left : undefined,
        birthdayInDays: birthdayIn,
        knows: knows.length ? knows : undefined,
      },
    }
  })
  let rows = view
  if (q) rows = rows.filter((v) => fold(`${v.p.name} ${v.p.rel ?? ''} ${v.p.job ?? ''}`).includes(q))
  if (i.tier) rows = rows.filter((v) => v.p.tier === i.tier)
  if (i.overdueOnly) rows = rows.filter((v) => v.row.overdue)
  if (i.birthdaysWithinDays !== undefined) rows = rows.filter((v) => v.birthdayIn !== undefined && v.birthdayIn <= i.birthdaysWithinDays!)
  rows = [...rows].sort((a, c) => {
    if (i.birthdaysWithinDays !== undefined) return (a.birthdayIn ?? 0) - (c.birthdayIn ?? 0)
    if (a.tracked !== c.tracked) return a.tracked ? -1 : 1
    const ra = a.left / a.p.cadenceDays, rc = c.left / c.p.cadenceDays
    return (ra === rc ? 0 : ra < rc ? -1 : 1) || String(a.p.name).localeCompare(String(c.p.name))
  })
  const limit = Math.min(Math.max(i.limit ?? 50, 1), 200)
  return {
    today, total: people.length, matched: rows.length, shown: Math.min(rows.length, limit),
    overdueNow: view.filter((v) => v.row.overdue).length,
    people: rows.slice(0, limit).map((v) => v.row),
  }
}

/* ============================== PROSPECTS ==================================== */

/** assistant.ts PSTAGE: normStage, then a case-insensitive match on a Sheet status. */
export function checkStage(v: unknown): string {
  const s = normStage(typeof v === 'string' ? v.trim() : '')
  const hit = SHEET_STATUSES.find((x) => x.toLowerCase() === s.toLowerCase())
  if (!hit) throw new McError(`"${String(v)}" is not a stage. Stages: ${SHEET_STATUSES.join(', ')}.`)
  return hit
}
function checkSource(v: unknown): string {
  if (!(SOURCES as readonly string[]).includes(v as string)) throw new McError(`source must be one of ${SOURCES.join(', ')} (friend of a friend = referral).`)
  return v as string
}
function checkValue(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100) throw new McError('value must be a whole number from 0 to 100, and only when Michael gave one.')
  return v
}

export interface ContactIn { contact?: string; role?: string; email?: string; phone?: string; decides?: boolean }
let ppSeq = 0
/** assistantcore addProspect/editProspect `person()`: a named contact is matched by name inside the
 *  business (updated), else added. Without a contact name the other fields have nothing to attach to. */
function contactPeople(have: Row[], c: ContactIn): Row[] {
  if (!c.contact) {
    if (c.role || c.email || c.phone || c.decides !== undefined) throw new McError('role, email, phone and decides describe a contact person: pass contact (their name) too.')
    return have
  }
  const f = (x: string) => x.trim().toLowerCase()
  const name = c.contact.trim().slice(0, 120)
  const fields = { name, ...(c.role ? { role: c.role.trim().slice(0, 80) } : {}), ...(c.email ? { email: c.email.trim().slice(0, 160) } : {}), ...(c.phone ? { phone: c.phone.trim().slice(0, 40) } : {}), ...(c.decides !== undefined ? { decides: c.decides } : {}) }
  return have.some((x) => f(String(x.name)) === f(name))
    ? have.map((x) => (f(String(x.name)) === f(name) ? { ...x, ...fields } : x))
    : [...have, { id: `pp-${Date.now().toString(36)}${(ppSeq++).toString(36)}`, ...fields }]
}

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export interface AddProspectInput extends ContactIn { name: string; source: string; domain?: string; value?: number; why?: string; allowDuplicate?: boolean }

/** assistantcore addProspect + store/prospects.ts addProspect (stage 'Ready to contact', empty touches). */
export function addProspect(b: Blob, i: AddProspectInput): { id: string; text: string } {
  const name = text(i.name, 120, 'A prospect needs a name, it')
  const source = checkSource(i.source)
  const rows = ensure(b, 'prospects')
  const domain = i.domain !== undefined ? cleanDomain(i.domain) : undefined
  if (i.domain !== undefined && !domain) throw new McError(`"${i.domain}" is not a usable domain. Pass something like pekarna.cz.`)
  // The Sheet sync matches a card by domain, else by name: a twin would be matched ambiguously later.
  const dupe = rows.find((p) => slug(String(p.name)) === slug(name) || (domain && p.domain && cleanDomain(String(p.domain)) === domain))
  if (dupe && !i.allowDuplicate) throw new McError(`There is already a prospect "${dupe.name}"${dupe.domain ? ` (${dupe.domain})` : ''}, id ${dupe.id}. Edit that one, or pass allow_duplicate: true if this is a different business.`)
  const people = contactPeople([], i)
  const now = Date.now()
  const row: Row = { stage: 'Ready to contact', people: [], id: newId('prospect'), name, source, touches: [], createdAt: now, updatedAt: now }
  if (domain) row.domain = domain
  if (i.value !== undefined) row.value = checkValue(i.value)
  if (i.why?.trim()) row.why = i.why.trim().slice(0, 200)
  row.people = people
  rows.push(row)
  return { id: row.id, text: `Prospect added: ${name} (${SOURCE_LABEL[source]}, ${row.stage}).` }
}

export interface EditProspectInput extends ContactIn { name?: string; domain?: string; source?: string; stage?: string; value?: number; why?: string; lostReason?: string }

/** assistantcore editProspect + store updateProspect (updatedAt stamped; fields only when given). */
export function editProspect(b: Blob, ref: { id?: string; title?: string }, p: EditProspectInput): { id: string; text: string } {
  const row = findProspect(b, ref)
  const did: string[] = []
  const was = row.name
  if (p.name !== undefined) { row.name = text(p.name, 120, 'A name'); did.push('name') }
  if (p.domain !== undefined) {
    const d = cleanDomain(p.domain)
    if (!d) throw new McError(`"${p.domain}" is not a usable domain.`)
    row.domain = d; did.push('domain')
  }
  if (p.source !== undefined) { row.source = checkSource(p.source); did.push('source') }
  if (p.stage !== undefined) { row.stage = checkStage(p.stage); did.push(`stage: ${row.stage}`) }
  if (p.value !== undefined) { row.value = checkValue(p.value); did.push('value') }
  if (p.why !== undefined) { if (!p.why.trim()) throw new McError('why cannot be empty.'); row.why = p.why.trim().slice(0, 200); did.push('why') }
  if (p.lostReason !== undefined) { if (!p.lostReason.trim()) throw new McError('lostReason cannot be empty.'); row.lostReason = p.lostReason.trim().slice(0, 200); did.push('lostReason') }
  if (p.contact || p.role || p.email || p.phone || p.decides !== undefined) { row.people = contactPeople(arr(row, 'people'), p); did.push(`contact ${p.contact}`) }
  if (!did.length) throw new McError('Nothing to change: pass at least one field.')
  row.updatedAt = Date.now() // prospects resolve conflicts by updatedAt
  return { id: row.id, text: `Updated ${was}${was !== row.name ? ` (now ${row.name})` : ''}: ${did.join(', ')}.${(row.stage === 'Lost' || row.stage === 'Rejected') && !row.lostReason ? ' No lostReason is recorded yet.' : ''}` }
}

export interface TouchInput { step: string; date?: string; to?: string; subject?: string; body?: string }

/** assistantcore touch + store/prospects.ts logTouch: appends a touch; the first one moves a prospect out
 *  of the stages before Contacted. `to` defaults to the person who decides; a `to` that names nobody is
 *  refused (the app would drop it silently). */
export function logTouch(b: Blob, ref: { id?: string; title?: string }, i: TouchInput): { id: string; text: string } {
  const row = findProspect(b, ref)
  if (!(STEPS as readonly string[]).includes(i.step)) throw new McError(`step must be one of ${STEPS.join(', ')}.`)
  const today = dateKey()
  const day = i.date ?? today
  if (!isDate(day)) throw new McError(`date must be YYYY-MM-DD, got "${day}".`)
  if (day > today) throw new McError('A touch cannot be logged for a day that has not happened yet.')
  const people = arr(row, 'people')
  let to: string | undefined
  if (i.to) {
    to = people.find((x) => String(x.name).toLowerCase().includes(i.to!.toLowerCase()))?.id
    if (!to) throw new McError(`${row.name} has no contact matching "${i.to}". Contacts: ${people.map((x) => x.name).join(', ') || '(none)'}. Add the person with edit_prospect (contact) first, or leave "to" out.`)
  } else to = people.find((x) => x.decides)?.id
  const touches = arr(row, 'touches')
  const twin = touches.find((t) => t.step === i.step && t.day === day && (t.subject ?? '') === (i.subject ?? ''))
  if (twin) throw new McError(`A ${STEP_LABEL[i.step].toLowerCase()} on ${day} is already logged for ${row.name} (touch ${twin.id}).`)
  const touch: Row = {
    step: i.step, day, ...(to ? { to } : {}), ...(i.subject ? { subject: i.subject.trim().slice(0, 200) } : {}), ...(i.body ? { body: i.body.trim().slice(0, 4000) } : {}),
    id: newId('touch'),
  }
  const moved = stageRank(row.stage) < stageRank('Contacted')
  row.stage = moved ? 'Contacted' : row.stage
  row.touches = [...touches, touch]
  row.updatedAt = Date.now()
  return { id: touch.id, text: `Logged ${STEP_LABEL[i.step].toLowerCase()} for ${row.name} on ${day}${moved ? ' (moved to Contacted)' : ''}.` }
}

export interface ListProspectsInput { stage?: string; source?: string; query?: string; openOnly?: boolean; needsFollowUp?: boolean; limit?: number }

export function listProspects(b: Blob, i: ListProspectsInput): Row {
  const today = dateKey()
  const all = arr(b, 'prospects')
  const stageOf = (p: Row) => normStage(p.stage)
  const byStage: Record<string, number> = {}
  for (const p of all) byStage[stageOf(p)] = (byStage[stageOf(p)] ?? 0) + 1
  let rows = all
  if (i.stage) { const s = checkStage(i.stage); rows = rows.filter((p) => stageOf(p) === s) }
  if (i.source) { const s = checkSource(i.source); rows = rows.filter((p) => p.source === s) }
  if (i.openOnly) rows = rows.filter((p) => isOpen({ stage: stageOf(p) }))
  if (i.needsFollowUp) rows = rows.filter((p) => isReady({ ...p, stage: stageOf(p) }, today))
  const q = i.query ? fold(i.query) : ''
  if (q) rows = rows.filter((p) => fold(`${p.name} ${p.domain ?? ''} ${p.why ?? ''} ${arr(p, 'people').map((x) => x.name).join(' ')}`).includes(q))
  rows = [...rows].sort((a, c) => (c.updatedAt ?? 0) - (a.updatedAt ?? 0))
  const limit = Math.min(Math.max(i.limit ?? 30, 1), 100)
  return {
    today, total: all.length, byStage, matched: rows.length, shown: Math.min(rows.length, limit),
    prospects: rows.slice(0, limit).map((p) => {
      const pr = { ...p, stage: stageOf(p) }
      const touches = arr(p, 'touches')
      const a = age(pr, today)
      return {
        id: p.id, name: p.name, domain: p.domain, stage: pr.stage, source: p.source, value: p.value,
        why: p.why ? clip(String(p.why), 160) : undefined,
        touches: touches.length, lastTouch: touches.map((t) => t.day).sort().at(-1),
        daysSince: a.days, daysSinceIs: a.since, nextStep: nextStep(pr) ?? undefined, followUpDue: isReady(pr, today) || undefined,
        contacts: arr(p, 'people').map((x) => `${x.name}${x.decides ? ' (decides)' : ''}`),
        replied: p.replied ? p.replied.day : undefined,
        lostReason: p.lostReason, next: p.next?.text ? `${p.next.text} (waits on ${p.next.on})` : undefined,
      }
    }),
  }
}

/** One prospect in full: contacts with emails, every touch (bodies clipped unless asked). */
export function getProspect(b: Blob, ref: { id?: string; title?: string }, bodies = false): Row {
  const p = findProspect(b, ref)
  const today = dateKey()
  const pr = { ...p, stage: normStage(p.stage) }
  return {
    id: p.id, name: p.name, domain: p.domain, stage: pr.stage, source: p.source, value: p.value, why: p.why, lostReason: p.lostReason, notes: p.notes,
    links: p.links, next: p.next, replied: p.replied ? { day: p.replied.day, subject: p.replied.subject } : undefined,
    nextStep: nextStep(pr) ?? undefined, daysSince: age(pr, today).days,
    people: arr(p, 'people'),
    touches: arr(p, 'touches').map((t) => ({ id: t.id, step: t.step, day: t.day, to: arr(p, 'people').find((x) => x.id === t.to)?.name, subject: t.subject, body: t.body ? (bodies ? t.body : clip(String(t.body), 300)) : undefined })),
    sheetRow: p.sheet ? { niche: p.sheet.niche, country: p.sheet.country, webProblem: p.sheet.webProblem, notes: p.sheet.notes } : undefined,
  }
}
