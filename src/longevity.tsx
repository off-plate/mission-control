/* THE LONGEVITY PAGE. Goals, and what the habit record says about them.

   Built on Health's own parts (.hp, .hp-card, .hp-section) so it has the same
   width, the same numbers and the same Jarvis mode as the rest of the Jar.
   Every sentence is computed from the record: each headline names the habit,
   step or weekday the numbers point at, and every branch has its own wording
   (nothing yet, a tie, all good), so the page never states something the data
   does not say. Rebuilt 2026-09-30 after his review of the first version. */
import { useMemo, useState } from 'react'
import { useStore } from './store'
import { bestCleanRun, bestStreak, currentStreak, daysClean, goalCurrent, habitTarget, keptDaysIn, type HabitDef, type Goal } from './types'
import { dayOfWeekKey, goalPeriodKey, goalPeriodRange, localDateKey, type GoalTf } from './util'
import { TARGET_HABIT_NAME, getAllHevyDayStats, getHevyExerciseHistory } from './hevy'

const DAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const DAY_PLURAL = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays']
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEEKS = 26

const addDays = (key: string, n: number): string => {
  const [y, m, d] = key.split('-').map(Number)
  return localDateKey(new Date(y, m - 1, d + n))
}
const dowOf = (key: string): number => {
  const [y, m, d] = key.split('-').map(Number)
  return (new Date(y, m - 1, d).getDay() + 6) % 7
}
const longDate = (key: string): string => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
}
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`
const pct = (x: number) => `${Math.round(x * 100)}%`

type Ring = { name: string; now: number; target: number; unit: string; hue: string }

export function LongevityPage() {
  const { habits, habitLog, routines, routineLog, stepTicks, goals, slips, focusSessions, todayIndex, inView } = useStore()
  const [hover, setHover] = useState<string | null>(null)

  const v = useMemo(() => {
    const today = localDateKey()
    const mon = dayOfWeekKey(0), sun = dayOfWeekKey(6)
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
    const daily = live.filter((h) =>
      h.kind !== 'break' && !h.paused && !folderHabitIds.has(h.id) && !h.optional
      && (h.frequency === undefined || h.frequency === 'daily' || h.frequency === 'weekdays'),
    )
    const quits = live.filter((h) => h.kind === 'break')
    const expects = (h: HabitDef, day: string) => day >= firstTick(h) && (h.frequency !== 'weekdays' || dowOf(day) < 5)

    /* ---- this week ---- */
    const weekKept = (h: HabitDef) => keptDaysIn(habitLog, h.id, mon, sun).size
    const focusH = live.filter((h) => h.auto?.from === 'focus').sort((a, b) => (b.dailyTargetMin ?? b.auto?.minutes ?? 0) - (a.dailyTargetMin ?? a.auto?.minutes ?? 0))[0]
    const gymH = live.find((h) => h.name.trim().toLowerCase() === TARGET_HABIT_NAME)
    const bedR = routines.find((r) => !r.archivedAt && r.habitId && /before bed/i.test(r.title))
    const bedH = bedR ? live.find((h) => h.id === bedR.habitId) : undefined
    const rings: Ring[] = []
    if (focusH) rings.push({ name: focusH.name, now: weekKept(focusH), target: 7, unit: 'days', hue: 'var(--hp-train)' })
    if (gymH) rings.push({ name: 'Train', now: weekKept(gymH), target: habitTarget(gymH) === 7 ? 5 : Math.max(1, habitTarget(gymH)), unit: 'days', hue: 'var(--hp-move)' })
    if (bedH && bedR) rings.push({ name: bedR.title, now: weekKept(bedH), target: 7, unit: 'nights', hue: 'var(--hp-sleep)' })

    /* ---- every day ---- */
    const dayInfo: Record<string, { kept: number; of: number }> = {}
    for (let i = 0; i < WEEKS * 7; i++) {
      const d = addDays(today, -i)
      let k = 0, n = 0
      for (const h of daily) { if (!expects(h, d)) continue; n++; if (kept(h, d)) k++ }
      dayInfo[d] = { kept: k, of: n }
    }
    const past = Object.entries(dayInfo).filter(([d, s]) => d < today && s.of >= 3)
    const perfectDays = past.filter(([, s]) => s.kept === s.of).length
    const avgKept = past.length ? past.reduce((a, [, s]) => a + s.kept / s.of, 0) / past.length : 0
    const todayInfo = dayInfo[today] ?? { kept: 0, of: 0 }
    const wdSum = [0, 0, 0, 0, 0, 0, 0], wdN = [0, 0, 0, 0, 0, 0, 0]
    for (const [d, s] of past) { wdSum[dowOf(d)] += s.kept / s.of; wdN[dowOf(d)]++ }
    const wd = wdSum.map((x, i) => (wdN[i] >= 2 ? x / wdN[i] : null))
    const known = wd.map((x, i) => ({ x, i })).filter((p): p is { x: number; i: number } => p.x !== null)
    const weakest = known.length >= 4 ? known.reduce((a, b) => (b.x < a.x ? b : a)) : null
    const strongest = known.length >= 4 ? known.reduce((a, b) => (b.x > a.x ? b : a)) : null
    /* Strong weeks: at least 80% of expected habits kept across a full week. */
    let strongWeeks = 0
    for (let w = 1; w <= WEEKS; w++) {
      let k = 0, n = 0
      for (let i = 0; i < 7; i++) { const s = dayInfo[addDays(mon, -7 * w + i)]; if (s) { k += s.kept; n += s.of } }
      if (n >= 15 && k / n >= 0.8) strongWeeks++
    }

    /* ---- streaks ---- */
    const streakRows = [
      ...daily.map((h) => ({ name: h.name, now: currentStreak(habitLog, h.id), best: bestStreak(habitLog, h.id), quit: false })),
      ...quits.map((h) => ({ name: h.name, now: daysClean(h, slips) ?? 0, best: bestCleanRun(h, slips), quit: true })),
    ].filter((s) => s.best >= 3).sort((a, b) => b.now - a.now).slice(0, 6)
    const nearRecord = streakRows.filter((s) => s.now > 0 && s.now < s.best).sort((a, b) => (a.best - a.now) - (b.best - b.now))[0]
    const atRecord = streakRows.filter((s) => s.now > 0 && s.now >= s.best)

    /* ---- keystone ---- */
    const days56: string[] = []
    for (let d = addDays(today, -56); d < today; d = addDays(d, 1)) days56.push(d)
    let keystone: { name: string; rows: { name: string; a: number; b: number }[]; lift: number; yes: number; no: number } | null = null
    for (const H of daily) {
      const yes = days56.filter((d) => expects(H, d) && kept(H, d))
      const no = days56.filter((d) => expects(H, d) && !kept(H, d))
      if (yes.length < 10 || no.length < 10) continue
      const rows: { name: string; a: number; b: number }[] = []
      for (const O of daily) {
        if (O.id === H.id) continue
        const ey = yes.filter((d) => expects(O, d)), en = no.filter((d) => expects(O, d))
        if (ey.length < 8 || en.length < 8) continue
        rows.push({ name: O.name, a: ey.filter((d) => kept(O, d)).length / ey.length, b: en.filter((d) => kept(O, d)).length / en.length })
      }
      rows.sort((x, y) => (y.a - y.b) - (x.a - x.b))
      const top = rows.slice(0, 5)
      if (top.length < 2) continue
      const lift = top.reduce((a, r) => a + (r.a - r.b), 0) / top.length
      if (!keystone || lift > keystone.lift) keystone = { name: H.name, rows: top, lift, yes: yes.length, no: no.length }
    }

    /* ---- routines ---- */
    const from84 = addDays(today, -84)
    const routineRows = routines.filter((r) => !r.archivedAt && inView(r.space) && r.steps.length > 0).map((r) => {
      const steps = r.steps.map((st) => ({
        title: st.title,
        n: new Set(stepTicks.filter((t) => t.routineId === r.id && t.stepId === st.id && t.day >= from84).map((t) => t.day)).size,
      })).filter((s) => s.n > 0)
      const started = steps.length ? Math.max(...steps.map((s) => s.n)) : 0
      const finished = new Set(routineLog.filter((x) => x.routineId === r.id && x.day >= from84).map((x) => x.day)).size
      let cliffAt = -1, drop = 0
      for (let i = 1; i < steps.length; i++) { const d = steps[i - 1].n - steps[i].n; if (d > drop) { drop = d; cliffAt = i } }
      return { id: r.id, title: r.title, steps, started: Math.max(started, finished), finished, cliffAt, drop }
    }).filter((r) => r.started > 0)
    const leak = routineRows.filter((r) => r.started >= 8 && r.steps.length >= 3 && r.drop >= 3 && r.cliffAt > 0)
      .sort((a, b) => b.drop / b.started - a.drop / a.started)[0] ?? null

    /* ---- goals ---- */
    const GTF: Record<string, GoalTf> = { weekly: 'weekly', monthly: 'monthly', quarter: 'quarter', half: 'half' }
    const rank = { behind: 0, drift: 1, on: 2, reached: 3 } as const
    const goalRows = goals.filter((g: Goal) => !g.closed && inView(g.space)).map((g) => {
      const tf = GTF[g.timeframe ?? 'quarter'] ?? 'quarter'
      const range = goalPeriodRange(tf, g.periodKey ?? goalPeriodKey(tf))
      const now = goalCurrent(g, habits, habitLog, range, slips, focusSessions)
      const a = new Date(range.from + 'T00:00:00').getTime(), b = new Date(range.to + 'T23:59:59').getTime()
      const elapsed = Math.max(0, Math.min(1, (Date.now() - a) / (b - a)))
      const p = g.target > 0 ? Math.min(1, now / g.target) : 0
      const st: keyof typeof rank = p >= 1 ? 'reached' : p >= elapsed - 0.06 ? 'on' : p >= elapsed - 0.25 ? 'drift' : 'behind'
      const daysLeft = Math.max(0, Math.ceil((b - Date.now()) / 86400000))
      return { g, now, p, elapsed, st, money: g.category === 'money', daysLeft }
    }).sort((x, y) => rank[x.st] - rank[y.st])
    const goalsReached = goals.filter((g) => g.closed && g.closed.final >= g.target).length

    /* ---- totals for the badges ---- */
    const hist = getHevyExerciseHistory()
    let prsEver = 0, prs30 = 0
    const cut30 = addDays(today, -30)
    for (const rows of Object.values(hist)) for (const r of rows) if (r.isPR) { prsEver++; if (r.day >= cut30) prs30++ }
    const gymSessions = Object.keys(getAllHevyDayStats()).length
    const focusHours = Math.floor(focusSessions.reduce((a, s) => a + s.minutes, 0) / 60)
    const cut7 = addDays(today, -6)
    const focusWeekMin = focusSessions.filter((s) => s.day >= cut7).reduce((a, s) => a + s.minutes, 0)
    const routinesFinished = routineLog.length
    const allDays = new Set<string>()
    for (const s of keptBy.values()) for (const d of s) allDays.add(d)
    let perfectEver = 0
    for (const d of allDays) {
      if (d >= today) continue
      let k = 0, of = 0
      for (const h of daily) { if (!expects(h, d)) continue; of++; if (kept(h, d)) k++ }
      if (of >= 3 && k === of) perfectEver++
    }
    const bestHabit = daily.map((h) => ({ name: h.name, best: bestStreak(habitLog, h.id) })).sort((a, b) => b.best - a.best)[0]
    const quitBests = quits.map((h) => ({ name: h.name, best: bestCleanRun(h, slips), now: daysClean(h, slips) ?? 0 }))

    return {
      today, rings, dayInfo, perfectDays, avgKept, todayInfo, wd, weakest, strongest, strongWeeks,
      streakRows, nearRecord, atRecord, keystone, routineRows, leak, goalRows, goalsReached,
      prsEver, prs30, gymSessions, focusHours, focusWeekMin, routinesFinished, perfectEver, bestHabit, quitBests, dailyCount: daily.length,
    }
  }, [habits, habitLog, routines, routineLog, stepTicks, goals, slips, focusSessions, inView])

  const { rings } = v
  const elapsed = (todayIndex + 1) / 7
  const behind = rings.filter((r) => r.now < r.target && r.now / r.target < elapsed - 0.15).sort((a, b) => a.now / a.target - b.now / b.target)
  const open = rings.filter((r) => r.now < r.target)
  const closing = [...open].sort((a, b) => (a.target - a.now) - (b.target - b.now))[0]
  const daysLeft = 7 - todayIndex
  const weekNow = rings.reduce((a, r) => a + r.now, 0), weekOf = rings.reduce((a, r) => a + r.target, 0)
  const need = closing ? closing.target - closing.now : 0

  const weekLine = rings.length === 0 ? 'No weekly rings yet. They come from a focus habit, the gym habit and a Before bed routine.'
    : open.length === 0 ? 'Every ring is closed this week.'
      : behind.length === 0 ? 'Every ring is on pace this week.'
        : behind.length === 1 ? `${behind[0].name} is the one slipping this week.`
          : `${behind[0].name} and ${behind[1].name} are slipping this week.`
  const spread = v.weakest && v.strongest ? Math.round(v.strongest.x * 100) - Math.round(v.weakest.x * 100) : 0
  const bestQuit = v.quitBests.length ? v.quitBests.reduce((a, b) => (b.best > a.best ? b : a)) : null

  return (
    <div className="page">
      <div className="hp lv">
        <header className="hp-head">
          <p className="hp-since">
            {v.todayInfo.of > 0 ? `Today ${v.todayInfo.kept} of ${v.todayInfo.of} habits kept` : 'Nothing expected today yet'}
            {v.dailyCount > 0 && v.avgKept > 0 && <span className="hp-since-sync">{pct(v.avgKept)} kept on an average day, last {WEEKS} weeks</span>}
          </p>
        </header>

        {/* ---------- this week ---------- */}
        <div className="hp-cards lv-top">
          <article className="hp-card lv-week" style={{ ['--hp-accent' as string]: 'var(--hp-train)' }}>
            <header className="hp-card-top"><span className="hp-card-label"><i className="hp-dot" />This week</span><span className="hp-card-peak">{daysLeft === 1 ? 'last day' : `${daysLeft} days left`}</span></header>
            <div className="lv-week-body">
              <Rings rings={rings} />
              <div className="lv-week-copy">
                <div className="hp-card-read"><b className={weekOf === 0 ? 'is-quiet' : undefined}>{weekNow}</b><em>of {weekOf} kept</em></div>
                <p className="lv-line">{weekLine}</p>
                <div className="lv-rkey">
                  {rings.map((r) => (
                    <div key={r.name} className="lv-rk">
                      <i style={{ background: r.hue }} /><span>{r.name}</span>
                      <b>{r.now}<em>/{r.target}</em></b>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </article>

          <article className="hp-card" style={{ ['--hp-accent' as string]: closing ? closing.hue : 'var(--hp-move)' }}>
            <header className="hp-card-top"><span className="hp-card-label"><i className="hp-dot" />Next win</span></header>
            {closing ? (
              <>
                <div className="hp-card-read"><b>{need}</b><em>{closing.unit === 'nights' ? (need === 1 ? 'night' : 'nights') : (need === 1 ? 'day' : 'days')}</em></div>
                <p className="hp-card-note">
                  to close {closing.name}. {need > daysLeft ? 'Out of reach this week, so bank what you can.' : need === daysLeft ? 'No room for a miss.' : `${plural(daysLeft - need, 'day', 'days')} of slack.`}
                </p>
                <div className="lv-blocks">{Array.from({ length: closing.target }, (_, i) => <i key={i} className={i < closing.now ? 'on' : ''} />)}</div>
              </>
            ) : (
              <>
                <div className="hp-card-read"><b className={rings.length ? undefined : 'is-quiet'}>{rings.length ? 'Done' : 'None'}</b></div>
                <p className="hp-card-note">{rings.length ? 'All rings closed. Anything more this week is extra.' : 'Nothing weekly to close yet.'}</p>
              </>
            )}
          </article>

          <Stat label="Perfect days" hue="var(--hp-move)" value={v.perfectDays} note={`every habit kept, last ${WEEKS} weeks`} />
          <Stat label="Strong weeks" hue="var(--hp-body)" value={v.strongWeeks} note="80% or more of habits kept" />
          <Stat label="Gym PRs" hue="var(--hp-cardio)" value={v.prs30} note="new records, last 30 days" />
          <Stat label="Longest clean run" hue="var(--hp-sleep)" value={bestQuit?.best ?? 0} unit="days" note={bestQuit ? bestQuit.name : 'no quit tracked yet'} />
          <Stat label="Focus" hue="var(--hp-train)" value={Math.round(v.focusWeekMin / 6) / 10} unit="hours" note="in focus blocks, last 7 days" />
        </div>

        {/* ---------- streaks, then the keystone ---------- */}
        <div>
          <section className="hp-section">
            <h2 className="hp-h2">
              {v.nearRecord ? `${v.nearRecord.name}: ${plural(v.nearRecord.best - v.nearRecord.now, 'day', 'days')} from a record`
                : v.atRecord.length === 1 ? `${v.atRecord[0].name} is on a record run`
                  : v.atRecord.length > 1 ? `${v.atRecord.length} streaks are on a record run`
                    : 'Streaks'}
              <span className="hp-h2-count">{v.streakRows.length ? 'current run against your best' : ''}</span>
            </h2>
            {v.streakRows.length === 0
              ? <p className="hp-empty hp-empty-flat">No streak longer than 3 days yet. The first one shows up here.</p>
              : <div className="hp-cards lv-grid3">{v.streakRows.map((s) => <Chain key={s.name} {...s} />)}</div>}
          </section>

          <section className="hp-section">
            <h2 className="hp-h2">
              {v.keystone ? `${v.keystone.name} carries the rest of your day` : 'Which habit carries the others'}
              <span className="hp-h2-count">{v.keystone ? `${v.keystone.yes} days with it, ${v.keystone.no} without, last 8 weeks` : ''}</span>
            </h2>
            {v.keystone ? (
              <article className="hp-card lv-keycard" style={{ ['--hp-accent' as string]: 'var(--hp-move)' }}>
                {v.keystone.rows.map((r) => (
                  <div className="lv-drow" key={r.name}>
                    <div className="lv-dname"><span>{r.name}</span><em className={r.a - r.b >= 0 ? 'up' : 'down'}>{r.a - r.b >= 0 ? '+' : ''}{Math.round((r.a - r.b) * 100)} points</em></div>
                    <Pair a={r.a} b={r.b} />
                  </div>
                ))}
                <div className="lv-dkey"><span><i className="with" />on days you kept {v.keystone.name}</span><span><i className="without" />on days you did not</span></div>
              </article>
            ) : (
              <p className="hp-empty hp-empty-flat">Needs about 8 weeks of ticks, with at least 10 days kept and 10 missed, before one habit can be said to carry the others.</p>
            )}
          </section>
        </div>

        {/* ---------- days ---------- */}
        <section className="hp-section">
          <h2 className="hp-h2">
            {!v.weakest || !v.strongest ? 'How your days go'
              : spread < 5 ? 'Every day of your week holds about the same'
                : `${DAY_PLURAL[v.weakest.i]} are where your week leaks`}
            <span className="hp-h2-count">
              {v.weakest && v.strongest && spread >= 5 ? `${DAY_FULL[v.strongest.i]} ${pct(v.strongest.x)}, ${DAY_FULL[v.weakest.i]} ${pct(v.weakest.x)}`
                : v.weakest ? `${pct(v.avgKept)} on an average day` : 'needs a few weeks of ticks to compare days'}
            </span>
          </h2>
          <article className="hp-card lv-days" style={{ ['--hp-accent' as string]: 'var(--hp-move)' }}>
            <div className="lv-days-grid">
              <Calendar dayInfo={v.dayInfo} today={v.today} onHover={setHover} />
              <WeekdayBars wd={v.wd} />
            </div>
            <p className="hp-card-note lv-readout">{hover ?? 'Hover a day. Darker squares kept more of your habits; a square with a hole kept all of them.'}</p>
          </article>
        </section>

        {/* ---------- routines ---------- */}
        <section className="hp-section">
          <h2 className="hp-h2">
            {v.leak ? `${v.leak.title} loses you at ${v.leak.steps[v.leak.cliffAt].title.toLowerCase()}`
              : v.routineRows.length ? 'Your routines hold from start to finish' : 'Routines'}
            <span className="hp-h2-count">last 12 weeks</span>
          </h2>
          {v.routineRows.length === 0 ? (
            <p className="hp-empty hp-empty-flat">No routine has been run in the last 12 weeks.</p>
          ) : (
            <div className="lv-two lv-two-tight">
              <article className="hp-card" style={{ ['--hp-accent' as string]: v.leak ? 'var(--hp-cardio)' : 'var(--hp-move)' }}>
                <header className="hp-card-top"><span className="hp-card-label"><i className="hp-dot" />{v.leak ? v.leak.title : 'Step by step'}</span><span className="hp-card-peak">days each step was done</span></header>
                {v.leak ? (
                  <>
                    <Funnel steps={v.leak.steps} cliffAt={v.leak.cliffAt} />
                    <p className="lv-fix">{v.leak.steps[v.leak.cliffAt - 1].n - v.leak.steps[v.leak.cliffAt].n} of {v.leak.steps[v.leak.cliffAt - 1].n} days stopped right before this step. Shorten it, or move it earlier.</p>
                  </>
                ) : <p className="hp-card-note">No step loses more than 2 days against the one before it.</p>}
              </article>
              <article className="hp-card" style={{ ['--hp-accent' as string]: 'var(--hp-train)' }}>
                <header className="hp-card-top"><span className="hp-card-label"><i className="hp-dot" />Finished against started</span><span className="hp-card-peak">days</span></header>
                <div className="lv-rlist">
                  {[...v.routineRows].sort((a, b) => b.finished / b.started - a.finished / a.started).map((r) => {
                    const rate = r.finished / r.started
                    return (
                      <div key={r.id} className="lv-rrow">
                        <div className="lv-rtop"><span>{r.title}</span><b>{r.finished}<em>/{r.started}</em></b></div>
                        <div className="lv-bar"><i style={{ width: pct(rate), background: rate < 0.5 ? 'var(--hp-cardio)' : rate < 0.8 ? 'var(--hp-train)' : 'var(--hp-move)' }} /></div>
                      </div>
                    )
                  })}
                </div>
              </article>
            </div>
          )}
        </section>

        {/* ---------- goals ---------- */}
        <section className="hp-section">
          <h2 className="hp-h2">
            {v.goalRows.length === 0 ? 'Goals' : (() => {
              const off = v.goalRows.filter((r) => r.st === 'behind' || r.st === 'drift').length
              const done = v.goalRows.filter((r) => r.st === 'reached').length
              if (done === v.goalRows.length) return 'Every open goal is reached'
              if (off === 0) return `All ${v.goalRows.length} goals on pace`
              return `${plural(off, 'goal', 'goals')} off pace, ${v.goalRows.length - off} on`
            })()}
            <span className="hp-h2-count">{v.goalsReached ? `${plural(v.goalsReached, 'goal', 'goals')} reached before this` : ''}</span>
          </h2>
          {v.goalRows.length === 0
            ? <p className="hp-empty hp-empty-flat">No open goals. Add one on the Goals tab and it shows up here with its pace.</p>
            : <div className="hp-cards">{v.goalRows.map((r) => <GoalCard key={r.g.id} {...r} />)}</div>}
        </section>

        <Badges v={v} />
      </div>
    </div>
  )
}

/* ---------- pieces ---------- */

function Stat({ label, hue, value, unit, note }: { label: string; hue: string; value: number; unit?: string; note: string }) {
  return (
    <article className="hp-card" style={{ ['--hp-accent' as string]: hue }}>
      <header className="hp-card-top"><span className="hp-card-label"><i className="hp-dot" />{label}</span></header>
      <div className="hp-card-read"><b className={value === 0 ? 'is-quiet' : undefined}>{value.toLocaleString('en-GB')}</b>{unit && <em>{unit}</em>}</div>
      <p className="hp-card-note">{note}</p>
    </article>
  )
}

function Rings({ rings }: { rings: Ring[] }) {
  const C = 100, W = 16, gap = 5
  return (
    <svg className="lv-rings" viewBox="0 0 200 200" role="img" aria-label="This week's rings">
      {rings.map((r, i) => {
        const R = 90 - i * (W + gap), len = 2 * Math.PI * R, off = len * (1 - Math.min(1, r.now / r.target))
        return (
          <g key={r.name}>
            <circle cx={C} cy={C} r={R} fill="none" stroke="var(--hp-ring-track)" strokeWidth={W} />
            <circle className="lv-sweep" style={{ ['--len' as string]: len.toFixed(1), animationDelay: `${120 + i * 110}ms` }}
              cx={C} cy={C} r={R} fill="none" stroke={r.hue} strokeWidth={W} strokeLinecap="round"
              strokeDasharray={len.toFixed(1)} strokeDashoffset={off.toFixed(1)} transform={`rotate(-90 ${C} ${C})`} />
          </g>
        )
      })}
    </svg>
  )
}

function Chain({ name, now, best, quit }: { name: string; now: number; best: number; quit: boolean }) {
  const show = Math.min(Math.max(best, now), 30), cur = Math.min(now, show)
  const record = now > 0 && now >= best
  return (
    <article className="hp-card lv-chain" style={{ ['--hp-accent' as string]: quit ? 'var(--hp-sleep)' : 'var(--hp-train)' }}>
      <div className="lv-chain-top">
        <span className="hp-card-label"><i className="hp-dot" />{name}</span>
        <div className="hp-card-read lv-chain-read"><b>{now}</b><em>{quit ? 'days clean' : 'in a row'}</em></div>
      </div>
      <div className="lv-links">
        {Array.from({ length: show }, (_, i) => <i key={i} className={`${i < cur ? 'on' : ''}${i === cur - 1 ? ' now' : ''}`} />)}
      </div>
      <p className="hp-card-note">
        {record ? 'Record run. Every day adds to it.'
          : now === 0 ? `Best run ${best}. It starts again with the next tick.`
            : `${plural(best - now, 'more day ties', 'more days tie')} your best of ${best}.`}
        {now > show ? ` The last ${show} days are drawn.` : ''}
      </p>
    </article>
  )
}

function Pair({ a, b }: { a: number; b: number }) {
  return (
    <div className="lv-pair">
      <div className="lv-pb with"><div className="lv-bar"><i className="lv-grow" style={{ width: pct(a) }} /></div><b>{pct(a)}</b></div>
      <div className="lv-pb without"><div className="lv-bar"><i className="lv-grow" style={{ width: pct(b) }} /></div><b>{pct(b)}</b></div>
    </div>
  )
}

function Calendar({ dayInfo, today, onHover }: { dayInfo: Record<string, { kept: number; of: number }>; today: string; onHover: (s: string | null) => void }) {
  const first = (WEEKS - 1) * 7 + dowOf(today)
  const cells: React.ReactNode[] = []
  for (let i = 0; i < WEEKS * 7; i++) {
    const day = addDays(today, -(first - i))
    if (day > today) { cells.push(<span key={i} className="lv-day none" />); continue }
    const s = dayInfo[day] ?? { kept: 0, of: 0 }
    const f = s.of ? s.kept / s.of : 0
    const perfect = s.of >= 3 && s.kept === s.of
    const lvl = s.of === 0 ? 0 : perfect ? 6 : f === 0 ? 0 : Math.min(5, 1 + Math.floor(f * 5))
    const tip = `${longDate(day)}: ${s.of === 0 ? 'nothing expected' : perfect ? `perfect, all ${s.of} habits kept` : `${s.kept} of ${s.of} habits kept`}`
    cells.push(<i key={i} className={`lv-day l${lvl}${perfect ? ' perfect' : ''}${day === today ? ' today' : ''}`} aria-label={tip} onMouseEnter={() => onHover(tip)} onMouseLeave={() => onHover(null)} />)
  }
  return <div className="lv-cal" style={{ gridTemplateColumns: `repeat(${WEEKS}, 1fr)` }}>{cells}</div>
}

function WeekdayBars({ wd }: { wd: (number | null)[] }) {
  const known = wd.filter((x): x is number => x !== null)
  const lo = known.length >= 4 ? Math.min(...known) : -1, hi = known.length >= 4 ? Math.max(...known) : -1
  return (
    <div className="lv-wd">
      {wd.map((x, i) => (
        <div key={i} className="lv-wd-col">
          <b>{x === null ? '' : pct(x)}</b>
          <div className="lv-wd-track"><i className={x === lo ? 'low' : x === hi ? 'high' : ''} style={{ height: x === null ? 0 : pct(x) }} /></div>
          <span>{DAY_SHORT[i]}</span>
        </div>
      ))}
    </div>
  )
}

function Funnel({ steps, cliffAt }: { steps: { title: string; n: number }[]; cliffAt: number }) {
  const max = Math.max(...steps.map((s) => s.n))
  return (
    <div className="lv-funnel">
      {steps.map((s, i) => (
        <div key={i} className={`lv-fs${i === cliffAt ? ' cliff' : ''}`}>
          {i === cliffAt && <div className="lv-cliff">{steps[i - 1].n - s.n} days stopped here</div>}
          <div className="lv-fbar"><i className="lv-grow" style={{ width: `${Math.round((s.n / max) * 100)}%`, animationDelay: `${i * 40}ms` }} /><span>{s.title}</span><b>{s.n}</b></div>
        </div>
      ))}
    </div>
  )
}

function GoalCard({ g, now, p, elapsed, st, money, daysLeft }: { g: Goal; now: number; p: number; elapsed: number; st: string; money: boolean; daysLeft: number }) {
  const hue = money ? 'var(--hp-body)' : st === 'behind' ? 'var(--hp-cardio)' : st === 'drift' ? 'var(--hp-train)' : 'var(--hp-move)'
  const word = st === 'reached' ? 'Reached' : st === 'on' ? 'On pace' : st === 'drift' ? 'Drifting' : 'Behind'
  const num = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-GB') : n.toFixed(1))
  const need = Math.max(0, g.target - now)
  const should = Math.round(g.target * elapsed * 10) / 10
  return (
    <article className="hp-card" style={{ ['--hp-accent' as string]: hue }}>
      <header className="hp-card-top"><span className="hp-card-label"><i className="hp-dot" />{word}</span><span className="hp-card-peak">{daysLeft === 0 ? 'ends today' : `${plural(daysLeft, 'day', 'days')} left`}</span></header>
      <p className="lv-gname">{g.name}</p>
      <div className="hp-card-read"><b>{num(now)}</b><em>of {num(g.target)}{g.unit ? ` ${g.unit}` : ''}</em></div>
      <div className="lv-pace"><i className="lv-grow" style={{ width: pct(p) }} /><u style={{ left: pct(elapsed) }} /></div>
      <p className="hp-card-note">
        {st === 'reached' ? 'Done. Anything more is extra.'
          : st === 'on' ? `${num(need)} to go, ahead of the line.`
            : `${num(need)} to go. The line says ${num(should)} by today.`}
      </p>
    </article>
  )
}

/* ---------- badges: every ladder, every rung ---------- */

type Ladder = { id: string; title: string; unit: string; have: number; steps: number[]; hue: string; who?: string }

function Badges({ v }: { v: {
  quitBests: { name: string; best: number; now: number }[]; bestHabit?: { name: string; best: number }
  perfectEver: number; strongWeeks: number; routinesFinished: number; focusHours: number; gymSessions: number; prsEver: number; goalsReached: number
} }) {
  const ladders: Ladder[] = [
    ...v.quitBests.map((q) => ({ id: `q-${q.name}`, title: `${q.name}`, unit: 'days clean', have: q.best, steps: [1, 3, 7, 14, 30, 60, 90, 180, 365], hue: 'var(--hp-sleep)' })),
    { id: 'streak', title: 'Habit streak', unit: 'days', have: v.bestHabit?.best ?? 0, steps: [3, 7, 14, 21, 30, 60, 100, 365], hue: 'var(--hp-train)', who: v.bestHabit?.name },
    { id: 'perfect', title: 'Perfect days', unit: 'days', have: v.perfectEver, steps: [1, 5, 10, 25, 50, 100, 200], hue: 'var(--hp-move)' },
    { id: 'weeks', title: 'Strong weeks', unit: 'weeks', have: v.strongWeeks, steps: [1, 4, 8, 12, 26, 52], hue: 'var(--hp-body)' },
    { id: 'routines', title: 'Routines finished', unit: 'runs', have: v.routinesFinished, steps: [10, 25, 50, 100, 250, 500, 1000], hue: 'var(--hp-train)' },
    { id: 'focus', title: 'Focus time', unit: 'hours', have: v.focusHours, steps: [10, 25, 50, 100, 250, 500, 1000], hue: 'var(--hp-train)' },
    { id: 'gym', title: 'Gym sessions', unit: 'sessions', have: v.gymSessions, steps: [10, 25, 50, 100, 250, 500], hue: 'var(--hp-move)' },
    { id: 'prs', title: 'Personal records', unit: 'PRs', have: v.prsEver, steps: [1, 10, 25, 50, 100, 250], hue: 'var(--hp-cardio)' },
    { id: 'goals', title: 'Goals reached', unit: 'goals', have: v.goalsReached, steps: [1, 5, 10, 25, 50], hue: 'var(--hp-body)' },
  ]
  const total = ladders.reduce((a, l) => a + l.steps.length, 0)
  const earned = ladders.reduce((a, l) => a + l.steps.filter((s) => l.have >= s).length, 0)
  const nextUp = ladders.map((l) => { const n = l.steps.find((s) => l.have < s); return n ? { l, n, left: n - l.have, frac: l.have / n } : null })
    .filter((x): x is { l: Ladder; n: number; left: number; frac: number } => !!x).sort((a, b) => b.frac - a.frac)[0]
  return (
    <section className="hp-section">
      <h2 className="hp-h2">
        {earned === 0 ? 'Badges' : `${earned} of ${total} badges earned`}
        <span className="hp-h2-count">{nextUp ? `closest: ${nextUp.l.title.toLowerCase()} ${nextUp.n}, ${nextUp.left.toLocaleString('en-GB')} ${nextUp.l.unit} away` : 'every badge earned'}</span>
      </h2>
      <div className="hp-cards">
        {ladders.map((l) => {
          const next = l.steps.find((s) => l.have < s)
          const got = l.steps.filter((s) => l.have >= s).length
          return (
            <article key={l.id} className="hp-card lv-ladder" style={{ ['--hp-accent' as string]: l.hue }}>
              <header className="hp-card-top">
                <span className="hp-card-label"><i className="hp-dot" />{l.title}</span>
                <span className="hp-card-peak">{got} of {l.steps.length}</span>
              </header>
              <div className="hp-card-read"><b className={l.have === 0 ? 'is-quiet' : undefined}>{l.have.toLocaleString('en-GB')}</b><em>{l.unit}</em></div>
              <p className="hp-card-note">
                {next ? `${(next - l.have).toLocaleString('en-GB')} to the ${next.toLocaleString('en-GB')} badge.` : 'Every badge on this ladder is yours.'}
                {l.who ? ` Best: ${l.who}.` : ''}
              </p>
              <div className="lv-rungs">
                {l.steps.map((s) => {
                  const state = l.have >= s ? 'got' : s === next ? 'next' : 'far'
                  return (
                    <span key={s} className={`lv-rung ${state}`} title={state === 'got' ? `Earned: ${s} ${l.unit}` : `${(s - l.have).toLocaleString('en-GB')} away`}>
                      {s >= 1000 ? `${s / 1000}k` : s}
                    </span>
                  )
                })}
              </div>
              {next && <div className="lv-bar lv-next-bar"><i style={{ width: pct(Math.min(1, l.have / next)) }} /></div>}
            </article>
          )
        })}
      </div>
    </section>
  )
}
