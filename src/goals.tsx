/* THE GOALS PAGE. Split out of pages1.tsx (2026-09-09). Exports GoalSheet,
   imported by habits.tsx for "set a goal on this habit". Never imports from
   habits.tsx or quitting.tsx itself, so that cross-import stays one-way. */
import * as Icon from './icons'
import { useState } from 'react'
import { useStore } from './store'
import { Sheet } from './modals'
import { Band, Dropdown, Select, SpaceMark, WriteTo, HabitsGoalsSwitch } from './ui'
import { GOAL_TIMEFRAMES, goalCurrent, isTimeFed, habitTarget, type GoalCategory, type GoalTimeframe, type Goal, type GoalMilestone } from './types'
import { goalPeriodKey, goalPeriodRange, periodIsPast, periodLabel, shiftPeriodKey, fmtNum, goalPace, fmtWhen, type GoalTf } from './util'

export function GoalSheet({ onClose, goal, presetHabitId, thenGoToGoals, periodOffsets }: {
  onClose: () => void
  goal?: Goal
  presetHabitId?: string
  /** Opened from a habit: show him the goal he just made, rather than saving
   *  it silently and leaving him staring at the page he started on. */
  thenGoToGoals?: boolean
  /** Where each column is looking. A goal added while browsing next week is
   *  FOR next week; that is what planning forward means. */
  periodOffsets?: Record<string, number>
}) {
  const { space, habits, addGoal, updateGoal, setPage } = useStore()
  const preset = habits.find((h) => h.id === presetHabitId)
  const [d, setD] = useState({
    name: goal?.name ?? (preset ? preset.name : ''),
    why: goal?.why ?? '',
    target: goal?.target ?? (preset ? habitTarget(preset) * 4 : 3),
    unit: goal?.unit ?? 'steps',
    deadline: goal?.deadline ?? '',
    timeframe: goal?.timeframe ?? ('monthly' as GoalTimeframe),
    category: goal?.category ?? ('life' as GoalCategory),
    habitId: goal?.habitId ?? presetHabitId ?? '',
  })
  /* Milestones existed in the data and on the card, but no sheet ever offered
     them, so the feature was unreachable. A goal made of milestones counts
     itself by ticking them: the target follows the list. */
  const [milestones, setMilestones] = useState<GoalMilestone[]>(goal?.milestones ?? [])
  const [msDraft, setMsDraft] = useState('')
  const addMs = () => {
    const t = msDraft.trim()
    if (!t) return
    setMilestones((prev) => [...prev, { id: `ms-${Date.now().toString(36)}-${prev.length}`, label: t, done: false }])
    setMsDraft('')
  }
  /* Only habits from the profile this goal is being written into. In All every
     habit was on offer, so a goal filed under Personal could count off a Work
     habit and then show a number nothing on that page could explain. */
  const linkable = [...habits.filter((h) => h.space === space && !h.paused && !h.archivedAt)].reverse()
  const linked = linkable.find((h) => h.id === d.habitId)

  const submit = () => {
    if (!d.name.trim()) return
    const shape = {
      name: d.name.trim(), target: Math.max(1, d.target),
      unit: d.habitId ? (linked && isTimeFed(linked) ? 'hours' : 'checkoffs') : (d.unit.trim() || 'steps'),
      why: d.why.trim() || undefined, deadline: d.deadline.trim() || undefined,
      timeframe: d.timeframe, category: d.category,
      habitId: d.habitId || undefined,
      periodKey: shiftPeriodKey(d.timeframe as GoalTf, d.timeframe === 'half' ? 0 : (periodOffsets?.[d.timeframe] ?? 0)),
      milestones,
      ...(milestones.length && !d.habitId ? { target: milestones.length, unit: 'milestones' } : {}),
    }
    if (goal) updateGoal(goal.id, shape)
    else addGoal({ space, current: 0, note: '', ...shape })
    onClose()
    if (thenGoToGoals) setPage('goals')
  }

  const tracking = Boolean(d.habitId)
  /* The name follows the habit until he writes his own, then it is his and the
     picker stops touching it. */
  const [namedByHand, setNamedByHand] = useState(Boolean(goal?.name))

  return (
    <Sheet title={goal ? 'Edit this goal' : 'Add a goal'} onClose={onClose}>
      {/* The first decision, not a dropdown three fields down: is this a goal you
          log yourself, or one of your habits counting itself? Asking it last is
          why it kept reading as "there is no way to pick a habit". */}
      <label className="field-label">What kind of goal?</label>
      <div className="kindpick">
        <button type="button" className={!tracking ? 'on' : ''} onClick={() => setD({ ...d, habitId: '' })}>
          <b>Something new</b>
          <span>You log the progress yourself</span>
        </button>
        <button
          type="button" className={tracking ? 'on' : ''}
          disabled={linkable.length === 0}
          title={linkable.length === 0 ? 'Create a habit first' : undefined}
          onClick={() => {
            const h = linkable.find((x) => x.id === d.habitId) ?? linkable[0]
            setD({ ...d, habitId: h?.id ?? '', name: namedByHand ? d.name : (h?.name ?? '') })
          }}
        >
          <b>Track one of my habits</b>
          <span>{linkable.length === 0 ? 'No habits yet' : 'It counts itself as you keep it'}</span>
        </button>
      </div>

      {tracking && (
        <>
          <label className="field-label" style={{ marginTop: 'var(--s4)' }} htmlFor="ghabit">Which habit?</label>
          <Select id="ghabit" style={{ width: '100%' }} value={d.habitId}
            onChange={(habitId) => {
              const h = linkable.find((x) => x.id === habitId)
              setD({ ...d, habitId, name: namedByHand ? d.name : (h?.name ?? '') })
            }}
            options={linkable.map((h) => ({ value: h.id, label: `${h.name}${h.kind === 'break' ? ' (quitting)' : ''}` }))} />
          <p className="assist-note" style={{ marginTop: 6 }}>
            {linked ? `Every time “${linked.name}” is kept, this goal moves. Nothing to log twice.` : ''}
          </p>
        </>
      )}

      <label className="field-label" style={{ marginTop: 'var(--s4)' }} htmlFor="gname">What is the outcome?</label>
      <input id="gname" className="textinput" style={{ width: '100%' }} autoFocus
        placeholder="e.g. Twelve gym sessions…" value={d.name}
        onChange={(e) => { setNamedByHand(true); setD({ ...d, name: e.target.value }) }}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />

      <label className="field-label" style={{ marginTop: 'var(--s4)' }} htmlFor="gwhy">Why does it matter?</label>
      <input id="gwhy" className="textinput" style={{ width: '100%' }}
        placeholder="The thing that keeps it alive when you do not feel like it…"
        value={d.why} onChange={(e) => setD({ ...d, why: e.target.value })} />

      {/* No area-of-life question. The category survives on the row only as a
         stored default; a goal already knows which space it lives in. */}
      <div style={{ marginTop: 'var(--s4)' }}>
        <label className="field-label" htmlFor="gtf">Timeframe</label>
        <Select id="gtf" style={{ width: '100%' }} value={d.timeframe}
          onChange={(v) => setD({ ...d, timeframe: v })}
          options={GOAL_TIMEFRAMES.map((t) => ({ value: t.id, label: `${t.label} · ${periodLabel(t.id as GoalTf)}` }))} />
      </div>

      <div className="sheet-grid" style={{ marginTop: 'var(--s4)' }}>
        <div>
          <label className="field-label" htmlFor="gtarget">Target</label>
          <div className="sheet-inline">
            <input id="gtarget" className="numinput" type="number" min={1} value={d.target}
              onChange={(e) => setD({ ...d, target: Math.max(1, Number(e.target.value) || 1) })} />
            {d.habitId
              ? <span className="sheet-unit">{linked && isTimeFed(linked) ? 'hours of focus' : 'checkoffs'}</span>
              : <input className="textinput" placeholder="unit, e.g. sessions…" value={d.unit}
                  onChange={(e) => setD({ ...d, unit: e.target.value })} aria-label="Unit" />}
          </div>
        </div>
        <div>
          <label className="field-label" htmlFor="gdl">By when</label>
          <input id="gdl" className="textinput" style={{ width: '100%' }} placeholder="e.g. End of July…"
            value={d.deadline} onChange={(e) => setD({ ...d, deadline: e.target.value })} />
        </div>
      </div>

      {/* Only for hand-logged goals: a habit-linked goal already counts itself. */}
      {!d.habitId && (
        <div style={{ marginTop: 'var(--s4)' }}>
          <label className="field-label" htmlFor="gms">Milestones, if it comes in steps</label>
          {milestones.length > 0 && (
            <div className="ms-list">
              {milestones.map((m) => (
                <div className="ms-row" key={m.id}>
                  <span className="grow">{m.label}</span>
                  <button className="sub-tool" aria-label={`Remove milestone: ${m.label}`}
                    onClick={() => setMilestones((prev) => prev.filter((x) => x.id !== m.id))}>Remove</button>
                </div>
              ))}
            </div>
          )}
          <div className="formrow">
            <input id="gms" className="textinput" style={{ flex: 1 }} placeholder="e.g. Outline written…"
              value={msDraft} onChange={(e) => setMsDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMs() } }} />
            <button className="btn btn-quiet" disabled={!msDraft.trim()} onClick={addMs}>Add</button>
          </div>
          {milestones.length > 0 && <p className="assist-note">The target becomes {milestones.length}: one per milestone, ticked on the goal card.</p>}
        </div>
      )}

      <div className="sheet-actions">
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!d.name.trim()} onClick={submit}>{goal ? 'Save changes' : 'Add goal'}</button>
      </div>
    </Sheet>
  )
}

