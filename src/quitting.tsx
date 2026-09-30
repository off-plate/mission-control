/* THE QUITTING PAGE (tab: "Habits & Goals"). Split out of pages1.tsx
   (2026-09-09). Imports HabitSheet from habits.tsx -- a quit is a HabitDef
   with kind:'break', so adding/editing one uses the same sheet habits.tsx
   already defines, not a second copy of it. */
import { useEffect, useState } from 'react'
import { SPACE_LABELS } from './exceptions'
import { useStore } from './store'
import { Band, Dropdown } from './ui'
import { bestCleanRun, daysClean, slipCount, slipDays, type HabitDef, type HabitSlip } from './types'
import { HabitSheet } from './habits'
import { localDateKey } from './util'

const QUIT_MILESTONES = [7, 30, 90, 100, 180, 365]
const nextMilestone = (days: number): number | null => QUIT_MILESTONES.find((m) => m > days) ?? null

/* A fall is judged by the clean run it ended: day two is crushing, day thirty
   is a minor setback. Clean days deepen with the length of the run, so the
   grid reads as how strong the quit has become, not just whether it held. */
const FALLS = [
  { max: 3, lvl: 5, label: 'Crushing' },
  { max: 7, lvl: 4, label: 'Very poor' },
  { max: 13, lvl: 3, label: 'Poor' },
  { max: 29, lvl: 2, label: 'Bad' },
  { max: Infinity, lvl: 1, label: 'Minor setback' },
]
const fallOf = (run: number) => FALLS.find((f) => run <= f.max)!
const strengthLvl = (run: number) => (run >= 60 ? 6 : run >= 30 ? 5 : run >= 21 ? 4 : run >= 14 ? 3 : run >= 7 ? 2 : 1)
const HEAT_WEEKS = 18

type HeatCell = { cls: string; tip: string } | null

function quitHeat(h: HabitDef, slips: HabitSlip[]): HeatCell[] {
  const slipped = slipDays(slips, h.id)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const info = new Map<string, { cls: string; tip: string }>()
  if (h.quitSince) {
    const [y, m, d] = h.quitSince.split('-').map(Number)
    let run = 0
    for (const cur = new Date(y, m - 1, d); cur <= today; cur.setDate(cur.getDate() + 1)) {
      const key = localDateKey(cur)
      if (slipped.has(key)) {
        const f = fallOf(run)
        info.set(key, { cls: `is-r${f.lvl}`, tip: `${shortDate(key)}: slipped after ${run} ${run === 1 ? 'day' : 'days'}. ${f.label}` })
        run = 0
      } else {
        run++
        info.set(key, { cls: `is-g${strengthLvl(run)}`, tip: `${shortDate(key)}: clean day ${run}` })
      }
    }
  }
  const dow = (today.getDay() + 6) % 7
  const first = (HEAT_WEEKS - 1) * 7 + dow
  const out: HeatCell[] = []
  for (let i = 0; i < HEAT_WEEKS * 7; i++) {
    const c = new Date(today); c.setDate(c.getDate() - (first - i))
    if (c > today) { out.push(null); continue }
    const key = localDateKey(c)
    out.push(info.get(key) ?? { cls: 'is-before', tip: `${shortDate(key)}: before you started` })
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
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent).detail === 'quitting') setAdding(true) }
    window.addEventListener('hg:add', on)
    return () => window.removeEventListener('hg:add', on)
  }, [])
  const [editHabit, setEditHabit] = useState<HabitDef | null>(null)

  /* Ranked by how long it has held. That is the scoreboard, and a page that
     ordered them any other way would be hiding the only number that matters. */
  const quits = habits
    .filter((h) => h.kind === 'break' && !h.archivedAt)
    .map((h) => ({ h, clean: daysClean(h, slips) ?? 0, best: bestCleanRun(h, slips), slipped: slipCount(h, slips) }))
    .sort((a, b) => b.clean - a.clean)

  const standing = quits.reduce((a, q) => a + q.clean, 0)

  return (
    <div className="page">
      <Band
        title="Quitting"
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
              const heat = quitHeat(h, slips)
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

                  {/* Eighteen weeks, one column a week. Green deepens with the
                      length of the clean run; a fall is red, darker the earlier
                      in a run it came. */}
                  <div className="qheat">
                    {heat.map((c, i) => c
                      ? <i className={c.cls} key={i} title={c.tip} />
                      : <i className="is-none" key={i} />)}
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

