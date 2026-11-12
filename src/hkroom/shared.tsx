import {
    type Goal, type HabitDef, type Routine, type TimeSlot
} from '../types'
import { localDateKey } from '../util'

/* ---------- dates and numbers ---------- */
export const DAY = 86400000

export const keyAgo = (n: number) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return localDateKey(d) }

export const short = (k: string) => new Date(`${k}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/* ---------- the page's own view of everything ---------- */
export type Kind = 'routine' | 'check' | 'count' | 'amount' | 'auto' | 'quit' | 'goal'

export interface Item {
  key: string; kind: Kind; id: string; name: string; color: string; icon: string
  habit?: HabitDef; routine?: Routine; list?: HabitDef[]; goal?: Goal
  /** Index into PARTS for a habit (4 = Any time); 5 goals, 6 quits. */
  part: number
  /** Order inside its part: the routine's own running order first, then loose habits. */
  ord: number
}

/* PARTS OF THE DAY (his call, 2026-10-26): routines stopped being cards; every
   habit, the ones that used to be a routine's steps included, sits in the part
   of the day it belongs to. Goals and quits keep their own sections. */
export const PARTS: { slot?: TimeSlot; label: string }[] = [
  { slot: 'morning', label: 'Morning' }, { slot: 'noon', label: 'Noon' }, { slot: 'afternoon', label: 'Afternoon' }, { slot: 'evening', label: 'Evening' }, { label: 'Any time' },
]

export const isHabitKind = (k: Kind) => k === 'check' || k === 'count' || k === 'amount' || k === 'auto'