/** What "move it to the one running now" is called, per timeframe. */
const TF_NOW: Record<GoalTimeframe, string> = {
  weekly: 'this week', monthly: 'this month', quarter: 'this quarter', half: 'this half',
}

/* What a period promised and did not deliver. A week that ends must not drop
   the things he put on it: they are still on his to-do list, but the PROMISE
   needs an answer, so it stands here until he gives one. Two answers, both
   honest: carry it into the period running now, or admit it is not happening
   and take it off. Nothing here is stored: acting on it removes it. */
function LeftBehind() {
  const { tasks, commitTask, inView } = useStore()
  const left = tasks.filter((t) => !t.done && inView(t.space) && t.horizon && t.horizonKey
    && periodIsPast(t.horizon as GoalTf, t.horizonKey))
  if (!left.length) return null
  return (
    <div className="panel left-behind">
      <div className="col-head">
        <span className="microcap">Left behind</span>
        <span className="col-tot mono">{left.length}</span>
      </div>
      {left.map((t) => {
        const tf = t.horizon as GoalTf
        return (
          <div className="lb-row" key={t.id}>
            <SpaceMark space={t.space} />
            <span className="grow">{t.title}</span>
            <span className="meta mono">{goalPeriodRange(tf, t.horizonKey!).label}</span>
            <button className="btn btn-quiet" onClick={() => commitTask(t.id, t.horizon, goalPeriodKey(tf))}>
              Move to {TF_NOW[t.horizon!]}
            </button>
            <button className="sub-tool" onClick={() => commitTask(t.id)}>Take off</button>
          </div>
        )
      })}
    </div>
  )
}

