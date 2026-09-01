/* THE FLOATING TIMELINE SUMMARY. His ask (2026-09-03): Timeline joins Note
   and Bills in the dock, on the same terms -- a compact glance, not a port
   of the page. timeline.tsx is 900+ lines (the ladder, the flywheel canvas
   view, video reels, day cards) -- cramming that into a 560px face would be
   the same bad trade Bills' full page would have been. What's glanceable
   here is the same headline the page itself leads with: the promise
   sentence, the chain, and the momentum score underneath it -- so that's
   what this shows, reusing chainPromiseLine/momentumRun/momentumNow/
   chainOf/WINDOW straight from timeline.tsx and momentum.ts rather than a
   second copy of either the wording or the math. */
import { useMemo, type ReactNode } from 'react'
import { useStore } from './store'
import { useCompass } from './compass'
import { chainOf, momentumRun, momentumNow, stateFor, HARD_MIN_DAYS } from './momentum'
import { chainPromiseLine, WINDOW } from './timeline'
import { SPACE_LABELS } from './mock'
import * as Icon from './icons'

const hm = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`
const kc = (n: number) => Math.round(n).toLocaleString('cs-CZ')

export function TimelineChip() {
  return <Icon.Rewind size={16} />
}

export function TimelinePanel({ dockControls, onOpenFull }: { dockControls?: ReactNode; onOpenFull?: () => void }) {
  const { setPage, view, habits, habitLog, tasks, focusSessions, inView } = useStore()
  const compass = useCompass().state
  /* His report (2026-09-03): the same real chain/momentum read as
     "not real" and swung wildly between two checks minutes apart. Traced
     it with an isolated test against the real momentumRun/chainOf
     (synthetic multi-space data, no live account touched): the space
     filter itself is correct -- a space with no activity in view
     genuinely scores zero, same as it should. What's missing is that this
     panel never says WHICH space it's reading. The full Timeline page
     sits right under the visible space tabs, so which one is active is
     never in question there; the dock floats over everything with no
     such cue, so the exact same real numbers looked "wrong" purely
     because which workspace they belonged to wasn't shown anywhere. */
  const spaceLabel = view === 'all' ? 'All' : SPACE_LABELS[view]

  const run = useMemo(
    () => momentumRun({ habits, habitLog, tasks, focusSessions, inView }, WINDOW),
    [habits, habitLog, tasks, focusSessions, inView],
  )
  const now = momentumNow(run)
  const chain = chainOf(run)
  const money = compass.status === 'ok' ? compass.money : null
  const hardTotal = run.filter((r) => r.hard).length
  const focusTotal = run.reduce((a, r) => a + r.counts.focusMin, 0)
  const paidTotal = money ? Object.values(money.byDay).reduce((a, d) => a + d.paid, 0) : null

  const openFull = () => { setPage('timeline'); onOpenFull?.() }

  return (
    // Reuses Bills' own head/body/rows scaffold (billsdock-*) rather than a
    // third near-identical copy -- the shell (title row, door-out button,
    // a column of label/value rows) is the same shape for any dock summary
    // this small, not something specific to Bills despite the class names.
    <div className="billsdock-panel">
      <div className="billsdock-head">
        {/* Which space this reads, spelled out -- see the note above on why
           an otherwise-correct, space-filtered number read as broken
           without this. */}
        <span className="billsdock-title">Timeline <span className="tldock-unit">&middot; {spaceLabel}</span></span>
        {/* Same real .btn-primary classes as Notes' and Bills' door out --
           see the note on notedock.tsx for why this isn't a hand-rolled
           background. */}
        <button className="btn btn-primary dock-open-btn" onClick={openFull} title="Open Timeline">
          <Icon.ExternalLink size={13} />
          Timeline
        </button>
        {dockControls}
      </div>
      <div className="billsdock-body">
        <p className="tldock-promise">{chainPromiseLine(chain)}</p>
        <div className="billsdock-rows">
          <div className="bdr"><span>Momentum</span><span className="mono">{Math.round(now)} <span className="tldock-unit">of 100 &middot; {stateFor(now)}</span></span></div>
          <div className="bdr"><span>Chain</span><span className="mono">{chain.current} {chain.current === 1 ? 'day' : 'days'}</span></div>
          <div className="bdr"><span>Hard things <span className="tldock-unit">({HARD_MIN_DAYS}+ days carried)</span></span><span className="mono">{hardTotal}</span></div>
          <div className="bdr"><span>Focused</span><span className="mono">{hm(focusTotal)}</span></div>
          {paidTotal !== null && <div className="bdr"><span>Off the debt</span><span className="mono pos">{kc(paidTotal)} Kč</span></div>}
        </div>
      </div>
    </div>
  )
}
