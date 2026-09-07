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
  /* His report, verbatim, real data: he asked whether he'd paid Spotify --
     visibly still unpaid on the real Bills page -- and the model said it
     "is not on the bills list for this cycle", confidently and wrongly,
     because an 8-item cap on this line had silently dropped it: overdue
     debts and planned expenses sort ahead of ordinary recurring bills
     (cycleChecklist's own order), and past a handful of those Spotify
     never reached the briefing at all. The exact failure the rest of this
     app already learned to avoid with tasks ("a filtered briefing makes
     the model confident about a day it has only seen a third of") --
     uncapped here for the same reason backlog itself is only capped at 25,
     not 8: a wrong "it isn't here" is worse than a slightly longer prompt. */
  const brief: BillsBrief | null = ready ? {
    due: items.length,
    paid: items.filter((i) => i.paid).length,
    open: items.filter((i) => !i.paid).map((i) => i.name).slice(0, 25),
  } : null

  return { ready, items, brief, markPaid, markUnpaid }
}
