/* Money, read from Compass.

   Compass lives in the same Supabase project as this app, in its own
   compass_* tables, so signed in as him this reads the real thing instead of
   asking him to keep two numbers in his head. Nothing is written back: Compass
   owns the money, this is a readout.

   The arithmetic below is Compass's own (src/store/selectors.ts there), copied
   deliberately rather than approximated, so the two apps can never disagree
   about what he owes. If Compass changes how it counts, this has to follow.

   No figure is ever hardcoded here. This repo is public; every number arrives
   at runtime, over an authenticated session, or the panel says it has none. */

import { useEffect, useState } from 'react'
import { SUPABASE_ENABLED, readRows } from './supabase'

interface CompassDebt {
  id: string
  status: string
  principal_start: number
  original_amount: number | null
  monthly_payment: number
  start_on: string
}

interface CompassTx {
  amount: number
  kind: string
  debt_id: string | null
  occurred_on: string
}

export interface CompassMoney {
  /** Still owed across active debts. */
  owed: number
  /** Of the original total, how much is gone. */
  paidOff: number
  /** What those debts started at. */
  baseline: number
  /** 0..100, share of the original paid off. */
  pct: number
  /** Monthly payments across debts that still owe something. */
  monthly: number
  /** Set aside this calendar month. */
  savedThisMonth: number
  /** How many debts are still open. */
  openDebts: number
  /** This month's payments, one row per open debt: the day of the month it
   *  lands on, what it is, and whether Compass has already recorded it going
   *  out. Derived from `start_on` and the transaction log, so it needs no
   *  column this file was not already reading.
   *
   *  These are not due dates in the to-do sense and nothing here invents one.
   *  A debt payment has a real date imposed from outside, by a bank, and the
   *  only question worth asking is whether it went. */
  due: { day: number; amount: number; sent: boolean }[]
  /** Money that actually moved, keyed by the day it moved on.
   *
   *  The Timeline asks what the big number DID on a given day, and a monthly
   *  total cannot answer that. `paid` is debt going down, `saved` is money set
   *  aside; both are what Compass recorded, never a projection. */
  byDay: Record<string, { paid: number; saved: number }>
}

export type CompassState =
  | { status: 'off' }                       // sync not configured, or ?noremote
  | { status: 'signed-out' }
  | { status: 'loading' }
  | { status: 'empty' }                     // signed in, but Compass has no debts
  | { status: 'error'; message: string }
  | { status: 'ok'; money: CompassMoney }

export function summarise(debts: CompassDebt[], tx: CompassTx[]): CompassMoney {
  const paidOn = (d: CompassDebt) =>
    tx
      .filter((t) => t.kind === 'debt_payment' && t.debt_id === d.id && t.occurred_on >= d.start_on)
      .reduce((s, t) => s + t.amount, 0)

  const active = debts.filter((d) => d.status === 'active')
  const remainingOf = (d: CompassDebt) => Math.max(0, d.principal_start - paidOn(d))

  const owed = active.reduce((s, d) => s + remainingOf(d), 0)
  const baseline = active.reduce((s, d) => s + (d.original_amount ?? d.principal_start), 0)
  const paidOff = Math.max(0, baseline - owed)
  const open = active.filter((d) => remainingOf(d) > 0)

  /* Local month, not UTC: toISOString reads the UTC clock, a calendar day
     behind Prague's for the two hours after midnight, which only bites on
     the night the month actually turns over but would silently zero out
     "saved this month" for those two hours if it did. */
  const now = new Date()
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const savedThisMonth = tx
    .filter((t) => t.kind === 'saving' && t.occurred_on.slice(0, 7) === month)
    .reduce((s, t) => s + t.amount, 0)

  return {
    owed,
    paidOff,
    baseline,
    // A baseline of zero is not 0% paid, it is nothing to pay.
    pct: baseline > 0 ? Math.round((paidOff / baseline) * 100) : 100,
    monthly: open.reduce((s, d) => s + d.monthly_payment, 0),
    savedThisMonth,
    openDebts: open.length,
    /* Day of month off start_on, read from the string rather than through a
       Date, because `new Date('2026-08-15')` is parsed as UTC midnight and in
       Prague that is still the 14th for two hours. A payment already recorded
       against this debt inside this calendar month counts as gone. */
    due: open
      .map((d) => ({
        day: Number(d.start_on.slice(8, 10)) || 1,
        amount: d.monthly_payment,
        sent: tx.some((t) => t.kind === 'debt_payment' && t.debt_id === d.id && t.occurred_on.slice(0, 7) === month),
      }))
      .filter((r) => r.amount > 0)
      .sort((a, b) => a.day - b.day),
    byDay: tx.reduce<Record<string, { paid: number; saved: number }>>((acc, t) => {
      if (t.kind !== 'debt_payment' && t.kind !== 'saving') return acc
      const row = (acc[t.occurred_on] ??= { paid: 0, saved: 0 })
      if (t.kind === 'debt_payment') row.paid += t.amount
      else row.saved += t.amount
      return acc
    }, {}),
  }
}

export async function readCompass(): Promise<CompassState> {
  if (!SUPABASE_ENABLED) return { status: 'off' }
  try {
    const debts = await readRows<CompassDebt>('compass_debts', 'id,status,principal_start,original_amount,monthly_payment,start_on')
    if (debts === null) return { status: 'signed-out' }
    if (debts.length === 0) return { status: 'empty' }
    const tx = await readRows<CompassTx>('compass_transactions', 'amount,kind,debt_id,occurred_on')
    return { status: 'ok', money: summarise(debts, tx ?? []) }
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : 'Compass could not be read.' }
  }
}

/** Reads once when the page opens, and again on demand. */
export function useCompass(): { state: CompassState; reload: () => void } {
  const [state, setState] = useState<CompassState>(SUPABASE_ENABLED ? { status: 'loading' } : { status: 'off' })
  const [n, setN] = useState(0)

  useEffect(() => {
    if (!SUPABASE_ENABLED) return
    let alive = true
    setState({ status: 'loading' })
    void readCompass().then((s) => { if (alive) setState(s) })
    return () => { alive = false }
  }, [n])

  return { state, reload: () => setN((x) => x + 1) }
}
