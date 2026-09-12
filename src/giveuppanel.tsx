/* WHERE HE ACTUALLY IS, drawn.

   His reference (2026-09-12): every panel draws its own data instead of
   printing it. A training heatmap, habit rings, a slip chart, goal arcs, a
   routine track, and a wheel in the middle scoring the whole life at once.

   Everything here is SVG over his own numbers. The reference also carried two
   rendered 3D illustrations -- a pile of coins, a mountain range -- and those
   are generated pictures, not data. A picture of a mountain says nothing true
   about how long a task has waited, so those two slots draw from his figures
   instead: the debt as the pile it actually is, the postponed work as the
   ages it actually has. */
import { type ReactNode } from 'react'
import type { Scored, StatusRow } from './giveupstatus'

const TAU = Math.PI * 2
const pol = (cx: number, cy: number, r: number, a: number) => ({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })

export function Panel({ label, tone, wide, children }: {
  label: string; tone?: 'good' | 'flat' | 'bad'; wide?: boolean; children: ReactNode
}) {
  /* His report (2026-09-12): the label owned its own row across every panel
     and bought nothing with the height it took -- the number underneath
     already says what happened, the label only says what it is measuring.
     It sits top right now, aligned with the big figure rather than pushing
     it down, so the height goes to the number and the list, not the caption. */
  return (
    <section className={`gp-panel${wide ? ' is-wide' : ''}`}>
      <span className="gp-head"><i className={`gp-dot is-${tone ?? 'flat'}`} />{label}</span>
      {children}
    </section>
  )
}

export function Read({ figure, unit, sub, tone }: { figure: string; unit?: string; sub?: string; tone?: string }) {
  return (
    <div className="gp-read">
      <b className={`gp-fig is-${tone ?? 'flat'}`}>{figure}</b>
      {unit && <span className="gp-unit">{unit}</span>}
      {sub && <p className="gp-sub">{sub}</p>}
    </div>
  )
}

export function Rows({ rows }: { rows: StatusRow[] }) {
  return (
    <ul className="gp-rows">
      {rows.map((r) => (
        <li key={r.at + r.what}>
          <span className="gp-at">{r.at}</span>
          <span className="gp-what">{r.what}</span>
        </li>
      ))}
    </ul>
  )
}

/* ---- postponed: the range, where every peak is a task's age ----
   His reference draws a mountain range here. A rendered mountain says nothing
   true, so this one IS the data: a ridge per postponed task, its height its
   age, the oldest peak marked. The longer he leaves things, the worse the
   skyline gets, which is the whole point of the panel. */
export function AgeRange({ ages }: { ages: { age: number; what: string }[] }) {
  const W = 260, H = 96, floor = H - 10
  if (!ages.length) return null
  const peak = Math.max(7, ...ages.map((a) => a.age))
  /* Enough ridges to read as a range even when only a few tasks are old, so
     the shape is the ages he has plus their own smaller foothills. */
  const pts = ages.slice(0, 9)
  const step = W / (pts.length + 1)
  const ridge = (scale: number, drop: number) => {
    let d = `M 0 ${floor}`
    pts.forEach((a, i) => {
      const x = step * (i + 1)
      const h = (a.age / peak) * (floor - 14) * scale
      d += ` L ${(x - step * 0.5).toFixed(1)} ${(floor - h * 0.35 - drop).toFixed(1)}`
      d += ` L ${x.toFixed(1)} ${(floor - h - drop).toFixed(1)}`
    })
    return `${d} L ${W} ${floor} Z`
  }
  const topIdx = pts.reduce((b, a, i) => (a.age > pts[b].age ? i : b), 0)
  const topX = step * (topIdx + 1)
  const topY = floor - (pts[topIdx].age / peak) * (floor - 14)
  return (
    <div className="gp-range" aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="gp-ridge-back" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2A1A16" />
            <stop offset="100%" stopColor="#0C0A0A" />
          </linearGradient>
          <linearGradient id="gp-ridge-front" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5A2A1C" />
            <stop offset="100%" stopColor="#100C0B" />
          </linearGradient>
        </defs>
        <path d={ridge(0.72, 0)} fill="url(#gp-ridge-back)" />
        <path d={ridge(1, 0)} fill="url(#gp-ridge-front)" />
        <path d={ridge(1, 0)} className="gp-ridge-lit" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="gp-range-peak" style={{ left: `${(topX / W) * 100}%`, top: `${(topY / H) * 100}%` }}>
        {pts[topIdx].age}d
      </span>
    </div>
  )
}

