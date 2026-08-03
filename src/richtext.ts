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
  let list: 'ul' | 'todo' | null = null
  const shut = () => { if (list) { out.push('</ul>'); list = null } }

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
    /* Three dashes or more on their own line: a divider, his ask of 2026-08-03. */
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { shut(); out.push('<hr>'); continue }
    const todo = line.match(/^\s*[-*]\s+\[([ xX])\]\s?(.*)$/)
    if (todo) {
      if (list !== 'todo') { shut(); out.push('<ul class="todo">'); list = 'todo' }
      out.push(`<li data-done="${todo[1] === ' ' ? '0' : '1'}">${inlineToHtml(todo[2])}</li>`)
      continue
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    if (bullet) {
      if (list !== 'ul') { shut(); out.push('<ul>'); list = 'ul' }
      out.push(`<li>${inlineToHtml(bullet[1])}</li>`)
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
      case 'UL': case 'OL': {
        for (const li of [...el.children]) {
          const done = (li as HTMLElement).dataset.done
          const mark = done === undefined ? '-' : `- [${done === '1' ? 'x' : ' '}]`
          push(`${mark} ${inlineToMd(li).trim()}`)
        }
        return
      }
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
