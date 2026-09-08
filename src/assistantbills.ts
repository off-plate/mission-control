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
import { useCompassAccount, useBillsData, refreshBills, getBillsSnapshot, type BillsData } from './billspage'
import {
  activeCycleKey, cycleChecklist, cycleForKey, iso, resolveCycleIncome, todayISO,
  type CycleItem,
} from './compassCalc'
import { deleteRow, insertRow } from './supabase'

/** Due/paid/open, the exact shape habits and routines already use in the
 *  brief -- so the model reads this the same way it reads those, not a
 *  fourth new format to learn. Scoped to the ACTIVE cycle only (the one
 *  Bills itself opens on): "did I pay Spotify" means this cycle, not every
 *  cycle that ever existed. */
export interface BillsBrief { due: number; paid: number; open: string[] }

const itemsFor = (data: BillsData): CycleItem[] => {
  const cycle = cycleForKey(activeCycleKey(data.profile))
  const income = resolveCycleIncome(cycle, data.cycleIncome).amount
  return cycleChecklist(data.recurring, data.planned, data.debts, data.transactions, cycle, income).items
}

export function useAssistantBills() {
  const signedIn = useCompassAccount()
  const { data, reload } = useBillsData(signedIn)

  const items = useMemo<CycleItem[]>(() => (data ? itemsFor(data) : []), [data])

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

  /* "Unexpected this cycle" -- the exact insert PlannedSheet's own "Add a
     one-off" makes (billspage.tsx): same table, same kind/priority, same
     cycle_start (a real date, iso(cycle.start) -- NOT the "YYYY-MM" cycle
     key cycleChecklist's own filter compares it against a date range, not
     an exact key match). His ask, verbatim: "write in ... I need to pay
     garbage bags which will cost 800 czk" -- a real row Bills itself shows,
     not a sentence claiming one exists.

     Reads getBillsSnapshot() fresh, not this hook's own `data` closure: the
     caller already awaited ensure() to land past the exact race this whole
     file exists to fix, and a stale `data` here would silently no-op (the
     `if` below) while the caller still reports success -- a second copy of
     the very bug ensure() was built to close, just moved one line over. */
  const addExpense = async (name: string, amount: number, dueOn?: string): Promise<void> => {
    const snap = getBillsSnapshot().data
    if (!snap) throw new Error('Bills data was not loaded')
    const cycle = cycleForKey(activeCycleKey(snap.profile))
    await insertRow('compass_planned', {
      name, amount, kind: 'expense', priority: 'mandatory',
      due_on: dueOn ?? todayISO(), cycle_start: iso(cycle.start),
    })
    reload()
  }

  /* A real row under Income, the same insert the Income sheet's own Save
     makes (billspage.tsx's IncomeSheet) -- minus the day-of-month field,
     which lives in profile.settings rather than this table and is never
     something he states in a sentence about getting paid. Same fresh-
     snapshot rule as addExpense above. */
  const addIncome = async (amount: number, label?: string): Promise<void> => {
    const snap = getBillsSnapshot().data
    if (!snap) throw new Error('Bills data was not loaded')
    const cycle = cycleForKey(activeCycleKey(snap.profile))
    await insertRow('compass_cycle_income', {
      label: label ?? null, expected_income: amount, cycle_start: iso(cycle.start),
    })
    reload()
  }

  /* A write action landing the instant Bills opens sees a stale render --
     `data` here is whatever the last render captured, and the real fetch
     this hook's own effect just kicked off is still in flight. His report,
     2026-09-08: asked to open Bills then immediately write in a one-off,
     genuinely signed in with real synced data on screen, and got "Bills is
     not signed in on this device" -- true of the closure, false of the
     account. ensure() reads the module-level store directly instead of
     this hook's own snapshot, and waits on the real Supabase round trip
     (refreshBills is idempotent -- returns instantly once already cached)
     rather than failing on a timing accident. */
  const ensure = async (): Promise<{ ready: boolean; items: CycleItem[] }> => {
    if (signedIn !== true) return { ready: false, items: [] }
    await refreshBills(true)
    const snap = getBillsSnapshot()
    return snap.data ? { ready: true, items: itemsFor(snap.data) } : { ready: false, items: [] }
  }

  const ready = signedIn === true && !!data
  const loading = signedIn === true && !data
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
  const brief: BillsBrief | 'loading' | null = ready ? {
    due: items.length,
    paid: items.filter((i) => i.paid).length,
    open: items.filter((i) => !i.paid).map((i) => i.name).slice(0, 25),
  } : loading ? 'loading' : null

  return { ready, loading, items, brief, markPaid, markUnpaid, addExpense, addIncome, ensure }
}
