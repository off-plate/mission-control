import { useEffect, useMemo, useState } from 'react'
import { useStore } from './store'
import { usePomodoro } from './pomodoro'
import { precedentFor } from './precedent'
import { localDateKey } from './util'
import { isoWeekKey } from './util'

/* The one place Precedent is allowed to speak.

   Its own laws are in precedent.ts. This file only enforces the cadence, which
   is the part that decides whether he believes it: at most three evenings a
   week, and once he has answered it, it is gone for the day. A card that turns
   up every night is a card he stops reading, and then the night it was right
   about is the night he scrolls past it. */

const SEEN_KEY = 'mc:precedent-seen'
/** Distinct evenings a week it may appear at all. */
const PER_WEEK = 3

interface Seen { week: string; days: string[]; answered: string[] }

const readSeen = (): Seen => {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? 'null') as Seen | null
    if (raw && raw.week === isoWeekKey()) return { week: raw.week, days: raw.days ?? [], answered: raw.answered ?? [] }
  } catch { /* private mode, or a shape from an older build */ }
  return { week: isoWeekKey(), days: [], answered: [] }
}
const writeSeen = (s: Seen) => {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(s)) } catch { /* private mode */ }
}

export function PrecedentCard() {
  const { focusSessions, habitLog, habits, tasks, notes, review, setPage } = useStore()
  const pomo = usePomodoro()
  /* A coarse clock. The match only changes meaningfully as the evening moves,
     so this recomputes every ten minutes rather than on every render: the
     nearest-neighbour walk is cheap but it is not free, and nothing about this
     card needs to know what minute it is. */
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 600000)
    return () => window.clearInterval(t)
  }, [])
  const [seen, setSeen] = useState<Seen>(readSeen)
  const today = localDateKey()

  const p = useMemo(
    () => precedentFor({ focusSessions, habitLog, habits, tasks, notes, review }, new Date()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusSessions, habitLog, habits, tasks, notes, review, tick],
  )

  /* Cadence, in one place. Already answered today: gone. Not shown today and
     the week's three are spent: stay quiet. */
  const answered = seen.answered.includes(today)
  const already = seen.days.includes(today)
  const budgetLeft = seen.days.length < PER_WEEK
  const show = !!p && !answered && (already || budgetLeft)

  useEffect(() => {
    if (!show || already) return
    const next = { ...seen, days: [...seen.days, today] }
    setSeen(next); writeSeen(next)
  }, [show, already, seen, today])

  if (!p || !show) return null

  const answer = () => {
    const next = { ...seen, answered: [...seen.answered, today] }
    setSeen(next); writeSeen(next)
  }
  const startIt = () => {
    answer()
    /* Straight into the room, not onto a list. This is the one moment the whole
       card exists for, so it must not end on a page he then has to act on. */
    if (!pomo.running) pomo.startFocus()
    setPage('zone')
  }
  const niceDay = (k: string) => {
    const [y, m, d] = k.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
  }

  return (
    <section className="precedent" aria-label="What usually happens from here">
      <p className="pr-head">{p.headline}</p>
      {p.quote && (
        <blockquote className="pr-quote">
          <span className="pr-quote-text">{p.quote.text}</span>
          <cite className="pr-quote-day mono">{niceDay(p.quote.day)}</cite>
        </blockquote>
      )}
      <p className="pr-turn">{p.turn}</p>
      <div className="pr-do">
        <button className="btn btn-primary" onClick={startIt}>Start a block</button>
        <button className="btn btn-quiet" onClick={answer}>Not tonight</button>
      </div>
    </section>
  )
}
