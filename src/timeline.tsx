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
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './store'
import { dayOf, daysSince, useHealth } from './health'
import {
  countdown, debtCard, goalArcs, goalsCard, habitRings, habitsCard, healthCard, postponedCard,
  quittingCard, routineTrack, routinesCard, score, slipSeries, trainingGrid,
} from './giveupstatus'
import { AgeRange, Arcs, Heat, Orbit, Panel, Read, Rows, Slips, Stops, Wheel } from './giveuppanel'
import { useCompass, type CompassMoney } from './compass'
import { reelPool, reelKind, parseReels, dedupe } from './reels'
import {
  canPickFolder, forgetFolder, grantFolder, pickFolder, restoreFolder,
  type FolderState, type LocalReel,
} from './localreels'
import { callFunction } from './supabase'
import { loadYouTubeApi } from './mundiplayer'
import { getHevyStatsForDay } from './hevy'
import { localDateKey } from './util'
import {
  momentumRun, momentumNow, stateFor, chainOf, rollUp,
  POINTS, CAPS, HABIT_TARGET, TASK_TARGET, FOCUS_TARGET_MIN, HARD_MIN_DAYS,
  EMPTY_WIPE, KEPT_AT, GAIN, FRICTION, CEILING, curveFor, project,
  type DayScore, type Period, type Zoom, type Future,
} from './momentum'

type View = 'ladder' | 'wheel'

export const WINDOW = 120
const ZOOMS: { id: Zoom; label: string }[] = [
  { id: 'd', label: 'Days' },
  { id: 'w', label: 'Weeks' },
  { id: 'm', label: 'Months' },
]
const ROWS: Record<Zoom, number> = { d: 21, w: 12, m: 6 }

const hm = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`
const kc = (n: number) => Math.round(n).toLocaleString('cs-CZ')
/** A workout is usually under an hour; hm()'s "0h 52m" is the wrong shape
 *  for it. Drops the hour entirely when there is none. */
const wm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m` : `${Math.round(min)}m`)

/** Length and volume for a stretch of days.
 *
 *  TWO SOURCES, and they carry different things. Hevy's own cache is
 *  device-local (see STATS_STORE in hevy.ts) and is the only one that knows
 *  VOLUME, because Intervals never sees the weight on the bar. Intervals
 *  knows the minutes for every session, on every device, which Hevy only
 *  knows on the machine it synced to.
 *
 *  So: Hevy wins where it has the day, because it says more. Where it does
 *  not, the real session minutes still show. Fixed 2026-09-12, immediately
 *  after his report -- the pass before this one made Intervals sessions count
 *  as workout days but left the read-out on Hevy alone, so every day that came
 *  from Intervals collapsed to a bare "worked out" with the time and the
 *  weight he was used to seeing gone. */
function hevyDetail(days: string[], sessionMinutes?: Map<string, number>): { minutes: number; volumeKg: number } | null {
  let minutes = 0, volumeKg = 0, hit = false
  for (const day of days) {
    const s = getHevyStatsForDay(day)
    if (s) {
      hit = true
      minutes += s.minutes
      volumeKg += s.volumeKg
      continue
    }
    const mins = sessionMinutes?.get(day)
    if (mins != null && mins > 0) { hit = true; minutes += mins }
  }
  return hit ? { minutes, volumeKg } : null
}

/** Minutes per day from real sessions, for the two places that draw the
 *  health read-out. A hook rather than a prop drilled through Ladder and
 *  Flywheel to reach two leaves. */
