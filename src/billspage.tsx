/* BILLS, ported from Compass -- the same Supabase project his other apps
   already share (see supabase.ts). Reached from the header, next to Note,
   on his instruction (2026-09-01): not a page under a workspace, not
   filtered by space, a global panel like Notes and the Zone are.

   Scope for this first pass, agreed with him against a design artifact:
   Income, Recurring bills, Debt payments, Unexpected this cycle,
   Unreasonable, and the Debt freedom card. Savings and Goals are left in
   Compass for now. The math underneath -- cycle boundaries, the free-to-
   spend formula, debt payoff projection -- is ported in compassCalc.ts as
   close to verbatim as this codebase's conventions allow, and checked
   against known values there, because this reads and writes his real
   financial data on a shared production database. */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Sheet } from './modals'
import { CycleRail, type RailIncome } from './cyclerail'
import { parseDebtLines } from './debtimport'
import { Band, Segmented } from './ui'
import {
  currentAccount, deleteRow, insertRow, onAccountChange, readRows, sendSignInCode, signInWithCode,
  updateRow, upsertCompassProfile, SUPABASE_ENABLED,
} from './supabase'
import {
  activeCycleKey, addMonthsToKey, cycleChecklist, cycleFree, cycleForKey, debtFreeView, debtFreedom, debtRunway, debtView,
  iso, relativeDay, resolveCycleIncome, todayISO,
  type CompassCycleIncome, type CompassDebt, type CompassPlanned, type CompassProfile, type CompassRecurring,
  type CompassTransaction, type CycleItem, type DebtKind,
} from './compassCalc'

const money = (n: number): string => `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(Math.round(n))} Kč`

/* ---------------- data ---------------- */

export interface BillsData {
  profile: CompassProfile | null
  debts: CompassDebt[]
  recurring: CompassRecurring[]
  transactions: CompassTransaction[]
  planned: CompassPlanned[]
  cycleIncome: CompassCycleIncome[]
}

/* Exported for billsdock.tsx (the dock's compact summary, 2026-09-02) --
   the same account/data plumbing this page uses, not a second copy of it.
   The dock reads real financial data too, so it goes through the one place
   that already talks to Supabase correctly rather than re-deriving it.

   Both used to be plain per-component hooks: with the dock's Bills summary
   AND the full Bills page both mounted (open the dock, hold Bills for the
   full page), that was two currentAccount() calls and two 6-table
   Promise.all reads of the same financial data on the same screen. Shared
   module-level stores now, the same pattern calendar.ts and compass.ts
   already use -- one account subscription, one fetch, every caller sees
   the same answer. */

let accountView: boolean | null = null
const accountListeners = new Set<() => void>()
let accountUnsub: (() => void) | null = null

function publishAccount(a: boolean | null): void {
  accountView = a
  for (const f of [...accountListeners]) f()
}

function subscribeAccount(f: () => void): () => void {
  accountListeners.add(f)
  if (accountListeners.size === 1) {
    void currentAccount().then((a) => publishAccount(!!a))
    accountUnsub = onAccountChange((a) => publishAccount(!!a))
  }
  return () => {
    accountListeners.delete(f)
    if (accountListeners.size === 0) { accountUnsub?.(); accountUnsub = null }
  }
}

const getAccountSnapshot = () => accountView

export function useCompassAccount() {
  return useSyncExternalStore(subscribeAccount, getAccountSnapshot, getAccountSnapshot)
}

let billsView: { data: BillsData | null; error: string | null } = { data: null, error: null }
const billsListeners = new Set<() => void>()
let billsInFlight: Promise<void> | null = null
let billsForAccount: boolean | null = null

function publishBills(next: { data: BillsData | null; error: string | null }): void {
  billsView = next
  for (const f of [...billsListeners]) f()
}


function refreshBills(signedIn: boolean | null, force = false): Promise<void> {
  if (!signedIn) { publishBills({ data: null, error: null }); return Promise.resolve() }
  /* Shared unconditionally, force included -- the same rule calendar.ts's
     refreshCalendar uses. force only skips the "already have this account's
     data" short-circuit below; a manual reload that lands mid-fetch still
     joins the fetch already in flight instead of doubling it. */
  if (billsInFlight) return billsInFlight
  if (!force && billsView.data && billsForAccount === signedIn) return Promise.resolve()
  billsForAccount = signedIn
  billsInFlight = Promise.all([
    readRows<CompassProfile>('compass_profile', '*'),
    readRows<CompassDebt>('compass_debts', '*'),
    readRows<CompassRecurring>('compass_recurring', '*'),
    readRows<CompassTransaction>('compass_transactions', '*'),
    readRows<CompassPlanned>('compass_planned', '*'),
    readRows<CompassCycleIncome>('compass_cycle_income', '*'),
  ]).then(([profileRows, debts, recurring, transactions, planned, cycleIncome]) => {
    publishBills({
      data: {
        profile: profileRows?.[0] ?? null,
        debts: debts ?? [], recurring: recurring ?? [], transactions: transactions ?? [],
        planned: planned ?? [], cycleIncome: cycleIncome ?? [],
      },
      error: null,
    })
  }).catch((e) => {
    publishBills({ data: billsView.data, error: e instanceof Error ? e.message : String(e) })
  }).finally(() => { billsInFlight = null })
  return billsInFlight
}

function subscribeBills(f: () => void): () => void {
  billsListeners.add(f)
  return () => { billsListeners.delete(f) }
}

const getBillsSnapshot = () => billsView

/* refreshBills is called from an effect here, once per caller, but its own
   billsInFlight/billsForAccount guards mean two callers mounting together
   (the dock's Bills summary and the full page, both open at once) still
   land on ONE fetch -- the second call sees the first already in flight
   and shares it, exactly like the subscribe-driven dedup in compass.ts and
   calendar.ts, just triggered by the signedIn prop instead of listener
   count since this store's data depends on which account it's for. */
export function useBillsData(signedIn: boolean | null) {
  const view = useSyncExternalStore(subscribeBills, getBillsSnapshot, getBillsSnapshot)
  useEffect(() => { void refreshBills(signedIn) }, [signedIn])
  const reload = useCallback(() => { void refreshBills(signedIn, true) }, [signedIn])
  return { data: view.data, error: view.error, reload }
}

/* ---------------- the page ---------------- */

