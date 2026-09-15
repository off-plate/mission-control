/* THE IDEAS BOARD. Projects he has in mind and no time for yet, as stickies
   on a board he can pan, zoom and rearrange however he thinks about them.

   Three ways to put one down, all ending in the same prompt (name first, a line
   about it if he wants, both typeable or dictated):
     - drag a sticky off the pad and drop it where it belongs,
     - Add idea, which puts it in the middle of what he is looking at,
     - double-click anywhere on the board.

   Dragging only writes to the store when the sticky is let go. Every write is
   a full save of the synced blob, and a drag is sixty of them a second.

   Where he is looking (pan and zoom) is per device and never synced: the phone
   and the ultrawide do not want the same view of the same board. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { useStore } from './store'
import type { IdeaCard } from './types'
import { IDEA_H, IDEA_W } from './store/ideaboard'
import { IDEA_COLORS, ideaBg, MicButton, useFieldDictation } from './ideasdock'
import * as Icon from './icons'

type View = { x: number; y: number; z: number }
const VIEW_KEY = 'mc-ideaboard-view'
const Z_MIN = 0.3
const Z_MAX = 2
const clampZ = (z: number) => Math.min(Z_MAX, Math.max(Z_MIN, z))
const HOME: View = { x: 64, y: 112, z: 1 }

function readView(): View | null {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as View | null
    return v && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number' ? { x: v.x, y: v.y, z: clampZ(v.z) } : null
  } catch { return null }
}

type Draft = { mode: 'new'; x: number; y: number; color: string } | { mode: 'edit'; id: string }

/* A degree or so either way, always the same for the same sticky, so the board
   reads as paper rather than a spreadsheet. Straightens while it is held. */
function tilt(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return ((Math.abs(h) % 25) - 12) / 10
}

