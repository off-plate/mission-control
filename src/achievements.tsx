/* Achievements: Money and Reflect, merged into one destination reached from
   the header rather than two tabs in the menu.

   Both were about the same act, looking back at what has actually moved, so
   they now sit behind one segmented control with a third face in front of them:
   milestones. A milestone is earned by his own record and by nothing else. No
   badge is awarded for opening the app, none for a streak he did not keep, and
   the numbers are the same ones the rest of the app shows.

   He is developing this properly at the end of the week. This is the frame and
   the milestones his data can already prove. */

import { useEffect, useMemo, useState } from 'react'
import { Band } from './pages1'
import { MoneyPage, ReviewPage } from './pages2'
import { useStore } from './store'
import { useCompass } from './compass'
import { fmtNum } from './util'
import { bestStreak, currentStreak } from './types'

type Tab = 'wins' | 'money' | 'reflect'

export interface Milestone {
  id: string
  title: string
  /** What earns it, in his own units. */
  need: number
  have: number
  unit: string
  /** Said in one line when it is still ahead of him. */
  hint: string
  group: 'focus' | 'habits' | 'money' | 'work'
  /** True when the figure cannot be read at all (Compass signed out), which is
   *  not the same as zero. */
  unknown?: boolean
}

const EARNED_KEY = 'mc:earned'
const readEarned = (): string[] => {
  try { return JSON.parse(localStorage.getItem(EARNED_KEY) ?? '[]') } catch { return [] }
}

export function useMilestones(): Milestone[] {
  const { focusSessions, habitLog, habits, routineLog, ledger, tasks, review, inView } = useStore()
  const { state } = useCompass()

  return useMemo(() => {
    const focusMin = focusSessions.filter((f) => inView(f.space)).reduce((a, f) => a + f.minutes, 0)
    const mine = habits.filter((h) => inView(h.space) && h.kind !== 'break')
    const streak = Math.max(0, ...mine.map((h) => currentStreak(habitLog, h.id)))
    const best = Math.max(0, ...mine.map((h) => bestStreak(habitLog, h.id)))
    const runs = routineLog.length
    const closed = (review.reflections ?? []).filter((r) => !r.supersededBy).length
    const finished = new Set([
      ...ledger.filter((e) => inView(e.space)).map((e) => e.id),
      ...tasks.filter((t) => t.done && inView(t.space)).map((t) => t.id),
    ]).size
    const money = state.status === 'ok' ? state.money : null

    const focusHours = Math.floor(focusMin / 60)
    const out: Milestone[] = [
      { id: 'focus-10', group: 'focus', title: 'Ten hours of real focus', need: 10, have: focusHours, unit: 'hours', hint: 'Every finished block counts, whatever it was for.' },
      { id: 'focus-50', group: 'focus', title: 'Fifty hours', need: 50, have: focusHours, unit: 'hours', hint: 'Roughly an hour a day for two months.' },
      { id: 'focus-100', group: 'focus', title: 'A hundred hours', need: 100, have: focusHours, unit: 'hours', hint: 'The number that stops being an experiment.' },

      { id: 'streak-7', group: 'habits', title: 'Seven days running', need: 7, have: Math.max(streak, best), unit: 'days', hint: 'One habit, seven days in a row. Any habit.' },
      { id: 'streak-30', group: 'habits', title: 'Thirty days running', need: 30, have: Math.max(streak, best), unit: 'days', hint: 'The one that survives a bad week.' },
      { id: 'runs-50', group: 'habits', title: 'Fifty routines run', need: 50, have: runs, unit: 'runs', hint: 'Start to finish, not half of one.' },

      { id: 'done-100', group: 'work', title: 'A hundred things finished', need: 100, have: finished, unit: 'things', hint: 'Ticked off, not merely moved.' },
      { id: 'closed-4', group: 'work', title: 'Four windows closed', need: 4, have: closed, unit: 'reviews', hint: 'A month of actually looking back.' },

      {
        id: 'debt-10', group: 'money', title: 'A tenth of the debt gone', need: 10,
        have: money ? money.pct : 0, unit: 'percent', unknown: !money,
        hint: money ? `${fmtNum(Math.round(money.paidOff))} Kč of ${fmtNum(Math.round(money.baseline))} Kč paid.` : 'Read from Compass once you are signed in.',
      },
      {
        id: 'debt-25', group: 'money', title: 'A quarter of it gone', need: 25,
        have: money ? money.pct : 0, unit: 'percent', unknown: !money,
        hint: money ? 'The point where the plan is obviously working.' : 'Read from Compass once you are signed in.',
      },
      {
        id: 'debt-50', group: 'money', title: 'Half of it gone', need: 50,
        have: money ? money.pct : 0, unit: 'percent', unknown: !money,
        hint: money ? 'Halfway. Say it out loud.' : 'Read from Compass once you are signed in.',
      },
    ]
    return out
  }, [focusSessions, habitLog, habits, routineLog, ledger, tasks, review, state, inView])
}