/* The work a period is for. Not a goal with a number on it and not a second
   copy of anything: the same tasks he already keeps in the plan, standing under
   the week or the month he promised them to. He ticks one in the plan and it is
   ticked here, because there is only ever one of it. */
function PeriodTasks({ tf, periodKey }: { tf: GoalTimeframe; periodKey: string }) {
  const { tasks, toggleTask, commitTask, addTask, space, inView } = useStore()
  const [adding, setAdding] = useState(false)
  const [q, setQ] = useState('')
  const mine = tasks.filter((t) => inView(t.space) && t.horizon === tf && t.horizonKey === periodKey)
  const list = [...mine.filter((t) => !t.done), ...mine.filter((t) => t.done)]
  const doneN = mine.filter((t) => t.done).length
  const term = q.trim().toLowerCase()
  /* What he can put here: anything open that is not already promised to a
     period. Something already promised to this month is not offered to this
     week as well, because then finishing it would fill two promises at once. */
  const offer = tasks
    .filter((t) => inView(t.space) && !t.done && !t.horizon && (!term || t.title.toLowerCase().includes(term)))
    .slice(0, 6)
  const put = (id: string) => { commitTask(id, tf, periodKey); setQ(''); setAdding(false) }
  const create = () => {
    const title = q.trim()
    if (!title) return
    addTask({ title, source: 'mc', estimateMin: 0, space, list: 'backlog', category: 'quick', horizon: tf, horizonKey: periodKey })
    setQ('')
    setAdding(false)
  }
  return (
    <div className="period-tasks">
      <div className="ptask-head">
        <span className="microcap">Tasks</span>
        {mine.length > 0 && <span className="col-tot mono">{doneN} of {mine.length} done</span>}
        <button
          className="goal-nav-btn ptask-add"
          aria-label={adding ? 'Close' : 'Put a task on this period'}
          aria-expanded={adding}
          onClick={() => { setAdding((a) => !a); setQ('') }}
        >
          {adding ? '×' : '+'}
        </button>
      </div>
      {list.map((t) => (
        <div className={`ptask${t.done ? ' done' : ''}`} key={t.id}>
          <button
            className="goal-ms-check"
            role="checkbox"
            aria-checked={t.done}
            aria-label={`${t.title}, ${t.done ? 'done' : 'not done'}`}
            onClick={() => toggleTask(t.id)}
          >
            {t.done && <Icon.Check size={10} strokeWidth={4.4} />}
          </button>
          <SpaceMark space={t.space} />
          <span className="grow">{t.title}</span>
          <button className="sub-tool" aria-label={`Take “${t.title}” off this period`} onClick={() => commitTask(t.id)}>Take off</button>
        </div>
      ))}
      {adding && (
        <div className="ptask-add-box">
          <input
            className="textinput"
            autoFocus
            placeholder="Find a task, or write a new one…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setAdding(false); setQ('') }
              if (e.key !== 'Enter') return
              e.preventDefault()
              // The one it is showing him wins; otherwise the words he typed
              // become a new task on the to-do list, promised to this period.
              if (offer.length === 1 && term) put(offer[0].id); else create()
            }}
            aria-label="Find a task, or write a new one"
          />
          {offer.length > 0 && (
            <div className="ptask-offer">
              {offer.map((t) => (
                <button key={t.id} className="ptask-offer-row" onClick={() => put(t.id)}>
                  <SpaceMark space={t.space} />
                  <span className="grow">{t.title}</span>
                  <span className="mono meta">{t.list === 'today' ? 'today' : 'to-do'}</span>
                </button>
              ))}
            </div>
          )}
          {term && <button className="btn btn-quiet ptask-new" onClick={create}>Add “{q.trim()}” as a new task</button>}
        </div>
      )}
    </div>
  )
}

