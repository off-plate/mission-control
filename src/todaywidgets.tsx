/* FOUR WIDGETS FOR TODAY, added on his instruction (2026-09-16) after
   reacting to a set of mockups: Health, the Cookie Jar, Compass, and Why all
   grew their own pages while Today stayed the same shape underneath them.
   These read the SAME live data those pages already compute -- no new
   fetches, no shadow copies of a number that could drift from the page that
   owns it.

   Two of the six mocked widgets are not here: "Yours to tick" is already
   the Habits card two sections below (troom-lower in todayroom.tsx), and
   "Focus today" is already the Focused stat tile (troom-stats) -- both
   existed before this file did, and building a second version of either
   would just be the same number drawn twice. */
import { useMemo } from 'react'
import { useStore } from './store'
import { bodyStat, dayOf, daysSince, series, useHealth } from './health'
import { useCompass } from './compass'
import { chainPromiseLine, inAllSpaces, WINDOW } from './timeline'
import { momentumRun, chainOf } from './momentum'
import { WALL, type Card } from './board'
import { fmtDuration } from './util'

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

/* ---------------- HEALTH ---------------- */

function HealthWidget() {
  const { setPage } = useStore()
  const { state } = useHealth()
  if (state.status !== 'ok') return null
  const sleep = bodyStat(state.days, 'sleep_secs', 7)
  const sleepSeries = series(state.days, 'sleep_secs', 7)
  const steps = bodyStat(state.days, 'steps', 1)
  if (!sleep.last && !steps.last) return null
  const maxSleep = Math.max(28800, ...sleepSeries.map((d) => d.value ?? 0)) // 8h ceiling, or higher if he slept more
  return (
    <button className="tr-card tr-card--hover tr-widget" onClick={() => setPage('health')}>
      <div className="tr-head"><p className="tr-l">Sleep, 7 days</p>
        <span className="tr-n tr-sm">{sleep.avg ? fmtDuration(Math.round(sleep.avg / 60)) : '—'}<i> avg</i></span></div>
      <div className="trw-bars">
        {sleepSeries.map((d, i) => (
          <i key={d.day} className={i === sleepSeries.length - 1 ? 'is-today' : ''} style={{ height: `${d.value ? Math.max(6, (d.value / maxSleep) * 100) : 3}%` }} />
        ))}
      </div>
      {steps.last && (() => {
        const age = daysSince(steps.last.day)
        return (
          <div className="trw-foot">
            <span>Steps, {age === 0 ? 'today' : age === 1 ? 'yesterday' : `${age}d ago`}</span>
            <b className="mono">{steps.last.value.toLocaleString('en-GB')}</b>
          </div>
        )
      })()}
    </button>
  )
}

/* ---------------- COOKIE JAR ---------------- */

function CookieJarWidget() {
  const { habits, habitLog, tasks, focusSessions, setPage } = useStore()
  const { state: health } = useHealth()
  const trainedDays = useMemo(
    () => new Set(health.status === 'ok' ? health.sessions.map(dayOf).filter(Boolean) : []),
    [health],
  )
  const run = useMemo(
    () => momentumRun({ habits, habitLog, tasks, focusSessions, inView: inAllSpaces, workoutDays: trainedDays }, WINDOW),
    [habits, habitLog, tasks, focusSessions, trainedDays],
  )
  const chain = chainOf(run)
  if (run.length === 0) return null
  return (
    <button className="tr-card tr-card--hover tr-widget" onClick={() => setPage('timeline')}>
      <div className="tr-head"><p className="tr-l">The chain</p>
        <span className="tr-n tr-sm">Day {chain.current}</span></div>
      <p className="trw-line">{chainPromiseLine(chain)}</p>
      <div className="trw-dots">
        {Array.from({ length: 7 }, (_, i) => <i key={i} className={i < Math.min(chain.current, 7) ? 'is-on' : ''} />)}
      </div>
    </button>
  )
}

/* ---------------- COMPASS / DEBT ---------------- */

function DebtWidget() {
  const { setPage } = useStore()
  const { state } = useCompass()
  if (state.status !== 'ok') return null
  const { money } = state
  const R = 22, C = 2 * Math.PI * R
  const nextDue = [...money.due].filter((d) => !d.sent).sort((a, b) => a.day - b.day)[0]
  return (
    <button className="tr-card tr-card--hover tr-widget" onClick={() => setPage('timeline')}>
      <div className="tr-head"><p className="tr-l">Debt, this cycle</p></div>
      <div className="trw-ring">
        <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true">
          <circle cx="26" cy="26" r={R} fill="none" stroke="var(--hairline)" strokeWidth="6" />
          <circle
            cx="26" cy="26" r={R} fill="none" stroke="var(--warn)" strokeWidth="6" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C - (money.pct / 100) * C} transform="rotate(-90 26 26)"
          />
        </svg>
        <div><div className="trw-ringfig">{money.pct}%</div><div className="trw-ringsub">paid off</div></div>
      </div>
      {nextDue && (
        <div className="trw-foot">
          <span>Next payment</span>
          <b className="mono">the {ordinal(nextDue.day)}, {Math.round(nextDue.amount).toLocaleString('cs-CZ')} Kč</b>
        </div>
      )}
    </button>
  )
}

/* ---------------- WHY ---------------- */

/** One statement, changed once a day rather than on every render or every
 *  visit -- a quiet daily anchor, not a slot machine. Picked by the day
 *  number so it is the same read all day and different tomorrow, with no
 *  state to persist for it. */
function dailyCard(cards: Card[], day: number): Card {
  const statements = cards.filter((c): c is Card & { kind: 'statement' } => c.kind === 'statement')
  return statements[day % statements.length]
}

function WhyWidget() {
  const { setPage } = useStore()
  const dayNum = Math.floor(Date.now() / 86_400_000)
  const card = dailyCard(WALL, dayNum)
  if (!card || card.kind !== 'statement') return null
  return (
    <button className="tr-card tr-card--hover tr-widget" onClick={() => setPage('board')}>
      <div className="tr-head"><p className="tr-l">Why</p></div>
      <p className="trw-quote">{card.text}</p>
      <div className="trw-foot"><span>Today's reason</span><span>Open the wall &rarr;</span></div>
    </button>
  )
}

export function TodayWidgets() {
  return (
    <section className="troom-widgets">
      <HealthWidget />
      <CookieJarWidget />
      <DebtWidget />
      <WhyWidget />
    </section>
  )
}
