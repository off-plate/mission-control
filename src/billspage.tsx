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
import { useEffect, useMemo, useState } from 'react'
import { Sheet } from './modals'
import { Band, Segmented } from './ui'
import {
  currentAccount, deleteRow, insertRow, onAccountChange, readRows, sendSignInCode, signInWithCode,
  updateRow, upsertCompassProfile, SUPABASE_ENABLED,
} from './supabase'
import {
  activeCycleKey, addMonthsToKey, cycleChecklist, cycleFree, cycleForKey, debtFreeView, debtFreedom, debtRunway,
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
   that already talks to Supabase correctly rather than re-deriving it. */
export function useCompassAccount() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    void currentAccount().then((a) => { if (alive) setSignedIn(!!a) })
    const off = onAccountChange((a) => setSignedIn(!!a))
    return () => { alive = false; off() }
  }, [])
  return signedIn
}

export function useBillsData(signedIn: boolean | null) {
  const [data, setData] = useState<BillsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const reload = () => setReloadTick((n) => n + 1)

  useEffect(() => {
    if (!signedIn) { setData(null); return }
    let alive = true
    setError(null)
    Promise.all([
      readRows<CompassProfile>('compass_profile', '*'),
      readRows<CompassDebt>('compass_debts', '*'),
      readRows<CompassRecurring>('compass_recurring', '*'),
      readRows<CompassTransaction>('compass_transactions', '*'),
      readRows<CompassPlanned>('compass_planned', '*'),
      readRows<CompassCycleIncome>('compass_cycle_income', '*'),
    ]).then(([profileRows, debts, recurring, transactions, planned, cycleIncome]) => {
      if (!alive) return
      setData({
        profile: profileRows?.[0] ?? null,
        debts: debts ?? [], recurring: recurring ?? [], transactions: transactions ?? [],
        planned: planned ?? [], cycleIncome: cycleIncome ?? [],
      })
    }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [signedIn, reloadTick])

  return { data, error, reload }
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

  const income = data ? resolveCycleIncome(cycle, data.cycleIncome).amount : 0
  const chk = data ? cycleChecklist(data.recurring, data.planned, data.debts, data.transactions, cycle, income, dismissed) : null
  const free = data ? cycleFree(data.recurring, data.planned, data.debts, data.transactions, cycle, income, skips, dismissed, carryIn) : null
  const freedom = data ? debtFreedom(data.debts, data.transactions) : null
  const freeView = data ? debtFreeView(data.debts, data.transactions) : null
  const runway = data ? debtRunway(data.debts, data.transactions) : null
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
  if (!data || !chk || !free || !freedom || !freeView || !groups) return <div className="page bills-page" />

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

        <div className="bills-quick">
          <button className="bq-in" onClick={() => setEditIncome('new')}>+ Income</button>
          <button className="bq-out" onClick={() => setEditRecurring('new')}>+ Bill</button>
        </div>

        {/* His correction, pointed straight at Plan: two real columns, the
            same shape as Plan's to-do list beside its day panel -- one
            persistent overview column, one column of stacked, actionable
            sections -- not a repeating grid of small paired-up cards. */}
        <div className="bills-cols">
        <div className="bills-leftcol">
        <div className="card bills-snapshot">
          <span className="overline">Monthly snapshot</span>
          <div className="bs-row"><span className="bs-dot" style={{ background: 'var(--positive-subtle)', color: 'var(--positive)' }}>↙</span><span className="bs-lbl">Coming in</span><span className="bs-val pos">{money(free.comingIn)}</span></div>
          {carryIn !== 0 && <div className="bs-row"><span className="bs-dot" style={{ background: 'var(--positive-subtle)', color: 'var(--positive)' }}>💼</span><span className="bs-lbl">From last cycle</span><span className={`bs-val ${carryIn >= 0 ? 'pos' : 'neg'}`}>{money(carryIn)}</span></div>}
          <div className="bs-row"><span className="bs-dot" style={{ background: 'var(--bg-subtle)', color: 'var(--ink-2)' }}>↻</span><span className="bs-lbl">Recurring bills ({groups.recurring.length})</span><span className="bs-val neg">−{money(free.recurringOut)}</span></div>
          <div className="bs-row"><span className="bs-dot" style={{ background: 'var(--negative-subtle)', color: 'var(--negative)' }}>🏛</span><span className="bs-lbl">Debt payments ({groups.debt.length})</span><span className="bs-val neg">−{money(free.debtOut)}</span></div>
          <div className="bs-row"><span className="bs-dot" style={{ background: 'var(--highlight-subtle)', color: 'var(--highlight)' }}>⚡</span><span className="bs-lbl">Unexpected this cycle ({groups.unexpected.length})</span><span className="bs-val neg">−{money(free.unexpectedOut)}</span></div>
          <div className="bs-row"><span className="bs-dot" style={{ background: 'var(--negative-subtle)', color: 'var(--negative)' }}>🔥</span><span className="bs-lbl">Unreasonable ({groups.unreasonable.length})</span><span className="bs-val neg">−{money(free.unreasonableOut)}</span></div>
          <div className="bills-leftover"><span className="l">Left over</span><span className={`v ${free.free < 0 ? 'is-neg' : ''}`}>{money(free.free)}</span></div>
        </div>

        <div className="bills-debtcard">
          <div className="bd-top"><span className="overline">Debt freedom</span></div>
          <div className="bd-figure">{money(freedom.owed)}</div>
          <div className="bd-cap">still owed</div>
          <div className="bd-right">
            <div className="bd-month">{freeView.freeDate ? freeView.freeDate.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '—'}</div>
            <div className="bd-pct">{Math.round(freedom.pct * 100)}% free · {money(freedom.paid)} paid</div>
          </div>
          <div className="bd-bar"><i style={{ width: `${Math.max(2, Math.round(freedom.pct * 100))}%` }} /></div>
          {nextRelief && (
            <div className="bd-tip">{nextRelief.debtName} clears {nextRelief.date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}, freeing {money(nextRelief.freed)}/mo.</div>
          )}
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
      {editIncome && <IncomeSheet item={editIncome === 'new' ? null : editIncome} cycle={cycle} onClose={() => setEditIncome(null)} onSaved={reload} />}
      {editDebt && <DebtSheet item={editDebt === 'new' ? null : editDebt} onClose={() => setEditDebt(null)} onSaved={reload} />}

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
      <p>Sign in with the same account Compass uses — it's the same data.</p>
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

function IncomeSheet({ item, cycle, onClose, onSaved }: { item: CompassCycleIncome | null; cycle: { start: Date }; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState(item?.label ?? '')
  const [amount, setAmount] = useState(item ? String(item.expected_income) : '')
  const [busy, setBusy] = useState(false)
  const valid = Number(amount) > 0
  const save = async () => {
    setBusy(true)
    const patch = { label: label.trim() || null, expected_income: Number(amount), cycle_start: iso(cycle.start) }
    try {
      if (item) await updateRow('compass_cycle_income', item.id, patch)
      else await insertRow('compass_cycle_income', patch)
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
  const [monthly, setMonthly] = useState(item ? String(item.monthly_payment) : '')
  const [rate, setRate] = useState(item ? String(item.interest_rate) : '')
  const [dueDay, setDueDay] = useState(item?.due_day != null ? String(item.due_day) : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const principalNum = Number(principal.replace(',', '.')) || 0
  const monthlyNum = Number(monthly.replace(',', '.')) || 0
  const valid = name.trim().length > 0 && principalNum > 0 && monthlyNum > 0
  const save = async () => {
    if (!name.trim()) { setErr('Give the debt a name'); return }
    if (principalNum <= 0) { setErr('Balance owed must be greater than 0'); return }
    if (monthlyNum <= 0) { setErr('Set a monthly payment so it has a payoff date'); return }
    setErr(null); setBusy(true)
    const dayParsed = Number(dueDay)
    const patch = {
      name: name.trim(), creditor: creditor.trim() || null, kind,
      principal_start: principalNum, monthly_payment: monthlyNum,
      interest_rate: Number(rate.replace(',', '.')) || 0,
      due_day: dueDay && Number.isFinite(dayParsed) ? Math.min(31, Math.max(1, dayParsed)) : null,
    }
    try {
      if (item) await updateRow('compass_debts', item.id, patch)
      else await insertRow('compass_debts', { ...patch, original_amount: patch.principal_start, start_on: todayISO(), status: 'active' })
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
        <label>Monthly payment<input className="textinput" type="number" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="0" /></label>
        <label>Day of month it's due (optional)<input className="textinput" type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(e.target.value)} /></label>
        <label>Interest % per year (optional)<input className="textinput" type="number" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0" /></label>
        {err && <p className="bills-signin-err">{err}</p>}
        <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void save()}>{item ? 'Save changes' : 'Add debt'}</button>
        {item && <button className="bills-delete" disabled={busy} onClick={() => void del()}>🗑 Delete this debt</button>}
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