function useSessionMinutes(): Map<string, number> {
  const health = useHealth().state
  return useMemo(() => {
    const by = new Map<string, number>()
    if (health.status !== 'ok') return by
    for (const s of health.sessions) {
      const day = dayOf(s)
      if (!day || !s.moving_time) continue
      by.set(day, (by.get(day) ?? 0) + s.moving_time / 60)
    }
    return by
  }, [health])
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
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
  const { habits, habitLog, tasks, focusSessions, setPage } = useStore()
  const [view, setView] = useState<View>('ladder')
  const [zoom, setZoom] = useState<Zoom>('d')
  const [lives, setLives] = useState(false)
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
    () => momentumRun({ habits, habitLog, tasks, focusSessions, inView: inAllSpaces, workoutDays: trainedDays }, WINDOW),
    [habits, habitLog, tasks, focusSessions, trainedDays],
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
          {/* Why's own tab retired (2026-09-04), the same way Notes',
             Bills' and Timeline's were: not moved to the floating dock
             like those three, but placed here instead, on his instruction
             -- between the flywheel and "I want to give up" specifically,
             so the moment he's looking at whether to quit is the same
             moment his own reasons are one tap away, not a menu away. The
             page itself is untouched -- setPage('board') still renders it,
             this was only ever the tab in.

             The door in is dropped below 639px too (2026-09-06, mobile
             review): the wall behind it is a long image-and-quote scroll
             built for a screen he's sitting back from, not the one thing to
             reach for one-handed at the exact moment he's tempted to quit.
             The address still resolves for anyone who already has it. */}
          <button className="tl-why hide-phone" onClick={() => setPage('board')}>Why</button>
          <button className={`tl-giveup${lives ? ' is-on' : ''}`} onClick={() => setLives((v) => !v)}>
            {lives ? 'Back to the timeline' : 'I want to give up'}
          </button>
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
          <Promise chain={chain} periods={periods} zoom={zoom} />
          {view === 'ladder' && <Ladder rows={shown} zoom={zoom} money={money} run={run} chain={chain} now={now} />}
          {view === 'wheel' && <Flywheel rows={shown} zoom={zoom} now={now} money={money} run={run} />}
        </>
      )}
    </div>
  )
}

/* ----------------------------------------------------------- the promise */
/* One sentence, and it is the only place on the page that talks about the
   future. It is arithmetic, not encouragement: the number in it is how many
   more days at this rate beat the record, and when there is no record worth
   beating it says something true instead of something nice. */
/* Exported for timelinedock.tsx (the floating dock's compact summary,
   2026-09-03) -- the exact wording, not a second copy of it. This is
   content generation, not just a number, so letting it drift between the
   full page and the dock would read as two different products disagreeing
   about the same chain. */
export function chainPromiseLine(chain: ReturnType<typeof chainOf>): React.ReactNode {
  if (chain.longest === 0) {
    return <>Nothing is on a run yet. <em>One kept day</em> starts the chain, and a kept day is half of a full one.</>
  }
  if (chain.current === 0) {
    return <>The chain broke. Your longest was <em>{chain.longest} days</em>, and it starts again the first day you keep.</>
  }
  if (chain.current >= chain.longest) {
    return <><em>{chain.current} days.</em> The chain is the longest it has ever been. Every day from here is a new record.</>
  }
  return <>Keep this rate for <em>{chain.toBeat} more {chain.toBeat === 1 ? 'day' : 'days'}</em> and the chain is the longest it has ever been.</>
}

