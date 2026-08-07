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

  const month = new Date().toISOString().slice(0, 7)
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