export function BillsPage() {
  const signedIn = useCompassAccount()
  const { data, error, reload } = useBillsData(signedIn)
  const [cycleOffset, setCycleOffset] = useState(0)

  const [editRecurring, setEditRecurring] = useState<CompassRecurring | 'new' | null>(null)
  const [editPlanned, setEditPlanned] = useState<CompassPlanned | 'new' | null>(null)
  const [editUnreasonable, setEditUnreasonable] = useState<CompassPlanned | 'new' | null>(null)
  const [editIncome, setEditIncome] = useState<CompassCycleIncome | 'new' | null>(null)
  const [editDebt, setEditDebt] = useState<CompassDebt | 'new' | null>(null)
  /* Which section's manage sheet is open, on his instruction (2026-09-01):
     "ditch the ADD button and just have an edit button in there, which
     you're gonna do editing, rewriting, adding, removing" -- one entry
     point per section that lists everything in it, not just a shortcut to
     add one more. */
  const [managing, setManaging] = useState<'income' | 'recurring' | 'debt' | 'unexpected' | 'unreasonable' | null>(null)
  const [importDebts, setImportDebts] = useState(false)
  const [ending, setEnding] = useState(false)
  const [busy, setBusy] = useState(false)

  const cycle = useMemo(() => {
    const activeKey = activeCycleKey(data?.profile ?? null)
    return cycleForKey(addMonthsToKey(activeKey, cycleOffset))
  }, [data?.profile, cycleOffset])

  const allSkips = (data?.profile?.settings as { skips?: Record<string, string[]> } | undefined)?.skips ?? {}
  const skips = allSkips[cycle.key] ?? []
  const dismissed = useMemo(() => new Set(Object.values(allSkips).flat()), [allSkips])
  const carryIn = ((data?.profile?.settings as { carryover?: Record<string, number> } | undefined)?.carryover?.[cycle.key]) ?? 0
  /* WHICH DAY THE MONEY ARRIVES. compass_cycle_income carries cycle_start and
     expected_income and nothing else -- a month bucket with no date -- so the
     rail had no way to place a salary. Kept in profile.settings rather than a
     new column: this is a shared production database and settings is already
     the blob holding skips, carryover and active_cycle. Keyed by income row,
     because he can have more than one source and they need not land together.
     An entry with no day is not given one; it sits in the rail's tray. */
  const incomeDays = (data?.profile?.settings as { income_day?: Record<string, number> } | undefined)?.income_day ?? {}

  const income = data ? resolveCycleIncome(cycle, data.cycleIncome).amount : 0
  const chk = data ? cycleChecklist(data.recurring, data.planned, data.debts, data.transactions, cycle, income, dismissed) : null
  const free = data ? cycleFree(data.recurring, data.planned, data.debts, data.transactions, cycle, income, skips, dismissed, carryIn) : null
  const freedom = data ? debtFreedom(data.debts, data.transactions) : null
  const freeView = data ? debtFreeView(data.debts, data.transactions) : null
  const runway = data ? debtRunway(data.debts, data.transactions) : null
  /* The Debt freedom card was one aggregate figure with no way behind it: his
     eight creditors were only reachable through the Debt payments section's
     Edit list, and only the ones with a payment due this cycle showed at all.
     Every active debt is listed in the card now, largest first. */
  const debtRows = useMemo(
    () => (data ? data.debts.filter((d) => d.status === 'active').map((d) => debtView(d, data.transactions)).sort((a, b) => b.remaining - a.remaining) : []),
    [data],
  )
  const nextRelief = runway?.milestones.find((m) => m.monthIndex <= 3) ?? null

  const cycleTitle = cycleOffset === 0 ? 'This cycle' : cycleOffset === 1 ? 'Next cycle' : cycleOffset === -1 ? 'Last cycle'
    : cycleOffset > 0 ? `In ${cycleOffset} cycles` : `${-cycleOffset} cycles ago`

  const groups = chk ? {
    income: data!.cycleIncome.filter((ci) => ci.cycle_start >= iso(cycle.start) && ci.cycle_start < iso(cycle.end)),
    recurring: chk.items.filter((i) => i.source === 'fixed' && i.kind !== 'debt_payment'),
    debt: chk.items.filter((i) => i.kind === 'debt_payment'),
    unexpected: chk.items.filter((i) => i.source === 'adhoc'),
    unreasonable: chk.items.filter((i) => i.source === 'unreasonable'),
  } : null

  /* The snapshot counts what is STILL to pay, not how many rows exist. A cycle
     with the rent already paid read "Recurring bills (2) −800 Kč": two bills,
     one bill's worth of money, because the total left paid items out and the
     count did not. The sections below still list everything, paid included,
     since that is where a payment gets undone. Skipped items are out of both,
     the same rule cycleFree uses. */
  const stillDue = groups ? {
    recurring: groups.recurring.filter((i) => !i.paid && !skips.includes(i.id)).length,
    debt: groups.debt.filter((i) => !i.paid && !skips.includes(i.id)).length,
    unexpected: groups.unexpected.filter((i) => !i.paid && !skips.includes(i.id)).length,
    unreasonable: groups.unreasonable.filter((i) => !i.paid && !skips.includes(i.id)).length,
  } : null

  /* The rail's readout and tray open the row they name, so the mapping from a
     checklist item back to the sheet that edits it lives here once instead of
     being repeated at every call site. */
  const openItem = (i: CycleItem) => {
    if (!data) return
    if (i.debtId) { const d = data.debts.find((x) => x.id === i.debtId); if (d) { setEditDebt(d); return } }
    if (i.link.recurring_id) { const r = data.recurring.find((x) => x.id === i.link.recurring_id); if (r) { setEditRecurring(r); return } }
    if (i.link.planned_id) {
      const p = data.planned.find((x) => x.id === i.link.planned_id)
      if (p) { if (i.source === 'unreasonable') setEditUnreasonable(p); else setEditPlanned(p); return }
    }
  }

  /* ---- actions, mirroring Compass's own Bills.tsx/useStore.ts exactly ---- */

  const markPaid = async (i: CycleItem) => {
    setBusy(true)
    try {
      await insertRow('compass_transactions', {
        kind: i.kind, amount: i.amount,
        occurred_on: cycleOffset === 0 ? todayISO() : (i.dueOn ?? iso(cycle.start)),
        recurring_id: i.link.recurring_id ?? null, planned_id: i.link.planned_id ?? null,
        debt_id: i.debtId, category_id: i.categoryId, goal_id: i.goalId, account_id: null,
      })
      reload()
    } finally { setBusy(false) }
  }
  const undoPaid = async (i: CycleItem) => {
    if (!i.paidTxId) return
    setBusy(true)
    try { await deleteRow('compass_transactions', i.paidTxId); reload() } finally { setBusy(false) }
  }
  const toggleSkip = async (itemId: string) => {
    setBusy(true)
    try {
      const settings = (data?.profile?.settings ?? {}) as Record<string, unknown>
      const map = { ...((settings.skips as Record<string, string[]>) ?? {}) }
      const set0 = new Set(map[cycle.key] ?? [])
      if (set0.has(itemId)) set0.delete(itemId); else set0.add(itemId)
      map[cycle.key] = [...set0]
      await upsertCompassProfile(settings, { settings: { skips: map } })
      reload()
    } finally { setBusy(false) }
  }
  const toggleTag = async (p: CompassPlanned) => {
    setBusy(true)
    try { await updateRow('compass_planned', p.id, { tag: p.tag === 'regret' ? 'functional' : 'regret' }); reload() } finally { setBusy(false) }
  }
  const endCycle = async (actualLeft: number) => {
    if (ending) return
    setEnding(true)
    try {
      const nextKey = addMonthsToKey(activeCycleKey(data?.profile ?? null), 1)
      const settings = (data?.profile?.settings ?? {}) as Record<string, unknown>
      const carryover = { ...((settings.carryover as Record<string, number>) ?? {}), [nextKey]: actualLeft }
      await upsertCompassProfile(settings, { settings: { carryover, active_cycle: nextKey } })
      setCycleOffset(0)
      reload()
    } finally { setEnding(false) }
  }

  if (!SUPABASE_ENABLED) {
    return <div className="page bills-page"><div className="bills-empty">Sync is off in this build (running with <code>?noremote</code>), so Bills has nothing to read.</div></div>
  }
  if (signedIn === null) return <div className="page bills-page" />
  if (!signedIn) return <div className="page bills-page"><BillsSignIn /></div>
  if (error) return <div className="page bills-page"><div className="bills-empty">Couldn't load Bills: {error}</div></div>
  if (!data || !chk || !free || !freedom || !freeView || !groups || !stillDue) return <div className="page bills-page" />

  return (
    <div className="page bills-page">
      <div className="bills-wrap">
        {/* Every other page names itself here with Band -- Today, Plan,
            Habits, Goals, Settings. Bills never had one: the cycle-nav row
            below was standing in for it, but that row had to move down
            (see .bills-wrap's padding history) to clear the nav overlay,
            which left the space where a page's name normally sits empty.
            Band supplies its own top clearance, so .bills-wrap's own
            padding-top comes back down to nothing here -- Band plus the
            cycle row's own spacing is what clears the overlay now. */}
        <Band title="Bills" />
        <div className="bills-head">
          <div className="bills-cyc">
            <button className="bills-iconbtn" onClick={() => setCycleOffset((n) => n - 1)} aria-label="Previous cycle">‹</button>
            <div>
              <h2>{cycleTitle}</h2>
              <div className="bills-range">{cycle.label}</div>
            </div>
            <button className="bills-iconbtn" onClick={() => setCycleOffset((n) => n + 1)} aria-label="Next cycle">›</button>
            {cycleOffset !== 0 && <button className="bills-today" onClick={() => setCycleOffset(0)}>Today</button>}
          </div>
          {cycleOffset === 0 && (
            <button className="bills-endcycle" onClick={() => setEnding(true)}>✓ End cycle</button>
          )}
        </div>

        {/* The figure itself is unconditional, matching Compass's own
            FreeToSpendHero exactly: only the eyebrow and the line under the
            figure change when there's no income yet, never the number.
            This page had it backwards -- the whole hero collapsed to just
            the eyebrow and an "add income" button, dropping the actual
            surplus/shortfall figure entirely, which is the one thing he
            open this page to see. Recurring bills and debt payments still
            commit money against a cycle with no income logged yet, so
            `free.free` is real and worth showing (usually a stark negative)
            even before he's told it what's coming in. */}
        <div className="bills-hero">
          <div className="bh-eyebrow">{income > 0 ? 'Free to spend this cycle' : "Let's set up this cycle"}</div>
          <div className={`bh-figure${free.free < 0 ? ' is-neg' : ''}`}>{money(free.free)}</div>
          {income <= 0 ? (
            <button className="bh-addincome" onClick={() => setEditIncome('new')}>Add your income to begin →</button>
          ) : free.free >= 0 ? (
            <div className="bh-sub">after <b>{money(free.committed)}</b> in bills this cycle</div>
          ) : (
            <div className="bh-sub is-neg">you're <b>{money(-free.free)}</b> short this cycle</div>
          )}
          {income > 0 && (
            <div className="bh-track">
              <i className="committed" style={{ width: `${Math.min(100, (free.committed / Math.max(income, free.committed, 1)) * 100)}%` }} />
              <i className="free" style={{ width: `${Math.max(0, Math.min(100, (free.free / Math.max(income, free.committed, 1)) * 100))}%` }} />
            </div>
          )}
        </div>

        <CycleRail
          cycle={cycle}
          isNow={cycleOffset === 0}
          items={chk.items.filter((i) => !skips.includes(i.id))}
          incomes={groups.income.map((ci): RailIncome => ({
            id: ci.id, label: ci.label || 'Income', amount: ci.expected_income, day: incomeDays[ci.id] ?? null,
          }))}
          onOpenItem={openItem}
          onOpenIncome={(id) => { const ci = data.cycleIncome.find((x) => x.id === id); if (ci) setEditIncome(ci) }}
          onAddIncome={() => setEditIncome('new')}
          onAddBill={() => setEditRecurring('new')}
        />

        {/* His correction, pointed straight at Plan: two real columns, the
            same shape as Plan's to-do list beside its day panel -- one
            persistent overview column, one column of stacked, actionable
            sections -- not a repeating grid of small paired-up cards. */}
        <div className="bills-cols">
        <div className="bills-leftcol">
        <div className="card bills-snapshot">
          <span className="overline">Monthly snapshot</span>
          {/* comingIn is income MINUS everything already paid, so this row read
              "Coming in −23 500 Kč" on a cycle whose salary was positive: what
              had gone out was hidden inside the one row that says money is
              arriving. The income stands on its own line now and what is paid
              gets its own, which is also the only way this column adds up to
              Left over on the page rather than only in the arithmetic. */}
          <div className="bs-row"><span className="bs-dot" style={{ background: 'var(--positive-subtle)', color: 'var(--positive)' }}>↙</span><span className="bs-lbl">Coming in</span><span className="bs-val pos">{money(free.income)}</span></div>
          {carryIn !== 0 && <div className="bs-row"><span className="bs-dot" style={{ background: 'var(--positive-subtle)', color: 'var(--positive)' }}>💼</span><span className="bs-lbl">From last cycle</span><span className={`bs-val ${carryIn >= 0 ? 'pos' : 'neg'}`}>{money(carryIn)}</span></div>}
          {free.paidTotal > 0 && <div className="bs-row"><span className="bs-dot" style={{ background: 'var(--bg-subtle)', color: 'var(--ink-2)' }}>✓</span><span className="bs-lbl">Already paid</span><span className="bs-val neg">−{money(free.paidTotal)}</span></div>}
          <div className="bs-row"><span className="bs-dot" style={{ background: 'var(--bg-subtle)', color: 'var(--ink-2)' }}>↻</span><span className="bs-lbl">Recurring bills ({stillDue.recurring})</span><span className={`bs-val ${free.recurringOut > 0 ? 'neg' : ''}`}>{free.recurringOut > 0 ? '−' : ''}{money(free.recurringOut)}</span></div>
          <div className="bs-row"><span className="bs-dot" style={{ background: 'var(--negative-subtle)', color: 'var(--negative)' }}>🏛</span><span className="bs-lbl">Debt payments ({stillDue.debt})</span><span className={`bs-val ${free.debtOut > 0 ? 'neg' : ''}`}>{free.debtOut > 0 ? '−' : ''}{money(free.debtOut)}</span></div>
          <div className="bs-row"><span className="bs-dot" style={{ background: 'var(--highlight-subtle)', color: 'var(--highlight)' }}>⚡</span><span className="bs-lbl">Unexpected this cycle ({stillDue.unexpected})</span><span className={`bs-val ${free.unexpectedOut > 0 ? 'neg' : ''}`}>{free.unexpectedOut > 0 ? '−' : ''}{money(free.unexpectedOut)}</span></div>
          <div className="bs-row"><span className="bs-dot" style={{ background: 'var(--negative-subtle)', color: 'var(--negative)' }}>🔥</span><span className="bs-lbl">Unreasonable ({stillDue.unreasonable})</span><span className={`bs-val ${free.unreasonableOut > 0 ? 'neg' : ''}`}>{free.unreasonableOut > 0 ? '−' : ''}{money(free.unreasonableOut)}</span></div>
          <div className="bills-leftover"><span className="l">Left over</span><span className={`v ${free.free < 0 ? 'is-neg' : ''}`}>{free.free < 0 ? '−' : ''}{money(Math.abs(free.free))}</span></div>
        </div>

        <div className="bills-debtcard">
          <div className="bd-top"><span className="overline">Debt freedom</span></div>
          <div className="bd-figure">{money(freedom.owed)}</div>
          <div className="bd-cap">{freedom.baseline > freedom.owed ? `still owed of ${money(freedom.baseline)}` : 'still owed'}</div>
          <div className="bd-right">
            <div className="bd-month">{freeView.freeDate ? freeView.freeDate.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '—'}</div>
            {/* Nothing entered is not 100% free. The card used to congratulate
                him for an empty table, full bar and all. */}
            <div className="bd-pct">{freedom.baseline > 0 ? `${Math.round(freedom.pct * 100)}% free · ${money(freedom.paid)} paid` : 'nothing entered yet'}</div>
          </div>
          <div className="bd-bar"><i style={{ width: `${freedom.baseline > 0 ? Math.max(2, Math.round(freedom.pct * 100)) : 0}%` }} /></div>
          {nextRelief && (
            <div className="bd-tip">{nextRelief.debtName} clears {nextRelief.date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}, freeing {money(nextRelief.freed)}/mo.</div>
          )}
          {/* A bare "—" where the free date goes says nothing. There is no date
              because something is not being paid down, and that is the fact
              worth reading. */}
          {freeView.stalled.length > 0 && (
            <div className="bd-warn">No date yet: {freeView.stalled.length === 1 ? 'one debt has' : `${freeView.stalled.length} debts have`} no payment plan.</div>
          )}

          {debtRows.length > 0 && (
            <div className="bd-list">
              {debtRows.map((v) => {
                const base = v.debt.original_amount ?? v.debt.principal_start
                const pct = Math.round(v.progress * 100)
                return (
                  <button key={v.debt.id} className="bd-row" onClick={() => setEditDebt(v.debt)}>
                    <span className="bd-rname"><span>{v.debt.name}</span><span className="bd-rkind">{DEBT_KIND_LABEL[v.debt.kind]}</span></span>
                    <span className="bd-ramt">{money(v.remaining)}</span>
                    <span className="bd-rbar"><i style={{ width: `${pct}%` }} /></span>
                    <span className="bd-rsub">
                      {pct > 0 ? `${pct}% of ${money(base)}` : `from ${money(base)}`}
                      {v.debt.monthly_payment > 0 ? ` · ${money(v.debt.monthly_payment)}/mo` : ' · no plan yet'}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          <div className="bd-acts">
            <button className="bills-add" onClick={() => setEditDebt('new')}>+ Add a debt</button>
            <button className="bills-add" onClick={() => setImportDebts(true)}>Paste a list</button>
          </div>
        </div>
        </div>

        <div className="bills-rightcol">
          <BillsSection title="Income" onManage={() => setManaging('income')}>
            {groups.income.length === 0 ? (
              <p className="bills-emptyrow">Income varies month to month, so set what you actually earn each cycle. Add each source (salary, side gig) as its own entry.</p>
            ) : groups.income.map((ci) => (
              <button key={ci.id} className="bills-irow" onClick={() => setEditIncome(ci)}>
                <span className="bi-circle">↙</span>
                <span className="bi-name">{ci.label || 'Income'}<span className="bi-sub">this cycle</span></span>
                <span className="bi-amt">{money(ci.expected_income)}</span>
                <span className="bi-pencil">✎</span>
              </button>
            ))}
          </BillsSection>

          {/* Debt payments used to be read-only here ("manage your debts from
              Compass directly for now") -- a deliberate first-pass scope cut,
              overruled on his instruction (2026-09-01): every section here
              needs the same edit path. */}
          <BillsSection title="Debt payments" sub={groups.debt.length ? `${money(free.debtOut)} left` : undefined} onManage={() => setManaging('debt')}>
            {groups.debt.length === 0 ? (
              <p className="bills-emptyrow">No debt payments due this cycle.</p>
            ) : groups.debt.map((i) => (
              <PayableRow key={i.id} item={i} skipped={skips.includes(i.id)} busy={busy}
                onPay={() => markPaid(i)} onUndo={() => undoPaid(i)} onSkip={() => toggleSkip(i.id)}
                onEdit={() => { const d = data.debts.find((x) => `debt:${x.id}` === i.id); if (d) setEditDebt(d) }} />
            ))}
          </BillsSection>

          <BillsSection title="Recurring bills" sub={groups.recurring.length ? `${money(free.recurringOut)} left` : undefined} onManage={() => setManaging('recurring')}>
            {groups.recurring.length === 0 ? (
              <p className="bills-emptyrow">No recurring bills yet. Tap "Bill" up top to add rent, subscriptions and anything you pay every month.</p>
            ) : groups.recurring.map((i) => (
              <PayableRow key={i.id} item={i} skipped={skips.includes(i.id)} busy={busy}
                onPay={() => markPaid(i)} onUndo={() => undoPaid(i)} onSkip={() => toggleSkip(i.id)}
                onEdit={() => { const r = data.recurring.find((x) => x.id === i.link.recurring_id); if (r) setEditRecurring(r) }} />
            ))}
          </BillsSection>

          <BillsSection title="Unexpected this cycle" sub={groups.unexpected.length ? `${money(free.unexpectedOut)} left` : undefined} onManage={() => setManaging('unexpected')}>
            {groups.unexpected.length === 0 ? (
              <p className="bills-emptyrow">One-off payments you know are coming this cycle (a repair, a gift, an annual fee). Add one and check it off when paid.</p>
            ) : groups.unexpected.map((i) => (
              <PayableRow key={i.id} item={i} skipped={skips.includes(i.id)} busy={busy}
                onPay={() => markPaid(i)} onUndo={() => undoPaid(i)} onSkip={() => toggleSkip(i.id)}
                onEdit={() => { const p = data.planned.find((x) => x.id === i.link.planned_id); if (p) setEditPlanned(p) }} />
            ))}
          </BillsSection>

          <BillsSection title="Unreasonable" sub={groups.unreasonable.length ? `${money(free.unreasonableOut)} left` : undefined} onManage={() => setManaging('unreasonable')}>
            {groups.unreasonable.length === 0 ? (
              <p className="bills-emptyrow">Impulse buys you didn't plan for. Log them as you go and they count against this cycle right away. Tap one to edit; tap the tag to mark it a regret. Never rolls into next cycle.</p>
            ) : groups.unreasonable.map((i) => (
              <div key={i.id} className="bills-prow">
                <button className="bills-prowmain" onClick={() => { const p = data.planned.find((x) => x.id === i.link.planned_id); if (p) setEditUnreasonable(p) }}>
                  <span className="bp-name">{i.name}</span>
                </button>
                <span className="bp-amt">{money(i.amount)}</span>
                <button className={`bills-tagchip ${i.tag === 'regret' ? 'is-regret' : 'is-needed'}`}
                  onClick={() => { const p = data.planned.find((x) => x.id === i.link.planned_id); if (p) void toggleTag(p) }}>
                  {i.tag === 'regret' ? 'Regret' : 'Needed'}
                </button>
              </div>
            ))}
          </BillsSection>
        </div>
        </div>
      </div>

      {editRecurring && <RecurringSheet item={editRecurring === 'new' ? null : editRecurring} onClose={() => setEditRecurring(null)} onSaved={reload} />}
      {editPlanned && <PlannedSheet item={editPlanned === 'new' ? null : editPlanned} cycleKey={cycle.key} onClose={() => setEditPlanned(null)} onSaved={reload} />}
      {editUnreasonable && <UnreasonableSheet item={editUnreasonable === 'new' ? null : editUnreasonable} cycleKey={cycle.key} onClose={() => setEditUnreasonable(null)} onSaved={reload} />}
      {editIncome && <IncomeSheet item={editIncome === 'new' ? null : editIncome} cycle={cycle}
        settings={(data.profile?.settings ?? {}) as Record<string, unknown>}
        onClose={() => setEditIncome(null)} onSaved={reload} />}
      {editDebt && <DebtSheet item={editDebt === 'new' ? null : editDebt} onClose={() => setEditDebt(null)} onSaved={reload} />}
      {importDebts && <DebtImportSheet existing={data.debts} onClose={() => setImportDebts(false)} onSaved={reload} />}

      {managing === 'income' && (
        <ManageSheet title="Income" addLabel="+ Add income"
          onAddNew={() => { setManaging(null); setEditIncome('new') }} onClose={() => setManaging(null)}
          rows={groups.income.map((ci) => ({
            id: ci.id, name: ci.label || 'Income', sub: 'this cycle', amount: money(ci.expected_income),
            onEdit: () => { setManaging(null); setEditIncome(ci) },
          }))} />
      )}
      {managing === 'recurring' && (
        <ManageSheet title="Recurring bills" addLabel="+ Add a bill"
          onAddNew={() => { setManaging(null); setEditRecurring('new') }} onClose={() => setManaging(null)}
          rows={data.recurring.filter((r) => r.is_active).map((r) => ({
            id: r.id, name: r.name, sub: r.cadence, amount: money(r.amount),
            onEdit: () => { setManaging(null); setEditRecurring(r) },
          }))} />
      )}
      {managing === 'debt' && (
        <ManageSheet title="Debts" addLabel="+ Add a debt"
          onAddNew={() => { setManaging(null); setEditDebt('new') }} onClose={() => setManaging(null)}
          rows={data.debts.map((d) => ({
            id: d.id, name: d.name, sub: d.creditor ?? undefined, amount: `${money(d.monthly_payment)}/mo`,
            onEdit: () => { setManaging(null); setEditDebt(d) },
          }))} />
      )}
      {managing === 'unexpected' && (
        <ManageSheet title="Unexpected this cycle" addLabel="+ Add a one-off"
          onAddNew={() => { setManaging(null); setEditPlanned('new') }} onClose={() => setManaging(null)}
          rows={groups.unexpected.map((i) => ({
            id: i.id, name: i.name, sub: i.dueOn ? relativeDay(i.dueOn) : undefined, amount: money(i.amount),
            onEdit: () => { const p = data.planned.find((x) => x.id === i.link.planned_id); if (p) { setManaging(null); setEditPlanned(p) } },
          }))} />
      )}
      {managing === 'unreasonable' && (
        <ManageSheet title="Unreasonable" addLabel="+ Log one"
          onAddNew={() => { setManaging(null); setEditUnreasonable('new') }} onClose={() => setManaging(null)}
          rows={groups.unreasonable.map((i) => ({
            id: i.id, name: i.name, sub: i.tag === 'regret' ? 'Regret' : 'Needed', amount: money(i.amount),
            onEdit: () => { const p = data.planned.find((x) => x.id === i.link.planned_id); if (p) { setManaging(null); setEditUnreasonable(p) } },
          }))} />
      )}

      {ending && (
        <Sheet title={`End this cycle and move to ${cycleForKey(addMonthsToKey(activeCycleKey(data.profile), 1)).label}?`} onClose={() => setEnding(false)}>
          <EndCycleForm suggested={free.free} busy={busy} onCancel={() => setEnding(false)} onConfirm={(v) => { setBusy(true); void endCycle(v).finally(() => { setBusy(false); setEnding(false) }) }} />
        </Sheet>
      )}
    </div>
  )
}

function BillsSignIn() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const send = async () => {
    setBusy(true); setErr(null)
    const e = await sendSignInCode(email)
    setBusy(false)
    if (e) setErr(e); else setSent(true)
  }
  const verify = async () => {
    setBusy(true); setErr(null)
    const e = await signInWithCode(email, code)
    setBusy(false)
    if (e) setErr(e)
    // onAccountChange fires the page into its signed-in state on success.
  }
  return (
    <div className="bills-signin">
      <h1>Bills</h1>
      <p>Sign in with the same account Compass uses. It's the same data.</p>
      {!sent ? (
        <>
          <input className="textinput" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn btn-primary" disabled={!email.includes('@') || busy} onClick={() => void send()}>{busy ? 'Sending…' : 'Email me a code'}</button>
        </>
      ) : (
        <>
          <input className="textinput mono" inputMode="numeric" placeholder="the code" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn btn-primary" disabled={code.trim().length < 6 || busy} onClick={() => void verify()}>{busy ? 'Checking…' : 'Sign in'}</button>
        </>
      )}
      {err && <p className="bills-signin-err">{err}</p>}
    </div>
  )
}

function BillsSection({ title, sub, onManage, children }: { title: string; sub?: string; onManage?: () => void; children: React.ReactNode }) {
  return (
    <div className="bills-section">
      <div className="bills-shead">
        <span className="t"><span className="overline">{title}</span>{sub && <span className="bills-sub">{sub}</span>}</span>
        {onManage && <button className="bills-add" onClick={onManage}>✎ Edit</button>}
      </div>
      <div className="card bills-card">{children}</div>
    </div>
  )
}

/* One "Edit" button per section opens this instead of jumping straight to
   an add form, on his instruction (2026-09-01): a single entry point that
   lists everything already in the section, edits any one of them, and adds
   a new one, rather than a shortcut that only ever added. Rows here reuse
   whatever single-item sheet the section already had (RecurringSheet,
   PlannedSheet, IncomeSheet, DebtSheet) for the actual edit/add/delete
   work -- this is a picker in front of them, not a second editor. */
function ManageSheet({ title, rows, addLabel, onAddNew, onClose }: {
  title: string
  rows: { id: string; name: string; sub?: string; amount: string; onEdit: () => void }[]
  addLabel: string
  onAddNew: () => void
  onClose: () => void
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="bills-managelist">
        {rows.length === 0 && <p className="bills-emptyrow">Nothing here yet.</p>}
        {rows.map((r) => (
          <button key={r.id} className="bills-manage-row" onClick={r.onEdit}>
            <span className="bi-name">{r.name}{r.sub && <span className="bi-sub">{r.sub}</span>}</span>
            <span className="bi-amt">{r.amount}</span>
            <span className="bi-pencil">✎</span>
          </button>
        ))}
        <button className="btn btn-secondary bills-manage-addnew" onClick={onAddNew}>{addLabel}</button>
      </div>
    </Sheet>
  )
}

function PayableRow({ item, skipped, busy, onPay, onUndo, onSkip, onEdit }: {
  item: CycleItem; skipped: boolean; busy: boolean
  onPay: () => void; onUndo: () => void; onSkip: () => void; onEdit: () => void
}) {
  const status = item.paid ? 'Paid' : skipped ? 'Skipped' : item.overdue ? 'Overdue' : item.dueOn ? relativeDay(item.dueOn) : 'this cycle'
  return (
    <div className={`bills-prow${item.paid || skipped ? ' is-done' : ''}`}>
      <button className="bills-prowmain" onClick={onEdit}>
        <span className="bp-name">{item.name}</span>
        <span className={`bp-status${item.overdue ? ' is-overdue' : ''}`}>{status}</span>
      </button>
      <span className="bp-amt">{money(item.amount)}</span>
      <div className="bp-btns">
        {item.paid ? (
          <button className="bp-rbtn is-paid" disabled={busy} onClick={onUndo} title="Undo">✓</button>
        ) : skipped ? (
          <button className="bp-rbtn is-skipped" disabled={busy} onClick={onSkip} title="Bring back">✕</button>
        ) : (
          <>
            <button className="bp-rbtn is-skip" disabled={busy} onClick={onSkip} title="Skip">✕</button>
            <button className="bp-rbtn is-pay" disabled={busy} onClick={onPay} title="Mark paid">✓</button>
          </>
        )}
      </div>
    </div>
  )
}

/* ---------------- sheets ---------------- */

function RecurringSheet({ item, onClose, onSaved }: { item: CompassRecurring | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(item?.name ?? '')
  const [amount, setAmount] = useState(item ? String(item.amount) : '')
  const [cadence, setCadence] = useState<'monthly' | 'weekly' | 'yearly'>(item?.cadence ?? 'monthly')
  const [day, setDay] = useState(item?.day_of_month ? String(item.day_of_month) : '1')
  const [priority, setPriority] = useState<'mandatory' | 'optional'>(item?.priority ?? 'mandatory')
  const [busy, setBusy] = useState(false)
  const valid = name.trim().length > 0 && Number(amount) > 0
  const save = async () => {
    setBusy(true)
    const patch = {
      name: name.trim(), amount: Number(amount), kind: 'expense', cadence, priority,
      day_of_month: cadence === 'weekly' ? null : Math.min(31, Math.max(1, Number(day) || 1)),
      start_on: item?.start_on ?? todayISO(), is_active: true,
    }
    try {
      if (item) await updateRow('compass_recurring', item.id, patch)
      else await insertRow('compass_recurring', patch)
      onSaved(); onClose()
    } finally { setBusy(false) }
  }
  const del = async () => {
    if (!item) return
    setBusy(true)
    try { await updateRow('compass_recurring', item.id, { is_active: false }); onSaved(); onClose() } finally { setBusy(false) }
  }
  return (
    <Sheet title={item ? 'Edit bill' : 'Add a bill'} onClose={onClose}>
      <div className="bills-form">
        <label>Name<input className="textinput" value={name} onChange={(e) => setName(e.target.value)} placeholder="Rent, phone plan…" autoFocus /></label>
        <label>Amount you commit to<input className="textinput" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" /></label>
        <Segmented label="Repeats" value={cadence} onPick={setCadence} options={[{ id: 'weekly', label: 'Weekly' }, { id: 'monthly', label: 'Monthly' }, { id: 'yearly', label: 'Yearly' }]} />
        {cadence !== 'weekly' && <label>Day of month<input className="textinput" type="number" min={1} max={31} value={day} onChange={(e) => setDay(e.target.value)} /></label>}
        <Segmented label="Priority" value={priority} onPick={setPriority} options={[{ id: 'mandatory', label: 'Must pay' }, { id: 'optional', label: 'Optional' }]} />
        <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void save()}>{item ? 'Save changes' : 'Add'}</button>
        {item && <button className="bills-delete" disabled={busy} onClick={() => void del()}>🗑 Delete this bill</button>}
      </div>
    </Sheet>
  )
}

function PlannedSheet({ item, cycleKey, onClose, onSaved }: { item: CompassPlanned | null; cycleKey: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(item?.name ?? '')
  const [amount, setAmount] = useState(item ? String(item.amount) : '')
  const [priority, setPriority] = useState<'mandatory' | 'optional'>(item?.priority ?? 'mandatory')
  const [dueOn, setDueOn] = useState(item?.due_on ?? todayISO())
  const [busy, setBusy] = useState(false)
  const valid = name.trim().length > 0 && Number(amount) > 0
  const save = async () => {
    setBusy(true)
    const patch = { name: name.trim(), amount: Number(amount), kind: 'expense', priority, due_on: dueOn, cycle_start: `${cycleKey}-01` }
    try {
      if (item) await updateRow('compass_planned', item.id, patch)
      else await insertRow('compass_planned', patch)
      onSaved(); onClose()
    } finally { setBusy(false) }
  }
  const del = async () => {
    if (!item) return
    setBusy(true)
    try { await deleteRow('compass_planned', item.id); onSaved(); onClose() } finally { setBusy(false) }
  }
  return (
    <Sheet title={item ? 'Edit one-off' : 'Add a one-off'} onClose={onClose}>
      <div className="bills-form">
        <label>What is it?<input className="textinput" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <label>Amount<input className="textinput" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <Segmented label="Priority" value={priority} onPick={setPriority} options={[{ id: 'mandatory', label: 'Must pay' }, { id: 'optional', label: 'Optional' }]} />
        <label>When is it due?<input className="textinput" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></label>
        <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void save()}>{item ? 'Save' : 'Add'}</button>
        {item && <button className="bills-delete" disabled={busy} onClick={() => void del()}>🗑 Delete</button>}
      </div>
    </Sheet>
  )
}

function UnreasonableSheet({ item, cycleKey, onClose, onSaved }: { item: CompassPlanned | null; cycleKey: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(item?.name ?? '')
  const [amount, setAmount] = useState(item ? String(item.amount) : '')
  const [tag, setTag] = useState<'functional' | 'regret'>(item?.tag ?? 'functional')
  const [busy, setBusy] = useState(false)
  const valid = name.trim().length > 0 && Number(amount) > 0
  const save = async () => {
    setBusy(true)
    const patch = { name: name.trim(), amount: Number(amount), kind: 'expense', priority: 'optional', due_on: null, cycle_start: `${cycleKey}-01`, tag }
    try {
      if (item) await updateRow('compass_planned', item.id, patch)
      else await insertRow('compass_planned', patch)
      onSaved(); onClose()
    } finally { setBusy(false) }
  }
  const del = async () => {
    if (!item) return
    setBusy(true)
    try { await deleteRow('compass_planned', item.id); onSaved(); onClose() } finally { setBusy(false) }
  }
  return (
    <Sheet title={item ? 'Edit expense' : 'Unreasonable expense'} onClose={onClose}>
      <div className="bills-form">
        <label>What was it?<input className="textinput" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <label>Amount<input className="textinput" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <Segmented label="Tag" value={tag} onPick={setTag} options={[{ id: 'functional', label: 'Needed it' }, { id: 'regret', label: 'Regret' }]} />
        <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void save()}>{item ? 'Save' : 'Add'}</button>
        {item && <button className="bills-delete" disabled={busy} onClick={() => void del()}>🗑 Delete</button>}
      </div>
    </Sheet>
  )
}

function IncomeSheet({ item, cycle, settings, onClose, onSaved }: {
  item: CompassCycleIncome | null; cycle: { start: Date }
  settings: Record<string, unknown>; onClose: () => void; onSaved: () => void
}) {
  const [label, setLabel] = useState(item?.label ?? '')
  const [amount, setAmount] = useState(item ? String(item.expected_income) : '')
  const days = (settings.income_day as Record<string, number> | undefined) ?? {}
  const [day, setDay] = useState(item && days[item.id] ? String(days[item.id]) : '')
  const [busy, setBusy] = useState(false)
  const valid = Number(amount) > 0
  const save = async () => {
    setBusy(true)
    const patch = { label: label.trim() || null, expected_income: Number(amount), cycle_start: iso(cycle.start) }
    try {
      const row = item
        ? (await updateRow<CompassCycleIncome>('compass_cycle_income', item.id, patch))
        : (await insertRow<CompassCycleIncome>('compass_cycle_income', patch))
      /* The day is not a column on this table, so it goes in the profile blob
         beside skips and carryover, keyed by the row it belongs to. Written
         only when it actually changed: this upsert touches the whole settings
         object and two sessions saving at once would otherwise trade blanks. */
      const id = row?.id ?? item?.id
      const want = Number(day)
      const has = id ? days[id] : undefined
      const next = Number.isFinite(want) && want >= 1 && want <= 31 ? Math.round(want) : undefined
      if (id && next !== has) {
        const map = { ...days }
        if (next === undefined) delete map[id]; else map[id] = next
        await upsertCompassProfile(settings, { settings: { income_day: map } })
      }
      onSaved(); onClose()
    } finally { setBusy(false) }
  }
  const del = async () => {
    if (!item) return
    setBusy(true)
    try { await deleteRow('compass_cycle_income', item.id); onSaved(); onClose() } finally { setBusy(false) }
  }
  return (
    <Sheet title={item ? 'Edit income' : 'Add income'} onClose={onClose}>
      <div className="bills-form">
        <label>Name<input className="textinput" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Salary, side gig…" autoFocus /></label>
        <label>Amount<input className="textinput" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label>Day it lands
          <select className="textinput" value={day} onChange={(e) => setDay(e.target.value)}>
            <option value="">Not set</option>
            {Array.from({ length: 31 }, (_, n) => n + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="bills-hint">Puts it on the timeline. Left unset, it sits in "any time this cycle" rather than being placed on a day it might not arrive.</span>
        </label>
        <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void save()}>{item ? 'Save' : 'Add income'}</button>
        {item && <button className="bills-delete" disabled={busy} onClick={() => void del()}>🗑 Delete</button>}
      </div>
    </Sheet>
  )
}

const DEBT_KIND_LABEL: Record<DebtKind, string> = { structured: 'Loan', unstructured: 'Overdue', personal: 'Personal', tax: 'Tax' }

/* Mirrors Compass's own DebtForm (src/pages/Debts.tsx) field for field and
   validation for validation, on his instruction to make debts editable here
   too (2026-09-01) -- this writes to the same compass_debts table Compass's
   own payoff math reads, so the payload shape matches exactly rather than
   guessing at one. The remaining balance itself is never a field: it's
   principal_start minus every debt_payment transaction since, computed
   elsewhere (compassCalc's debtView) -- editing it directly here would
   silently disagree with that math the next time a payment posts. */
function DebtSheet({ item, onClose, onSaved }: { item: CompassDebt | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(item?.name ?? '')
  const [creditor, setCreditor] = useState(item?.creditor ?? '')
  const [kind, setKind] = useState<DebtKind>(item?.kind ?? 'structured')
  const [principal, setPrincipal] = useState(item ? String(item.principal_start) : '')
  const [baseline, setBaseline] = useState(item ? String(item.original_amount ?? item.principal_start) : '')
  const [monthly, setMonthly] = useState(item ? String(item.monthly_payment) : '')
  const [rate, setRate] = useState(item ? String(item.interest_rate) : '')
  const [dueDay, setDueDay] = useState(item?.due_day != null ? String(item.due_day) : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const principalNum = Number(principal.replace(',', '.')) || 0
  const monthlyNum = Number(monthly.replace(',', '.')) || 0
  const baselineNum = Number(baseline.replace(',', '.')) || 0
  /* A monthly payment used to be required. Half of what he owes has no payment
     plan agreed yet -- that is the actual situation, and refusing to record it
     was the reason those debts were missing from the card entirely. A debt with
     no payment reads as "no plan yet" and is left out of the free date. */
  const valid = name.trim().length > 0 && principalNum > 0
  const save = async () => {
    if (!name.trim()) { setErr('Give the debt a name'); return }
    if (principalNum <= 0) { setErr('Balance owed must be greater than 0'); return }
    setErr(null); setBusy(true)
    const dayParsed = Number(dueDay)
    const patch = {
      name: name.trim(), creditor: creditor.trim() || null, kind,
      principal_start: principalNum, monthly_payment: monthlyNum,
      // A baseline under the balance would read as negative progress, so an
      // empty or nonsense figure falls back to the balance.
      original_amount: baselineNum >= principalNum ? baselineNum : principalNum,
      interest_rate: Number(rate.replace(',', '.')) || 0,
      due_day: dueDay && Number.isFinite(dayParsed) ? Math.min(31, Math.max(1, dayParsed)) : null,
    }
    try {
      if (item) await updateRow('compass_debts', item.id, patch)
      else await insertRow('compass_debts', { ...patch, start_on: todayISO(), status: 'active' })
      onSaved(); onClose()
    } finally { setBusy(false) }
  }
  const del = async () => {
    if (!item) return
    setBusy(true)
    try { await deleteRow('compass_debts', item.id); onSaved(); onClose() } finally { setBusy(false) }
  }
  return (
    <Sheet title={item ? 'Edit debt' : 'Add a debt'} onClose={onClose}>
      <div className="bills-form">
        <label>Name<input className="textinput" value={name} onChange={(e) => setName(e.target.value)} placeholder="Credit card…" autoFocus /></label>
        <label>Lender<input className="textinput" value={creditor} onChange={(e) => setCreditor(e.target.value)} placeholder="Bank…" /></label>
        <Segmented label="Type" value={kind} onPick={setKind} options={(Object.keys(DEBT_KIND_LABEL) as DebtKind[]).map((k) => ({ id: k, label: DEBT_KIND_LABEL[k] }))} />
        <label>Balance owed<input className="textinput" type="number" value={principal} onChange={(e) => setPrincipal(e.target.value)} placeholder="0" /></label>
        <label>Started at
          <input className="textinput" type="number" value={baseline} onChange={(e) => setBaseline(e.target.value)} placeholder={principal || 'same as the balance'} />
          <span className="bills-hint">What it was before you paid anything. Every "% free" on this card is measured from here. Leave it matching the balance to start counting from today.</span>
        </label>
        <label>Monthly payment (leave 0 if there is no plan yet)<input className="textinput" type="number" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="0" /></label>
        <label>Day of month it's due (optional)<input className="textinput" type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(e.target.value)} /></label>
        <label>Interest % per year (optional)<input className="textinput" type="number" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0" /></label>
        {err && <p className="bills-signin-err">{err}</p>}
        <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void save()}>{item ? 'Save changes' : 'Add debt'}</button>
        {item && <button className="bills-delete" disabled={busy} onClick={() => void del()}>🗑 Delete this debt</button>}
      </div>
    </Sheet>
  )
}

/* Eight creditors, one paste. Each line is "name then amount"; a name already
   on the account updates that debt rather than adding a second one with the
   same name, which is what typing them in one at a time kept producing.

   It writes principal_start AND original_amount, because the whole "% free"
   figure is measured from original_amount and there was no way to set it. It
   also moves start_on to today: the pasted figure is what is owed now, so
   counting older payments against it again would show progress twice. */
function DebtImportSheet({ existing, onClose, onSaved }: { existing: CompassDebt[]; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState('')
  const [kinds, setKinds] = useState<Record<number, DebtKind>>({})
  const [skipped, setSkipped] = useState<Record<number, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  /* A paste is typed by hand, so case and stray spacing must not be what
     decides between updating a debt and creating a duplicate. */
  const byName = useMemo(() => {
    const m = new Map<string, CompassDebt>()
    for (const d of existing) if (d.status === 'active') m.set(d.name.toLowerCase().replace(/\s+/g, ' ').trim(), d)
    return m
  }, [existing])

  const rows = useMemo(() => parseDebtLines(text).map((r, i) => {
    const match = byName.get(r.name.toLowerCase().replace(/\s+/g, ' ').trim()) ?? null
    return { ...r, match, kind: kinds[i] ?? match?.kind ?? 'unstructured', skip: skipped[i] ?? false, i }
  }), [text, byName, kinds, skipped])

  const usable = rows.filter((r) => r.amount !== null && !r.skip)
  const total = usable.reduce((sum, r) => sum + (r.amount ?? 0), 0)
  const unreadable = rows.filter((r) => r.amount === null).length

  const save = async () => {
    if (!usable.length) return
    setErr(null); setBusy(true)
    try {
      for (const r of usable) {
        const amount = r.amount as number
        if (r.match) {
          await updateRow('compass_debts', r.match.id, {
            principal_start: amount, original_amount: amount, kind: r.kind, start_on: todayISO(),
          })
        } else {
          await insertRow('compass_debts', {
            name: r.name, creditor: null, kind: r.kind,
            principal_start: amount, original_amount: amount,
            monthly_payment: 0, interest_rate: 0, due_day: null,
            start_on: todayISO(), status: 'active',
          })
        }
      }
      onSaved(); onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save. Check your connection and try again.')
    } finally { setBusy(false) }
  }

  return (
    <Sheet title="Paste your debts" onClose={onClose}>
      <div className="bills-form">
        <p>One debt per line, name then amount. This sets the balance and the baseline every "% free" is measured from, counting from today. Monthly payments stay at zero until you set them.</p>
        <textarea
          className="textinput bd-imp-text" rows={7} spellCheck={false} autoFocus
          value={text} onChange={(e) => setText(e.target.value)}
          placeholder={'Credit card: 45 000 Kč\nCar loan: 120 000\nBrother — 20 000'}
        />
        {rows.length > 0 && (
          <div className="bd-imp">
            <div className="bd-imp-head"><span className="overline">What will be saved</span><span className="bd-imp-count">{usable.length} of {rows.length}</span></div>
            {rows.map((r) => (
              <div key={`${r.raw}-${r.i}`} className={`bd-imp-row${r.amount === null || r.skip ? ' is-off' : ''}`}>
                <span className="bd-imp-name">{r.name}<span className="bd-imp-sub">{r.amount === null ? 'no amount on this line' : r.match ? `updates ${r.match.name}` : 'new debt'}</span></span>
                {r.amount !== null && (
                  <>
                    <select className="bd-imp-kind" aria-label={`Type for ${r.name}`} value={r.kind}
                      onChange={(e) => setKinds((k) => ({ ...k, [r.i]: e.target.value as DebtKind }))}>
                      {(Object.keys(DEBT_KIND_LABEL) as DebtKind[]).map((k) => <option key={k} value={k}>{DEBT_KIND_LABEL[k]}</option>)}
                    </select>
                    <span className="bd-imp-amt">{money(r.amount)}</span>
                    <button className="bd-imp-skip" onClick={() => setSkipped((x) => ({ ...x, [r.i]: !r.skip }))}>{r.skip ? 'Undo' : 'Skip'}</button>
                  </>
                )}
              </div>
            ))}
            {unreadable > 0 && <p className="bd-imp-warn">{unreadable} line{unreadable === 1 ? '' : 's'} had no readable amount and will be left out.</p>}
            <div className="bd-imp-total"><span className="overline">Baseline total</span><span className="v">{money(total)}</span></div>
          </div>
        )}
        {err && <p className="bills-signin-err">{err}</p>}
        <button className="btn btn-primary" disabled={!usable.length || busy} onClick={() => void save()}>
          {busy ? 'Saving…' : `Save ${usable.length || ''} debt${usable.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </Sheet>
  )
}

function EndCycleForm({ suggested, busy, onCancel, onConfirm }: { suggested: number; busy: boolean; onCancel: () => void; onConfirm: (v: number) => void }) {
  const [v, setV] = useState(String(Math.round(suggested)))
  return (
    <div className="bills-form">
      <p>How much money do you actually have left? It rolls into the next cycle as a "From last cycle" line. Anything still unpaid carries over as overdue. Nothing is deleted.</p>
      <label>Money left right now<input className="textinput" type="number" value={v} onChange={(e) => setV(e.target.value)} /></label>
      <div className="bills-endrow">
        <button className="btn btn-secondary" onClick={onCancel}>Not yet</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => onConfirm(Number(v) || 0)}>{busy ? 'Ending…' : 'End cycle'}</button>
      </div>
    </div>
  )
}
