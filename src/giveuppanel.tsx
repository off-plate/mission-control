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

export function Panel({ label, tone, wide, tall, children }: {
  label: string; tone?: 'good' | 'flat' | 'bad'; wide?: boolean; tall?: boolean; children: ReactNode
}) {
  return (
    <section className={`gp-panel${wide ? ' is-wide' : ''}${tall ? ' is-tall' : ''}`}>
      <header className="gp-head"><i className={`gp-dot is-${tone ?? 'flat'}`} />{label}</header>
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

/* ---- debt: a real pile of coins, drawn ----
   He asked for the coin pile from his reference. That reference is a rendered
   3D picture; this is the same object built from his own figure, so the pile
   is as tall as the debt actually is and the lit coins are the share actually
   paid off. A picture would have looked the same on the day he clears it. */
export function DebtPile({ pct, owed }: { pct: number; owed: number }) {
  /* Columns across, coins up. The tallest stack is the middle of the pile,
     and the whole thing is scaled by what is owed rather than fixed, so
     paying it down visibly lowers the heap. */
  const cols = 15
  const tallest = Math.max(3, Math.min(9, Math.round(3 + (owed / 250000) * 6)))
  const W = 260, H = 108, cw = W / cols
  const rows: { cx: number; cy: number; rx: number; lit: boolean }[] = []
  let total = 0, lit = 0
  for (let i = 0; i < cols; i++) {
    const t = Math.abs(i - (cols - 1) / 2) / ((cols - 1) / 2)
    const n = Math.max(1, Math.round(tallest * (1 - t * t * 0.92)))
    total += n
  }
  const litUpTo = Math.round(total * pct)
  let seen = 0
  for (let i = 0; i < cols; i++) {
    const t = Math.abs(i - (cols - 1) / 2) / ((cols - 1) / 2)
    const n = Math.max(1, Math.round(tallest * (1 - t * t * 0.92)))
    for (let k = 0; k < n; k++) {
      seen++
      rows.push({ cx: cw / 2 + i * cw, cy: H - 12 - k * 5.4, rx: cw * 0.46, lit: seen <= litUpTo })
    }
    if (seen <= litUpTo) lit = seen
  }
  return (
    <div className="gp-coins" aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`}>
        <defs>
          <linearGradient id="gp-coin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3A2A24" />
            <stop offset="100%" stopColor="#140F0D" />
          </linearGradient>
          <linearGradient id="gp-coin-lit" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#C9F24A" />
            <stop offset="100%" stopColor="#6E8A18" />
          </linearGradient>
          <radialGradient id="gp-coin-floor">
            <stop offset="0%" stopColor="var(--tl-no)" stopOpacity="0.5" />
            <stop offset="100%" stopColor="var(--tl-no)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx={W / 2} cy={H - 8} rx={W * 0.46} ry="9" fill="url(#gp-coin-floor)" />
        {/* Back to front, so a coin sits IN FRONT of the one behind it. */}
        {rows.sort((a, b) => b.cy - a.cy).map((c, i) => (
          <g key={i}>
            <ellipse cx={c.cx} cy={c.cy} rx={c.rx} ry={c.rx * 0.34}
              fill={c.lit ? 'url(#gp-coin-lit)' : 'url(#gp-coin)'} />
            <ellipse cx={c.cx} cy={c.cy - 1.4} rx={c.rx} ry={c.rx * 0.34}
              className={c.lit ? 'gp-coin-rim is-lit' : 'gp-coin-rim'} />
          </g>
        ))}
      </svg>
      <div className="gp-coins-scale">
        <span>{lit ? `${Math.round(pct * 100)}% paid` : '0% paid'}</span>
        <span>{Math.round(owed).toLocaleString('cs-CZ')} Kč left</span>
      </div>
    </div>
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
  const S = 200, c = S / 2
  return (
    <div className="gp-orbit">
      <svg viewBox={`0 0 ${S} ${S}`} aria-hidden="true">
        {show.map((r, i) => {
          const rad = 34 + i * 15
          return (
            <g key={r.name}>
              <circle cx={c} cy={c} r={rad} className="gp-orbit-track" />
              {Array.from({ length: r.of }, (_, d) => {
                const a = (d / r.of) * TAU - Math.PI / 2
                const p = pol(c, c, rad, a)
                return <circle key={d} cx={p.x} cy={p.y} r={d < r.kept ? 2.6 : 1.5}
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

/* ---- routines: one stop each along a line ---- */
export function Track({ items }: { items: { name: string; ran: number; of: number; dormant: boolean }[] }) {
  const show = items.slice(0, 4)
  return (
    <div className="gp-track">
      {show.map((r) => (
        <div className={`gp-stop${r.dormant ? ' is-dormant' : ''}`} key={r.name}>
          <span className="gp-stop-name">{r.name}</span>
          <span className="gp-stop-ring">
            <svg viewBox="0 0 44 44" aria-hidden="true">
              <circle cx="22" cy="22" r="17" className="gp-stop-track" />
              <circle cx="22" cy="22" r="17" className="gp-stop-on"
                strokeDasharray={`${TAU * 17 * (r.ran / r.of)} ${TAU * 17}`}
                transform="rotate(-90 22 22)" />
            </svg>
          </span>
          <span className="gp-stop-state">{r.dormant ? 'dormant' : 'on track'}</span>
          <span className="gp-stop-n">{r.ran}/{r.of}</span>
        </div>
      ))}
    </div>
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
