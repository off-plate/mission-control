/* THE HEALTH PAGE.

   Colour from Apple Health, structure from this app, instruments from his own
   Zepp dashboard. It follows the theme -- paper by default, dark only when the
   HUD is -- and every reading states the day it was taken.

   Rebuilt on his second pass (2026-09-10), which was a list of real faults:
   the range opened on 90 days when he wanted the week; the chart named three
   dates across a quarter instead of drawing days; it could not be hovered; a
   90-day range put hundreds of session rows on one page; "+4 more" said there
   was more and then would not show it; effort was nowhere, though it is the
   one number the watch is actually measuring; the rows were mostly empty
   space; Body sat so far down it was unreachable, and ignored the range
   entirely, so a number on it could have been today or June and there was no
   way to tell; and the sync line could not be dismissed. */
import { useMemo, useState } from 'react'
import {
  agoFrom, bodyStat, daysSince, fmtDay, fmtDayFull, fmtHm, fmtWeekday, frames, freshness,
  rollUpByDay, totals, useHealth, useHealthSync, withinDays,
  type DayFrame, type MetricKey, type SessionDay, type WellnessDay,
} from './health'
import * as Icon from './icons'

const SPANS = [
  { id: 7, label: '7D' },
  { id: 30, label: '30D' },
  { id: 90, label: '90D' },
  { id: 365, label: '1Y' },
]

const ACCENT = {
  train: 'var(--hp-train)',
  cardio: 'var(--hp-cardio)',
  sleep: 'var(--hp-sleep)',
  move: 'var(--hp-move)',
  body: 'var(--hp-body)',
}

/* ---------------------------------------------------------------- *
 * THE CHART. Bars are the days he trained, the line is what those
 * days did to his fitness, and both are on the same day axis so the
 * cause sits under the effect. Hovering names the day and reads out
 * both numbers, because a chart you cannot interrogate is a picture.
 * ---------------------------------------------------------------- */
