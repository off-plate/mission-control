/* THE FLOATING BILLS SUMMARY. His ask (2026-09-02), after seeing the Notes
   popup: he wants Bills reachable from the same hover dock, but not a full
   port of the page into a 560px face -- billspage.tsx is 700+ lines (six
   edit sheets, sign-in, per-item pay/skip/undo), and cramming all of that
   into the dock would be a much bigger build for a much worse fit. Landed on
   his own second option instead: a compact read-mostly summary -- the free-
   to-spend figure and where it's going, this cycle only, no cycle nav, no
   editing -- with the Bills button (paired with onOpenFull, same as Note's)
   as the door into the real page for anything beyond a glance.

   Reads through useCompassAccount/useBillsData, exported from billspage.tsx
   for exactly this -- this is a second face on the same data, not a second
   copy of the Supabase plumbing or the cycle math (compassCalc.ts). */
import { useMemo, type ReactNode } from 'react'
import { useStore } from './store'
import { useCompassAccount, useBillsData } from './billspage'
import { activeCycleKey, cycleChecklist, cycleFree, cycleForKey, resolveCycleIncome } from './compassCalc'
import { SUPABASE_ENABLED } from './supabase'
import * as Icon from './icons'

const money = (n: number): string => `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(Math.round(n))} Kč`

export function BillsChip() {
  return <Icon.Wallet size={16} />
}

/* His catch (2026-09-03): the panel showed nothing at all -- a blank white
   body -- for the two moments this data isn't there yet (checking who's
   signed in, then the actual Supabase round trip for six tables), before
   snapping straight to the real numbers. Read as broken, not loading. This
   stands in the same shape the real content lands in (the hero figure, the
   subtitle, three rows) so nothing jumps when the numbers actually arrive,
   pulsing with the same --ease-loop/pomo-pulse rhythm the mic and the await
   ring already use elsewhere for "something is happening, wait" -- not a
   new motion language, the one this app already has for exactly this. */
function BillsSkeleton() {
  return (
    <div className="billsdock-skeleton" aria-hidden="true">
      <div className="bds-bar bds-hero" />
      <div className="bds-bar bds-sub" />
      <div className="bds-rows">
        <div className="bds-row"><div className="bds-bar bds-label" /><div className="bds-bar bds-value" /></div>
        <div className="bds-row"><div className="bds-bar bds-label" /><div className="bds-bar bds-value" /></div>
        <div className="bds-row"><div className="bds-bar bds-label" /><div className="bds-bar bds-value" /></div>
      </div>
    </div>
  )
}

export function BillsPanel({ dockControls, onOpenFull }: { dockControls?: ReactNode; onOpenFull?: () => void }) {
  const { setPage } = useStore()
  const signedIn = useCompassAccount()
  const { data, error } = useBillsData(signedIn)

  /* Always the ACTIVE cycle -- no offset state here, unlike the full page's
     cycle nav. A quick glance answers "where do I stand right now", not
     "where did I stand three cycles ago". */
  const cycle = useMemo(() => cycleForKey(activeCycleKey(data?.profile ?? null)), [data?.profile])
  const allSkips = (data?.profile?.settings as { skips?: Record<string, string[]> } | undefined)?.skips ?? {}
  const skips = allSkips[cycle.key] ?? []
  const dismissed = useMemo(() => new Set(Object.values(allSkips).flat()), [allSkips])
  const carryIn = ((data?.profile?.settings as { carryover?: Record<string, number> } | undefined)?.carryover?.[cycle.key]) ?? 0
  const income = data ? resolveCycleIncome(cycle, data.cycleIncome).amount : 0
  const chk = data ? cycleChecklist(data.recurring, data.planned, data.debts, data.transactions, cycle, income, dismissed) : null
  const free = data ? cycleFree(data.recurring, data.planned, data.debts, data.transactions, cycle, income, skips, dismissed, carryIn) : null

  const openFull = () => { setPage('bills'); onOpenFull?.() }

  return (
    <div className="billsdock-panel">
      <div className="billsdock-head">
        <span className="billsdock-title">{cycle.label}</span>
        {/* Same real .btn-primary classes as Notes' door out -- see the note
           there on why this isn't a hand-rolled background. */}
        <button className="btn btn-primary dock-open-btn" onClick={openFull} title="Open Bills">
          <Icon.ExternalLink size={13} />
          Bills
        </button>
        {dockControls}
      </div>
      <div className="billsdock-body">
        {/* Same order the full page checks these in: sync off, still
           resolving who's signed in, not signed in, a load error, still
           loading the actual rows -- only then the real summary. */}
        {!SUPABASE_ENABLED ? (
          <p className="billsdock-empty">Sync is off in this build (running with <code>?noremote</code>), so Bills has nothing to read here.</p>
        ) : signedIn === null ? (
          <BillsSkeleton />
        ) : !signedIn ? (
          <p className="billsdock-empty">Sign in on the full Bills page to see your numbers here.</p>
        ) : error ? (
          <p className="billsdock-empty">Couldn't load Bills: {error}</p>
        ) : !data || !chk || !free ? (
          <BillsSkeleton />
        ) : (
          <>
            <div className={`billsdock-hero${free.free < 0 ? ' is-neg' : ''}`}>{money(free.free)}</div>
            <div className="billsdock-sub">
              {income > 0 ? (free.free >= 0 ? 'free to spend this cycle' : 'short this cycle') : 'no income logged yet'}
            </div>
            <div className="billsdock-rows">
              <div className="bdr"><span>Coming in</span><span className="mono pos">{money(free.comingIn)}</span></div>
              <div className="bdr"><span>Recurring bills</span><span className="mono neg">−{money(free.recurringOut)}</span></div>
              <div className="bdr"><span>Debt payments</span><span className="mono neg">−{money(free.debtOut)}</span></div>
              {free.unexpectedOut > 0 && <div className="bdr"><span>Unexpected</span><span className="mono neg">−{money(free.unexpectedOut)}</span></div>}
              {free.unreasonableOut > 0 && <div className="bdr"><span>Unreasonable</span><span className="mono neg">−{money(free.unreasonableOut)}</span></div>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
