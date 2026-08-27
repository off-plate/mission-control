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
import {
  momentumRun, momentumNow, stateFor, chainOf, rollUp,
  POINTS, CAPS, HABIT_TARGET, TASK_TARGET, FOCUS_TARGET_MIN, HARD_MIN_DAYS,
  EMPTY_WIPE, KEPT_AT,
  type DayScore, type Period, type Zoom,
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
      {view === 'wheel' && <Flywheel rows={shown} zoom={zoom} now={now} money={money} />}

      {lives && <TwoLives onBack={() => setLives(false)} now={now} chain={chain} />}
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
function Flywheel({ rows, zoom, now, money }: {
  rows: Period[]; zoom: Zoom; now: number; money: CompassMoney | null
}) {
  const cv = useRef<HTMLCanvasElement>(null)
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
      return { accent: css.getPropertyValue('--tl-hot').trim() || '#C6F24A', ink: css.getPropertyValue('--tl-line').trim() || 'rgba(255,255,255,.1)' }
    }
    let paint = read()
    const size = () => {
      const r = c.getBoundingClientRect(), dpr = devicePixelRatio || 1
      c.width = Math.max(1, r.width * dpr); c.height = Math.max(1, r.height * dpr)
      paint = read()
    }
    size()
    /* A CANVAS DOES NOT INHERIT A TOKEN, IT COPIES ONE. Switching to HUD mode
       repaints every other mark on the page and left the wheel lime, because
       the palette had been read once at mount and nothing here resizes when the
       mode changes. The observer is on one attribute of one element, which is
       cheaper by far than reading the computed style on every frame. */
    const shell = c.closest('.shell')
    const watch = shell ? new MutationObserver(() => { paint = read() }) : null
    watch?.observe(shell!, { attributes: true, attributeFilter: ['class'] })
    const draw = () => {
      if (dead) return
      const W = c.width, H = c.height, R = Math.min(W, H) * 0.36
      const inertia = 1 + Math.max(0, 26 - now) / 26 * 1.6
      if (!reduce) ang += (now / inertia) * 0.0016
      cx.clearRect(0, 0, W, H)
      const lit = Math.min(1, now / 100)
      cx.lineWidth = Math.max(5, R * 0.06)
      cx.strokeStyle = paint.ink
      cx.beginPath(); cx.arc(W / 2, H / 2, R, 0, 6.2832); cx.stroke()
      /* The lit arc is how far round the ceiling he is, so the wheel is a gauge
         standing still as well as a speed once it moves. */
      cx.strokeStyle = paint.accent
      cx.globalAlpha = 0.9
      cx.beginPath(); cx.arc(W / 2, H / 2, R, -1.5708, -1.5708 + 6.2832 * lit); cx.stroke()
      for (let i = 0; i < 14; i++) {
        const a = ang + i * (6.2832 / 14)
        cx.globalAlpha = 0.2 + 0.7 * lit
        cx.lineWidth = Math.max(2, R * 0.015)
        cx.beginPath()
        cx.moveTo(W / 2 + Math.cos(a) * R * 0.3, H / 2 + Math.sin(a) * R * 0.3)
        cx.lineTo(W / 2 + Math.cos(a) * R * 0.93, H / 2 + Math.sin(a) * R * 0.93)
        cx.stroke()
      }
      cx.globalAlpha = 1
      raf = requestAnimationFrame(draw)
    }
    draw()
    addEventListener('resize', size)
    return () => { dead = true; cancelAnimationFrame(raf); removeEventListener('resize', size); watch?.disconnect() }
  }, [now])

  return (
    <div className="tl-wheelwrap">
      <div className="tl-wheel">
        <canvas ref={cv} />
        <div className="tl-wheelread">
          <b>{Math.round(now)}</b>
          <span className="tl-l">momentum</span>
          <span className="tl-state">{stateFor(now)}</span>
        </div>
        <Maths />
        <p className="tl-wheelnote">Turned by the log, never by a button.</p>
      </div>

      <div className="tl-days">
        {rows.map((p) => <DayCard key={p.key} p={p} zoom={zoom} money={money} />)}
      </div>
    </div>
  )
}

/* THE MATHS, on the page rather than in his head.
   Every figure in here is read off the constants in `momentum.ts`, so the
   explanation cannot drift away from the model the way a written-out one
   would the first time a weight changed. */
