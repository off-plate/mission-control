/* THE GYM PAGE. PROVING GROUND, back from Forge -- his ask, 2026-09-18, after
   rejecting a first attempt that bolted a manual-entry goals band onto the
   Health page and repeated its time/calories session list wholesale.

   What he actually wanted: a page of its own, between Health and Why, whose
   goals are predefined from the real Forge targets rather than typed in by
   hand, and whose session ladder reads like Health's (he named that style
   explicitly) but reports weight, PRs and effort -- not time and calories,
   which Health already shows. So this reuses Health's own `.hp-*` classes
   for structure (same dark HUD, same day-row shape) and adds only what's new:
   goal cards, and a session body keyed to Hevy's per-exercise numbers rather
   than Zepp's per-session ones. */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { CookieJarNav, readJarView } from './cookiejarnav'
import {
  bestE1rmEver, bestRepTotalEver, getAllHevyDayStats, getHevyExerciseHistory, prsOnDay,
  type ExerciseHistory,
} from './hevy'
import { useStore } from './store'
import type { GymGoal } from './types'
import * as Icon from './icons'

/* His real Forge goals (PROVING GROUND), carried over as the page's seed the
   first time it opens with none saved yet. Numbers are his own opening and
   target figures from that dashboard -- current is never re-typed here, it's
   computed live below from real Hevy history for every goal that has one. */
const FORGE_SEED: (Omit<GymGoal, 'id' | 'createdAt' | 'updatedAt'>)[] = [
  { name: 'Bench e1RM', metric: 'e1rm', exerciseName: 'Bench Press (Barbell)', goal: 76, unit: 'kg' },
  { name: 'Deadlift e1RM', metric: 'e1rm', exerciseName: 'Deadlift (Barbell)', goal: 175, unit: 'kg' },
  { name: 'Incline Smith reps at 50', metric: 'repTotal', exerciseName: 'Incline Bench Press (Smith Machine)', goal: 15, unit: 'reps' },
  { name: 'Incline DB e1RM', metric: 'e1rm', exerciseName: 'Incline Bench Press (Dumbbell)', goal: 44, unit: 'kg' },
  { name: 'Pull-up day total', metric: 'repTotal', exerciseName: 'Pull Up', goal: 16, unit: 'reps' },
  {
    name: 'Stairmaster floors in 15:00', metric: 'manual', goal: 0, unit: 'floors', current: 0,
    note: "Forge never set a real target for this one -- it's here so it isn't lost, not because 0 means anything. Edit it once you have one.",
  },
  { name: 'Sessions logged', metric: 'sessions', goal: 20, unit: 'sessions' },
  { name: 'Bodyweight', metric: 'manual', goal: 91, unit: 'kg', current: 96, lowerIsBetter: true },
]

/** What the goal is at right now, live off real Hevy history for every
 *  metric except 'manual', which he sets himself. Null means never logged --
 *  a goal with nothing to show yet, not a zero it hasn't earned. */
function currentFor(g: GymGoal, history: ExerciseHistory, sessionDays: number): number | null {
  switch (g.metric) {
    case 'e1rm': return g.exerciseName ? bestE1rmEver(history, g.exerciseName) : null
    case 'repTotal': return g.exerciseName ? bestRepTotalEver(history, g.exerciseName) : null
    case 'sessions': return sessionDays
    case 'manual': return g.current ?? null
  }
}

function pctFor(g: GymGoal, current: number | null): number {
  if (current == null || g.goal <= 0) return 0
  if (g.lowerIsBetter) {
    /* Bodyweight-shaped: he starts above the goal and comes down to it. A
       manual goal with no real opening weight recorded yet has nothing to
       measure "how far down" against, so it reads as just started rather
       than guessing a start point that was never his. */
    const start = g.current ?? current
    if (start <= g.goal) return 1
    return Math.max(0, Math.min(1, (start - current) / (start - g.goal)))
  }
  return Math.max(0, Math.min(1, current / g.goal))
}