function DayChart({ rows, span }: { rows: DayFrame[]; span: number }) {
  const [at, setAt] = useState<number | null>(null)
  const W = 1000
  const H = 200
  const PAD_B = 26

  const loads = rows.map((r) => r.load)
  const maxLoad = Math.max(1, ...loads)
  const ctls = rows.map((r) => r.ctl).filter((v): v is number => v != null)
  const maxCtl = ctls.length ? Math.max(...ctls) : 0
  const minCtl = ctls.length ? Math.min(...ctls) : 0
  const ctlRange = maxCtl - minCtl || 1

  const plotH = H - PAD_B
  const slot = W / rows.length
  const barW = Math.max(1.5, Math.min(26, slot * 0.62))
  const cx = (i: number) => i * slot + slot / 2
  const barTop = (v: number) => plotH - (v / maxLoad) * (plotH - 12)
  const ctlY = (v: number) => 10 + (1 - (v - minCtl) / ctlRange) * (plotH - 26)

  const ctlPath = rows
    .map((r, i) => (r.ctl == null ? null : `${i === 0 || rows[i - 1].ctl == null ? 'M' : 'L'} ${cx(i).toFixed(1)} ${ctlY(r.ctl).toFixed(1)}`))
    .filter(Boolean)
    .join(' ')

  const peakIdx = rows.reduce<number>((acc, r, i) => (r.ctl != null && (acc < 0 || (rows[acc].ctl ?? 0) < r.ctl) ? i : acc), -1)
  const hardestIdx = rows.reduce<number>((acc, r, i) => (r.load > (rows[acc]?.load ?? -1) ? i : acc), 0)

  /* Every day gets a label when there are few enough to read; after that,
     roughly six, always including the last. */
  const every = Math.max(1, Math.ceil(rows.length / 7))
  const shown = at != null ? rows[at] : null

  return (
    <div className="hp-daychart">
      <div className="hp-daychart-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Training load and fitness, ${rows.length} days`}
          onMouseLeave={() => setAt(null)}
        >
          {[0.5, 1].map((f) => (
            <line key={f} className="hp-grid-line" x1="0" y1={plotH - f * (plotH - 12)} x2={W} y2={plotH - f * (plotH - 12)} />
          ))}
          <line className="hp-grid-line is-base" x1="0" y1={plotH} x2={W} y2={plotH} />

          {rows.map((r, i) => (
            <g key={r.day}>
              {r.load > 0 && (
                <rect
                  className={`hp-bar${i === hardestIdx ? ' is-hardest' : ''}`}
                  x={cx(i) - barW / 2}
                  y={barTop(r.load)}
                  width={barW}
                  height={Math.max(2, plotH - barTop(r.load))}
                  rx={Math.min(4, barW / 2)}
                />
              )}
              {/* One target per day, full height, so a thin bar is still easy
                  to hit and an empty day can still be read. */}
              <rect
                className="hp-hit"
                x={i * slot}
                y="0"
                width={slot}
                height={plotH}
                onMouseEnter={() => setAt(i)}
                onFocus={() => setAt(i)}
                tabIndex={-1}
              />
            </g>
          ))}

          {ctlPath && <path className="hp-ctl-line" d={ctlPath} />}
          {peakIdx >= 0 && rows[peakIdx].ctl != null && (
            <circle className="hp-ctl-peak" cx={cx(peakIdx)} cy={ctlY(rows[peakIdx].ctl as number)} r="4" />
          )}
          {at != null && <line className="hp-cross" x1={cx(at)} y1="0" x2={cx(at)} y2={plotH} />}
        </svg>

        {at != null && shown && (
          /* Inside the plot, never above it: the tile clips its own overflow,
             and a card that hangs over the top edge loses its first two lines.
             It sits low when the day's bar is tall, high when it is not, so
             the reading is never covered by the thing it describes. */
          <div
            className={`hp-tipcard${shown.load / maxLoad > 0.55 ? ' is-low' : ''}`}
            style={{ left: `${Math.min(88, Math.max(12, ((at + 0.5) / rows.length) * 100))}%` }}
          >
            <b>{fmtDayFull(shown.day)}</b>
            {shown.parts > 0 ? (
              <>
                <span><i style={{ background: 'var(--hp-train)' }} />{shown.load} effort</span>
                <span>{fmtHm(shown.minutes)}{shown.avgHr ? `, ${shown.avgHr} bpm` : ''}</span>
                <span>{shown.calories.toLocaleString('en-GB')} kcal, {shown.parts} {shown.parts === 1 ? 'session' : 'sessions'}</span>
              </>
            ) : (
              <span>Nothing logged</span>
            )}
            {shown.ctl != null && <span><i style={{ background: 'var(--hp-move)' }} />fitness {shown.ctl.toFixed(1)}</span>}
          </div>
        )}

        <div className="hp-daychart-y">
          <span>{maxLoad}</span>
          <span>{Math.round(maxLoad / 2)}</span>
          <span>0</span>
        </div>
      </div>

      <div className="hp-daychart-x" style={{ gridTemplateColumns: `repeat(${rows.length}, 1fr)` }}>
        {rows.map((r, i) => (
          <span key={r.day} className={at === i ? 'is-on' : undefined}>
            {i % every === 0 || i === rows.length - 1
              ? (span <= 14 ? fmtWeekday(r.day) : fmtDay(r.day))
              : ''}
          </span>
        ))}
      </div>

      <div className="hp-daychart-key">
        <span><i style={{ background: 'var(--hp-train)' }} />effort a day</span>
        <span><i className="is-line" style={{ background: 'var(--hp-move)' }} />fitness</span>
        {peakIdx >= 0 && rows[peakIdx].ctl != null && (
          <span className="hp-key-peak">peak {(rows[peakIdx].ctl as number).toFixed(1)} on {fmtDay(rows[peakIdx].day)}</span>
        )}
      </div>
    </div>
  )
}

function Ring({ pct, label, value, sub }: { pct: number; label: string; value: string; sub: string }) {
  const r = 52
  const c = 2 * Math.PI * r
  const shown = Math.max(0, Math.min(1, pct))
  return (
    <div className="hp-ring">
      <svg viewBox="0 0 130 130" role="img" aria-label={`${label}: ${value}, ${sub}`}>
        <defs>
          <linearGradient id="hp-ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--hp-train)" />
            <stop offset="100%" stopColor="var(--hp-train-soft)" />
          </linearGradient>
        </defs>
        <circle cx="65" cy="65" r={r} fill="none" stroke="var(--hp-ring-track)" strokeWidth="13" />
        <circle
          className="hp-ring-arc"
          cx="65" cy="65" r={r} fill="none"
          stroke="url(#hp-ring-grad)" strokeWidth="13" strokeLinecap="round"
          strokeDasharray={`${(c * shown).toFixed(1)} ${c.toFixed(1)}`}
          transform="rotate(-90 65 65)"
        />
      </svg>
      <div className="hp-ring-mid">
        <b>{value}</b>
        <span>{label}</span>
      </div>
    </div>
  )
}

