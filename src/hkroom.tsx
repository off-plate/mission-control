/* THE HABITS PAGE, REBUILT AFTER HABITKIT (his ask, 2026-10-25: "I love it,
   implement it"). Approved mockup: claude.ai/artifact/WSuH22RPsKzs6TYW8zMSHt.

   One card per thing, each in its own colour with a grid of day tiles, one
   button per card, three views in a floating pill. Phone first: it is used
   on the phone to put something in quickly, and it should invite him to start
   the routine that is due, because momentum is the point.

   Nothing here owns data. Routines are the folders the store already keeps
   (a routine IS a folder of habits), quits are break habits, goals are goals;
   the run itself is the existing RoutineRunner, so the typing gate, the
   pronunciation reader and the stretch timer all still work. What this page
   adds is how they look and three writes the old page did not have: an amount
   with its own unit (water in ml), a typed goal amount with a note, and a
   routine created together with its steps. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useStore } from './store'
import { RoutineRunner } from './runner'
import * as Icon from './icons'
import {
    bestCleanRun, countTarget, daysClean, dueOn, focusMinutesOn, focusNeedMin, goalCurrent, isTimeFed, slipDays,
    type Goal, type GoalTimeframe, type HabitDef, type Routine
} from './types'
import { goalPace, goalPeriodKey, goalPeriodRange, localDateKey } from './util'

/* ---------- colour and icon ---------- */
import { ICONS, guessIcon, colorFor, fmt, HkRing, tileSize } from './hkparts'
import { DAY, Item, Kind, PARTS, isHabitKind, keyAgo, short } from './hkroom/shared'
import { DetailSheet, LogSheet, NewSheet } from './hkroom/sheets'
const partNow = () => { const h = new Date().getHours(); return h < 12 ? 0 : h < 14 ? 1 : h < 18 ? 2 : 3 }
const partOf = (h: HabitDef) => { const i = PARTS.findIndex((p) => p.slot === h.daypart); return i < 0 ? 4 : i }
const FILTERS: [string, string][] = [['all', 'All'], ...PARTS.map((p, i) => [`p${i}`, p.label] as [string, string]), ['goal', 'Goals'], ['quit', 'Quitting']]
const CATS: { id: string; label: string; has: (it: Item) => boolean }[] = [
  ...PARTS.map((p, i) => ({ id: `p${i}`, label: p.label, has: (it: Item) => isHabitKind(it.kind) && it.part === i })),
  { id: 'goal', label: 'Goals', has: (it: Item) => it.kind === 'goal' },
  { id: 'quit', label: 'Quitting', has: (it: Item) => it.kind === 'quit' },
]