const earnedNow = (m: Milestone) => !m.unknown && m.have >= m.need

function Ring({ pct }: { pct: number }) {
  const r = 15
  const c = 2 * Math.PI * r
  return (
    <svg className="ms-ring" width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r={r} fill="none" stroke="var(--hairline-strong)" strokeWidth="3" />
      <circle
        cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
        strokeDasharray={`${(c * Math.min(1, pct)).toFixed(1)} ${c.toFixed(1)}`}
        transform="rotate(-90 18 18)"
      />
    </svg>
  )
}

function Card({ m }: { m: Milestone }) {
  const done = earnedNow(m)
  const pct = m.need > 0 ? Math.min(1, m.have / m.need) : 0
  return (
    <div className={`ms-card${done ? ' is-earned' : ''}${m.unknown ? ' is-unknown' : ''}`}>
      <div className="ms-mark">
        {done ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
            <path d="M4 12.5l5 5L20 6.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <Ring pct={pct} />
        )}
      </div>
      <div className="ms-body">
        <span className="ms-title">{m.title}</span>
        <span className="ms-hint">{m.hint}</span>
      </div>
      <span className="ms-fig mono">
        {m.unknown ? '—' : done ? 'earned' : `${Math.floor(m.have)} / ${m.need}`}
        {!m.unknown && !done && <span className="ms-unit"> {m.unit}</span>}
      </span>
    </div>
  )
}

/* The one moment of celebration in the app: something crossed its line since
   he last looked. It says which one and what did it, and it is dismissed by
   hand, so a milestone earned overnight is still there in the morning. */
function Landed({ list, onSeen }: { list: Milestone[]; onSeen: () => void }) {
  return (
    <div className="ms-landed" role="status">
      <div className="ms-landed-mark" aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
          <path d="M4 12.5l5 5L20 6.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="ms-landed-copy">
        <span className="microcap">{list.length === 1 ? 'Earned since you last looked' : `${list.length} earned since you last looked`}</span>
        <strong>{list.map((m) => m.title).join(' · ')}</strong>
      </div>
      <button className="btn btn-primary" onClick={onSeen}>Good</button>
    </div>
  )
}

