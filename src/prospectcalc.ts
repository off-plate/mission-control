/* The numbers the Business view shows and never stores: next step, days since
   the last touch, and reply odds. Pure, so scripts/prospect-test.ts can hold
   them still. */
import type { Prospect, ProspectSource, ProspectStage, TouchStep } from './types'

export const STAGES: { id: ProspectStage; label: string }[] = [
  { id: 'reach', label: 'To reach out' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'talking', label: 'In conversation' },
  { id: 'won', label: 'Acquired' },
  { id: 'lost', label: 'Lost' },
]
export const SOURCES: { id: ProspectSource; label: string }[] = [
  { id: 'found', label: 'Found them' },
  { id: 'inbound', label: 'They reached out' },
  { id: 'friend', label: 'Friend' },
  { id: 'referral', label: 'Friend of a friend' },
  { id: 'met', label: 'Met in person' },
]
export const STEPS: { id: TouchStep; label: string }[] = [
  { id: 'work', label: 'Work email' },
  { id: 'reminder', label: 'Reminder' },
  { id: 'personal', label: 'Personal email' },
  { id: 'call', label: 'Call' },
  { id: 'visit', label: 'Visit' },
]
export const label = <T extends string>(list: { id: T; label: string }[], id: T): string => list.find((x) => x.id === id)?.label ?? id

/** Still chasing: the sequence and the odds only mean something here. */
export const isOpen = (p: Pick<Prospect, 'stage'>): boolean => p.stage === 'reach' || p.stage === 'contacted'

/** "https://www.Pekarna.cz/kontakt" -> "pekarna.cz". */
export const cleanDomain = (s: string): string =>
  s.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '')

/** The first step of the sequence not done yet. After the three emails it is
 *  "call or visit" until one of them is logged, then nothing. */
export function nextStep(p: Pick<Prospect, 'stage' | 'touches'>): TouchStep | 'callOrVisit' | null {
  if (!isOpen(p)) return null
  const done = new Set(p.touches.map((t) => t.step))
  for (const s of ['work', 'reminder', 'personal'] as const) if (!done.has(s)) return s
  return done.has('call') || done.has('visit') ? null : 'callOrVisit'
}

const DAY = 86_400_000
const noon = (day: string) => new Date(`${day}T12:00:00`).getTime()
const dayOf = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

/** Days since the last touch, or since he added it when nothing is logged. */
export function age(p: Pick<Prospect, 'touches' | 'createdAt'>, today: string): { days: number; since: 'touch' | 'added' } {
  const last = p.touches.map((t) => t.day).sort().at(-1)
  return { days: Math.max(0, Math.round((noon(today) - noon(last ?? dayOf(p.createdAt))) / DAY)), since: last ? 'touch' : 'added' }
}

const BASE: Record<ProspectSource, number> = { inbound: 60, friend: 50, referral: 40, met: 35, found: 15 }
/** How likely a reply is, 0 to 100. Null once that question is answered.
 *  ponytail: hand-set weights, refit from his own reply rates after ~30 prospects. */
export function replyOdds(p: Pick<Prospect, 'stage' | 'source' | 'people' | 'touches'>): number | null {
  if (!isOpen(p)) return null
  const decider = p.people.some((x) => x.decides && (x.email || x.phone))
  return Math.max(5, Math.min(100, BASE[p.source] + (decider ? 10 : 0) - 10 * p.touches.length))
}

/* ---------- The Gmail sync (his ask, 2026-10-11) ----------
   Emails to and from prospects arrive as events (tools/outreach-gmail.gs ->
   outreach-ingest -> mc_outreach_events). These turn them into touches. */

/** His sequence: each step goes out 2 days after the last one. Counted from
 *  the last touch, never a due date. */
export const GAP_DAYS = 2

