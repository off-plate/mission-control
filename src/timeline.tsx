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
     HEALTH    empty until Hevy reaches this app. It shows a dash, never a zero,
               because a zero looks like a fact about his week. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './store'
import { useCompass, type CompassMoney } from './compass'
import { reelPool, reelKind, parseReels, dedupe } from './reels'
import { localDateKey } from './util'
import {
  momentumRun, momentumNow, stateFor, chainOf, rollUp,
  POINTS, CAPS, HABIT_TARGET, TASK_TARGET, FOCUS_TARGET_MIN, HARD_MIN_DAYS,
  EMPTY_WIPE, KEPT_AT, GAIN, FRICTION, CEILING, curveFor, project, daysBetween,
  type DayScore, type Period, type Zoom, type Future,
} from './momentum'

type View = 'ladder' | 'wheel'

const WINDOW = 120
const ZOOMS: { id: Zoom; label: string }[] = [
  { id: 'd', label: 'Days' },
  { id: 'w', label: 'Weeks' },
  { id: 'm', label: 'Months' },
]
const ROWS: Record<Zoom, number> = { d: 21, w: 12, m: 6 }

const hm = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`
const kc = (n: number) => Math.round(n).toLocaleString('cs-CZ')
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

export function TimelinePage() {
  const { habits, habitLog, tasks, focusSessions, inView } = useStore()
  const [view, setView] = useState<View>('ladder')
  const [zoom, setZoom] = useState<Zoom>('d')
  const [lives, setLives] = useState(false)
  const compass = useCompass().state

  const run = useMemo(
    () => momentumRun({ habits, habitLog, tasks, focusSessions, inView }, WINDOW),
    [habits, habitLog, tasks, focusSessions, inView],
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
        <h1>Timeline</h1>
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
          <button className="tl-next" onClick={() => setView(view === 'ladder' ? 'wheel' : 'ladder')}>
            {view === 'ladder' ? 'The flywheel' : 'The ladder'}
            <span aria-hidden="true">{view === 'ladder' ? '→' : '←'}</span>
          </button>
          <button className="tl-giveup" onClick={() => setLives(true)}>I want to give up</button>
        </div>
      </header>

      <Promise chain={chain} periods={periods} zoom={zoom} />

      {view === 'ladder' && <Ladder rows={shown} zoom={zoom} money={money} run={run} chain={chain} now={now} />}
      {view === 'wheel' && <Flywheel rows={shown} zoom={zoom} now={now} money={money} run={run} />}

      {lives && <TwoLives onBack={() => setLives(false)} run={run} chain={chain} />}
    </div>
  )
}

/* ----------------------------------------------------------- the promise */
/* One sentence, and it is the only place on the page that talks about the
   future. It is arithmetic, not encouragement: the number in it is how many
   more days at this rate beat the record, and when there is no record worth
   beating it says something true instead of something nice. */
function Promise({ chain, periods, zoom }: { chain: ReturnType<typeof chainOf>; periods: Period[]; zoom: Zoom }) {
  const arc = [...periods].slice(0, 14).reverse()
  const unit = zoom === 'd' ? 'day' : zoom === 'w' ? 'week' : 'month'

  let line: React.ReactNode
  if (chain.longest === 0) {
    line = <>Nothing is on a run yet. <em>One kept day</em> starts the chain, and a kept day is half of a full one.</>
  } else if (chain.current === 0) {
    line = <>The chain broke. Your longest was <em>{chain.longest} days</em>, and it starts again the first day you keep.</>
  } else if (chain.current >= chain.longest) {
    line = <><em>{chain.current} days.</em> The chain is the longest it has ever been. Every day from here is a new record.</>
  } else {
    line = <>Keep this rate for <em>{chain.toBeat} more {chain.toBeat === 1 ? 'day' : 'days'}</em> and the chain is the longest it has ever been.</>
  }

  return (
    <div className="tl-promise">
      <p className="tl-txt">{line}</p>
      <span className="tl-arc" aria-label={`The last ${arc.length} ${unit}s`}>
        {arc.map((p) => (
          <i key={p.key} className={p.kept ? 'on' : ''} style={{ height: `${Math.max(6, clamp01(p.ratio) * 100)}%` }} title={`${p.label}: ${Math.round(p.ratio * 100)}%`} />
        ))}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ ladder */
const COLS = ['Finances', 'Health', 'Habits', 'Tasks', 'Focus', 'Hard thing', 'Points']

function Ladder({ rows, zoom, money, run, chain, now }: {
  rows: Period[]; zoom: Zoom; money: CompassMoney | null
  run: DayScore[]; chain: ReturnType<typeof chainOf>; now: number
}) {
  const hardTotal = run.filter((r) => r.hard).length
  const focusTotal = run.reduce((a, r) => a + r.counts.focusMin, 0)
  const paidTotal = money ? Object.values(money.byDay).reduce((a, d) => a + d.paid, 0) : null

  return (
    <>
      <div className="tl-head" aria-hidden="true">
        <span />
        {COLS.map((c) => <span className="tl-l" key={c}>{c}</span>)}
      </div>
      <div className="tl-rungs">
        {rows.map((p, i) => <Rung key={p.key} p={p} zoom={zoom} money={money} today={i === 0} />)}
      </div>

      <div className="tl-sum">
        <Sum label="Momentum" figure={String(Math.round(now))} unit={`of ${100}`} win={now > 0} says={`${stateFor(now)}. Replayed from the log, never stored.`} />
        <Sum label="Chain" figure={String(chain.current)} unit={chain.current === 1 ? 'day' : 'days'} win={chain.current > 0}
          says={chain.longest > chain.current ? `Longest in this window is ${chain.longest}.` : 'This is the longest run in the window.'} />
        <Sum label="Hard things" figure={String(hardTotal)} unit={`in ${run.length} days`} win={hardTotal > 0}
          says={`Something you had been carrying ${HARD_MIN_DAYS} days or more.`} />
        <Sum label="Focused" figure={hm(focusTotal)} unit="" win={focusTotal > 0}
          says={`Measured blocks only. Nothing here is estimated.`} />
        {paidTotal === null
          ? <Sum label="Off the debt" figure="—" unit="" win={false} says="Compass is not readable from here. Sign in and the figures arrive." />
          : <Sum label="Off the debt" figure={kc(paidTotal)} unit="Kč" win={paidTotal > 0} says={`${kc(money!.owed)} Kč still owed across ${money!.openDebts} debts.`} />}
      </div>
    </>
  )
}

function Sum({ label, figure, unit, says, win }: { label: string; figure: string; unit: string; says: string; win: boolean }) {
  return (
    <div className={win ? 'win' : ''}>
      <span className="tl-l">{label}</span>
      <b>{figure}{unit && <small>{unit}</small>}</b>
      <p>{says}</p>
    </div>
  )
}

function Rung({ p, zoom, money, today }: { p: Period; zoom: Zoom; money: CompassMoney | null; today: boolean }) {
  /* Money moved inside this rung, whatever the rung is made of. */
  const fin = money ? p.days.reduce((a, d) => {
    const row = money.byDay[d.day]
    return row ? { paid: a.paid + row.paid, saved: a.saved + row.saved } : a
  }, { paid: 0, saved: 0 }) : null

  const dayUnit = zoom === 'd'
  /* AN EMPTY DAY IS ONLY RED IF IT TOOK SOMETHING. On a fresh install every
     rung is empty and nothing was lost, and painting three weeks of red for a
     wheel that was never turning is the "11 of 42" scoreboard again. */
  const cost = p.empty && p.delta < 0
  return (
    <div className={`tl-rung${today ? ' is-today' : ''}${cost ? ' is-empty' : ''}${p.earned === 0 ? ' is-blank' : ''}`}>
      <span className="tl-day">
        <b>{p.label}</b>
        <span className="tl-l">{p.sub}</span>
      </span>

      {/* FINANCES. Read, never scored, and it says which. */}
      {fin === null
        ? <Cell figure="—" unit="no Compass" pct={0} muted />
        : fin.paid > 0
          ? <Cell figure={kc(fin.paid)} unit="Kč off the debt" pct={1} />
          : fin.saved > 0
            ? <Cell figure={kc(fin.saved)} unit="Kč set aside" pct={1} />
            : <Cell figure="—" unit="nothing moved" pct={0} muted />}

      {/* HEALTH. A dash, not a zero: a zero would read as a fact about his week. */}
      <Cell figure="—" unit="not connected" pct={0} muted />

      <Cell figure={String(p.counts.habits)} unit={`of ${p.counts.habitTarget}`} pct={p.counts.habits / Math.max(1, p.counts.habitTarget)} />
      <Cell figure={String(p.counts.tasks)} unit="done" pct={p.counts.tasks / (TASK_TARGET * p.totalDays)} />
      <Cell figure={hm(p.counts.focusMin)} unit="focused" pct={p.counts.focusMin / (FOCUS_TARGET_MIN * p.totalDays)} />

      <span className="tl-hard">
        <span className={`tl-tick${p.hardCount ? '' : ' no'}`} aria-hidden="true">{p.hardCount ? '✓' : '✕'}</span>
        <b>
          {p.hard
            ? (dayUnit ? p.hard.title : `${p.hardCount} of ${p.totalDays} days`)
            : 'Nothing that had been waiting'}
        </b>
      </span>

      <span className={`tl-pts${p.delta < 0 ? ' is-down' : ''}`}>
        <b>{p.earned}</b>
        <i>{p.delta >= 0 ? `+${p.delta.toFixed(1)}` : p.delta.toFixed(1)}</i>
      </span>
    </div>
  )
}

function Cell({ figure, unit, pct, muted }: { figure: string; unit: string; pct: number; muted?: boolean }) {
  return (
    <span className={`tl-cell${muted ? ' is-muted' : ''}`}>
      <b>{figure}<small>{unit}</small></b>
      <span className="tl-m"><i style={{ width: `${Math.round(clamp01(pct) * 100)}%` }} /></span>
    </span>
  )
}

/* ---------------------------------------------------------------- flywheel */

/** A token is a hex string; the wheel needs the same colour at eight alphas. */
function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '').trim()
  const n = h.length === 3 ? h.split('').map((x) => x + x).join('') : h
  const v = parseInt(n.slice(0, 6) || 'ffffff', 16)
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`
}