/* ---- training: a day per cell, seven rows, weeks across ---- */
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export function Heat({ days }: { days: { day: string; minutes: number; on: boolean }[] }) {
  const peak = Math.max(30, ...days.map((d) => d.minutes))
  /* Monday-first rows, so a week reads the way a calendar does. */
  const idx = (day: string) => (new Date(`${day}T12:00:00`).getDay() + 6) % 7
  const weeks: (typeof days[number] | null)[][] = []
  let col: (typeof days[number] | null)[] = Array(7).fill(null)
  days.forEach((d, i) => {
    col[idx(d.day)] = d
    if (idx(d.day) === 6 || i === days.length - 1) { weeks.push(col); col = Array(7).fill(null) }
  })
  return (
    <div className="gp-heat">
      <div className="gp-heat-dow">{DOW.map((d) => <span key={d}>{d}</span>)}</div>
      <div className="gp-heat-grid" style={{ gridTemplateColumns: `repeat(${weeks.length}, 16px)` }}>
        {weeks.map((w, wi) => (
          <div className="gp-heat-col" key={wi}>
            {w.map((d, di) => {
              const lvl = !d || !d.on ? 0 : d.minutes > 0 ? Math.min(4, 1 + Math.floor((d.minutes / peak) * 3)) : 1
              return <i key={di} className={`gp-cell l${lvl}`} title={d ? `${d.day}: ${Math.round(d.minutes)}m` : ''} />
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---- habits: one ring per habit, a dot per day kept ---- */
export function Orbit({ rings, overall }: { rings: { name: string; kept: number; of: number }[]; overall: number }) {
  const show = rings.slice(0, 5)
  /* Half the footprint, his call (2026-09-12): most nights this draws two or
     three thin rings of mostly-dim dots, which read as empty space long
     before they read as a chart. Smaller does not lose information -- there
     was never much of it -- it just stops pretending to be as full as the
     panels next to it. */
  const S = 130, c = S / 2
  return (
    <div className="gp-orbit">
      <svg viewBox={`0 0 ${S} ${S}`} aria-hidden="true">
        {show.map((r, i) => {
          const rad = 22 + i * 10
          return (
            <g key={r.name}>
              <circle cx={c} cy={c} r={rad} className="gp-orbit-track" />
              {Array.from({ length: r.of }, (_, d) => {
                const a = (d / r.of) * TAU - Math.PI / 2
                const p = pol(c, c, rad, a)
                return <circle key={d} cx={p.x} cy={p.y} r={d < r.kept ? 1.8 : 1.05}
                  className={d < r.kept ? 'gp-orbit-on' : 'gp-orbit-off'} />
              })}
            </g>
          )
        })}
      </svg>
      <div className="gp-orbit-mid"><b>{Math.round(overall * 100)}%</b><span>consistency</span></div>
    </div>
  )
}

/* ---- quitting: a slip is a spike, and it is marked ---- */
export function Slips({ series }: { series: { day: string; n: number }[] }) {
  const W = 300, H = 70, peak = Math.max(1, ...series.map((s) => s.n))
  const x = (i: number) => (i / Math.max(1, series.length - 1)) * W
  const y = (n: number) => H - 8 - (n / peak) * (H - 20)
  const d = series.map((s, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(s.n).toFixed(1)}`).join(' ')
  return (
    <div className="gp-slips">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <path className="gp-slips-line" d={d} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="gp-slips-marks">
        {series.map((s, i) => s.n > 0 && (
          <i key={s.day} className="gp-slips-x" style={{ left: `${(x(i) / W) * 100}%`, top: `${(y(s.n) / H) * 100}%` }} />
        ))}
      </div>
      <div className="gp-slips-ends">
        <span>{series[0]?.day.slice(5).replace('-', '/')}</span>
        <span>{series[series.length - 1]?.day.slice(5).replace('-', '/')}</span>
      </div>
    </div>
  )
}

/* ---- goals: an arc each, longest first ---- */
export function Arcs({ arcs, overall }: { arcs: { name: string; pct: number }[]; overall: number }) {
  const show = arcs.slice(0, 5)
  const S = 176, c = S / 2
  return (
    <div className="gp-arcs">
      <svg viewBox={`0 0 ${S} ${S}`} aria-hidden="true">
        {show.map((a, i) => {
          const rad = 28 + i * 13
          const len = TAU * rad
          /* A gap at the bottom so the arcs read as gauges, not rings. */
          const sweep = 0.78
          return (
            <g key={a.name} transform={`rotate(140 ${c} ${c})`}>
              <circle cx={c} cy={c} r={rad} className="gp-arc-track"
                strokeDasharray={`${len * sweep} ${len}`} />
              <circle cx={c} cy={c} r={rad} className="gp-arc-on"
                strokeDasharray={`${len * sweep * a.pct} ${len}`} />
            </g>
          )
        })}
      </svg>
      <div className="gp-arcs-mid"><b>{Math.round(overall * 100)}%</b><span>overall</span></div>
    </div>
  )
}

/* ---- routines: a scrollable list, not a row of rings ----
   His call (2026-09-12): four rings in a row cost more space than the fact
   they carried. This is a list, the same weight as Postponed and Quitting's,
   and it scrolls in place rather than stopping at four -- a fifth routine is
   not less real for arriving after the fold. */
export function Stops({ items }: { items: { name: string; ran: number; of: number; dormant: boolean }[] }) {
  if (!items.length) return null
  return (
    <ul className="gp-stops">
      {items.map((r) => (
        <li key={r.name} className={r.dormant ? 'is-dormant' : undefined}>
          <span className="gp-stop-name">{r.name}</span>
          <span className="gp-stop-n mono">{r.ran}/{r.of}</span>
          <span className="gp-stop-state">{r.dormant ? 'dormant' : 'on track'}</span>
        </li>
      ))}
    </ul>
  )
}

/* ---- the wheel: every domain on one scale, and their average ---- */
export function Wheel({ cards }: { cards: Scored[] }) {
  const S = 300, c = S / 2, R = 84
  const overall = cards.length ? cards.reduce((a, x) => a + x.pct, 0) / cards.length : 0
  return (
    <div className="gp-wheel">
      <svg viewBox={`0 0 ${S} ${S}`} aria-hidden="true">
        <defs>
          <radialGradient id="gp-core">
            <stop offset="0%" stopColor="var(--tl-hot)" stopOpacity="0.20" />
            <stop offset="70%" stopColor="var(--tl-no)" stopOpacity="0.10" />
            <stop offset="100%" stopColor="var(--tl-no)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={c} cy={c} r={R + 24} fill="url(#gp-core)" />
        <circle cx={c} cy={c} r={R} className="gp-wheel-ring" />
        {cards.map((card, i) => {
          const a = (i / cards.length) * TAU - Math.PI / 2
          const at = pol(c, c, R, a)
          const inner = pol(c, c, 26, a)
          return (
            <g key={card.id}>
              <line x1={inner.x} y1={inner.y} x2={at.x} y2={at.y}
                className={`gp-spoke is-${card.tone}`} style={{ opacity: 0.22 + card.pct * 0.5 }} />
              <circle cx={at.x} cy={at.y} r={3.4 + card.pct * 2.4} className={`gp-node is-${card.tone}`} />
            </g>
          )
        })}
      </svg>
      <div className="gp-wheel-mid">
        <span>overall</span>
        <b>{Math.round(overall * 100)}%</b>
        <span>on track</span>
      </div>
      <ul className="gp-legend">
        {cards.map((card, i) => {
          const a = (i / cards.length) * TAU - Math.PI / 2
          const p = pol(50, 50, 56, a)
          return (
            <li key={card.id} className={`is-${card.tone}`} style={{ left: `${p.x}%`, top: `${p.y}%` }}>
              <span className="gp-legend-l">{card.label}</span>
              <b>{Math.round(card.pct * 100)}%</b>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
