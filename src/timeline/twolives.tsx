import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useStore } from '../store'
import { dayOf, daysSince, useHealth } from '../health'
import {
    countdown, debtCard, goalArcs, goalsCard, habitRings, habitsCard, healthCard, postponedCard,
    quittingCard, routineTrack, routinesCard, score, slipSeries, trainingGrid,
} from '../giveupstatus'
import { AgeRange, Arcs, Heat, Orbit, Panel, Read, Rows, Slips, Stops, Wheel } from '../giveuppanel'
import { type CompassMoney } from '../compass'
import { reelPool } from '../reels'
import { restoreFolder, type FolderState, type LocalReel } from '../localreels'
import { useSessionMinutes } from './shared'
import { Reel, ReelLibrary } from './reel'

/* -------------------------------------------------------------- two lives */


/* ---- the reel ---- */

/** Fisher-Yates. A fresh permutation of 0..len-1, so playing it start to
 *  finish touches every index once, in an order nobody could predict. */
export function shuffledOrder(len: number): number[] {
  const arr = Array.from({ length: len }, (_, i) => i)
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/* The folder on his own machine, read once per visit and shared by the room
   and the library so they cannot disagree about what is in it. Restoring
   never prompts: a browser only grants this off a real click, so a page load
   that asked would simply be refused. */
/* A stable empty array: a new [] every render would re-run the pool memo and
   restart the clip on every keystroke elsewhere on the screen. */
export const EMPTY_LOCAL: LocalReel[] = []

export function useLocalFolder() {
  const [state, setState] = useState<FolderState>({ status: 'none' })
  useEffect(() => { void restoreFolder().then(setState) }, [])
  return { state, setState }
}

export function useReelPool(localReels: LocalReel[] = []): string[] {
  const { reels, twoLives } = useStore()
  return useMemo(() => {
    /* Anything set under the old one-link-per-stop shape joins the library
       rather than being stranded in a field nothing reads any more. */
    const old = Object.values(twoLives ?? {}).filter(Boolean)
    /* His folder goes FIRST. Those are the clips he chose deliberately and
       downloaded himself; a link that may or may not resolve should not push
       them down the queue. Blob URLs are per-visit, so they never reach the
       synced library -- the folder is the record, not a list of URLs. */
    return [...localReels.map((r) => r.url), ...reelPool([...(reels ?? []), ...old])]
  }, [reels, twoLives, localReels])
}

/** A blob: URL means nothing to look at -- "which one is stuck" needs the file
 *  name it actually came from, not the handle React is holding it by. */
export function useLocalNames(localReels: LocalReel[]): Map<string, string> {
  return useMemo(() => new Map(localReels.map((r) => [r.url, r.name])), [localReels])
}

/* ---- what it costs, what it pays ---- */


/* THE NEGATIVE ROAD, his own document, his own numbers, adjusted to fit the
   six horizons this screen already has rather than his original nine
   milestones -- not a prediction, a worst-case trajectory built from
   continuing the current pattern: inconsistency, procrastination, financial
   pressure, debt, poor habits, insufficient exercise, fragmented attention,
   repeatedly restarting instead of staying the course. Every number in it is
   illustrative, his own word for it, not guaranteed. He asked for it exactly
   as written, specifics included, fully aware this file is public. Discipline
   here is his own SELF-RESPECT scale, verbatim: 100/80/60/40/20/0%, each with
   the line he wrote for that rung. */

/* ---- the screen ---- */
/* THE GIVE-UP SCREEN. Reel on the left, where he actually is on the right.

   Rebuilt 2026-09-12 on his instruction. What was here: a slider from today to
   February 2027 with stops along it, driving two projected futures. He asked
   for the slider and its stops gone, the left side kept, and "widgets of
   current status" in their place -- debt, health, the tasks he is postponing,
   goals, the habits he is not doing or keeps failing to quit, the routines he
   keeps breaking.

   That is the right trade. A projection argues about a day that has not
   happened; at the moment he is about to drop something, what carries weight
   is the day that has. Every figure below is counted from his own rows, and
   none of them is chosen to be encouraging. */
export function TwoLives({ onBack, money }: { onBack: () => void; money: CompassMoney | null }) {
  const { habits, habitLog, goals, tasks, routines, routineLog, slips } = useStore()
  const health = useHealth().state
  const folder = useLocalFolder()
  const localReels = folder.state.status === 'ready' ? folder.state.reels : EMPTY_LOCAL
  const pool = useReelPool(localReels)
  const localNames = useLocalNames(localReels)
  const [lib, setLib] = useState(false)
  /* A shuffled pass through the WHOLE pool, not a fresh coin-flip on every
     Next. His report (2026-09-27): picking "any other index" at random let
     the fourth or fifth spin repeat something already seen, and a link he
     had just added could go many spins without ever coming up -- the
     birthday paradox, not a bug in what was IN the pool. One order per pass
     guarantees every clip plays exactly once before any of them plays
     twice, and a fresh pass is dealt on mount (this screen unmounts on
     every close, see the `lives ?` above, so opening it again is a reload
     in every sense he means the word) and again whenever the pool's actual
     CONTENT changes -- keyed on the joined URLs, not the array reference,
     because a sync pull hands back a new-but-equal array on every unrelated
     change elsewhere in the blob (see mundiplayer.tsx's note on the same
     failure mode) and reshuffling on THAT would restart the pass and repeat
     a clip he just saw. */
  const poolKey = pool.join('\n')
  const [order, setOrder] = useState<number[]>(() => shuffledOrder(pool.length))
  const [pos, setPos] = useState(0)
  const poolKeyRef = useRef(poolKey)
  useEffect(() => {
    if (poolKeyRef.current === poolKey) return
    poolKeyRef.current = poolKey
    setOrder(shuffledOrder(pool.length))
    setPos(0)
  }, [poolKey, pool.length])
  const advanceReel = () => setPos((p) => {
    const len = order.length
    if (len <= 1) return p
    if (p + 1 < len) return p + 1
    // End of the pass: deal a new one, and never open it on a repeat of
    // the clip that just finished.
    const fresh = shuffledOrder(len)
    if (fresh[0] === order[p]) [fresh[0], fresh[1]] = [fresh[1], fresh[0]]
    setOrder(fresh)
    return 0
  })
  const backReel = () => setPos((p) => {
    const len = order.length
    return len <= 1 ? p : (p - 1 + len) % len
  })
  const url = order.length ? (pool[order[pos] ?? 0] ?? pool[0] ?? '') : ''
  /* Measured from the real clip (see Reel's onRatio); null -- between clips,
     or for YouTube/Vimeo, which this can't measure -- falls back to 9:16
     rather than freezing the previous clip's shape. */
  const [reelRatio, setReelRatio] = useState<number | null>(null)

  const clock = useMemo(() => countdown(), [])

  const sessionDays = useMemo(
    () => (health.status === 'ok' ? health.sessions.map(dayOf).filter(Boolean) : []),
    [health],
  )

  /* One dataset, not filtered by whichever workspace tab is open -- the same
     rule the rest of this page follows. */
  const sessionMins = useSessionMinutes()

  /* Every domain on one 0..1 scale, so the wheel can average them. Each is
     the plain reading of its own card: what fraction of this is going well. */
  const cards = useMemo(() => {
    const rings = habitRings(habits, habitLog)
    const track = routineTrack(routines, routineLog)
    const arcs = goalArcs(goals)
    const kept = rings.length ? rings.reduce((a, r) => a + r.kept / r.of, 0) / rings.length : 0
    const ran = track.length ? track.filter((r) => !r.dormant).length / track.length : 0
    const goalPct = arcs.length ? arcs.reduce((a, g) => a + g.pct, 0) / arcs.length : 0
    const open = tasks.filter((t) => !t.done)
    const stale = open.filter((t) => t.createdAt && daysSince(t.createdAt) >= 7).length
    const slips30 = slips.filter((s) => daysSince(s.day) < 30).length
    const trained = new Set(sessionDays.filter((d) => daysSince(d) < 30)).size
    return {
      rings, track, arcs, kept, ran, goalPct,
      grid: trainingGrid(sessionDays, sessionMins),
      ages: open
        .filter((t) => t.createdAt && daysSince(t.createdAt) >= 7)
        .map((t) => ({ age: daysSince(t.createdAt as string), what: t.title }))
        .sort((a, b) => b.age - a.age),
      slipSeries: slipSeries(slips),
      list: [
        score(debtCard(money), money ? money.pct / 100 : 0),
        score(healthCard(sessionDays), Math.min(1, trained / 20)),
        score(postponedCard(tasks), open.length ? 1 - stale / open.length : 1),
        score(habitsCard(habits, habitLog), kept),
        score(quittingCard(habits, slips), Math.max(0, 1 - slips30 / 20)),
        score(routinesCard(routines, routineLog), ran),
        score(goalsCard(goals), goalPct),
      ],
    }
  }, [money, sessionDays, sessionMins, tasks, habits, habitLog, slips, routines, routineLog, goals])

  const [debt, training, postponed, habitsC, quitting, routinesC, goalsC] = cards.list

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !lib) { onBack(); return }
      /* His report (2026-09-27): the on-screen Next sits low and off to the
         side, awkward to reach with a click while he's meant to be reading
         the right side, not hunting for a button. The arrow keys are always
         under his hand. Ignored while the library panel is open so typing
         a link that happens to start or end near an arrow key never skips
         the clip out from under him. */
      if (lib) return
      if (e.key === 'ArrowRight') advanceReel()
      if (e.key === 'ArrowLeft') backReel()
    }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [onBack, lib, advanceReel, backReel])

  return (
    <div className="tl-lives">
      {/* His instruction, said three times and finally with a screenshot: full
          browser screen, OVER the navigation, 100vh, not scrollable, and one
          cross top right. It was made inline under the timeline's own header
          so the menu never left the screen; he does not want the menu here,
          he wants the screen. The cross is the way out, plus Escape. */}
      <button className="tl-close" onClick={onBack} aria-label="Close">&#10005;</button>
      <div className="tl-stage" style={{ '--reel-ratio': reelRatio ?? 9 / 16 } as CSSProperties}>
        <Reel url={url} label={localNames.get(url)} count={pool.length} onOpenLibrary={() => setLib(true)} onNext={advanceReel} onRatio={setReelRatio} />
        <div className="tl-status">
          {/* THE COUNTDOWN, his instruction: days, weeks and hours to the
              fourteenth of February. It is the hero because it is the only
              figure here that moves whether he does anything or not. */}
          <div className="tl-head-row">
            <div className="tl-count">
              <span className="tl-count-l">Until {clock.label}</span>
              {/* His ask (2026-09-13): days, weeks and hours the same size,
                  one row -- weeks and hours used to run a full size class
                  down in their own tl-count-sub row underneath, reading as
                  an afterthought under the hero figure rather than three
                  equally true readings of the same distance. Same
                  .tl-count-fig markup for all three now, so a change to
                  one's size or color is a change to all three's. */}
              <div className="tl-count-figs">
                <div className="tl-count-fig">
                  <b>{clock.days.toLocaleString('en-GB')}</b>
                  <span>days</span>
                </div>
                <div className="tl-count-fig">
                  <b>{clock.weeks}</b>
                  <span>weeks</span>
                </div>
                <div className="tl-count-fig">
                  <b>{clock.hours.toLocaleString('en-GB')}</b>
                  <span>hours</span>
                </div>
              </div>
            </div>

            <p className="tl-status-head">Before you do. This is where you actually are.</p>
          </div>

          <div className="gp-grid">
            {/* His pass (2026-09-12): Debt is short -- a figure and a line --
                next to Training and Postponed, which both draw a real chart
                and were stretched to Debt's leftover height for no reason.
                Debt now stacks over Training in the first slot instead of
                spending a whole column on three lines of text, which frees a
                column for Habits to move up next to Postponed. State of life
                keeps its two-column width but sits left now with Quitting
                filling the column it used to leave empty; Goals and Routines
                split the freed third row 50/50 instead of sharing three equal
                thirds with nothing else. */}
            <div className="gp-slot-stack">
              <Panel label="Debt" tone={debt.tone}>
                <Read figure={debt.figure} unit={debt.unit} sub={debt.line} tone={debt.tone} />
              </Panel>

              {/* No sub-line here: "Last session today" / "No session has ever
                  reached this app" duplicates exactly what the heatmap right
                  below it already shows. */}
              <Panel label="Training" tone={training.tone}>
                <Read figure={training.figure} unit={training.unit} tone={training.tone} />
                <Heat days={cards.grid} />
              </Panel>
            </div>

            <Panel label="Postponed" tone={postponed.tone} slot="gp-slot-postponed">
              <Read figure={postponed.figure} unit={postponed.unit} sub={postponed.line} tone={postponed.tone} />
              <AgeRange ages={cards.ages} />
              {postponed.rows?.length ? <div className="gp-scroll"><Rows rows={postponed.rows} /></div> : null}
            </Panel>

            <Panel label="Habits" tone={habitsC.tone} slot="gp-slot-habits">
              <Read figure={habitsC.figure} unit={habitsC.unit} tone={habitsC.tone} />
              <Orbit rings={cards.rings} overall={cards.kept} />
            </Panel>

            <Panel label="State of life" slot="gp-slot-state">
              <Wheel cards={cards.list} />
            </Panel>

            <Panel label="Quitting" tone={quitting.tone} slot="gp-slot-quitting">
              <Read figure={quitting.figure} unit={quitting.unit} sub={quitting.line} tone={quitting.tone} />
              {quitting.rows?.length ? <div className="gp-scroll"><Rows rows={quitting.rows} /></div> : null}
              <Slips series={cards.slipSeries} />
            </Panel>

            <Panel label="Goals" tone={goalsC.tone} slot="gp-slot-goals">
              <Read figure={goalsC.figure} unit={goalsC.unit} sub={goalsC.line} tone={goalsC.tone} />
              {goalsC.rows?.length ? <div className="gp-scroll"><Rows rows={goalsC.rows} /></div> : null}
              <Arcs arcs={cards.arcs} overall={cards.goalPct} />
            </Panel>

            <Panel label="Routines" tone={routinesC.tone} slot="gp-slot-routines">
              <Read figure={routinesC.figure} unit={routinesC.unit} sub={routinesC.line} tone={routinesC.tone} />
              <Stops items={cards.track} />
            </Panel>
          </div>

          <button className="tl-back" onClick={onBack}>Ok. Let&rsquo;s go.</button>
        </div>
      </div>

      {lib && <ReelLibrary pool={pool} folder={folder} onClose={() => setLib(false)} />}
    </div>
  )
}