function Age({ day }: { day: string | null }) {
  if (!day) return <span className="hp-age is-none">never</span>
  const age = daysSince(day)
  const state = freshness(age)
  const text = age === 0 ? 'today' : age === 1 ? 'yesterday' : age < 60 ? `${age} days ago` : fmtDay(day)
  return <span className={`hp-age is-${state}`}>{text}</span>
}

function Tile({ accent, label, value, unit, sub }: {
  accent: string; label: string; value: string; unit?: string; sub?: React.ReactNode
}) {
  return (
    <div className="hp-tile" style={{ ['--hp-accent' as string]: accent }}>
      <div className="hp-label"><i className="hp-dot" />{label}</div>
      <div className="hp-value">{value}{unit ? <em>{unit}</em> : null}</div>
      {sub ? <div className="hp-sub">{sub}</div> : null}
    </div>
  )
}

/* A body reading, and what it actually is. Inside the range it is an average
   over however many readings there were; outside it, the page says so and
   falls back to naming the last real one and its date. */
function BodyTile({ days, metric, accent, label, span, format }: {
  days: WellnessDay[]; metric: MetricKey; accent: string; label: string; span: number; format: (v: number) => string
}) {
  const s = bodyStat(days, metric, span)
  const has = s.inRange.length > 0
  return (
    <div className="hp-tile" style={{ ['--hp-accent' as string]: accent }}>
      <div className="hp-label"><i className="hp-dot" />{label}</div>
      {has ? (
        <>
          <div className="hp-value">{format(s.avg as number)}</div>
          <div className="hp-sub">
            average of {s.inRange.length} {s.inRange.length === 1 ? 'reading' : 'readings'} in this range
          </div>
          <div className="hp-bodyrange">
            <span>low {format(s.lo as number)}</span>
            <span>high {format(s.hi as number)}</span>
          </div>
        </>
      ) : (
        <>
          <div className="hp-value is-quiet">None</div>
          <div className="hp-sub">nothing in this range</div>
          <div className="hp-bodyrange">
            {s.last
              ? <span>last read {format(s.last.value)} on {fmtDay(s.last.day)}, <Age day={s.last.day} /></span>
              : <span>the watch has never reported this</span>}
          </div>
        </>
      )}
    </div>
  )
}

/* One day of training, openable. The parts are real rows the watch filed
   separately -- his gym session arrives as six fragments -- and "+4 more"
   promising them without showing them was the complaint. */
