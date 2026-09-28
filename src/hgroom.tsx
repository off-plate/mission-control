/* HABITS, GOALS AND QUITTING ON ONE PAGE (his ask, 2026-09-28): three pages
   behind a switch felt like three places to hold in his head. They are now
   three sections of one scroll, and the switch jumps between them. The old
   addresses (#/goals, #/quitting) still work: they open this page, scrolled
   to their section. */
import { useEffect, useState } from 'react'
import { HabitsGoalsSwitch } from './ui'
import { HabitsPage } from './habits'
import { GoalsPage } from './goals'
import { QuittingPage } from './quitting'

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
  /* The switch lives beside the Habits title; once that has scrolled away a
     copy floats under the header (his ask, 2026-09-28). It sits below the
     header's layer, so the nav row that drops down on hover covers it. */
  const [float, setFloat] = useState(false)
  // Lined up with the switch beside the title, not centred (his ask).
  const [left, setLeft] = useState<number>()
  useEffect(() => {
    const home = document.querySelector('#hg-habits .hg-switch')
    if (!home) return
    const align = () => setLeft(Math.round(home.getBoundingClientRect().left))
    align()
    window.addEventListener('resize', align)
    const io = new IntersectionObserver(([e]) => { if (!e.isIntersecting) align(); setFloat(!e.isIntersecting && e.boundingClientRect.top < 0 + window.innerHeight / 2) }, { rootMargin: `-${parseInt(getComputedStyle(document.documentElement).getPropertyValue('--topstick-h')) || 104}px 0px 0px 0px` })
    io.observe(home)
    return () => { io.disconnect(); window.removeEventListener('resize', align) }
  }, [])
  useEffect(() => { if (start !== 'habits') requestAnimationFrame(() => jumpTo(start, false)) }, [start])
  return (
    <div className="hg-room">
      <div className={`hg-float${float ? ' is-on' : ''}`} aria-hidden={!float} style={left !== undefined ? { left } : undefined}><HabitsGoalsSwitch /></div>
      <section id="hg-habits" className="hg-sec"><HabitsPage /></section>
      <section id="hg-goals" className="hg-sec"><GoalsPage /></section>
      <section id="hg-quitting" className="hg-sec"><QuittingPage /></section>
    </div>
  )
}
