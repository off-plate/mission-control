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
import { fmtWhen, localDateKey } from './util'
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
/** The folder mark, filled when it is the one he is standing in. */
function FolderIcon({ open, small }: { open?: boolean; small?: boolean }) {
  const n = small ? 11 : 14
  return (
    <svg className={`nt-ficon${open ? ' on' : ''}`} width={n} height={n} viewBox="0 0 24 24" fill={open ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3 7.5A2 2 0 0 1 5 5.5h3.6a2 2 0 0 1 1.5.7l1 1.2H19a2 2 0 0 1 2 2v7.1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" strokeLinejoin="round" />
    </svg>
  )
}

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

function Editor({ note, onChange, lead, trail, children }: {
  note: Note
  onChange: (md: string) => void
  /** Sits at the start of the pane's own bar, before the formatting. */
  lead?: React.ReactNode
  /** And at the end of it: the note's own menu. */
  trail?: React.ReactNode
  /** The stamp, the title and anything else above the writing surface. */
  children?: React.ReactNode
}) {
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

  /* Chrome's indent leaves the nested list as a SIBLING of the item it belongs
     to, which is invalid and makes the markdown ambiguous. Put it back inside
     the item before anything reads it. */
  const tidy = (root: HTMLElement) => {
    for (const ul of [...root.querySelectorAll('ul, ol')]) {
      const prev = ul.previousElementSibling
      if (ul.parentElement && /^(UL|OL)$/.test(ul.parentElement.tagName) && prev?.tagName === 'LI') prev.append(ul)
    }
  }

  const emit = () => {
    const el = ref.current
    if (!el) return
    tidy(el)
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
    <>
      {/* The pane's one bar: how to write, then the note's own menu at the end.
          The formatting used to sit BETWEEN the title and the body, which put a
          row of controls through the middle of his note and left the bar above
          holding nothing but a lone kebab. */}
      <div className="nt-topbar">
        {lead}
        <div className="nt-toolbar" role="toolbar" aria-label="Formatting">
        <span className="nt-toolgroup">
        <T label="Bold" on={() => cmd('bold')}><b>B</b></T>
        <T label="Italic" on={() => cmd('italic')}><i>I</i></T>
        <T label="Heading" on={() => toggleBlock('h3')}>H</T>
        </span>
        <span className="nt-toolgroup">
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
        </span>
        <span className="nt-toolgroup">
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
        </span>
        <span className="nt-toolgroup">
        <T label="Clear formatting" on={() => cmd('removeFormat')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 5h13M9.5 5L7 19M14 12l6 7M20 12l-6 7" strokeLinecap="round" />
          </svg>
        </T>
        </span>
        </div>
        {trail}
      </div>

      <div className="nt-panebody">
        <article className="nt-sheet">
          {children}
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
            onKeyDown={(e) => {
              /* Tab nests the item, Shift-Tab lifts it. Outside a list Tab still
                 leaves the editor, so it is not a keyboard trap. */
              if (e.key !== 'Tab') return
              const sel = window.getSelection()
              const from = sel?.focusNode
              const li = from ? ((from.nodeType === 3 ? from.parentElement : from as HTMLElement)?.closest('li')) : null
              if (!li) return
              e.preventDefault()
              document.execCommand(e.shiftKey ? 'outdent' : 'indent')
              emit()
            }}
          />
        </article>
      </div>
    </>
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

/** Everything, everywhere, the way All iCloud sits above the folders. */
const ALL = 'nf-all'
const SORT_KEY = 'mc:notes-sort'
const PIN_KEY = 'mc:notes-pinshut'
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
    if (id === ALL) return 'All notes'
    const s = spaceOf(id)
    return s ? (SPACE_LABELS[s] ?? 'Notes') : (noteFolders.find((f) => f.id === id)?.name ?? 'Notes')
  }
  const inFolder = (n: Note, id: string) => {
    if (id === ALL) return true
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
    const by = sort === 'title'
      ? (a: Note, b: Note) => (headOf(a.body) || 'Untitled').localeCompare(headOf(b.body) || 'Untitled')
      : sort === 'created'
        ? (a: Note, b: Note) => (b.when > a.when ? 1 : b.when < a.when ? -1 : 0)
        : (a: Note, b: Note) => b.updatedAt - a.updatedAt
    return rows.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || by(a, b))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, finding, tag, query, openFolder, noteFolders, sort])

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

  const open = notes.find((n) => n.id === openId) ?? null

  const create = () => {
    const id = addNote(finding ? home : openFolder)
    setOpenId(id)
    setFresh(id)
    window.scrollTo({ top: 0 })
  }
  /* Where a new folder lands: the workspace of whatever is selected, and the
     one he is writing into when All notes is. Named on the button, so it is
     never a guess. */
  const newFolderIn: SpaceId = (() => {
    if (openFolder === ALL) return space
    const s2 = spaceOf(openFolder)
    if (s2) return s2
    return noteFolders.find((f) => f.id === openFolder)?.space ?? space
  })()
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
      {/* ---- folders ----
           Shaped after the Notes sidebar, on his instruction: one row per
           folder at one size, the account row above its own folders, the count
           right-aligned and quiet, and the folder mark filled and in the accent
           on the one he is standing in. What went: four "New folder" buttons
           scattered down the panel, which is four times the noise for a thing
           he does once a month. There is one, at the foot, and it makes the
           folder inside whichever workspace he is standing in. */}
      <aside className="nt-side" aria-label="Folders">
        <div className="nt-fscroll">
          <div className="nt-group">
            <div className={`nt-folder-row${!finding && openFolder === ALL ? ' on' : ''}`}>
              <button className="nt-folder" aria-current={!finding && openFolder === ALL ? 'true' : undefined} onClick={() => goFolder(ALL)}>
                <FolderIcon open={!finding && openFolder === ALL} />
                <span className="nt-fname">All notes</span>
                <span className="nt-count mono">{notes.length || ''}</span>
              </button>
              <span className="nt-slot" aria-hidden="true" />
            </div>
          </div>
          {SPACES.map((s) => {
            const wid = spaceFolderId(s)
            const own = noteFolders.filter((f) => f.space === s).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
            const at = (id: string) => !finding && openFolder === id
            const count = (id: string) => notes.filter((n) => inFolder(n, id)).length
            return (
              <div className="nt-group" key={s}>
                {/* Every row is the same shape whether or not it is the open
                    one: the menu slot is always there, so nothing shifts when
                    it is clicked. */}
                <div className={`nt-folder-row${at(wid) ? ' on' : ''}`}>
                  <button className="nt-folder" aria-current={at(wid) ? 'true' : undefined} onClick={() => goFolder(wid)}>
                    <FolderIcon open={at(wid)} />
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
                  <div className={`nt-folder-row is-sub${at(f.id) ? ' on' : ''}`} key={f.id}>
                    <button className="nt-folder" aria-current={at(f.id) ? 'true' : undefined} onClick={() => goFolder(f.id)}>
                      <FolderIcon open={at(f.id)} />
                      <span className="nt-fname">{f.name}</span>
                      <span className="nt-count mono">{count(f.id) || ''}</span>
                    </button>
                    <Dropdown label={`${f.name} options`} className="nt-fkebab">
                      <button role="menuitem" onClick={() => setNaming({ folder: f.id, value: f.name })}>Rename</button>
                      <button role="menuitem" className="danger" onClick={() => deleteNoteFolder(f.id)}>Delete folder, keep the notes</button>
                    </Dropdown>
                  </div>
                )))}
                {naming?.space === s && (
                  <input
                    className="nt-rename textinput" autoFocus value={naming.value} placeholder="Folder name"
                    aria-label={`New folder in ${SPACE_LABELS[s]}`}
                    onChange={(e) => setNaming({ ...naming, value: e.target.value })}
                    onBlur={submitName}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitName(); if (e.key === 'Escape') setNaming(null) }}
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* One button, at the foot, naming where the folder will land. Four of
            them down the panel was four times the noise for a monthly act. */}
        <button
          className="nt-newfolder"
          title={`New folder in ${SPACE_LABELS[newFolderIn]}`}
          onClick={() => setNaming({ space: newFolderIn, value: '' })}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
            <path d="M3 7.5A2 2 0 0 1 5 5.5h3.6a2 2 0 0 1 1.5.7l1 1.2H19a2 2 0 0 1 2 2v7.1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" strokeLinejoin="round" />
            <path d="M12 11.4v4.6M9.7 13.7h4.6" strokeLinecap="round" />
          </svg>
          New folder
          <span className="nt-newwhere">{SPACE_LABELS[newFolderIn]}</span>
        </button>
      </aside>

      {/* ---- the list ---- */}
      <div className="nt-list">
        <div className="nt-listhead">
          <div className="nt-headmain">
            <h1>{finding ? 'Everything' : nameOf(openFolder)}</h1>
            {/* A count, not a caption: it is the one thing the folder name does
                not already tell him. */}
            <span className="nt-headcount mono">{shown.length} {shown.length === 1 ? 'note' : 'notes'}</span>
          </div>
          <Dropdown label="List options" className="nt-sortkebab">
            <span className="kebab-head">Sort by</span>
            {(['edited', 'created', 'title'] as Sort[]).map((k) => (
              <button key={k} role="menuitem" aria-checked={sort === k} onClick={() => setSort(k)}>{SORT_LABEL[k]}</button>
            ))}
          </Dropdown>
          <button className="nt-new" onClick={create} aria-label="New note" title="New note">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" aria-hidden="true">
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
          {groups.map((g) => (
            <li key={g.head} className={`nt-groupblock${g.head === 'Pinned' ? ' is-pinned' : ''}`}>
              {/* Pinned folds away, the way it does in Notes; the date headings
                  are plain, because there is nothing to fold about March. */}
              {g.head === 'Pinned' ? (
                <button className="nt-grouphead nt-groupfold" aria-expanded={!pinShut} onClick={() => setPinShut((v) => !v)}>
                  Pinned
                  <svg className={`nt-chev${pinShut ? '' : ' open'}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                    <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              ) : (
                <p className="nt-grouphead">{g.head}</p>
              )}
              <ul hidden={g.head === 'Pinned' && pinShut}>
                {g.rows.map((n) => (
                  <li key={n.id}>
                    <button
                      className={`nt-row${n.id === openId ? ' on' : ''}`}
                      aria-current={n.id === openId ? 'true' : undefined}
                      onClick={() => { setOpenId(n.id); if (phone) window.scrollTo({ top: 0 }) }}
                    >
                      <span className="nt-rowtitle">
                        <span className="nt-swatch" style={{ background: colorBg(n.color) }} aria-hidden="true" />
                        <span className="nt-rowname">{headOf(n.body) || 'Untitled'}</span>
                      </span>
                      <span className="nt-rowsub">
                        <span className="nt-when">{fmtWhen(sort === 'created' ? n.when : localDateKey(new Date(n.updatedAt)))}</span>
                        {snippet(n, query) && <span className="nt-rowsnip">{snippet(n, query)}</span>}
                      </span>
                      {/* Which folder it lives in, on every row, not only in a
                          search. In All notes that is the whole point of the
                          row, and everywhere else it costs one quiet line. */}
                      <span className="nt-rowtail">
                        <FolderIcon small />
                        {nameOf(n.folderId)}
                        {n.conflict && <span className="nt-flag"> · two versions</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {shown.length === 0 && <li className="nt-none">{finding ? 'Nothing matches.' : 'No notes here yet.'}</li>}
        </ul>
      </div>

      {/* ---- the note ---- */}
      <section className="nt-pane" aria-label="Note">
        {open ? (
          <Editor
            note={open}
            onChange={(md) => updateNote(open.id, { body: join(headOf(open.body), md) })}
            lead={phone ? (
              <button className="nt-back" onClick={() => setOpenId(null)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                  <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {nameOf(open.folderId)}
              </button>
            ) : undefined}
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
