/* THE LONGEVITY PAGE. Goals, and what the habit record says about them.

   Every sentence on this page is computed from the record, not written in
   advance: the headline of each section names the habit, step or weekday the
   numbers actually point at, and a section with too little history says so
   instead of inventing a finding. Built from the approved proposal
   (2026-09-30). The Jar's dark pages are the home of this one. */
import { useMemo } from 'react'
import { useStore } from './store'
import { bestCleanRun, bestStreak, currentStreak, daysClean, goalCurrent, habitTarget, keptDaysIn, type HabitDef, type Goal } from './types'
import { dayOfWeekKey, goalPeriodKey, goalPeriodRange, localDateKey, type GoalTf } from './util'
import { TARGET_HABIT_NAME, getAllHevyDayStats, getHevyExerciseHistory, prsOnDay } from './hevy'
import { isCardioHabit } from './cardio'

const DAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEEKS = 18

const addDays = (key: string, n: number): string => {
  const [y, m, d] = key.split('-').map(Number)
  return localDateKey(new Date(y, m - 1, d + n))
}
const dowOf = (key: string): number => {
  const [y, m, d] = key.split('-').map(Number)
  return (new Date(y, m - 1, d).getDay() + 6) % 7
}
const shortDate = (key: string): string => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
const longDate = (key: string): string => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

type Ring = { name: string; now: number; target: number; unit: string; tone: 'deep' | 'mid' | 'coral' }

