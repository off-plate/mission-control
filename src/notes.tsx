/* Notes.

   Folders on the left, the list in a narrow middle column, the note filling
   everything to the right, the way TickTick and Apple Notes do it. Every column
   is DRAGGABLE and remembers its width, because a fixed rail is somebody else
   deciding how much room his folder names and his notes deserve.

   The note is a real editor, not a preview with a hidden textarea behind it.
   Typing "- " makes a bullet. Cmd-B makes bold. A checkbox is a checkbox you
   click. There is a visible toolbar, so the formatting is not buried under a
   kebab. Storage stays markdown, because a plain string is the only thing that
   survives the blob merge, gets searched and gets hashed for the conflict
   check; src/richtext.ts is the hinge, and its round trip is tested. */

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AutoTextarea, Dropdown } from './ui'
import { useStore } from './store'
import { MeetingPrompt } from './meetingprompt'
import { fmtWhen, localDateKey } from './util'
import { spaceFolderId, type Note } from './types'
import * as Icon from './icons'
import { headOf, join, plain, restOf } from './notes/shared'
import { Editor } from './notes/editor'
export { headOf, join, restOf } from './notes/shared'
export { Editor, type EditorTool } from './notes/editor'

const NOTE_COLORS: { id: string; bg: string; label: string }[] = [
  { id: 'amber', bg: '#f6ead0', label: 'Amber' },
  { id: 'coral', bg: '#f3d8cd', label: 'Coral' },
  { id: 'green', bg: '#dbe4d1', label: 'Green' },
  { id: 'blue', bg: '#d3dde6', label: 'Blue' },
  { id: 'clay', bg: '#e4d8cb', label: 'Clay' },
  { id: 'paper', bg: '#fbf8f1', label: 'Paper' },
]

const TAG_RE = /#[\p{L}\d_/-]+/gu
const tagsOf = (t: string) => (t.match(TAG_RE) ?? []).map((x) => x.toLowerCase())
/* Czech, so accents are not a wall: "ukol" finds "úkol", "risa" finds "Říša". */
const flat = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

/* ---- the page ------------------------------------------------------------ */

const HIDE_DONE_KEY = 'mc:notes-hidedone'
const SORT_KEY = 'mc:notes-sort'
const PIN_KEY = 'mc:notes-pinshut'
const FOCUS_KEY = 'mc:notes-only'
type Sort = 'edited' | 'created' | 'title'
const SORT_LABEL: Record<Sort, string> = { edited: 'Date edited', created: 'Date created', title: 'Title' }

/** Which heading a note falls under: Today, Yesterday, the last week, the last
 *  month, then a heading per month this year and per year before that. */
function bucketOf(day: string): string {
  const now = new Date()
  const today = localDateKey(now)
  if (day >= today) return 'Today'
  const d = new Date(`${day}T12:00:00`)
  const ref = new Date(`${today}T12:00:00`)
  const days = Math.round((ref.getTime() - d.getTime()) / 864e5)
  if (days === 1) return 'Yesterday'
  if (days <= 7) return 'Previous 7 days'
  if (days <= 30) return 'Previous 30 days'
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('en-GB', { month: 'long' })
  return String(d.getFullYear())
}

const COLS_KEY = 'mc:notes-cols'
const readCols = (): { side: number; list: number } => {
  try {
    const o = JSON.parse(localStorage.getItem(COLS_KEY) ?? '')
    if (typeof o?.side === 'number' && typeof o?.list === 'number') return o
  } catch { /* first run */ }
  return { side: 236, list: 372 }
}