function DayRow({ d, hardest }: { d: SessionDay; hardest: number }) {
  const [open, setOpen] = useState(false)
  const effort = hardest > 0 ? Math.min(1, d.load / hardest) : 0
  return (
    <li className={`hp-day${open ? ' is-open' : ''}`}>
      <button className="hp-day-main" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="hp-day-date">
          <b>{new Date(`${d.day}T12:00:00`).getDate()}</b>
          <span>{fmtWeekday(d.day)}</span>
        </span>

        <span className="hp-day-mid">
          <span className="hp-day-title">{d.title}</span>
          <span className="hp-day-meta">
            <span className="hp-day-type">{d.type}</span>
            {d.parts > 1 && (
              <span className="hp-day-parts">
                <Icon.ChevronDown size={11} className={open ? 'hp-chev is-open' : 'hp-chev'} />
                {d.parts} sessions
              </span>
            )}
          </span>
        </span>

        <span className="hp-day-stats">
          <span className="hp-stat"><b>{fmtHm(d.minutes)}</b><i>moving</i></span>
          {d.avgHr != null && <span className="hp-stat"><b>{d.avgHr}</b><i>avg bpm</i></span>}
          {d.maxHr != null && <span className="hp-stat"><b>{d.maxHr}</b><i>peak bpm</i></span>}
          <span className="hp-stat"><b>{d.calories.toLocaleString('en-GB')}</b><i>kcal</i></span>
        </span>

        <span className="hp-day-effort" title={`Effort ${d.load}`}>
          <span className="hp-effort-num">{d.load}</span>
          <span className="hp-effort-bar"><i style={{ width: `${Math.round(effort * 100)}%` }} /></span>
          <span className="hp-effort-cap">effort</span>
        </span>
      </button>

      {open && (
        <ul className="hp-parts">
          {d.items.map((s) => (
            <li key={s.id}>
              <span className="hp-part-time">
                {s.start_date_local ? new Date(s.start_date_local).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
              <span className="hp-part-name">{s.name ?? s.type ?? 'Session'}</span>
              <span className="hp-part-nums">
                {s.moving_time ? `${Math.round(s.moving_time / 60)}m` : 'no time'}
                {s.average_heartrate ? `, ${Math.round(s.average_heartrate)} bpm` : ''}
                {s.calories ? `, ${Math.round(s.calories)} kcal` : ''}
                {s.icu_training_load ? `, ${Math.round(s.icu_training_load)} effort` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export function HealthPage() {
  const { state, reload } = useHealth()
  const { sync, start, clear } = useHealthSync()
  /* The week, on his instruction. A quarter was never the thing he opens this
     to look at. */
  const [span, setSpan] = useState(7)

  const days = state.status === 'ok' ? state.days : []
  const sessions = state.status === 'ok' ? state.sessions : []
  const lastRun = state.status === 'ok' ? state.lastRun : null
  const busySync = sync.phase === 'asking' || sync.phase === 'running'

  const view = useMemo(() => {
    const allDays = rollUpByDay(sessions)
    const nowDays = withinDays(allDays, span)
    const prevDays = allDays.filter((d) => {
      const age = daysSince(d.day)
      return age >= span && age < span * 2
    })
    return {
      rows: frames(days, allDays, span),
      allDays,
      nowDays,
      now: totals(nowDays),
      prev: totals(prevDays),
      hardest: Math.max(0, ...allDays.map((d) => d.load)),
    }
  }, [days, sessions, span])

  const fitness = days.reduce<{ day: string; value: number } | null>((acc, d) => (d.ctl != null ? { day: d.day, value: d.ctl } : acc), null)
  const peak = days.reduce((m, d) => (d.ctl != null && d.ctl > m ? d.ctl : m), 0)
  const lastSession = view.allDays[0] ?? null
  const ramp = days.length ? days[days.length - 1].ramp_rate : null

  const trend = (now: number, before: number) => {
    if (!before) return null
    const pct = Math.round(((now - before) / before) * 100)
    return <span className={`hp-delta ${pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'}`}>{pct > 0 ? '+' : ''}{pct}%</span>
  }

  return (
    <div className="page">
      <div className="hp">
        <header className="hp-head">
          <div>
            <h1 className="hp-title">Health</h1>
            <p className="hp-since">
              {lastSession
                ? <>Last session {fmtDay(lastSession.day)}, <Age day={lastSession.day} /></>
                : 'No sessions on record.'}
              {lastRun && <span className="hp-since-sync">Synced {agoFrom(lastRun.ran_at)}</span>}
            </p>
          </div>
          <div className="hp-head-right">
            <div className="hp-tabs" role="tablist" aria-label="Range">
              {SPANS.map((s) => (
                <button
                  key={s.id}
                  role="tab"
                  aria-selected={span === s.id}
                  className={`hp-tab${span === s.id ? ' is-on' : ''}`}
                  onClick={() => setSpan(s.id)}
                >{s.label}</button>
              ))}
            </div>
            <button className="hp-sync" onClick={start} disabled={busySync} title="Fetch everything new from Intervals.icu">
              <Icon.Repeat size={13} className={busySync ? 'hp-spin' : undefined} />
              {busySync ? 'Syncing' : 'Sync'}
            </button>
          </div>
        </header>

        {sync.phase !== 'idle' && (
          <p className={`hp-syncline is-${sync.phase}`}>
            <span>
              {sync.phase === 'asking' && 'Asking the worker to run…'}
              {sync.phase === 'running' && 'Running. It usually lands within a minute.'}
              {sync.phase === 'done' && `Synced ${sync.run.wellness_rows ?? 0} days and ${sync.run.activity_rows ?? 0} sessions.`}
              {sync.phase === 'failed' && sync.message}
            </span>
            {!busySync && (
              <button className="hp-syncline-x" onClick={clear} aria-label="Dismiss">
                <Icon.Close size={12} />
              </button>
            )}
          </p>
        )}

        {state.status === 'off' && <p className="hp-empty">Sync is off on this device.</p>}
        {state.status === 'signed-out' && <p className="hp-empty">Not signed in on this device.</p>}
        {state.status === 'loading' && <p className="hp-empty">Reading the watch…</p>}
        {state.status === 'empty' && <p className="hp-empty">Nothing has synced from Intervals.icu yet.</p>}
        {state.status === 'error' && (
          <p className="hp-empty">
            {state.message}
            <button className="hp-retry" onClick={reload}>Try again</button>
          </p>
        )}

        {state.status === 'ok' && (
          <>
            <div className="hp-tile hp-hero" style={{ ['--hp-accent' as string]: ACCENT.train }}>
              <div className="hp-label"><i className="hp-dot" />Fitness and effort</div>
              <div className="hp-hero-body">
                <div className="hp-hero-side">
                  <Ring
                    pct={peak ? (fitness?.value ?? 0) / peak : 0}
                    label="of peak"
                    value={fitness ? fitness.value.toFixed(1) : 'None'}
                    sub={peak ? `peak ${peak.toFixed(1)}` : 'no peak yet'}
                  />
                  <div className="hp-hero-lines">
                    <div className="hp-hero-line">
                      <b>{peak ? Math.round(((fitness?.value ?? 0) / peak) * 100) : 0}%</b>
                      <span>of your {peak.toFixed(1)} peak</span>
                    </div>
                    {ramp != null && (
                      <div className="hp-hero-line">
                        <b className={ramp < 0 ? 'is-down' : 'is-up'}>{ramp > 0 ? '+' : ''}{ramp.toFixed(2)}</b>
                        <span>ramp rate a week</span>
                      </div>
                    )}
                    <div className="hp-hero-line">
                      <b>{view.now.days}</b>
                      <span>days trained of {span}</span>
                    </div>
                  </div>
                </div>
                <div className="hp-hero-chart">
                  <DayChart rows={view.rows} span={span} />
                </div>
              </div>
            </div>

            <div className="hp-grid">
              <Tile
                accent={ACCENT.cardio}
                label="Sessions"
                value={String(view.now.sessions)}
                sub={<>on {view.now.days} {view.now.days === 1 ? 'day' : 'days'} {trend(view.now.sessions, view.prev.sessions)}</>}
              />
              <Tile
                accent={ACCENT.move}
                label="Time"
                value={fmtHm(view.now.minutes)}
                sub={<>moving {trend(view.now.minutes, view.prev.minutes)}</>}
              />
              <Tile
                accent={ACCENT.cardio}
                label="Calories"
                value={view.now.calories.toLocaleString('en-GB')}
                unit="kcal"
                sub={<>burned {trend(view.now.calories, view.prev.calories)}</>}
              />
              <Tile
                accent={ACCENT.train}
                label="Effort"
                value={String(view.now.load)}
                sub={<>training load {trend(view.now.load, view.prev.load)}</>}
              />
            </div>

            {/* Body sits here, not at the bottom: it was unreachable down
                there, and it is the half of this page that is about him
                rather than about his training. */}
            <section className="hp-section">
              <h2 className="hp-h2">Body, over this range</h2>
              <div className="hp-grid">
                <BodyTile days={days} metric="steps" accent={ACCENT.move} label="Steps" span={span} format={(v) => Math.round(v).toLocaleString('en-GB')} />
                <BodyTile days={days} metric="sleep_secs" accent={ACCENT.sleep} label="Sleep" span={span} format={(v) => `${(v / 3600).toFixed(1)}h`} />
                <BodyTile days={days} metric="resting_hr" accent={ACCENT.cardio} label="Resting HR" span={span} format={(v) => `${Math.round(v)}`} />
                <BodyTile days={days} metric="weight" accent={ACCENT.body} label="Weight" span={span} format={(v) => `${v.toFixed(1)}kg`} />
              </div>
            </section>

            <section className="hp-section">
              <h2 className="hp-h2">
                Sessions
                <span className="hp-h2-count">{view.nowDays.length} {view.nowDays.length === 1 ? 'day' : 'days'}</span>
              </h2>
              {view.nowDays.length === 0 ? (
                <p className="hp-empty hp-empty-flat">Nothing logged in this range.</p>
              ) : (
                <ul className="hp-days">
                  {view.nowDays.map((d) => <DayRow key={d.day} d={d} hardest={view.hardest} />)}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
