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
import { MeetingPrompt } from './meetingprompt'
import { fmtWhen, localDateKey } from './util'
import { htmlToMd, mdToHtml } from './richtext'
import { spaceFolderId, type Note, type SpaceId } from './types'
import { helpWithNote, type HelpResult } from './notesai'

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

/* Matches the wording Settings and Break It Down already use for the same
   three failure shapes, so a key problem reads the same everywhere it shows. */
const HELP_ERROR: Record<Exclude<HelpResult, { ok: true }>['reason'], string> = {
  'no-key': 'No Groq key yet. Add one in Settings and /help can actually answer.',
  'bad-key': 'That Groq key was rejected. Check it in Settings.',
  'rate-limit': 'Groq is rate-limited right now. Try again in a moment.',
  'failed': 'That did not go through. Try again.',
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

/* The one LINE the cursor is on, which inside a list is the item and not the
   list. blockAt walks up to a child of the root, so in

       <ul><li>a</li><li>b</li><li>c</li></ul>

   it returns the whole <ul>. A slash command then read every bullet as one
   line: he put /task on the last item of a five-item list and got all five
   glued into a single task, with the words run together. /help had the same
   bug and a worse blast radius, since it would have replaced the entire list
   with one answer.

   Block-level markdown (a dash making a bullet) still wants blockAt, so this
   is a second reader rather than a change to that one. */
function lineAt(root: HTMLElement): HTMLElement | null {
  const sel = window.getSelection()
  if (!sel || !sel.focusNode) return null
  let n: Node | null = sel.focusNode
  if (n.nodeType === 3) n = n.parentNode
  while (n && n !== root) {
    if (n.nodeType === 1 && (n as HTMLElement).tagName === 'LI') return n as HTMLElement
    n = n.parentNode
  }
  return blockAt(root)
}

export type EditorTool = 'bold' | 'italic' | 'heading' | 'bullet' | 'checklist' | 'quote' | 'divider' | 'table' | 'clear'
const ALL_TOOLS: EditorTool[] = ['bold', 'italic', 'heading', 'bullet', 'checklist', 'quote', 'divider', 'table', 'clear']

export function Editor({ note, onChange, lead, trail, children, tools, plain, slashHelp, slashTask }: {
  note: Pick<Note, 'id' | 'body'>
  onChange: (md: string) => void
  /** Sits at the start of the pane's own bar, before the formatting. */
  lead?: React.ReactNode
  /** And at the end of it: the note's own menu. */
  trail?: React.ReactNode
  /** The stamp, the title and anything else above the writing surface. */
  children?: React.ReactNode
  /** Which formatting buttons to show. Unset shows all of them, the full
   *  Notes page bar; a caller with a narrower brief (the Zone's "just a
   *  place to take notes") names only the ones it actually wants. */
  tools?: EditorTool[]
  /** The Notes page's own body convention is "first line is the title, the
   *  rest is markdown" (headOf/restOf below). A caller with no title field
   *  of its own passes plain: the whole body is the markdown, full stop. */
  plain?: boolean
  /** "/help <request>" on its own line, Enter to send: Groq drafts, tightens
   *  or looks something up in its place. Notes page only, on his word ("the
   *  page itself, not the Zone section"). Off unless a caller opts in. */
  slashHelp?: boolean
  /** "/task <what>" or "<what> /task", Enter to send: the line becomes a task
   *  on the to-do list and stays in the note as the sentence he wrote. Capture
   *  and planning are different acts, so this only captures: choosing it for a
   *  day happens on Plan, on purpose. */
  slashTask?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  /* The one thing this editor needs from the store, for /task. Everything else
     it does is handed to it as a prop, and that is still the right shape:
     writing a task is an action on the app, not a change to the note. */
  const { addTask, space } = useStore()
  const show = (t: EditorTool) => (tools ?? ALL_TOOLS).includes(t)
  /* The markdown this editor last produced. Without it, every keystroke would
     come back through props and rewrite the DOM under his caret. */
  const mine = useRef<string | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const md = plain ? note.body : restOf(note.body)
    if (md === mine.current) return
    el.innerHTML = mdToHtml(md)
    mine.current = md
  }, [note.id, note.body, plain])

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

  /* Where a slash command is allowed to sit on the line.

     It used to be the start, and only the start. He wrote

         33 tis vyfaktuovat /help

     which is how a person actually asks for help with something they have just
     written, pressed Enter, and got nothing at all: no answer, no error, no
     sign the app had even seen it. Silence cannot be told apart from the
     feature being broken, which is exactly what he concluded.

     So a command is taken at either end of the line, and its argument is
     everything on the other side of it up to the Enter that sent it. A line
     that is only the command has no argument, so it is left alone rather than
     acted on empty. */
  const slashArg = (line: string, cmd: string): string | null => {
    const t = line.trim()
    const lead = t.match(new RegExp(String.raw`^\/${cmd}\b\s*(.*)$`, 'i'))
    if (lead) return lead[1].trim() || null
    const trail = t.match(new RegExp(String.raw`^(.*?)\s*\/${cmd}\s*$`, 'i'))
    if (trail) return trail[1].trim() || null
    return null
  }

  /* "/help <request>" on its own line, Enter to send. The line becomes a
     "Thinking…" placeholder, Groq answers in its place, and on failure the
     line comes back exactly as typed plus one honest sentence about why:
     nothing he wrote is ever lost to a request that did not go through. */
  const runHelp = async (block: HTMLElement, instruction: string) => {
    const root = ref.current
    if (!root) return
    const placeholder = document.createElement(block.tagName === 'LI' ? 'li' : 'p')
    placeholder.className = 'nt-help-pending'
    placeholder.textContent = 'Thinking…'
    block.replaceWith(placeholder)
    const noteSoFar = htmlToMd(root)
    const result: HelpResult = await helpWithNote(instruction, noteSoFar)
    if (!ref.current) return // the note (or the page) moved on while this was in flight
    if (result.ok) {
      const tmp = document.createElement('div')
      tmp.innerHTML = mdToHtml(result.text)
      const nodes = [...tmp.childNodes]
      placeholder.replaceWith(...(nodes.length ? nodes : [Object.assign(document.createElement('p'), { innerHTML: '<br>' })]))
    } else {
      const tag = placeholder.tagName === 'LI' ? 'li' : 'p'
      const said = document.createElement(tag)
      said.textContent = `/help ${instruction}`
      const err = document.createElement(tag)
      err.className = 'nt-help-error'
      err.textContent = HELP_ERROR[result.reason]
      placeholder.replaceWith(said, err)
    }
    emit()
  }

  /* "/task" on a line: it goes onto the to-do list, and the line stays exactly
     as he wrote it minus the command, with a quiet mark saying where it went.

     The LIST, not today. His call, and it is the right one: writing a thought
     down is not the same as committing to doing it before midnight, and an app
     that quietly promises the day to everything he jots at 11pm is how a day
     gets over-planned before it starts. Choosing it for a day is a separate,
     deliberate act on the Plan page.

     The note is not the task and the task is not the note. Nothing here syncs
     the two afterwards: ticking the task does not strike the sentence out, and
     editing the sentence does not rename the task. Pretending otherwise would
     mean a second source of truth for the same thing, which is the bug this
     app keeps having. This is a one-way door, taken deliberately.

     No estimate, because he did not give one and a guessed number is exactly
     what poisons the estimate ledger everything else reads. */
  const makeTask = (block: HTMLElement, title: string) => {
    addTask({
      title,
      source: 'mc',
      estimateMin: 0,
      space,
      list: 'backlog',
      category: 'quick',
    })
    /* A bullet stays a bullet. Replacing an <li> with a <p> would put a
       paragraph inside a <ul>, which is invalid and renders as a stray line
       with no marker next to the items above it. */
    const inList = block.tagName === 'LI'
    const said = document.createElement(inList ? 'li' : 'p')
    said.textContent = title
    const mark = document.createElement('span')
    mark.className = 'nt-task-made'
    mark.textContent = 'on the list'
    said.appendChild(document.createTextNode(' '))
    said.appendChild(mark)
    block.replaceWith(said)
    /* The cursor goes to a fresh line under it, because he was mid-thought and
       the next bullet is where he was heading. */
    const next = document.createElement(inList ? 'li' : 'p')
    next.innerHTML = '<br>'
    said.after(next)
    const sel = window.getSelection()
    if (sel) { const r = document.createRange(); r.setStart(next, 0); r.collapse(true); sel.removeAllRanges(); sel.addRange(r) }
    emit()
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
        {(show('bold') || show('italic') || show('heading')) && (
        <span className="nt-toolgroup">
        {show('bold') && <T label="Bold" on={() => cmd('bold')}><b>B</b></T>}
        {show('italic') && <T label="Italic" on={() => cmd('italic')}><i>I</i></T>}
        {show('heading') && <T label="Heading" on={() => toggleBlock('h3')}>H</T>}
        </span>
        )}
        {(show('bullet') || show('checklist') || show('quote')) && (
        <span className="nt-toolgroup">
        {show('bullet') && (
        <T label="Bullet list" on={() => cmd('insertUnorderedList')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="5" cy="7" r="1.4" fill="currentColor" /><circle cx="5" cy="17" r="1.4" fill="currentColor" />
            <path d="M10 7h10M10 17h10" strokeLinecap="round" />
          </svg>
        </T>
        )}
        {show('checklist') && (
        <T label="Checklist" on={checklist}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="4" width="7" height="7" rx="1.6" /><path d="M4.5 17.5l2 2 4-4M14 7.5h7M14 17.5h7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </T>
        )}
        {show('quote') && <T label="Quote" on={() => toggleBlock('blockquote')}>&rdquo;</T>}
        </span>
        )}
        {(show('divider') || show('table')) && (
        <span className="nt-toolgroup">
        {show('divider') && (
        <T label="Divider" on={divider}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M3 12h18" strokeLinecap="round" />
          </svg>
        </T>
        )}
        {show('table') && (
        <>
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
        </>
        )}
        </span>
        )}
        {show('clear') && (
        <span className="nt-toolgroup">
        <T label="Clear formatting" on={() => cmd('removeFormat')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 5h13M9.5 5L7 19M14 12l6 7M20 12l-6 7" strokeLinecap="round" />
          </svg>
        </T>
        </span>
        )}
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
              if ((slashHelp || slashTask) && e.key === 'Enter' && !e.shiftKey) {
                const root = ref.current
                const block = root && lineAt(root)
                const line = block?.textContent ?? ''
                const ask = slashHelp ? slashArg(line, 'help') : null
                if (block && ask) {
                  e.preventDefault()
                  void runHelp(block, ask)
                  return
                }
                const wanted = slashTask ? slashArg(line, 'task') : null
                if (block && wanted) {
                  e.preventDefault()
                  makeTask(block, wanted)
                  return
                }
              }
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
          <label>Rows<input className="textinput" type="number" inputMode="numeric" min={1} max={20} value={rows} onChange={(e) => setRows(Number(e.target.value))} /></label>
          <label>Columns<input className="textinput" type="number" inputMode="numeric" min={1} max={10} value={cols} onChange={(e) => setCols(Number(e.target.value))} /></label>
          <button className="btn btn-primary" onClick={go}>Insert</button>
        </div>
      )}
    </span>
  )
}

