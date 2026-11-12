/* THE TIMELINE.

   Three views behind one tab, on his design, revised 2026-08-27 after he read
   the first build.

     THE LADDER   the default. One rung per day, week or month, one column per
                  thing he named, and what the rung was worth.
     THE FLYWHEEL a wheel whose speed IS his momentum, turned by the log rather
                  than by a button, with one card per day beside it.
     TWO LIVES    the give-up screen, over the whole window.

   THE PAGE IS DARK IN BOTH MODES, on his instruction. It keeps a private set of
   `--tl-*` tokens rather than literals, and HUD mode remaps every one of them,
   so the page is the page and the mode is still the mode.

   HIS COLUMNS, in his words: finances, health, tasks, focus, the hard thing.
   Habits sits with them because habits are most of what turns the wheel. Two
   of the seven are read-only and say so on the page rather than in a comment:

     FINANCES  real, from Compass, and not scored. A debt payment is a standing
               order that fires monthly; scoring it would spike the wheel on the
               15th for a decision he made in March.
     HEALTH    real now (2026-08-29), off the Workout / Gym / Fitness habit --
               Hevy syncs into this app directly and ticks it, the same as a
               manual click. Not scored: see the note in momentum.ts for why
               a 25-point bonus landing on the wheel the day he connects a
               tracker is not a call this column gets to make alone. */
import { useMemo, useState } from 'react'
import { useStore } from './store'
import { jarState, useJarState } from './cookiejarnav'
import { dayOf, useHealth } from './health'
import { useCompass } from './compass'
import {
    momentumRun, momentumNow, chainOf, rollUp, type Zoom
} from './momentum'
import { Ladder, Promise, Sums } from './timeline/ladder'
import { Flywheel } from './timeline/flywheel'
import { TwoLives } from './timeline/twolives'
export { chainPromiseLine } from './timeline/ladder'

type View = 'ladder' | 'wheel'

export const WINDOW = 120
const ZOOMS: { id: Zoom; label: string }[] = [
  { id: 'd', label: 'Days' },
  { id: 'w', label: 'Weeks' },
  { id: 'm', label: 'Months' },
]
const ROWS: Record<Zoom, number> = { d: 21, w: 12, m: 6 }
/* His instruction (2026-09-03), after the space switcher made the same real
   chain and momentum score read as "not one real thing" depending which
   tab happened to be active: Timeline is one page and one dataset, full
   stop, never split by workspace regardless of where the space switcher
   sits. Used in place of the store's own space-aware `inView` everywhere
   on this page (the momentum run below, and the goals list inside
   TwoLives further down) -- not a second inView with different rules, a
   deliberate opt-out of the concept entirely for this one page. */
export const inAllSpaces = () => true

export function TimelinePage() {
  const { habits, habitLog, tasks, focusSessions, prospects, setPage } = useStore()
  /* Remembered, so the nav on Health and Why can bring him back to the view
     he left rather than always to the ladder. */
  const { view: jarView, lives } = useJarState()
  const view = jarView as View
  const [zoom, setZoom] = useState<Zoom>('d')
  /* Asked for from Health or Why: open straight onto the give-up screen. */
  const setLives = (v: boolean) => jarState.set({ lives: v })
  const compass = useCompass().state

  /* Days a session was actually recorded, straight from the health pipeline.
     The workout habit still counts when it is ticked; this is the other half,
     so a real session shows here whether or not anything ticked it. */
  const health = useHealth().state
  const trainedDays = useMemo(
    () => new Set(health.status === 'ok' ? health.sessions.map(dayOf).filter(Boolean) : []),
    [health],
  )

  const run = useMemo(
    () => momentumRun({ habits, habitLog, tasks, focusSessions, inView: inAllSpaces, workoutDays: trainedDays, outreach: prospects.flatMap((p) => p.touches) }, WINDOW),
    [habits, habitLog, tasks, focusSessions, trainedDays, prospects],
  )
  const now = momentumNow(run)
  const chain = chainOf(run)
  const money = compass.status === 'ok' ? compass.money : null

  /* Newest first, because the rung he is standing on is today's. */
  const periods = useMemo(() => rollUp(run, zoom).reverse(), [run, zoom])
  const shown = periods.slice(0, ROWS[zoom])

  return (
    <div className="page tline">
      <header className="tl-bar">
        {/* The Cookie Jar, his name for it (2026-09-15), after Goggins: the jar
            of hard things already survived that he reaches into when he wants
            to quit. It stopped being a timeline a while ago, and the one idea
            that holds the record, the body, the reasons and the give-up
            screen together is that one. The address stays #/timeline so
            nothing that links here breaks. */}
        <div className="tl-seg" role="group" aria-label="Zoom">
          {ZOOMS.map((z) => (
            <button key={z.id} className={zoom === z.id ? 'on' : ''} aria-pressed={zoom === z.id} onClick={() => setZoom(z.id)}>{z.label}</button>
          ))}
        </div>
        {/* Everything he steers with sits on the right, on his instruction. */}
        <div className="tl-right">
          <span className="tl-chain">
            <b>{chain.current}</b>
            <span className="tl-l">day chain</span>
          </span>
        </div>
      </header>

      {lives ? (
        /* Inline, under the page's own header, rather than a sheet over the
           whole window. His report (2026-09-12): the overlay took the
           timeline's menu with it, so the only way back was hunting for a
           close button. The header stays, every tab on it still works, and
           the button he came in through now says the way out. */
        <TwoLives onBack={() => setLives(false)} money={money} />
      ) : (
        <>
          <Promise now={now} chain={chain} periods={periods} zoom={zoom} sums={<Sums run={run} chain={chain} now={now} money={money} />} />
          {view === 'ladder' && <Ladder rows={shown} zoom={zoom} money={money} />}
          {view === 'wheel' && <Flywheel rows={shown} zoom={zoom} now={now} money={money} run={run} />}
        </>
      )}
    </div>
  )
}

