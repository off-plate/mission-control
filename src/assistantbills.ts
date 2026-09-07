/* Bills, the way the assistant sees them.

   His report (2026-09-08): asked whether Spotify was paid, and the assistant
   said it had no bills data at all -- true at the time, since the brief only
   ever carried tasks, habits, goals and the calendar. This is the same real
   log Bills itself reads, through the exact same account/data plumbing
   (useCompassAccount, useBillsData -- both already shared with billsdock.tsx,
   not a second copy of them), the same cycle math (cycleChecklist), and for
   marking one paid, the same two Supabase calls markPaid/undoPaid already
   make in billspage.tsx. Nothing here is bills-shaped guesswork: it is the
   real page's own read, reused. */

import { useMemo } from 'react'
import { useCompassAccount, useBillsData } from './billspage'
import {
  activeCycleKey, cycleChecklist, cycleForKey, resolveCycleIncome, todayISO,
  type CycleItem,
} from './compassCalc'
import { deleteRow, insertRow } from './supabase'

/** Due/paid/open, the exact shape habits and routines already use in the
 *  brief -- so the model reads this the same way it reads those, not a
 *  fourth new format to learn. Scoped to the ACTIVE cycle only (the one
 *  Bills itself opens on): "did I pay Spotify" means this cycle, not every
 *  cycle that ever existed. */
export interface BillsBrief { due: number; paid: number; open: string[] }

export function useAssistantBills() {
  const signedIn = useCompassAccount()
  const { data, reload } = useBillsData(signedIn)

  const items = useMemo<CycleItem[]>(() => {
    if (!data) return []
    const cycle = cycleForKey(activeCycleKey(data.profile))
    const income = resolveCycleIncome(cycle, data.cycleIncome).amount
    return cycleChecklist(data.recurring, data.planned, data.debts, data.transactions, cycle, income).items
  }, [data])

  /* Mirrors billspage.tsx's own markPaid/undoPaid exactly -- same table, same
     fields, same "today" for when it was actually paid (not the bill's due
     date, which is what markPaid uses for a PAST cycle it is backfilling;
     the assistant only ever acts on the active cycle, so that branch never
     applies here). */
  const markPaid = async (i: CycleItem): Promise<void> => {
    await insertRow('compass_transactions', {
      kind: i.kind, amount: i.amount, occurred_on: todayISO(),
      recurring_id: i.link.recurring_id ?? null, planned_id: i.link.planned_id ?? null,
      debt_id: i.debtId, category_id: i.categoryId, goal_id: i.goalId, account_id: null,
    })
    reload()
  }
  const markUnpaid = async (i: CycleItem): Promise<void> => {
    if (!i.paidTxId) return
    await deleteRow('compass_transactions', i.paidTxId)
    reload()
  }

  const ready = signedIn === true && !!data
  const brief: BillsBrief | null = ready ? {
    due: items.length,
    paid: items.filter((i) => i.paid).length,
    open: items.filter((i) => !i.paid).map((i) => i.name).slice(0, 8),
  } : null

  return { ready, items, brief, markPaid, markUnpaid }
}