function Flywheel({ rows, zoom, now, money, run }: {
  rows: Period[]; zoom: Zoom; now: number; money: CompassMoney | null; run: DayScore[]
}) {
  const cv = useRef<HTMLCanvasElement>(null)
  const wrap = useRef<HTMLDivElement>(null)

  /* THE WHEEL FILLS WHATEVER IS LEFT OF THE WINDOW rather than a guessed
     number of pixels: the header above it is two rows on a laptop and four on a
     phone, so any constant here is wrong on one of them. */
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const fit = () => el.style.setProperty('--tl-fill', `${Math.max(460, innerHeight - (el.getBoundingClientRect().top + scrollY) - 26)}px`)
    fit()
    addEventListener('resize', fit)
    return () => removeEventListener('resize', fit)
  }, [])

  /* The wheel is a read-out, not a toy: it spins at the momentum the log
     produced. There is no button here that speeds it up, because there is no
     button in his life that does. */
  useEffect(() => {
    const c = cv.current
    if (!c) return
    const cx = c.getContext('2d')
    if (!cx) return
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0, ang = 0, dead = false
    const read = () => {
      const css = getComputedStyle(c)
      return {
        hot: css.getPropertyValue('--tl-hot').trim() || '#C6F24A',
        ink: css.getPropertyValue('--tl-ink').trim() || '#F2F0EA',
        bg: css.getPropertyValue('--tl-rung').trim() || '#16161A',
      }
    }
    let paint = read()
    const size = () => {
      const r = c.getBoundingClientRect(), dpr = devicePixelRatio || 1
      c.width = Math.max(1, Math.round(r.width * dpr)); c.height = Math.max(1, Math.round(r.height * dpr))
      paint = read()
    }
    size()
    /* A CANVAS DOES NOT INHERIT A TOKEN, IT COPIES ONE. Switching to HUD mode
       repaints every other mark on the page and left the wheel lime, because
       the palette had been read once at mount and nothing here resizes when the
       mode changes. The observer is on one attribute of one element. */
    const shell = c.closest('.shell')
    const watch = shell ? new MutationObserver(() => { paint = read() }) : null
    watch?.observe(shell!, { attributes: true, attributeFilter: ['class'] })

    const ro = new ResizeObserver(size)
    ro.observe(c)

    const TAU = Math.PI * 2
    const SPOKES = 12
    const BOLTS = 8

    const draw = () => {
      if (dead) return
      const W = c.width, H = c.height, x = W / 2, y = H / 2
      const R = Math.min(W, H) * 0.42
      const lit = Math.min(1, now / CEILING)
      /* Heavy at rest and easy once moving, which is the whole argument the
         object is making. A cold wheel barely creeps; a hot one runs. */
      const inertia = 1 + Math.max(0, 26 - now) / 26 * 1.6
      if (!reduce) ang = (ang + (now / inertia) * 0.0013) % TAU

      cx.clearRect(0, 0, W, H)
      cx.save()
      cx.translate(x, y)

      /* THE BODY. A radial fill so the casting reads as a solid object with a
         lit face rather than a wire circle. */
      const body = cx.createRadialGradient(-R * 0.3, -R * 0.35, R * 0.05, 0, 0, R)
      body.addColorStop(0, rgba(paint.ink, 0.09))
      body.addColorStop(0.55, rgba(paint.ink, 0.045))
      body.addColorStop(1, rgba(paint.ink, 0.015))
      cx.beginPath(); cx.arc(0, 0, R, 0, TAU); cx.fillStyle = body; cx.fill()

      cx.rotate(ang)

      /* THE SPOKES, tapered: wide at the hub, narrow at the rim. A constant
         width line reads as a wire wheel; a taper reads as cast metal. */
      for (let i = 0; i < SPOKES; i++) {
        const a = i * (TAU / SPOKES)
        const wIn = R * 0.052, wOut = R * 0.022
        const ri = R * 0.26, ro2 = R * 0.845
        cx.save(); cx.rotate(a)
        cx.beginPath()
        cx.moveTo(-wIn, ri); cx.lineTo(wIn, ri); cx.lineTo(wOut, ro2); cx.lineTo(-wOut, ro2)
        cx.closePath()
        /* Lit on the leading edge, dark on the trailing one, so the turn is
           visible even at a speed too low to see the spokes move. */
        const g = cx.createLinearGradient(-wIn, 0, wIn, 0)
        g.addColorStop(0, rgba(paint.ink, 0.30))
        g.addColorStop(0.5, rgba(paint.ink, 0.16))
        g.addColorStop(1, rgba(paint.ink, 0.07))
        cx.fillStyle = g; cx.fill()
        cx.restore()
      }

      /* THE BOLT CIRCLE. Eight, on the hub flange. */
      for (let i = 0; i < BOLTS; i++) {
        const a = i * (TAU / BOLTS) + TAU / 16
        cx.beginPath()
        cx.arc(Math.cos(a) * R * 0.36, Math.sin(a) * R * 0.36, Math.max(1.5, R * 0.017), 0, TAU)
        cx.fillStyle = rgba(paint.ink, 0.26); cx.fill()
      }
      cx.rotate(-ang)

      /* THE RIM: an outer band, a groove, and an inner lip. Three strokes, and
         it stops looking like a circle drawn with one. */
      cx.lineWidth = Math.max(6, R * 0.085)
      cx.strokeStyle = rgba(paint.ink, 0.10)
      cx.beginPath(); cx.arc(0, 0, R * 0.905, 0, TAU); cx.stroke()
      cx.lineWidth = Math.max(1, R * 0.008)
      cx.strokeStyle = rgba(paint.ink, 0.22)
      cx.beginPath(); cx.arc(0, 0, R * 0.95, 0, TAU); cx.stroke()
      cx.strokeStyle = rgba(paint.ink, 0.14)
      cx.beginPath(); cx.arc(0, 0, R * 0.862, 0, TAU); cx.stroke()

      /* THE HUB. Filled with the panel's own ground so the figure over it is
         read against a flat colour and not against the spokes. */
      cx.beginPath(); cx.arc(0, 0, R * 0.265, 0, TAU)
      cx.fillStyle = paint.bg || '#16161A'; cx.fill()
      cx.lineWidth = Math.max(1.5, R * 0.012)
      cx.strokeStyle = rgba(paint.ink, 0.24); cx.stroke()

      /* THE CHARGE. How far round the ceiling he is: a gauge standing still as
         well as a speed once it moves. */
      if (lit > 0.001) {
        cx.lineWidth = Math.max(5, R * 0.055)
        cx.lineCap = 'butt'
        cx.strokeStyle = paint.hot
        cx.beginPath(); cx.arc(0, 0, R * 0.905, -Math.PI / 2, -Math.PI / 2 + TAU * lit); cx.stroke()
        const end = -Math.PI / 2 + TAU * lit
        cx.beginPath(); cx.arc(Math.cos(end) * R * 0.905, Math.sin(end) * R * 0.905, Math.max(3, R * 0.032), 0, TAU)
        cx.fillStyle = paint.hot; cx.fill()
      }
      /* A FIXED MARK AT TWELVE. Without something that does not turn, a slow
         wheel and a still one look the same. */
      cx.beginPath()
      cx.moveTo(0, -R * 1.02); cx.lineTo(-R * 0.028, -R * 1.09); cx.lineTo(R * 0.028, -R * 1.09)
      cx.closePath(); cx.fillStyle = rgba(paint.ink, 0.35); cx.fill()

      cx.restore()
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => { dead = true; cancelAnimationFrame(raf); watch?.disconnect(); ro.disconnect() }
  }, [now])

  return (
    <div className="tl-wheelwrap" ref={wrap}>
      <div className="tl-wheel">
        <canvas ref={cv} />
        <div className="tl-wheelread">
          <b>{Math.round(now)}</b>
          <span className="tl-l">momentum</span>
          <span className="tl-state">{stateFor(now)}</span>
        </div>
        <Maths run={run} now={now} />
      </div>

      <div className="tl-days">
        {rows.map((p) => <DayCard key={p.key} p={p} zoom={zoom} money={money} />)}
      </div>
    </div>
  )
}

