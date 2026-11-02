/* THIS WEEK'S GOALS, on Plan (his ask, 2026-11-02). Plan showed one day and a
   to-do list, so the things a week is FOR ("reach out to 100 clients", "build
   the Off-Plate site") had no home and could only be done in one sitting or not
   at all. These are the Goals page's own weekly goals, not a second system:
   adding one here adds it there, and a number logged there shows here. What this
   row adds is the pace, so a big target is paid down a little each day. */
import { useState } from 'react'
import * as Icon from './icons'
import { useStore } from './store'
import { Dropdown } from './ui'
import { goalCurrent, type Goal } from './types'
import { goalPeriodKey, goalPeriodRange, localDateKey, shiftPeriodKey } from './util'

const daysBetween = (a: string, b: string): number =>
  Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000)

/* Big targets get a bigger step; a three-part goal only needs the +1. */
const stepsFor = (target: number): number[] => (target >= 50 ? [1, 10] : target >= 15 ? [1, 5] : [1])

function GoalRow({ goal, cur, from, to, today }: { goal: Goal; cur: number; from: string; to: string; today: string }) {
  const { bumpGoal, updateGoal, deleteGoal } = useStore()
  const [typing, setTyping] = useState(false)
  const [val, setVal] = useState('')
  const auto = !!goal.habitId
  const done = cur >= goal.target
  const total = daysBetween(from, to) + 1
  const elapsed = Math.min(total, daysBetween(from, today) + 1)
  const daysLeft = Math.max(1, total - elapsed + 1)
  const expected = (goal.target * (elapsed - 1)) / total
  const behind = !done && cur < expected
  const perDay = Math.ceil((goal.target - cur) / daysLeft)
  const pct = Math.min(100, Math.round((cur / Math.max(1, goal.target)) * 100))
  const unit = goal.unit ? ` ${goal.unit}` : ''

  const commit = () => {
    const n = Math.round(Number(val))
    if (Number.isFinite(n) && n >= 0) updateGoal(goal.id, { current: Math.min(goal.target, n), touchedAt: today })
    setTyping(false)
  }

  return (
    <div className={`wg-row${done ? ' is-done' : ''}`}>
      <div className="wg-top">
        <span className="wg-name grow">{goal.name}</span>
        {typing ? (
          <input className="est-input mono" type="number" min={0} max={goal.target} autoFocus value={val}
            aria-label={`Progress on ${goal.name}`}
            onChange={(e) => setVal(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setTyping(false) }} />
        ) : (
          <button className="wg-count mono" disabled={auto}
            title={auto ? 'Counts itself from a habit' : 'Click to set the number yourself'}
            onClick={() => { setVal(String(cur)); setTyping(true) }}>
            {cur}<span>/{goal.target}{unit}</span>
          </button>
        )}
        {!auto && !done && stepsFor(goal.target).map((s) => (
          <button key={s} className="wg-step mono" aria-label={`Add ${s} to ${goal.name}`} onClick={() => bumpGoal(goal.id, s)}>+{s}</button>
        ))}
        <Dropdown label={`Options for ${goal.name}`}>
          <button role="menuitem" className="danger" onClick={() => deleteGoal(goal.id)}>Delete</button>
        </Dropdown>
      </div>
      <div className={`bar${done ? ' prog' : behind ? ' warn' : ''}`}><i style={{ width: `${pct}%` }} /></div>
      {/* One fact he can act on, nothing about cadence: what today owes the week. */}
      <div className={`wg-pace mono${behind ? ' is-behind' : ''}`}>
        {done ? 'Done for the week' : perDay <= 0 ? 'On pace' : `${perDay}${unit} a day to finish${behind ? ', behind pace' : ''}`}
      </div>
    </div>
  )
}

export function WeekGoals() {
  const { goals, habits, habitLog, slips, focusSessions, inView, space, addGoal, repeatGoal } = useStore()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const today = localDateKey()
  const key = goalPeriodKey('weekly')
  const range = goalPeriodRange('weekly', key)
  const weekGoals = goals.filter((g) => g.timeframe === 'weekly' && g.periodKey === key && !g.closed && inView(g.space))
  /* Last week's goals he did not finish, one tap to set them again. */
  const lastKey = shiftPeriodKey('weekly', -1)
  const carry = goals.filter((g) => g.timeframe === 'weekly' && g.periodKey === lastKey && g.closed && g.closed.final < g.target && !g.habitId && inView(g.space)
    && !weekGoals.some((w) => w.name === g.name))

  const save = () => {
    const n = Math.round(Number(target))
    if (!name.trim() || !(n > 0)) return
    addGoal({ space: space, name: name.trim(), current: 0, target: n, unit: '', note: '', timeframe: 'weekly', category: 'work', periodKey: key })
    setName(''); setTarget(''); setAdding(false)
  }

  return (
    <div className="panel weekgoals">
      <div className="col-head">
        <span className="microcap">This week's goals</span>
        <span className="grow" />
        {carry.length > 0 && (
          <button className="wg-act" onClick={() => carry.forEach((g) => repeatGoal(g.id))}>
            Carry over {carry.length} from last week
          </button>
        )}
        <button className="wg-act" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
          <Icon.Plus size={12} /> Add goal
        </button>
      </div>
      {adding && (
        <div className="formrow wg-add">
          <input className="textinput grow" placeholder="Reach out to clients" value={name} autoFocus
            aria-label="Goal for this week" onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setAdding(false) }} />
          <input className="textinput wg-target mono" type="number" min={1} inputMode="numeric" placeholder="100" value={target}
            aria-label="How many" onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
          <button className="btn btn-primary" disabled={!name.trim() || !(Number(target) > 0)} onClick={save}>Add</button>
        </div>
      )}
      {weekGoals.length === 0 && !adding && (
        <p className="col-note">No goal for this week yet. Add the one thing the week is for, with a number.</p>
      )}
      {weekGoals.map((g) => (
        <GoalRow key={g.id} goal={g} today={today} from={range.from} to={range.to}
          cur={goalCurrent(g, habits, habitLog, range, slips, focusSessions)} />
      ))}
    </div>
  )
}