export function NotesPage() {
  const {
    notes, space, addNote, updateNote, deleteNote, renameNoteTag,
    keepNoteConflict, dropNoteConflict, addTask, setPage, setNoteDone,
    noteToOpen, openNote,
  } = useStore()

  /* ONE LIST (his ask, 2026-10-25): no folders on this page any more, only
     every note, with done ones hidden unless he unticks "Hide done". A note
     still carries its folderId and space underneath, because the Obsidian
     mirror and other pages read them; nothing here shows or changes them. */
  const [hideDone, setHideDone] = useState(() => {
    try { return localStorage.getItem(HIDE_DONE_KEY) !== '0' } catch { return true }
  })
  useEffect(() => { try { localStorage.setItem(HIDE_DONE_KEY, hideDone ? '1' : '0') } catch { /* quota */ } }, [hideDone])
  const [openId, setOpenId] = useState<string | null>(null)
  /* A note the handoff below just opened, briefly. Same flash-then-fade the
     habit folders use, so a note landing in a list of many is easy to pick
     out without changing what he is looking at. */
  const [flashNoteId, setFlashNoteId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [fresh, setFresh] = useState<string | null>(null)
  const [pinShut, setPinShut] = useState(() => {
    try { return localStorage.getItem(PIN_KEY) === '1' } catch { return false }
  })
  useEffect(() => { try { localStorage.setItem(PIN_KEY, pinShut ? '1' : '0') } catch { /* quota */ } }, [pinShut])
  const [sort, setSort] = useState<Sort>(() => {
    try { const v = localStorage.getItem(SORT_KEY); if (v === 'edited' || v === 'created' || v === 'title') return v } catch { /* first run */ }
    return 'edited'
  })
  useEffect(() => { try { localStorage.setItem(SORT_KEY, sort) } catch { /* quota */ } }, [sort])
  const [cols, setCols] = useState(readCols)
  /* The app fills the window from wherever it actually starts, measured,
     instead of guessing the header's height (the old 116px guess left a strip
     of dead page under it once the header changed). */
  const appRef = useRef<HTMLDivElement>(null)
  const [fitH, setFitH] = useState<number | null>(null)
  useLayoutEffect(() => {
    const fit = () => {
      const el = appRef.current
      if (!el) return
      const top = el.getBoundingClientRect().top + window.scrollY
      setFitH(Math.max(460, Math.round(window.innerHeight - top)))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])
  const [vw, setVw] = useState(() => window.innerWidth)
  useEffect(() => {
    const on = () => setVw(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  useEffect(() => { try { localStorage.setItem(COLS_KEY, JSON.stringify(cols)) } catch { /* quota */ } }, [cols])
  const phone = vw < 1000
  const wide = vw >= 1180
  /* Notes only: the folders and the note list step out and the note takes the
     row. He asked for it as a way of working, not a one-off for a screen share,
     so it is remembered on this device and has a key (Cmd-\, the sidebar key
     in most Mac apps). */
  const [presenting, setPresenting] = useState(() => {
    try { return localStorage.getItem(FOCUS_KEY) === '1' } catch { return false }
  })
  useEffect(() => { try { localStorage.setItem(FOCUS_KEY, presenting ? '1' : '0') } catch { /* quota */ } }, [presenting])
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== '\\' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      e.preventDefault()
      setPresenting((v) => !v)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  const finding = query.trim().length > 0 || tag !== null
  /* Only worked out while the tag strip is on screen. It reads every note, and
     the notes change on every keystroke he types into one. */
  const tagsShown = searching || tag !== null
  const allTags = useMemo(() => {
    if (!tagsShown) return []
    const count = new Map<string, number>()
    for (const n of notes) for (const t of new Set(tagsOf(n.body))) count.set(t, (count.get(t) ?? 0) + 1)
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12)
  }, [notes, tagsShown])

  const shown = useMemo(() => {
    const q = query.trim()
    const rows = notes.filter((n) => (!hideDone || !n.done)
      && (!tag || tagsOf(n.body).includes(tag)) && (!q || flat(n.body).includes(flat(q))))
    const by = sort === 'title'
      ? (a: Note, b: Note) => (headOf(a.body) || 'Untitled').localeCompare(headOf(b.body) || 'Untitled')
      : sort === 'created'
        ? (a: Note, b: Note) => (b.when > a.when ? 1 : b.when < a.when ? -1 : 0)
        : (a: Note, b: Note) => b.updatedAt - a.updatedAt
    return rows.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || by(a, b))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, tag, query, hideDone, sort])

  /* Grouped the way a notes list has always been grouped: pinned first, then by
     date under real headings. A flat run of eighty rows has no shape and gives
     the scroll nothing to land on. */
  const groups = useMemo(() => {
    const out: { head: string; rows: Note[] }[] = []
    for (const n of shown) {
      const head = n.pinned ? 'Pinned'
        : sort === 'title' ? (headOf(n.body) || 'U').slice(0, 1).toUpperCase()
          : bucketOf(sort === 'created' ? n.when : localDateKey(new Date(n.updatedAt)))
      const last = out[out.length - 1]
      if (last && last.head === head) last.rows.push(n)
      else out.push({ head, rows: [n] })
    }
    return out
  }, [shown, sort])

  /* On a desktop the pane is never empty while there is something to read: the
     first note of the folder opens itself, the way Notes and TickTick do it. */
  useEffect(() => {
    if (phone) return
    if (openId && shown.some((n) => n.id === openId)) return
    setOpenId(shown[0]?.id ?? null)
  }, [phone, shown, openId])

  /* A note another page asked for, taken once and cleared, so coming back to
     Notes later does not reopen something he has since closed.

     Setting openId alone was not enough: the very next effect resets openId
     to shown[0] whenever it is not IN shown, and shown is filtered by
     openFolder (and by search, if a query or tag was active). A note the
     meeting prompt hands over after it has been ticked done lives in Done
     now, not wherever openFolder still points, so it was never in shown and
     got silently swapped back out the instant it was swapped in.

     But jumping folders is only warranted when the current view genuinely
     cannot show the note -- his report, 2026-08-27: standing in All notes,
     which already shows everything not done, opening a note with no folder
     of its own was narrowing him into "No folder" for that one space
     instead of leaving him where he already was. So the folder only moves
     when shown does not already contain the note; either way a brief flash
     marks which row it is, the same language the habit folders use. */
  useEffect(() => {
    if (!noteToOpen) return
    const n = notes.find((x) => x.id === noteToOpen)
    if (n && !shown.some((x) => x.id === n.id)) {
      if (n.done) setHideDone(false)
      setQuery('')
      setTag(null)
    }
    setOpenId(noteToOpen)
    setFresh(noteToOpen)
    setFlashNoteId(noteToOpen)
    openNote(null)
    const el = document.querySelector(`[data-note-id="${noteToOpen}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [noteToOpen, openNote, notes, shown])

  /* The auto-clear, kept in its own effect keyed only on flashNoteId: typing
     into the note (or anything else that changes notes/shown) was re-running
     the effect above, which tore down its setTimeout on every keystroke and
     never got to rearm one once noteToOpen had already been cleared to null
     -- the flash never faded, it just stuck. */
  useEffect(() => {
    if (!flashNoteId) return
    const id = flashNoteId
    const timer = window.setTimeout(() => setFlashNoteId((cur) => (cur === id ? null : cur)), 2600)
    return () => window.clearTimeout(timer)
  }, [flashNoteId])

  const open = notes.find((n) => n.id === openId) ?? null

  const create = () => {
    const id = addNote(spaceFolderId(space))
    setOpenId(id)
    setFresh(id)
    window.scrollTo({ top: 0 })
  }
  /* Columns he can drag. The widths live in localStorage, not in the synced
     state: how wide his sidebar is on this screen is not a fact about his life. */
  const drag = (which: 'list') => (e: React.PointerEvent) => {
    e.preventDefault()
    const from = e.clientX
    const start = cols[which]
    const lo = 240
    const hi = 760
    const move = (ev: PointerEvent) => setCols((c) => ({ ...c, [which]: Math.max(lo, Math.min(hi, start + ev.clientX - from)) }))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('is-colresize')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    document.body.classList.add('is-colresize')
  }

  const kebab = (n: Note) => (
    <Dropdown label="Note options" className="nt-kebab">
      <button role="menuitem" onClick={() => updateNote(n.id, { pinned: !n.pinned })}>
        {n.pinned ? 'Unpin' : 'Pin to the top'}
      </button>
      <button role="menuitem" onClick={() => {
        addTask({ title: (headOf(n.body) || n.body).replace(TAG_RE, '').trim().slice(0, 120), source: 'mc', estimateMin: 0, space: n.space, list: 'backlog', category: 'deep' })
        setPage('plan')
      }}>Make it a task</button>
      <span className="kebab-head">Colour</span>
      <div className="nt-swatches" role="radiogroup" aria-label="Note colour">
        {NOTE_COLORS.map((c) => (
          <button
            key={c.id} className={`note-swatch${n.color === c.id ? ' on' : ''}`} style={{ background: c.bg }}
            aria-label={c.label} aria-pressed={n.color === c.id} onClick={() => updateNote(n.id, { color: c.id })}
          />
        ))}
      </div>
      <button role="menuitem" className="danger" onClick={() => { deleteNote(n.id); setOpenId(null) }}>Delete</button>
    </Dropdown>
  )

  /* Stable across renders, so a row only re-renders when its own note does. */
  const phoneRef = useRef(phone)
  phoneRef.current = phone
  const openRow = useMemo(() => (id: string) => { setOpenId(id); if (phoneRef.current) window.scrollTo({ top: 0 }) }, [])

  const reading = phone && open
  return (
    <div
      className={`nt-app${reading ? ' is-reading' : ''}${presenting ? ' is-presenting' : ''}`}
      ref={appRef}
      style={{
        ...(wide && !presenting ? { gridTemplateColumns: `${cols.list}px minmax(0, 1fr)` } : {}),
        ...(!phone && fitH ? { height: fitH } : {}),
      }}
    >
      {/* ---- the list ---- */}
      <div className="nt-list">
        {/* Only in Big Time, where a calendar exists, and only when there is a
            meeting worth naming. Everywhere else it renders nothing at all. It
            sits at the head of the LIST, which is where he already looks when
            he is about to start writing something. */}
        {/* Every workspace, on his instruction. The meeting is happening whichever
            part of his life he happens to be looking at. */}
        <MeetingPrompt />
        <div className="nt-listhead">
          <div className="nt-headmain">
            <h1>All notes</h1>
            {/* A count, not a caption: it is the one thing the folder name does
                not already tell him. */}
            <span className="nt-headcount mono">{shown.length} {shown.length === 1 ? 'note' : 'notes'}</span>
          </div>
          {/* Ticked by default: done notes stay out of the way until he asks. */}
          <label className="nt-hidedone">
            <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
            Hide done
          </label>
          <Dropdown label="List options" className="nt-sortkebab">
            <span className="kebab-head">Sort by</span>
            {(['edited', 'created', 'title'] as Sort[]).map((k) => (
              <button key={k} role="menuitem" aria-checked={sort === k} onClick={() => setSort(k)}>{SORT_LABEL[k]}</button>
            ))}
          </Dropdown>
          <button className="nt-new" onClick={create} aria-label="New note" title="New note">
            <Icon.Plus size={15} />
          </button>
        </div>

        <div className="nt-search">
          <Icon.Search size={17} />
          <input
            className="textinput" type="search" value={query} placeholder="Search…"
            aria-label="Search notes"
            onFocus={() => setSearching(true)}
            onBlur={() => window.setTimeout(() => setSearching(false), 180)}
            onChange={(e) => setQuery(e.target.value)}
          />
          {finding && <button className="nt-clear" onClick={() => { setQuery(''); setTag(null) }}>Clear</button>}
        </div>

        {(searching || tag) && allTags.length > 0 && (
          <div className="nt-tags">
            {allTags.map(([t, n]) => (
              <button
                key={t} className={`nt-chip-tag${tag === t ? ' on' : ''}`}
                onMouseDown={(e) => e.preventDefault()} onClick={() => setTag(tag === t ? null : t)}
              >
                {t}<i>{n}</i>
              </button>
            ))}
            {tag && (
              <button className="nt-linkish" onMouseDown={(e) => e.preventDefault()} onClick={() => {
                const to = window.prompt(`Rename ${tag} in every note`, tag.replace('#', ''))
                if (to) { renameNoteTag(tag, to); setTag(`#${to.replace(/^#/, '').toLowerCase()}`) }
              }}>Rename {tag}</button>
            )}
          </div>
        )}

        <ul className="nt-rows">
          {groups.map((g) => (
            <li key={g.head} className={`nt-groupblock${g.head === 'Pinned' ? ' is-pinned' : ''}`}>
              {/* Pinned folds away, the way it does in Notes; the date headings
                  are plain, because there is nothing to fold about March. */}
              {g.head === 'Pinned' ? (
                <button className="nt-grouphead nt-groupfold" aria-expanded={!pinShut} onClick={() => setPinShut((v) => !v)}>
                  Pinned
                  <Icon.ChevronRight size={14} />
                </button>
              ) : (
                <p className="nt-grouphead">{g.head}</p>
              )}
              <ul hidden={g.head === 'Pinned' && pinShut}>
                {g.rows.map((n) => (
                  <NoteRow
                    key={n.id} n={n} on={n.id === openId} flash={n.id === flashNoteId}
                    sort={sort} query={query}
                    onOpen={openRow} onTick={setNoteDone}
                  />
                ))}
              </ul>
            </li>
          ))}
          {shown.length === 0 && <li className="empty is-boxed">{finding ? 'Nothing matches.' : 'No notes here yet.'}</li>}
        </ul>
      </div>

      {/* ---- the note ---- */}
      <section className="nt-pane" aria-label="Note">
        {open ? (
          <Editor
            note={open}
            onChange={(md) => updateNote(open.id, { body: join(headOf(open.body), md) })}
            slashHelp
            slashTask
            lead={phone ? (
              <button className="nt-back" onClick={() => setOpenId(null)}>
                <Icon.ChevronLeft size={15} />
                All notes
              </button>
            ) : (
              <button
                className="nt-presenttoggle" aria-pressed={presenting}
                aria-label={presenting ? 'Show the note list' : 'Hide the note list'}
                title={presenting ? 'Show the note list (⌘\\)' : 'Hide the note list (⌘\\)'}
                onClick={() => setPresenting((v) => !v)}
              >
                <Icon.Sidebar size={17} />
              </button>
            )}
            trail={kebab(open)}
          >
            {/* When it was last touched, on the same margin as the title. Centred
                over a left-aligned note it read as a stray line floating above
                somebody else's paragraph. */}
            <p className="nt-when-full mono">
              {new Date(open.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
              {' at '}
              {new Date(open.updatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              {open.pinned && <span className="nt-pinned"> · Pinned</span>}
            </p>
            <AutoTextarea
              className="nt-title" minRows={1} maxRows={12} value={headOf(open.body)}
              placeholder="Untitled" aria-label="Note title" autoFocus={open.id === fresh}
              onChange={(e) => updateNote(open.id, { body: join(e.target.value.replace(/\n/g, ' '), restOf(open.body)) })}
              onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
            />

            {open.conflict && (
              <div className="nt-conflict">
                <p className="nt-conflict-head">Another device had a different version of this note. It is kept here until you say what happens to it.</p>
                <pre>{open.conflict.body}</pre>
                <div className="nt-conflict-acts">
                  <button className="btn btn-primary" onClick={() => keepNoteConflict(open.id)}>Add it to this note</button>
                  <button className="btn btn-ghost" onClick={() => dropNoteConflict(open.id)}>Discard it</button>
                </div>
              </div>
            )}
          </Editor>
        ) : (
          <div className="nt-nothing" />
        )}
      </section>

      {/* The grips. Absolutely placed over the column edges so they do not take
          a grid track of their own and cannot shift what they resize. */}
      {wide && !presenting && (
        <>
          <div className="nt-grip" style={{ left: cols.list }} onPointerDown={drag('list')} role="separator" aria-label="Resize the note list" />
        </>
      )}
    </div>
  )
}

/** One row of the list. Memoised, so typing in the open note re-renders that
 *  note's row and leaves the other eighty alone. */
const NoteRow = memo(function NoteRow({ n, on, flash, sort, query, onOpen, onTick }: {
  n: Note; on: boolean; flash: boolean; sort: Sort; query: string
  onOpen: (id: string) => void; onTick: (id: string, done: boolean) => void
}) {
  const title = headOf(n.body) || 'Untitled'
  const snip = snippet(n, query)
  return (
    <li className="nt-rowli">
      <button
        className={`nt-tick${n.done ? ' on' : ''}`}
        role="checkbox"
        aria-checked={n.done ? 'true' : 'false'}
        aria-label={n.done ? `Put ${title} back` : `Mark ${title} done`}
        onClick={() => onTick(n.id, !n.done)}
      >
        <Icon.Check size={13} strokeWidth={3.4} />
      </button>
      <button
        className={`nt-row has-tick${on ? ' on' : ''}${n.done ? ' is-done' : ''}${flash ? ' flash' : ''}`}
        aria-current={on ? 'true' : undefined}
        data-note-id={n.id}
        onClick={() => onOpen(n.id)}
      >
        {/* No dot. His words: "in the notes it should not have any fucking
            dots". The colour swatch that sat here said nothing the note's own
            title does not. */}
        <span className="nt-rowtitle">
          <span className="nt-rowname">{title}</span>
        </span>
        <span className="nt-rowsub">
          <span className="nt-when">{fmtWhen(sort === 'created' ? n.when : localDateKey(new Date(n.updatedAt)))}</span>
          {snip && <span className="nt-rowsnip">{snip}</span>}
        </span>
        {n.conflict && <span className="nt-rowtail"><span className="nt-flag">Two versions</span></span>}
      </button>
    </li>
  )
})

/** The one line under a row's title: in a search, the line that matched,
 *  otherwise whatever follows the title. Never the title again. */
function snippet(n: Note, query: string): string {
  const head = headOf(n.body)
  const lines = restOf(n.body).split('\n').map((l) => plain(l)).filter(Boolean).filter((l) => l !== head)
  const q = query.trim()
  if (q) {
    const hit = lines.find((l) => flat(l).includes(flat(q)))
    if (hit) return hit.slice(0, 160)
  }
  return (lines[0] ?? '').slice(0, 160)
}
