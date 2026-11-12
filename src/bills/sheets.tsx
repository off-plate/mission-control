import { useMemo, useState } from 'react'
import { Sheet } from '../modals'
import { parseDebtLines } from '../debtimport'
import { Segmented } from '../ui'
import { deleteRow, insertRow, updateRow, upsertCompassProfile } from '../supabase'
import {
    iso, todayISO,
    type CompassCycleIncome, type CompassDebt, type CompassPlanned, type CompassRecurring, type DebtKind
} from '../compassCalc'
import { DEBT_KIND_LABEL, money } from './shared'

/* ---------------- sheets ---------------- */

export function RecurringSheet({ item, onClose, onSaved }: { item: CompassRecurring | null; onClose: () => void; onSaved: () => void }) {
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

export function PlannedSheet({ item, cycleStart, onClose, onSaved }: { item: CompassPlanned | null; cycleStart: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(item?.name ?? '')
  const [amount, setAmount] = useState(item ? String(item.amount) : '')
  const [priority, setPriority] = useState<'mandatory' | 'optional'>(item?.priority ?? 'mandatory')
  const [dueOn, setDueOn] = useState(item?.due_on ?? todayISO())
  const [busy, setBusy] = useState(false)
  const valid = name.trim().length > 0 && Number(amount) > 0
  const save = async () => {
    setBusy(true)
    const patch = { name: name.trim(), amount: Number(amount), kind: 'expense', priority, due_on: dueOn, cycle_start: cycleStart }
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

export function UnreasonableSheet({ item, cycleStart, onClose, onSaved }: { item: CompassPlanned | null; cycleStart: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(item?.name ?? '')
  const [amount, setAmount] = useState(item ? String(item.amount) : '')
  const [tag, setTag] = useState<'functional' | 'regret'>(item?.tag ?? 'functional')
  const [busy, setBusy] = useState(false)
  const valid = name.trim().length > 0 && Number(amount) > 0
  const save = async () => {
    setBusy(true)
    const patch = { name: name.trim(), amount: Number(amount), kind: 'expense', priority: 'optional', due_on: null, cycle_start: cycleStart, tag }
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

export function IncomeSheet({ item, cycle, settings, onClose, onSaved }: {
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

/* Mirrors Compass's own DebtForm (src/pages/Debts.tsx) field for field and
   validation for validation, on his instruction to make debts editable here
   too (2026-09-01) -- this writes to the same compass_debts table Compass's
   own payoff math reads, so the payload shape matches exactly rather than
   guessing at one. The remaining balance itself is never a field: it's
   principal_start minus every debt_payment transaction since, computed
   elsewhere (compassCalc's debtView) -- editing it directly here would
   silently disagree with that math the next time a payment posts. */
export function DebtSheet({ item, onClose, onSaved }: { item: CompassDebt | null; onClose: () => void; onSaved: () => void }) {
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
export function DebtImportSheet({ existing, onClose, onSaved }: { existing: CompassDebt[]; onClose: () => void; onSaved: () => void }) {
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