const ACCENTS = ['var(--hp-train)', 'var(--hp-cardio)', 'var(--hp-sleep)', 'var(--hp-move)', 'var(--hp-body)']

function GoalCard({ g, current, accent, onSave }: {
  g: GymGoal; current: number | null; accent: string
  onSave: (patch: Partial<Pick<GymGoal, 'goal' | 'current' | 'note'>>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [goalDraft, setGoalDraft] = useState(String(g.goal))
  const [currentDraft, setCurrentDraft] = useState(String(g.current ?? ''))
  const pct = pctFor(g, current)
  const noTarget = g.goal <= 0

  const save = () => {
    const goal = Number(goalDraft)
    const patch: Partial<Pick<GymGoal, 'goal' | 'current' | 'note'>> = {}
    if (Number.isFinite(goal) && goal !== g.goal) patch.goal = goal
    if (g.metric === 'manual') {
      const c = Number(currentDraft)
      if (Number.isFinite(c) && c !== g.current) patch.current = c
    }
    if (Object.keys(patch).length) onSave(patch)
    setEditing(false)
  }

  return (
    <div className="gp-goal" style={{ '--gp-accent': accent } as CSSProperties}>
      <div className="gp-goal-head">
        <span className="gp-goal-name">{g.name}</span>
        <button className="gp-goal-edit" onClick={() => setEditing((v) => !v)} aria-label={`Edit ${g.name}`}>
          <Icon.Edit size={12} />
        </button>
      </div>
      {editing ? (
        <div className="gp-goal-form">
          <label>Target<input value={goalDraft} onChange={(e) => setGoalDraft(e.target.value)} inputMode="decimal" /></label>
          {g.metric === 'manual' && (
            <label>Current<input value={currentDraft} onChange={(e) => setCurrentDraft(e.target.value)} inputMode="decimal" /></label>
          )}
          <div className="gp-goal-form-actions">
            <button className="gp-goal-save" onClick={save}>Save</button>
            <button className="gp-goal-cancel" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div className="gp-goal-nums">
            <span className="gp-goal-current">{current != null ? fmtNum(current) : '—'}</span>
            <span className="gp-goal-of">of</span>
            <span className="gp-goal-target">{noTarget ? 'no target set' : `${fmtNum(g.goal)} ${g.unit}`}</span>
          </div>
          {!noTarget && (
            <div className="gp-goal-bar"><i style={{ width: `${Math.round(pct * 100)}%` }} /></div>
          )}
          {g.note && <p className="gp-goal-note">{g.note}</p>}
        </>
      )}
    </div>
  )
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

interface GymDay { day: string; volumeKg: number; exercises: { name: string; weight: number; reps: number; e1rm: number; isPR: boolean }[]; prCount: number }

function GymPart({ e }: { e: GymDay['exercises'][number] }) {
  return (
    <li className="hp-part">
      <span className="hp-part-name">{e.name}</span>
      <span className="hp-part-nums">
        <b>{fmtNum(e.weight)}<i>kg</i></b>
        <b>{e.reps}<i>reps</i></b>
        <b>{Math.round(e.e1rm)}<i>e1RM</i></b>
        {e.isPR && <b className="is-effort">PR</b>}
      </span>
    </li>
  )
}

function GymDayRow({ d, hardest }: { d: GymDay; hardest: number }) {
  const [open, setOpen] = useState(false)
  const effort = hardest > 0 ? Math.min(1, d.volumeKg / hardest) : 0
  const many = d.exercises.length > 1
  const title = d.exercises.length === 1 ? d.exercises[0].name : `${d.exercises.length} exercises`
  const body = (
    <>
      <span className="hp-day-date"><b>{new Date(`${d.day}T12:00:00`).getDate()}</b><span>{new Date(`${d.day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })}</span></span>
      <span className="hp-day-mid">
        <span className="hp-day-title">{title}</span>
        <span className="hp-day-meta">
          {d.prCount > 0 && <span className="hp-day-best">{d.prCount} {d.prCount === 1 ? 'PR' : 'PRs'} hit</span>}
        </span>
      </span>
      <span className="hp-day-stats">
        <span className="hp-stat"><b>{Math.round(d.volumeKg).toLocaleString('en-GB')}</b><i>kg lifted</i></span>
      </span>
      <span className="hp-day-effort">
        <span className="hp-effort-num">{Math.round(effort * 100)}</span>
        <span className="hp-effort-bar"><i style={{ width: `${Math.round(effort * 100)}%` }} /></span>
        <span className="hp-effort-cap">% of hardest</span>
      </span>
      {many && (
        <span className="hp-day-more">
          <span className="hp-day-count">{d.exercises.length}</span>
          <Icon.ChevronDown size={14} className={open ? 'hp-chev is-open' : 'hp-chev'} />
        </span>
      )}
    </>
  )
  return (
    <li className={`hp-day${open ? ' is-open' : ''}${many ? ' is-openable' : ''}`}>
      {many ? (
        <button className="hp-day-main" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{body}</button>
      ) : (
        <div className="hp-day-main is-flat">{body}</div>
      )}
      {open && <ul className="hp-parts">{d.exercises.map((e) => <GymPart key={e.name} e={e} />)}</ul>}
    </li>
  )
}

export function GymPage() {
  const { gymGoals, addGymGoal, updateGymGoal } = useStore()

  /* Seeded once, the first time this device opens the page with nothing
     saved -- a real, small set of rows, not an empty list waiting for him to
     type in his own goals from memory. */
  useEffect(() => {
    if (gymGoals.length > 0) return
    for (const g of FORGE_SEED) addGymGoal(g)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const history = useMemo(() => getHevyExerciseHistory(), [])
  const dayStats = useMemo(() => getAllHevyDayStats(), [])

  const sessionDays = useMemo(() => Object.entries(dayStats)
    .map(([day, stats]): GymDay => {
      const exercises = Object.entries(history)
        .map(([name, rows]) => ({ name, row: rows.find((r) => r.day === day) }))
        .filter((x): x is { name: string; row: NonNullable<typeof x.row> } => !!x.row)
        .map((x) => ({ name: x.name, weight: x.row.weight, reps: x.row.reps, e1rm: x.row.e1rm, isPR: x.row.isPR }))
      return { day, volumeKg: stats.volumeKg, exercises, prCount: prsOnDay(history, day).length }
    })
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, 20), [dayStats, history])

  const hardest = Math.max(0, ...sessionDays.map((d) => d.volumeKg))

  return (
    <div className="page">
      <div className="hp">
        <header className="hp-head">
          <div>
            <h1 className="hp-title">Gym</h1>
            <p className="hp-since">
              {sessionDays.length ? `${sessionDays.length} sessions on record from Hevy` : 'Nothing synced from Hevy yet.'}
            </p>
          </div>
          <div className="hp-head-right">
            <CookieJarNav here="gym" view={readJarView()} />
          </div>
        </header>

        <section className="gp-goals">
          {gymGoals.map((g, i) => (
            <GoalCard
              key={g.id}
              g={g}
              current={currentFor(g, history, Object.keys(dayStats).length)}
              accent={ACCENTS[i % ACCENTS.length]}
              onSave={(patch) => updateGymGoal(g.id, patch)}
            />
          ))}
        </section>

        <section className="hp-section">
          <h2 className="hp-h2">
            Sessions
            <span className="hp-h2-count">{sessionDays.length} logged</span>
          </h2>
          {sessionDays.length === 0 ? (
            <p className="hp-empty hp-empty-flat">Nothing logged yet. Connect Hevy from Health's sync to fill this in.</p>
          ) : (
            <ul className="hp-days">
              {sessionDays.map((d) => <GymDayRow key={d.day} d={d} hardest={hardest} />)}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
