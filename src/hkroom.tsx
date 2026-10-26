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
  type Goal, type GoalTimeframe, type HabitDef, type Routine, type RoutineCadence, type TimeSlot,
} from './types'
import { goalPace, goalPeriodKey, goalPeriodRange, localDateKey } from './util'

/* ---------- colour and icon ---------- */
const PALETTE = ['#A3E635', '#A78BFA', '#38BDF8', '#F472B6', '#FB923C', '#2DD4BF', '#22D3EE', '#FACC15', '#4ADE80', '#818CF8', '#F87171', '#E879F9', '#60A5FA', '#34D399', '#F59E0B', '#FB7185', '#C084FC', '#5EEAD4', '#FDBA74', '#94A3B8']
const ICONS: Record<string, (p: { size?: number }) => ReactNode> = {
  sun: Icon.Sun, cup: Icon.Cup, focus: Icon.Focus, bolt: Icon.Bolt, clock: Icon.Clock, hourglass: Icon.Hourglass,
  wave: Icon.Waveform, heart: Icon.DockHeartbeat, book: Icon.DockBook, wallet: Icon.DockWallet, flag: Icon.Flag,
  calendar: Icon.DockCalendar, checklist: Icon.Checklist, home: Icon.Home, bulb: Icon.DockBulb, eye: Icon.Eye, note: Icon.Note,
}
const ICON_KEYS = Object.keys(ICONS)
function hashOf(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) }
function guessIcon(name: string, fallback: string): string {
  const n = name.toLowerCase()
  if (/water|drink|cup|coffee|tea/.test(n)) return 'cup'
  if (/wake|morning|sun|breakfast/.test(n)) return 'sun'
  if (/meditat|breath|calm/.test(n)) return 'wave'
  if (/focus|deep|work/.test(n)) return 'focus'
  if (/bed|sleep|night|evening/.test(n)) return 'hourglass'
  if (/gym|run|stretch|walk|push|sport|train|creatine/.test(n)) return 'heart'
  if (/read|book|journal|pronunc|typing/.test(n)) return 'book'
  if (/earn|money|save|invoice|czk|pay|spend|income/.test(n)) return 'wallet'
  if (/review|plan|week|month/.test(n)) return 'calendar'
  if (/brain|scroll|reset|rot/.test(n)) return 'bolt'
  return fallback
}
const colorFor = (id: string, set?: string) => set ?? PALETTE[hashOf(id) % PALETTE.length]