/** Contacted, and the next step's 2 days have passed. */
export function isReady(p: Pick<Prospect, 'stage' | 'touches' | 'createdAt'>, today: string): boolean {
  if (!isOpen(p) || !p.touches.length) return false
  const n = nextStep(p)
  return n !== null && n !== 'work' && age(p, today).days >= GAP_DAYS
}

export interface OutreachEvent {
  id: string
  kind: 'sent' | 'reply'
  via?: 'offplate' | 'personal' | null
  /** Set by /eco-sync, which reads it from the subject and wording. Wins over stepForSent. */
  step?: 'work' | 'reminder' | 'personal' | null
  /** The business's domain from the Prospects sheet, for a freemail counterpart. */
  domain?: string | null
  day: string
  counterpart: string
  subject?: string | null
  body?: string | null
}

/* A prospect on gmail.com must not match every gmail.com address. Same list
   as the edge function's. */
const FREEMAIL = new Set(['gmail.com', 'googlemail.com', 'seznam.cz', 'email.cz', 'post.cz', 'centrum.cz', 'volny.cz', 'atlas.cz', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'me.com', 'tiscali.cz', 'quick.cz'])

/** The prospect an address belongs to: an exact person email first, then the
 *  business's own domain. */
export function matchProspect<P extends Pick<Prospect, 'domain' | 'people'>>(list: P[], address: string): P | undefined {
  const a = address.trim().toLowerCase()
  const exact = list.find((p) => p.people.some((x) => x.email?.trim().toLowerCase() === a))
  if (exact) return exact
  return list.find((p) => {
    const d = p.domain?.trim().toLowerCase()
    return !!d && !FREEMAIL.has(d) && (a.endsWith(`@${d}`) || a.endsWith(`.${d}`))
  })
}

/** Which step a sent email is. The personal address is always the personal
 *  email; from the Off-Plate alias it is the first email, then the reminder.
 *  Anything after that is conversation, not sequence. */
export function stepForSent(p: Pick<Prospect, 'touches'>, via: OutreachEvent['via']): TouchStep | null {
  const done = new Set(p.touches.map((t) => t.step))
  if (via === 'personal') return done.has('personal') ? null : 'personal'
  if (!done.has('work')) return 'work'
  if (!done.has('reminder')) return 'reminder'
  return null
}

/** Apply events to the prospects. Returns the new list and the ids that are
 *  done with: applied, or seen and deliberately ignored. An event with no
 *  matching prospect stays open, so adding that prospect later picks it up. */
export function applyEvents(prospects: Prospect[], events: OutreachEvent[], now = Date.now()): { prospects: Prospect[]; done: string[] } {
  const next = prospects.map((p) => ({ ...p, touches: [...p.touches] }))
  const done: string[] = []
  for (const e of [...events].sort((a, b) => a.day.localeCompare(b.day))) {
    const p = matchProspect(next, e.counterpart) ?? (e.domain ? matchProspect(next, `x@${e.domain}`) : undefined)
    if (!p) continue
    done.push(e.id)
    if (!isOpen(p)) continue
    if (e.kind === 'reply') {
      if (!p.replied || p.replied.day < e.day) {
        p.replied = { day: e.day, ...(e.subject ? { subject: e.subject } : {}), ...(e.body ? { body: e.body } : {}) }
        p.updatedAt = now
      }
      continue
    }
    const id = `gm-${e.id}`
    if (p.touches.some((t) => t.id === id)) continue
    const step = e.step ? (p.touches.some((t) => t.step === e.step) ? null : e.step) : stepForSent(p, e.via)
    if (!step) continue
    const to = p.people.find((x) => x.email?.trim().toLowerCase() === e.counterpart.trim().toLowerCase())?.id
    p.touches.push({ id, step, day: e.day, ...(to ? { to } : {}), ...(e.subject ? { subject: e.subject } : {}), ...(e.body ? { body: e.body } : {}) })
    if (p.stage === 'reach') p.stage = 'contacted'
    p.updatedAt = now
  }
  return { prospects: next, done }
}
