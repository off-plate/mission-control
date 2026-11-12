import { useState, type ReactNode } from 'react'
import { useStore } from '../store'
import * as Icon from '../icons'
import {
    bestCleanRun, type Goal, type GoalTimeframe, type RoutineCadence, type TimeSlot
} from '../types'
import { localDateKey } from '../util'
import { ICONS, ICON_KEYS, PALETTE, guessIcon, fmt } from '../hkparts'
import { DAY, Item, PARTS, isHabitKind, keyAgo, short } from './shared'

export function parseAmount(s: string, unit?: string): number | null {
  const t = s.trim().toLowerCase().replace(/\s/g, '').replace(',', '.')
  if (unit === 'ml') { const l = t.match(/^(\d+(?:\.\d+)?)l$/); if (l) return parseFloat(l[1]) * 1000 }
  const m = t.match(/^(\d+(?:\.\d+)?)(k)?$/)
  return m ? parseFloat(m[1]) * (m[2] ? 1000 : 1) : null
}

/* ---------- the quick log: presets, a typed amount, today's rows ---------- */
export function LogSheet({ it, onClose, onAdd, kept, today, goalTotal }: {
  it: Item; onClose: () => void; onAdd: (it: Item, v: number, note?: string) => void
  kept: Map<string, Map<string, { n: number; v: number }>>; today: string; goalTotal: number
}) {
  const { habitLog, removeAmount, removeGoalEntry } = useStore()
  const [val, setVal] = useState('')
  const [note, setNote] = useState('')
  const g = it.goal, h = it.habit
  const unit = g ? g.unit : h?.unit ?? ''
  const total = g ? goalTotal : kept.get(h!.id)?.get(today)?.v ?? 0
  const target = g ? g.target : h?.targetAmount ?? 0
  const presets = g
    ? [...new Set((g.entries ?? []).map((e) => e.v).reverse())].slice(0, 4).concat(g.entries?.length ? [] : unit === 'CZK' ? [1000, 5000, 10000] : [1, 5, 10]).slice(0, 4)
    : h?.presets?.length ? h.presets : unit === 'ml' ? [250, 330, 500, 750] : [1, 5, 10]
  const submit = () => { const v = parseAmount(val, unit); if (!v) return; onAdd(it, v, note.trim()); setVal(''); setNote('') }
  const rows = g ? [...(g.entries ?? [])].reverse().slice(0, 8) : habitLog.filter((t) => t.habitId === h!.id && t.day === today && t.v != null).slice().reverse()
  return (
    <div className="hk-log">
      <div className="hk-stop"><span className="hk-spacer" /><h3>{it.name}</h3><button className="hk-round" aria-label="Close" onClick={onClose}><Icon.Close size={16} /></button></div>
      <div className="hk-bigamt"><b>{fmt(total)}</b><span>/ {fmt(target)} {unit}</span></div>
      <div className="hk-presets">{presets.map((v) => <button key={v} onClick={() => onAdd(it, v, note.trim())}>+{unit === 'CZK' && v >= 1000 ? `${fmt(v / 1000)}k` : fmt(v)}<small>{unit}</small></button>)}</div>
      <form className="hk-typed" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <input value={val} onChange={(e) => setVal(e.target.value)} inputMode="decimal" autoComplete="off" placeholder={unit === 'ml' ? 'Other amount, 400 or 0.4l' : unit === 'CZK' ? 'Amount, 12 500 or 12.5k' : 'Amount'} aria-label="Amount" />
        <button disabled={!parseAmount(val, unit)}>Add</button>
      </form>
      {g && <input className="hk-note" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} placeholder="Note, optional: who paid, what for" aria-label="Note" />}
      {rows.length > 0 && (
        <ul className="hk-entries">
          {g ? (rows as NonNullable<Goal['entries']>).map((e) => <li key={e.id}><span className="d">{short(e.day)}</span><span className="n">{e.note ?? ''}</span><span className="v">+{fmt(e.v)}</span><button aria-label="Remove" onClick={() => removeGoalEntry(g.id, e.id)}><Icon.Close size={14} /></button></li>)
            : (rows as { src?: string; v?: number; at?: string }[]).map((t) => <li key={t.src}><span className="d">{t.at ? new Date(t.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}</span><span className="n" /><span className="v">+{fmt(t.v ?? 0)}</span><button aria-label="Remove" onClick={() => t.src && removeAmount(h!.id, t.src)}><Icon.Close size={14} /></button></li>)}
        </ul>
      )}
    </div>
  )
}