const dayLabel = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export function IdeasPage() {
  const { ideaBoard, addIdeaCard, updateIdeaCard, deleteIdeaCard } = useStore()
  const boardRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>(() => readView() ?? HOME)
  const viewRef = useRef(view)
  viewRef.current = view
  const [panning, setPanning] = useState(false)
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null)
  const [spawn, setSpawn] = useState<{ color: string; cx: number; cy: number } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)

  const rect = () => boardRef.current?.getBoundingClientRect() ?? new DOMRect()
  const toWorld = (cx: number, cy: number) => {
    const r = rect()
    const v = viewRef.current
    return { x: (cx - r.left - v.x) / v.z, y: (cy - r.top - v.y) / v.z }
  }
  const zoomAt = (cx: number, cy: number, factor: number) => setView((v) => {
    const r = rect()
    const z = clampZ(v.z * factor)
    const px = cx - r.left
    const py = cy - r.top
    return { z, x: px - ((px - v.x) / v.z) * z, y: py - ((py - v.y) / v.z) * z }
  })
  const zoomCenter = (factor: number) => { const r = rect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor) }

  const fit = () => {
    const r = rect()
    if (!r.width || !ideaBoard.length) { setView(HOME); return }
    const minX = Math.min(...ideaBoard.map((c) => c.x))
    const minY = Math.min(...ideaBoard.map((c) => c.y))
    const w = Math.max(...ideaBoard.map((c) => c.x + IDEA_W)) - minX
    const h = Math.max(...ideaBoard.map((c) => c.y + IDEA_H)) - minY
    const side = 64
    const top = 104 // clear of the toolbar
    /* On a phone, fitting a real backlog would shrink every sticky past reading.
       Past this floor it stays legible and he pans for the rest. */
    const floor = r.width < 640 ? 0.6 : Z_MIN
    const z = clampZ(Math.max(floor, Math.min(1, (r.width - side * 2) / w, (r.height - top - side) / h)))
    setView({ z, x: (r.width - w * z) / 2 - minX * z, y: top + (r.height - top - side - h * z) / 2 - minY * z })
  }

  /* First visit with ideas already on the board: show all of them rather than
     whatever corner the origin happens to be. */
  useLayoutEffect(() => {
    if (!readView() && ideaBoard.length) fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)) } catch { /* private mode */ } }, 250)
    return () => window.clearTimeout(t)
  }, [view])

  /* Wheel is attached by hand because React's is passive, and a board that also
     scrolls the page underneath it is not a board. Trackpad two-finger = pan,
     pinch (which browsers send as ctrl+wheel) or cmd/ctrl+wheel = zoom. */
  useEffect(() => {
    const el = boardRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.ib-scrim')) return
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01))
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---- panning the empty board ---- */
  const pan = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null)
  const isBackground = (t: EventTarget) => t === boardRef.current || (t as HTMLElement).classList?.contains('ib-world')
  const onBoardDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (draft || e.button !== 0 || !isBackground(e.target)) return
    pan.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y }
    e.currentTarget.setPointerCapture(e.pointerId)
    setPanning(true)
  }
  const onBoardMove = (e: RPointerEvent<HTMLDivElement>) => {
    const p = pan.current
    if (!p) return
    setView((v) => ({ ...v, x: p.vx + e.clientX - p.px, y: p.vy + e.clientY - p.py }))
  }
  const onBoardUp = () => { pan.current = null; setPanning(false) }
  const onBoardDouble = (e: React.MouseEvent<HTMLDivElement>) => {
    if (draft || !isBackground(e.target)) return
    const p = toWorld(e.clientX, e.clientY)
    setDraft({ mode: 'new', x: p.x - IDEA_W / 2, y: p.y - 24, color: 'amber' })
  }

  /* ---- moving a sticky ---- */
  const held = useRef<{ id: string; px: number; py: number; ox: number; oy: number; moved: boolean } | null>(null)
  const heldTo = (e: RPointerEvent) => {
    const d = held.current!
    const z = viewRef.current.z
    return { x: d.ox + (e.clientX - d.px) / z, y: d.oy + (e.clientY - d.py) / z }
  }
  const onCardDown = (e: RPointerEvent<HTMLDivElement>, c: IdeaCard) => {
    if (draft || e.button !== 0) return
    e.stopPropagation()
    held.current = { id: c.id, px: e.clientX, py: e.clientY, ox: c.x, oy: c.y, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onCardMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = held.current
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.px, e.clientY - d.py) < 4) return
    d.moved = true
    setDrag({ id: d.id, ...heldTo(e) })
  }
  const onCardUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = held.current
    if (!d) return
    const to = heldTo(e)
    held.current = null
    setDrag(null)
    // A press that never moved is a click: open it.
    if (d.moved) updateIdeaCard(d.id, to)
    else setDraft({ mode: 'edit', id: d.id })
  }
  const onCardCancel = () => { held.current = null; setDrag(null) }

  /* ---- a new sticky off the pad ---- */
  const tearing = useRef<{ color: string; px: number; py: number; moved: boolean } | null>(null)
  /* Dropped in the middle of the view, nudged off anything already sitting
     there so it is not hidden under another sticky. */
  const newAtCenter = (color = 'amber') => {
    const r = rect()
    const p = toWorld(r.left + r.width / 2, r.top + r.height / 2)
    let x = p.x - IDEA_W / 2
    let y = p.y - IDEA_H / 2
    for (let i = 0; i < 24 && ideaBoard.some((c) => Math.abs(c.x - x) < 40 && Math.abs(c.y - y) < 40); i++) { x += 32; y += 32 }
    setDraft({ mode: 'new', x, y, color })
  }
  const onPadDown = (e: RPointerEvent<HTMLButtonElement>, color: string) => {
    if (draft || e.button !== 0) return
    e.stopPropagation()
    tearing.current = { color, px: e.clientX, py: e.clientY, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPadMove = (e: RPointerEvent<HTMLButtonElement>) => {
    const s = tearing.current
    if (!s) return
    if (!s.moved && Math.hypot(e.clientX - s.px, e.clientY - s.py) < 4) return
    s.moved = true
    setSpawn({ color: s.color, cx: e.clientX, cy: e.clientY })
  }
  const onPadUp = (e: RPointerEvent<HTMLButtonElement>) => {
    const s = tearing.current
    tearing.current = null
    setSpawn(null)
    if (!s) return
    if (!s.moved) { newAtCenter(s.color); return }
    const r = rect()
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    const onBar = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('.ib-bar, .ib-zoom')
    if (!inside || onBar) return
    const p = toWorld(e.clientX, e.clientY)
    setDraft({ mode: 'new', x: p.x - IDEA_W / 2, y: p.y - 20, color: s.color })
  }
  const onPadCancel = () => { tearing.current = null; setSpawn(null) }

  const sorted = useMemo(() => [...ideaBoard].sort((a, b) => a.updatedAt - b.updatedAt), [ideaBoard])
  const editing = draft?.mode === 'edit' ? ideaBoard.find((c) => c.id === draft.id) : undefined
  // Deleted on another device while open here: nothing left to edit.
  useEffect(() => { if (draft?.mode === 'edit' && !editing) setDraft(null) }, [draft, editing])

  const br = spawn ? rect() : null
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  return (
    <div className="ib-page">
      <div
        ref={boardRef}
        className={`ib-board${panning ? ' is-panning' : ''}`}
        style={{ backgroundSize: `${24 * view.z}px ${24 * view.z}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
        onPointerDown={onBoardDown}
        onPointerMove={onBoardMove}
        onPointerUp={onBoardUp}
        onPointerCancel={onBoardUp}
        onDoubleClick={onBoardDouble}
      >
        <div className="ib-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
          {sorted.map((c) => {
            const held = drag?.id === c.id
            const pos = held ? drag : c
            return (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                className={`ib-card${held ? ' is-dragging' : ''}`}
                style={{ transform: `translate(${pos.x}px, ${pos.y}px) rotate(${held ? 0 : tilt(c.id)}deg)`, background: ideaBg(c.color) }}
                onPointerDown={(e) => onCardDown(e, c)}
                onPointerMove={onCardMove}
                onPointerUp={onCardUp}
                onPointerCancel={onCardCancel}
                onDoubleClick={stop}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDraft({ mode: 'edit', id: c.id }) } }}
                aria-label={`${c.title}. Enter to edit.`}
              >
                <h3 className="ib-card-title">{c.title}</h3>
                {c.body && <p className="ib-card-body">{c.body}</p>}
                <span className="ib-card-date">{dayLabel(c.createdAt)}</span>
              </div>
            )
          })}
          {draft?.mode === 'new' && (
            <div className="ib-card is-pending" style={{ transform: `translate(${draft.x}px, ${draft.y}px)`, background: ideaBg(draft.color) }} aria-hidden="true" />
          )}
        </div>

        {!ideaBoard.length && !draft && !spawn && (
          <div className="ib-empty">
            <p className="ib-empty-h">Nothing parked here yet.</p>
            <p>Drag a sticky off the pad, press Add idea, or double-click anywhere on the board.</p>
          </div>
        )}

        <div className="ib-bar" onPointerDown={stop} onDoubleClick={stop}>
          <div className="ib-bar-head">
            <h1 className="ib-h1">Ideas</h1>
            <span className="ib-count">{ideaBoard.length}</span>
          </div>
          <div className="ib-pad" title="Drag a sticky onto the board">
            {IDEA_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                className="ib-pad-note"
                style={{ background: c.bg }}
                aria-label={`New ${c.label.toLowerCase()} sticky`}
                onPointerDown={(e) => onPadDown(e, c.id)}
                onPointerMove={onPadMove}
                onPointerUp={onPadUp}
                onPointerCancel={onPadCancel}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); newAtCenter(c.id) } }}
              />
            ))}
          </div>
          <button type="button" className="btn btn-primary ib-add" onClick={() => newAtCenter()}>
            <Icon.Plus size={15} />
            Add idea
          </button>
        </div>

        <div className="ib-zoom" onPointerDown={stop} onDoubleClick={stop}>
          <button type="button" className="ib-zbtn" onClick={() => zoomCenter(1 / 1.2)} aria-label="Zoom out"><Icon.Minus size={14} /></button>
          <button type="button" className="ib-zbtn ib-zpct" onClick={() => zoomCenter(1 / view.z)} aria-label="Reset zoom to 100%">{Math.round(view.z * 100)}%</button>
          <button type="button" className="ib-zbtn" onClick={() => zoomCenter(1.2)} aria-label="Zoom in"><Icon.Plus size={14} /></button>
          <button type="button" className="ib-zbtn" onClick={fit} aria-label="Fit every idea in view">Fit</button>
        </div>

        {spawn && br && (
          <div
            className="ib-ghost"
            style={{
              left: spawn.cx - br.left - (IDEA_W * view.z) / 2, top: spawn.cy - br.top - 20 * view.z,
              width: IDEA_W * view.z, height: IDEA_H * view.z, background: ideaBg(spawn.color),
            }}
            aria-hidden="true"
          />
        )}
      </div>

      {draft && (draft.mode === 'new' || editing) && (
        <Composer
          key={draft.mode === 'edit' ? draft.id : `new-${draft.x}-${draft.y}`}
          isNew={draft.mode === 'new'}
          initial={editing
            ? { title: editing.title, body: editing.body, color: editing.color }
            : { title: '', body: '', color: draft.mode === 'new' ? draft.color : 'amber' }}
          onSave={(v) => {
            if (draft.mode === 'new') addIdeaCard({ ...v, x: draft.x, y: draft.y })
            else updateIdeaCard(draft.id, v)
            setDraft(null)
          }}
          onDelete={draft.mode === 'edit' ? () => { deleteIdeaCard(draft.id); setDraft(null) } : undefined}
          onClose={() => setDraft(null)}
        />
      )}
    </div>
  )
}

type Values = { title: string; body: string; color: string }

function Composer({ initial, isNew, onSave, onDelete, onClose }: {
  initial: Values
  isNew: boolean
  onSave: (v: Values) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(initial.title)
  const [body, setBody] = useState(initial.body)
  const [color, setColor] = useState(initial.color)
  const dict = useFieldDictation<'title' | 'body'>()
  const titleRef = useRef<HTMLInputElement>(null)
  useEffect(() => { titleRef.current?.focus() }, [])

  const save = () => {
    if (!title.trim()) { titleRef.current?.focus(); return }
    dict.stopAll()
    onSave({ title, body, color })
  }
  const close = () => { dict.stopAll(); onClose() }

  return (
    <div className="ib-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <form
        className="ib-composer"
        style={{ ['--ib-paper' as string]: ideaBg(color) }}
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? 'New idea' : 'Edit idea'}
        onSubmit={(e) => { e.preventDefault(); save() }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); close() } }}
      >
        <h2 className="ib-composer-h">{isNew ? 'New idea' : 'Edit idea'}</h2>
        <div className="ib-field">
          <input
            ref={titleRef}
            className="ib-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What’s the idea?"
            aria-label="Idea name"
            maxLength={140}
          />
          <MicButton on={dict.owner === 'title'} busy={dict.state === 'transcribing'} label="Dictate the name" onClick={() => dict.start('title', title, setTitle)} />
        </div>
        <div className="ib-field">
          <textarea
            className="ib-body-input"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="A line or two about it, if you want"
            aria-label="Notes about the idea"
            rows={4}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save() } }}
          />
          <MicButton on={dict.owner === 'body'} busy={dict.state === 'transcribing'} label="Dictate the notes" onClick={() => dict.start('body', body, setBody)} />
        </div>
        <div className="ib-swatches" role="radiogroup" aria-label="Colour">
          {IDEA_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={color === c.id}
              aria-label={c.label}
              className={`ib-swatch${color === c.id ? ' is-on' : ''}`}
              style={{ background: c.bg }}
              onClick={() => setColor(c.id)}
            />
          ))}
        </div>
        <div className="ib-actions">
          {onDelete && <button type="button" className="btn btn-ghost ib-delete" onClick={() => { dict.stopAll(); onDelete() }}>Delete</button>}
          <span className="ib-actions-grow" />
          <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!title.trim()}>{isNew ? 'Add idea' : 'Save'}</button>
        </div>
      </form>
    </div>
  )
}