/* ---------- dates and numbers ---------- */
const DAY = 86400000
const keyAgo = (n: number) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return localDateKey(d) }
const short = (k: string) => new Date(`${k}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString('cs-CZ').replace(/[  ]/g, ' ')
function parseAmount(s: string, unit?: string): number | null {
  const t = s.trim().toLowerCase().replace(/\s/g, '').replace(',', '.')
  if (unit === 'ml') { const l = t.match(/^(\d+(?:\.\d+)?)l$/); if (l) return parseFloat(l[1]) * 1000 }
  const m = t.match(/^(\d+(?:\.\d+)?)(k)?$/)
  return m ? parseFloat(m[1]) * (m[2] ? 1000 : 1) : null
}
const partNow = () => { const h = new Date().getHours(); return h < 12 ? 0 : h < 18 ? 1 : 2 }
const PART_OF: Record<string, number> = { morning: 0, noon: 1, afternoon: 1, evening: 2 }

/* ---------- the page's own view of everything ---------- */
type Kind = 'routine' | 'check' | 'count' | 'amount' | 'auto' | 'quit' | 'goal'
interface Item {
  key: string; kind: Kind; id: string; name: string; color: string; icon: string
  habit?: HabitDef; routine?: Routine; list?: HabitDef[]; goal?: Goal
  /** 0 morning, 1 day, 2 evening, 8 weekly or monthly, 9 whenever */
  part: number
}
const FILTERS: [string, string][] = [['all', 'All'], ['routine', 'Routines'], ['habit', 'Habits'], ['auto', 'Automatic'], ['goal', 'Goals'], ['quit', 'Quitting']]
/** The page's sections, in the order a day runs: what he starts, what he
 *  ticks, what the app keeps for him, what he is reaching for, what he stopped. */
const CATS: { id: string; label: string; has: (k: Kind) => boolean }[] = [
  { id: 'routine', label: 'Routines', has: (k) => k === 'routine' },
  { id: 'habit', label: 'Habits', has: (k) => k === 'check' || k === 'count' || k === 'amount' },
  { id: 'auto', label: 'Automatic', has: (k) => k === 'auto' },
  { id: 'goal', label: 'Goals', has: (k) => k === 'goal' },
  { id: 'quit', label: 'Quitting', has: (k) => k === 'quit' },
]
const isHabitKind = (k: Kind) => k === 'check' || k === 'count' || k === 'amount' || k === 'auto'

export function HabitKitRoom({ start = 'all' }: { start?: string }) {
  const s = useStore()
  const { habits, routines, goals, habitLog, slips, focusSessions, todayIndex } = s
  const [view, setView] = useState<'cards' | 'list' | 'week'>(() => { try { return (localStorage.getItem('mc:hk-view') as 'cards') || 'cards' } catch { return 'cards' } })
  useEffect(() => { try { localStorage.setItem('mc:hk-view', view) } catch { /* private mode */ } }, [view])
  const [filter, setFilter] = useState(start)
  useEffect(() => setFilter(start), [start])
  const [sheet, setSheet] = useState<{ kind: 'run' | 'log' | 'detail' | 'new'; key?: string } | null>(null)
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
    for (const r of routines.filter((x) => !x.archivedAt)) {
      const list = live.filter((h) => h.folderId === r.id).sort((a, b) => (a.folderOrder ?? 0) - (b.folderOrder ?? 0))
      if (!list.length) continue
      const mirror = live.find((h) => h.id === r.habitId)
      const dp = mirror?.daypart ?? list[0].daypart
      const part = r.repeatable && r.cadence === 'daily' ? 9 : r.cadence === 'weekly' || r.cadence === 'monthly' ? 8 : dp ? PART_OF[dp] ?? 1 : r.cadence === 'prework' ? 1 : 1
      out.push({ key: `r:${r.id}`, kind: 'routine', id: r.id, name: r.title, color: colorFor(r.id, r.color), icon: r.icon ?? guessIcon(r.title, 'checklist'), routine: r, list, part })
    }
    for (const h of live.filter((x) => !x.folderId && !folderHabitIds.has(x.id))) {
      const kind: Kind = h.kind === 'break' ? 'quit'
        : h.measure === 'amount' ? 'amount'
        : h.auto?.from === 'focus' || (h.kind === 'measured' && h.measure !== 'times') ? 'auto'
        : h.kind === 'measured' && h.measure === 'times' ? 'count' : 'check'
      out.push({ key: `h:${h.id}`, kind, id: h.id, name: h.name, color: colorFor(h.id, h.color), icon: h.icon ?? guessIcon(h.name, kind === 'quit' ? 'eye' : 'checklist'), habit: h, part: h.daypart ? PART_OF[h.daypart] ?? 1 : 1 })
    }
    for (const g of goals) {
      const tf = (g.timeframe ?? 'quarter') as GoalTimeframe
      if (g.closed) continue
      if (g.periodKey && g.periodKey !== goalPeriodKey(tf)) continue
      out.push({ key: `g:${g.id}`, kind: 'goal', id: g.id, name: g.name, color: colorFor(g.id, g.color), icon: g.icon ?? guessIcon(g.name, 'flag'), goal: g, part: 5 })
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
  const nextUp = useMemo(() => {
    const p = partNow()
    return items.find((it) => it.kind === 'routine' && it.part === p && !routineState(it).off && !routineState(it).complete) ?? null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, todayIndex, habitLog])

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
  /* Goal tiles are the same size as a habit's day dots: a 26-wide grid, at
     most two rows, so 1 goal is one small dot and 100 000 CZK is fifty. */
  const tileSize = (target: number) => { const raw = target / 52; const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000]; return steps.find((x) => x >= raw) ?? 100000 }

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
  const Ring = ({ f, c, size = 46, w = 4, children }: { f: number; c: string; size?: number; w?: number; children?: ReactNode }) => {
    const r = size / 2 - w, C = 2 * Math.PI * r
    return (
      <span className="hk-ringwrap" style={{ width: size, height: size }}>
        <svg className="hk-ring" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`color-mix(in oklab, ${c} 18%, var(--hk-dot))`} strokeWidth={w} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(1, Math.max(0, f)))} />
        </svg>
        {children}
      </span>
    )
  }
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
      cells.push(<i key={`${col}-${row}`} className={v === null ? 'x' : `${v >= 1 ? 'f' : v > 0 ? 'p' : ''}${a === 0 ? ' t' : ''}`} />)
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
    if (h.frequency === 'weekly' || h.frequency === 'monthly') return h.frequency === 'weekly' ? 'Once a week' : 'Once a month'
    return h.frequency === 'weekdays' ? 'Mon to Fri' : 'Every day'
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

  const Card = ({ it, next, i = 0 }: { it: Item; next?: boolean; i?: number }) => {
    const g = it.goal, h = it.habit
    return (
      <article key={it.key} className={`hk-card${next ? ' is-next' : ''}`} style={{ ['--c' as string]: it.color, ['--i' as string]: Math.min(i, 14) }}>
        <div className="hk-top">
          {Ico({ it })}
          <button className="hk-name" onClick={() => setSheet({ kind: 'detail', key: it.key })}>
            {next && <span className="hk-next">Up next</span>}
            <span className="hk-title">{it.name}</span>
            <span className="hk-sub">{subLine(it)}</span>
          </button>
          {Action({ it, big: next })}
        </div>
        {g && <div className="hk-amt"><b>{fmt(goalInfo(g).total)}</b><span>/ {fmt(g.target)} {g.unit}</span>{goalInfo(g).reach && <em className={goalInfo(g).ahead ? 'ok' : ''}>{fmt(g.target)} by {short(goalInfo(g).reach!)}</em>}</div>}
        {it.kind === 'quit' && h && <div className="hk-amt"><b>{quitClean(h).clean}</b><span>of {quitClean(h).daysIn} days clean</span><em>longest {bestCleanRun(h, slips)} days</em></div>}
        {Tiles({ it, weeks: 26 })}
      </article>
    )
  }
  const Row = ({ it, next, i = 0 }: { it: Item; next?: boolean; i?: number }) => (
    <div key={it.key} className={`hk-row${it.kind === 'routine' && routineState(it).off ? ' is-dim' : ''}`} style={{ ['--c' as string]: it.color, ['--i' as string]: Math.min(i, 18) }}>
      {Ico({ it })}
      <button className="hk-name" onClick={() => setSheet({ kind: 'detail', key: it.key })}>
        {next && <span className="hk-next">Up next</span>}
        <span className="hk-title">{it.name}</span>
        <span className="hk-sub">{subLine(it)}</span>
      </button>
      {Action({ it, big: next })}
    </div>
  )

  const shown = items.filter((it) => filter === 'all' || (CATS.find((c) => c.id === filter)?.has(it.kind) ?? false))
  const order = (a: Item, b: Item) => (a.kind === 'routine' ? 0 : isHabitKind(a.kind) ? 1 : a.kind === 'goal' ? 2 : 3) - (b.kind === 'routine' ? 0 : isHabitKind(b.kind) ? 1 : b.kind === 'goal' ? 2 : 3) || a.part - b.part
  const sorted = shown.filter((it) => it !== nextUp).sort(order)
  const pinned = nextUp && shown.includes(nextUp) ? nextUp : null
  const doneToday = (it: Item) => it.kind === 'routine' ? routineState(it).complete : isHabitKind(it.kind) ? todayVal(it) >= 1 : false
  const sheetItem = sheet?.key ? items.find((x) => x.key === sheet.key) ?? null : null

  /* THE CATEGORIES (his ask, 2026-10-25): cards and week are sectioned so it is
     plain at a glance what is a routine, a habit he ticks, a habit the app
     keeps for him, a goal, a quit. Up next stays above them all. */
  const sections = CATS.map((c) => ({ ...c, list: sorted.filter((it) => c.has(it.kind)) }))
    .filter((c) => c.list.length > 0 || (c.id === 'goal' && (filter === 'all' || filter === 'goal')))
  const todayOf = (list: Item[]) => {
    const doable = list.filter((it) => (it.kind === 'routine' || isHabitKind(it.kind)) && !(it.kind === 'routine' && (routineState(it).off || it.part >= 8)))
    return doable.length ? `${doable.filter(doneToday).length} of ${doable.length} done today` : ''
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
            <h2 className="hk-sech" style={{ ['--i' as string]: Math.min(n, 14) }}>{c.label}<span className="hk-secn">{c.list.length + (pinned && c.has(pinned.kind) ? 1 : 0)}</span><span className="hk-sect">{todayOf(pinned && c.has(pinned.kind) ? [pinned, ...c.list] : c.list)}</span></h2>
            <div className="hk-cards">
              {c.list.map((it) => Card({ it, i: n++ }))}
              {c.id === 'goal' && (filter === 'all' || filter === 'goal') && <Promised />}
            </div>
          </section>
        ))}
      </>}

      {view === 'list' && (() => {
        const open = sorted.filter((it) => (it.kind === 'routine' || isHabitKind(it.kind)) && !doneToday(it) && !(it.kind === 'routine' && (routineState(it).off || it.part >= 8)))
        const other = sorted.filter((it) => it.kind === 'goal' || it.kind === 'quit' || (it.kind === 'routine' && !doneToday(it) && (routineState(it).off || it.part >= 8)))
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
          {CATS.map((c) => ({ ...c, list: [...(pinned ? [pinned] : []), ...sorted].filter((it) => c.has(it.kind)) })).filter((c) => c.list.length).map((c) => (
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
          <div className="hk-sheet" role="dialog" aria-modal="true" aria-label={sheetItem?.name ?? 'New'} style={{ ['--c' as string]: sheetItem?.color ?? '#8E88FF' }}>
            <div className="hk-grab" />
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

/* ---------- the quick log: presets, a typed amount, today's rows ---------- */
function LogSheet({ it, onClose, onAdd, kept, today, goalTotal }: {
  it: Item; onClose: () => void; onAdd: (it: Item, v: number, note?: string) => void
  kept: Map<string, Map<string, { n: number; v: number }>>; today: string; goalTotal: number
}) {
  const { habitLog, removeAmount, removeGoalEntry } = useStore()
  const [val, setVal] = useState('')
  const [note, setNote] = useState('')
  const g = it.goal, h = it.habit
  const unit = g ? g.unit : h?.unit ?? ''
  const total = g ? goalTotal : kept.get(h!.id)?.get(today)?.v ?? 0
  const target = g ? g.target : h?.targetAmount ?? 0
  const presets = g
    ? [...new Set((g.entries ?? []).map((e) => e.v).reverse())].slice(0, 4).concat(g.entries?.length ? [] : unit === 'CZK' ? [1000, 5000, 10000] : [1, 5, 10]).slice(0, 4)
    : h?.presets?.length ? h.presets : unit === 'ml' ? [250, 330, 500, 750] : [1, 5, 10]
  const submit = () => { const v = parseAmount(val, unit); if (!v) return; onAdd(it, v, note.trim()); setVal(''); setNote('') }
  const rows = g ? [...(g.entries ?? [])].reverse().slice(0, 8) : habitLog.filter((t) => t.habitId === h!.id && t.day === today && t.v != null).slice().reverse()
  return (
    <div className="hk-log">
      <div className="hk-stop"><span className="hk-spacer" /><h3>{it.name}</h3><button className="hk-round" aria-label="Close" onClick={onClose}><Icon.Close size={16} /></button></div>
      <div className="hk-bigamt"><b>{fmt(total)}</b><span>/ {fmt(target)} {unit}</span></div>
      <div className="hk-presets">{presets.map((v) => <button key={v} onClick={() => onAdd(it, v, note.trim())}>+{unit === 'CZK' && v >= 1000 ? `${fmt(v / 1000)}k` : fmt(v)}<small>{unit}</small></button>)}</div>
      <form className="hk-typed" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <input value={val} onChange={(e) => setVal(e.target.value)} inputMode="decimal" autoComplete="off" placeholder={unit === 'ml' ? 'Other amount, 400 or 0.4l' : unit === 'CZK' ? 'Amount, 12 500 or 12.5k' : 'Amount'} aria-label="Amount" />
        <button disabled={!parseAmount(val, unit)}>Add</button>
      </form>
      {g && <input className="hk-note" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} placeholder="Note, optional: who paid, what for" aria-label="Note" />}
      {rows.length > 0 && (
        <ul className="hk-entries">
          {g ? (rows as NonNullable<Goal['entries']>).map((e) => <li key={e.id}><span className="d">{short(e.day)}</span><span className="n">{e.note ?? ''}</span><span className="v">+{fmt(e.v)}</span><button aria-label="Remove" onClick={() => removeGoalEntry(g.id, e.id)}><Icon.Close size={14} /></button></li>)
            : (rows as { src?: string; v?: number; at?: string }[]).map((t) => <li key={t.src}><span className="d">{t.at ? new Date(t.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}</span><span className="n" /><span className="v">+{fmt(t.v ?? 0)}</span><button aria-label="Remove" onClick={() => t.src && removeAmount(h!.id, t.src)}><Icon.Close size={14} /></button></li>)}
        </ul>
      )}
    </div>
  )
}

/* ---------- one thing in detail: a half year of tiles, a month to correct, its colour ---------- */
function DetailSheet({ it, onClose, onRun, onLog, dayVal, Tiles }: {
  it: Item; onClose: () => void; onRun: () => void; onLog: () => void
  dayVal: (it: Item, day: string, a: number) => number | null
  Tiles: (p: { it: Item; weeks: number }) => ReactNode
}) {
  const { markHabitOn, logSlipOn, setLook, todayIndex, slips, toggleGoalMilestone, toggleHabitDay } = useStore()
  const [month, setMonth] = useState(0)
  const editable = it.kind === 'check' || it.kind === 'quit'
  const m = new Date(); m.setDate(1); m.setMonth(m.getMonth() + month)
  const pad = (m.getDay() + 6) % 7, days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()
  const todayKey = localDateKey()
  const last30 = Array.from({ length: 30 }, (_, i) => dayVal(it, keyAgo(i), i)).filter((v) => v !== null) as number[]
  const pct = last30.length ? Math.round(last30.reduce((a, v) => a + v, 0) / last30.length * 100) : 0
  const lookKind = it.kind === 'routine' ? 'routine' : it.kind === 'goal' ? 'goal' : 'habit'
  return (
    <div className="hk-detail">
      <div className="hk-stop"><span className="hk-spacer" /><h3>{it.name}</h3><button className="hk-round" aria-label="Close" onClick={onClose}><Icon.Close size={16} /></button></div>
      <div className="hk-dgrid">{Tiles({ it, weeks: 26 })}</div>
      {it.kind !== 'goal' && <div className="hk-dchips"><span>{pct}% of the last 30 days</span>{it.kind === 'quit' && it.habit && <span>Longest {bestCleanRun(it.habit, slips)} days</span>}</div>}
      {it.kind === 'routine' && (
        <>
          {/* Each step is tickable right here, for the one he did without running the routine. */}
          <ul className="hk-steps">{it.list!.map((h) => <li key={h.id} className={h.days[todayIndex] ? 'is-d' : ''}><button className="hk-mstick" role="checkbox" aria-checked={h.days[todayIndex]} aria-label={h.name} onClick={() => toggleHabitDay(h.id, todayIndex)}><i /></button><span>{h.name}</span><small>{h.optional ? 'optional' : h.seconds ? `${Math.round(h.seconds / 60)} min` : ''}</small></li>)}</ul>
          {!(it.list![0]?.frequency === 'weekdays' && todayIndex >= 5) && <button className="hk-bigbtn is-c" onClick={onRun}>Start {it.name}</button>}
        </>
      )}
      {it.kind === 'goal' && !!it.goal!.milestones?.length && (
        <ul className="hk-steps">{it.goal!.milestones!.map((ms) => <li key={ms.id} className={ms.done ? 'is-d' : ''}><button className="hk-mstick" role="checkbox" aria-checked={ms.done} aria-label={ms.label} onClick={() => toggleGoalMilestone(it.id, ms.id)}><i /></button><span>{ms.label}</span></li>)}</ul>
      )}
      {it.kind === 'goal' && !it.goal!.habitId && !(it.goal!.milestones?.length && it.goal!.target === it.goal!.milestones.length) && <button className="hk-bigbtn is-c" onClick={onLog}>Log an amount</button>}
      {it.kind === 'amount' && <button className="hk-bigbtn is-c" onClick={onLog}>Log {it.habit?.unit}</button>}
      {it.kind !== 'goal' && (
        <div className="hk-cal">
          <div className="hk-calh">{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <span key={d}>{d}</span>)}</div>
          <div className="hk-calg">
            {Array.from({ length: pad }, (_, i) => <span key={`p${i}`} />)}
            {Array.from({ length: days }, (_, i) => {
              const d = new Date(m.getFullYear(), m.getMonth(), i + 1, 12)
              const k = localDateKey(d), a = Math.round((new Date(`${todayKey}T12:00:00`).getTime() - d.getTime()) / DAY)
              const v = a < 0 ? null : dayVal(it, k, a)
              const cls = `${v != null && v >= 1 ? 'is-f' : v != null && v > 0 ? 'is-p' : ''}${a === 0 ? ' is-t' : ''}`
              const tap = editable && a >= 0 && v !== null
              return <button key={k} className={cls} disabled={!tap} onClick={() => {
                if (it.kind === 'check') markHabitOn(it.id, k, !(v != null && v >= 1))
                else if (it.kind === 'quit' && v === 1) logSlipOn(it.id, k)
              }}>{i + 1}</button>
            })}
          </div>
          <div className="hk-calfoot">
            <button className="hk-round is-sm" aria-label="Previous month" onClick={() => setMonth(month - 1)}><Icon.ChevronLeft size={16} /></button>
            <span>{m.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}{editable ? (it.kind === 'quit' ? '. Tap a clean day to log a slip on it.' : '. Tap a day to fill or clear it.') : ''}</span>
            <button className="hk-round is-sm" aria-label="Next month" disabled={month >= 0} onClick={() => setMonth(month + 1)}><Icon.ChevronRight size={16} /></button>
          </div>
        </div>
      )}
      <div className="hk-field"><label>Colour</label>
        <div className="hk-swatches">{PALETTE.map((c) => <button key={c} style={{ ['--c' as string]: c }} aria-pressed={it.color === c} aria-label="Colour" onClick={() => setLook(lookKind, it.id, { color: c })} />)}</div>
      </div>
      <div className="hk-field"><label>Icon</label>
        <div className="hk-icons">{ICON_KEYS.map((k) => { const C = ICONS[k]; return <button key={k} aria-pressed={it.icon === k} aria-label={k} onClick={() => setLook(lookKind, it.id, { icon: k })}><C size={18} /></button> })}</div>
      </div>
      {it.kind === 'quit' && it.habit && (
        <div className="hk-field"><label htmlFor="hk-cost">Cost a day, CZK</label>
          <input id="hk-cost" inputMode="decimal" defaultValue={it.habit.dailyCost ?? ''} placeholder="60" onBlur={(e) => setLook('habit', it.id, { dailyCost: parseAmount(e.target.value) ?? undefined })} />
        </div>
      )}
      {it.kind === 'amount' && it.habit && (
        <div className="hk-field"><label htmlFor="hk-presets">Quick amounts</label>
          <input id="hk-presets" defaultValue={(it.habit.presets ?? []).join(', ')} placeholder="250, 330, 500, 750" onBlur={(e) => setLook('habit', it.id, { presets: e.target.value.split(',').map((x) => parseAmount(x)).filter((x): x is number => !!x) })} />
        </div>
      )}
    </div>
  )
}

/* ---------- + : name, colour, then what it is and how it is tracked ---------- */
function NewSheet({ onClose, onMade }: { onClose: () => void; onMade: (name: string) => void }) {
  const { addHabit, addGoal, addRoutineWithSteps, space } = useStore()
  const [kind, setKind] = useState<'habit' | 'routine' | 'goal' | 'quit'>('habit')
  const [track, setTrack] = useState<'yesno' | 'count' | 'amount'>('yesno')
  const [name, setName] = useState('')
  const [color, setColor] = useState(PALETTE[1])
  const [freq, setFreq] = useState<'daily' | 'weekdays' | 'times-per-week'>('daily')
  const [part, setPart] = useState<TimeSlot | ''>('')
  const [target, setTarget] = useState('')
  const [unit, setUnit] = useState('')
  const [presets, setPresets] = useState('250, 330, 500, 750')
  const [steps, setSteps] = useState('')
  const [cadence, setCadence] = useState<RoutineCadence | 'demand'>('daily')
  const [period, setPeriod] = useState<GoalTimeframe>('quarter')
  const [since, setSince] = useState(localDateKey())
  const [cost, setCost] = useState('')
  const [milestones, setMilestones] = useState('')
  const hint = { habit: 'Something you do on a day.', routine: 'Steps you go through in order, one tap to start.', goal: 'A total to reach in a period, like 40 000 CZK this quarter.', quit: 'Every day counts as clean until you log a slip.' }[kind]
  const save = () => {
    const n = name.trim(); if (!n) return
    const icon = guessIcon(n, kind === 'routine' ? 'checklist' : kind === 'goal' ? 'flag' : kind === 'quit' ? 'eye' : 'checklist')
    if (kind === 'habit') {
      const base = { name: n, frequency: freq, daypart: part || undefined, color, icon, targetPerWeek: freq === 'times-per-week' ? 3 : undefined }
      if (track === 'yesno') addHabit({ ...base, kind: 'build' })
      else if (track === 'count') addHabit({ ...base, kind: 'measured', measure: 'times', per: 'day', targetCount: Math.max(1, parseAmount(target) ?? 1) })
      else addHabit({ ...base, kind: 'build', measure: 'amount', unit: unit.trim() || 'ml', targetAmount: parseAmount(target) ?? 1, presets: presets.split(',').map((x) => parseAmount(x)).filter((x): x is number => !!x) })
    } else if (kind === 'routine') {
      const list = steps.split('\n').map((x) => x.trim()).filter(Boolean)
      if (!list.length) return
      addRoutineWithSteps({ title: n, cadence: cadence === 'demand' ? 'daily' : cadence, repeatable: cadence === 'demand', daypart: part || undefined, steps: list, color, icon })
    } else if (kind === 'goal') {
      /* Milestones alone make a goal measured in its milestones, the way the
         old sheet did: three steps written, a target of three. */
      const ms = milestones.split('\n').map((x) => x.trim()).filter(Boolean).map((label, i) => ({ id: `m${Date.now().toString(36)}${i}`, label, done: false }))
      const t = parseAmount(target) ?? (ms.length || null); if (!t) return
      const byMs = !parseAmount(target) && ms.length > 0
      addGoal({ space, name: n, current: 0, target: t, unit: byMs ? 'milestones' : unit.trim() || 'CZK', note: '', timeframe: period, category: /czk|eur|\$/i.test(unit) ? 'money' : 'life', color, icon, entries: [], milestones: ms.length ? ms : undefined })
    } else {
      addHabit({ name: n, frequency: 'daily', kind: 'break', quitSince: since, color, icon, dailyCost: parseAmount(cost) ?? undefined })
    }
    onMade(n)
  }
  const canSave = !!name.trim() && (kind !== 'routine' || !!steps.trim()) && (kind !== 'goal' || !!parseAmount(target) || !!milestones.trim())
  return (
    <div className="hk-new">
      <div className="hk-stop"><button className="hk-round" aria-label="Close" onClick={onClose}><Icon.Close size={16} /></button><h3>New</h3><span className="hk-spacer" /></div>
      <div className="hk-field"><label htmlFor="hk-name">Name</label><input id="hk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={{ habit: 'Read 20 pages', routine: 'Sunday reset', goal: 'Earn from Off-Plate', quit: 'Energy drinks' }[kind]} autoFocus /></div>
      <div className="hk-field"><label>Colour</label><div className="hk-swatches">{PALETTE.map((c) => <button key={c} style={{ ['--c' as string]: c }} aria-pressed={color === c} aria-label="Colour" onClick={() => setColor(c)} />)}</div></div>
      <div className="hk-field"><label>Type</label><div className="hk-seg">{(['habit', 'routine', 'goal', 'quit'] as const).map((k) => <button key={k} aria-pressed={kind === k} onClick={() => { setKind(k); if (k === 'goal' && !unit) setUnit('CZK') }}>{{ habit: 'Habit', routine: 'Routine', goal: 'Goal', quit: 'Quit' }[k]}</button>)}</div></div>
      <p className="hk-hint">{hint}</p>
      {kind === 'habit' && <>
        <div className="hk-field"><label>Tracking</label><div className="hk-seg">{(['yesno', 'count', 'amount'] as const).map((k) => <button key={k} aria-pressed={track === k} onClick={() => { setTrack(k); if (k === 'amount' && !unit) { setUnit('ml'); setTarget('2500') } if (k === 'count' && !target) setTarget('8') }}>{{ yesno: 'Yes / No', count: 'Count', amount: 'Amount' }[k]}</button>)}</div></div>
        {track !== 'yesno' && <div className="hk-two">
          <div className="hk-field"><label htmlFor="hk-t">A day</label><input id="hk-t" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></div>
          {track === 'amount' && <div className="hk-field"><label htmlFor="hk-u">Unit</label><input id="hk-u" value={unit} onChange={(e) => setUnit(e.target.value)} /></div>}
        </div>}
        {track === 'amount' && <div className="hk-field"><label htmlFor="hk-p">Quick amounts</label><input id="hk-p" value={presets} onChange={(e) => setPresets(e.target.value)} /></div>}
        <div className="hk-two">
          <div className="hk-field"><label htmlFor="hk-f">How often</label><select id="hk-f" value={freq} onChange={(e) => setFreq(e.target.value as 'daily')}><option value="daily">Every day</option><option value="weekdays">Mon to Fri</option><option value="times-per-week">3 times a week</option></select></div>
          <div className="hk-field"><label htmlFor="hk-w">When</label><select id="hk-w" value={part} onChange={(e) => setPart(e.target.value as TimeSlot)}><option value="">Any time</option><option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="evening">Evening</option></select></div>
        </div>
      </>}
      {kind === 'routine' && <>
        <div className="hk-two">
          <div className="hk-field"><label htmlFor="hk-c">How often</label><select id="hk-c" value={cadence} onChange={(e) => setCadence(e.target.value as RoutineCadence)}><option value="daily">Every day</option><option value="prework">Mon to Fri</option><option value="weekly">Once a week</option><option value="monthly">Once a month</option><option value="demand">Whenever I need it</option></select></div>
          <div className="hk-field"><label htmlFor="hk-w2">When</label><select id="hk-w2" value={part} onChange={(e) => setPart(e.target.value as TimeSlot)}><option value="">Any time</option><option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="evening">Evening</option></select></div>
        </div>
        <div className="hk-field"><label htmlFor="hk-s">Steps, one per line</label><textarea id="hk-s" value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={'Laundry\nPlan meals\nClean the desk'} /></div>
      </>}
      {kind === 'goal' && <>
        <div className="hk-two">
          <div className="hk-field"><label htmlFor="hk-gt">Target</label><input id="hk-gt" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="40 000" /></div>
          <div className="hk-field"><label htmlFor="hk-gu">Unit</label><input id="hk-gu" value={unit} onChange={(e) => setUnit(e.target.value)} /></div>
        </div>
        <div className="hk-field"><label htmlFor="hk-ms">Milestones, one per line (optional)</label><textarea id="hk-ms" value={milestones} onChange={(e) => setMilestones(e.target.value)} placeholder={'First client signed\nCase study published'} /></div>
        <div className="hk-field"><label htmlFor="hk-gp">By</label><select id="hk-gp" value={period} onChange={(e) => setPeriod(e.target.value as GoalTimeframe)}><option value="weekly">End of this week</option><option value="monthly">End of this month</option><option value="quarter">End of this quarter</option><option value="half">End of this half year</option></select></div>
      </>}
      {kind === 'quit' && <div className="hk-two">
        <div className="hk-field"><label htmlFor="hk-qs">Since</label><input id="hk-qs" type="date" value={since} onChange={(e) => setSince(e.target.value)} /></div>
        <div className="hk-field"><label htmlFor="hk-qc">Cost a day, CZK</label><input id="hk-qc" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="60" /></div>
      </div>}
      <button className="hk-bigbtn" style={{ background: color }} disabled={!canSave} onClick={save}>Save</button>
    </div>
  )
}