function MilestonesPage() {
  const all = useMilestones()
  const [seen, setSeen] = useState<string[]>(readEarned)
  const earned = all.filter(earnedNow)
  const landed = earned.filter((m) => !seen.includes(m.id))

  /* Nothing is ever un-earned by this: the store of what he has been shown only
     grows, so a figure that dips below its line again cannot re-celebrate. */
  useEffect(() => {
    if (!landed.length) {
      const ids = earned.map((m) => m.id)
      if (ids.some((id) => !seen.includes(id))) {
        const next = [...new Set([...seen, ...ids])]
        setSeen(next)
        try { localStorage.setItem(EARNED_KEY, JSON.stringify(next)) } catch { /* quota */ }
      }
    }
  }, [earned.length])

  const markSeen = () => {
    const next = [...new Set([...seen, ...earned.map((m) => m.id)])]
    setSeen(next)
    try { localStorage.setItem(EARNED_KEY, JSON.stringify(next)) } catch { /* quota */ }
  }

  const groups: { id: Milestone['group']; label: string }[] = [
    { id: 'money', label: 'Money' },
    { id: 'focus', label: 'Focus' },
    { id: 'habits', label: 'Habits' },
    { id: 'work', label: 'Work finished' },
  ]

  /* Next up: the nearest three that are within reach and readable. Sorted by
     how close they are, because the nearest one is the only one that changes
     what he does today. */
  const next = all
    .filter((m) => !earnedNow(m) && !m.unknown)
    .sort((a, b) => b.have / b.need - a.have / a.need)
    .slice(0, 3)

  return (
    <div className="page">
      <Band
        title="Achievements"
        metrics={[{ v: `${earned.length}`, k: `of ${all.length} earned`, tone: (earned.length > 0 ? 'pos' : undefined) as 'pos' | undefined }]}
      />

      {landed.length > 0 && <Landed list={landed} onSeen={markSeen} />}

      {next.length > 0 && (
        <div className="ms-next">
          <span className="microcap">Closest to landing</span>
          <div className="ms-next-row">
            {next.map((m) => (
              <span className="ms-next-item" key={m.id}>
                <span className="ms-next-t">{m.title}</span>
                <span className="mono">{Math.floor(m.have)} / {m.need}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {groups.map((g) => {
        const list = all.filter((m) => m.group === g.id)
        if (!list.length) return null
        return (
          <section className="ms-group" key={g.id}>
            <div className="sechead">
              <span className="microcap">{g.label}</span>
              <span className="section-count mono">{list.filter(earnedNow).length} of {list.length}</span>
            </div>
            <div className="ms-cards">
              {list.map((m) => <Card key={m.id} m={m} />)}
            </div>
          </section>
        )
      })}

      <p className="ms-foot">
        Every figure here is read from what you logged. Nothing is awarded for opening the app.
      </p>
    </div>
  )
}

export function AchievementsPage() {
  /* The tab IS the address. #/money opens on Money, #/review on Reflect,
     #/achievements on the milestones, and switching tabs writes the route, so
     back goes back, a link can be shared and a reload lands where he was. No
     second copy of this state exists to drift. */
  const { page, setPage } = useStore()
  const tab: Tab = page === 'money' ? 'money' : page === 'review' || page === 'stats' ? 'reflect' : 'wins'
  const tabs: { id: Tab; label: string; page: 'achievements' | 'money' | 'review' }[] = [
    { id: 'wins', label: 'Milestones', page: 'achievements' },
    { id: 'money', label: 'Money', page: 'money' },
    { id: 'reflect', label: 'Reflect', page: 'review' },
  ]

  /* Left and right move between tabs, which is what a tablist is expected to
     do and what a keyboard reaches for. */
  const onKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === tab)
    if (e.key === 'ArrowRight') { e.preventDefault(); setPage(tabs[(i + 1) % tabs.length].page) }
    if (e.key === 'ArrowLeft') { e.preventDefault(); setPage(tabs[(i - 1 + tabs.length) % tabs.length].page) }
  }

  return (
    <>
      <div className="achnav" role="tablist" aria-label="Achievements" onKeyDown={onKey}>
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`achtab-${t.id}`}
            aria-controls="achpanel"
            className={`achtab${tab === t.id ? ' on' : ''}`}
            aria-selected={tab === t.id}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setPage(t.page)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id="achpanel" role="tabpanel" aria-labelledby={`achtab-${tab}`}>
        {tab === 'wins' && <MilestonesPage />}
        {tab === 'money' && <MoneyPage />}
        {tab === 'reflect' && <ReviewPage />}
      </div>
    </>
  )
}
