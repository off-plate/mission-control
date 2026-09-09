/* THE QUITTING PAGE (tab: "Habits & Goals"). Split out of pages1.tsx
   (2026-09-09). Imports HabitSheet from habits.tsx -- a quit is a HabitDef
   with kind:'break', so adding/editing one uses the same sheet habits.tsx
   already defines, not a second copy of it. */
import { useState } from 'react'
import { SPACE_LABELS } from './exceptions'
import { useStore } from './store'
import { Band, Dropdown, WriteTo, HabitsGoalsSwitch } from './ui'
import { bestCleanRun, daysClean, slipCount, slipDays, type HabitDef, type HabitSlip } from './types'
import { HabitSheet } from './habits'
import { localDateKey } from './util'

const QUIT_MILESTONES = [7, 30, 90, 100, 180, 365]
const nextMilestone = (days: number): number | null => QUIT_MILESTONES.find((m) => m > days) ?? null

function quitStrip(h: HabitDef, slips: HabitSlip[], n = 90): ('before' | 'slip' | 'clean')[] {
  const slipped = slipDays(slips, h.id)
  const out: ('before' | 'slip' | 'clean')[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i)
    const key = localDateKey(d)
    out.push(!h.quitSince || key < h.quitSince ? 'before' : slipped.has(key) ? 'slip' : 'clean')
  }
  return out
}

const shortDate = (key: string): string => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function QuittingPage() {
  const { habits, inView, slips, logSlip, deleteHabit, togglePauseHabit } = useStore()
  const [adding, setAdding] = useState(false)
  const [editHabit, setEditHabit] = useState<HabitDef | null>(null)

  /* Ranked by how long it has held. That is the scoreboard, and a page that
     ordered them any other way would be hiding the only number that matters. */
  const quits = habits
    .filter((h) => h.kind === 'break' && !h.archivedAt)
    .map((h) => ({ h, clean: daysClean(h, slips) ?? 0, best: bestCleanRun(h, slips), slipped: slipCount(h, slips) }))
    .sort((a, b) => b.clean - a.clean)

  const standing = quits.reduce((a, q) => a + q.clean, 0)
  const cleanToday = quits.filter((q) => !slipDays(slips, q.h.id).has(localDateKey())).length

  return (
    <div className="page">
      <Band
        title="Habits & Goals"
        beside={<HabitsGoalsSwitch on="quitting" />}
        metrics={quits.length ? [{ v: `${cleanToday}/${quits.length}`, k: 'clean today', tone: (cleanToday === quits.length ? 'pos' : 'info') as 'pos' | 'info' }] : undefined}
        actions={<><WriteTo /><button className="btn btn-primary" onClick={() => setAdding(true)}>Add a habit</button></>}
      />

      {quits.length === 0 && <div className="empty">Nothing you are quitting in this workspace. Add a habit and set it to something you are stopping.</div>}

      {quits.length > 0 && (
        <div className="panel hg-panel">
          <div className="hg-head">
            <span className="microcap">{quits.length === 1 ? 'One thing you are not doing' : `${quits.length} things you are not doing`}</span>
            <span className="hg-n mono">{standing} clean days standing</span>
          </div>
          <div className="qwall">
            {quits.map(({ h, clean, best, slipped }) => {
              const next = nextMilestone(clean)
              const slippedToday = slipDays(slips, h.id).has(localDateKey())
              const strip = quitStrip(h, slips)
              return (
                <div className="qcard" key={h.id}>
                  {/* The number owns the first line and the name owns the
                      second. Squeezed onto the right of the figure, "No YouTube
                      besides music" wrapped to two lines against a 44px digit
                      and read as a caption on the number rather than the name
                      of the thing. */}
                  <div className="qcard-top">
                    <span className={`qcard-n mono${slippedToday ? ' is-broken' : ''}`}>{clean}</span>
                    <span className="microcap qcard-u">{clean === 1 ? 'clean day' : 'clean days'}</span>
                    <Dropdown label={`Options for ${h.name}`} className="habit-kebab">
                      <button role="menuitem" onClick={() => setEditHabit(h)}>Edit this habit</button>
                      <button role="menuitem" onClick={() => togglePauseHabit(h.id)}>{h.paused ? 'Resume it' : 'Pause it'}</button>
                      <span className="kebab-sep" />
                      <button role="menuitem" className="danger" onClick={() => deleteHabit(h.id)}>Delete this habit</button>
                    </Dropdown>
                  </div>

                  <div className="qcard-name">{h.name}</div>

                  <div className="qcard-line">
                    <span className="habit-qual qcard-space">{SPACE_LABELS[h.space]}</span>
                    {h.quitSince ? `since ${shortDate(h.quitSince)}` : 'no start date'}
                    {best > 0 && ` · best ${best}`}
                    {` · ${slipped} ${slipped === 1 ? 'slip' : 'slips'}`}
                  </div>

                  {/* The next rung, with his own best run marked on the same bar.
                      Two numbers about the same run belong on one scale, or he
                      has to hold one in his head to read the other. */}
                  <div className="qmile">
                    <div className="qmile-bar">
                      <i style={{ width: `${next ? Math.min(100, Math.round((clean / next) * 100)) : 100}%` }} />
                      {next && best > 0 && best < next && (
                        <u style={{ left: `${Math.round((best / next) * 100)}%` }} title={`best run, ${best} days`} />
                      )}
                    </div>
                    <div className="qmile-lab microcap">
                      <span>{next ? `${next - clean} to ${next}` : 'past every milestone'}</span>
                      <span>{best > 0 ? `best ${best}` : 'no run yet'}</span>
                    </div>
                  </div>

                  {/* Ninety days. A bad patch is a shape, and a shape does not
                      have to be read the way a number does. */}
                  <div className="qstrip" aria-hidden="true">
                    {strip.map((k, i) => <i className={`is-${k}`} key={i} />)}
                  </div>

                  <button className="btn btn-sm btn-quiet qcard-slip" onClick={() => logSlip(h.id)}>
                    {slippedToday ? 'Slipped today' : 'I slipped today'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {adding && <HabitSheet onClose={() => setAdding(false)} />}
      {editHabit && <HabitSheet habit={editHabit} onClose={() => setEditHabit(null)} />}
    </div>
  )
}

