/* THE IDEAS BOARD. Projects he has in mind and no time for yet, as stickies
   on a board he can pan, zoom and rearrange however he thinks about them.

   Ways to put one down, all ending in the same prompt (name first, a line about
   it if he wants, both typeable or dictated):
     - click a sticky on the pad to pick it up, then click where it goes,
     - or hold it and drag it there,
     - Add idea, which puts it in the middle of what he is looking at,
     - double-click anywhere on the board.

   Click-to-drop exists because hold-and-drag is not something every pointer
   can do reliably. His report (2026-09-15): the sticky would not let go, and
   there was "no drop button". A trackpad with drag lock or three-finger drag
   holds the press after the fingers lift, so a drop that depends on a release
   waits for a release that never comes. A click is a drop on anything.

   The same report is why no drag can stay stuck: a lost pointer capture sets
   the sticky down where it was, and Escape puts it back.

   Dragging only writes to the store when the sticky is let go. Every write is
   a full save of the synced blob, and a drag is sixty of them a second.

   Where he is looking (pan and zoom) and whether the list is open are per
   device and never synced: the phone and the ultrawide do not want the same
   view of the same board. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { useStore } from './store'
import type { IdeaCard } from './types'
import { IDEA_H, IDEA_W } from './store/ideaboard'
import { IDEA_COLORS, ideaBg, MicButton, useFieldDictation } from './ideasdock'
import * as Icon from './icons'

type View = { x: number; y: number; z: number }
const VIEW_KEY = 'mc-ideaboard-view'
const LIST_KEY = 'mc-ideaboard-list'
const Z_MIN = 0.3
const Z_MAX = 2
const clampZ = (z: number) => Math.min(Z_MAX, Math.max(Z_MIN, z))
const HOME: View = { x: 64, y: 112, z: 1 }
/** What the open list takes off the right edge, so "the middle of the view"
 *  is the middle of the part of the board he can actually see. */
const LIST_W = 272

