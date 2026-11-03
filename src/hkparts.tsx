/* The pieces of a Habits & Goals card that other pages draw too (Plan's
   "This week", 2026-11-03: he wanted the goals there to be these cards, not a
   look of their own). Moved out of hkroom.tsx unchanged. */
import type { ReactNode } from 'react'
import * as Icon from './icons'

export const PALETTE = ['#A3E635', '#A78BFA', '#38BDF8', '#F472B6', '#FB923C', '#2DD4BF', '#22D3EE', '#FACC15', '#4ADE80', '#818CF8', '#F87171', '#E879F9', '#60A5FA', '#34D399', '#F59E0B', '#FB7185', '#C084FC', '#5EEAD4', '#FDBA74', '#94A3B8']
export const ICONS: Record<string, (p: { size?: number }) => ReactNode> = {
  sun: Icon.Sun, cup: Icon.Cup, focus: Icon.Focus, bolt: Icon.Bolt, clock: Icon.Clock, hourglass: Icon.Hourglass,
  wave: Icon.Waveform, heart: Icon.DockHeartbeat, book: Icon.DockBook, wallet: Icon.DockWallet, flag: Icon.Flag,
  calendar: Icon.DockCalendar, checklist: Icon.Checklist, home: Icon.Home, bulb: Icon.DockBulb, eye: Icon.Eye, note: Icon.Note,
}
export const ICON_KEYS = Object.keys(ICONS)
function hashOf(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) }
export function guessIcon(name: string, fallback: string): string {
  const n = name.toLowerCase()
  if (/water|drink|cup|coffee|tea/.test(n)) return 'cup'
  if (/wake|morning|sun|breakfast/.test(n)) return 'sun'
  if (/meditat|breath|calm/.test(n)) return 'wave'
  if (/focus|deep|work/.test(n)) return 'focus'
  if (/bed|sleep|night|evening/.test(n)) return 'hourglass'
  if (/gym|run|stretch|walk|push|sport|train|creatine/.test(n)) return 'heart'
  if (/read|book|journal|pronunc|typing/.test(n)) return 'book'
  if (/earn|money|save|invoice|czk|pay|spend|income/.test(n)) return 'wallet'
  if (/review|plan|week|month/.test(n)) return 'calendar'
  if (/brain|scroll|reset|rot/.test(n)) return 'bolt'
  return fallback
}
export const colorFor = (id: string, set?: string) => set ?? PALETTE[hashOf(id) % PALETTE.length]

export const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString('cs-CZ').replace(/[  ]/g, ' ')

/* Goal tiles are the same size as a habit's day dots: a 26-wide grid, at
   most two rows, so 1 goal is one small dot and 100 000 CZK is fifty. */
export const tileSize = (target: number) => { const raw = target / 52; const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000]; return steps.find((x) => x >= raw) ?? 100000 }

export function HkRing({ f, c, size = 46, w = 4, children }: { f: number; c: string; size?: number; w?: number; children?: ReactNode }) {
  const r = size / 2 - w, C = 2 * Math.PI * r
  return (
    <span className="hk-ringwrap" style={{ width: size, height: size }}>
      <svg className="hk-ring" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`color-mix(in oklab, ${c} 18%, var(--hk-dot))`} strokeWidth={w} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(1, Math.max(0, f)))} />
      </svg>
      {children}
    </span>
  )
}
