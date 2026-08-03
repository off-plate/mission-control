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

import { useEffect, useMemo, useRef, useState } from 'react'
import { AutoTextarea, Dropdown } from './pages1'
import { useStore } from './store'
import { SPACE_LABELS } from './mock'
import { fmtWhen } from './util'
import { htmlToMd, mdToHtml } from './richtext'
import { SPACES, spaceFolderId, type Note, type SpaceId } from './types'

const NOTE_COLORS: { id: string; bg: string; label: string }[] = [
  { id: 'amber', bg: '#f6ead0', label: 'Amber' },
  { id: 'coral', bg: '#f3d8cd', label: 'Coral' },
  { id: 'green', bg: '#dbe4d1', label: 'Green' },
  { id: 'blue', bg: '#d3dde6', label: 'Blue' },
  { id: 'clay', bg: '#e4d8cb', label: 'Clay' },
  { id: 'paper', bg: '#fbf8f1', label: 'Paper' },
]
const colorBg = (id: string) => NOTE_COLORS.find((c) => c.id === id)?.bg ?? '#fbf8f1'

const TAG_RE = /#[\p{L}\d_/-]+/gu
const tagsOf = (t: string) => (t.match(TAG_RE) ?? []).map((x) => x.toLowerCase())
/* Czech, so accents are not a wall: "ukol" finds "úkol", "risa" finds "Říša". */
const flat = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

