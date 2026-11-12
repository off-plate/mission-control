import { DotField } from '../dotfield'
import { useState } from 'react'
import { type CompassMoney } from '../compass'
import { stateFor, chainOf, TASK_TARGET, FOCUS_TARGET_MIN, HARD_MIN_DAYS, OUTREACH_TARGET, type DayScore, type Period, type Zoom } from '../momentum'
import { clamp01, hevyDetail, hm, kc, useSessionMinutes, wm } from './shared'

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

export function Promise({ now, chain, periods, zoom, sums }: { now: number; chain: ReturnType<typeof chainOf>; periods: Period[]; zoom: Zoom; sums: React.ReactNode }) {
  /* His ask (2026-09-15): the five numbers were hard to take in as a row of
     their own, so they live inside the promise now, folded shut by default
     the way Plan's week bar is. The whole bar opens and closes it; a click
     on the numbers themselves never does. Not remembered across visits,
     same as the week bar. */
  const [open, setOpen] = useState(false)
  const arc = [...periods].slice(0, 14).reverse()
  const unit = zoom === 'd' ? 'day' : zoom === 'w' ? 'week' : 'month'
  const line = chainPromiseLine(chain)

  return (
    <div className={`tl-promise${open ? ' is-open' : ''}`}>
      <div
        className="tl-promise-bar"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v) } }}
      >
      {/* The page's pulse: momentum as a tide behind the bar, always in view. */}
      <DotField kind="tide" value={now} hot="var(--tl-hot)" quiet className="tl-tide" />
      <p className="tl-txt">{line}</p>
      <span className="tl-arc" aria-label={`The last ${arc.length} ${unit}s`}>
        {arc.map((p) => (
          <i key={p.key} className={p.kept ? 'on' : ''} style={{ height: `${Math.max(6, clamp01(p.ratio) * 100)}%` }} title={`${p.label}: ${Math.round(p.ratio * 100)}%`} />
        ))}
      </span>
      <span className="tl-promise-chev" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 6 L8 10 L13 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      </div>
      <div className="tl-promise-collapse" aria-hidden={!open}>
        <div className="tl-promise-collapse-inner">{sums}</div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ ladder */
export const COLS = ['Finances', 'Health', 'Habits', 'Tasks', 'Focus', 'Outreach', 'Hard thing', 'Points']

export function Ladder({ rows, zoom, money }: { rows: Period[]; zoom: Zoom; money: CompassMoney | null }) {
  return (
    <>
      <div className="tl-head" aria-hidden="true">
        <span />
        {COLS.map((c) => <span className="tl-l" key={c}>{c}</span>)}
      </div>
      <div className="tl-rungs">
        {rows.map((p, i) => <Rung key={p.key} p={p} zoom={zoom} money={money} today={i === 0} />)}
      </div>
    </>
  )
}

/* The five numbers the promise opens to. Their own component so the promise
   can hold them in both views, the ladder and the flywheel alike. */
export function Sums({ run, chain, now, money }: { run: DayScore[]; chain: ReturnType<typeof chainOf>; now: number; money: CompassMoney | null }) {
  const hardTotal = run.filter((r) => r.hard).length
  const focusTotal = run.reduce((a, r) => a + r.counts.focusMin, 0)
  const paidTotal = money ? Object.values(money.byDay).reduce((a, d) => a + d.paid, 0) : null
  return (
      <div className="tl-sum">
        <Sum tide={now} label="Momentum" figure={String(Math.round(now))} unit={`of ${100}`} win={now > 0} says={`${stateFor(now)}. Replayed from the log, never stored.`} />
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
  )
}

export function Sum({ label, figure, unit, says, win, tide }: { label: string; figure: string; unit: string; says: string; win: boolean; tide?: number }) {
  return (
    <div className={`${win ? 'win' : ''}${tide !== undefined ? ' has-field' : ''}`}>
      {tide !== undefined && <DotField kind="tide" value={tide} hot="var(--tl-hot)" className="tl-tide" />}
      <span className="tl-l">{label}</span>
      <b>{figure}{unit && <small>{unit}</small>}</b>
      <p>{says}</p>
    </div>
  )
}

export function Rung({ p, zoom, money, today }: { p: Period; zoom: Zoom; money: CompassMoney | null; today: boolean }) {
  const sessionMins = useSessionMinutes()
  /* Money moved inside this rung, whatever the rung is made of. */
  const fin = money ? p.days.reduce((a, d) => {
    const row = money.byDay[d.day]
    return row ? { paid: a.paid + row.paid, saved: a.saved + row.saved, spent: a.spent + row.spent } : a
  }, { paid: 0, saved: 0, spent: 0 }) : null

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

      {/* FINANCES. Read, never scored, and it says which.
          His report (2026-09-18): a day he paid several ordinary bills on
          showed nothing here, because this only ever looked at fin.paid --
          debt going down specifically -- never a plain bill. "Off the debt"
          stays the label on a day that really was only that; any day a bill
          was part of it reads as the plainer "paid", the two combined, since
          by then the figure is no longer only about the debt. */}
      {fin === null
        ? <Cell figure="—" unit="no Compass" pct={0} muted />
        : fin.paid + fin.spent > 0
          ? <Cell figure={kc(fin.paid + fin.spent)} unit={fin.spent > 0 ? 'Kč paid' : 'Kč off the debt'} pct={1} />
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
      {/* OUTREACH. Touches on People > Business. Scored only from
          OUTREACH_FROM; before that it shows what went out and says so. */}
      <Cell figure={String(p.counts.outreach)}
        unit={p.counts.outreachDays ? `of ${OUTREACH_TARGET * p.counts.outreachDays}` : 'sent'}
        pct={p.counts.outreachDays ? p.counts.outreach / (OUTREACH_TARGET * p.counts.outreachDays) : 0}
        muted={!p.counts.outreachDays} />

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

export function Cell({ figure, unit, pct, muted }: { figure: string; unit: string; pct: number; muted?: boolean }) {
  return (
    <span className={`tl-cell${muted ? ' is-muted' : ''}`}>
      <b>{figure}<small>{unit}</small></b>
      <span className="tl-m"><i style={{ width: `${Math.round(clamp01(pct) * 100)}%` }} /></span>
    </span>
  )
}