/* ---- the page ------------------------------------------------------------ */

/** Everything, everywhere, the way All iCloud sits above the folders. */
const ALL = 'nf-all'
/* Not a real folder: nothing is filed into it and it cannot be renamed or
   deleted. A note is in Done because it is ticked, and nowhere else while it is. */
const DONE = 'nf-done'
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
    keepNoteConflict, dropNoteConflict, addTask, setPage, setNoteDone,
    noteToOpen, openNote,
  } = useStore()

  /* Notes are not filed by workspace any more, on his instruction: folders are
     just folders, and the app opens on all of them. A note still carries the
     space it was written in, because other pages read it, but nothing here is
     decided by which workspace he happens to be standing in. */
  const [openFolder, setOpenFolder] = useState<string>(ALL)
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

  const finding = query.trim().length > 0 || tag !== null
  const spaceOf = (id: string) => id.match(/^nf-space-(.+)$/)?.[1] as SpaceId | undefined
  /* A note that is in no folder of his own says so. It used to say the name of
     the workspace it happened to be written in, which is exactly the filing he
     asked to be rid of. */
  const nameOf = (id: string) => {
    if (id === ALL) return 'All notes'
    if (id === DONE) return 'Done'
    if (spaceOf(id)) return 'No folder'
    return noteFolders.find((f) => f.id === id)?.name ?? 'No folder'
  }
  /* Done is a state, not a place: a ticked note keeps the folder it was filed
     in, and simply stops appearing there until it is un-ticked. */
  const inFolder = (n: Note, id: string) => {
    if (id === DONE) return !!n.done
    if (n.done) return false
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
    /* Searching inside Done searches Done. Searching anywhere else does not drag
       ticked notes back into the results. */
    const rows = finding
      ? notes.filter((n) => (openFolder === DONE ? !!n.done : !n.done)
        && (!tag || tagsOf(n.body).includes(tag)) && (!q || flat(n.body).includes(flat(q))))
      : notes.filter((n) => inFolder(n, openFolder))
    const by = sort === 'title'
      ? (a: Note, b: Note) => (headOf(a.body) || 'Untitled').localeCompare(headOf(b.body) || 'Untitled')
      : sort === 'created'
        ? (a: Note, b: Note) => (b.when > a.when ? 1 : b.when < a.when ? -1 : 0)
        : (a: Note, b: Note) => b.updatedAt - a.updatedAt
    if (openFolder === DONE) return rows.sort((a, b) => (b.done ?? 0) - (a.done ?? 0))
    return rows.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || by(a, b))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, finding, tag, query, openFolder, noteFolders, sort])

  /* Grouped the way a notes list has always been grouped: pinned first, then by
     date under real headings. A flat run of eighty rows has no shape and gives
     the scroll nothing to land on. */
  const groups = useMemo(() => {
    const out: { head: string; rows: Note[] }[] = []
    for (const n of shown) {
      const head = n.done ? bucketOf(localDateKey(new Date(n.done)))
        : n.pinned ? 'Pinned'
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
     Notes later does not reopen something he has since closed. */
  useEffect(() => {
    if (!noteToOpen) return
    setOpenId(noteToOpen)
    setFresh(noteToOpen)
    openNote(null)
  }, [noteToOpen, openNote])

  const open = notes.find((n) => n.id === openId) ?? null

  const create = () => {
    const id = addNote(finding || openFolder === ALL ? spaceFolderId(space) : openFolder)
    setOpenId(id)
    setFresh(id)
    window.scrollTo({ top: 0 })
  }
  /* A folder still records a space, because the stored shape has one and a
     migration would risk his notes for nothing. It is no longer shown, chosen
     or meaningful in this page: every folder is listed in one flat rail. */
  const newFolderIn: SpaceId = space
  const goFolder = (id: string) => { setOpenFolder(id); setOpenId(null); setQuery(''); setTag(null) }

  /* Every folder he made, in one list. Sorted by the order he dragged them
     into, then by name, and never by which workspace they were created in. */
  const folderList = useMemo(
    () => [...noteFolders].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)),
    [noteFolders],
  )

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
      {[{ id: spaceFolderId(n.space), name: 'No folder' }, ...folderList]
        .filter((f) => f.id !== (n.folderId ?? spaceFolderId(n.space)))
        .map((f) => (
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
            {/* Only once there is something in it: an empty Done is a row that
                asks a question nobody has. */}
            {notes.some((n) => n.done) && (
              <div className={`nt-folder-row${!finding && openFolder === DONE ? ' on' : ''}`}>
                <button className="nt-folder" aria-current={!finding && openFolder === DONE ? 'true' : undefined} onClick={() => goFolder(DONE)}>
                  <svg className="nt-doneicon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                    <path d="M4 12.5l5.5 5.5L20 6.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="nt-fname">Done</span>
                  <span className="nt-count mono">{notes.filter((n) => n.done).length}</span>
                </button>
                <span className="nt-slot" aria-hidden="true" />
              </div>
            )}
          </div>
          {/* One flat list. It used to be four workspace sections with their own
              folders nested inside, which meant a note's home depended on which
              workspace was selected when he wrote it. He asked for that gone. */}
          {folderList.map((f) => (naming?.folder === f.id ? (
            <input
              key={f.id} className="nt-rename textinput" autoFocus value={naming.value} aria-label={`Rename ${f.name}`}
              onChange={(e) => setNaming({ ...naming, value: e.target.value })}
              onBlur={submitName}
              onKeyDown={(e) => { if (e.key === 'Enter') submitName(); if (e.key === 'Escape') setNaming(null) }}
            />
          ) : (
            <div className={`nt-folder-row${!finding && openFolder === f.id ? ' on' : ''}`} key={f.id}>
              <button className="nt-folder" aria-current={!finding && openFolder === f.id ? 'true' : undefined} onClick={() => goFolder(f.id)}>
                <FolderIcon open={!finding && openFolder === f.id} />
                <span className="nt-fname">{f.name}</span>
                <span className="nt-count mono">{notes.filter((n) => inFolder(n, f.id)).length || ''}</span>
              </button>
              <Dropdown label={`${f.name} options`} className="nt-fkebab">
                <button role="menuitem" onClick={() => setNaming({ folder: f.id, value: f.name })}>Rename</button>
                <button role="menuitem" className="danger" onClick={() => deleteNoteFolder(f.id)}>Delete folder, keep the notes</button>
              </Dropdown>
            </div>
          )))}
          {naming?.space && (
            <input
              className="nt-rename textinput" autoFocus value={naming.value} placeholder="Folder name…"
              aria-label="New folder"
              onChange={(e) => setNaming({ ...naming, value: e.target.value })}
              onBlur={submitName}
              onKeyDown={(e) => { if (e.key === 'Enter') submitName(); if (e.key === 'Escape') setNaming(null) }}
            />
          )}
        </div>

        {/* One button, at the foot, naming where the folder will land. Four of
            them down the panel was four times the noise for a monthly act. */}
        <button
          className="nt-newfolder"
          title="New folder"
          onClick={() => setNaming({ space: newFolderIn, value: '' })}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
            <path d="M3 7.5A2 2 0 0 1 5 5.5h3.6a2 2 0 0 1 1.5.7l1 1.2H19a2 2 0 0 1 2 2v7.1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" strokeLinejoin="round" />
            <path d="M12 11.4v4.6M9.7 13.7h4.6" strokeLinecap="round" />
          </svg>
          New folder
        </button>
      </aside>

      {/* ---- the list ---- */}
      <div className="nt-list">
        {/* Only in Big Time, where a calendar exists, and only when there is a
            meeting worth naming. Everywhere else it renders nothing at all. It
            sits at the head of the LIST, which is where he already looks when
            he is about to start writing something. */}
        {space === 'work' && <MeetingPrompt />}
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
                  <svg className={`nt-chev${pinShut ? '' : ' open'}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                    <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              ) : (
                <p className="nt-grouphead">{g.head}</p>
              )}
              <ul hidden={g.head === 'Pinned' && pinShut}>
                {g.rows.map((n) => (
                  <li key={n.id} className="nt-rowli">
                    <button
                      className={`nt-tick${n.done ? ' on' : ''}`}
                      role="checkbox"
                      aria-checked={n.done ? 'true' : 'false'}
                      aria-label={n.done ? `Put ${headOf(n.body) || 'Untitled'} back` : `Mark ${headOf(n.body) || 'Untitled'} done`}
                      onClick={() => setNoteDone(n.id, !n.done)}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" aria-hidden="true">
                        <path d="M4 12.5l5.5 5.5L20 6.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button
                      className={`nt-row has-tick${n.id === openId ? ' on' : ''}${n.done ? ' is-done' : ''}`}
                      aria-current={n.id === openId ? 'true' : undefined}
                      onClick={() => { setOpenId(n.id); if (phone) window.scrollTo({ top: 0 }) }}
                    >
                      {/* No dot. His words: "in the notes it should not have
                          any fucking dots". The colour swatch that sat here said
                          nothing the note's own title does not, and it pushed
                          every title in the list off the left edge for the sake
                          of a decoration. */}
                      <span className="nt-rowtitle">
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
