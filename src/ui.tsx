/* The component library. One location.

   These used to live in pages1.tsx, a three-thousand-line page file that every
   other page imported its primitives from, which is how the app ended up with
   eight row shells, seven chips, six section headings and five segmented
   controls: there was nowhere to put the second use of anything, so it was
   written again. Everything shared lives here now, and a page imports from
   here, never from another page.

   Rules for this file: no page-specific logic, no store reads beyond what a
   primitive genuinely needs, and one class per primitive with modifiers rather
   than a new class per call site. */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SPACE_LABELS } from './mock'
import { exceptionsFor } from './exceptions'
import { useStore } from './store'
import { isoWeekKey, localDateKey } from './util'
import type { SpaceId, Task } from './types'
import * as Icon from './icons'


/* A field that grows with what you type, up to a ceiling, then scrolls. Dragging
   a resize grip to see your own sentence is not a thing anyone should be doing. */
export function AutoTextarea({
  value, minRows = 3, maxRows = 18, className = '', onChange, ...rest
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'> & {
  value: string
  minRows?: number
  maxRows?: number
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const cs = getComputedStyle(el)
    const line = parseFloat(cs.lineHeight) || 20
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    const max = line * maxRows + pad
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [value, maxRows])

  return (
    <textarea
      {...rest}
      ref={ref}
      className={`autogrow ${className}`.trim()}
      rows={minRows}
      value={value}
      onChange={onChange}
    />
  )
}

/* A dropdown that opens upward when there is no room below it. Menus near the
   bottom of the page were opening off-screen with no way to reach the items. */
