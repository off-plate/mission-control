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