const headOf = (body: string) => (body.split('\n')[0] ?? '').replace(/^\s*#{1,3}\s+/, '')
const restOf = (body: string) => body.split('\n').slice(1).join('\n')
const join = (head: string, rest: string) => (rest ? `${head}\n${rest}` : head)

/* ---- the editor ---------------------------------------------------------- */

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function caretToEnd(node: Node) {
  const sel = window.getSelection()
  if (!sel) return
  const r = document.createRange()
  r.selectNodeContents(node)
  r.collapse(false)
  sel.removeAllRanges()
  sel.addRange(r)
}

/** The block the caret sits in, as a direct child of the editor. */
function blockAt(root: HTMLElement): HTMLElement | null {
  const sel = window.getSelection()
  if (!sel || !sel.focusNode) return null
  let n: Node | null = sel.focusNode
  if (n.nodeType === 3) n = n.parentNode
  while (n && n.parentNode !== root) n = n.parentNode
  return n && n.nodeType === 1 ? (n as HTMLElement) : null
}

function Editor({ note, onChange }: { note: Note; onChange: (md: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  /* The markdown this editor last produced. Without it, every keystroke would
     come back through props and rewrite the DOM under his caret. */
  const mine = useRef<string | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const md = restOf(note.body)
    if (md === mine.current) return
    el.innerHTML = mdToHtml(md)
    mine.current = md
  }, [note.id, note.body])

  const emit = () => {
    const el = ref.current
    if (!el) return
    const md = htmlToMd(el)
    mine.current = md
    onChange(md)
  }

  /* Typing a markdown lead at the start of a line turns the line into the thing
     it names. This is what he meant by "a dash should make a bullet". */
  const autoformat = () => {
    const root = ref.current
    if (!root) return
    const block = blockAt(root)
    /* DIV as well as P: leaving a list, Chrome starts the next block as a
       <div>, and a dash typed there was staying a dash. */
    if (!block || (block.tagName !== 'P' && block.tagName !== 'DIV')) return
    const text = block.textContent ?? ''
    /* Three dashes on their own line: a divider. Checked before the bullet
       rule, which needs a space after the dash and so never sees these. */
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(text)) {
      const hr = document.createElement('hr')
      const after = document.createElement('p')
      after.innerHTML = '<br>'
      block.replaceWith(hr, after)
      caretToEnd(after)
      return
    }
    const m = text.match(/^(#{1,3}|[-*]|>|\[\s?\]|\[[xX]\])[  ]/)
    if (!m) return
    const rest = escHtml(text.slice(m[0].length)) || '<br>'
    const lead = m[1]
    let html: string
    if (lead === '-' || lead === '*') html = `<ul><li>${rest}</li></ul>`
    else if (lead.startsWith('[')) html = `<ul class="todo"><li data-done="${/x/i.test(lead) ? '1' : '0'}">${rest}</li></ul>`
    else if (lead === '>') html = `<blockquote>${rest}</blockquote>`
    else html = `<h${lead.length + 2}>${rest}</h${lead.length + 2}>`
    const tmp = document.createElement('div')
    tmp.innerHTML = html
    const made = tmp.firstElementChild as HTMLElement
    block.replaceWith(made)
    caretToEnd(made.lastElementChild ?? made)
  }

  const cmd = (name: string, arg?: string) => {
    ref.current?.focus()
    document.execCommand(name, false, arg)
    emit()
  }

  /* A checkbox is clicked, not typed. CSS draws the box in the item's left
     gutter, so a press inside that gutter is a press on the box. */
  const onMouseDown = (e: React.MouseEvent) => {
    const li = (e.target as HTMLElement).closest('li') as HTMLElement | null
    if (!li || li.dataset.done === undefined) return
    if (e.clientX - li.getBoundingClientRect().left > 26) return
    e.preventDefault()
    li.dataset.done = li.dataset.done === '1' ? '0' : '1'
    emit()
  }

  const toggleBlock = (tag: 'h3' | 'blockquote') => {
    const root = ref.current
    if (!root) return
    const already = blockAt(root)?.tagName.toLowerCase() === tag
    cmd('formatBlock', already ? '<p>' : `<${tag}>`)
  }

  const checklist = () => {
    const root = ref.current
    if (!root) return
    root.focus()
    document.execCommand('insertUnorderedList')
    const sel = window.getSelection()
    const from = sel?.focusNode
    const here = from
      ? ((from.nodeType === 3 ? from.parentElement : from as HTMLElement)?.closest('li') as HTMLElement | null)
      : null
    const li = here ?? (blockAt(root)?.querySelector('li') as HTMLElement | null)
    if (li) { li.dataset.done = '0'; li.parentElement?.classList.add('todo') }
    emit()
  }

  /* A table of his own size. The picker is two numbers rather than a hover
     grid, because he asked for a custom amount and a drawn grid caps out. */
  const insertTable = (rows: number, cols: number) => {
    const root = ref.current
    if (!root) return
    root.focus()
    const cell = (tag: string) => `<${tag}><br></${tag}>`
    const head = `<tr>${cell('th').repeat(cols)}</tr>`
    const body = `<tr>${cell('td').repeat(cols)}</tr>`.repeat(Math.max(0, rows - 1))
    const tmp = document.createElement('div')
    tmp.innerHTML = `<table><thead>${head}</thead><tbody>${body}</tbody></table><p><br></p>`
    const nodes = [...tmp.childNodes]
    const block = blockAt(root)
    if (block) block.replaceWith(...nodes); else root.append(...nodes)
    const first = (nodes[0] as HTMLElement).querySelector('th')
    if (first) caretToEnd(first)
    emit()
  }

  /* Growing a table he is standing in, because a table you cannot add a row to
     is a table you have to delete and remake. */
  const grow = (what: 'row' | 'col') => {
    const root = ref.current
    if (!root) return
    const sel = window.getSelection()
    const from = sel?.focusNode
    const cellNow = from ? ((from.nodeType === 3 ? from.parentElement : from as HTMLElement)?.closest('td,th') as HTMLElement | null) : null
    const here = blockAt(root)
    const table = (cellNow?.closest('table') ?? (here?.tagName === 'TABLE' ? here : null)) as HTMLTableElement | null
    if (!table) return
    if (what === 'row') {
      const width = table.rows[0]?.cells.length ?? 1
      const tbody = table.tBodies[0] ?? table.appendChild(document.createElement('tbody'))
      const tr = document.createElement('tr')
      tr.innerHTML = '<td><br></td>'.repeat(width)
      tbody.append(tr)
      caretToEnd(tr.cells[0])
    } else {
      for (const tr of [...table.rows]) {
        const c = document.createElement(tr.parentElement?.tagName === 'THEAD' ? 'th' : 'td')
        c.innerHTML = '<br>'
        tr.append(c)
      }
      const cells = table.rows[0]?.cells
      if (cells?.length) caretToEnd(cells[cells.length - 1])
    }
    emit()
  }

  const divider = () => {
    const root = ref.current
    if (!root) return
    root.focus()
    const hr = document.createElement('hr')
    const after = document.createElement('p')
    after.innerHTML = '<br>'
    const block = blockAt(root)
    if (block) block.replaceWith(hr, after); else root.append(hr, after)
    caretToEnd(after)
    emit()
  }

  const T = ({ on, label, children }: { on: () => void; label: string; children: React.ReactNode }) => (
    <button className="nt-tool" title={label} aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={on}>{children}</button>
  )

  return (
    <div className="nt-editwrap">
      <div className="nt-toolbar" role="toolbar" aria-label="Formatting">
        <T label="Bold" on={() => cmd('bold')}><b>B</b></T>
        <T label="Italic" on={() => cmd('italic')}><i>I</i></T>
        <T label="Heading" on={() => toggleBlock('h3')}>H</T>
        <span className="nt-toolsep" aria-hidden="true" />
        <T label="Bullet list" on={() => cmd('insertUnorderedList')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="5" cy="7" r="1.4" fill="currentColor" /><circle cx="5" cy="17" r="1.4" fill="currentColor" />
            <path d="M10 7h10M10 17h10" strokeLinecap="round" />
          </svg>
        </T>
        <T label="Checklist" on={checklist}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="4" width="7" height="7" rx="1.6" /><path d="M4.5 17.5l2 2 4-4M14 7.5h7M14 17.5h7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </T>
        <T label="Quote" on={() => toggleBlock('blockquote')}>&rdquo;</T>
        <span className="nt-toolsep" aria-hidden="true" />
        <T label="Divider" on={divider}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M3 12h18" strokeLinecap="round" />
          </svg>
        </T>
        <TablePicker onPick={insertTable} />
        <T label="Add a row" on={() => grow('row')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="4" width="18" height="8" rx="1.6" /><path d="M12 15v6M9 18h6" strokeLinecap="round" />
          </svg>
        </T>
        <T label="Add a column" on={() => grow('col')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="4" y="3" width="8" height="18" rx="1.6" /><path d="M18 9v6M15 12h6" strokeLinecap="round" />
          </svg>
        </T>
        <span className="nt-toolsep" aria-hidden="true" />
        <T label="Clear formatting" on={() => cmd('removeFormat')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 5h13M9.5 5L7 19M14 12l6 7M20 12l-6 7" strokeLinecap="round" />
          </svg>
        </T>
      </div>
      <div
        ref={ref}
        className="nt-editor"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Note text"
        data-empty={!restOf(note.body).trim() || undefined}
        onInput={() => { autoformat(); emit() }}
        onBlur={emit}
        onMouseDown={onMouseDown}
      />
    </div>
  )
}

/** Two numbers and a button. He asked for a custom amount of rows and columns,
 *  and a drawn hover grid caps out at whatever size somebody else decided. */
function TablePicker({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState(3)
  const [cols, setCols] = useState(3)
  const wrap = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [open])
  const go = () => { onPick(Math.max(1, Math.min(20, rows)), Math.max(1, Math.min(10, cols))); setOpen(false) }
  return (
    <span className="nt-tablepick" ref={wrap}>
      <button className="nt-tool" title="Table" aria-label="Table" aria-expanded={open} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((v) => !v)}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 10v10M15 10v10" />
        </svg>
      </button>
      {open && (
        <div className="nt-tablemenu">
          <label>Rows<input className="textinput" type="number" min={1} max={20} value={rows} onChange={(e) => setRows(Number(e.target.value))} /></label>
          <label>Columns<input className="textinput" type="number" min={1} max={10} value={cols} onChange={(e) => setCols(Number(e.target.value))} /></label>
          <button className="btn btn-primary" onClick={go}>Insert</button>
        </div>
      )}
    </span>
  )
}

/* ---- the page ------------------------------------------------------------ */

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
    notes, noteFolders, view, space, addNote, updateNote, moveNote, deleteNote,
    addNoteFolder, renameNoteFolder, deleteNoteFolder, renameNoteTag,
    keepNoteConflict, dropNoteConflict, addTask, setPage,
  } = useStore()

  const home = spaceFolderId(view === 'all' ? space : view)
  const [openFolder, setOpenFolder] = useState<string>(home)
  const [openId, setOpenId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [fresh, setFresh] = useState<string | null>(null)
  const [naming, setNaming] = useState<{ space?: SpaceId; folder?: string; value: string } | null>(null)
  const [cols, setCols] = useState(readCols)
  const [vw, setVw] = useState(() => window.innerWidth)
  useEffect(() => {
    const on = () => setVw(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  useEffect(() => { try { localStorage.setItem(COLS_KEY, JSON.stringify(cols)) } catch { /* quota */ } }, [cols])
  const phone = vw < 1000
  const wide = vw >= 1180

  useEffect(() => { setOpenFolder(home); setOpenId(null) }, [home])

  const finding = query.trim().length > 0 || tag !== null
  const spaceOf = (id: string) => id.match(/^nf-space-(.+)$/)?.[1] as SpaceId | undefined
  const nameOf = (id: string) => {
    const s = spaceOf(id)
    return s ? (SPACE_LABELS[s] ?? 'Notes') : (noteFolders.find((f) => f.id === id)?.name ?? 'Notes')
  }
  const inFolder = (n: Note, id: string) => {
    const s = spaceOf(id)
    return s ? n.space === s : n.folderId === id
  }

  const allTags = useMemo(() => {
    const count = new Map<string, number>()
    for (const n of notes) for (const t of new Set(tagsOf(n.body))) count.set(t, (count.get(t) ?? 0) + 1)
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12)
  }, [notes])

  const shown = useMemo(() => {
    const q = query.trim()
    const rows = finding
      ? notes.filter((n) => (!tag || tagsOf(n.body).includes(tag)) && (!q || flat(n.body).includes(flat(q))))
      : notes.filter((n) => inFolder(n, openFolder))
    return rows.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, finding, tag, query, openFolder, noteFolders])

  /* On a desktop the pane is never empty while there is something to read: the
     first note of the folder opens itself, the way Notes and TickTick do it. */
  useEffect(() => {
    if (phone) return
    if (openId && shown.some((n) => n.id === openId)) return
    setOpenId(shown[0]?.id ?? null)
  }, [phone, shown, openId])

  const open = notes.find((n) => n.id === openId) ?? null

  const create = () => {
    const id = addNote(finding ? home : openFolder)
    setOpenId(id)
    setFresh(id)
    window.scrollTo({ top: 0 })
  }
  const goFolder = (id: string) => { setOpenFolder(id); setOpenId(null); setQuery(''); setTag(null) }

  const submitName = () => {
    if (!naming) return
    const v = naming.value.trim()
    if (v && naming.space) { const id = addNoteFolder(naming.space, v); goFolder(id) }
    if (v && naming.folder) renameNoteFolder(naming.folder, v)
    setNaming(null)
  }

  /* Columns he can drag. The widths live in localStorage, not in the synced
     state: how wide his sidebar is on this screen is not a fact about his life. */
  const drag = (which: 'side' | 'list') => (e: React.PointerEvent) => {
    e.preventDefault()
    const from = e.clientX
    const start = cols[which]
    const lo = which === 'side' ? 150 : 240
    const hi = which === 'side' ? 460 : 760
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
      <span className="kebab-head">Move to</span>
      {SPACES.flatMap((s) => [
        { id: spaceFolderId(s), name: SPACE_LABELS[s] },
        ...noteFolders.filter((f) => f.space === s).map((f) => ({ id: f.id, name: `${SPACE_LABELS[s]} / ${f.name}` })),
      ]).filter((f) => f.id !== n.folderId).map((f) => (
        <button key={f.id} role="menuitem" onClick={() => moveNote(n.id, f.id)}>{f.name}</button>
      ))}
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

  const reading = phone && open
  return (
    <div
      className={`nt-app${reading ? ' is-reading' : ''}`}
      style={wide ? { gridTemplateColumns: `${cols.side}px ${cols.list}px minmax(0, 1fr)` } : undefined}
    >
      {/* ---- folders ---- */}
      <aside className="nt-side" aria-label="Folders">
        {SPACES.map((s) => {
          const wid = spaceFolderId(s)
          const own = noteFolders.filter((f) => f.space === s).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
          const at = (id: string) => !finding && openFolder === id
          const count = (id: string) => notes.filter((n) => inFolder(n, id)).length
          return (
            <div className="nt-group" key={s}>
              {/* Every row is the same shape whether or not it is the open one:
                  the menu slot is always there, so nothing shifts when clicked. */}
              <div className={`nt-folder-row${at(wid) ? ' on' : ''}`}>
                <button className="nt-folder nt-folder-top" aria-current={at(wid) ? 'true' : undefined} onClick={() => goFolder(wid)}>
                  <span className="nt-fname">{SPACE_LABELS[s]}</span>
                  <span className="nt-count mono">{count(wid) || ''}</span>
                </button>
                <span className="nt-slot" aria-hidden="true" />
              </div>
              {own.map((f) => (naming?.folder === f.id ? (
                <input
                  key={f.id} className="nt-rename textinput" autoFocus value={naming.value} aria-label={`Rename ${f.name}`}
                  onChange={(e) => setNaming({ ...naming, value: e.target.value })}
                  onBlur={submitName}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitName(); if (e.key === 'Escape') setNaming(null) }}
                />
              ) : (
                <div className={`nt-folder-row${at(f.id) ? ' on' : ''}`} key={f.id}>
                  <button className="nt-folder" aria-current={at(f.id) ? 'true' : undefined} onClick={() => goFolder(f.id)}>
                    <span className="nt-fname">{f.name}</span>
                    <span className="nt-count mono">{count(f.id) || ''}</span>
                  </button>
                  <Dropdown label={`${f.name} options`} className="nt-fkebab">
                    <button role="menuitem" onClick={() => setNaming({ folder: f.id, value: f.name })}>Rename</button>
                    <button role="menuitem" className="danger" onClick={() => deleteNoteFolder(f.id)}>Delete folder, keep the notes</button>
                  </Dropdown>
                </div>
              )))}
              {naming?.space === s ? (
                <input
                  className="nt-rename textinput" autoFocus value={naming.value} placeholder="Folder name"
                  aria-label={`New folder in ${SPACE_LABELS[s]}`}
                  onChange={(e) => setNaming({ ...naming, value: e.target.value })}
                  onBlur={submitName}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitName(); if (e.key === 'Escape') setNaming(null) }}
                />
              ) : (
                <button className="nt-addfolder" onClick={() => setNaming({ space: s, value: '' })}>New folder</button>
              )}
            </div>
          )
        })}
      </aside>

      {/* ---- the list ---- */}
      <div className="nt-list">
        <div className="nt-listhead">
          <h1>{finding ? 'Everything' : nameOf(openFolder)}</h1>
          <button className="nt-new" onClick={create} aria-label="New note" title="New note">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="nt-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" strokeLinecap="round" />
          </svg>
          <input
            className="textinput" type="search" value={query} placeholder="Search"
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
          {shown.map((n) => (
            <li key={n.id}>
              <button
                className={`nt-row${n.id === openId ? ' on' : ''}`}
                aria-current={n.id === openId ? 'true' : undefined}
                onClick={() => { setOpenId(n.id); if (phone) window.scrollTo({ top: 0 }) }}
              >
                <span className="nt-rowtitle">
                  {n.pinned && <span className="nt-pin" aria-hidden="true">◆</span>}
                  <span className="nt-swatch" style={{ background: colorBg(n.color) }} aria-hidden="true" />
                  <span className="nt-rowname">{headOf(n.body) || 'Untitled'}</span>
                </span>
                <span className="nt-rowsub">
                  <span className="nt-when mono">{fmtWhen(n.when)}</span>
                  {snippet(n, query) && <span className="nt-rowsnip">{snippet(n, query)}</span>}
                </span>
                {(finding || n.conflict) && (
                  <span className="nt-rowtail">
                    {finding && nameOf(n.folderId)}
                    {n.conflict && <span className="nt-flag"> two versions</span>}
                  </span>
                )}
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="nt-none">{finding ? 'Nothing matches.' : 'No notes here yet.'}</li>}
        </ul>
      </div>

      {/* ---- the note ---- */}
      <section className="nt-pane" aria-label="Note">
        {open ? (
          <>
            {/* Outside the scrolling body, so the menu is not clipped by it. */}
            <div className="nt-topbar">
              {phone && (
                <button className="nt-back" onClick={() => setOpenId(null)}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                    <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {nameOf(open.folderId)}
                </button>
              )}
              <span className="nt-stamp mono">edited {fmtWhen(open.when)}</span>
              {kebab(open)}
            </div>

            <div className="nt-panebody">
              <article className="nt-sheet">
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

                <Editor note={open} onChange={(md) => updateNote(open.id, { body: join(headOf(open.body), md) })} />
              </article>
            </div>
          </>
        ) : (
          <div className="nt-nothing" />
        )}
      </section>

      {/* The grips. Absolutely placed over the column edges so they do not take
          a grid track of their own and cannot shift what they resize. */}
      {wide && (
        <>
          <div className="nt-grip" style={{ left: cols.side }} onPointerDown={drag('side')} role="separator" aria-label="Resize the folder column" />
          <div className="nt-grip" style={{ left: cols.side + cols.list }} onPointerDown={drag('list')} role="separator" aria-label="Resize the note list" />
        </>
      )}
    </div>
  )
}

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

/** A line with its marks taken off, for places that show text rather than
 *  render it. A list row printing `**status**` is showing him the plumbing. */
function plain(line: string): string {
  return line
    .replace(/^\s*#{1,3}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*[-*]\s+(\[[ xX]\]\s*)?/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim()
}