export function LongevityPage() {
  const { habits, habitLog, routines, stepTicks, goals, slips, focusSessions, todayIndex, inView } = useStore()

  const v = useMemo(() => {
    const today = localDateKey()
    const mon = dayOfWeekKey(0)
    const sun = dayOfWeekKey(6)
    const live = habits.filter((h) => !h.archivedAt && inView(h.space))
    const folderHabitIds = new Set(routines.filter((r) => r.habitId).map((r) => r.habitId as string))
    const keptBy = new Map<string, Set<string>>()
    for (const t of habitLog) {
      let s = keptBy.get(t.habitId)
      if (!s) { s = new Set(); keptBy.set(t.habitId, s) }
      s.add(t.day)
    }
    const kept = (h: HabitDef, day: string) => keptBy.get(h.id)?.has(day) ?? false
    const firstTick = (h: HabitDef): string => {
      const s = keptBy.get(h.id)
      const first = s && s.size ? [...s].sort()[0] : today
      return h.startedOn && h.startedOn < first ? h.startedOn : first
    }

    /* The habits that make up "a day": daily or weekday build habits, not the
       routine folders themselves (their steps are already habits). */
    const daily = live.filter((h) =>
      h.kind !== 'break' && !h.paused && !folderHabitIds.has(h.id) && !h.optional
      && (h.frequency === undefined || h.frequency === 'daily' || h.frequency === 'weekdays'),
    )
    const expects = (h: HabitDef, day: string) => day >= firstTick(h) && (h.frequency !== 'weekdays' || dowOf(day) < 5)

    /* ---- this week's rings ---- */
    const weekKept = (h: HabitDef) => keptDaysIn(habitLog, h.id, mon, sun).size
    const focusH = live.filter((h) => h.auto?.from === 'focus').sort((a, b) => (b.auto?.minutes ?? 0) - (a.auto?.minutes ?? 0))[0]
    const gymH = live.find((h) => h.name.trim().toLowerCase() === TARGET_HABIT_NAME)
    const bedR = routines.find((r) => !r.archivedAt && r.habitId && /before bed/i.test(r.title))
    const bedH = bedR ? live.find((h) => h.id === bedR.habitId) : undefined
    const rings: Ring[] = []
    if (focusH) rings.push({ name: focusH.name, now: weekKept(focusH), target: 7, unit: 'days', tone: 'deep' })
    if (gymH) rings.push({ name: 'Train', now: weekKept(gymH), target: Math.max(1, Math.min(7, habitTarget(gymH) === 7 ? 5 : habitTarget(gymH))), unit: 'days', tone: 'mid' })
    if (bedH && bedR) rings.push({ name: bedR.title, now: weekKept(bedH), target: 7, unit: 'nights', tone: 'coral' })

    /* ---- how every day went ---- */
    const dayScore = (day: string): { kept: number; of: number } => {
      let k = 0, n = 0
      for (const h of daily) { if (!expects(h, day)) continue; n++; if (kept(h, day)) k++ }
      return { kept: k, of: n }
    }
    const span = WEEKS * 7
    const dayInfo: Record<string, { kept: number; of: number }> = {}
    for (let i = 0; i < span; i++) { const d = addDays(today, -i); dayInfo[d] = dayScore(d) }
    const perfectDays = Object.entries(dayInfo).filter(([d, s]) => d < today && s.of >= 3 && s.kept === s.of).length
    const wdSum = [0, 0, 0, 0, 0, 0, 0], wdN = [0, 0, 0, 0, 0, 0, 0]
    for (const [d, s] of Object.entries(dayInfo)) {
      if (d >= today || s.of < 3) continue
      wdSum[dowOf(d)] += s.kept / s.of; wdN[dowOf(d)]++
    }
    const wd = wdSum.map((x, i) => (wdN[i] ? x / wdN[i] : null))
    const wdKnown = wd.map((x, i) => ({ x, i })).filter((p): p is { x: number; i: number } => p.x !== null)
    const weakest = wdKnown.length >= 4 ? wdKnown.reduce((a, b) => (b.x < a.x ? b : a)) : null
    const strongest = wdKnown.length >= 4 ? wdKnown.reduce((a, b) => (b.x > a.x ? b : a)) : null

    /* ---- streaks ---- */
    const streaks = [
      ...daily.map((h) => ({ name: h.name, now: currentStreak(habitLog, h.id), best: bestStreak(habitLog, h.id), quit: false })),
      ...live.filter((h) => h.kind === 'break').map((h) => ({ name: h.name, now: daysClean(h, slips) ?? 0, best: bestCleanRun(h, slips), quit: true })),
    ].filter((s) => s.best >= 3)
      .sort((a, b) => b.now - a.now)
      .slice(0, 4)
    const nearRecord = streaks.filter((s) => !s.quit && s.now < s.best).sort((a, b) => (a.best - a.now) - (b.best - b.now))[0]
    const atRecord = streaks.find((s) => s.now > 0 && s.now >= s.best)

    /* ---- the keystone: which habit the rest of the day follows ---- */
    const from56 = addDays(today, -56)
    const days56: string[] = []
    for (let d = from56; d < today; d = addDays(d, 1)) days56.push(d)
    let keystone: { name: string; rows: { name: string; a: number; b: number }[]; lift: number } | null = null
    for (const H of daily) {
      const yes = days56.filter((d) => expects(H, d) && kept(H, d))
      const no = days56.filter((d) => expects(H, d) && !kept(H, d))
      if (yes.length < 10 || no.length < 10) continue
      const rows: { name: string; a: number; b: number }[] = []
      for (const O of daily) {
        if (O.id === H.id) continue
        const ey = yes.filter((d) => expects(O, d)), en = no.filter((d) => expects(O, d))
        if (ey.length < 8 || en.length < 8) continue
        rows.push({ name: O.name, a: Math.round((ey.filter((d) => kept(O, d)).length / ey.length) * 100), b: Math.round((en.filter((d) => kept(O, d)).length / en.length) * 100) })
      }
      rows.sort((x, y) => (y.a - y.b) - (x.a - x.b))
      const top = rows.slice(0, 4)
      if (top.length < 2) continue
      const lift = top.reduce((a, r) => a + (r.a - r.b), 0) / top.length
      if (!keystone || lift > keystone.lift) keystone = { name: H.name, rows: top, lift }
    }

    /* ---- the routine that leaks ---- */
    const from84 = addDays(today, -84)
    let leak: { title: string; steps: { title: string; n: number }[]; cliffAt: number } | null = null
    let leakScore = 0
    for (const r of routines) {
      if (r.archivedAt || !inView(r.space) || r.steps.length < 3) continue
      /* A step never ticked in 12 weeks is new or unused, not a place the
         routine loses you, so it stays out of the picture. */
      const steps = r.steps.map((st) => ({
        title: st.title,
        n: new Set(stepTicks.filter((t) => t.routineId === r.id && t.stepId === st.id && t.day >= from84).map((t) => t.day)).size,
      })).filter((s) => s.n > 0)
      if (steps.length < 3) continue
      const started = Math.max(...steps.map((s) => s.n))
      if (started < 8) continue
      let worst = -1, drop = 0
      for (let i = 1; i < steps.length; i++) {
        const d = steps[i - 1].n - steps[i].n
        if (d > drop) { drop = d; worst = i }
      }
      const score = drop / started
      if (worst > 0 && drop >= 3 && score > leakScore) { leakScore = score; leak = { title: r.title, steps, cliffAt: worst } }
    }

    /* ---- goals on pace ---- */
    const GTF: Record<string, GoalTf> = { weekly: 'weekly', monthly: 'monthly', quarter: 'quarter', half: 'half' }
    const goalRows = goals.filter((g: Goal) => !g.closed && inView(g.space)).map((g) => {
      const tf = GTF[g.timeframe ?? 'quarter'] ?? 'quarter'
      const range = goalPeriodRange(tf, g.periodKey ?? goalPeriodKey(tf))
      const now = goalCurrent(g, habits, habitLog, range, slips, focusSessions)
      const a = new Date(range.from + 'T00:00:00').getTime(), b = new Date(range.to + 'T23:59:59').getTime()
      const elapsed = Math.max(0, Math.min(1, (Date.now() - a) / (b - a)))
      const p = g.target > 0 ? Math.min(1, now / g.target) : 0
      const st = p >= 1 ? 'reached' : p >= elapsed - 0.06 ? 'on' : p >= elapsed - 0.25 ? 'drift' : 'behind'
      return { g, now, p, elapsed, st, money: g.category === 'money' }
    }).sort((x, y) => ({ behind: 0, drift: 1, on: 2, reached: 3 }[x.st] as number) - ({ behind: 0, drift: 1, on: 2, reached: 3 }[y.st] as number)).slice(0, 6)

    /* ---- gym records this month ---- */
    const hist = getHevyExerciseHistory()
    let prs = 0
    for (let i = 0; i < 30; i++) prs += prsOnDay(hist, addDays(today, -i)).length
    const gymDays = Object.keys(getAllHevyDayStats()).length

    const bestClean = Math.max(0, ...live.filter((h) => h.kind === 'break').map((h) => bestCleanRun(h, slips)))
    const bestHabitStreak = Math.max(0, ...daily.map((h) => bestStreak(habitLog, h.id)))
    const cardio = live.find(isCardioHabit)

    return { today, rings, dayInfo, perfectDays, wd, weakest, strongest, streaks, nearRecord, atRecord, keystone, leak: leak as { title: string; steps: { title: string; n: number }[]; cliffAt: number } | null, goalRows, prs, gymDays, bestClean, bestHabitStreak, cardio: !!cardio, dailyCount: daily.length }
  }, [habits, habitLog, routines, stepTicks, goals, slips, focusSessions, inView])

  const { rings } = v
  const elapsed = (todayIndex + 1) / 7
  const lagging = [...rings].sort((a, b) => (a.now / a.target - elapsed) - (b.now / b.target - elapsed))[0]
  const openRings = rings.filter((r) => r.now < r.target)
  const closing = [...openRings].sort((a, b) => (a.target - a.now) - (b.target - b.now))[0]
  const daysLeft = 7 - todayIndex
  const totalNow = rings.reduce((a, r) => a + r.now, 0), totalOf = rings.reduce((a, r) => a + r.target, 0)

  return (
    <div className="page">
      <div className="lv">
        <header className="lv-top">
          <p className="lv-sub">Your goals, and what your habit record says about them.</p>
          <div className="lv-strip">
            <div><b>{v.perfectDays}</b><span>perfect days, last 18 weeks</span></div>
            <div><b>{v.prs}</b><span>gym PRs, last 30 days</span></div>
            <div><b>{v.bestClean}</b><span>days, longest clean run</span></div>
          </div>
        </header>

        {v.dailyCount < 3 && rings.length === 0 && (
          <div className="lv-card"><p className="lv-say">There is not enough habit history yet. Keep ticking for a week and this page fills in.</p></div>
        )}

        {rings.length > 0 && (
          <section className="lv-card lv-hero">
            <div>
              <RingsSvg rings={rings} total={`${totalNow}/${totalOf}`} />
              <div className="lv-key">
                {rings.map((r) => (
                  <div className="lv-rk" key={r.name}><i className={`t-${r.tone}`} /><span>{r.name}</span><span className="lv-mono">{r.now} / {r.target} {r.unit}</span></div>
                ))}
              </div>
            </div>
            <div>
              <p className="lv-headline">
                {openRings.length === 0
                  ? 'Every ring is closed this week.'
                  : lagging && lagging.now / lagging.target < elapsed - 0.1
                    ? <><span className="lv-coral">{lagging.name}</span> is the one slipping this week.</>
                    : 'Every ring is on pace this week.'}
              </p>
              {closing && (
                <div className="lv-next">
                  <div className="lv-big">{closing.target - closing.now}</div>
                  <div>
                    <div className="lv-next-t">more {closing.unit === 'nights' ? 'nights' : 'days'} close {closing.name}</div>
                    <div className="lv-next-d">{daysLeft <= 1 ? 'Today is the last day of the week.' : `${daysLeft} days left in the week.`}{closing.target - closing.now >= daysLeft ? ' Every day counts.' : ''}</div>
                    <div className="lv-blocks">
                      {Array.from({ length: closing.target }, (_, i) => <i key={i} className={i < closing.now ? 'on' : 'go'} />)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        <div className="lv-row2">
          <section className="lv-card">
            <h2 className="lv-h2">
              {v.nearRecord
                ? `${v.nearRecord.name} is ${plural(v.nearRecord.best - v.nearRecord.now, 'day', 'days')} from a record.`
                : v.atRecord ? `${v.atRecord.name} is at a record.` : 'Your streaks.'}
            </h2>
            <p className="lv-say">Each dot is a day kept in a row. Dashed dots are what stands between you and your best run.</p>
            {v.streaks.length === 0
              ? <p className="lv-say">No streak over 3 days yet.</p>
              : <div className="lv-chains">{v.streaks.map((s) => <Chain key={s.name} {...s} />)}</div>}
          </section>

          <section className="lv-card">
            {v.keystone ? (
              <>
                <h2 className="lv-h2">{v.keystone.name} sets the tone for the rest of your day.</h2>
                <p className="lv-say">How often you kept each habit on the days you kept {v.keystone.name}, against the days you did not. Last 8 weeks.</p>
                <div className="lv-drv">
                  {v.keystone.rows.map((r) => (
                    <div className="lv-drow" key={r.name}>
                      <div><div className="lv-dname">{r.name}</div><div className="lv-gain">{r.a - r.b >= 0 ? '+' : ''}{r.a - r.b} points</div></div>
                      <div className="lv-pair">
                        <Bar pct={r.a} tone="kept" />
                        <Bar pct={r.b} tone="miss" />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="lv-dkey"><span><i className="t-mid" />On days you kept it</span><span><i className="t-coral" />On days you did not</span></div>
              </>
            ) : (
              <>
                <h2 className="lv-h2">What your habits depend on.</h2>
                <p className="lv-say">Needs about 8 weeks of ticks to tell which habit the others follow. Keep going, and the answer appears here.</p>
              </>
            )}
          </section>
        </div>

        <section className="lv-card">
          <h2 className="lv-h2">
            {v.weakest ? `${DAY_FULL[v.weakest.i]} is where your week leaks.` : 'How your days go.'}
          </h2>
          <p className="lv-say">
            Every square is a day, darker when you kept more of your habits. Squares with a hole are perfect days.
            {v.weakest && v.strongest ? ` ${DAY_FULL[v.strongest.i]} is your strongest day at ${Math.round(v.strongest.x * 100)}%, ${DAY_FULL[v.weakest.i]} your weakest at ${Math.round(v.weakest.x * 100)}%.` : ''}
          </p>
          <div className="lv-cal-row">
            <Calendar dayInfo={v.dayInfo} today={v.today} />
            <WeekdayBars wd={v.wd} />
          </div>
        </section>

        <div className="lv-row2">
          <section className="lv-card">
            {v.leak ? (
              <>
                <h2 className="lv-h2">{v.leak.title} loses you at {v.leak.steps[v.leak.cliffAt].title.toLowerCase()}.</h2>
                <p className="lv-say">Days each step was done in the last 12 weeks. The routine was started on {Math.max(...v.leak.steps.map((s) => s.n))} of them.</p>
                <div className="lv-funnel">
                  {(() => {
                    const max = Math.max(...v.leak.steps.map((s) => s.n))
                    return v.leak.steps.map((s, i, arr) => {
                      const cliff = i === v.leak!.cliffAt
                      return (
                        <div key={i}>
                          {cliff && <div className="lv-cliff"><span /> <div>{arr[i - 1].n - s.n} days stopped here</div></div>}
                          <div className={`lv-fs${cliff ? ' cliff' : ''}`}>
                            <span className="lv-fn">{i + 1}</span>
                            <div className="lv-fbar"><i className="lv-grow" style={{ width: `${Math.round((s.n / max) * 100)}%`, animationDelay: `${i * 50}ms` }} /><span>{s.title}</span></div>
                            <span className="lv-fc">{s.n}</span>
                          </div>
                        </div>
                      )
                    })
                  })()}
                </div>
                <div className="lv-fix">
                  <b>Worth a look:</b> {v.leak.steps[v.leak.cliffAt - 1].n - v.leak.steps[v.leak.cliffAt].n} of {v.leak.steps[v.leak.cliffAt - 1].n} days stopped before {v.leak.steps[v.leak.cliffAt].title.toLowerCase()}. Shorten it, or move it earlier in the routine.
                </div>
              </>
            ) : (
              <>
                <h2 className="lv-h2">Where your routines lose you.</h2>
                <p className="lv-say">Needs a routine started on at least 8 days with a step that gets skipped. Nothing is leaking yet.</p>
              </>
            )}
          </section>

          <section className="lv-card">
            <h2 className="lv-h2">
              {v.goalRows.length === 0 ? 'Your goals.' : (() => {
                const behind = v.goalRows.filter((r) => r.st === 'behind' || r.st === 'drift').length
                return behind === 0 ? `${plural(v.goalRows.length, 'goal', 'goals')}, all on pace.` : `${plural(v.goalRows.length, 'goal', 'goals')}, ${behind} off pace.`
              })()}
            </h2>
            <p className="lv-say">The bar is where you are. The tick is where you should be today to finish on time.</p>
            {v.goalRows.length === 0
              ? <p className="lv-say">No open goals yet. Add one on the Goals tab.</p>
              : <div className="lv-goals">{v.goalRows.map((r) => <GoalLine key={r.g.id} {...r} />)}</div>}
          </section>
        </div>

        <section className="lv-card">
          <h2 className="lv-h2">Earned so far, and what is next.</h2>
          <p className="lv-say">Filled badges are yours. Outlined ones say exactly how far away they are.</p>
          <Shelf bestClean={v.bestClean} bestStreak={v.bestHabitStreak} perfect={v.perfectDays} prs={v.prs} />
        </section>
      </div>
    </div>
  )
}

/* ---------- pieces ---------- */

function RingsSvg({ rings, total }: { rings: Ring[]; total: string }) {
  const C = 160, W = 30, gap = 6
  return (
    <div className="lv-rings">
      <svg viewBox="0 0 320 320" role="img" aria-label={`This week: ${total} kept`}>
        {rings.map((r, i) => {
          const R = 140 - i * (W + gap), len = 2 * Math.PI * R, off = len * (1 - Math.min(1, r.now / r.target))
          return (
            <g key={r.name}>
              <circle cx={C} cy={C} r={R} fill="none" className="lv-track" strokeWidth={W} />
              <circle
                className={`lv-sweep s-${r.tone}`} style={{ ['--len' as string]: len.toFixed(1), animationDelay: `${150 + i * 120}ms` }}
                cx={C} cy={C} r={R} fill="none" strokeWidth={W} strokeLinecap="round"
                strokeDasharray={len.toFixed(1)} strokeDashoffset={off.toFixed(1)} transform={`rotate(-90 ${C} ${C})`}
              />
            </g>
          )
        })}
        <text x="160" y="160" textAnchor="middle" className="lv-rtext">{total}</text>
        <text x="160" y="184" textAnchor="middle" className="lv-rsub">kept this week</text>
      </svg>
    </div>
  )
}

function Chain({ name, now, best, quit }: { name: string; now: number; best: number; quit: boolean }) {
  const show = Math.min(Math.max(best, now), 24), cur = Math.min(now, show)
  const atRecord = now > 0 && now >= best
  return (
    <div>
      <div className="lv-chain-top">
        <span className="lv-chain-name">{name} <span className="lv-mono lv-g">{now}</span></span>
        <span className="lv-chain-say">
          {atRecord ? <span className="lv-rec">At your record.</span>
            : <><b>{best - now} more</b> ties your best of {best}.</>}
          {quit && ' Clean days.'}
        </span>
      </div>
      <div className="lv-links">
        {Array.from({ length: show }, (_, i) => <i key={i} className={`${i < cur ? '' : 'ghost'}${i < cur && i === cur - 1 ? ' today' : ''}`} />)}
        {now > show && <span className="lv-more">+{now - show} more</span>}
        {atRecord ? <span className="lv-flag">RECORD</span> : <span className="lv-more">best {best}</span>}
      </div>
    </div>
  )
}

function Bar({ pct, tone }: { pct: number; tone: 'kept' | 'miss' }) {
  return (
    <div className={`lv-pb ${tone}`}>
      <div className="lv-ptrack"><i className="lv-grow" style={{ width: `${Math.max(0, pct)}%` }} /></div>
      <span className="lv-pv">{pct}%</span>
    </div>
  )
}

function Calendar({ dayInfo, today }: { dayInfo: Record<string, { kept: number; of: number }>; today: string }) {
  const dow = dowOf(today)
  const first = (WEEKS - 1) * 7 + dow
  const cells: React.ReactNode[] = []
  for (let i = 0; i < WEEKS * 7; i++) {
    const day = addDays(today, -(first - i))
    if (day > today) { cells.push(<span key={i} className="lv-day none" />); continue }
    const s = dayInfo[day] ?? { kept: 0, of: 0 }
    const f = s.of ? s.kept / s.of : 0
    const perfect = s.of >= 3 && s.kept === s.of
    const lvl = s.of === 0 ? 0 : perfect ? 6 : f < 0.12 ? 0 : Math.min(5, 1 + Math.floor(f * 5.5))
    const tip = `${longDate(day)}: ${s.of === 0 ? 'nothing expected yet' : perfect ? `perfect day, all ${s.of} habits kept` : `${s.kept} of ${s.of} habits kept`}`
    cells.push(<i key={i} className={`lv-day l${lvl}${perfect ? ' perfect' : ''}`} title={tip} aria-label={tip} />)
  }
  return (
    <div className="lv-cal-wrap">
      <div className="lv-cal">{cells}</div>
      <div className="lv-cal-legend">Kept less <i className="l0" /><i className="l1" /><i className="l2" /><i className="l3" /><i className="l4" /><i className="l5" /><i className="l6" /> kept everything</div>
    </div>
  )
}

function WeekdayBars({ wd }: { wd: (number | null)[] }) {
  const known = wd.filter((x): x is number => x !== null)
  if (known.length < 4) return null
  const lo = Math.min(...known), hi = Math.max(...known)
  return (
    <div className="lv-wd">
      {wd.map((x, i) => (
        <div key={i} className="lv-wd-col">
          <span className="lv-wd-v lv-mono">{x === null ? '' : `${Math.round(x * 100)}%`}</span>
          <div className="lv-wd-track"><i className={x === lo ? 'low' : x === hi ? 'high' : ''} style={{ height: `${x === null ? 0 : Math.round(x * 100)}%` }} /></div>
          <span className="lv-wd-l">{DAY_SHORT[i]}</span>
        </div>
      ))}
    </div>
  )
}

function GoalLine({ g, now, p, elapsed, st, money }: { g: Goal; now: number; p: number; elapsed: number; st: string; money: boolean }) {
  const tone = money ? 'info' : st === 'behind' ? 'coral' : st === 'drift' ? 'warn' : 'mid'
  const word = st === 'reached' ? 'Reached' : money && st === 'on' ? 'On pace' : st === 'on' ? 'On track' : st === 'drift' ? 'Drifting' : 'Behind'
  const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
  return (
    <div className="lv-gl">
      <div><div className="lv-gname">{g.name}</div><div className="lv-gsay">{g.unit ? `${num(now)} of ${num(g.target)} ${g.unit}` : `${num(now)} of ${num(g.target)}`}</div></div>
      <div className="lv-pace">
        <i className={`lv-grow b-${tone}`} style={{ width: `${Math.round(p * 100)}%` }} />
        <u style={{ left: `${Math.round(elapsed * 100)}%` }} title="Where you should be today" />
      </div>
      <div className={`lv-gst c-${tone}`}>{word}</div>
    </div>
  )
}

const SHAPES = {
  hex: 'M40 4 L72 22 V58 L40 76 L8 58 V22 Z',
  shield: 'M40 4 L70 16 V40 C70 58 57 70 40 76 C23 70 10 58 10 40 V16 Z',
  star: 'M40 4 L50 26 L74 28 L56 44 L62 68 L40 56 L18 68 L24 44 L6 28 L30 26 Z',
} as const

function Shelf({ bestClean, bestStreak: bs, perfect, prs }: { bestClean: number; bestStreak: number; perfect: number; prs: number }) {
  /* Each ladder shows the last rung earned and the next one to climb. */
  const ladders: { label: (n: number) => string; steps: number[]; have: number; away: (left: number) => string; key: (n: number) => string; shape: keyof typeof SHAPES }[] = [
    { label: (n) => `${n} days clean`, steps: [7, 30, 90, 180, 365], have: bestClean, away: (l) => `${plural(l, 'day', 'days')} away`, key: (n) => String(n), shape: 'hex' },
    { label: (n) => `${n} day habit streak`, steps: [7, 14, 30, 60], have: bs, away: (l) => `${plural(l, 'day', 'days')} away`, key: (n) => String(n), shape: 'shield' },
    { label: (n) => `${n} perfect days`, steps: [5, 10, 25, 50], have: perfect, away: (l) => `${plural(l, 'day', 'days')} away`, key: (n) => String(n), shape: 'hex' },
    { label: (n) => `${n} ${n === 1 ? 'PR' : 'PRs'} in a month`, steps: [1, 3, 5, 10], have: prs, away: (l) => `${l} to go`, key: () => 'PR', shape: 'star' },
  ]
  const badges: { k: string; t: string; d: string; got: boolean; shape: keyof typeof SHAPES }[] = []
  for (const l of ladders) {
    const earned = l.steps.filter((s) => l.have >= s)
    const next = l.steps.find((s) => l.have < s)
    if (earned.length) { const s = earned[earned.length - 1]; badges.push({ k: l.key(s), t: l.label(s), d: 'Earned', got: true, shape: l.shape }) }
    if (next) badges.push({ k: l.key(next), t: l.label(next), d: l.away(next - l.have), got: false, shape: l.shape })
  }
  return (
    <div className="lv-shelf">
      {badges.map((b) => (
        <div key={b.t} className={`lv-tro${b.got ? '' : ' locked'}`}>
          <svg width="84" height="84" viewBox="0 0 80 80" aria-hidden="true">
            <path d={SHAPES[b.shape]} className={b.got ? 'lv-bg got' : 'lv-bg'} strokeWidth="3" strokeLinejoin="round" strokeDasharray={b.got ? undefined : '5 4'} />
            {b.got && <path d={SHAPES[b.shape]} transform="translate(40 40) scale(.78) translate(-40 -40)" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="2" />}
            <text x="40" y={b.shape === 'star' ? 50 : 47} textAnchor="middle" className={b.got ? 'lv-bt got' : 'lv-bt'} fontSize={b.k.length > 2 ? 16 : 20}>{b.k}</text>
          </svg>
          <div><div className="lv-tt">{b.t}</div><div className="lv-td">{b.d}</div></div>
        </div>
      ))}
    </div>
  )
}