function readView(): View | null {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as View | null
    return v && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number' ? { x: v.x, y: v.y, z: clampZ(v.z) } : null
  } catch { return null }
}
function readListOpen(): boolean {
  try {
    const v = localStorage.getItem(LIST_KEY)
    if (v === '1') return true
    if (v === '0') return false
  } catch { /* private mode */ }
  return window.innerWidth >= 900
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
  /** The colour of a sticky picked up off the pad with a click, waiting for the click that puts it down. */
  const [carry, setCarry] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [listOpen, setListOpen] = useState(readListOpen)
  const [flash, setFlash] = useState<string | null>(null)
  const flight = useRef<number | null>(null)
  const flashTimer = useRef<number | undefined>(undefined)

  const rect = () => boardRef.current?.getBoundingClientRect() ?? new DOMRect()
  const toWorld = (cx: number, cy: number) => {
    const r = rect()
    const v = viewRef.current
    return { x: (cx - r.left - v.x) / v.z, y: (cy - r.top - v.y) / v.z }
  }
  /* Anything he does to the view himself wins over a flight still in the air. */
  const land = () => { if (flight.current !== null) { cancelAnimationFrame(flight.current); flight.current = null } }
  const zoomAt = (cx: number, cy: number, factor: number) => {
    land()
    setView((v) => {
      const r = rect()
      const z = clampZ(v.z * factor)
      const px = cx - r.left
      const py = cy - r.top
      return { z, x: px - ((px - v.x) / v.z) * z, y: py - ((py - v.y) / v.z) * z }
    })
  }
  const zoomCenter = (factor: number) => { const r = rect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor) }

  const fit = () => {
    land()
    const r = rect()
    if (!r.width || !ideaBoard.length) { setView(HOME); return }
    const minX = Math.min(...ideaBoard.map((c) => c.x))
    const minY = Math.min(...ideaBoard.map((c) => c.y))
    const w = Math.max(...ideaBoard.map((c) => c.x + IDEA_W)) - minX
    const h = Math.max(...ideaBoard.map((c) => c.y + IDEA_H)) - minY
    const side = 64
    const top = 104 // clear of the toolbar
    const usable = r.width - (listOpen && r.width >= 640 ? LIST_W : 0)
    /* On a phone, fitting a real backlog would shrink every sticky past reading.
       Past this floor it stays legible and he pans for the rest. */
    const floor = r.width < 640 ? 0.6 : Z_MIN
    const z = clampZ(Math.max(floor, Math.min(1, (usable - side * 2) / w, (r.height - top - side) / h)))
    setView({ z, x: (usable - w * z) / 2 - minX * z, y: top + (r.height - top - side - h * z) / 2 - minY * z })
  }

  /* The list's whole job: one click and the board is looking at that sticky,
     at a zoom it can be read at, and it flashes so the eye lands on it. */
  const flyTo = (c: IdeaCard) => {
    land()
    const r = rect()
    const from = viewRef.current
    const z = clampZ(Math.max(from.z, 0.8))
    const wide = r.width >= 640
    const usable = r.width - (listOpen && wide ? LIST_W : 0)
    const to: View = { z, x: usable / 2 - (c.x + IDEA_W / 2) * z, y: r.height / 2 - (c.y + IDEA_H / 2) * z }
    if (!wide) setListOpen(false) // on a phone the list sits over the board
    const arrive = () => {
      flight.current = null
      setFlash(c.id)
      window.clearTimeout(flashTimer.current)
      flashTimer.current = window.setTimeout(() => setFlash(null), 1800)
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setView(to); arrive(); return }
    const t0 = performance.now()
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 480)
      const e = 1 - Math.pow(1 - k, 3)
      setView({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, z: from.z + (to.z - from.z) * e })
      if (k < 1) flight.current = requestAnimationFrame(step)
      else arrive()
    }
    flight.current = requestAnimationFrame(step)
  }
  useEffect(() => () => { land(); window.clearTimeout(flashTimer.current) }, [])

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
  useEffect(() => { try { localStorage.setItem(LIST_KEY, listOpen ? '1' : '0') } catch { /* private mode */ } }, [listOpen])

  /* Wheel is attached by hand because React's is passive, and a board that also
     scrolls the page underneath it is not a board. Trackpad two-finger = pan,
     pinch (which browsers send as ctrl+wheel) or cmd/ctrl+wheel = zoom. The
     list keeps its own scroll. */
  useEffect(() => {
    const el = boardRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.ib-scrim, .ib-list')) return
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01))
      else { land(); setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY })) }
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
    land()
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
    if (draft || carry || !isBackground(e.target)) return
    const p = toWorld(e.clientX, e.clientY)
    setDraft({ mode: 'new', x: p.x - IDEA_W / 2, y: p.y - 24, color: 'amber' })
  }

  /* ---- moving a sticky ---- */
  const held = useRef<{ id: string; px: number; py: number; ox: number; oy: number; lx: number; ly: number; moved: boolean } | null>(null)
  const heldTo = (e: { clientX: number; clientY: number }) => {
    const d = held.current!
    const z = viewRef.current.z
    return { x: d.ox + (e.clientX - d.px) / z, y: d.oy + (e.clientY - d.py) / z }
  }
  const onCardDown = (e: RPointerEvent<HTMLDivElement>, c: IdeaCard) => {
    if (draft || e.button !== 0) return
    e.stopPropagation()
    land()
    held.current = { id: c.id, px: e.clientX, py: e.clientY, ox: c.x, oy: c.y, lx: c.x, ly: c.y, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onCardMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = held.current
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.px, e.clientY - d.py) < 4) return
    d.moved = true
    const to = heldTo(e)
    d.lx = to.x
    d.ly = to.y
    setDrag({ id: d.id, ...to })
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
  /* The release never arrived (the browser took the pointer back): set it
     down where it last was rather than leave it stuck to nothing. */
  const onCardLost = () => {
    const d = held.current
    if (!d) return
    held.current = null
    setDrag(null)
    if (d.moved) updateIdeaCard(d.id, { x: d.lx, y: d.ly })
  }
  useEffect(() => {
    if (!drag) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { held.current = null; setDrag(null) } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [drag])

  /* ---- a new sticky off the pad ---- */
  const tearing = useRef<{ color: string; px: number; py: number; moved: boolean } | null>(null)
  /* Dropped in the middle of the view, nudged off anything already sitting
     there so it is not hidden under another sticky. */
  const newAtCenter = (color = 'amber') => {
    const r = rect()
    const usable = r.width - (listOpen && r.width >= 640 ? LIST_W : 0)
    const p = toWorld(r.left + usable / 2, r.top + r.height / 2)
    let x = p.x - IDEA_W / 2
    let y = p.y - IDEA_H / 2
    for (let i = 0; i < 24 && ideaBoard.some((c) => Math.abs(c.x - x) < 40 && Math.abs(c.y - y) < 40); i++) { x += 32; y += 32 }
    setDraft({ mode: 'new', x, y, color })
  }
  const dropAt = (cx: number, cy: number, color: string) => {
    const p = toWorld(cx, cy)
    setDraft({ mode: 'new', x: p.x - IDEA_W / 2, y: p.y - 20, color })
  }
  const onPadDown = (e: RPointerEvent<HTMLButtonElement>, color: string) => {
    if (draft || carry || e.button !== 0) return
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
    if (!s) return
    // A click, not a drag: pick it up and let the next click put it down.
    if (!s.moved) { setCarry(s.color); setSpawn({ color: s.color, cx: e.clientX, cy: e.clientY }); return }
    setSpawn(null)
    const r = rect()
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    const onChrome = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('.ib-bar, .ib-zoom, .ib-list, .ib-list-open')
    if (!inside || onChrome) return
    dropAt(e.clientX, e.clientY, s.color)
  }
  const onPadLost = () => { if (tearing.current) { tearing.current = null; setSpawn(null) } }

  /* Carrying: the sticky follows the pointer with no button held, and the next
     press decides. On the board, it is put down there. On the pad or the
     toolbar, it goes back. Anywhere else, it goes back and that click still
     does what it was going to. */
  useEffect(() => {
    if (!carry) return
    const move = (e: PointerEvent) => setSpawn({ color: carry, cx: e.clientX, cy: e.clientY })
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      const board = boardRef.current
      setCarry(null)
      setSpawn(null)
      if (!board || !board.contains(t)) return
      e.preventDefault()
      e.stopPropagation()
      if (!t.closest('.ib-bar, .ib-zoom, .ib-list, .ib-list-open')) dropAt(e.clientX, e.clientY, carry)
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setCarry(null); setSpawn(null) } }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carry])

  const sorted = useMemo(() => [...ideaBoard].sort((a, b) => a.updatedAt - b.updatedAt), [ideaBoard])
  const listed = useMemo(() => [...ideaBoard].sort((a, b) => b.createdAt - a.createdAt), [ideaBoard])
  const editing = draft?.mode === 'edit' ? ideaBoard.find((c) => c.id === draft.id) : undefined
  // Deleted on another device while open here: nothing left to edit.
  useEffect(() => { if (draft?.mode === 'edit' && !editing) setDraft(null) }, [draft, editing])

  const br = spawn ? rect() : null
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  return (
    <div className="ib-page">
      <div
        ref={boardRef}
        className={`ib-board${panning ? ' is-panning' : ''}${carry ? ' is-carrying' : ''}${listOpen ? ' has-list' : ''}`}
        style={{ backgroundSize: `${24 * view.z}px ${24 * view.z}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
        onPointerDown={onBoardDown}
        onPointerMove={onBoardMove}
        onPointerUp={onBoardUp}
        onPointerCancel={onBoardUp}
        onLostPointerCapture={onBoardUp}
        onDoubleClick={onBoardDouble}
      >
        <div className="ib-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
          {sorted.map((c) => {
            const isHeld = drag?.id === c.id
            const pos = isHeld ? drag : c
            return (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                className={`ib-card${isHeld ? ' is-dragging' : ''}${flash === c.id ? ' is-flash' : ''}`}
                style={{ transform: `translate(${pos.x}px, ${pos.y}px) rotate(${isHeld ? 0 : tilt(c.id)}deg)`, background: ideaBg(c.color) }}
                onPointerDown={(e) => onCardDown(e, c)}
                onPointerMove={onCardMove}
                onPointerUp={onCardUp}
                onPointerCancel={onCardLost}
                onLostPointerCapture={onCardLost}
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
            <p>Click a sticky on the pad and click where it goes, press Add idea, or double-click anywhere on the board.</p>
          </div>
        )}

        {carry && <div className="ib-hint" role="status">Click where it goes. Esc to put it back.</div>}

        <div className="ib-bar" onPointerDown={stop} onDoubleClick={stop}>
          <div className="ib-bar-head">
            <h1 className="ib-h1">Ideas</h1>
            <span className="ib-count">{ideaBoard.length}</span>
          </div>
          <div className="ib-pad" title="Click a sticky to pick it up, or drag it onto the board">
            {IDEA_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`ib-pad-note${carry === c.id ? ' is-lifted' : ''}`}
                style={{ background: c.bg }}
                aria-label={`Pick up a ${c.label.toLowerCase()} sticky`}
                onPointerDown={(e) => onPadDown(e, c.id)}
                onPointerMove={onPadMove}
                onPointerUp={onPadUp}
                onPointerCancel={onPadLost}
                onLostPointerCapture={onPadLost}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); newAtCenter(c.id) } }}
              />
            ))}
          </div>
          <button type="button" className="btn btn-primary ib-add" onClick={() => newAtCenter()}>
            <Icon.Plus size={15} />
            Add idea
          </button>
        </div>

        {listOpen ? (
          <nav className="ib-list" aria-label="All ideas" onPointerDown={stop} onDoubleClick={stop}>
            <div className="ib-list-head">
              <span className="ib-list-title">All ideas</span>
              <button type="button" className="ib-list-toggle" onClick={() => setListOpen(false)} aria-label="Hide the list" title="Hide the list">
                <Icon.ChevronRight size={14} />
              </button>
            </div>
            {listed.length ? (
              <ul className="ib-list-rows">
                {listed.map((c) => (
                  <li key={c.id}>
                    <button type="button" className={`ib-list-row${flash === c.id ? ' is-on' : ''}`} onClick={() => flyTo(c)} title={c.title}>
                      <i className="ibd-dot" style={{ background: ideaBg(c.color) }} aria-hidden="true" />
                      <span>{c.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ib-list-empty">Every idea you add shows up here.</p>
            )}
          </nav>
        ) : (
          <button type="button" className="ib-list-open" onClick={() => setListOpen(true)} onPointerDown={stop} onDoubleClick={stop} aria-label="Show the list of ideas">
            <Icon.List size={15} />
            List
            <span className="ib-count">{ideaBoard.length}</span>
          </button>
        )}

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