/* ---------- one thing in detail: a half year of tiles, a month to correct, its colour ---------- */
export function DetailSheet({ it, onClose, onRun, onLog, dayVal, Tiles }: {
  it: Item; onClose: () => void; onRun: () => void; onLog: () => void
  dayVal: (it: Item, day: string, a: number) => number | null
  Tiles: (p: { it: Item; weeks: number }) => ReactNode
}) {
  const { markHabitOn, logSlipOn, setLook, todayIndex, slips, toggleGoalMilestone, toggleHabitDay } = useStore()
  const [month, setMonth] = useState(0)
  const editable = it.kind === 'check' || it.kind === 'quit'
  const m = new Date(); m.setDate(1); m.setMonth(m.getMonth() + month)
  const pad = (m.getDay() + 6) % 7, days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()
  const todayKey = localDateKey()
  const last30 = Array.from({ length: 30 }, (_, i) => dayVal(it, keyAgo(i), i)).filter((v) => v !== null) as number[]
  const pct = last30.length ? Math.round(last30.reduce((a, v) => a + v, 0) / last30.length * 100) : 0
  const lookKind = it.kind === 'routine' ? 'routine' : it.kind === 'goal' ? 'goal' : 'habit'
  return (
    <div className="hk-detail">
      <div className="hk-stop"><span className="hk-spacer" /><h3>{it.name}</h3><button className="hk-round" aria-label="Close" onClick={onClose}><Icon.Close size={16} /></button></div>
      <div className="hk-dgrid">{Tiles({ it, weeks: 26 })}</div>
      {it.kind !== 'goal' && <div className="hk-dchips"><span>{pct}% of the last 30 days</span>{it.kind === 'quit' && it.habit && <span>Longest {bestCleanRun(it.habit, slips)} days</span>}</div>}
      {it.kind === 'routine' && (
        <>
          {/* Each step is tickable right here, for the one he did without running the routine. */}
          <ul className="hk-steps">{it.list!.map((h) => <li key={h.id} className={h.days[todayIndex] ? 'is-d' : ''}><button className="hk-mstick" role="checkbox" aria-checked={h.days[todayIndex]} aria-label={h.name} onClick={() => toggleHabitDay(h.id, todayIndex)}><i /></button><span>{h.name}</span><small>{h.optional ? 'optional' : h.seconds ? `${Math.round(h.seconds / 60)} min` : ''}</small></li>)}</ul>
          {!(it.list![0]?.frequency === 'weekdays' && todayIndex >= 5) && <button className="hk-bigbtn is-c" onClick={onRun}>Start {it.name}</button>}
        </>
      )}
      {it.kind === 'goal' && !!it.goal!.milestones?.length && (
        <ul className="hk-steps">{it.goal!.milestones!.map((ms) => <li key={ms.id} className={ms.done ? 'is-d' : ''}><button className="hk-mstick" role="checkbox" aria-checked={ms.done} aria-label={ms.label} onClick={() => toggleGoalMilestone(it.id, ms.id)}><i /></button><span>{ms.label}</span></li>)}</ul>
      )}
      {it.kind === 'goal' && !it.goal!.habitId && !(it.goal!.milestones?.length && it.goal!.target === it.goal!.milestones.length) && <button className="hk-bigbtn is-c" onClick={onLog}>Log an amount</button>}
      {it.kind === 'amount' && <button className="hk-bigbtn is-c" onClick={onLog}>Log {it.habit?.unit}</button>}
      {it.kind !== 'goal' && (
        <div className="hk-cal">
          <div className="hk-calh">{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <span key={d}>{d}</span>)}</div>
          <div className="hk-calg">
            {Array.from({ length: pad }, (_, i) => <span key={`p${i}`} />)}
            {Array.from({ length: days }, (_, i) => {
              const d = new Date(m.getFullYear(), m.getMonth(), i + 1, 12)
              const k = localDateKey(d), a = Math.round((new Date(`${todayKey}T12:00:00`).getTime() - d.getTime()) / DAY)
              const v = a < 0 ? null : dayVal(it, k, a)
              const cls = `${v != null && v >= 1 ? 'is-f' : v != null && v > 0 ? 'is-p' : ''}${a === 0 ? ' is-t' : ''}`
              const tap = editable && a >= 0 && v !== null
              return <button key={k} className={cls} disabled={!tap} onClick={() => {
                if (it.kind === 'check') markHabitOn(it.id, k, !(v != null && v >= 1))
                else if (it.kind === 'quit' && v === 1) logSlipOn(it.id, k)
              }}>{i + 1}</button>
            })}
          </div>
          <div className="hk-calfoot">
            <button className="hk-round is-sm" aria-label="Previous month" onClick={() => setMonth(month - 1)}><Icon.ChevronLeft size={16} /></button>
            <span>{m.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}{editable ? (it.kind === 'quit' ? '. Tap a clean day to log a slip on it.' : '. Tap a day to fill or clear it.') : ''}</span>
            <button className="hk-round is-sm" aria-label="Next month" disabled={month >= 0} onClick={() => setMonth(month + 1)}><Icon.ChevronRight size={16} /></button>
          </div>
        </div>
      )}
      {isHabitKind(it.kind) && it.habit && (
        <div className="hk-field"><label>When</label>
          <div className="hk-seg is-wrap">{PARTS.map((p) => <button key={p.label} aria-pressed={(it.habit!.daypart ?? undefined) === p.slot} onClick={() => setLook('habit', it.id, { daypart: p.slot ?? null })}>{p.label}</button>)}</div>
        </div>
      )}
      <div className="hk-field"><label>Colour</label>
        <div className="hk-swatches">{PALETTE.map((c) => <button key={c} style={{ ['--c' as string]: c }} aria-pressed={it.color === c} aria-label="Colour" onClick={() => setLook(lookKind, it.id, { color: c })} />)}</div>
      </div>
      <div className="hk-field"><label>Icon</label>
        <div className="hk-icons">{ICON_KEYS.map((k) => { const C = ICONS[k]; return <button key={k} aria-pressed={it.icon === k} aria-label={k} onClick={() => setLook(lookKind, it.id, { icon: k })}><C size={18} /></button> })}</div>
      </div>
      {it.kind === 'quit' && it.habit && (
        <div className="hk-field"><label htmlFor="hk-cost">Cost a day, CZK</label>
          <input id="hk-cost" inputMode="decimal" defaultValue={it.habit.dailyCost ?? ''} placeholder="60" onBlur={(e) => setLook('habit', it.id, { dailyCost: parseAmount(e.target.value) ?? undefined })} />
        </div>
      )}
      {it.kind === 'amount' && it.habit && (
        <div className="hk-field"><label htmlFor="hk-presets">Quick amounts</label>
          <input id="hk-presets" defaultValue={(it.habit.presets ?? []).join(', ')} placeholder="250, 330, 500, 750" onBlur={(e) => setLook('habit', it.id, { presets: e.target.value.split(',').map((x) => parseAmount(x)).filter((x): x is number => !!x) })} />
        </div>
      )}
    </div>
  )
}