function Promise({ chain, periods, zoom }: { chain: ReturnType<typeof chainOf>; periods: Period[]; zoom: Zoom }) {
  const arc = [...periods].slice(0, 14).reverse()
  const unit = zoom === 'd' ? 'day' : zoom === 'w' ? 'week' : 'month'
  const line = chainPromiseLine(chain)

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
  const sessionMins = useSessionMinutes()
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

      {/* HEALTH. A day counts when the Workout / Gym / Fitness habit was
          ticked -- by Hevy or by hand, this cell does not know which -- or
          when a real session was recorded. Not scored; see the note in
          momentum.ts for why. Length rides along from whichever source has
          it, and volume only from Hevy, which is the only one that sees the
          weight. A day ticked purely by hand still has neither, which is
          right: there is nothing to report for one. */}
      {(() => {
        const detail = hevyDetail(p.days.map((d) => d.day), sessionMins)
        if (dayUnit) {
          if (detail) return <Cell figure={wm(detail.minutes)} unit={detail.volumeKg > 0 ? `${kc(detail.volumeKg)}kg lifted` : 'worked out'} pct={1} />
          return <Cell figure={p.counts.workoutDays ? '✓' : '—'} unit={p.counts.workoutDays ? 'worked out' : 'no workout'} pct={p.counts.workoutDays ? 1 : 0} muted={!p.counts.workoutDays} />
        }
        if (detail) return <Cell figure={wm(detail.minutes)} unit={detail.volumeKg > 0 ? `${kc(detail.volumeKg)}kg, ${p.counts.workoutDays} of ${p.totalDays}d` : `${p.counts.workoutDays} of ${p.totalDays} days`} pct={p.counts.workoutDays / p.totalDays} />
        return <Cell figure={String(p.counts.workoutDays)} unit={`of ${p.totalDays} days`} pct={p.counts.workoutDays / p.totalDays} muted={p.counts.workoutDays === 0} />
      })()}

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

function DayCard({ p, zoom, money }: {
  p: Period; zoom: Zoom; money: CompassMoney | null
}) {
  const sessionMins = useSessionMinutes()
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

/* -------------------------------------------------------------- two lives */

/* Six tiers, one boundary list -- tierOf (below, next to the domains it
   gates) reads the same array. A stop's day-value is the boundary minus
   one, which is what guarantees "+1 month" can never land a day inside
   tier 3 and show three months of numbers under a one-month header again:
   there is only one place "30" is written down. */
const TIER_BOUNDS = [7, 30, 90, 180, 365]

/* THE SLIDER USED TO CARRY A SEPARATE Days/Weeks/Months TOGGLE that only
   changed the drag increment -- the six futures underneath are the same six
   tiers regardless (see tierOf), so switching grain at rest, or dragging
   inside a tier, visibly did nothing. He called that dead. The handle now
   always drags a full day at a time, and these are the stops that actually
   change the picture -- tap one to jump straight there, or drag freely
   between them. */
const TIER_LABELS = ['This week', '+1 month', '+3 months', '+6 months', '+1 year']
const TIER_STOPS: { label: string; days: number }[] = [
  { label: 'Today', days: 0 },
  ...TIER_LABELS.map((label, i) => ({ label, days: TIER_BOUNDS[i] - 1 })),
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']



/* ---- the reel ---- */

/* The folder on his own machine, read once per visit and shared by the room
   and the library so they cannot disagree about what is in it. Restoring
   never prompts: a browser only grants this off a real click, so a page load
   that asked would simply be refused. */
/* A stable empty array: a new [] every render would re-run the pool memo and
   restart the clip on every keystroke elsewhere on the screen. */
const EMPTY_LOCAL: LocalReel[] = []

function useLocalFolder() {
  const [state, setState] = useState<FolderState>({ status: 'none' })
  useEffect(() => { void restoreFolder().then(setState) }, [])
  return { state, setState }
}

function useReelPool(localReels: LocalReel[] = []): string[] {
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
function useLocalNames(localReels: LocalReel[]): Map<string, string> {
  return useMemo(() => new Map(localReels.map((r) => [r.url, r.name])), [localReels])
}

function Reel({ url, label, count, onOpenLibrary, onNext }: {
  url: string; label?: string; count: number; onOpenLibrary: () => void; onNext: () => void
}) {
  const vid = useRef<HTMLVideoElement>(null)
  const [sound, setSound] = useState(true)
  const [failed, setFailed] = useState(false)
  /* His ask (2026-09-12): "I cannot stop it at all". One switch for every kind
     of reel -- the <video> element, the YouTube player, and the Vimeo embed --
     because from where he is sitting they are all just the clip that is
     playing. A new clip starts playing, so this resets with the url. */
  const [paused, setPaused] = useState(false)
  useEffect(() => { setPaused(false) }, [url])
  const kind = url ? reelKind(url) : null

  const { reelFiles, setReelFile } = useStore()
  /* An Instagram link is a page, not a video -- reel-fetch downloads it once
     and this download's success is what gets remembered, in the synced
     library, forever: a file that downloaded once will download the same way
     again. A FAILURE IS NEVER SYNCED. Some public reels refuse to hand over
     their video to a plain fetch at all -- Instagram withholds it, most often
     over the track's music rights, not over the reel being private -- and
     that isn't a fact about the link that a retry fixes, but it also isn't
     provably permanent, so it gets tried again next time this screen opens
     rather than being bricked from one bad attempt. `attempt` is this
     component's own memory of "already tried this url this time", not the
     store's. */
  const cached = kind === 'instagram' ? reelFiles?.[url] : undefined
  const [attempt, setAttempt] = useState<{ url: string; failed: boolean; message: string } | null>(null)

  useEffect(() => { setFailed(false); setSound(true) }, [url])

  useEffect(() => {
    if (kind !== 'instagram' || cached || attempt?.url === url) return
    setAttempt({ url, failed: false, message: '' })
    void callFunction('reel-fetch', { method: 'POST', body: { url } }).then((res) => {
      const fileUrl = res.ok && typeof (res.data as { fileUrl?: unknown })?.fileUrl === 'string'
        ? (res.data as { fileUrl: string }).fileUrl
        : ''
      if (fileUrl) { setReelFile(url, fileUrl); return }
      /* The reason changes with what reel-fetch actually tried -- signed in or
         not, expired session or a reel with no video at all -- so the message
         it sent back is what shows, not a copy of it kept here to drift. */
      const message = !res.ok && res.message?.trim() ? res.message : 'Could not reach the downloader.'
      setAttempt((cur) => (cur?.url === url ? { url, failed: true, message } : cur))
    })
  }, [url, kind, cached, attempt, setReelFile])

  const playable = kind === 'instagram' ? (cached || null) : url
  const effectiveKind = kind === 'instagram' ? (cached ? 'file' : null) : kind

  useEffect(() => {
    const v = vid.current
    if (!v || effectiveKind !== 'file') return
    v.muted = false
    /* Unmuted autoplay is refused unless the browser trusts this origin. Rather
       than guess, ask for sound and take muted playback over no playback. */
    v.play().catch(() => { v.muted = true; setSound(false); v.play().catch(() => setFailed(true)) })
  }, [playable, effectiveKind])

  useEffect(() => {
    const v = vid.current
    if (!v) return
    if (paused) v.pause()
    else void v.play().catch(() => { /* autoplay rules, already handled on mount */ })
  }, [paused, playable])

  const hear = () => { const v = vid.current; if (v) { v.muted = false; void v.play() } setSound(true) }

  const deadInstagram = kind === 'instagram' && !cached && attempt?.url === url && attempt.failed
  const fetchingInstagram = kind === 'instagram' && !cached && !deadInstagram

  return (
    <div className={`tl-reel${effectiveKind && !failed ? ' has-media' : ''}`}>
      {/* A clip that ends is a clip that hands off to another one, straight
          away, the same way he stops one habit for another instead of sitting
          in the gap. `loop` on the file, and `loop=1` in the YouTube/Vimeo
          embed, both used to replay the SAME clip forever -- so nothing here
          ever advanced on its own, only the manual Next button did. */}
      {!failed && effectiveKind === 'file' && (
        <video ref={vid} className="tl-media" src={playable ?? undefined} autoPlay playsInline onEnded={onNext} onError={() => setFailed(true)} />
      )}
      {!failed && kind === 'youtube' && (
        <YouTubeReel url={url} sound={sound} paused={paused} onEnded={onNext} onFail={() => setFailed(true)} />
      )}
      {/* Vimeo is a plain embed with no player API wired up here, so "paused"
          means the iframe is not mounted. Pressing play remounts it, which
          restarts the clip rather than resuming it -- worth it, because a
          control that visibly does nothing on one kind of reel is worse. */}
      {!failed && kind === 'vimeo' && !paused && (
        <iframe key={`${url}|${sound}`} className="tl-media" src={embedSrc(url, sound)} title="Reel"
          allow="autoplay; encrypted-media" frameBorder="0" />
      )}
      {!failed && kind === 'other' && <img className="tl-media" src={url} alt="" onError={() => setFailed(true)} />}

      {fetchingInstagram && (
        <div className="tl-reelempty">
          <p className="tl-l">Fetching this Reel…</p>
          <p>Downloaded once, then it plays straight from here on every device.</p>
        </div>
      )}
      {deadInstagram && (
        <div className="tl-reelempty is-bad">
          <p className="tl-l">That Reel would not download</p>
          <p className="tl-url">{url}</p>
          {/* The old wording here was a static guess, first blaming music
              rights and then a hardcoded rewrite of "what usually happens".
              Neither survives him actually setting up a session: reel-fetch
              now has two different true answers -- signed in vs not, expired
              vs never worked -- and the one that applies is decided server
              side. So the words on screen are reel-fetch's OWN answer, read
              straight (2026-09-12), not a copy of it kept here to go stale
              the next time that function's reasoning changes. */}
          <p>{attempt?.message || "It'll try again next time this screen opens."}</p>
        </div>
      )}

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
        {/* His report (2026-09-12): "I dont know which video it is, you
            doesnt show me any link" -- when one clip stalls with nothing on
            screen, there was no way to tell which link in the library it even
            was without opening the console. Always on screen now, not only in
            an error state: a blob URL is meaningless to read, so a local
            file shows its own name instead of the handle it is held by. */}
        {kind && !failed && (
          <a
            className="tl-nowplaying"
            href={url.startsWith('blob:') ? undefined : url}
            target={url.startsWith('blob:') ? undefined : '_blank'}
            rel="noreferrer"
            title={label ?? url}
          >
            {label ?? url}
          </a>
        )}
        {kind && kind !== 'other' && !failed && (
          <button className="tl-setshot" onClick={() => setPaused((v) => !v)} aria-pressed={paused}>
            {paused ? 'Play' : 'Pause'}
          </button>
        )}
        {count > 1 && <button className="tl-setshot" onClick={onNext}>Next</button>}
        {kind && kind !== 'other' && !failed && !sound && (
          <button className="tl-setshot is-hot" onClick={hear}>Sound on</button>
        )}
      </div>
    </div>
  )
}

/** A YouTube clip through the real IFrame API, not a static embed: the raw
 *  iframe had no way to know when a clip ended, so `loop=1` was the only
 *  option and the same thirty seconds played forever. This one calls onEnded
 *  the moment the clip finishes, the same pattern Mundi Opus already uses. */
function YouTubeReel({ url, sound, paused, onEnded, onFail }: {
  url: string; sound: boolean; paused: boolean; onEnded: () => void; onFail: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerRef = useRef<any>(null)
  const onEndedRef = useRef(onEnded)
  useEffect(() => { onEndedRef.current = onEnded }, [onEnded])
  const id = url.match(YT)?.[1] ?? ''

  const stallRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!id) { onFail(); return }
    let alive = true
    /* THE NODE THE API DESTROYS MUST NOT BE REACT'S. Given an element, the
       IFrame API REPLACES it with its own iframe -- so the div React rendered
       is gone from the DOM while React still believes it is there, and the
       next unmount throws "Failed to execute 'removeChild' on 'Node': The node
       to be removed is not a child of this node". That is the crash he kept
       hitting on this screen (2026-09-12), found from the message the error
       card now prints. So React owns an empty host it never fills, and the
       node handed to the API is created here and cleaned up here. */
    const host = hostRef.current
    if (!host) return
    const mount = document.createElement('div')
    /* The API copies this node's className onto the iframe it swaps in, which
       is how `.tl-media` -- the fill rule every other reel kind answers to --
       reaches the real playing element. Keeping it on the wrapper instead left
       the iframe unstyled and unfindable. */
    mount.className = 'tl-media'
    host.appendChild(mount)

    /* A HUNG PLAYER IS A FAILED ONE. His report (2026-09-12): a video that
       "isn't loading at all", with nothing in the app to say which one or
       even that anything is wrong. Two different ways that happens, both
       covered by starting this the moment the effect runs rather than after
       the API script has already loaded:
         - the script loads and the player exists, but YouTube's own internal
           calls get blocked (an ad-blocker or privacy extension is enough)
           and it never fires onError, so it just sits there;
         - the SCRIPT ITSELF never loads at all, in which case the code below
           never even runs -- a timer started inside that `.then()` would
           never exist to fire. Verified against this exact case: the first
           version of this fix started the clock only after load succeeded,
           and passed every test except the one that mattered, a fully
           blocked script, which it left hanging forever.
       Ten seconds either way, and it now surfaces exactly like any other
       failure: the card, the link, Skip. */
    let started = false
    const stall = setTimeout(() => { if (alive && !started) onFail() }, 10_000)
    stallRef.current = stall

    void loadYouTubeApi().then(() => {
      if (!alive || !host.isConnected) return
      playerRef.current = new window.YT!.Player(mount, {
        videoId: id,
        playerVars: { autoplay: 1, mute: sound ? 0 : 1, controls: 0, playsinline: 1, rel: 0 },
        events: {
          onStateChange: (e: { data: number }) => {
            if (e.data === 1 || e.data === 3) { started = true; clearTimeout(stall) }
            if (e.data === 0) onEndedRef.current()
          },
          onError: () => { clearTimeout(stall); onFail() },
        },
      })
    })
    return () => {
      alive = false
      if (stallRef.current) clearTimeout(stallRef.current)
      try { playerRef.current?.destroy?.() } catch { /* already gone with its node */ }
      playerRef.current = null
      /* Whatever the API left behind goes with it. React never rendered these
         children, so clearing them is not touching anything React tracks. */
      host.replaceChildren()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    const p = playerRef.current
    if (!p?.mute) return
    if (sound) p.unMute?.()
    else p.mute?.()
  }, [sound])

  useEffect(() => {
    const p = playerRef.current
    if (!p?.pauseVideo) return
    if (paused) p.pauseVideo?.()
    else p.playVideo?.()
  }, [paused])

  /* Given a real element (not a string id), the IFrame API replaces this div
     in place with its generated iframe and carries the className over, so
     tl-media -- the fill rule every other reel kind already answers to --
     lands on the real playing element with no extra wrapper or CSS. */
  return <div ref={hostRef} className="tl-ythost" />
}

/* ---- the library ---- */
/* A PROMPT CANNOT TAKE THREE HUNDRED LINKS, which is what he asked for. This
   is a textarea he can paste a page into: every URL in it is pulled out, the
   same clip under four different YouTube spellings counts once, and the panel
   says what it took before he saves. */
function ReelLibrary({ pool, folder, onClose }: {
  pool: string[]
  folder: { state: FolderState; setState: (s: FolderState) => void }
  onClose: () => void
}) {
  const { reels, setReels } = useStore()
  const [text, setText] = useState(() => (reels ?? []).join('\n'))
  const parsed = useMemo(() => parseReels(text), [text])
  const counts = useMemo(() => {
    const c = { youtube: 0, vimeo: 0, instagram: 0, file: 0, other: 0 }
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

        {/* A FOLDER ON HIS OWN MACHINE. His instruction (2026-09-12) after
            Instagram refused a download for the third time: he is not uploading
            anything, the app should read the clips off his disk. A page cannot
            open a path -- file:// from https is refused everywhere -- but it can
            be handed a folder, once, and remember it. */}
        <div className="tl-folder">
          {folder.state.status === 'unsupported' && (
            <p className="tl-libsay is-quiet">
              Reading a folder needs Chrome or Edge. Safari and Firefox do not offer it, so on
              those the links above are the only way in.
            </p>
          )}
          {folder.state.status === 'none' && (
            <>
              <button className="tl-setshot" onClick={() => void pickFolder().then(folder.setState)}>
                Play from a folder
              </button>
              <span className="tl-libsay is-quiet">
                Point it at a folder of .mp4, .webm, .mov or .m4v and they play here. Nothing is
                uploaded and nothing leaves the machine.
              </span>
            </>
          )}
          {folder.state.status === 'needs-permission' && (
            <>
              <button className="tl-setshot is-hot" onClick={() => void grantFolder().then(folder.setState)}>
                Allow {folder.state.name} again
              </button>
              <span className="tl-libsay is-quiet">
                The folder is remembered; the browser asks for permission again each time it
                restarts, and only off a click.
              </span>
            </>
          )}
          {folder.state.status === 'ready' && (
            <>
              <span className="tl-libsay">
                <b>{folder.state.reels.length}</b> clip{folder.state.reels.length === 1 ? '' : 's'} from <b>{folder.state.name}</b>
              </span>
              <button className="tl-setshot" onClick={() => void pickFolder().then(folder.setState)}>Change folder</button>
              <button className="tl-setshot" onClick={() => void forgetFolder().then(folder.setState)}>Stop using it</button>
            </>
          )}
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
          placeholder={'https://www.youtube.com/watch?v=...\nhttps://youtu.be/...\nhttps://youtube.com/shorts/...\nhttps://www.instagram.com/reel/...'} />
        <div className="tl-libcount">
          <span><b>{parsed.length}</b> link{parsed.length === 1 ? '' : 's'}</span>
          <span><b>{counts.youtube}</b> YouTube</span>
          <span><b>{counts.vimeo}</b> Vimeo</span>
          <span><b>{counts.instagram}</b> Instagram</span>
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

/* ---- what it costs, what it pays ---- */

/** 1 = this week, 2 = a few weeks, 3 = a month or two, 4 = a season,
 *  5 = half a year+, 6 = the long haul. Day 0 is handled separately, on
 *  purpose: at nine in the morning nothing has actually happened yet, and
 *  dramatizing that would be the one lie this screen could tell. */
/* Six tiers, one boundary list. The tap-stops on the footer's scrubber name
   these same six tiers -- they read this array too (see TIER_STOPS) instead
   of carrying their own copy of "30", "90", "180"... a second copy is
   exactly how a stop labelled "+1 month" ended up landing one day inside
   tier 3 and showing three months of numbers under a one-month header. */
function tierOf(days: number): 1 | 2 | 3 | 4 | 5 | 6 {
  for (let i = 0; i < TIER_BOUNDS.length; i++) if (days < TIER_BOUNDS[i]) return (i + 1) as 1 | 2 | 3 | 4 | 5
  return 6
}



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
function TwoLives({ onBack, money }: { onBack: () => void; money: CompassMoney | null }) {
  const { habits, habitLog, goals, tasks, routines, routineLog, slips } = useStore()
  const health = useHealth().state
  const folder = useLocalFolder()
  const localReels = folder.state.status === 'ready' ? folder.state.reels : EMPTY_LOCAL
  const pool = useReelPool(localReels)
  const localNames = useLocalNames(localReels)
  const [lib, setLib] = useState(false)
  const [skip, setSkip] = useState(() => (pool.length ? Math.floor(Math.random() * pool.length) : 0))
  const advanceReel = () => setSkip((s) => {
    if (pool.length <= 1) return s
    const cur = s % pool.length
    let i = cur
    while (i === cur) i = Math.floor(Math.random() * pool.length)
    return i
  })
  const url = pool.length ? pool[skip % pool.length] : ''

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
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !lib) onBack() }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [onBack, lib])

  return (
    <div className="tl-lives">
      {/* His instruction, said three times and finally with a screenshot: full
          browser screen, OVER the navigation, 100vh, not scrollable, and one
          cross top right. It was made inline under the timeline's own header
          so the menu never left the screen; he does not want the menu here,
          he wants the screen. The cross is the way out, plus Escape. */}
      <button className="tl-close" onClick={onBack} aria-label="Close">&#10005;</button>
      <div className="tl-stage">
        <Reel url={url} label={localNames.get(url)} count={pool.length} onOpenLibrary={() => setLib(true)} onNext={advanceReel} />
        <div className="tl-status">
          {/* THE COUNTDOWN, his instruction: days, weeks and hours to the
              fourteenth of February. It is the hero because it is the only
              figure here that moves whether he does anything or not. */}
          <div className="tl-head-row">
            <div className="tl-count">
              <span className="tl-count-l">Until {clock.label}</span>
              <div className="tl-count-fig">
                <b>{clock.days.toLocaleString('en-GB')}</b>
                <span>days</span>
              </div>
              <div className="tl-count-sub">
                <span><b>{clock.weeks}</b> weeks</span>
                <span><b>{clock.hours.toLocaleString('en-GB')}</b> hours</span>
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

