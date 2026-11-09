/* THE LINE ON THE DESKTOP (2026-11-05). Plan's middle column drawn hour by
   hour instead of as four parts of the day. He picked it from three placements
   (inside Plan, its own page, a widget) as a List / Line switch in Plan's
   toolbar that Plan remembers.

   Dragging is the browser's own drag, on purpose: the day pills above already
   spring open under a dragged task and the to-do column already takes a task
   back, so a task picked up here can go to Wednesday or back to the list with
   no extra code, and a to-do dragged in from the right lands on the Line the
   same way. Where it lands is worked out from the row under the pointer:
   above or below a task, or the matching minute of a free stretch. */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import * as Icon from './icons'
import { Linkify } from './widgets'
import { SLOTS, type Task } from './types'
import { isEstimated, taskMinutes, fmtDuration } from './util'
import { layoutDay, placeAt, toHM, type LineItem } from './line'

type Row = { id: string; at?: string; slot?: string; done: boolean; min: number; task: Task }
const DAY_START = 6 * 60
const hOf = (d: number) => Math.max(46, Math.min(240, Math.round(d * 0.8)))
/* The id of whatever the browser is dragging, from any column. dragover cannot
   read dataTransfer, and the length of the thing decides where it fits. */
let dragging: string | null = null

export function PlanLine({ day, all, isToday, hueStyle, tag, estimate, check, log, focus, steps, stepsToggle, flashId, onPlace, onAdd }: {
  day: Task[]
  all: Task[]
  isToday: boolean
  hueStyle: (t: Task) => CSSProperties | undefined
  tag: (t: Task) => ReactNode
  estimate: (t: Task) => ReactNode
  check: (t: Task) => void
  log: (t: Task) => ReactNode
  focus: (t: Task) => (() => void) | undefined
  /** The task's steps, drawn under its card when opened, and the toggle that opens them. */
  steps: (t: Task) => ReactNode
  stepsToggle: (t: Task) => ReactNode
  flashId: string | null
  onPlace: (id: string, writes: { id: string; at: string }[]) => void
  onAdd: (title: string, at: string) => void
}) {
  const [now, setNow] = useState(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() })
  useEffect(() => {
    const iv = window.setInterval(() => { const d = new Date(); setNow(d.getHours() * 60 + d.getMinutes()) }, 30000)
    return () => window.clearInterval(iv)
  }, [])
  const items = useMemo<LineItem<Row>[]>(() => layoutDay(
    day.map((t) => ({ id: t.id, at: t.at, slot: t.slot, done: t.done, min: isEstimated(t) ? taskMinutes(t) : 0, task: t })),
    isToday ? now : null,
  ), [day, isToday, now])
  const [tgt, setTgt] = useState<{ key: string; start: number; y?: number } | null>(null)
  const [adding, setAdding] = useState<number | null>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    const start = (e: DragEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-line-id],[data-todo-id],[data-task-id]') as HTMLElement | null
      dragging = el ? (el.dataset.lineId ?? el.dataset.todoId ?? el.dataset.taskId ?? null) : null
    }
    const end = () => { dragging = null; setTgt(null) }
    document.addEventListener('dragstart', start, true)
    document.addEventListener('dragend', end)
    return () => { document.removeEventListener('dragstart', start, true); document.removeEventListener('dragend', end) }
  }, [])
  const lenOf = (id: string) => {
    const it = items.find((x) => x.id === id)
    if (it) return it.d
    const t = all.find((x) => x.id === id)
    return t && isEstimated(t) && taskMinutes(t) > 0 ? taskMinutes(t) : 30
  }

  /* Blocks to draw: each task, then whatever sits between it and the next. A
     stretch under fifteen minutes is a join, not a gap: no prompt, still a
     place to drop. The day opens with the free time before the first task and
     closes with the free time to midnight, so both ends take a drop too. */
  type Block = { k: 'task'; it: LineItem<Row> } | { k: 'gap' | 'join'; s: number; e: number } | { k: 'slot'; id: string; label: string; hint: string }
  const raw: Block[] = []
  const first = items[0]
  const lead = isToday ? Math.max(DAY_START, Math.ceil(now / 15) * 15) : DAY_START
  if (!first) raw.push({ k: 'gap', s: lead, e: 24 * 60 })
  else if (first.s - lead >= 15) raw.push({ k: 'gap', s: lead, e: first.s })
  let reach = 0
  items.forEach((it, i) => {
    raw.push({ k: 'task', it })
    reach = Math.max(reach, it.s + it.d)
    const nx = items[i + 1]
    if (!nx) { if (24 * 60 - reach >= 15) raw.push({ k: 'gap', s: reach, e: 24 * 60 }); return }
    if (nx.s - reach >= 15) raw.push({ k: 'gap', s: reach, e: nx.s })
    else raw.push({ k: 'join', s: reach, e: Math.max(reach, nx.s) })
  })

  /* The day's parts (his ask, 2026-11-07: "no divider for noon, afternoon, evening"). A labelled divider
     opens each part that has anything in it, and a free stretch that runs across a boundary is cut there,
     so the divider sits at 12:00, 14:00 and 18:00 and not at the next task. */
  const cuts = SLOTS.slice(1).map((x) => x.from * 60)
  const spans: Block[] = []
  for (const b of raw) {
    if (b.k !== 'gap' && b.k !== 'join') { spans.push(b); continue }
    let from = b.s
    for (const c of cuts) if (c > from && c < b.e) { spans.push({ k: b.k, s: from, e: c }); from = c }
    spans.push({ k: b.k, s: from, e: b.e })
  }
  const startOf = (b: Block) => (b.k === 'task' ? b.it.s : b.k === 'slot' ? 0 : b.s)
  const slotAt = (m: number) => [...SLOTS].reverse().find((x) => m >= x.from * 60) ?? SLOTS[0]
  const blocks: Block[] = []
  let lastSlot = ''
  for (const b of spans) {
    const sl = slotAt(startOf(b))
    if (sl.id !== lastSlot) { blocks.push({ k: 'slot', id: sl.id, label: sl.label, hint: sl.hint }); lastSlot = sl.id }
    blocks.push(b)
  }

  const where = (e: React.DragEvent): { key: string; start: number; y?: number } | null => {
    const row = (e.target as Element).closest('[data-slot]') as HTMLElement | null
    if (!row) return null
    const r = row.getBoundingClientRect(), p = (e.clientY - r.top) / Math.max(1, r.height)
    const s = Number(row.dataset.s), en = Number(row.dataset.e), key = row.dataset.key!
    if (row.dataset.slot === 'join') return { key, start: s, y: 0.5 }
    if (row.dataset.slot === 'gap') {
      const d = dragging ? lenOf(dragging) : 30
      let st = s + Math.round((p * (en - s)) / 15) * 15
      st = Math.max(s, Math.min(st, Math.max(s, en - d)))
      return { key, start: st, y: (st - s) / Math.max(1, en - s) }
    }
    if (row.dataset.lineId === dragging) return null
    return p < 0.5 ? { key, start: s, y: 0 } : { key, start: en, y: 1 }
  }
  const drop = (e: React.DragEvent) => {
    const w = where(e)
    const id = e.dataTransfer.getData('text/plain') || dragging
    setTgt(null)
    if (!w || !id) return
    e.preventDefault(); e.stopPropagation()
    onPlace(id, placeAt(items, id, w.start, lenOf(id)))
  }
  const pushes = tgt && dragging ? items.some((x) => x.id !== dragging && x.s >= tgt.start && x.s < tgt.start + lenOf(dragging!)) : false

  const nowAt = (s: number, e: number) => (isToday && now >= s && now < e ? (now - s) / Math.max(1, e - s) : null)
  /* `px` pins the line to the task's own bar height, so opening its steps (a taller row) never moves it. */
  const nowLine = (p: number | null, px?: number) => (p == null ? null : (
    <div className="pl-now" style={{ top: px ? `${p * px}px` : `${p * 100}%` }} aria-label={`Now, ${toHM(now)}`}><span>{toHM(now)}</span></div>
  ))
  const mark = (key: string, y?: number) => (tgt?.key === key ? (
    <div className="pl-drop" style={{ top: `${(y ?? tgt.y ?? 0) * 100}%` }}><span>{toHM(tgt.start)}{pushes ? ', pushes the rest later' : ''}</span></div>
  ) : null)
  const submit = (at: number) => {
    const v = draft.trim()
    if (!v) { setAdding(null); return }
    onAdd(v, toHM(at)); setDraft(''); setAdding(null)
  }

  return (
    <div
      className="pl"
      onDragOver={(e) => { const w = where(e); if (w) { e.preventDefault(); e.stopPropagation(); if (!tgt || tgt.key !== w.key || tgt.start !== w.start) setTgt(w) } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setTgt(null) }}
      onDrop={drop}
    >
      {blocks.map((b) => {
        if (b.k === 'slot') return (
          <div key={`slot-${b.id}`} className="pl-slot" role="separator" aria-label={`${b.label}, ${b.hint}`}>
            <b>{b.label}</b><span>{b.hint}</span><i aria-hidden="true" />
          </div>
        )
        if (b.k === 'task') {
          const { it } = b, t = it.t.task, e = it.s + it.d, H = hOf(it.d), key = `t-${it.id}`
          const live = isToday && !t.done && now >= it.s && now < e
          const pct = live ? ((now - it.s) / it.d) * 100 : 0
          const go = !t.done && isToday ? focus(t) : undefined
          return (
            <div key={key} data-slot="task" data-key={key} data-s={it.s} data-e={e} data-line-id={it.id} data-task-id={it.id}
              className={`pl-row pl-task${t.done ? ' is-done' : ''}${it.pinned ? '' : ' is-flex'}${live ? ' is-live' : ''}${flashId === t.id ? ' flash' : ''}`}
              style={hueStyle(t)} draggable={!t.done}
              onDragStart={(ev) => { ev.dataTransfer.setData('text/plain', it.id); ev.dataTransfer.effectAllowed = 'move' }}>
              <div className="pl-tc" style={{ height: H }}><span>{toHM(it.s)}</span></div>
              <div className="pl-rail"><i className="pl-bar" style={{ height: H, ...(live ? { '--p': `${pct}%` } as CSSProperties : {}) }} /></div>
              <div className="pl-card" style={{ minHeight: H }}>
                <button className="checkbox" role="checkbox" aria-checked={t.done}
                  aria-label={t.done ? `Reopen: ${t.title}` : `Complete: ${t.title}`} onClick={() => check(t)}>
                  <Icon.Check size={12} strokeWidth={4} />
                </button>
                <div className="pl-txt">
                  <b><Linkify text={t.title} /></b>
                  <span className="pl-meta">
                    {tag(t)}
                    <span>{toHM(it.s)} to {toHM(e)}, {it.guess ? 'no estimate yet' : fmtDuration(it.d)}</span>
                    {stepsToggle(t)}
                    {!it.pinned && !t.done && <span className="pl-flex" title="No set time. It moves with the day until you drag it somewhere.">Flexible</span>}
                    {live && <span className="pl-left">{fmtDuration(e - now)} left</span>}
                  </span>
                </div>
                {go && (
                  <button className="pl-focus" disabled={!isEstimated(t)} onClick={go}
                    aria-label={`Focus on ${t.title}`} title={isEstimated(t) ? `Focus ${fmtDuration(taskMinutes(t))} on this` : 'Estimating...'}>
                    <Icon.Play size={14} /> Focus
                  </button>
                )}
                {estimate(t)}
              </div>
              {steps(t) && <div className="pl-steps">{steps(t)}</div>}
              {nowLine(live ? pct / 100 : null, H)}
              {mark(key)}
              {log(t)}
            </div>
          )
        }
        const key = `${b.k}-${b.s}`
        if (b.k === 'join') return (
          <div key={key} data-slot="join" data-key={key} data-s={b.s} data-e={b.e} className="pl-row pl-join">
            <div /><div className="pl-rail" /><div />
            {mark(key, 0.5)}
          </div>
        )
        /* Free time already gone today is drawn, never offered. */
        const gone = isToday && now >= b.e
        const from = isToday && now > b.s && !gone ? Math.ceil(now / 5) * 5 : b.s
        const len = b.e - from
        if (gone) return (
          <div key={key} className="pl-row pl-gap is-gone"><div className="pl-tc" /><div className="pl-rail" /><div className="pl-gapc"><span>Free {fmtDuration(b.e - b.s)}</span></div></div>
        )
        return (
          <div key={key} data-slot="gap" data-key={key} data-s={from} data-e={b.e} className={`pl-row pl-gap${tgt?.key === key ? ' is-over' : ''}`}>
            <div className="pl-tc" />
            <div className="pl-rail" />
            <div className="pl-gapc">
              {adding === from ? (
                <form className="pl-add" onSubmit={(e) => { e.preventDefault(); submit(from) }}>
                  <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => submit(from)}
                    onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(''); setAdding(null) } }}
                    placeholder={`What goes at ${toHM(from)}?`} aria-label={`New task at ${toHM(from)}`} />
                </form>
              ) : (
                <>
                  <span>Free <b>{fmtDuration(len)}</b>{b.e === 24 * 60 ? ' until midnight' : ''}</span>
                  <button className="pl-addb" onClick={() => { setDraft(''); setAdding(from) }}><Icon.Plus size={14} /> Add at {toHM(from)}</button>
                </>
              )}
            </div>
            {nowLine(nowAt(b.s, b.e))}
            {mark(key)}
          </div>
        )
      })}
    </div>
  )
}
