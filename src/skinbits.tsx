/* The few pieces a skin draws that Classic never does. Each one only renders
   from TodayRoom, on a phone, while its skin shows, and every number in it is
   one TodayRoom already worked out. Nothing here keeps state of its own. */
import { useStore } from './store'
import { SPACE_LABELS } from './mock'
import { SLOTS, type PageId, type SpaceId, type Task } from './types'
import { fmtDuration, isEstimated, taskMinutes } from './util'

/* A ring of dots, the Nothing timer widget. `on` of `n` dots are lit. */
function DotRing({ n = 40, on, size = 150, red }: { n?: number; on: number; size?: number; red?: boolean }) {
  const r = size / 2 - 5
  return (
    <svg className={`nh-ring${red ? ' is-red' : ''}`} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2
        return <circle key={i} className={i < on ? 'on' : ''} cx={size / 2 + r * Math.cos(a)} cy={size / 2 + r * Math.sin(a)} r={2.6} />
      })}
    </svg>
  )
}

const Dots = ({ n, on, red = -1, cls = '' }: { n: number; on: (i: number) => boolean; red?: number; cls?: string }) => (
  <span className={`nh-dots ${cls}`} aria-hidden="true">
    {Array.from({ length: n }, (_, i) => <i key={i} className={i === red ? 'rd' : on(i) ? 'on' : ''} />)}
  </span>
)

export interface HomeData {
  h: number; m: number; s: number; quarter: number; busy: Set<number>; focusQ: Set<number>
  next: Task | null; start: (t: Task) => void; onClock: Task[]
  kept: number; due: number; focusedMin: number
  routines: { id: string; name: string; total: number; done: number }[]
  goals: { g: { id: string; name: string }; off: boolean; pct: number }[]
  setPage: (p: PageId) => void; now: Date
}

/* Nothing: Today on a phone is a home screen of widgets. Each tile opens the
   page that already does the job. Phase 3: edit mode and the morph. */
export function NothingHome(d: HomeData) {
  const planned = d.onClock.reduce((a, t) => a + taskMinutes(t), 0)
  const perSlot = SLOTS.map((sl) => ({
    id: sl.id, cap: Math.min(12, (sl.to - sl.from) * 2),
    used: Math.round(d.onClock.filter((t) => t.slot === sl.id).reduce((a, t) => a + taskMinutes(t), 0) / 30),
  }))
  const go = (p: PageId) => () => d.setPage(p)
  return (
    <div className="nh">
      <div className="nh-top">
        <span className="nh-date">{d.now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
      </div>
      <div className="nh-grid">
        <button className="nh-t nh-2x2 is-ink nh-clock" onClick={go('calendar')}>
          <DotRing n={48} on={Math.round(((d.h * 60 + d.m) / 1440) * 48)} size={170} />
          <span className="nh-big">{String(d.h).padStart(2, '0')}<br />{String(d.m).padStart(2, '0')}</span>
          <span className="nh-l">Left of today</span>
        </button>
        <button className="nh-t nh-1x1 is-round" onClick={go('zone')}>
          <span className="nh-big nh-sm">{d.focusedMin}</span>
          <span className="nh-l">Focus min</span>
        </button>
        <button className="nh-t nh-1x1 is-round is-ring" onClick={go('habits')}>
          <DotRing n={24} on={d.due ? Math.round((d.kept / d.due) * 24) : 0} size={80} />
          <span className="nh-big nh-sm">{d.kept}</span>
          <span className="nh-l">Kept</span>
        </button>

        <button className="nh-t nh-4x1 nh-day" onClick={go('plan')}>
          <span className="nh-row"><span className="nh-l">The day</span><span className="nh-l">{96 - d.quarter} quarters left</span></span>
          <Dots n={96} cls="nh-96" red={d.quarter} on={(i) => i < d.quarter || d.busy.has(i) || d.focusQ.has(i)} />
        </button>

        {d.next && (
          <div className="nh-t nh-4x1 nh-next">
            <span className="nh-row"><span className="nh-l">Next</span>{isEstimated(d.next) && <span className="nh-l">{fmtDuration(taskMinutes(d.next))}</span>}</span>
            <span className="nh-nextrow">
              <span className="nh-title">{d.next.title}</span>
              <button className="nh-key" onClick={() => d.start(d.next!)}>Start</button>
            </span>
          </div>
        )}

        <button className="nh-t nh-2x2 is-ink" onClick={go('plan')}>
          <span className="nh-l">Planned</span>
          <span className="nh-big nh-md">{fmtDuration(planned) || '0m'}</span>
          <span className="nh-slots">
            {perSlot.map((p) => (
              <span key={p.id} className="nh-slot"><span className="nh-l">{p.id[0]}</span>
                <Dots n={p.cap} on={(i) => i < p.used} red={p.used > p.cap ? p.cap - 1 : -1} />
              </span>
            ))}
          </span>
        </button>
        <button className="nh-t nh-2x2 nh-habits" onClick={go('habits')}>
          <DotRing n={40} on={d.due ? Math.round((d.kept / d.due) * 40) : 0} size={150} />
          <span className="nh-big nh-md">{d.kept} of {d.due}</span>
          <span className="nh-l">Habits kept</span>
        </button>

        {d.routines.slice(0, 2).map((r) => (
          <button key={r.id} className="nh-t nh-2x1" onClick={go('habits')}>
            <span className="nh-l nh-clip">{r.name}</span>
            <span className="nh-row"><Dots n={r.total} on={(i) => i < r.done} /><span className="nh-l">{r.done} of {r.total}</span></span>
          </button>
        ))}

        {d.goals.length > 0 && (
          <button className="nh-t nh-4x1 is-ink nh-goals" onClick={go('goals')}>
            <span className="nh-l">Goals</span>
            {d.goals.slice(0, 3).map(({ g, off, pct }) => (
              <span key={g.id} className="nh-goal">
                <span className="nh-clip">{g.name}</span>
                <Dots n={20} on={(i) => i < Math.round(pct / 5)} />
                <span className={`nh-l${off ? ' is-red' : ''}`}>{off ? 'Needs a push' : `${pct}%`}</span>
              </span>
            ))}
          </button>
        )}
      </div>
    </div>
  )
}

