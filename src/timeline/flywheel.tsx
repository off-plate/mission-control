import { DotField } from '../dotfield'
import { useEffect, useRef } from 'react'
import { type CompassMoney } from '../compass'
import { stateFor, POINTS, CAPS, HABIT_TARGET, TASK_TARGET, FOCUS_TARGET_MIN, HARD_MIN_DAYS, OUTREACH_TARGET, EMPTY_WIPE, KEPT_AT, GAIN, FRICTION, CEILING, curveFor, type DayScore, type Period, type Zoom } from '../momentum'
import { clamp01, hevyDetail, hm, kc, useSessionMinutes, wm } from './shared'

/* ---------------------------------------------------------------- flywheel */

/** A token is a hex string; the wheel needs the same colour at eight alphas. */
export function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '').trim()
  const n = h.length === 3 ? h.split('').map((x) => x + x).join('') : h
  const v = parseInt(n.slice(0, 6) || 'ffffff', 16)
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`
}

export function Flywheel({ rows, zoom, now, money, run }: {
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
      <div className="tl-wheel has-field">
        <DotField kind="tide" value={now} hot="var(--tl-hot)" className="tl-tide" />
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
export function Maths({ run, now }: { run: DayScore[]; now: number }) {
  const full = HABIT_TARGET * POINTS.habit + TASK_TARGET * POINTS.task + (FOCUS_TARGET_MIN / 10) * POINTS.focusPer10 + POINTS.hard + OUTREACH_TARGET * POINTS.outreach
  const share = [
    { name: 'Habits', pts: HABIT_TARGET * POINTS.habit, each: `${POINTS.habit} each, ${HABIT_TARGET} counts`, fed: run.some((r) => r.counts.habits > 0) },
    { name: 'Tasks', pts: TASK_TARGET * POINTS.task, each: `${POINTS.task} each, ${CAPS.task} max`, fed: run.some((r) => r.counts.tasks > 0) },
    { name: 'Focus', pts: (FOCUS_TARGET_MIN / 10) * POINTS.focusPer10, each: `${POINTS.focusPer10} per 10 min`, fed: run.some((r) => r.counts.focusMin > 0) },
    { name: 'The hard thing', pts: POINTS.hard, each: `waited ${HARD_MIN_DAYS} days`, fed: run.some((r) => !!r.hard) },
    { name: 'Outreach', pts: OUTREACH_TARGET * POINTS.outreach, each: `${POINTS.outreach} each, ${OUTREACH_TARGET} counts`, fed: run.some((r) => r.counts.outreach > 0) },
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
          <div className="off"><dt>A workout</dt><dd>{POINTS.workout}<small>read, not scored</small></dd></div>
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

export function DayCard({ p, zoom, money }: {
  p: Period; zoom: Zoom; money: CompassMoney | null
}) {
  const sessionMins = useSessionMinutes()
  const fin = money ? p.days.reduce((a, d) => a + (money.byDay[d.day]?.paid ?? 0) + (money.byDay[d.day]?.saved ?? 0) + (money.byDay[d.day]?.spent ?? 0), 0) : null
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
        <div className={p.counts.outreach ? '' : 'off'}><dt>Outreach</dt><dd>{p.counts.outreach}<small>{p.counts.outreachDays ? `of ${OUTREACH_TARGET * p.counts.outreachDays}` : 'sent'}</small></dd></div>
        <div className={fin ? '' : 'off'}><dt>Finances</dt><dd>{fin ? kc(fin) : '—'}<small>{fin ? 'Kč moved' : money ? 'nothing moved' : 'no Compass'}</small></dd></div>
        {(() => {
          const detail = hevyDetail(p.days.map((d) => d.day), sessionMins)
          const dayFigure = zoom === 'd' ? (p.counts.workoutDays ? '✓' : '—') : p.counts.workoutDays
          const dayUnitText = zoom === 'd' ? (p.counts.workoutDays ? 'worked out' : 'no workout') : `of ${p.totalDays} days`
          return (
            <div className={p.counts.workoutDays ? '' : 'off'}>
              <dt>Health</dt>
              <dd>
                {detail ? wm(detail.minutes) : dayFigure}
                <small>
                  {detail
                    ? (detail.volumeKg > 0 ? `${kc(detail.volumeKg)}kg lifted` : 'worked out')
                    : dayUnitText}
                </small>
              </dd>
            </div>
          )
        })()}
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
