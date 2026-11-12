import type { ContactChannel, PersonContact, PersonTier } from '../types'

export type Tier = { id: PersonTier; label: string; r: number; size: number; cadence: number; bond: number }

export const TIERS: Tier[] = [
  { id: 'core', label: 'Inner circle', r: 150, size: 30, cadence: 7, bond: 2.6 },
  { id: 'close', label: 'Close', r: 255, size: 26, cadence: 14, bond: 2 },
  { id: 'friends', label: 'Friends', r: 355, size: 23, cadence: 30, bond: 1.5 },
  { id: 'business', label: 'Business', r: 450, size: 22, cadence: 30, bond: 1.2 },
  { id: 'wider', label: 'Wider circle', r: 545, size: 21, cadence: 90, bond: 1.2 },
  { id: 'distant', label: 'Distant', r: 640, size: 19, cadence: 365, bond: 1 },
]

export const TIER = Object.fromEntries(TIERS.map((t) => [t.id, t])) as Record<PersonTier, Tier>

export const CHANNELS: { id: ContactChannel; label: string; icon: JSX.Element }[] = [
  { id: 'inperson', label: 'In person', icon: <path d="M8 8.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2ZM3 14c.6-2.6 2.6-4 5-4s4.4 1.4 5 4" /> },
  { id: 'call', label: 'Call', icon: <path d="M5.2 2.5 6.6 5.6 5.3 6.8a8 8 0 0 0 3.9 3.9l1.2-1.3 3.1 1.4-.5 2.2c-.1.5-.6.9-1.1.9A10.4 10.4 0 0 1 2.1 3.6c0-.5.4-1 .9-1.1l2.2-.5Z" /> },
  { id: 'message', label: 'Message', icon: <path d="M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5v-2.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z" /> },
  { id: 'video', label: 'Video', icon: <><rect x="1.8" y="4" width="8.6" height="8" rx="1.5" /><path d="m10.4 7 3.8-2.2v6.4L10.4 9" /></> },
  { id: 'email', label: 'Email', icon: <><rect x="2" y="3.5" width="12" height="9" rx="1.4" /><path d="m2.6 4.5 5.4 4 5.4-4" /></> },
]

export const CHANNEL = Object.fromEntries(CHANNELS.map((c) => [c.id, c])) as Record<ContactChannel, typeof CHANNELS[number]>

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export const inDays = (n: number) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`)

export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase() || '?'

export type Health = { h: number; days: number | null; left: number; last: PersonContact | null }

export const overdue = (hh: Health) => hh.days === null || hh.left < 0

/* A person with reminders off keeps this same neutral tone everywhere a
   health colour would otherwise show, so "off" reads as one clear state
   rather than as whatever colour their last contact happened to leave
   them at. */
export const OFF_COLOUR = '#8C877A'

/* Green when he has just spoken to them, orange halfway to the deadline, red as
   it arrives. Overdue is red outright. */
export const RAMP: [number, number[]][] = [[0, [210, 69, 42]], [0.5, [224, 138, 30]], [1, [62, 155, 79]]]

export function colourOf(hh: Health): string {
  if (overdue(hh)) return 'rgb(210, 69, 42)'
  for (let i = 1; i < RAMP.length; i++) {
    const [h0, c0] = RAMP[i - 1]
    const [h1, c1] = RAMP[i]
    if (hh.h <= h1) {
      const k = (hh.h - h0) / (h1 - h0)
      return `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * k)).join(', ')})`
    }
  }
  return 'rgb(62, 155, 79)'
}

export function sinceLabel(hh: Health): string {
  if (!hh.last || hh.days === null) return 'No contact logged yet'
  const when = hh.days === 0 ? 'today' : hh.days === 1 ? 'yesterday' : `${hh.days} days ago`
  return hh.last.channel === 'inperson'
    ? `Last saw them in person, ${when}`
    : `Last spoke by ${CHANNEL[hh.last.channel].label.toLowerCase()}, ${when}`
}