export function Dropdown({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const btn = ref.current?.getBoundingClientRect()
    const menu = ref.current?.querySelector('.kebab-menu') as HTMLElement | null
    if (btn && menu) {
      const need = menu.offsetHeight + 12
      setUp(btn.bottom + need > window.innerHeight && btn.top > need)
    }
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  return (
    <span className={`kebab-wrap ${className}`} ref={ref}>
      {/* Drawn, not typed. The midline-ellipsis character sits wherever the
          font puts it, which is why it never looked centred in a circle. */}
      <button className="kebab" aria-label={label} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon.More size={15} />
      </button>
      {open && (
        <div className={`kebab-menu${up ? ' opens-up' : ''}`} role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </span>
  )
}

/* No `sub`. A page title does not get a subtitle restating it.
   See DESIGN.md, "No subtitles". */

/* WHICH ROOM THIS CAME FROM.
   Only shown in All, where a row could be from any of the three. Two channels,
   because one of them cannot carry it alone: the three space hues measure
   between 3.7:1 and 4.4:1 on these surfaces, under the 4.5:1 a coloured word
   would need, so the hue is a 3px rule (which needs 3:1, and all three clear it)
   and the letter beside it is neutral --muted at 7.5:1. Colour is never the only
   thing saying it. The rule runs the full height of its row, so three Work rows
   in a row read as one navy stripe rather than three ticks. */
/** In All, a new thing has to land somewhere. This says where, next to the
 *  button that commits it, rather than as a field somewhere else on the page. */
export function WriteTo() {
  const { view, space, setSpace } = useStore()
  if (view !== 'all') return null
  return (
    <select
      className="textinput writeto" value={space} aria-label="Which profile this goes to"
      onChange={(e) => setSpace(e.target.value as SpaceId)}
    >
      {/* It sits where a filter sits and it is not one: it decides where a NEW
          thing gets written. Saying so in the option is cheaper than teaching
          him that "All" up top and "Personal" here are not contradicting each
          other. */}
      {(Object.keys(SPACE_LABELS) as SpaceId[]).map((s) => (
        <option key={s} value={s}>Add to {SPACE_LABELS[s]}</option>
      ))}
    </select>
  )
}

/** `always` is for a page that mixes workspaces even inside one workspace, like
 *  Routines: there the colour and the letter are the only thing telling two
 *  cards apart, so they cannot be tied to the All view. */
export function SpaceMark({ space, always }: { space?: SpaceId; always?: boolean }) {
  const { view } = useStore()
  if ((view !== 'all' && !always) || !space) return null
  return (
    <span className={`spacemark s-${space}`}>
      <i aria-hidden="true" />
      <b aria-hidden="true">{SPACE_LABELS[space][0]}</b>
      <span className="visually-hidden">{SPACE_LABELS[space]}</span>
    </span>
  )
}

export function Band({
  title, metrics, actions,
}: {
  title: string
  metrics?: { v: string; k: string; tone?: 'pos' | 'urgent' | 'info' }[]
  actions?: React.ReactNode
}) {
  return (
    <div className="band">
      <div className="band-day">
        <h1>{title}</h1>
      </div>
      <div className="band-status">
        {metrics?.map((m) => (
          <div className="band-metric" key={m.k}>
            <span className={`v${m.tone ? ' val-' + m.tone : ''}`}>{m.v}</span>
            <span className="k">{m.k}</span>
          </div>
        ))}
        {actions && <div className="band-actions">{actions}</div>}
      </div>
    </div>
  )
}

/* ---------------- the primitives that were being rewritten ---------------- */

/* An empty state. There were four of these: `.empty` (a padded block), a dashed
   `.bucket-empty`, a plain `.nt-none`, and a `NoData` dash. Two shapes is the
   honest count, so this is one component with a boxed variant.

   An empty screen is an invitation, so the text says what to do, not that there
   is nothing. That is on the call site: this only decides how it sits. */
export function Empty({ children, boxed = false, className = '' }: {
  children: React.ReactNode
  /** Dashed outline. For a slot that is waiting to be filled (a time of day,
   *  a column), rather than a section that simply has nothing in it yet. */
  boxed?: boolean
  className?: string
}) {
  return <div className={`empty${boxed ? ' is-boxed' : ''}${className ? ' ' + className : ''}`}>{children}</div>
}

/* A figure with no data behind it. A dash, never a zero: on this app's pages a
   zero is a claim ("you owe nothing", "you did none") and a dash is the truth
   ("nothing has been read"). */
export function NoData({ label }: { label: string }) {
  return <div className="kpi nodata">&mdash;<span className="unit">{label}</span></div>
}

/* A chip. Four of these existed: est-chip, src-tag, assist-tag and chip, all of
   them a small mono label on a wash. The tone is what actually differed, so the
   tone is the prop. */
export function Chip({ tone = 'info', title, className = '', children }: {
  tone?: 'info' | 'progress' | 'warn' | 'alert' | 'accent' | 'quiet'
  title?: string
  className?: string
  children: React.ReactNode
}) {
  return <span className={`chip tone-${tone}${className ? ' ' + className : ''}`} title={title}>{children}</span>
}

/* A section heading: a label, and optionally one fact on the right that appears
   nowhere else. Not a subtitle slot. Six of these were written separately. */
export function SectionHead({ label, fact, className = '' }: {
  label: string
  /** A count, a total, a state. If you cannot name the new fact it carries,
   *  leave it out. */
  fact?: React.ReactNode
  className?: string
}) {
  return (
    <div className={`sechead${className ? ' ' + className : ''}`}>
      <span className="microcap">{label}</span>
      {fact != null && <span className="sechead-fact mono">{fact}</span>}
    </div>
  )
}

/* A run of choices where exactly one is on. Five of these existed: `.seg`,
   the achievements tabs, the focus break lengths, the habit kind picker and
   Plan's today/tomorrow. They differ in size and in whether the choice carries
   a description, so those are the two props. */
export function Segmented<T extends string>({ value, options, onPick, size = 'md', label, className = '' }: {
  value: T
  options: { id: T; label: string; hint?: string; disabled?: boolean }[]
  onPick: (id: T) => void
  size?: 'sm' | 'md'
  label: string
  className?: string
}) {
  const hints = options.some((o) => o.hint)
  return (
    <div className={`seg seg-${size}${hints ? ' has-hints' : ''}${className ? ' ' + className : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          disabled={o.disabled}
          onClick={() => onPick(o.id)}
        >
          <b>{o.label}</b>
          {o.hint && <span>{o.hint}</span>}
        </button>
      ))}
    </div>
  )
}


/* Today's open list, the raw material both the auto pick below and the
   Zone's own "choose a task" picker draw from, so the two can never
   disagree about what is actually on today's list. */
export function useOpenToday(): Task[] {
  const { tasks, inView } = useStore()
  return tasks.filter((t) => inView(t.space) && t.list === 'today' && !t.done && (t.plannedOn ?? localDateKey()) === localDateKey())
}

/* The one thing to do next, on Today and in the Zone. Alerts first (a debt
   deadline beats everything), then whatever he pinned by hand, then the least
   dreaded of what is left. One derivation, so the two pages can never point
   at different tasks. */
export function useFirstMove(): Task | undefined {
  const { space, tasks, routines, plan, inView } = useStore()
  const exceptions = exceptionsFor(space, { tasks, routines })
  const open = useOpenToday()
  const DREAD_RANK = { admin: 0, call: 1, deep: 2, quick: 3 }
  const alertTaskTitles = new Set(exceptions.map((x) => x.task?.title).filter(Boolean) as string[])
  const alertRank = (t: Task) => (alertTaskTitles.has(t.title) ? 0 : 1)
  return (
    open.find((t) => alertTaskTitles.has(t.title)) ??
    tasks.find((t) => t.id === plan.firstMoveId && !t.done && inView(t.space)) ??
    [...open].sort((a, b) => alertRank(a) - alertRank(b) || DREAD_RANK[a.category] - DREAD_RANK[b.category])[0]
  )
}


/* The date and time, read once and re-rendered only when a shown value
   changes. Used by the clock widget and by the Zone's big centrepiece:
   one clock, so the two can never show a different minute. */
export interface ClockStamp { time: string; day: string; date: string; week: string }
function clockStamp(): ClockStamp {
  const d = new Date()
  return {
    time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    day: d.toLocaleDateString('en-GB', { weekday: 'long' }),
    date: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }),
    week: isoWeekKey().split('-W')[1],
  }
}
export function useClockStamp(): ClockStamp {
  const [now, setNow] = useState(clockStamp)
  useEffect(() => {
    const t = window.setInterval(() => {
      setNow((prev) => {
        const next = clockStamp()
        return next.time === prev.time && next.date === prev.date ? prev : next
      })
    }, 1000)
    return () => window.clearInterval(t)
  }, [])
  return now
}
