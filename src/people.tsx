/* THE PEOPLE PAGE. Everyone he keeps in his life, on one canvas, him in the
   middle. Built on his description (2026-09-17) and the prototype he approved
   the same day:

   - rings by closeness, inner circle out to distant, with Business as its own
     ring; a click on a ring (or its button above the canvas) fades everyone
     else, and a second click shows everyone again;
   - each person carries how often he wants to be in touch, and their colour
     runs from green (just spoke) through orange to red as that time runs out,
     with a "!" once it has;
   - who knows whom, as dotted lines between people;
   - the card on the side says when he last spoke to them and how, and logging
     a contact is one tap per channel.

   Contacts are logged by hand on purpose: a call, a coffee or a WhatsApp
   thread never reaches his inbox, and a date read from email would call him
   in touch with someone he has not actually spoken to in months.

   Where he is looking (pan and zoom) is per device and never synced. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { useStore } from './store'
import { Select } from './ui'
import { localDateKey } from './util'
import { ALL_NAMES, daysUntil, nameDayFor } from './namedays'
import { nextPersonSlot } from './peoplelayout'
import type { ContactChannel, Person, PersonBond, PersonContact, PersonTier } from './types'

type Tier = { id: PersonTier; label: string; r: number; size: number; cadence: number; bond: number }
const TIERS: Tier[] = [
  { id: 'core', label: 'Inner circle', r: 150, size: 30, cadence: 7, bond: 2.6 },
  { id: 'close', label: 'Close', r: 255, size: 26, cadence: 14, bond: 2 },
  { id: 'friends', label: 'Friends', r: 355, size: 23, cadence: 30, bond: 1.5 },
  { id: 'business', label: 'Business', r: 450, size: 22, cadence: 30, bond: 1.2 },
  { id: 'wider', label: 'Wider circle', r: 545, size: 21, cadence: 90, bond: 1.2 },
  { id: 'distant', label: 'Distant', r: 640, size: 19, cadence: 365, bond: 1 },
]
const TIER = Object.fromEntries(TIERS.map((t) => [t.id, t])) as Record<PersonTier, Tier>
/* Each circle owns the band halfway to its neighbours, less a little so two
   bands never touch. A person moves freely inside their own band and cannot
   be dragged out of it: changing circle is a choice on their card. */