/* THE MATHS, on the page rather than in his head.

   Every figure is read off the constants in `momentum.ts`, so the explanation
   cannot drift from the model the way a written-out one does the first time a
   weight changes. It answers the question he actually asked -- what 128 points
   is worth in MOMENTUM -- and then says which of the sources he is not feeding,
   because a wheel reading zero is otherwise a mystery. */
function Maths({ run, now }: { run: DayScore[]; now: number }) {
  const full = HABIT_TARGET * POINTS.habit + TASK_TARGET * POINTS.task + (FOCUS_TARGET_MIN / 10) * POINTS.focusPer10 + POINTS.hard
  const share = [
    { name: 'Habits', pts: HABIT_TARGET * POINTS.habit, each: `${POINTS.habit} each, ${HABIT_TARGET} counts`, fed: run.some((r) => r.counts.habits > 0) },
    { name: 'Tasks', pts: TASK_TARGET * POINTS.task, each: `${POINTS.task} each, ${CAPS.task} max`, fed: run.some((r) => r.counts.tasks > 0) },
    { name: 'Focus', pts: (FOCUS_TARGET_MIN / 10) * POINTS.focusPer10, each: `${POINTS.focusPer10} per 10 min`, fed: run.some((r) => r.counts.focusMin > 0) },
    { name: 'The hard thing', pts: POINTS.hard, each: `waited ${HARD_MIN_DAYS} days`, fed: run.some((r) => !!r.hard) },
  ]
  const bands = [
    { at: 'All of it', pts: `${full}`, gain: GAIN * curveFor(1) },
    { at: 'Three quarters', pts: `${Math.round(full * 0.75)}`, gain: GAIN * curveFor(0.75) },
    { at: 'Half', pts: `${Math.round(full * 0.5)}`, gain: GAIN * curveFor(0.5) },
    { at: 'A quarter', pts: `${Math.round(full * 0.25)}`, gain: GAIN * curveFor(0.25) },
    { at: 'Less than that', pts: `0 to ${Math.round(full * 0.25) - 1}`, gain: GAIN * curveFor(0) },
  ]
  const cold = share.filter((s) => !s.fed)
  const sign = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`

  return (
    <div className="tl-maths">
      <button type="button" aria-label="How the momentum is worked out">i</button>
      <div className="tl-mathsbox" role="note">
        <p className="tl-l">A full day is {full} points</p>
        <dl>
          {share.map((s) => (
            <div key={s.name} className={s.fed ? '' : 'off'}>
              <dt>{s.name}</dt>
              <dd>{s.pts}<small>{s.each}</small></dd>
            </div>
          ))}
          <div className="off"><dt>A workout</dt><dd>{POINTS.workout}<small>not connected</small></dd></div>
          <div className="off"><dt>Finances</dt><dd>{'—'}<small>read, not scored</small></dd></div>
        </dl>

        <p className="tl-l">What that is worth in momentum</p>
        <dl>
          {bands.map((b) => (
            <div key={b.at} className={b.gain < 0 ? 'bad' : ''}>
              <dt>{b.at}<small>{b.pts} pts</small></dt>
              <dd>{sign(b.gain)}</dd>
            </div>
          ))}
          <div className="bad"><dt>Nothing at all<small>0 pts</small></dt><dd>{`−${Math.round(EMPTY_WIPE * 100)}%`}</dd></div>
        </dl>
        <p>The wheel also gives up <b>{((1 - FRICTION) * 100).toFixed(1)}%</b> a day to friction, stops at <b>{CEILING}</b>,
        and never goes below zero. At <b>{Math.round(now)}</b> a full day is worth about <b>{sign(GAIN * curveFor(1) - now * (1 - FRICTION))}</b> net.</p>

        {cold.length > 0 && (
          <p className="tl-cold">
            <b>{cold.map((s) => s.name).join(' and ')}</b> {cold.length === 1 ? 'is' : 'are'} in the bar
            but you have logged {cold.length === 1 ? 'none' : 'none of either'} in {run.length} days.
            That is {cold.reduce((a, s) => a + s.pts, 0)} of the {full} points a day is asked for.
          </p>
        )}
        <p>The chain counts every day at <b>{Math.round(KEPT_AT * 100)}%</b> of a full day or better.
        Nothing is stored: the wheel is replayed from the log every time this page opens.</p>
      </div>
    </div>
  )
}

function DayCard({ p, zoom, money }: {
  p: Period; zoom: Zoom; money: CompassMoney | null
}) {
  const fin = money ? p.days.reduce((a, d) => a + (money.byDay[d.day]?.paid ?? 0) + (money.byDay[d.day]?.saved ?? 0), 0) : null
  const pct = Math.round(clamp01(p.ratio) * 100)
  const cost = p.empty && p.delta < 0     // see the note on the rung
  return (
    <article className={`tl-card${p.delta < 0 ? ' is-down' : ''}${cost ? ' is-empty' : ''}${p.earned === 0 ? ' is-blank' : ''}`}>
      <div className="tl-cardtop">
        <span className="tl-cardday"><b>{p.label}</b><span className="tl-l">{p.sub}</span></span>
        <span className="tl-delta">{p.delta >= 0 ? `+${p.delta.toFixed(1)}` : p.delta.toFixed(1)}</span>
      </div>

      <div className="tl-cardpts">
        <b>{p.earned}</b><i>of {p.baseline} points</i>
        <span className="tl-m"><i style={{ width: `${pct}%` }} /></span>
      </div>

      {/* ONE COLUMN, not two. Two columns left a hole under the odd row out and
          squeezed a task title into 140px, where it wrapped mid-sentence. */}
      <dl className="tl-bd">
        <div><dt>Habits</dt><dd>{p.counts.habits}<small>of {p.counts.habitTarget}</small></dd></div>
        <div><dt>Tasks</dt><dd>{p.counts.tasks}<small>done</small></dd></div>
        <div><dt>Focus</dt><dd>{hm(p.counts.focusMin)}<small>{zoom === 'd' ? 'today' : 'in total'}</small></dd></div>
        <div className={fin ? '' : 'off'}><dt>Finances</dt><dd>{fin ? kc(fin) : '—'}<small>{fin ? 'Kč moved' : money ? 'nothing moved' : 'no Compass'}</small></dd></div>
        <div className="off"><dt>Health</dt><dd>{'—'}<small>not connected</small></dd></div>
      </dl>
      <div className={`tl-hardrow${p.hard ? '' : ' off'}`}>
        <span className="tl-l">Hard thing</span>
        <b>{p.hard ? (zoom === 'd' ? p.hard.title : `${p.hardCount} of ${p.totalDays} days`) : `Nothing ${HARD_MIN_DAYS} days old went`}</b>
        {p.hard && zoom === 'd' && <span className="tl-waited">waited {p.hard.waited} days</span>}
      </div>

      <p className="tl-after">
        {cost
          ? <>Nothing logged. The wheel lost half of itself.</>
          : p.empty
            ? <>Nothing logged, and nothing to lose. The wheel was already still.</>
            : <>Wheel stood at <b>{Math.round(p.momentum)}</b> after this {zoom === 'd' ? 'day' : zoom === 'w' ? 'week' : 'month'}.</>}
      </p>
    </article>
  )
}

/* -------------------------------------------------------------- two lives */
/* THE SCREEN HE OPENS WHEN HE WANTS TO STOP.

   His layout: one portrait reel down the left half WITH SOUND, and the right
   half split into two rows, the life he keeps on top and the one he lets go
   underneath.

   THE STOPS ARE NOT FIVE HAND-WRITTEN MILESTONES ANY MORE. He asked for a
   scrubber that runs day by day, week by week and month by month to the goal
   he is actually working towards, and for both futures to be worked out rather
   than written. So the range is today to the horizon, the grain is his to
   choose, and every figure on both sides comes out of `project()`, which runs
   his own recent rate forward through the same model that scored the past.

   THE HORIZON IS END OF FEBRUARY 2027, which is the goal he named. A real goal
   deadline further out than that moves it, because his own data outranks a
   constant, and the screen says which of the two it is using. */
const DECLARED_HORIZON = '2027-02-28'

type Grain = 'd' | 'w' | 'm'
const GRAINS: { id: Grain; label: string; step: number }[] = [
  { id: 'd', label: 'Days', step: 1 },
  { id: 'w', label: 'Weeks', step: 7 },
  { id: 'm', label: 'Months', step: 30 },
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayAfter = (n: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d }
const longDate = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`

/** "Six months", "Eleven weeks", "Four days". The unit follows the grain he
 *  is scrubbing in, because "182 days" is not how anyone hears half a year. */
function spanWords(days: number, grain: Grain): string {
  if (days === 0) return 'Today'
  if (grain === 'm' && days >= 30) { const n = Math.round(days / 30); return `${n} month${n === 1 ? '' : 's'}` }
  if (grain !== 'd' && days >= 7) { const n = Math.round(days / 7); return `${n} week${n === 1 ? '' : 's'}` }
  return `${days} day${days === 1 ? '' : 's'}`
}

/* ---- the reel ---- */
function useReelPool(): string[] {
  const { reels, twoLives } = useStore()
  return useMemo(() => {
    /* Anything set under the old one-link-per-stop shape joins the library
       rather than being stranded in a field nothing reads any more. */
    const old = Object.values(twoLives ?? {}).filter(Boolean)
    return reelPool([...(reels ?? []), ...old])
  }, [reels, twoLives])
}

function Reel({ url, count, onOpenLibrary, onNext }: {
  url: string; count: number; onOpenLibrary: () => void; onNext: () => void
}) {
  const vid = useRef<HTMLVideoElement>(null)
  const [sound, setSound] = useState(true)
  const [failed, setFailed] = useState(false)
  const kind = url ? reelKind(url) : null

  useEffect(() => { setFailed(false); setSound(true) }, [url])
  useEffect(() => {
    const v = vid.current
    if (!v || kind !== 'file') return
    v.muted = false
    /* Unmuted autoplay is refused unless the browser trusts this origin. Rather
       than guess, ask for sound and take muted playback over no playback. */
    v.play().catch(() => { v.muted = true; setSound(false); v.play().catch(() => setFailed(true)) })
  }, [url, kind])

  const hear = () => { const v = vid.current; if (v) { v.muted = false; void v.play() } setSound(true) }

  return (
    <div className={`tl-reel${kind && !failed ? ' has-media' : ''}`}>
      {!failed && kind === 'file' && (
        <video ref={vid} className="tl-media" src={url} autoPlay loop playsInline onError={() => setFailed(true)} />
      )}
      {!failed && (kind === 'youtube' || kind === 'vimeo') && (
        <iframe key={`${url}|${sound}`} className="tl-media" src={embedSrc(url, sound)} title="Reel"
          allow="autoplay; encrypted-media" frameBorder="0" />
      )}
      {!failed && kind === 'other' && <img className="tl-media" src={url} alt="" onError={() => setFailed(true)} />}

      {!kind && (
        <div className="tl-reelempty">
          <p className="tl-l">The reel is empty</p>
          <p>Paste your links and one plays here every time, full height, with sound.
          A wall of YouTube links is fine: the panel pulls the URLs out of it.</p>
        </div>
      )}
      {failed && (
        <div className="tl-reelempty is-bad">
          <p className="tl-l">That link would not load</p>
          <p className="tl-url">{url}</p>
          <p>It is still in the library. Skip to the next one, or take it out.</p>
        </div>
      )}

      <div className="tl-reelbar">
        <button className="tl-setshot" onClick={onOpenLibrary}>
          {count ? `${count} reel${count === 1 ? '' : 's'}` : 'Add reels'}
        </button>
        {count > 1 && <button className="tl-setshot" onClick={onNext}>Next</button>}
        {kind && kind !== 'other' && !failed && !sound && (
          <button className="tl-setshot is-hot" onClick={hear}>Sound on</button>
        )}
      </div>
    </div>
  )
}

/* ---- the library ---- */
/* A PROMPT CANNOT TAKE THREE HUNDRED LINKS, which is what he asked for. This
   is a textarea he can paste a page into: every URL in it is pulled out, the
   same clip under four different YouTube spellings counts once, and the panel
   says what it took before he saves. */
function ReelLibrary({ pool, onClose }: { pool: string[]; onClose: () => void }) {
  const { reels, setReels } = useStore()
  const [text, setText] = useState(() => (reels ?? []).join('\n'))
  const parsed = useMemo(() => parseReels(text), [text])
  const counts = useMemo(() => {
    const c = { youtube: 0, vimeo: 0, file: 0, other: 0 }
    for (const u of parsed) c[reelKind(u)]++
    return c
  }, [parsed])
  const curated = pool.length - dedupe(reels ?? []).length

  return (
    <div className="tl-lib" role="dialog" aria-modal="true" aria-label="Reel library">
      <div className="tl-libbox">
        <header>
          <span className="tl-l">The reel library</span>
          <button className="tl-close" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <p className="tl-libsay">
          Paste as many links as you like. One per line, separated by commas, or a whole page
          with links in it: every URL gets pulled out and the same clip twice counts once.
        </p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
          placeholder={'https://www.youtube.com/watch?v=...\nhttps://youtu.be/...\nhttps://youtube.com/shorts/...'} />
        <div className="tl-libcount">
          <span><b>{parsed.length}</b> link{parsed.length === 1 ? '' : 's'}</span>
          <span><b>{counts.youtube}</b> YouTube</span>
          <span><b>{counts.vimeo}</b> Vimeo</span>
          <span><b>{counts.file}</b> file{counts.file === 1 ? '' : 's'}</span>
          {counts.other > 0 && <span className="off"><b>{counts.other}</b> not recognised</span>}
          {curated > 0 && <span className="off"><b>{curated}</b> already shipped</span>}
        </div>
        <div className="tl-libfoot">
          <button className="tl-back" onClick={() => { setReels(parsed); onClose() }}>Save the library</button>
          <button className="tl-setshot" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

const YT = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/i
const VIMEO = /vimeo\.com\/(?:video\/)?(\d+)/i
function embedSrc(url: string, sound: boolean): string {
  const y = url.match(YT)
  if (y) return `https://www.youtube-nocookie.com/embed/${y[1]}?autoplay=1&mute=${sound ? 0 : 1}&loop=1&controls=0&playsinline=1&rel=0&playlist=${y[1]}`
  const v = url.match(VIMEO)
  if (v) return `https://player.vimeo.com/video/${v[1]}?autoplay=1&muted=${sound ? 0 : 1}&loop=1`
  return url
}

/* ---- the screen ---- */
function TwoLives({ onBack, run, chain }: { onBack: () => void; run: DayScore[]; chain: ReturnType<typeof chainOf> }) {
  const { goals, inView } = useStore()
  const pool = useReelPool()
  const [grain, setGrain] = useState<Grain>('m')
  const [at, setAt] = useState(0)
  const [lib, setLib] = useState(false)
  const [skip, setSkip] = useState(0)

  /* The horizon he named, unless one of his own open goals reaches further. */
  const horizon = useMemo(() => {
    const deadlines = goals
      .filter((g) => inView(g.space) && !g.closed && g.deadline)
      .map((g) => g.deadline as string)
    const furthest = deadlines.sort().pop()
    return furthest && furthest > DECLARED_HORIZON ? { day: furthest, own: true } : { day: DECLARED_HORIZON, own: false }
  }, [goals, inView])

  const span = Math.max(1, daysBetween(localDateKey(), horizon.day))
  const step = GRAINS.find((g) => g.id === grain)!.step
  /* Snap to the grain, and never past the horizon. THE LAST STOP IS THE
     HORIZON ITSELF: 184 days does not divide by 30, so snapping alone left the
     end of the slider four days short of the date printed beside it. */
  const days = at >= span - step / 2 ? span : Math.min(span, Math.round(at / step) * step)
  const when = dayAfter(days)
  const p = project(run, chain.current, days)
  const url = pool.length ? pool[(skip + Math.floor(days / Math.max(1, step))) % pool.length] : ''

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (lib) setLib(false); else onBack() }
      /* NOT WHEN THE SLIDER ITSELF HAS FOCUS. A range input already walks on
         the arrow keys, so this handler moved it a second step on top of the
         browser's own and the handle jumped two at a time. */
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return
      if (e.key === 'ArrowRight') setAt((v) => Math.min(span, v + step))
      if (e.key === 'ArrowLeft') setAt((v) => Math.max(0, v - step))
    }
    addEventListener('keydown', k)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { removeEventListener('keydown', k); document.body.style.overflow = prev }
  }, [onBack, span, step, lib])

  return (
    <div className="tl-lives" role="dialog" aria-modal="true" aria-label="Two lives">
      <div className="tl-stage">
        <Reel url={url} count={pool.length} onOpenLibrary={() => setLib(true)} onNext={() => setSkip((s) => s + 1)} />
        <div className="tl-sides">
          <section className="tl-side is-push">
            <span className="tl-pill">If you do it anyway</span>
            <p className="tl-said">{days === 0 ? 'Today. Nothing has happened yet.' : `${spanWords(days, grain)} of keeping it.`}</p>
            <Figures f={p.push} days={days} />
            <p className="tl-under">
              {p.assumed
                ? 'There is no rate of yours to run forward yet, so this is a full day, every day.'
                : `At your own rate of the last ${p.from} days: ${Math.round(p.rate * 100)}% of a full day.`}
            </p>
          </section>
          <section className="tl-side is-drift">
            <span className="tl-pill">If you skip it</span>
            <p className="tl-said">{days === 0 ? 'Today. Nothing has happened yet.' : `${spanWords(days, grain)} of not.`}</p>
            <Figures f={p.drift} days={days} dead />
            <p className="tl-under">
              {days === 0
                ? 'Both men are the same man this morning.'
                : `The wheel reads zero on day ${p.stoppedOn}. Everything after that is the same day again.`}
            </p>
          </section>
          <div className="tl-gap">
            <b>{days === 0 ? 'Today' : longDate(when).replace(/ \d{4}$/, '')}</b>
            <span className="tl-l">{days === 0 ? 'right now' : `${days} days out`}</span>
          </div>
        </div>
      </div>

      <button className="tl-close" onClick={onBack} aria-label="Close">✕</button>

      <footer className="tl-livesfoot">
        <div className="tl-grain" role="group" aria-label="Grain">
          {GRAINS.map((g) => (
            <button key={g.id} className={grain === g.id ? 'on' : ''} aria-pressed={grain === g.id}
              onClick={() => setGrain(g.id)}>{g.label}</button>
          ))}
        </div>
        <label className="tl-slider">
          <input type="range" min={0} max={span} step={step} value={Math.min(at, span)}
            aria-label={`How far out: ${days} days`}
            onChange={(e) => setAt(Number(e.target.value))} />
          <span className="tl-l">
            Now {'→'} {longDate(new Date(`${horizon.day}T00:00:00`))}
            {horizon.own ? ', your furthest goal' : ''}
          </span>
        </label>
        <button className="tl-back" onClick={onBack}>Ok. Let&rsquo;s go.</button>
      </footer>

      {lib && <ReelLibrary pool={pool} onClose={() => setLib(false)} />}
    </div>
  )
}

function Figures({ f, days, dead }: { f: Future; days: number; dead?: boolean }) {
  const rows: [string, string][] = [
    ['Momentum', String(Math.round(f.momentum))],
    ['Chain', `${f.chain}`],
    ['Tasks', `${f.tasks}`],
    ['Focused', `${Math.round(f.focusMin / 60)}h`],
  ]
  if (days === 0) return null
  return (
    <dl className={`tl-figs${dead ? ' is-dead' : ''}`}>
      {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  )
}