function Maths() {
  const full = HABIT_TARGET * POINTS.habit + TASK_TARGET * POINTS.task + (FOCUS_TARGET_MIN / 10) * POINTS.focusPer10 + POINTS.hard
  return (
    <div className="tl-maths">
      <button type="button" aria-label="How the momentum is worked out">i</button>
      <div className="tl-mathsbox" role="note">
        <p className="tl-l">What earns points</p>
        <dl>
          <div><dt>A habit kept</dt><dd>{POINTS.habit}<small>each, {CAPS.habit} max</small></dd></div>
          <div><dt>A task finished</dt><dd>{POINTS.task}<small>each, {CAPS.task} max</small></dd></div>
          <div><dt>Ten minutes of focus</dt><dd>{POINTS.focusPer10}<small>up to {CAPS.focusMin / 60}h</small></dd></div>
          <div><dt>The hard thing</dt><dd>{POINTS.hard}<small>waited {HARD_MIN_DAYS}d+</small></dd></div>
          <div className="off"><dt>A workout</dt><dd>{POINTS.workout}<small>not connected</small></dd></div>
          <div className="off"><dt>Finances</dt><dd>{'\u2014'}<small>read, not scored</small></dd></div>
        </dl>
        <p className="tl-l">What it does to the wheel</p>
        <p>A full day is <b>{full} points</b>. Hit all of it and the wheel gains its most.
        Three quarters gains less, half gains a little, and under half of a day <b>costs</b> you.
        A day you logged nothing on takes <b>{Math.round(EMPTY_WIPE * 100)}%</b> of the wheel with it.</p>
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
        <div className="off"><dt>Health</dt><dd>{'\u2014'}<small>not connected</small></dd></div>
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
/* Over the whole window, on his instruction: this is the screen he opens when
   he wants to stop, and it does not share the page with a nav bar.

   The copy and the media here are still the placeholder shape from the artifact
   he approved. He asked to leave it until the ladder and the wheel are right,
   so nothing below pretends to be finished. */
const STOPS = [
  { at: 'Today', gap: 0,
    drift: 'The same man, twice. Nothing has happened yet.',
    push: 'The same man, twice. Nothing has happened yet.' },
  { at: '1 month', gap: 22,
    drift: 'The chain is still what it was. It was that in July too.',
    push: 'Thirty six days unbroken, and it stopped being a decision.' },
  { at: '6 months', gap: 139,
    drift: 'The post has been drafted for two hundred and eighty days.',
    push: 'Twenty four posts out. The first three clients signed.' },
  { at: '1 year', gap: 287,
    drift: 'Same weight, same debt. The year passed either way.',
    push: 'The body and the balance moved together, all year.' },
  { at: '3 years', gap: 864,
    drift: 'You are still explaining the plan to her.',
    push: 'Debt free, and you never had to explain it again.' },
]
function TwoLives({ onBack, now, chain }: { onBack: () => void; now: number; chain: ReturnType<typeof chainOf> }) {
  const [i, setI] = useState(0)
  const s = STOPS[i]
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBack()
      if (e.key === 'ArrowRight') setI((v) => Math.min(STOPS.length - 1, v + 1))
      if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1))
    }
    addEventListener('keydown', k)
    /* It covers the window, so the page behind it must not scroll under it. */
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { removeEventListener('keydown', k); document.body.style.overflow = prev }
  }, [onBack])

  return (
    <div className="tl-lives" role="dialog" aria-modal="true" aria-label="Two lives">
      <header className="tl-livestop">
        <span className="tl-l">If you stop now</span>
        <button className="tl-close" onClick={onBack} aria-label="Close">✕</button>
      </header>
      <div className="tl-panes">
        <section className="tl-pane is-drift">
          <span className="tl-pill">If you skip</span>
          <div className="tl-shot" data-slot="drift"><span className="tl-l">Footage to come</span></div>
          <p className="tl-said">{s.drift}</p>
        </section>
        <section className="tl-pane is-push">
          <span className="tl-pill">If you do it anyway</span>
          <div className="tl-shot" data-slot="push"><span className="tl-l">Footage to come</span></div>
          <p className="tl-said">{s.push}</p>
        </section>
        <div className="tl-gap"><b>{s.gap}</b><span className="tl-l">days apart</span></div>
      </div>
      <div className="tl-scrub">
        {STOPS.map((x, k) => (
          <button key={x.at} className={k === i ? 'on' : k < i ? 'past' : ''} onClick={() => setI(k)}>
            <span className="tl-knob" /><span className="tl-l">{x.at}</span>
          </button>
        ))}
      </div>
      <div className="tl-livesfoot">
        <button className="tl-back" onClick={onBack}>Ok. Let&rsquo;s go.</button>
        <p>Both men leave tomorrow morning with your name, a momentum of {Math.round(now)} and
        a {chain.current} day chain. Every stop you pass is the difference one of them kept paying for.</p>
      </div>
    </div>
  )
}