export function HabitKitRoom({ start = 'all' }: { start?: string }) {
  const s = useStore()
  const { habits, routines, goals, habitLog, slips, focusSessions, todayIndex } = s
  const [view, setView] = useState<'cards' | 'list' | 'week'>(() => { try { return (localStorage.getItem('mc:hk-view') as 'cards') || 'cards' } catch { return 'cards' } })
  useEffect(() => { try { localStorage.setItem('mc:hk-view', view) } catch { /* private mode */ } }, [view])
  const startFilter = start === 'goal' || start === 'quit' ? start : 'all'
  const [filter, setFilter] = useState(startFilter)
  useEffect(() => setFilter(startFilter), [startFilter])
  const [sheet, setSheet] = useState<{ kind: 'run' | 'log' | 'detail' | 'new'; key?: string; part?: string } | null>(null)
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set())
  /* SWIPE DOWN TO CLOSE (his ask, 2026-10-26), the way the More sheet works:
     drag the sheet down from anywhere while its own content is scrolled to the
     top; a long enough or quick enough pull closes it, a short one springs back. */
  const sheetRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sheetRef.current
    if (!el || !sheet) return
    let y0 = 0, t0 = 0, dy = 0, dragging = false
    const start = (e: TouchEvent) => { y0 = e.touches[0].clientY; t0 = Date.now(); dy = 0; dragging = false }
    const move = (e: TouchEvent) => {
      const d = e.touches[0].clientY - y0
      if (!dragging && d > 6 && el.scrollTop <= 0) { dragging = true; el.style.transition = 'none' }
      if (!dragging) return
      e.preventDefault()
      dy = Math.max(0, d)
      el.style.transform = `translate(-50%, ${dy}px)`
    }
    const end = () => {
      if (!dragging) return
      dragging = false
      const fast = dy / Math.max(1, Date.now() - t0) > 0.5
      el.style.transition = 'transform 220ms cubic-bezier(0.32, 0.72, 0, 1)'
      if (dy > 110 || (fast && dy > 30)) { el.style.transform = 'translate(-50%, 100%)'; setTimeout(() => setSheet(null), 200) }
      else el.style.transform = 'translate(-50%, 0)'
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => { el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', end); el.removeEventListener('touchcancel', end) }
  }, [sheet])
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null)
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3800); return () => clearTimeout(t) }, [toast])
  const today = localDateKey()
  /* Five days on the phone; on a wider screen as many weeks as fill the row,
     so the days spread across the page instead of huddling at its edge. */
  const daysFor = () => { const w = typeof window === 'undefined' ? 390 : window.innerWidth; return w >= 1500 ? 28 : w >= 1200 ? 21 : w >= 900 ? 14 : 5 }
  const [nDays, setNDays] = useState(daysFor)
  useEffect(() => { const on = () => setNDays(daysFor()); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on) }, [])
  const weekDays = Array.from({ length: nDays }, (_, i) => nDays - 1 - i)

  /* The header is sticky and changes height (the nav row drops down), so the
     section headings stick under its MEASURED height, never a guessed one. */
  useEffect(() => {
    const top = document.querySelector('.topstick')
    if (!top) return
    const set = () => document.documentElement.style.setProperty('--topstick-h', `${Math.ceil(top.getBoundingClientRect().height)}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(top)
    return () => ro.disconnect()
  }, [])
  /* The bottom strip is the phone's filter (his ask, 2026-10-26: one set of
     filters, at the bottom, not a second copy at the top). Keep the chosen
     chip in view inside the strip, with room around it, without moving the page. */
  const jumpRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const strip = jumpRef.current
    const chip = strip?.querySelector<HTMLElement>(`[data-filter="${filter}"]`)
    if (strip && chip) strip.scrollTo({ left: Math.max(0, chip.offsetLeft - 10), behavior: 'smooth' })
  }, [filter])

  /* Which days each habit was kept, and the amount rows, read once per change
     of the log rather than once per tile. */
  const kept = useMemo(() => {
    const m = new Map<string, Map<string, { n: number; v: number }>>()
    for (const t of habitLog) {
      let byDay = m.get(t.habitId); if (!byDay) { byDay = new Map(); m.set(t.habitId, byDay) }
      const c = byDay.get(t.day) ?? { n: 0, v: 0 }
      c.n++; c.v += t.v ?? 0
      byDay.set(t.day, c)
    }
    return m
  }, [habitLog])
  const slipSet = useMemo(() => { const m = new Map<string, Set<string>>(); for (const x of slips) { const st = m.get(x.habitId) ?? new Set(); st.add(x.day); m.set(x.habitId, st) } return m }, [slips])

  const items = useMemo<Item[]>(() => {
    const live = habits.filter((h) => !h.archivedAt)
    const folderHabitIds = new Set(routines.map((r) => r.habitId).filter(Boolean) as string[])
    const out: Item[] = []
    const rIndex = new Map(routines.map((r, k) => [r.id, k]))
    live.filter((x) => !folderHabitIds.has(x.id)).forEach((h, k) => {
      const kind: Kind = h.kind === 'break' ? 'quit'
        : h.measure === 'amount' ? 'amount'
        : h.auto?.from === 'focus' || (h.kind === 'measured' && h.measure !== 'times') ? 'auto'
        : h.kind === 'measured' && h.measure === 'times' ? 'count' : 'check'
      const ord = h.folderId ? (rIndex.get(h.folderId) ?? 50) * 100 + (h.folderOrder ?? 0) : 10000 + k
      out.push({ key: `h:${h.id}`, kind, id: h.id, name: h.name, color: colorFor(h.id, h.color), icon: h.icon ?? guessIcon(h.name, kind === 'quit' ? 'eye' : 'checklist'), habit: h, part: kind === 'quit' ? 6 : partOf(h), ord })
    })
    for (const g of goals) {
      const tf = (g.timeframe ?? 'quarter') as GoalTimeframe
      if (g.closed) continue
      if (g.periodKey && g.periodKey !== goalPeriodKey(tf)) continue
      out.push({ key: `g:${g.id}`, kind: 'goal', id: g.id, name: g.name, color: colorFor(g.id, g.color), icon: g.icon ?? guessIcon(g.name, 'flag'), goal: g, part: 5, ord: 0 })
    }
    return out
  }, [habits, routines, goals])

  /* ---------- what a day was worth, 0 to 1, or null when it did not count ---------- */
  const dayVal = (it: Item, day: string, agoN: number): number | null => {
    if (it.kind === 'routine') {
      const list = it.list!
      if (list[0]?.frequency === 'weekdays') { const wd = new Date(`${day}T12:00:00`).getDay(); if (wd === 0 || wd === 6) return null }
      if (agoN === 0) { const need = list.filter((h) => !h.optional); return need.length ? need.filter((h) => h.days[todayIndex]).length / need.length : 0 }
      if (it.routine!.habitId && kept.get(it.routine!.habitId)?.has(day)) return 1
      const need = list.filter((h) => !h.optional)
      return need.length ? need.filter((h) => kept.get(h.id)?.has(day)).length / need.length : 0
    }
    const h = it.habit
    if (!h) return 0
    if (h.frequency === 'weekdays') { const wd = new Date(`${day}T12:00:00`).getDay(); if (wd === 0 || wd === 6) return null }
    if (it.kind === 'quit') {
      if (!h.quitSince || day < h.quitSince) return null
      return slipSet.get(h.id)?.has(day) ? 0 : 1
    }
    if (it.kind === 'amount') return Math.min(1, (kept.get(h.id)?.get(day)?.v ?? 0) / (h.targetAmount ?? 1))
    if (it.kind === 'count') { const n = kept.get(h.id)?.get(day)?.n ?? 0; return (h.per ?? 'day') === 'day' ? Math.min(1, n / countTarget(h)) : n ? 1 : 0 }
    if (it.kind === 'auto') return Math.min(1, focusMinutesOn(focusSessions, day, h.space) / focusNeedMin(h))
    if (agoN === 0) return h.days[todayIndex] ? 1 : 0
    return kept.get(h.id)?.has(day) ? 1 : 0
  }
  const todayVal = (it: Item) => dayVal(it, today, 0) ?? 0

  const routineState = (it: Item) => {
    const list = it.list!, need = list.filter((h) => !h.optional)
    const off = list[0]?.frequency === 'weekdays' && todayIndex >= 5
    const done = need.filter((h) => h.days[todayIndex]).length
    const rare = it.part === 8
    /* A weekly or monthly routine already kept this period is done, whichever day it was done on. */
    const keptPeriod = rare && it.routine!.habitId ? !dueOn(habits.find((h) => h.id === it.routine!.habitId) ?? list[0], todayIndex, habitLog) : false
    return { off, done, total: need.length, complete: keptPeriod || (need.length > 0 && done === need.length) }
  }
  /* No pinned card any more: each part of the day has its own Start. */
  const nextUp = null as Item | null

  /* ---------- goals ---------- */
  const goalInfo = (g: Goal) => {
    const tf = (g.timeframe ?? 'quarter') as GoalTimeframe
    const range = goalPeriodRange(tf, g.periodKey ?? goalPeriodKey(tf))
    const total = goalCurrent(g, habits, habitLog, range, slips, focusSessions)
    const from = new Date(`${range.from}T12:00:00`).getTime(), to = new Date(`${range.to}T12:00:00`).getTime()
    const days = Math.round((to - from) / DAY) + 1, gone = Math.max(1, Math.min(days, Math.round((Date.now() - from) / DAY) + 1))
    const pace = g.target * gone / days, perDay = total / gone, left = Math.max(0, g.target - total)
    const reach = perDay > 0 && left > 0 ? localDateKey(new Date(Date.now() + Math.ceil(left / perDay) * DAY)) : null
    const weekNeed = left / Math.max(1, (days - gone) / 7)
    /* The status words are the shared rule's, so this page and every other
       place a goal is read agree: a goal that counts DAYS can't be caught up
       faster than a day a day, which is what makes "No lust" honest. */
    const fed = g.habitId ? habits.find((h) => h.id === g.habitId) : undefined
    const status = goalPace(total, g.target, tf, new Date(), !!fed && !isTimeFed(fed))
    return { total, pace, left, reach, weekNeed, ahead: status !== 'behind', status, end: range.to }
  }

  /* ---------- actions ---------- */
  const say = (text: string, undo?: () => void) => setToast({ text, undo })
  const tick = (it: Item) => {
    const h = it.habit!
    const on = !h.days[todayIndex]
    s.toggleHabitDay(h.id, todayIndex)
    if (on) say(`${h.name} done`, () => s.markHabitDay(h.id, todayIndex, false))
  }
  const addAmount = (it: Item, v: number, note?: string) => {
    if (it.kind === 'goal') {
      const eid = s.logGoalAmount(it.id, v, note)
      say(`+${fmt(v)} ${it.goal!.unit} to ${it.name}`, () => s.removeGoalEntry(it.id, eid))
    } else {
      const h = it.habit!
      const src = s.logAmount(h.id, v)
      const left = (h.targetAmount ?? 0) - ((kept.get(h.id)?.get(today)?.v ?? 0) + v)
      say(`+${fmt(v)} ${h.unit ?? ''}${left > 0 ? `, ${fmt(left)} to go` : ', done for today'}`, src ? () => s.removeAmount(h.id, src) : undefined)
    }
  }

  /* ---------- pieces ---------- */
  const Ring = HkRing
  const Ico = ({ it, small }: { it: Item; small?: boolean }) => { const C = ICONS[it.icon] ?? Icon.Checklist; return <span className={`hk-ico${small ? ' is-small' : ''}`}><C size={small ? 16 : 21} /></span> }

  const Tiles = ({ it, weeks }: { it: Item; weeks: number }) => {
    if (it.kind === 'goal') {
      const g = it.goal!, info = goalInfo(g), size = tileSize(g.target)
      const n = Math.ceil(g.target / size), filled = Math.floor(info.total / size), pace = Math.floor(info.pace / size)
      return <div className="hk-tiles is-goal" style={{ gridTemplateColumns: 'repeat(26, 1fr)' }} aria-label={`${fmt(info.total)} of ${fmt(g.target)} ${g.unit}, one tile per ${fmt(size)}`}>
        {Array.from({ length: n }, (_, i) => <i key={i} className={`${i < filled ? 'f' : ''}${i === pace && pace >= filled && info.total < g.target ? ' pace' : ''}`} />)}
      </div>
    }
    const pad = todayIndex // Monday on top, today's row
    const cells: ReactNode[] = []
    for (let col = 0; col < weeks; col++) for (let row = 0; row < 7; row++) {
      const a = (weeks - 1 - col) * 7 + (pad - row)
      if (a < 0) { cells.push(<i key={`${col}-${row}`} className="x" />); continue }
      const v = dayVal(it, keyAgo(a), a)
      cells.push(<i key={`${col}-${row}`} className={v === null ? (it.kind === 'quit' ? '' : 'x') : `${v >= 1 ? 'f' : v > 0 ? 'p' : ''}${a === 0 ? ' t' : ''}`} />)
    }
    return <div className="hk-tiles" style={{ gridTemplateColumns: `repeat(${weeks}, 1fr)` }} aria-hidden="true">{cells}</div>
  }

  const subLine = (it: Item): ReactNode => {
    if (it.kind === 'routine') {
      const st = routineState(it), r = it.routine!
      if (st.off) return 'Mon to Fri'
      if (it.part === 8) return st.complete ? <><b>Done</b> this {r.cadence === 'weekly' ? 'week' : 'month'}</> : `${st.total} steps, ${r.cadence === 'weekly' ? 'once a week' : 'once a month'}`
      return st.done ? <><b>{st.done} of {st.total}</b>{r.blurb ? `, ${r.blurb}` : ''}</> : `${st.total} steps${r.blurb ? `, ${r.blurb}` : ''}`
    }
    const h = it.habit
    if (it.kind === 'goal') {
      const g = it.goal!, info = goalInfo(g)
      const word = info.status === 'done' ? 'Reached' : info.status === 'behind' ? 'Needs a push' : 'On pace'
      if (g.habitId) return <><b>{word}</b>, fills from {habits.find((x) => x.id === g.habitId)?.name ?? 'a habit'}</>
      if (info.status === 'done') return <b>Reached</b>
      return info.status === 'behind' ? <><b>Needs a push</b>, {fmt(info.weekNeed)} {g.unit} a week makes it</> : <><b>On pace</b>, to {short(info.end)}</>
    }
    if (!h) return ''
    if (it.kind === 'amount') { const v = kept.get(h.id)?.get(today)?.v ?? 0; return <><b>{fmt(v)} / {fmt(h.targetAmount ?? 0)} {h.unit}</b>{v < (h.targetAmount ?? 0) ? `, ${fmt((h.targetAmount ?? 0) - v)} left` : ''}</> }
    if (it.kind === 'count') { const n = kept.get(h.id)?.get(today)?.n ?? 0; return <><b>{n} of {countTarget(h)}</b> today</> }
    if (it.kind === 'auto') { const m = focusMinutesOn(focusSessions, today, h.space); return <><b>{m}m of {focusNeedMin(h)}m</b>, from focus blocks</> }
    if (it.kind === 'quit') { const run = daysClean(h, slips) ?? 0; return <><b>{run} {run === 1 ? 'day' : 'days'} clean</b>{h.dailyCost ? `, ${fmt(h.dailyCost * quitClean(h).clean)} CZK saved` : `, longest ${bestCleanRun(h, slips)}`}</> }
    if (h.frequency === 'times-per-week') { const wk = h.days.filter(Boolean).length; return <><b>{wk} of {h.targetPerWeek ?? 3}</b> this week</> }
    const extra = h.optional ? ', optional' : h.seconds ? `, ${Math.round(h.seconds / 60)} min` : ''
    if (h.frequency === 'weekly' || h.frequency === 'monthly') return (h.frequency === 'weekly' ? 'Once a week' : 'Once a month') + extra
    return (h.frequency === 'weekdays' ? 'Mon to Fri' : 'Every day') + extra
  }
  const quitClean = (h: HabitDef) => {
    const since = h.quitSince ? new Date(`${h.quitSince}T12:00:00`).getTime() : Date.now()
    const daysIn = Math.max(0, Math.round((new Date(`${today}T12:00:00`).getTime() - since) / DAY))
    const n = [...slipDays(slips, h.id)].filter((d) => !h.quitSince || d >= h.quitSince).length
    return { daysIn, clean: Math.max(0, daysIn - n) }
  }

  const Action = ({ it, big }: { it: Item; big?: boolean }) => {
    const c = it.color
    if (it.kind === 'routine') {
      const st = routineState(it)
      if (st.off) return <span className="hk-off">Mon to Fri</span>
      if (st.complete && !it.routine!.repeatable) return <button className="hk-act is-check is-on" style={{ ['--c' as string]: c }} onClick={() => setSheet({ kind: 'detail', key: it.key })} aria-label={`${it.name}, done. Open`}><Icon.Check size={22} strokeWidth={3} /></button>
      return <button className={`hk-act is-play${big ? ' is-big' : ''}`} style={{ ['--c' as string]: c }} onClick={() => setSheet({ kind: 'run', key: it.key })}><Icon.Play size={14} />{st.complete ? 'Again' : st.done ? 'Resume' : 'Start'}</button>
    }
    if (it.habit?.frequency === 'weekdays' && todayIndex >= 5) return <span className="hk-off">Mon to Fri</span>
    if (it.kind === 'check') { const on = todayVal(it) >= 1; return <button className={`hk-act is-check${on ? ' is-on' : ''}`} style={{ ['--c' as string]: c }} role="checkbox" aria-checked={on} aria-label={it.name} onClick={() => tick(it)}><Icon.Check size={22} strokeWidth={3} /></button> }
    if (it.kind === 'count') return <button className="hk-act is-ring" aria-label={`One more ${it.name}`} onClick={() => { s.logCount(it.id, 1); say(`${it.name} +1`, () => s.logCount(it.id, -1)) }}>{Ring({ f: todayVal(it), c, children: <Icon.Plus size={18} /> })}</button>
    if (it.kind === 'amount') return <button className="hk-act is-ring" aria-label={`Log ${it.name}`} onClick={() => setSheet({ kind: 'log', key: it.key })}>{Ring({ f: todayVal(it), c, children: <Icon.Plus size={18} /> })}</button>
    if (it.kind === 'auto') { const h = it.habit!; return <span className="hk-act is-ring" aria-label={`${focusMinutesOn(focusSessions, today, h.space)} of ${focusNeedMin(h)} minutes`}>{Ring({ f: todayVal(it), c, children: <span className="hk-ringnum">{focusMinutesOn(focusSessions, today, h.space)}m</span> })}</span> }
    if (it.kind === 'quit') { const slipped = slipSet.get(it.id)?.has(today); return <button className="hk-act is-slip" disabled={slipped} onClick={() => s.logSlip(it.id)}>{slipped ? 'Slipped today' : 'Slipped'}</button> }
    if (it.kind === 'goal') {
      const g = it.goal!
      if (g.habitId) return Ring({ f: goalInfo(g).total / g.target, c, children: <span className="hk-ringnum">{Math.round(goalInfo(g).total / g.target * 100)}%</span> })
      return <button className="hk-act is-ring" aria-label={`Log an amount for ${it.name}`} onClick={() => setSheet({ kind: 'log', key: it.key })}>{Ring({ f: goalInfo(g).total / g.target, c, children: <Icon.Plus size={18} /> })}</button>
    }
    return null
  }

  /* ROUTINES AS FOLDERS (his ask, 2026-10-26): a tap on a routine opens it in
     place to show its habits, each tickable, instead of sending him to a sheet.
     The sheet (history, colour) is one tap further, at the foot of the folder. */
  const openTap = (it: Item) => {
    if (it.kind !== 'routine') { setSheet({ kind: 'detail', key: it.key }); return }
    setOpenFolders((prev) => { const n = new Set(prev); if (n.has(it.key)) n.delete(it.key); else n.add(it.key); return n })
  }
  const Folder = (it: Item) => !openFolders.has(it.key) || !it.list ? null : (
    <div className="hk-folder">
      <ul className="hk-steps">
        {it.list.map((h) => (
          <li key={h.id} className={h.days[todayIndex] ? 'is-d' : ''}>
            <button className="hk-mstick" role="checkbox" aria-checked={h.days[todayIndex]} aria-label={h.name} onClick={() => s.toggleHabitDay(h.id, todayIndex)}><i /></button>
            <span>{h.name}</span>
            <small>{h.optional ? 'optional' : h.seconds ? `${Math.round(h.seconds / 60)} min` : ''}</small>
          </li>
        ))}
      </ul>
      <button className="hk-folderlink" onClick={() => setSheet({ kind: 'detail', key: it.key })}>History and colour</button>
    </div>
  )
  const Card = ({ it, next, i = 0 }: { it: Item; next?: boolean; i?: number }) => {
    const g = it.goal, h = it.habit
    return (
      <article key={it.key} className={`hk-card${next ? ' is-next' : ''}`} style={{ ['--c' as string]: it.color, ['--i' as string]: Math.min(i, 14) }}>
        <div className="hk-top">
          {Ico({ it })}
          <button className="hk-name" aria-expanded={it.kind === 'routine' ? openFolders.has(it.key) : undefined} onClick={() => openTap(it)}>
            {next && <span className="hk-next">Up next</span>}
            <span className="hk-title">{it.name}{it.kind === 'routine' && <Icon.ChevronDown size={14} className={`hk-chev${openFolders.has(it.key) ? ' is-open' : ''}`} />}</span>
            <span className="hk-sub">{subLine(it)}</span>
          </button>
          {Action({ it, big: next })}
        </div>
        {Folder(it)}
        {g && <div className="hk-amt"><b>{fmt(goalInfo(g).total)}</b><span>/ {fmt(g.target)} {g.unit}</span>{goalInfo(g).reach && <em className={goalInfo(g).ahead ? 'ok' : ''}>{fmt(g.target)} by {short(goalInfo(g).reach!)}</em>}</div>}
        {it.kind === 'quit' && h && <div className="hk-amt"><b>{quitClean(h).clean}</b><span>of {quitClean(h).daysIn} days clean</span><em>longest {bestCleanRun(h, slips)} days</em></div>}
        {Tiles({ it, weeks: 26 })}
      </article>
    )
  }
  const Row = ({ it, next, i = 0 }: { it: Item; next?: boolean; i?: number }) => (
    <div key={it.key} className={`hk-row${it.kind === 'routine' && routineState(it).off ? ' is-dim' : ''}`} style={{ ['--c' as string]: it.color, ['--i' as string]: Math.min(i, 18) }}>
      {Ico({ it })}
      <button className="hk-name" aria-expanded={it.kind === 'routine' ? openFolders.has(it.key) : undefined} onClick={() => openTap(it)}>
        {next && <span className="hk-next">Up next</span>}
        <span className="hk-title">{it.name}{it.kind === 'routine' && <Icon.ChevronDown size={14} className={`hk-chev${openFolders.has(it.key) ? ' is-open' : ''}`} />}</span>
        <span className="hk-sub">{subLine(it)}</span>
      </button>
      {Action({ it, big: next })}
      {Folder(it)}
    </div>
  )

  const shown = items.filter((it) => filter === 'all' || (CATS.find((c) => c.id === filter)?.has(it) ?? false))
  const order = (a: Item, b: Item) => a.part - b.part || a.ord - b.ord
  const sorted = shown.filter((it) => it !== nextUp).sort(order)
  const pinned = nextUp && shown.includes(nextUp) ? nextUp : null
  const doneToday = (it: Item) => it.kind === 'routine' ? routineState(it).complete : isHabitKind(it.kind) ? todayVal(it) >= 1 : false
  const sheetItem = sheet?.key ? items.find((x) => x.key === sheet.key) ?? null : null

  /* THE CATEGORIES (his ask, 2026-10-25): cards and week are sectioned so it is
     plain at a glance what is a routine, a habit he ticks, a habit the app
     keeps for him, a goal, a quit. Up next stays above them all. */
  const sections = CATS.map((c) => ({ ...c, list: sorted.filter((it) => c.has(it)) }))
    .filter((c) => c.list.length > 0 || (c.id === 'goal' && (filter === 'all' || filter === 'goal')))
  /* What a part's Start walks through: its yes/no habits that count today, in order. */
  const startList = (list: Item[]) => list.filter((it) => it.kind === 'check' && dayVal(it, today, 0) !== null).map((it) => it.habit!)
  const todayOf = (list: Item[]) => {
    const doable = list.filter((it) => isHabitKind(it.kind) && dayVal(it, today, 0) !== null)
    return doable.length ? `${doable.filter(doneToday).length} of ${doable.length} today` : ''
  }
  let n = pinned ? 1 : 0

  return (
    <div className="page hk">
      <div className="hk-bar">
        <h1 className="hk-h1">Habits &amp; Goals</h1>
        {/* On a wide screen the views sit here, named; on the phone they are the floating pill. */}
        <div className="hk-views" role="group" aria-label="View">
          {(['cards', 'list', 'week'] as const).map((v) => (
            <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
              {v === 'cards' ? <Icon.AppsGrid size={16} /> : v === 'list' ? <Icon.Checklist size={16} /> : <Icon.Table size={16} />}
              {{ cards: 'Cards', list: 'Checklist', week: 'Week' }[v]}
            </button>
          ))}
        </div>
        <button className="hk-newbtn" onClick={() => setSheet({ kind: 'new' })}><Icon.Plus size={16} />New</button>
        <button className="hk-round is-plus" aria-label="New" onClick={() => setSheet({ kind: 'new' })}><Icon.Plus size={18} /></button>
      </div>
      <div className="hk-chips" role="group" aria-label="Show">
        {FILTERS.map(([k, l]) => <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
      </div>

      {items.length === 0 && <p className="hk-empty">Nothing here yet. Tap + to add a habit, a routine, a goal or something you are quitting.</p>}

      {/* Keyed on view and filter: switching either replays the entrance; a tick does not. */}
      <div className="hk-anim" key={`${view}-${filter}`}>
      {view === 'cards' && <>
        {pinned && <div className="hk-cards is-pinned">{Card({ it: pinned, next: true, i: 0 })}</div>}
        {sections.map((c) => (
          <section key={c.id} id={`hk-sec-${c.id}`} className="hk-sec" data-sec={c.id}>
            {/* Counted with the pinned card, which still belongs to its section. */}
            <h2 className={`hk-sech${c.id === `p${partNow()}` ? ' is-now' : ''}`} style={{ ['--i' as string]: Math.min(n, 14) }}>{c.label}<span className="hk-secn">{c.list.length}</span><span className="hk-sect">{todayOf(c.list)}</span>{startList(c.list).length > 0 && <button className="hk-partplay" onClick={() => setSheet({ kind: 'run', part: c.id })}><Icon.Play size={12} />{c.list.some((it) => it.kind === 'check' && todayVal(it) >= 1) ? 'Resume' : 'Start'}</button>}</h2>
            <div className="hk-cards">
              {c.list.map((it) => Card({ it, i: n++ }))}
              {c.id === 'goal' && (filter === 'all' || filter === 'goal') && <Promised />}
            </div>
          </section>
        ))}
      </>}

      {view === 'list' && (() => {
        const open = sorted.filter((it) => isHabitKind(it.kind) && !doneToday(it) && dayVal(it, today, 0) !== null)
        const other = sorted.filter((it) => it.kind === 'goal' || it.kind === 'quit' || (isHabitKind(it.kind) && dayVal(it, today, 0) === null))
        const done = sorted.filter(doneToday)
        let k = pinned ? 1 : 0
        return <div className="hk-list">
          {pinned && Row({ it: pinned, next: true, i: 0 })}
          {open.length > 0 && <><div className="hk-head">Still to do</div>{open.map((it) => Row({ it, i: k++ }))}</>}
          {other.length > 0 && <><div className="hk-head">Goals, quitting, not today</div>{other.map((it) => Row({ it, i: k++ }))}</>}
          {done.length > 0 && <><div className="hk-head">Done today</div>{done.map((it) => Row({ it, i: k++ }))}</>}
        </div>
      })()}

      {view === 'week' && (
        <div className="hk-week" style={{ ['--days' as string]: weekDays.length }}>
          <div className="hk-wrow is-head"><span className="hk-sub">{shown.length} items</span>{weekDays.map((a) => { const d = new Date(`${keyAgo(a)}T12:00:00`); return <span key={a} className={`hk-wday${a ? '' : ' is-today'}`}>{d.toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2)}<b>{d.getDate()}</b></span> })}</div>
          {CATS.map((c) => ({ ...c, list: [...(pinned ? [pinned] : []), ...sorted].filter((it) => c.has(it)) })).filter((c) => c.list.length).map((c) => (
            <div key={c.id} id={`hk-sec-${c.id}`} className="hk-wgroup" data-sec={c.id}>
              <div className="hk-wcat">{c.label}<span className="hk-secn">{c.list.length}</span></div>
              {c.list.map((it) => (
                <div key={it.key} className="hk-wrow" style={{ ['--c' as string]: it.color, ['--i' as string]: Math.min(n++, 20) }}>
                  <button className="hk-wname" onClick={() => setSheet({ kind: 'detail', key: it.key })}>{Ico({ it, small: true })}<span>{it.name}</span></button>
                  {weekDays.map((a) => {
                    const v = it.kind === 'goal' ? ((it.goal!.entries ?? []).some((e) => e.day === keyAgo(a)) ? 1 : 0) : dayVal(it, keyAgo(a), a)
                    if (v === null) return <span key={a} className="hk-sq is-x" />
                    const cls = `hk-sq${v >= 1 ? ' is-f' : v > 0 ? ' is-p' : ''}${a ? '' : ' is-t'}`
                    return a === 0 && (it.kind === 'check' || it.kind === 'amount' || it.kind === 'routine' || it.kind === 'goal' || it.kind === 'count')
                      ? <button key={a} className={cls} style={{ ['--pct' as string]: `${Math.round(v * 100)}%` }} aria-label={`${it.name} today`} onClick={() => it.kind === 'check' ? tick(it) : it.kind === 'count' ? s.logCount(it.id, 1) : setSheet({ kind: it.kind === 'routine' ? 'run' : 'log', key: it.key })} />
                      : <span key={a} className={cls} style={{ ['--pct' as string]: `${Math.round(v * 100)}%` }} />
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      </div>

      {/* THE PHONE'S DOCK (his ask, 2026-10-26): the three views on the left,
          and on the same line the filters, swiped sideways. In every view. */}
      <div className="hk-dock">
        <nav className="hk-pill" aria-label="View">
          {(['cards', 'list', 'week'] as const).map((v) => (
            <button key={v} aria-pressed={view === v} aria-label={{ cards: 'Cards', list: 'Checklist', week: 'Week' }[v]} onClick={() => setView(v)}>
              {v === 'cards' ? <Icon.AppsGrid size={20} /> : v === 'list' ? <Icon.Checklist size={20} /> : <Icon.Table size={20} />}
            </button>
          ))}
        </nav>
        <nav className="hk-jump" aria-label="Show" ref={jumpRef}>
          {FILTERS.map(([k, l]) => <button key={k} data-filter={k} aria-pressed={filter === k} onClick={() => { setFilter(k); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>{l}</button>)}
        </nav>
      </div>

      {sheet && (
        <>
          <div className="hk-scrim" onClick={() => setSheet(null)} />
          <div className="hk-sheet" ref={sheetRef} role="dialog" aria-modal="true" aria-label={sheetItem?.name ?? 'New'} style={{ ['--c' as string]: sheetItem?.color ?? '#8E88FF' }}>
            <div className="hk-grab" />
            {/* A part of the day run the way a routine was: its open yes/no habits, in order. */}
            {sheet.kind === 'run' && sheet.part && (() => {
              const c = sections.find((x) => x.id === sheet.part) ?? CATS.find((x) => x.id === sheet.part)
              const list = startList(sorted.filter((it) => c?.has(it)))
              if (!c || !list.length) return null
              return <RoutineRunner folder={{ id: `part-${c.id}`, title: c.label } as Routine} list={list} todayIndex={todayIndex} onClose={() => {
                setSheet(null)
                if (list.filter((h) => !h.optional).every((h) => h.days[todayIndex])) say(`${c.label} done`)
              }} />
            })()}
            {sheet.kind === 'run' && sheetItem?.routine && (
              <RoutineRunner folder={sheetItem.routine} list={sheetItem.list!} todayIndex={todayIndex} onClose={() => {
                setSheet(null)
                if (routineState(sheetItem).complete || sheetItem.list!.filter((h) => !h.optional).every((h) => h.days[todayIndex])) say(`${sheetItem.name} done`)
              }} />
            )}
            {sheet.kind === 'log' && sheetItem && <LogSheet it={sheetItem} onClose={() => setSheet(null)} onAdd={addAmount} kept={kept} today={today} goalTotal={sheetItem.goal ? goalInfo(sheetItem.goal).total : 0} />}
            {sheet.kind === 'detail' && sheetItem && <DetailSheet it={sheetItem} onClose={() => setSheet(null)} onRun={() => setSheet({ kind: 'run', key: sheetItem.key })} onLog={() => setSheet({ kind: 'log', key: sheetItem.key })} dayVal={dayVal} Tiles={Tiles} />}
            {sheet.kind === 'new' && <NewSheet onClose={() => setSheet(null)} onMade={(n) => { setSheet(null); setFilter('all'); say(`Added ${n}`) }} />}
          </div>
        </>
      )}

      <div className={`hk-toast${toast ? ' is-on' : ''}${sheet ? ' is-top' : ''}`} role="status" aria-live="polite">
        <span>{toast?.text}</span>
        {toast?.undo && <button onClick={() => { toast.undo!(); setToast(null) }}>Undo</button>}
      </div>
    </div>
  )
}

/* ---------- promised tasks: tasks committed to this week, month or quarter ----------
   The old Goals page held these; they stay, as one card among the goals. The
   task is the same task as on Plan, so finishing it there finishes it here. */
function Promised() {
  const { tasks, toggleTask, commitTask } = useStore()
  const [tf, setTf] = useState<GoalTimeframe>('monthly')
  const [adding, setAdding] = useState(false)
  const key = goalPeriodKey(tf)
  const mine = tasks.filter((t) => t.horizon === tf && t.horizonKey === key)
  const offer = tasks.filter((t) => !t.done && !(t.horizon === tf && t.horizonKey === key)).slice(0, 12)
  return (
    <article className="hk-card hk-promised" style={{ ['--c' as string]: '#8E88FF' }}>
      <div className="hk-top">
        <span className="hk-ico"><Icon.Flag size={21} /></span>
        <div className="hk-name"><span className="hk-title">Promised</span><span className="hk-sub"><b>{mine.filter((t) => t.done).length} of {mine.length}</b> done</span></div>
        <button className="hk-act is-ring" aria-label="Promise a task" aria-expanded={adding} onClick={() => setAdding(!adding)}><Icon.Plus size={18} /></button>
      </div>
      <div className="hk-seg">{(['weekly', 'monthly', 'quarter'] as const).map((x) => <button key={x} aria-pressed={tf === x} onClick={() => setTf(x)}>{{ weekly: 'This week', monthly: 'This month', quarter: 'This quarter' }[x]}</button>)}</div>
      {adding && (
        <ul className="hk-offer">{offer.length ? offer.map((t) => <li key={t.id}><button onClick={() => { commitTask(t.id, tf, key); setAdding(false) }}>{t.title}</button></li>) : <li className="hk-sub">No open tasks to promise.</li>}</ul>
      )}
      <ul className="hk-steps">{mine.map((t) => <li key={t.id} className={`hk-ptask${t.done ? ' is-d' : ''}`}><button className="hk-mstick" role="checkbox" aria-checked={t.done} aria-label={t.title} onClick={() => toggleTask(t.id)}><i /></button><span>{t.title}</span></li>)}</ul>
      {!mine.length && !adding && <p className="hk-sub">Nothing promised for this stretch. Tap + to promise a task from your list.</p>}
    </article>
  )
}
