/* HABITS, GOALS AND QUITTING ON ONE PAGE (his ask, 2026-09-28): three pages
   behind a switch felt like three places to hold in his head. They are now
   three sections of one scroll, and the switch jumps between them. The old
   addresses (#/goals, #/quitting) still work: they open this page, scrolled
   to their section. */
import { useEffect, useState } from 'react'
import { HabitsGoalsSwitch, usePhone } from './ui'
import * as Icon from './icons'
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
  /* Phone (his ask, 2026-10-16): the floating switch is out, the three faces are
     an accordion he can close with one tap. The one he came for starts open. */
  const phone = usePhone()
  const [shut, setShut] = useState<Set<HgSection>>(() => new Set((['habits', 'goals', 'quitting'] as HgSection[]).filter((x) => x !== start)))
  useEffect(() => { setShut((c) => { if (!c.has(start)) return c; const n = new Set(c); n.delete(start); return n }) }, [start])
  const toggle = (x: HgSection) => setShut((c) => { const n = new Set(c); if (n.has(x)) n.delete(x); else n.add(x); return n })
  if (phone) {
    const secs: { id: HgSection; label: string; page: React.ReactNode }[] = [
      { id: 'habits', label: 'Habits', page: <HabitsPage /> },
      { id: 'goals', label: 'Goals', page: <GoalsPage /> },
      { id: 'quitting', label: 'Quitting', page: <QuittingPage /> },
    ]
    return (
      <div className="hg-room is-acc">
        {secs.map(({ id, label, page }) => (
          <section id={`hg-${id}`} className={`hg-sec hg-acc${shut.has(id) ? '' : ' is-open'}`} key={id}>
            <button className="hg-acc-head" aria-expanded={!shut.has(id)} aria-controls={`hg-${id}-body`} onClick={() => toggle(id)}>
              <span>{label}</span><Icon.ChevronDown size={18} className="hg-acc-caret" />
            </button>
            {!shut.has(id) && <div className="hg-acc-body" id={`hg-${id}-body`}>{page}</div>}
          </section>
        ))}
      </div>
    )
  }
  return (
    <div className="hg-room">
      <div className={`hg-float${float ? ' is-on' : ''}`} aria-hidden={!float} style={left !== undefined ? { left } : undefined}><HabitsGoalsSwitch /></div>
      <section id="hg-habits" className="hg-sec"><HabitsPage /></section>
      <section id="hg-goals" className="hg-sec"><GoalsPage /></section>
      <section id="hg-quitting" className="hg-sec"><QuittingPage /></section>
    </div>
  )
}