const BAND = Object.fromEntries(TIERS.map((t, i) => {
  const prev = i === 0 ? 40 + t.size + 12 : (TIERS[i - 1].r + t.r) / 2 + 8
  const next = i === TIERS.length - 1 ? t.r + 60 : (t.r + TIERS[i + 1].r) / 2 - 8
  return [t.id, [prev, next] as const]
})) as Record<PersonTier, readonly [number, number]>
function inBand(tier: PersonTier, x: number, y: number): { x: number; y: number } {
  const [lo, hi] = BAND[tier]
  const d = Math.hypot(x, y)
  if (d >= lo && d <= hi) return { x, y }
  // Dead centre has no direction; send it straight up.
  const a = d === 0 ? -Math.PI / 2 : Math.atan2(y, x)
  const r = Math.min(hi, Math.max(lo, d))
  return { x: Math.cos(a) * r, y: Math.sin(a) * r }
}
const CADENCES: [number, string][] = [
  [1, 'Every day'], [3, 'Every 3 days'], [7, 'Every week'], [14, 'Every 2 weeks'],
  [30, 'Every month'], [90, 'Every 3 months'], [180, 'Every 6 months'], [365, 'Every year'],
]
const CHANNELS: { id: ContactChannel; label: string; icon: JSX.Element }[] = [
  { id: 'inperson', label: 'In person', icon: <path d="M8 8.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2ZM3 14c.6-2.6 2.6-4 5-4s4.4 1.4 5 4" /> },
  { id: 'call', label: 'Call', icon: <path d="M5.2 2.5 6.6 5.6 5.3 6.8a8 8 0 0 0 3.9 3.9l1.2-1.3 3.1 1.4-.5 2.2c-.1.5-.6.9-1.1.9A10.4 10.4 0 0 1 2.1 3.6c0-.5.4-1 .9-1.1l2.2-.5Z" /> },
  { id: 'message', label: 'Message', icon: <path d="M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5v-2.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z" /> },
  { id: 'video', label: 'Video', icon: <><rect x="1.8" y="4" width="8.6" height="8" rx="1.5" /><path d="m10.4 7 3.8-2.2v6.4L10.4 9" /></> },
  { id: 'email', label: 'Email', icon: <><rect x="2" y="3.5" width="12" height="9" rx="1.4" /><path d="m2.6 4.5 5.4 4 5.4-4" /></> },
]
const CHANNEL = Object.fromEntries(CHANNELS.map((c) => [c.id, c])) as Record<ContactChannel, typeof CHANNELS[number]>
const ChannelIcon = ({ id, size = 16 }: { id: ContactChannel; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {CHANNEL[id].icon}
  </svg>
)

/* Suggestions only: any word he types is kept as he typed it. */
const REL_WORDS = ['brother', 'sister', 'partner', 'wife', 'husband', 'mother', 'father', 'son', 'daughter', 'cousin', 'friend', 'best friend', 'colleague', 'boss', 'client', 'business partner', 'neighbour', 'ex']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const fmtMD = (mmdd: string) => { const [m, d] = mmdd.split('-').map(Number); return `${d} ${MONTHS[m - 1]}` }
const inDays = (n: number) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`)
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
/** A birthday or name day within the week, the nearer one first. */
function occasionOf(p: Person, today: string): { t: string; days: number } | null {
  const out: { t: string; days: number }[] = []
  if (p.birthday) { const n = daysUntil(p.birthday, today); if (n <= 7) out.push({ t: n === 0 ? 'Birthday today' : `Birthday ${inDays(n)}`, days: n }) }
  const nd = nameDayFor(p.name, p.nameDayAs)
  if (nd) { const n = daysUntil(nd.day, today); if (n <= 7) out.push({ t: n === 0 ? 'Name day today' : `Name day ${inDays(n)}`, days: n }) }
  return out.sort((a, b) => a.days - b.days)[0] ?? null
}
const DAY = 86_400_000
const noon = (day: string) => new Date(`${day}T12:00:00`).getTime()
const daysBetween = (from: string, to: string) => Math.round((noon(to) - noon(from)) / DAY)
const fmtDay = (day: string) => {
  const d = new Date(`${day}T12:00:00`)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })
}
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase() || '?'

type Health = { h: number; days: number | null; left: number; last: PersonContact | null }
function healthOf(p: Person, last: PersonContact | null, today: string): Health {
  if (!last) return { h: 0, days: null, left: -Infinity, last: null }
  const days = Math.max(0, daysBetween(last.day, today))
  return { h: Math.max(0, Math.min(1, 1 - days / p.cadenceDays)), days, left: p.cadenceDays - days, last }
}
const overdue = (hh: Health) => hh.days === null || hh.left < 0
/* A person with reminders off keeps this same neutral tone everywhere a
   health colour would otherwise show, so "off" reads as one clear state
   rather than as whatever colour their last contact happened to leave
   them at. */
const OFF_COLOUR = '#8C877A'
/* Green when he has just spoken to them, orange halfway to the deadline, red as
   it arrives. Overdue is red outright. */
const RAMP: [number, number[]][] = [[0, [210, 69, 42]], [0.5, [224, 138, 30]], [1, [62, 155, 79]]]
function colourOf(hh: Health): string {
  if (overdue(hh)) return 'rgb(210, 69, 42)'
  for (let i = 1; i < RAMP.length; i++) {
    const [h0, c0] = RAMP[i - 1]
    const [h1, c1] = RAMP[i]
    if (hh.h <= h1) {
      const k = (hh.h - h0) / (h1 - h0)
      return `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * k)).join(', ')})`
    }
  }
  return 'rgb(62, 155, 79)'
}
function dueLabel(hh: Health): { t: string; tone: '' | 'warn' | 'alert' } {
  if (hh.days === null) return { t: 'Never logged', tone: 'alert' }
  if (hh.left < 0) return { t: `${-hh.left}d overdue`, tone: 'alert' }
  if (hh.left === 0) return { t: 'Due today', tone: 'warn' }
  if (hh.left <= 7 && hh.h <= 0.5) return { t: `Due in ${hh.left}d`, tone: 'warn' }
  return { t: `in ${hh.left}d`, tone: '' }
}
function sinceLabel(hh: Health): string {
  if (!hh.last || hh.days === null) return 'No contact logged yet'
  const when = hh.days === 0 ? 'today' : hh.days === 1 ? 'yesterday' : `${hh.days} days ago`
  return hh.last.channel === 'inperson'
    ? `Last saw them in person, ${when}`
    : `Last spoke by ${CHANNEL[hh.last.channel].label.toLowerCase()}, ${when}`
}

type View = { x: number; y: number; z: number }
const VIEW_KEY = 'mc-people-view'
const LIST_KEY = 'mc-people-list'
const clampZ = (z: number) => Math.min(2.2, Math.max(0.3, z))
function readView(): View | null {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as View | null
    return v && [v.x, v.y, v.z].every((n) => typeof n === 'number') ? { ...v, z: clampZ(v.z) } : null
  } catch { return null }
}

export function PeoplePage() {
  const {
    people, personBonds, personContacts,
    addPerson, updatePerson, deletePerson, addPersonBond, setBondLabel, removePersonBond, logContact, removeContact,
  } = useStore()
  const today = localDateKey()

  const lastBy = useMemo(() => {
    const m = new Map<string, PersonContact>()
    for (const c of personContacts) {
      const prev = m.get(c.personId)
      if (!prev || c.day > prev.day || (c.day === prev.day && c.createdAt > prev.createdAt)) m.set(c.personId, c)
    }
    return m
  }, [personContacts])
  const health = useMemo(
    () => new Map(people.map((p) => [p.id, healthOf(p, lastBy.get(p.id) ?? null, today)])),
    [people, lastBy, today],
  )
  const hOf = (id: string) => health.get(id) ?? { h: 0, days: null, left: -Infinity, last: null }

  const [selected, setSelected] = useState<string | null>(null)
  const [focusTier, setFocusTier] = useState<PersonTier | null>(null)
  const [adding, setAdding] = useState(false)
  const [listOpen, setListOpen] = useState(() => {
    try { const v = localStorage.getItem(LIST_KEY); if (v) return v === '1' } catch { /* private mode */ }
    return window.innerWidth > 760
  })
  useEffect(() => { try { localStorage.setItem(LIST_KEY, listOpen ? '1' : '0') } catch { /* private mode */ } }, [listOpen])
  const person = selected ? people.find((p) => p.id === selected) : undefined
  useEffect(() => { if (selected && !person) setSelected(null) }, [selected, person])
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [hit, setHit] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const q = fold(query.trim())
  const matches = (p: Person) => !q || fold(`${p.name} ${p.rel} ${p.job ?? ''}`).includes(q)
  const found = q ? people.filter(matches).sort((a, b) => a.name.localeCompare(b.name, 'cs')) : []
  const dimmed = (p: Person) => (!!focusTier && p.tier !== focusTier) || !matches(p)

  /* ---------- view ---------- */
  const stageRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>(() => readView() ?? { x: 400, y: 320, z: 0.7 })
  const viewRef = useRef(view)
  viewRef.current = view
  const tweenRef = useRef(0)
  useEffect(() => {
    const t = window.setTimeout(() => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)) } catch { /* private mode */ } }, 250)
    return () => window.clearTimeout(t)
  }, [view])

  /* The canvas runs to the bottom edge of the window, measured from where it
     starts, the same way the Ideas board does. */
  useLayoutEffect(() => {
    const size = () => {
      const el = stageRef.current
      if (!el) return
      const top = el.getBoundingClientRect().top + window.scrollY
      el.style.height = `${Math.max(460, Math.round(window.innerHeight - top))}px`
    }
    size()
    window.addEventListener('resize', size)
    return () => window.removeEventListener('resize', size)
  }, [])

  const phone = () => window.innerWidth <= 760
  const cardWidth = (open: boolean) => (open && !phone() ? Math.min(360, stageRef.current?.clientWidth ?? 0) : 0)
  const tween = (target: View, ms = 480) => {
    const id = ++tweenRef.current
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setView(target); return }
    const from = { ...viewRef.current }
    const t0 = performance.now()
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
    const step = (t: number) => {
      if (id !== tweenRef.current) return
      const k = Math.min(1, (t - t0) / ms)
      const e = ease(k)
      setView({ x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, z: from.z + (target.z - from.z) * e })
      if (k < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }
  const fit = (animate = true, open = !!selected) => {
    const el = stageRef.current
    if (!el) return
    const outer = TIER[people.length ? people.reduce((a, p) => (TIER[p.tier].r > TIER[a].r ? p.tier : a), 'core' as PersonTier) : 'friends'].r
    const pts = [{ x: -outer, y: -outer }, { x: outer, y: outer }, ...people.map((p) => inBand(p.tier, p.x, p.y))]
    const pad = 70
    const minX = Math.min(...pts.map((p) => p.x)) - pad
    const maxX = Math.max(...pts.map((p) => p.x)) + pad
    const minY = Math.min(...pts.map((p) => p.y)) - pad
    const maxY = Math.max(...pts.map((p) => p.y)) + pad + 20
    const w = el.clientWidth - cardWidth(open)
    const top = (el.querySelector('.pp-bar')?.getBoundingClientRect().height ?? 0) + 24
    const h = el.clientHeight - top - 20
    const z = clampZ(Math.min(1.4, Math.min(w / (maxX - minX), h / (maxY - minY))))
    const target = { z, x: w / 2 - ((minX + maxX) / 2) * z, y: top + h / 2 - ((minY + maxY) / 2) * z }
    if (animate) tween(target)
    else setView(target)
  }
  useLayoutEffect(() => { if (!readView()) fit(false, false) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const flyTo = (p: Person) => {
    const el = stageRef.current
    if (!el) return
    const z = Math.max(viewRef.current.z, 0.9)
    const w = el.clientWidth - cardWidth(true)
    const h = phone() ? el.clientHeight * 0.28 : el.clientHeight
    const at = inBand(p.tier, p.x, p.y)
    tween({ z, x: w / 2 - at.x * z, y: h / 2 - at.y * z })
  }
  const zoomAt = (px: number, py: number, factor: number) => {
    tweenRef.current++
    setView((v) => {
      const z = clampZ(v.z * factor)
      return { z, x: px - (px - v.x) * (z / v.z), y: py - (py - v.y) * (z / v.z) }
    })
  }
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      /* The card and the due list float over the canvas but are still inside
         it, so a wheel event scrolling either of them was reaching this
         handler too and being hijacked into panning the canvas -- his report
         (2026-09-17): the card "still not scrollable" after the CSS fix,
         because the CSS was never the problem, this was. */
      if ((e.target as HTMLElement | null)?.closest('.pp-card, .pp-due')) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 40) {
        zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)))
      } else {
        tweenRef.current++
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const select = (id: string | null) => {
    const was = selected
    setSelected(id)
    if (id) {
      const p = people.find((x) => x.id === id)
      if (p) flyTo(p)
    } else if (was) fit(true, false)
  }
  const setFocus = (next: PersonTier | null) => {
    setFocusTier(next)
    if (next && person && person.tier !== next) setSelected(null)
  }
  const toggleFocus = (id: PersonTier) => setFocus(focusTier === id ? null : id)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]')
      if (e.key === '/' && !typing && !adding) { e.preventDefault(); searchRef.current?.focus(); return }
      if (e.key !== 'Escape' || adding || typing) return
      if (selected) select(null)
      else if (query) setQuery('')
      else if (focusTier) setFocusTier(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---------- pointer: pan, drag a person, pick a ring ---------- */
  type Drag = { pid: number; sx: number; sy: number; moved: boolean; person: string | null; tier: PersonTier | null; ox: number; oy: number }
  const dragRef = useRef<Drag | null>(null)
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null)
  const [panning, setPanning] = useState(false)
  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (dragRef.current || e.button !== 0) return
    const t = e.target as Element
    const atom = t.closest('[data-person]')
    const tier = atom ? null : t.closest('[data-tier]')
    const pid = atom?.getAttribute('data-person') ?? null
    const p = pid ? people.find((x) => x.id === pid) : undefined
    tweenRef.current++
    dragRef.current = {
      pid: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false,
      person: p ? p.id : null, tier: (tier?.getAttribute('data-tier') as PersonTier | null) ?? null,
      ox: p ? p.x : viewRef.current.x, oy: p ? p.y : viewRef.current.y,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pid) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    d.moved = true
    if (d.person) {
      const who = people.find((x) => x.id === d.person)
      const nx = d.ox + dx / viewRef.current.z
      const ny = d.oy + dy / viewRef.current.z
      setDragPos({ id: d.person, ...(who ? inBand(who.tier, nx, ny) : { x: nx, y: ny }) })
    } else {
      setPanning(true)
      setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }))
    }
  }
  const onUp = (e: RPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pid) return
    dragRef.current = null
    setPanning(false)
    if (d.person && d.moved) {
      if (dragPos && dragPos.id === d.person) updatePerson(d.person, { x: dragPos.x, y: dragPos.y })
      setDragPos(null)
      return
    }
    if (d.moved) return
    if (d.person) return select(d.person === selected ? null : d.person)
    if (d.tier) return toggleFocus(d.tier)
    if (selected) return select(null)
    if (focusTier) setFocusTier(null)
  }
  const onLost = () => {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    setPanning(false)
    if (d.person && dragPos && dragPos.id === d.person) updatePerson(d.person, { x: dragPos.x, y: dragPos.y })
    setDragPos(null)
  }
  const posOf = (p: Person) => (dragPos?.id === p.id ? dragPos : inBand(p.tier, p.x, p.y))

  /* ---------- derived lists ---------- */
  const counts = useMemo(() => {
    let over = 0
    let week = 0
    let tracked = 0
    for (const p of people) {
      if (p.remindersOff) continue
      tracked++
      const hh = hOf(p.id)
      if (overdue(hh)) over++
      else if (hh.left <= 7 && hh.h <= 0.5) week++
    }
    return { over, week, ok: tracked - over - week }
  }, [people, health]) // eslint-disable-line react-hooks/exhaustive-deps
  const due = people
    .filter((p) => !dimmed(p) && !p.remindersOff)
    .map((p) => ({ p, hh: hOf(p.id) }))
    .sort((a, b) => (a.hh.left / a.p.cadenceDays) - (b.hh.left / b.p.cadenceDays) || a.p.name.localeCompare(b.p.name))

  /* ---------- add ---------- */
  const add = (name: string, rel: string, tier: PersonTier, cadenceDays: number) => {
    // The widest free gap on that ring, so a newcomer never lands on someone
    // -- shared with the assistant's own addPerson, so a person dictated and
    // one added by hand land the same way (peoplelayout.ts).
    const { x, y } = nextPersonSlot(people, tier)
    const id = addPerson({ name, rel, tier, cadenceDays, x, y })
    setAdding(false)
    setSelected(id)
    const el = stageRef.current
    if (el) {
      const z = Math.max(viewRef.current.z, 0.9)
      const w = el.clientWidth - cardWidth(true)
      const h = phone() ? el.clientHeight * 0.28 : el.clientHeight
      tween({ z, x: w / 2 - x * z, y: h / 2 - y * z })
    }
  }

  const stageW = stageRef.current?.clientWidth ?? 0
  const stageH = stageRef.current?.clientHeight ?? 0

  return (
    <div className="pp-page">
      <div ref={stageRef} className={`pp-stage${panning ? ' is-panning' : ''}${person ? ' has-card' : ''}`}>
        <svg
          className="pp-canvas" aria-label="Your people, you in the middle"
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onLostPointerCapture={onLost}
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.z})`}>
            <g>
              {TIERS.map((t) => (
                <g key={t.id} className={`pp-tier${focusTier === t.id ? ' is-focus' : focusTier ? ' is-dim' : ''}`} data-tier={t.id}>
                  <circle className="pp-tier-hit" r={t.r} />
                  <circle className="pp-tier-ring" r={t.r} />
                  <text className="pp-tier-label" y={-t.r - 8}>{t.label}</text>
                </g>
              ))}
            </g>
            <g>
              {people.map((p) => {
                const hh = hOf(p.id)
                const pos = posOf(p)
                return (
                  <line
                    key={p.id}
                    className={`pp-bond${overdue(hh) ? ' is-late' : ''}${selected === p.id ? ' is-lit' : ''}${dimmed(p) ? ' is-dim' : ''}`}
                    x1={0} y1={0} x2={pos.x} y2={pos.y} strokeWidth={TIER[p.tier].bond}
                    style={{ strokeOpacity: 0.2 + 0.5 * hh.h }}
                  />
                )
              })}
              {personBonds.map((b) => {
                const A = people.find((p) => p.id === b.a)
                const B = people.find((p) => p.id === b.b)
                if (!A || !B) return null
                const pa = posOf(A)
                const pb = posOf(B)
                return (
                  <line
                    key={b.id}
                    className={`pp-bond is-peer${selected === A.id || selected === B.id ? ' is-lit' : ''}${dimmed(A) && dimmed(B) ? ' is-dim' : ''}`}
                    x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                    style={{ strokeOpacity: 0.22 + 0.33 * Math.min(hOf(A.id).h, hOf(B.id).h) }}
                  />
                )
              })}
            </g>
            {view.z >= 0.5 && (
              <g className="pp-bond-labels" aria-hidden="true">
                {personBonds.flatMap((b) => {
                  const A = people.find((p) => p.id === b.a)
                  const B = people.find((p) => p.id === b.b)
                  if (!A || !B) return []
                  const pa = posOf(A)
                  const pb = posOf(B)
                  const dim = dimmed(A) && dimmed(B)
                  const lit = selected === A.id || selected === B.id
                  // Each word sits on the line, a third of the way out from the person it describes.
                  return ([[b.aToB, pa, pb, 'a'], [b.bToA, pb, pa, 'b']] as const)
                    .filter(([w]) => !!w)
                    .map(([w, from, to, side]) => (
                      <text
                        key={`${b.id}-${side}`}
                        className={`pp-bond-word${lit ? ' is-lit' : ''}${dim ? ' is-dim' : ''}`}
                        x={from.x + (to.x - from.x) * 0.34} y={from.y + (to.y - from.y) * 0.34}
                      >
                        {w}
                      </text>
                    ))
                })}
              </g>
            )}
            <g className="pp-atom pp-me" aria-label="You">
              <circle className="pp-atom-body" r={40} />
              <text className="pp-atom-initials" fontSize={18}>You</text>
            </g>
            {people.map((p) => {
              const hh = hOf(p.id)
              const R = TIER[p.tier].size
              const pos = posOf(p)
              const tracked = !p.remindersOff
              const colour = tracked ? colourOf(hh) : OFF_COLOUR
              const late = tracked && overdue(hh)
              return (
                <g
                  key={p.id}
                  data-person={p.id}
                  className={`pp-atom${selected === p.id ? ' is-selected' : ''}${dimmed(p) ? ' is-dim' : ''}${late ? ' is-over' : ''}${!tracked ? ' is-untracked' : ''}${dragPos?.id === p.id ? ' is-dragging' : ''}`}
                  transform={`translate(${pos.x} ${pos.y})`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${p.name}${p.rel ? `, ${p.rel}` : ''}. ${sinceLabel(hh)}.`}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(p.id) } }}
                >
                  <circle className="pp-atom-halo" r={R + 5} />
                  <circle className="pp-atom-body" r={R} style={{ fill: colour }} />
                  <text className="pp-atom-initials" fontSize={Math.round(R * 0.62)}>{initials(p.name)}</text>
                  <text className="pp-atom-name" y={R + 15}>{p.name}</text>
                  {tracked && (
                    <>
                      <rect className="pp-atom-track" x={-23} y={R + 22} width={46} height={4} rx={2} />
                      <rect
                        className="pp-atom-fill" x={-23} y={R + 22} width={46} height={4} rx={2}
                        style={{ fill: colour, transform: `scaleX(${Math.max(0.001, hh.h)})` }}
                      />
                    </>
                  )}
                  {late && <text className="pp-atom-late" y={R + 40}>{hh.days === null ? 'never' : `${-hh.left}d late`}</text>}
                  <g className="pp-atom-warn" transform={`translate(${Math.round(R * 0.72)} ${-Math.round(R * 0.72)})`}>
                    <circle r={9} />
                    <text>!</text>
                  </g>
                </g>
              )
            })}
          </g>
        </svg>

        <div className="pp-bar" role="toolbar" aria-label="People">
          <h1 className="pp-h1">People</h1>
          <div className="pp-search">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="m10.4 10.4 3.4 3.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
            <input
              ref={searchRef} className="pp-search-input" type="search" value={query} placeholder="Search people"
              aria-label="Search people" aria-expanded={searchOpen && !!q} aria-controls="pp-search-results" role="combobox" autoComplete="off"
              onChange={(e) => { setQuery(e.target.value); setHit(0); setSearchOpen(true) }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setHit((h) => Math.min(found.length - 1, h + 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setHit((h) => Math.max(0, h - 1)) }
                else if (e.key === 'Enter' && found[hit]) { e.preventDefault(); select(found[hit].id); setSearchOpen(false) }
                else if (e.key === 'Escape') { e.preventDefault(); if (query) setQuery(''); else e.currentTarget.blur() }
              }}
            />
            {!query && <kbd className="pp-kbd" aria-hidden="true">/</kbd>}
            {searchOpen && q && (
              <ul className="pp-search-results" id="pp-search-results" role="listbox">
                {found.slice(0, 8).map((p, i) => (
                  <li key={p.id} role="option" aria-selected={i === hit}>
                    <button
                      type="button" className={`pp-search-hit${i === hit ? ' is-on' : ''}`}
                      onMouseEnter={() => setHit(i)} onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { select(p.id); setSearchOpen(false) }}
                    >
                      <span className="pp-search-dot" style={{ background: p.remindersOff ? OFF_COLOUR : colourOf(hOf(p.id)) }} />
                      <span className="pp-search-name">{p.name}</span>
                      <span className="pp-search-meta">{[p.rel, p.job].filter(Boolean).join(', ') || TIER[p.tier].label}</span>
                    </button>
                  </li>
                ))}
                {found.length === 0 && <li className="pp-muted pp-pad">No one matches.</li>}
              </ul>
            )}
          </div>
          <div className="pp-counts" aria-label="How you are doing">
            <span className={`pp-count${counts.over ? ' is-alert' : ''}`} title="Overdue"><b>{counts.over}</b> overdue</span>
            <span className={`pp-count${counts.week ? ' is-warn' : ''}`} title="Due in the next 7 days"><b>{counts.week}</b> this week</span>
            <span className="pp-count" title="In touch"><b>{counts.ok}</b> in touch</span>
          </div>
          <Select
            className="pp-dd pp-circle-pick" ariaLabel="Show one circle" value={focusTier ?? ''}
            onChange={(v) => setFocus(v || null)}
            options={[
              { value: '', label: `All circles (${people.length})` },
              ...TIERS.map((t) => ({ value: t.id, label: `${t.label} (${people.filter((p) => p.tier === t.id).length})` })),
            ]}
          />
          <button className="btn btn-primary pp-add" type="button" onClick={() => setAdding(true)} aria-label="Add person">
            <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            Add
          </button>
        </div>

        {people.length === 0 && (
          <div className="pp-empty">
            <p>Everyone you keep in your life goes on these rings, closest in the middle.</p>
            <button className="btn btn-primary" type="button" onClick={() => setAdding(true)}>Add the first person</button>
          </div>
        )}

        {people.length > 0 && (
          <div className={`pp-due${listOpen ? '' : ' is-shut'}`}>
            <div className="pp-due-head">
              <h2>{q ? 'Matches' : focusTier ? `Who to reach, ${TIER[focusTier].label.toLowerCase()}` : 'Who to reach'}</h2>
              <button className="pp-link" type="button" aria-expanded={listOpen} onClick={() => setListOpen((v) => !v)}>
                {listOpen ? 'Hide' : 'Show'}
              </button>
            </div>
            {listOpen && (
              <ul className="pp-due-list">
                {due.map(({ p, hh }) => {
                  const d = dueLabel(hh)
                  const occ = occasionOf(p, today)
                  return (
                    <li key={p.id}>
                      <button className={`pp-due-item${selected === p.id ? ' is-selected' : ''}`} type="button" onClick={() => select(p.id)}>
                        <span className="pp-mini-av">{initials(p.name)}</span>
                        <span className="pp-due-mid">
                          <span className="pp-due-name">{p.name}</span>
                          {occ && <span className="pp-due-occ">{occ.t}</span>}
                          <span className="pp-minibar"><i style={{ background: colourOf(hh), transform: `scaleX(${Math.max(0.001, hh.h)})` }} /></span>
                        </span>
                        <span className={`pp-due-when${d.tone ? ` is-${d.tone}` : ''}`}>{d.t}</span>
                      </button>
                    </li>
                  )
                })}
                {due.length === 0 && <li className="pp-muted pp-pad">{q ? 'No one matches.' : 'No one in this circle yet.'}</li>}
              </ul>
            )}
          </div>
        )}

        <div className="pp-controls">
          <button className="pp-icon-btn" type="button" aria-label="Zoom out" onClick={() => zoomAt((stageW - cardWidth(!!selected)) / 2, stageH / 2, 1 / 1.2)}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 7h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
          <span className="pp-zoom-read">{Math.round(view.z * 100)}%</span>
          <button className="pp-icon-btn" type="button" aria-label="Zoom in" onClick={() => zoomAt((stageW - cardWidth(!!selected)) / 2, stageH / 2, 1.2)}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 7h10M7 2v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
          <button className="pp-icon-btn" type="button" aria-label="Show everyone" onClick={() => fit()}>
            <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>

        <aside className={`pp-card${person ? ' is-open' : ''}`} aria-label="Person" aria-hidden={!person}>
          {person && (
            <PersonCard
              key={person.id}
              person={person}
              hh={hOf(person.id)}
              people={people}
              bonds={personBonds}
              contacts={personContacts.filter((c) => c.personId === person.id)}
              today={today}
              onClose={() => select(null)}
              onPatch={(patch) => updatePerson(person.id, patch)}
              onTier={(tier) => {
                const from = TIER[person.tier]
                const to = TIER[tier]
                const a = Math.atan2(person.y, person.x)
                const dist = Math.hypot(person.x, person.y) || from.r
                const r = dist * (to.r / from.r)
                updatePerson(person.id, { tier, ...inBand(tier, Math.cos(a) * r, Math.sin(a) * r) })
              }}
              onLog={(day, ch) => logContact(person.id, day, ch)}
              onUnlog={removeContact}
              onLink={(other, word) => addPersonBond(person.id, other, word)}
              onLabel={(bondId, word) => setBondLabel(bondId, person.id, word)}
              onUnlink={removePersonBond}
              onRemove={() => { deletePerson(person.id); select(null) }}
            />
          )}
        </aside>
      </div>

      {adding && <AddPerson onClose={() => setAdding(false)} onAdd={add} />}
    </div>
  )
}

function PersonCard({
  person, hh, people, bonds, contacts, today, onClose, onPatch, onTier, onLog, onUnlog, onLink, onLabel, onUnlink, onRemove,
}: {
  person: Person
  hh: Health
  people: Person[]
  bonds: PersonBond[]
  contacts: PersonContact[]
  today: string
  onClose: () => void
  onPatch: (patch: Partial<Pick<Person, 'name' | 'rel' | 'cadenceDays' | 'job' | 'birthday' | 'birthYear' | 'nameDayAs' | 'remindersOff'>>) => void
  onTier: (tier: PersonTier) => void
  onLog: (day: string, ch: ContactChannel) => void
  onUnlog: (id: string) => void
  onLink: (other: string, word: string) => void
  onLabel: (bondId: string, word: string) => void
  onUnlink: (bondId: string) => void
  onRemove: () => void
}) {
  const [day, setDay] = useState(today)
  const [armed, setArmed] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [linkTo, setLinkTo] = useState('')
  const [linkWord, setLinkWord] = useState('')
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 3000)
    return () => window.clearTimeout(t)
  }, [armed])
  useEffect(() => {
    if (!flash) return
    const t = window.setTimeout(() => setFlash(null), 2200)
    return () => window.clearTimeout(t)
  }, [flash])

  const linked = bonds
    .filter((b) => b.a === person.id || b.b === person.id)
    .map((b) => ({ bond: b, other: people.find((p) => p.id === (b.a === person.id ? b.b : b.a)) }))
    .filter((x): x is { bond: typeof x.bond; other: Person } => !!x.other)
  const unlinked = people.filter((p) => p.id !== person.id && !linked.some((l) => l.other.id === p.id))
  const history = [...contacts].sort((a, b) => (a.day === b.day ? b.createdAt - a.createdAt : a.day < b.day ? 1 : -1))
  const tracked = !person.remindersOff
  const colour = tracked ? colourOf(hh) : OFF_COLOUR
  const dueText = !tracked ? 'Reminders are off for them'
    : hh.days === null ? 'Log a first one'
      : hh.left < 0 ? `${-hh.left} days overdue`
        : hh.left === 0 ? 'Due today'
          : `Due in ${hh.left} days`
  const dueTone = !tracked ? '' : overdue(hh) ? 'is-alert' : hh.left <= 7 && hh.h <= 0.5 ? 'is-warn' : 'is-good'

  return (
    <div className="pp-card-scroll">
      <div className="pp-card-top">
        <span className="pp-card-av" style={{ background: colour }}>{initials(person.name)}</span>
        <div className="pp-card-names">
          <input className="pp-inline pp-in-name" value={person.name} aria-label="Name" onChange={(e) => onPatch({ name: e.target.value })} />
          <input className="pp-inline pp-in-rel" value={person.rel} aria-label="Who they are to you" placeholder="Who they are to you" onChange={(e) => onPatch({ rel: e.target.value })} />
        </div>
        <button className="pp-close" type="button" aria-label="Close" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </div>

      <div className="pp-health">
        {tracked && <div className="pp-health-big"><i style={{ background: colour, transform: `scaleX(${Math.max(0.001, hh.h)})` }} /></div>}
        <div className="pp-health-lines">
          <span className="pp-when">{sinceLabel(hh)}</span>
          <span className={`pp-due-txt ${dueTone}`}>{dueText}</span>
        </div>
        <label className="pp-remind-toggle">
          <input type="checkbox" checked={tracked} onChange={(e) => onPatch({ remindersOff: !e.target.checked })} />
          <span className="pp-remind-switch" aria-hidden="true" />
          Remind me to reach out
        </label>
      </div>

      <AboutPerson person={person} today={today} onPatch={onPatch} />

      <div className="pp-row2">
        <div className="pp-field"><span>Talk to them</span>
          <Select
            className="pp-dd" ariaLabel="How often to talk to them" value={person.cadenceDays} disabled={!tracked}
            onChange={(n) => onPatch({ cadenceDays: n })}
            options={[
              ...CADENCES.map(([n, l]) => ({ value: n, label: l })),
              ...(CADENCES.some(([n]) => n === person.cadenceDays) ? [] : [{ value: person.cadenceDays, label: `Every ${person.cadenceDays} days` }]),
            ]}
          />
        </div>
        <div className="pp-field"><span>Circle</span>
          <Select
            className="pp-dd" ariaLabel="Circle" value={person.tier}
            onChange={(t) => onTier(t)} options={TIERS.map((t) => ({ value: t.id, label: t.label }))}
          />
        </div>
      </div>

      <div className="pp-section">
        <h3>Log a contact</h3>
        <div className="pp-channels">
          {CHANNELS.map((c) => (
            <button
              key={c.id} type="button" className="pp-ch"
              onClick={() => { onLog(day || today, c.id); setFlash(`Logged: ${c.label.toLowerCase()}${day && day !== today ? `, ${fmtDay(day)}` : ''}`) }}
            >
              <ChannelIcon id={c.id} size={18} />{c.label}
            </button>
          ))}
        </div>
        <label className="pp-log-when">On
          <input type="date" className="pp-select pp-date" value={day} max={today} onChange={(e) => setDay(e.target.value)} />
        </label>
        <p className={`pp-flash${flash ? ' is-on' : ''}`} role="status" aria-live="polite">{flash ?? ''}</p>
      </div>

      <div className="pp-section">
        <h3>History</h3>
        {history.length === 0 && <p className="pp-muted">Nothing logged yet.</p>}
        {history.length > 0 && (
          <ul className="pp-history">
            {history.map((c) => (
              <li key={c.id}>
                <ChannelIcon id={c.channel} />
                <span className="pp-h-ch">{CHANNEL[c.channel].label}</span>
                <span className="pp-h-date">{fmtDay(c.day)}</span>
                <button className="pp-x" type="button" aria-label="Remove this entry" onClick={() => onUnlog(c.id)}>
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pp-section">
        <h3>Connected to</h3>
        {linked.length === 0 && <p className="pp-muted pp-mb">Only to you, so far.</p>}
        {linked.length > 0 && (
          <ul className="pp-links">
            {linked.map(({ bond, other }) => (
              <li key={bond.id}>
                <span className="pp-link-name">{other.name}</span>
                <span className="pp-link-is">is their</span>
                <BondWord
                  value={(bond.a === person.id ? bond.bToA : bond.aToB) ?? ''}
                  label={`What ${other.name} is to ${person.name}`}
                  onCommit={(w) => onLabel(bond.id, w)}
                />
                <button className="pp-x" type="button" aria-label={`Remove the link to ${other.name}`} onClick={() => onUnlink(bond.id)}>
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                </button>
              </li>
            ))}
          </ul>
        )}
        {unlinked.length > 0 && (
          <form
            className="pp-link-add"
            onSubmit={(e) => { e.preventDefault(); if (linkTo) { onLink(linkTo, linkWord); setLinkTo(''); setLinkWord('') } }}
          >
            <Select
              className="pp-dd pp-link-who" ariaLabel="Who to connect" value={linkTo} onChange={setLinkTo}
              options={[{ value: '', label: 'Connect someone' }, ...unlinked.map((p) => ({ value: p.id, label: p.name }))]}
            />
            <input
              className="pp-text" list="pp-rel-words" value={linkWord} placeholder="is their… brother, friend"
              aria-label={`What they are to ${person.name}`} onChange={(e) => setLinkWord(e.target.value)}
            />
            <button className="btn btn-primary" type="submit" disabled={!linkTo}>Connect</button>
          </form>
        )}
        <datalist id="pp-rel-words">{REL_WORDS.map((w) => <option key={w} value={w} />)}</datalist>
      </div>

      <button className={`pp-danger${armed ? ' is-armed' : ''}`} type="button" onClick={() => (armed ? onRemove() : setArmed(true))}>
        {armed ? `Click again to remove ${person.name}` : 'Remove from People'}
      </button>
    </div>
  )
}

function AddPerson({ onClose, onAdd }: { onClose: () => void; onAdd: (name: string, rel: string, tier: PersonTier, cadence: number) => void }) {
  const [name, setName] = useState('')
  const [rel, setRel] = useState('')
  const [tier, setTier] = useState<PersonTier>('friends')
  const [cadence, setCadence] = useState(TIER.friends.cadence)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="pp-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form
        className="pp-dialog"
        aria-label="Add a person"
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) onAdd(name.trim(), rel.trim(), tier, cadence) }}
      >
        <h2>Add a person</h2>
        <label className="pp-field">Name
          <input className="pp-text" autoFocus required value={name} placeholder="Their name" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="pp-field">Who they are to you
          <input className="pp-text" value={rel} placeholder="Brother, gym friend, accountant" onChange={(e) => setRel(e.target.value)} />
        </label>
        <div className="pp-row2">
          <div className="pp-field"><span>Circle</span>
            <Select
              className="pp-dd pp-add-circle" ariaLabel="Circle" value={tier}
              onChange={(t) => { setTier(t); setCadence(TIER[t].cadence) }}
              options={TIERS.map((t) => ({ value: t.id, label: t.label }))}
            />
          </div>
          <div className="pp-field"><span>Talk to them</span>
            <Select
              className="pp-dd" ariaLabel="How often to talk to them" value={cadence} onChange={setCadence}
              options={CADENCES.map(([n, l]) => ({ value: n, label: l }))}
            />
          </div>
        </div>
        <div className="pp-dialog-actions">
          <button className="btn btn-quiet" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" disabled={!name.trim()}>Add</button>
        </div>
      </form>
    </div>
  )
}

/* Saved when he leaves the field or presses Enter, so typing a word is not a
   synced write per keystroke. */
function BondWord({ value, label, onCommit, className = 'pp-inline pp-link-word', list = 'pp-rel-words', placeholder = 'add a word' }: {
  value: string; label: string; onCommit: (w: string) => void; className?: string; list?: string; placeholder?: string
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  const commit = () => { if (draft.trim() !== value) onCommit(draft.trim()) }
  return (
    <input
      className={className} list={list} value={draft} placeholder={placeholder} aria-label={label}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() } }}
    />
  )
}

/* Job, birthday and name day. The birthday is a day and a month, with the year
   only when he knows it; the name day follows the first name unless he says
   which calendar name it goes by. */
function AboutPerson({ person, today, onPatch }: {
  person: Person
  today: string
  onPatch: (patch: Partial<Pick<Person, 'job' | 'birthday' | 'birthYear' | 'nameDayAs'>>) => void
}) {
  const [bm, bd] = (person.birthday ?? '-').split('-')
  const [month, setMonth] = useState(bm ?? '')
  const [day, setDay] = useState(bd ?? '')
  useEffect(() => { const [m, d] = (person.birthday ?? '-').split('-'); setMonth(m ?? ''); setDay(d ?? '') }, [person.birthday])
  const setBirth = (m: string, d: string) => {
    setMonth(m); setDay(d)
    if (m && d) onPatch({ birthday: `${m}-${d}` })
    else if (!m && !d) onPatch({ birthday: undefined, birthYear: undefined })
  }
  const maxDay = month ? new Date(2024, Number(month), 0).getDate() : 31
  const bdays = person.birthday ? daysUntil(person.birthday, today) : null
  // The age on the next birthday: this year's if it has not passed yet, else next year's.
  const turning = person.birthday && person.birthYear
    ? Number(today.slice(0, 4)) + (person.birthday < today.slice(5) ? 1 : 0) - person.birthYear
    : null
  const nd = nameDayFor(person.name, person.nameDayAs)
  const ndays = nd ? daysUntil(nd.day, today) : null
  const first = person.name.trim().split(/\s+/)[0] ?? ''

  return (
    <div className="pp-section pp-about">
      <label className="pp-field">Job
        <BondWord
          value={person.job ?? ''} label="Job" className="pp-text" list="" placeholder="What they do"
          onCommit={(w) => onPatch({ job: w || undefined })}
        />
      </label>

      <div className="pp-field">
        <span>Birthday</span>
        <div className="pp-birth">
          <Select
            className="pp-dd" ariaLabel="Birthday day" value={day} onChange={(d) => setBirth(month, d)}
            options={[{ value: '', label: 'Day' }, ...Array.from({ length: maxDay }, (_, i) => String(i + 1).padStart(2, '0')).map((d) => ({ value: d, label: String(Number(d)) }))]}
          />
          <Select
            className="pp-dd" ariaLabel="Birthday month" value={month}
            onChange={(m) => setBirth(m, day && m && Number(day) > new Date(2024, Number(m), 0).getDate() ? '' : day)}
            options={[{ value: '', label: 'Month' }, ...MONTHS.map((m, i) => ({ value: String(i + 1).padStart(2, '0'), label: m }))]}
          />
          <input
            className="pp-text" inputMode="numeric" aria-label="Birth year, if you know it" placeholder="Year"
            defaultValue={person.birthYear ?? ''} key={person.birthYear ?? 'none'}
            onBlur={(e) => {
              const y = Number(e.target.value)
              const ok = Number.isInteger(y) && y > 1900 && y <= Number(today.slice(0, 4))
              if (!e.target.value.trim()) { if (person.birthYear) onPatch({ birthYear: undefined }) }
              else if (ok && y !== person.birthYear) onPatch({ birthYear: y })
              else if (!ok) e.target.value = person.birthYear ? String(person.birthYear) : ''
            }}
          />
        </div>
        {person.birthday && bdays !== null && (
          <span className={`pp-about-line${bdays <= 7 ? ' is-soon' : ''}`}>
            {turning !== null ? `Turns ${turning} on ${fmtMD(person.birthday)}` : fmtMD(person.birthday)}, {inDays(bdays)}
          </span>
        )}
      </div>

      <div className="pp-field">
        <span>Name day</span>
        {nd && ndays !== null
          ? <span className={`pp-about-line is-strong${ndays <= 7 ? ' is-soon' : ''}`}>{nd.name}, {fmtMD(nd.day)}, {inDays(ndays)}</span>
          : <span className="pp-about-line">{person.nameDayAs ? `"${person.nameDayAs}" is not in the Czech calendar` : `No name day for "${first}" in the Czech calendar`}</span>}
        <BondWord
          value={person.nameDayAs ?? ''} label="Name day goes by" className="pp-text" list="pp-cal-names"
          placeholder={nd && !person.nameDayAs ? `Goes by ${nd.name}` : 'Goes by, e.g. Veronika'}
          onCommit={(w) => onPatch({ nameDayAs: w || undefined })}
        />
        <datalist id="pp-cal-names">{ALL_NAMES.map((n) => <option key={n} value={n} />)}</datalist>
      </div>
    </div>
  )
}
