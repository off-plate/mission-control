/* Markdown in, editable HTML out, and back again.

   Notes are stored as markdown text, because a plain string is the only thing
   that survives the blob merge intact and can be diffed, searched and hashed.
   But Michael writes in the note, not in a syntax: typing "- " has to make a
   bullet, cmd-B has to make bold, and a checkbox has to be a checkbox. So the
   editor is a contenteditable that speaks HTML, and this file is the hinge
   between the two.

   The rule that governs every line here: THE ROUND TRIP MUST NOT LOSE TEXT.
   md -> html -> md has to give back what it was handed, or a paragraph goes
   missing the first time he pastes something unusual. Anything this file does
   not understand is carried through as a plain paragraph rather than dropped. */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/* Inline marks. The same alternation the reader uses, so what he sees while
   writing and what he sees after are produced by one definition. */
const INLINE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|https?:\/\/[^\s]+|#[\p{L}\d_/-]+)/gu

function inlineToHtml(text: string): string {
  return text.split(INLINE).map((p) => {
    if (!p) return ''
    if (/^\*\*[^*]+\*\*$/.test(p)) return `<strong>${esc(p.slice(2, -2))}</strong>`
    if (/^\*[^*]+\*$/.test(p)) return `<em>${esc(p.slice(1, -1))}</em>`
    if (/^`[^`]+`$/.test(p)) return `<code>${esc(p.slice(1, -1))}</code>`
    if (/^https?:\/\//.test(p)) return `<a href="${esc(p)}" target="_blank" rel="noreferrer">${esc(p)}</a>`
    if (/^#/.test(p)) return `<span class="tag">${esc(p)}</span>`
    return esc(p)
  }).join('') || '<br>'
}

/** Markdown to the HTML the editor holds. */
export function mdToHtml(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  /* One entry per open list level, and whether that level currently has an item
     still open. A nested list must go INSIDE its parent's <li>, never beside
     it: a <ul> loose in a <ul> is invalid, the browser reparents it, and every
     nested item was being dropped on the way back to markdown. */
  const open: { kind: 'ul' | 'todo' }[] = []
  const hasLi: boolean[] = []
  const closeTo = (d: number) => {
    while (open.length > d) {
      if (hasLi[open.length - 1]) out.push('</li>')
      out.push('</ul>')
      open.pop(); hasLi.pop()
    }
  }
  const shut = () => closeTo(0)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, '')

    /* A pipe table, GFM style. The separator row is what tells a table from a
       line that merely has pipes in it, so both rows have to be there. */
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
      shut()
      const rows: string[][] = []
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      const head = cells(line)
      i += 1
      while (i + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[i + 1] ?? '')) { i += 1; rows.push(cells(lines[i])) }
      const width = Math.max(head.length, ...rows.map((r) => r.length), 1)
      const cellsOf = (r: string[], tag: string) =>
        Array.from({ length: width }, (_, c) => `<${tag}>${inlineToHtml(r[c] ?? '')}</${tag}>`).join('')
      out.push(`<table><thead><tr>${cellsOf(head, 'th')}</tr></thead><tbody>${rows.map((r) => `<tr>${cellsOf(r, 'td')}</tr>`).join('')}</tbody></table>`)
      continue
    }

    /* Three dashes or more on their own line: a divider. */
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { shut(); out.push('<hr>'); continue }

    /* Lists nest. Two spaces of indent is one level down, which is how markdown
       writes it and what Tab in the editor produces. */
    const item = line.match(/^(\s*)[-*]\s+(\[([ xX])\]\s?)?(.*)$/)
    if (item) {
      const d = Math.floor(item[1].replace(/\t/g, '  ').length / 2)
      const todo = item[2] ? (item[3] === ' ' ? '0' : '1') : null
      const kind: 'ul' | 'todo' = todo === null ? 'ul' : 'todo'
      closeTo(d + 1)
      /* A checklist under bullets is its own list, or its items would inherit
         the wrong marker. */
      if (open.length === d + 1 && open[d].kind !== kind) closeTo(d)
      if (open.length === d + 1) {
        if (hasLi[d]) { out.push('</li>'); hasLi[d] = false }
      } else {
        while (open.length < d + 1) {
          out.push(`<ul${kind === 'todo' ? ' class="todo"' : ''}>`)
          open.push({ kind }); hasLi.push(false)
        }
      }
      out.push(`<li${todo === null ? '' : ` data-done="${todo}"`}>${inlineToHtml(item[4])}`)
      hasLi[d] = true
      continue
    }

    shut()
    const h = line.match(/^(#{1,3})\s+(.*)$/)
    if (h) { out.push(`<h${h[1].length + 2}>${inlineToHtml(h[2])}</h${h[1].length + 2}>`); continue }
    const q = line.match(/^>\s?(.*)$/)
    if (q) { out.push(`<blockquote>${inlineToHtml(q[1])}</blockquote>`); continue }
    out.push(`<p>${line.trim() ? inlineToHtml(line) : '<br>'}</p>`)
  }
  shut()
  return out.join('') || '<p><br></p>'
}

/* Inline HTML back to markdown. Recursive, so a bold word inside a list item
   inside a quote still comes back as text with its marks around it. */
function inlineToMd(node: Node): string {
  if (node.nodeType === 3) return node.nodeValue ?? ''
  if (node.nodeType !== 1) return ''
  const el = node as HTMLElement
  const kids = () => [...el.childNodes].map(inlineToMd).join('')
  switch (el.tagName) {
    case 'BR': return '\n'
    case 'STRONG': case 'B': { const t = kids(); return t.trim() ? `**${t}**` : t }
    case 'EM': case 'I': { const t = kids(); return t.trim() ? `*${t}*` : t }
    case 'CODE': { const t = kids(); return t.trim() ? `\`${t}\`` : t }
    /* A link keeps its address, not its label: the reader shortens the address
       for display, and storing the label would lose where it actually points. */
    case 'A': return el.getAttribute('href') || kids()
    default: return kids()
  }
}