/* ---------------- QUITTING ----------------

   The third face of Habits & Goals, and it earns its own page: a quit is not a
   habit you tick and not a goal you reach. It is a count of days something has
   been true, and it needs nothing from him except on the day it stops being
   true. Sitting as a section under a page about doing things, it read as one
   more list of chores.

   Direction A of three he was shown, and the one he picked: the wall. Ranked by
   how long each has held, because that IS the scoreboard, with the next
   milestone and his own best run drawn on the same bar so the two are
   comparable at a glance, and ninety days as a strip so a bad patch shows
   without reading a number.

   Everything here is arithmetic on two stored things, `quitSince` and the slip
   dates. There is nothing else in the record, so there is nothing else on the
   page: no reason, no trigger, no time of day. Anything that implied otherwise
   would be the screen inventing data. */

/** The ladder a run is measured against. Mine, not his and not stored; the
 *  ordinary ones people count in. Changing them changes only this line. */

/** The last `n` days, each one before the quit began, slipped, or clean. */

export function GoalsPage() {
  const { space, goals, habits, habitLog, focusSessions, slips, bumpGoal, toggleGoalMilestone, deleteGoal, repeatGoal, inView } = useStore()
  const all = goals
  /* A goal belongs to a period. The ones whose period has ended are not deleted
     and do not keep counting: they sit below with the number they finished on. */
  const spaceGoals = all.filter((g) => !g.closed)
  const past = all.filter((g) => g.closed).sort((a, b) => (a.closed!.on < b.closed!.on ? 1 : -1))
  /* Which period each column is looking at, as steps from now. Zero is today;
     back shows what a finished period ended on, forward is where next week's
     goals are planned before next week exists. Half-year stays put. */
  const [offsets, setOffsets] = useState<Record<string, number>>({})
  const shift = (tf: string, d: number) => setOffsets((o) => ({ ...o, [tf]: (o[tf] ?? 0) + d }))
  const nowOf = (g: Goal) => goalCurrent(g, habits, habitLog, goalPeriodRange((g.timeframe ?? 'quarter') as GoalTf, g.periodKey ?? goalPeriodKey((g.timeframe ?? 'quarter') as GoalTf)), slips, focusSessions)
  const done = spaceGoals.filter((g) => nowOf(g) >= g.target).length
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Goal | null>(null)
  /* "Set it again" used to give no sign a click had landed -- same page,
     same list, nothing visibly changed -- so he clicked it a dozen times
     and got a dozen duplicate goals before he noticed. Flashing the goal
     it lands on (new or already there) is the fix he asked for: it does
     not have to disappear from Finished periods, there just has to be a
     visible answer to "did that work." */
  const [flashGoalId, setFlashGoalId] = useState<string | null>(null)
  const setAgain = (id: string) => {
    const landedId = repeatGoal(id)
    if (!landedId) return
    setFlashGoalId(landedId)
    document.querySelector(`[data-goal-id="${landedId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    window.setTimeout(() => setFlashGoalId((cur) => (cur === landedId ? null : cur)), 2600)
  }

  return (
    <div className="page">
      <Band
        title="Habits & Goals"
        beside={<HabitsGoalsSwitch on="goals" />}
        metrics={[{ v: `${done}/${spaceGoals.length}`, k: 'reached', tone: (done > 0 ? 'pos' : 'info') as 'pos' | 'info' }]}
        actions={<><WriteTo /><button className="btn btn-primary" onClick={() => setAdding(true)}>Add a goal</button></>}
      />

      <LeftBehind />

      {/* THE LADDER, his pick from the redesign artifact on 2026-08-26.

          The four stretches were four cards, each holding whatever it held and
          each drawing its own header, so no two lines ever aligned and three of
          them were usually empty. They are BANDS now, week at the top through
          half year at the bottom, and a goal is a ROW in one shared grid. That
          is the actual fix for the misalignment he reported: alignment is
          structural rather than something to keep tidying by hand.

          Everything the cards carried is still here. A row keeps the space
          mark, the category dot, the pace badge and the menu; the why, the
          habit link, the milestones and the manual logger drop to a second line
          under the row that only exists when there is something to put in it. */}
      <div className="goal-ladder">
        {GOAL_TIMEFRAMES.map((tfr) => {
          const off = tfr.id === 'half' ? 0 : (offsets[tfr.id] ?? 0)
          const shownKey = shiftPeriodKey(tfr.id as GoalTf, off)
          const inTf = all.filter((g) => (g.timeframe ?? 'quarter') === tfr.id
            && (g.periodKey ?? goalPeriodKey(tfr.id as GoalTf)) === shownKey)
          const reached = inTf.filter((g) => (g.closed ? g.closed.final : nowOf(g)) >= g.target).length
          return (
            <section className="goal-band" key={tfr.id}>
              <header className="gb-head">
                {/* Paged away from now, "This week" would be a lie over last
                    week's dates. The label follows the period being shown. */}
                <h2 className="gb-name">
                  {off === 0 ? tfr.label : `${off < 0 ? 'An earlier' : 'A coming'} ${tfr.id === 'weekly' ? 'week' : tfr.id === 'monthly' ? 'month' : 'quarter'}`}
                </h2>
                <span className="gb-range">{periodLabel(tfr.id as GoalTf, shownKey)}</span>
                {inTf.length > 0 && (
                  <span className="gb-tally">{reached}<i>/{inTf.length}</i> reached</span>
                )}
                {tfr.id !== 'half' && (
                  <span className="gb-nav">
                    <button className="goal-nav-btn" aria-label={`Earlier ${tfr.label.toLowerCase()}`} onClick={() => shift(tfr.id, -1)}>‹</button>
                    {off !== 0 && <button className="goal-nav-btn now" onClick={() => setOffsets((o) => ({ ...o, [tfr.id]: 0 }))}>now</button>}
                    <button className="goal-nav-btn" aria-label={`Later ${tfr.label.toLowerCase()}`} onClick={() => shift(tfr.id, 1)}>›</button>
                  </span>
                )}
              </header>

              {inTf.length === 0 && (
                <p className="gb-none">
                  {off < 0 ? 'No goals were set for this one.'
                    : off > 0 ? 'Nothing planned here yet.'
                      : 'Nothing set for this stretch.'}
                </p>
              )}

              {inTf.map((g) => {
                const current = nowOf(g)
                const fromHabit = habits.find((h) => h.id === g.habitId)
                const pct = Math.min(100, Math.round((current / g.target) * 100))
                const dailyCap = !!fromHabit && !isTimeFed(fromHabit)
                const status = goalPace(current, g.target, g.timeframe ?? 'quarter', new Date(), dailyCap)
                const milestoneDriven = !!g.milestones?.length && g.target === g.milestones.length
                const statusLabel = off > 0 ? 'planned'
                  : g.closed ? (g.closed.final >= g.target ? 'reached' : `ended at ${fmtNum(g.closed.final)}`)
                    : status === 'done' ? 'reached' : status === 'behind' ? 'needs a push' : 'on pace'
                const hasDetail = !!g.why || !!fromHabit || !!g.deadline || !!(g.milestones && g.milestones.length)
                return (
                  <div className={`goal-item${flashGoalId === g.id ? ' flash' : ''}`} key={g.id} data-goal-id={g.id}>
                    <div className="goal-row">
                      <span className="gr-name">
                        <SpaceMark space={g.space} />
                        <span className={`cat-dot goalcat-${g.category ?? 'life'}`} aria-hidden="true" />
                        <span className="gr-obj">{g.name}</span>
                      </span>
                      <span className="gr-count mono">{fmtNum(current)}<i>/{fmtNum(g.target)}</i></span>
                      <span className={`bar prog${status === 'behind' ? ' warn' : ''}`}><i style={{ width: `${pct}%` }} /></span>
                      <span className="gr-pct">{pct}<i>%</i></span>
                      <span className={`goal-status s-${status}`}>{statusLabel}</span>
                      {!milestoneDriven && !g.habitId ? (
                        <span className="goal-bump" role="group" aria-label={`Log progress for ${g.name}`}>
                          <button onClick={() => bumpGoal(g.id, -1)} disabled={current <= 0} aria-label="Less">−</button>
                          <button onClick={() => bumpGoal(g.id, 1)} disabled={current >= g.target} aria-label="More">+</button>
                        </span>
                      ) : <span className="goal-bump" />}
                      <Dropdown label={`Options for ${g.name}`}>
                        <button role="menuitem" onClick={() => setEditing(g)}>Edit this goal</button>
                        <button role="menuitem" className="danger" onClick={() => deleteGoal(g.id)}>Delete this goal</button>
                      </Dropdown>
                    </div>
                    {hasDetail && (
                      <div className="goal-detail">
                        {g.why && <p className="goal-why">{g.why}</p>}
                        {fromHabit && <p className="goal-linked">Counts itself from the “{fromHabit.name}” habit.</p>}
                        {g.deadline && <p className="goal-deadline">by {/^\d{4}-\d{2}-\d{2}$/.test(g.deadline) ? fmtWhen(g.deadline) : g.deadline}</p>}
                        {g.milestones && g.milestones.length > 0 && (
                          <ul className="goal-ms">
                            {g.milestones.map((m) => (
                              <li className={`goal-ms-item${m.done ? ' done' : ''}`} key={m.id}>
                                <button
                                  className="goal-ms-check"
                                  role="checkbox"
                                  aria-checked={m.done}
                                  aria-label={`${m.label}, ${m.done ? 'done' : 'not done'}`}
                                  onClick={() => toggleGoalMilestone(g.id, m.id)}
                                >
                                  {m.done && <Icon.Check size={10} strokeWidth={4.4} />}
                                </button>
                                <span>{m.label}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              <PeriodTasks tf={tfr.id} periodKey={shownKey} />
            </section>
          )
        })}
      </div>

      {/* Where last week's goals went. They keep the number they finished on, and
          any of them can be set again for the period we are in now. */}
      {past.length > 0 && (
        <>
          <div className="sechead" style={{ marginTop: 'var(--s6)' }}>
            <span className="microcap">Finished periods</span>
            <span className="section-count mono">{past.length}</span>
          </div>
          <div className="panel">
            <div className="rowlist">
              {past.map((g) => {
                const tf = (g.timeframe ?? 'quarter') as GoalTf
                const label = goalPeriodRange(tf, g.periodKey ?? '').label
                const hit = g.closed!.final >= g.target
                return (
                  <div className="rowitem past-goal" key={g.id}>
                    <span className="grow">{g.name}</span>
                    <span className="meta">{label}</span>
                    <span className={`mono ${hit ? 'val-pos' : 'val-urgent'}`}>{fmtNum(g.closed!.final)} of {fmtNum(g.target)}</span>
                    <button className="btn btn-quiet" onClick={() => setAgain(g.id)}>Set it again</button>
                    <Dropdown label={`Options for ${g.name}`}>
                      <button role="menuitem" className="danger" onClick={() => deleteGoal(g.id)}>Delete this goal</button>
                    </Dropdown>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {adding && <GoalSheet periodOffsets={offsets} onClose={() => setAdding(false)} />}
      {editing && <GoalSheet goal={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
