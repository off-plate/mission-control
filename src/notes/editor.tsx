/* The note editor. Split out of notes.tsx in the #80 refactor; restored
   2026-11-18 from the pre-refactor code because this folder was never
   committed and main could not build. */

import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { htmlToMd, mdToHtml } from '../richtext'
import { helpWithNote, type HelpResult } from '../notesai'
import type { Note } from '../types'
import * as Icon from '../icons'
import { headOf, restOf } from './shared'

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

/* Provider-neutral on purpose, unlike Settings and Break It Down: /help tries
   Groq's own compound-mini first for its web search, then falls back to
   whichever provider Settings has active (notesai.ts, 2026-09-07), so a
   terminal 'bad-key' here can genuinely be either one's key -- naming the
   wrong provider would be worse than naming none. The parenthetical detail
   appended below already carries the actual model when it is worth knowing. */
const HELP_ERROR: Record<Exclude<HelpResult, { ok: true }>['reason'], string> = {
  'no-key': 'No AI key yet. Add one in Settings and /help can actually answer.',
  'bad-key': 'That key was rejected. Check it in Settings.',
  'rate-limit': 'Rate-limited right now. Try again in a moment.',
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

/* What "/" can do, in his words rather than the code's.

   He asked for this after the obvious happened: two commands exist, both are
   invisible, and remembering which is which is a job the app should be doing.
   "I'm struggling that I will write the slash, and I have to remember what is
   in there."

   The second line of each entry is not a subtitle under a title, which the
   canon forbids. It is the whole payload: the name alone is what he already
   could not remember, so a menu that showed only names would be the same
   problem in a box. */
const SLASH: { cmd: string; says: string; needs: 'help' | 'task' }[] = [
  { cmd: 'help', says: 'Ask about this note, the answer lands in it', needs: 'help' },
  { cmd: 'task', says: 'Put this line on the to-do list', needs: 'task' },
]

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

  /* ---- the "/" menu ------------------------------------------------------
     Only ever offers what this editor can actually do. The Zone's editor gets
     neither command, so it gets no menu; a menu that lists something the press
     of Enter will ignore is worse than no menu. */
  const available = SLASH.filter((c) => (c.needs === 'help' ? slashHelp : slashTask))
  const [menu, setMenu] = useState<{ q: string; x: number; y: number; up: boolean; i: number } | null>(null)
  const shown = menu ? available.filter((c) => c.cmd.startsWith(menu.q.toLowerCase())) : []

  /** The text from the start of the current line up to the caret. Read through
   *  a Range rather than off a text node, because a line is often several nodes
   *  once there is a bold word in it and the caret can sit in any of them. */
  const beforeCaret = (): { text: string; range: Range } | null => {
    const sel = window.getSelection()
    const root = ref.current
    if (!sel || !sel.isCollapsed || !root || !sel.rangeCount) return null
    const r = sel.getRangeAt(0)
    if (!root.contains(r.endContainer)) return null
    const block = lineAt(root)
    if (!block) return null
    const pre = document.createRange()
    pre.selectNodeContents(block)
    try { pre.setEnd(r.endContainer, r.endOffset) } catch { return null }
    return { text: pre.toString(), range: r }
  }

  /* Open on a "/" that starts a word, keep it open while he narrows it, close
     as soon as what he typed stops being a command. A slash mid-word is a date
     or a path, never a command, so it is left alone. */
  const trackMenu = () => {
    if (!available.length) return
    const at = beforeCaret()
    if (!at) { setMenu(null); return }
    const m = at.text.match(/(?:^|\s)\/([a-z]*)$/i)
    if (!m) { setMenu(null); return }
    /* He has typed the whole command. There is nothing left to offer him, and
       leaving the menu up would be worse than useless: it owns Enter while it
       is open, so pressing Enter would re-insert the command he had just
       finished typing instead of running it. That is exactly what broke the
       trailing "33 tis /task" form and the one inside a list, and the suite
       caught both. A complete command belongs to the line, not to the menu. */
    if (available.some((c) => c.cmd === m[1].toLowerCase())) { setMenu(null); return }
    const rect = at.range.getClientRects()[0] ?? lineAt(ref.current!)?.getBoundingClientRect()
    if (!rect) { setMenu(null); return }
    /* Open upward when there is no room below. The Zone's note panel sits on
       the floor of the window, so a menu that always drops downward opens off
       the bottom of the screen and he never sees it. 132px covers the two
       rows plus padding; being a little pessimistic only means it flips a
       line early, which costs nothing. */
    const up = rect.bottom + 132 > window.innerHeight
    setMenu((prev) => ({
      q: m[1],
      x: rect.left,
      y: up ? window.innerHeight - rect.top : rect.bottom,
      up,
      i: prev && prev.q === m[1] ? prev.i : 0,
    }))
  }

  /** Swap the half-typed "/wha" for the real command and leave the caret ready
   *  for the argument. The token has no spaces in it, so it lives inside one
   *  text node and can be found there.
   *
   *  The insert goes through execCommand rather than through the text node
   *  directly, and that is not laziness. The command ends in a space, and a
   *  trailing space at the end of a line is collapsed in contenteditable: put
   *  the caret after it by hand and the browser quietly moves it back in front,
   *  so the next character he types lands against the command and "/task x"
   *  comes out as "/taskx". Letting the browser perform the insert makes the
   *  space a real one and leaves the caret where it belongs. */
  const accept = (cmd: string) => {
    setMenu(null)
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return
    const r = sel.getRangeAt(0)
    const node = r.endContainer
    if (node.nodeType !== 3) return
    const t = node as Text
    const start = t.data.slice(0, r.endOffset).lastIndexOf('/')
    if (start < 0) return
    const token = document.createRange()
    token.setStart(t, start)
    token.setEnd(t, r.endOffset)
    sel.removeAllRanges()
    sel.addRange(token)
    document.execCommand('insertText', false, `/${cmd} `)
    emit()
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
      /* The reason in his language, plus whatever Groq actually said. A line
         that only says "that did not go through" is the same to him as the
         feature being broken, and he read it exactly that way. */
      err.textContent = result.detail
        ? `${HELP_ERROR[result.reason]} (${result.detail})`
        : HELP_ERROR[result.reason]
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

  /* A link inside an editable box only moves the caret when clicked, so the
     browser never follows it. Open it ourselves on a plain click or tap; a
     drag that selects the link's text still selects it, so it stays editable. */
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null
    if (!a || !/^(https?:|mailto:|tel:)/i.test(a.href)) return
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return
    e.preventDefault()
    window.open(a.href, '_blank', 'noopener,noreferrer')
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
          <Icon.List size={17} />
        </T>
        )}
        {show('checklist') && (
        <T label="Checklist" on={checklist}>
          <Icon.Checklist size={17} />
        </T>
        )}
        {show('quote') && <T label="Quote" on={() => toggleBlock('blockquote')}>&rdquo;</T>}
        </span>
        )}
        {(show('divider') || show('table')) && (
        <span className="nt-toolgroup">
        {show('divider') && (
        <T label="Divider" on={divider}>
          <Icon.Divider size={17} />
        </T>
        )}
        {show('table') && (
        <>
        <TablePicker onPick={insertTable} />
        <T label="Add a row" on={() => grow('row')}>
          <Icon.TableRowAdd size={17} />
        </T>
        <T label="Add a column" on={() => grow('col')}>
          <Icon.TableColAdd size={17} />
        </T>
        </>
        )}
        </span>
        )}
        {show('clear') && (
        <span className="nt-toolgroup">
        <T label="Clear formatting" on={() => cmd('removeFormat')}>
          <Icon.ClearFormat size={17} />
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
        onInput={() => { autoformat(); emit(); trackMenu() }}
        /* Moving the caret with the mouse or the arrows can carry it out of the
           token that opened the menu, and a menu still sitting there is a menu
           that will act on the wrong line. */
        onKeyUp={(e) => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') trackMenu() }}
        onMouseUp={trackMenu}
        onBlur={() => { setMenu(null); emit() }}
        onMouseDown={onMouseDown}
        onClick={onClick}
            onKeyDown={(e) => {
              /* The menu owns these keys while it is open, and only then, so
                 Enter still sends a command and Escape still does nothing when
                 there is no menu to close. */
              if (menu && shown.length) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  const d = e.key === 'ArrowDown' ? 1 : -1
                  setMenu({ ...menu, i: (menu.i + d + shown.length) % shown.length })
                  return
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault()
                  accept(shown[Math.min(menu.i, shown.length - 1)].cmd)
                  return
                }
                if (e.key === 'Escape') { e.preventDefault(); setMenu(null); return }
              }
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
          {menu && shown.length > 0 && (
            <div
              className="nt-slash"
              style={menu.up ? { left: menu.x, bottom: menu.y + 6 } : { left: menu.x, top: menu.y + 6 }}
              role="listbox"
              aria-label="Commands"
            >
              {shown.map((c, i) => (
                <button
                  key={c.cmd}
                  type="button"
                  className="nt-slash-row"
                  role="option"
                  aria-selected={i === Math.min(menu.i, shown.length - 1)}
                  /* Down, not click: a click lands after the editor has already
                     lost the selection, and the token to replace is gone with
                     it. */
                  onMouseDown={(e) => { e.preventDefault(); accept(c.cmd) }}
                  /* Move, not enter. The menu opens underneath wherever the
                     pointer happens to be resting, and mouseenter fires on
                     appearance, so the highlighted row was being chosen by
                     where the mouse had been left rather than being the first
                     one. Then Enter ran the wrong command. mousemove only fires
                     when the mouse actually moves, which is the moment he is
                     genuinely pointing at something. */
                  onMouseMove={() => { if (menu.i !== i) setMenu({ ...menu, i }) }}
                >
                  <span className="nt-slash-cmd">/{c.cmd}</span>
                  <span className="nt-slash-says">{c.says}</span>
                </button>
              ))}
            </div>
          )}
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
        <Icon.Table size={17} />
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