/* ---------- + : name, colour, then what it is and how it is tracked ---------- */
export function NewSheet({ onClose, onMade }: { onClose: () => void; onMade: (name: string) => void }) {
  const { addHabit, addGoal, addRoutineWithSteps, space } = useStore()
  const [kind, setKind] = useState<'habit' | 'routine' | 'goal' | 'quit'>('habit')
  const [track, setTrack] = useState<'yesno' | 'count' | 'amount'>('yesno')
  const [name, setName] = useState('')
  const [color, setColor] = useState(PALETTE[1])
  const [freq, setFreq] = useState<'daily' | 'weekdays' | 'times-per-week'>('daily')
  const [part, setPart] = useState<TimeSlot | ''>('')
  const [target, setTarget] = useState('')
  const [unit, setUnit] = useState('')
  const [presets, setPresets] = useState('250, 330, 500, 750')
  const [steps, setSteps] = useState('')
  const [cadence, setCadence] = useState<RoutineCadence | 'demand'>('daily')
  const [period, setPeriod] = useState<GoalTimeframe>('quarter')
  const [since, setSince] = useState(localDateKey())
  const [cost, setCost] = useState('')
  const [milestones, setMilestones] = useState('')
  const hint = { habit: 'Something you do on a day.', routine: 'Steps you go through in order, one tap to start.', goal: 'A total to reach in a period, like 40 000 CZK this quarter.', quit: 'Every day counts as clean until you log a slip.' }[kind]
  const save = () => {
    const n = name.trim(); if (!n) return
    const icon = guessIcon(n, kind === 'routine' ? 'checklist' : kind === 'goal' ? 'flag' : kind === 'quit' ? 'eye' : 'checklist')
    if (kind === 'habit') {
      const base = { name: n, frequency: freq, daypart: part || undefined, color, icon, targetPerWeek: freq === 'times-per-week' ? 3 : undefined }
      if (track === 'yesno') addHabit({ ...base, kind: 'build' })
      else if (track === 'count') addHabit({ ...base, kind: 'measured', measure: 'times', per: 'day', targetCount: Math.max(1, parseAmount(target) ?? 1) })
      else addHabit({ ...base, kind: 'build', measure: 'amount', unit: unit.trim() || 'ml', targetAmount: parseAmount(target) ?? 1, presets: presets.split(',').map((x) => parseAmount(x)).filter((x): x is number => !!x) })
    } else if (kind === 'routine') {
      const list = steps.split('\n').map((x) => x.trim()).filter(Boolean)
      if (!list.length) return
      addRoutineWithSteps({ title: n, cadence: cadence === 'demand' ? 'daily' : cadence, repeatable: cadence === 'demand', daypart: part || undefined, steps: list, color, icon })
    } else if (kind === 'goal') {
      /* Milestones alone make a goal measured in its milestones, the way the
         old sheet did: three steps written, a target of three. */
      const ms = milestones.split('\n').map((x) => x.trim()).filter(Boolean).map((label, i) => ({ id: `m${Date.now().toString(36)}${i}`, label, done: false }))
      const t = parseAmount(target) ?? (ms.length || null); if (!t) return
      const byMs = !parseAmount(target) && ms.length > 0
      addGoal({ space, name: n, current: 0, target: t, unit: byMs ? 'milestones' : unit.trim() || 'CZK', note: '', timeframe: period, category: /czk|eur|\$/i.test(unit) ? 'money' : 'life', color, icon, entries: [], milestones: ms.length ? ms : undefined })
    } else {
      addHabit({ name: n, frequency: 'daily', kind: 'break', quitSince: since, color, icon, dailyCost: parseAmount(cost) ?? undefined })
    }
    onMade(n)
  }
  const canSave = !!name.trim() && (kind !== 'routine' || !!steps.trim()) && (kind !== 'goal' || !!parseAmount(target) || !!milestones.trim())
  return (
    <div className="hk-new">
      <div className="hk-stop"><button className="hk-round" aria-label="Close" onClick={onClose}><Icon.Close size={16} /></button><h3>New</h3><span className="hk-spacer" /></div>
      <div className="hk-field"><label htmlFor="hk-name">Name</label><input id="hk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={{ habit: 'Read 20 pages', routine: 'Sunday reset', goal: 'Earn from Off-Plate', quit: 'Energy drinks' }[kind]} autoFocus /></div>
      <div className="hk-field"><label>Colour</label><div className="hk-swatches">{PALETTE.map((c) => <button key={c} style={{ ['--c' as string]: c }} aria-pressed={color === c} aria-label="Colour" onClick={() => setColor(c)} />)}</div></div>
      <div className="hk-field"><label>Type</label><div className="hk-seg">{(['habit', 'routine', 'goal', 'quit'] as const).map((k) => <button key={k} aria-pressed={kind === k} onClick={() => { setKind(k); if (k === 'goal' && !unit) setUnit('CZK') }}>{{ habit: 'Habit', routine: 'Routine', goal: 'Goal', quit: 'Quit' }[k]}</button>)}</div></div>
      <p className="hk-hint">{hint}</p>
      {kind === 'habit' && <>
        <div className="hk-field"><label>Tracking</label><div className="hk-seg">{(['yesno', 'count', 'amount'] as const).map((k) => <button key={k} aria-pressed={track === k} onClick={() => { setTrack(k); if (k === 'amount' && !unit) { setUnit('ml'); setTarget('2500') } if (k === 'count' && !target) setTarget('8') }}>{{ yesno: 'Yes / No', count: 'Count', amount: 'Amount' }[k]}</button>)}</div></div>
        {track !== 'yesno' && <div className="hk-two">
          <div className="hk-field"><label htmlFor="hk-t">A day</label><input id="hk-t" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></div>
          {track === 'amount' && <div className="hk-field"><label htmlFor="hk-u">Unit</label><input id="hk-u" value={unit} onChange={(e) => setUnit(e.target.value)} /></div>}
        </div>}
        {track === 'amount' && <div className="hk-field"><label htmlFor="hk-p">Quick amounts</label><input id="hk-p" value={presets} onChange={(e) => setPresets(e.target.value)} /></div>}
        <div className="hk-two">
          <div className="hk-field"><label htmlFor="hk-f">How often</label><select id="hk-f" value={freq} onChange={(e) => setFreq(e.target.value as 'daily')}><option value="daily">Every day</option><option value="weekdays">Mon to Fri</option><option value="times-per-week">3 times a week</option></select></div>
          <div className="hk-field"><label htmlFor="hk-w">When</label><select id="hk-w" value={part} onChange={(e) => setPart(e.target.value as TimeSlot)}><option value="">Any time</option><option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="evening">Evening</option></select></div>
        </div>
      </>}
      {kind === 'routine' && <>
        <div className="hk-two">
          <div className="hk-field"><label htmlFor="hk-c">How often</label><select id="hk-c" value={cadence} onChange={(e) => setCadence(e.target.value as RoutineCadence)}><option value="daily">Every day</option><option value="prework">Mon to Fri</option><option value="weekly">Once a week</option><option value="monthly">Once a month</option><option value="demand">Whenever I need it</option></select></div>
          <div className="hk-field"><label htmlFor="hk-w2">When</label><select id="hk-w2" value={part} onChange={(e) => setPart(e.target.value as TimeSlot)}><option value="">Any time</option><option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="evening">Evening</option></select></div>
        </div>
        <div className="hk-field"><label htmlFor="hk-s">Steps, one per line</label><textarea id="hk-s" value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={'Laundry\nPlan meals\nClean the desk'} /></div>
      </>}
      {kind === 'goal' && <>
        <div className="hk-two">
          <div className="hk-field"><label htmlFor="hk-gt">Target</label><input id="hk-gt" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="40 000" /></div>
          <div className="hk-field"><label htmlFor="hk-gu">Unit</label><input id="hk-gu" value={unit} onChange={(e) => setUnit(e.target.value)} /></div>
        </div>
        <div className="hk-field"><label htmlFor="hk-ms">Milestones, one per line (optional)</label><textarea id="hk-ms" value={milestones} onChange={(e) => setMilestones(e.target.value)} placeholder={'First client signed\nCase study published'} /></div>
        <div className="hk-field"><label htmlFor="hk-gp">By</label><select id="hk-gp" value={period} onChange={(e) => setPeriod(e.target.value as GoalTimeframe)}><option value="weekly">End of this week</option><option value="monthly">End of this month</option><option value="quarter">End of this quarter</option><option value="half">End of this half year</option></select></div>
      </>}
      {kind === 'quit' && <div className="hk-two">
        <div className="hk-field"><label htmlFor="hk-qs">Since</label><input id="hk-qs" type="date" value={since} onChange={(e) => setSince(e.target.value)} /></div>
        <div className="hk-field"><label htmlFor="hk-qc">Cost a day, CZK</label><input id="hk-qc" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="60" /></div>
      </div>}
      <button className="hk-bigbtn" style={{ background: color }} disabled={!canSave} onClick={save}>Save</button>
    </div>
  )
}
