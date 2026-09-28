/* HABITS, GOALS AND QUITTING ON ONE PAGE (his ask, 2026-09-28): three pages
   behind a switch felt like three places to hold in his head. They are now
   three sections of one scroll, and the switch jumps between them. The old
   addresses (#/goals, #/quitting) still work: they open this page, scrolled
   to their section. */
import { useEffect } from 'react'
import { HabitsPage } from './habits'
import { GoalsPage } from './goals'
import { QuittingPage } from './quitting'
import { HabitsGoalsSwitch } from './ui'

export type HgSection = 'habits' | 'goals' | 'quitting'

export function jumpTo(s: HgSection, smooth = true) {
  document.getElementById(`hg-${s}`)?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
}

export function HabitsGoalsRoom({ start }: { start: HgSection }) {
  /* The header's height changes with width (it wraps on a phone), so it is
     measured, as the Calendar does, for the sticky switch to sit under it. */
  useEffect(() => {
    const top = document.querySelector('.topstick')
    if (!top) return
    const set = () => document.documentElement.style.setProperty('--topstick-h', `${Math.ceil(top.getBoundingClientRect().height)}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(top)
    return () => ro.disconnect()
  }, [])
  useEffect(() => { if (start !== 'habits') requestAnimationFrame(() => jumpTo(start, false)) }, [start])
  return (
    <div className="hg-room">
      <div className="hg-stick"><HabitsGoalsSwitch /></div>
      <section id="hg-habits" className="hg-sec"><HabitsPage /></section>
      <section id="hg-goals" className="hg-sec"><GoalsPage /></section>
      <section id="hg-quitting" className="hg-sec"><QuittingPage /></section>
    </div>
  )
}