/** The editor's HTML back to the markdown that gets stored. */
export function htmlToMd(root: HTMLElement): string {
  const out: string[] = []
  const push = (s: string) => out.push(...s.split('\n'))

  /* A list, at whatever depth. Two spaces per level, and a nested list inside an
     item is written after that item's own line rather than swallowed into it. */
  const list = (ul: HTMLElement, depth: number) => {
    for (const li of [...ul.children]) {
      /* Chrome's own indent puts the nested list BESIDE the item rather than
         inside it. Invalid, tolerated by the browser, and it used to make every
         indented line vanish on the way back to markdown. Read it either way. */
      if (li.tagName === 'UL' || li.tagName === 'OL') { list(li as HTMLElement, depth + 1); continue }
      if (li.tagName !== 'LI') continue
      const el = li as HTMLElement
      const done = el.dataset.done
      const mark = done === undefined ? '-' : `- [${done === '1' ? 'x' : ' '}]`
      /* The item's OWN text, without the text of the lists nested inside it. */
      const own = [...el.childNodes].filter((n) => !(n.nodeType === 1 && ((n as HTMLElement).tagName === 'UL' || (n as HTMLElement).tagName === 'OL')))
      push(`${'  '.repeat(depth)}${mark} ${own.map(inlineToMd).join('').trim()}`)
      for (const kid of [...el.children]) {
        if (kid.tagName === 'UL' || kid.tagName === 'OL') list(kid as HTMLElement, depth + 1)
      }
    }
  }

  const block = (el: HTMLElement) => {
    switch (el.tagName) {
      case 'H1': case 'H2': case 'H3': push(`# ${inlineToMd(el).trim()}`); return
      case 'H4': push(`## ${inlineToMd(el).trim()}`); return
      case 'H5': case 'H6': push(`### ${inlineToMd(el).trim()}`); return
      case 'BLOCKQUOTE': push(`> ${inlineToMd(el).trim()}`); return
      case 'HR': push('---'); return
      case 'TABLE': {
        const rows = [...el.querySelectorAll('tr')]
        if (!rows.length) return
        const cellsOf = (tr: Element) => [...tr.children].map((c) => inlineToMd(c).trim().replace(/\|/g, '\\|') || ' ')
        const width = Math.max(...rows.map((r) => r.children.length), 1)
        const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? ' ')
        push(`| ${pad(cellsOf(rows[0])).join(' | ')} |`)
        push(`|${' --- |'.repeat(width)}`)
        for (const r of rows.slice(1)) push(`| ${pad(cellsOf(r)).join(' | ')} |`)
        return
      }
      case 'UL': case 'OL': { list(el, 0); return }
      /* A bare <br> paragraph is a blank line he typed on purpose. */
      default: push(inlineToMd(el).replace(/ /g, ' ').replace(/\s+$/, ''))
    }
  }

  for (const node of [...root.childNodes]) {
    if (node.nodeType === 3) { const t = node.nodeValue ?? ''; if (t.trim()) push(t); continue }
    if (node.nodeType !== 1) continue
    block(node as HTMLElement)
  }
  /* Trailing blank lines are an artefact of the editor, not something he wrote. */
  while (out.length && !out[out.length - 1].trim()) out.pop()
  return out.join('\n')
}
