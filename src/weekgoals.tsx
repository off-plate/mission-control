/* THIS WEEK'S GOALS, on Plan (his ask, 2026-11-02). Plan showed one day and a
   to-do list, so the things a week is FOR ("reach out to 100 clients", "build
   the Off-Plate site") had no home and could only be done in one sitting or not
   at all. These are the Goals page's own weekly goals, not a second system:
   adding one here adds it there, and a number logged there shows here. What
   this adds is TODAY'S SHARE, so a big target is paid down a little each day
   (he picked this shape from three working versions, the "Today focus" one). */
import { useEffect, useState } from 'react'
import * as Icon from './icons'
import { useStore } from './store'
import { Dropdown } from './ui'
import { goalCurrent, type Goal } from './types'
import { goalPeriodKey, goalPeriodRange, localDateKey, shiftPeriodKey } from './util'

const daysBetween = (a: string, b: string): number =>
  Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000)

/* Big targets get a bigger step; a three-part goal only needs the +1. */
const stepsFor = (target: number): number[] => (target >= 50 ? [1, 10] : target >= 15 ? [1, 5] : [1])

/* Where each goal stood when the day began, so "today's share" and "added
   today" mean something. A view of the day, not his data: it lives on this
   device only and is rebuilt the first time a new day is seen. A goal set up
   during the day starts from where it was first seen. */
const DAYSTART_KEY = 'mc:goal-daystart'
type DayStart = { day: string; v: Record<string, number> }
const readDayStart = (): DayStart | null => {
  try { const x = JSON.parse(localStorage.getItem(DAYSTART_KEY) ?? 'null'); return x && typeof x.day === 'string' && x.v ? x : null } catch { return null }
}

export interface GoalDay {
  goal: Goal
  cur: number
  /** What today owes the week: the rest of the target spread over the days left. */
  share: number
  /** What moved since the day began. */
  added: number
  done: boolean
}

/** This week's running goals, in view, with today's share worked out. */
export function useWeekGoals(): { rows: GoalDay[]; key: string; from: string; to: string } {
  const { goals, habits, habitLog, slips, focusSessions, inView } = useStore()
  const today = localDateKey()
  const key = goalPeriodKey('weekly')
  const range = goalPeriodRange('weekly', key)
  const week = goals.filter((g) => g.timeframe === 'weekly' && g.periodKey === key && !g.closed && inView(g.space))
  const curOf = (g: Goal) => goalCurrent(g, habits, habitLog, range, slips, focusSessions)
  const stored = readDayStart()
  const base = stored?.day === today ? stored.v : {}
  const missing = week.some((g) => base[g.id] === undefined)
  useEffect(() => {
    if (!missing) return
    const next: DayStart = { day: today, v: { ...base } }
    for (const g of week) if (next.v[g.id] === undefined) next.v[g.id] = curOf(g)
    try { localStorage.setItem(DAYSTART_KEY, JSON.stringify(next)) } catch { /* private mode */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing, today])
  const daysLeft = Math.max(1, daysBetween(today, range.to) + 1)
  const rows = week.map((g) => {
    const cur = curOf(g)
    const start = base[g.id] ?? cur
    return {
      goal: g, cur,
      share: Math.max(1, Math.ceil(Math.max(0, g.target - start) / daysLeft)),
      added: Math.max(0, cur - start),
      done: cur >= g.target,
    }
  })
  return { rows, key, from: range.from, to: range.to }
}

function GoalRow({ row, today }: { row: GoalDay; today: string }) {
  const { bumpGoal, updateGoal, deleteGoal } = useStore()
  const { goal, cur, share, added, done } = row
  const [typing, setTyping] = useState(false)
  const [val, setVal] = useState('')
  const auto = !!goal.habitId
  const left = Math.max(0, share - added)
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
        <span className="wg-name">{goal.name}</span>
        {typing ? (
          <input className="est-input mono" type="number" min={0} max={goal.target} autoFocus value={val}
            aria-label={`Progress on ${goal.name}`}
            onChange={(e) => setVal(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setTyping(false) }} />
        ) : (
          <button className="wg-count mono" disabled={auto}
            title={auto ? 'Counts itself from a habit' : 'Click to set the number yourself'}
            onClick={() => { setVal(String(cur)); setTyping(true) }}>
            {cur}<span>/{goal.target}</span>
          </button>
        )}
      </div>
      <div className={`bar${done ? ' prog' : ''}`}><i style={{ width: `${pct}%` }} /></div>
      <div className="wg-foot">
        <span className={`wg-pace${done || left === 0 ? ' is-met' : ''}`}>
          {done ? 'Done for the week' : left === 0 ? "Today's share done" : `${left}${unit} more today`}
        </span>
        {!auto && !done && stepsFor(goal.target).map((s) => (
          <button key={s} className="wg-step mono" aria-label={`Add ${s} to ${goal.name}`} onClick={() => bumpGoal(goal.id, s)}>+{s}</button>
        ))}
        <Dropdown label={`Options for ${goal.name}`}>
          <button role="menuitem" className="danger" onClick={() => deleteGoal(goal.id)}>Delete</button>
        </Dropdown>
      </div>
    </div>
  )
}

export function WeekGoals() {
  const { goals, inView, space, addGoal, repeatGoal } = useStore()
  const { rows, key } = useWeekGoals()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const today = localDateKey()
  /* Last week's hand-logged goals he did not finish, one tap to set them again. */
  const lastKey = shiftPeriodKey('weekly', -1)
  const carry = goals.filter((g) => g.timeframe === 'weekly' && g.periodKey === lastKey && g.closed && g.closed.final < g.target && !g.habitId && inView(g.space)
    && !rows.some((r) => r.goal.name === g.name))

  const save = () => {
    const n = Math.round(Number(target))
    if (!name.trim() || !(n > 0)) return
    addGoal({ space, name: name.trim(), current: 0, target: n, unit: '', note: '', timeframe: 'weekly', category: 'work', periodKey: key })
    setName(''); setTarget(''); setAdding(false)
  }

  return (
    <section className="weekgoals" aria-label="This week's goals">
      <div className="pf-head">
        <h2 className="pf-h2">This week</h2>
        <button className="wg-act" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
          <Icon.Plus size={12} /> Goal
        </button>
      </div>
      {carry.length > 0 && (
        <button className="wg-act wg-carry" onClick={() => carry.forEach((g) => repeatGoal(g.id))}>
          Carry over {carry.length} from last week
        </button>
      )}
      {adding && (
        <div className="wg-add">
          <input className="textinput" placeholder="Reach out to clients" value={name} autoFocus
            aria-label="Goal for this week" onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setAdding(false) }} />
          <div className="wg-add-row">
            <input className="textinput wg-target mono" type="number" min={1} inputMode="numeric" placeholder="100" value={target}
              aria-label="How many" onChange={(e) => setTarget(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
            <button className="btn btn-primary" disabled={!name.trim() || !(Number(target) > 0)} onClick={save}>Add</button>
          </div>
        </div>
      )}
      {rows.length === 0 && !adding && (
        <p className="col-note">No goal for this week yet. Add the one thing the week is for, with a number.</p>
      )}
      {rows.map((r) => <GoalRow key={r.goal.id} row={r} today={today} />)}
    </section>
  )
}
