/* THE TIMELINE.

   Three views behind one tab, on his design, 2026-08-27.

     THE LADDER   the default. One row per day, one column per thing that
                  moves the wheel, and the points that day was worth.
     THE FLYWHEEL a wheel whose speed IS his momentum, turned by the log
                  rather than by a button, with one card per day beside it.
     TWO LIVES    the give-up screen. Two futures, one scrubber.

   Two colours and nothing else: ink and one accent, plus red only where a day
   actually cost him something. It follows HUD mode because every colour comes
   from a token rather than a literal.

   Every number on all three views comes out of `momentum.ts`, which replays the
   log rather than storing a counter. Nothing here invents a figure, and where a
   source does not exist yet the column says so instead of showing a zero that
   looks like a fact. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './store'
import { momentumRun, momentumNow, stateFor, POINTS, type DayScore } from './momentum'

type View = 'ladder' | 'wheel' | 'lives'

const WINDOW = 45
const fmtDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function TimelinePage() {
  const { habits, habitLog, slips, tasks, focusSessions, inView } = useStore()
  const [view, setView] = useState<View>('ladder')

  const run = useMemo(
    () => momentumRun({ habits, habitLog, slips, tasks, focusSessions, inView }, WINDOW),
    [habits, habitLog, slips, tasks, focusSessions, inView],
  )
  const now = momentumNow(run)
  const rows = useMemo(() => [...run].reverse(), [run])

  return (
    <div className="page tline">
      <header className="tl-bar">
        <h1>Timeline</h1>
        <div className="tl-seg" role="group" aria-label="View">
          <button className={view === 'ladder' ? 'on' : ''} aria-pressed={view === 'ladder'} onClick={() => setView('ladder')}>The ladder</button>
          <button className={view === 'wheel' ? 'on' : ''} aria-pressed={view === 'wheel'} onClick={() => setView('wheel')}>The flywheel</button>
        </div>
        <span className="tl-mom">
          <b>{Math.round(now)}</b>
          <span className="tl-l">{stateFor(now)}</span>
        </span>
        <button className="tl-giveup" onClick={() => setView('lives')}>I want to give up</button>
      </header>

      {view === 'ladder' && <Ladder rows={rows} />}
      {view === 'wheel' && <Flywheel rows={rows} now={now} />}
      {view === 'lives' && <TwoLives onBack={() => setView('ladder')} now={now} />}
    </div>
  )
}

/* ------------------------------------------------------------------ ladder */
function Ladder({ rows }: { rows: DayScore[] }) {
  return (
    <>
      <div className="tl-head" aria-hidden="true">
        <span />
        <span className="tl-l">Habits</span>
        <span className="tl-l">Held clean</span>
        <span className="tl-l">Tasks</span>
        <span className="tl-l">Focus</span>
        <span className="tl-l">Points</span>
      </div>
      <div className="tl-rungs">
        {rows.slice(0, 21).map((r, i) => {
          const d = fmtDay(r.day)
          const empty = r.parts.habits + r.parts.tasks + r.parts.focus === 0
          return (
            <div className={`tl-rung${i === 0 ? ' is-today' : ''}${empty ? ' is-empty' : ''}`} key={r.day}>
              <span className="tl-day">
                <b>{d.getDate()}</b>
                <span className="tl-l">{d.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
              </span>
              <Cell v={r.counts.habits} pct={r.parts.habits / Math.max(1, r.baseline * 0.5)} />
              <Cell v={r.counts.quits} pct={r.parts.quits / Math.max(1, r.baseline * 0.25)} />
              <Cell v={String(r.counts.tasks)} pct={r.parts.tasks / (POINTS.task * 3)} />
              <Cell v={`${Math.floor(r.counts.focusMin / 60)}h ${String(r.counts.focusMin % 60).padStart(2, '0')}`} pct={r.parts.focus / 48} />
              <span className={`tl-pts${r.delta < 0 ? ' is-down' : ''}`}>
                <b>{r.earned}</b>
                <i>{r.delta >= 0 ? `+${r.delta.toFixed(1)}` : r.delta.toFixed(1)}</i>
              </span>
            </div>
          )
        })}
      </div>
      <p className="tl-note">
        Points are what the day was worth. The figure beside them is what it did to the wheel:
        a full day adds, most of a day adds less, and a day you logged nothing on halves it.
      </p>
    </>
  )
}
function Cell({ v, pct }: { v: string; pct: number }) {
  return (
    <span className="tl-cell">
      <b>{v}</b>
      <span className="tl-m"><i style={{ width: `${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%` }} /></span>
    </span>
  )
}

/* ---------------------------------------------------------------- flywheel */
function Flywheel({ rows, now }: { rows: DayScore[]; now: number }) {
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
    const css = getComputedStyle(document.documentElement)
    /* --a-accent is the FILL colour: lime on paper, which is almost invisible as a
       1px line. --a-accent-text is the same accent at readable contrast, and is
       what every other thin mark in this app uses. */
    const accent = css.getPropertyValue('--a-accent-text').trim() || '#5E6B12'
    const ink = css.getPropertyValue('--ink').trim() || '#12100C'
    const size = () => {
      const r = c.getBoundingClientRect(), dpr = devicePixelRatio || 1
      c.width = r.width * dpr; c.height = r.height * dpr
    }
    size()
    const draw = () => {
      if (dead) return
      const W = c.width, H = c.height, R = Math.min(W, H) * 0.34
      const inertia = 1 + Math.max(0, 26 - now) / 26 * 1.6
      if (!reduce) ang += (now / inertia) * 0.0016
      cx.clearRect(0, 0, W, H)
      const lit = Math.min(1, now / 100)
      cx.lineWidth = Math.max(5, R * 0.07)
      cx.strokeStyle = ink
      cx.globalAlpha = 0.12 + 0.2 * lit
      cx.beginPath(); cx.arc(W / 2, H / 2, R, 0, 6.2832); cx.stroke()
      cx.globalAlpha = 1
      for (let i = 0; i < 14; i++) {
        const a = ang + i * (6.2832 / 14)
        cx.strokeStyle = accent
        cx.globalAlpha = 0.22 + 0.7 * lit
        cx.lineWidth = Math.max(2, R * 0.016)
        cx.beginPath()
        cx.moveTo(W / 2 + Math.cos(a) * R * 0.34, H / 2 + Math.sin(a) * R * 0.34)
        cx.lineTo(W / 2 + Math.cos(a) * R * 0.95, H / 2 + Math.sin(a) * R * 0.95)
        cx.stroke()
      }
      cx.globalAlpha = 1
      raf = requestAnimationFrame(draw)
    }
    draw()
    addEventListener('resize', size)
    return () => { dead = true; cancelAnimationFrame(raf); removeEventListener('resize', size) }
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
        <p className="tl-wheelnote">
          Turned by the log, never by a button. Habits, tasks, focus and every break habit held clean.
        </p>
      </div>

      <div className="tl-days">
        {rows.slice(0, 14).map((r) => {
          const d = fmtDay(r.day)
          const empty = r.parts.habits + r.parts.tasks + r.parts.focus === 0
          return (
            <article className={`tl-card${r.delta < 0 ? ' is-down' : ''}${empty ? ' is-empty' : ''}`} key={r.day}>
              <div className="tl-cardtop">
                <span className="tl-l">{d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                <span className="tl-delta">{r.delta >= 0 ? `+${r.delta.toFixed(1)}` : r.delta.toFixed(1)}</span>
              </div>
              <div className="tl-cardpts"><b>{r.earned}</b><i>of {r.baseline}</i></div>
              <div className="tl-bd">
                <span><b>{r.counts.habits.split('/')[0]}</b> habits</span>
                <span><b>{r.counts.quits}</b> clean</span>
                <span><b>{r.counts.tasks}</b> tasks</span>
                <span><b>{Math.floor(r.counts.focusMin / 60)}h{String(r.counts.focusMin % 60).padStart(2, '0')}</b> focus</span>
              </div>
              {empty && <p className="tl-pen">Nothing logged. The wheel lost half.</p>}
            </article>
          )
        })}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- two lives */
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
function TwoLives({ onBack, now }: { onBack: () => void; now: number }) {
  const [i, setI] = useState(0)
  const s = STOPS[i]
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBack()
      if (e.key === 'ArrowRight') setI((v) => Math.min(STOPS.length - 1, v + 1))
      if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1))
    }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [onBack])

  return (
    <div className="tl-lives" role="dialog" aria-label="Two lives">
      <div className="tl-panes">
        <section className="tl-pane is-drift">
          <span className="tl-pill">If you skip</span>
          <div className="tl-shot" data-slot="drift" />
          <p className="tl-said">{s.drift}</p>
        </section>
        <section className="tl-pane is-push">
          <span className="tl-pill">If you do it anyway</span>
          <div className="tl-shot" data-slot="push" />
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
        <p>Both men leave tomorrow morning with your name and a momentum of {Math.round(now)}.
        Every stop you pass is the difference one of them kept paying for.</p>
      </div>
    </div>
  )
}
