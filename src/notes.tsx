/* Notes.

   What replaced the Brain Dump board, on his brief of 2026-08-03: folders,
   search and tags, all of them living here and nowhere else in the app.

   Three rules the whole page is built on.

   1. Two levels of folder, and only two. The top level is one folder per
      workspace and is not stored anywhere: it is computed from the workspaces
      that exist. Inside it sits whatever he made. Every folder is on screen at
      all times, in every workspace, because his notes are not something to hide
      from himself; the workspace switcher only decides which folder OPENS.

   2. Browsing is by folder, finding is not. The moment there is a search term
      or an active tag, the folder stops filtering and every note in every
      workspace is in scope, each row saying which folder it came from. A search
      that only looks in the folder you happen to be standing in is how a note
      gets declared lost while sitting three folders away.

   3. The first line is the title. No second field to fill in, nothing to keep in
      step with the body, and no note that says one thing at the top of the list
      and another inside. */

import { useEffect, useMemo, useState } from 'react'
import { AutoTextarea, Band, Dropdown } from './pages1'
import { useStore } from './store'
import { SPACE_LABELS } from './mock'
import { fmtWhen } from './util'
import { SPACES, spaceFolderId, type Note, type SpaceId } from './types'

/* The board's own palette, ids included. A different set of ids would have left
   every sticky he ever coloured falling back to the default. */
const NOTE_COLORS: { id: string; bg: string }[] = [
  { id: 'amber', bg: '#f6ead0' },
  { id: 'coral', bg: '#f3d8cd' },
  { id: 'green', bg: '#dbe4d1' },
  { id: 'blue', bg: '#d3dde6' },
  { id: 'clay', bg: '#e4d8cb' },
  { id: 'paper', bg: '#fbf8f1' },
]
const colorBg = (id: string) => NOTE_COLORS.find((c) => c.id === id)?.bg ?? '#fbf8f1'

/* A tag is a hash followed by at least one tag character. A markdown heading is
   a hash followed by a SPACE, so the two cannot be confused and neither needs
   escaping: `# Monday` is a heading, `#monday` is a tag. */
const TAG_RE = /#[\p{L}\d_/-]+/gu
const tagsOf = (t: string) => (t.match(TAG_RE) ?? []).map((x) => x.toLowerCase())

/* Czech, so accents cannot be a wall between him and his own note: typing
   "ukol" has to find "úkol", and "risa" has to find "Říša". Both sides of the
   comparison are stripped, so it works in whichever direction he types. */
const flat = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

/* ---- markdown-lite ---------------------------------------------------------
   Enough marks to write in, no editor to maintain. Headings, quotes, bullets,
   checkboxes you can actually tick, bold, italic, code, links and tags. */

const INLINE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|https?:\/\/[^\s]+|#[\p{L}\d_/-]+)/gu

function Inline({ text, onTag, hit }: { text: string; onTag?: (t: string) => void; hit?: string }) {
  const parts = text.split(INLINE)
  return (
    <>
      {parts.map((p, i) => {
        if (!p) return null
        if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>
        if (/^\*[^*]+\*$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>
        if (/^`[^`]+`$/.test(p)) return <code key={i}>{p.slice(1, -1)}</code>
        if (/^https?:\/\//.test(p)) {
          return <a key={i} href={p} target="_blank" rel="noreferrer" className="linkish">{p.replace(/^https?:\/\/(www\.)?/, '').slice(0, 44)}</a>
        }
        if (/^#/.test(p)) {
          return <button key={i} className="nt-tag" onClick={() => onTag?.(p.toLowerCase())}>{p}</button>
        }
        return <Mark key={i} text={p} hit={hit} />
      })}
    </>
  )
}

/** The search term, lit where it actually appears. A result list that will not
 *  show you WHY a note matched makes you open every one of them. */
function Mark({ text, hit }: { text: string; hit?: string }) {
  if (!hit) return <>{text}</>
  const i = flat(text).indexOf(flat(hit))
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + hit.length)}</mark>
      <Mark text={text.slice(i + hit.length)} hit={hit} />
    </>
  )
}

function NoteBody({ body, onTag, onToggle }: { body: string; onTag: (t: string) => void; onToggle: (line: number) => void }) {
  const lines = body.split('\n')
  return (
    <div className="nt-body">
      {lines.map((raw, i) => {
        const line = raw.trimEnd()
        if (!line.trim()) return <div className="nt-gap" key={i} />
        const box = line.match(/^\s*[-*]\s+\[([ xX])\]\s?(.*)$/)
        if (box) {
          const on = box[1] !== ' '
          return (
            <div className={`nt-check${on ? ' on' : ''}`} key={i}>
              <button role="checkbox" aria-checked={on} onClick={() => onToggle(i)} aria-label={box[2] || 'item'}>
                {on && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" aria-hidden="true">
                    <path d="M4 12.5L9.5 18L20 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
              <span><Inline text={box[2]} onTag={onTag} /></span>
            </div>
          )
        }
        const h = line.match(/^(#{1,3})\s+(.*)$/)
        if (h) {
          const Tag = (['h3', 'h4', 'h5'] as const)[h[1].length - 1]
          return <Tag className="nt-h" key={i}><Inline text={h[2]} onTag={onTag} /></Tag>
        }
        const q = line.match(/^>\s?(.*)$/)
        if (q) return <blockquote key={i}><Inline text={q[1]} onTag={onTag} /></blockquote>
        const li = line.match(/^\s*[-*]\s+(.*)$/)
        if (li) return <div className="nt-li" key={i}><Inline text={li[1]} onTag={onTag} /></div>
        return <p key={i}><Inline text={line} onTag={onTag} /></p>
      })}
    </div>
  )
}

/* ---- the page ------------------------------------------------------------ */

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
  const [editing, setEditing] = useState(false)
  const [newFolder, setNewFolder] = useState<SpaceId | null>(null)
  const [folderName, setFolderName] = useState('')

  /* The workspace switcher is what opens a folder. Standing in Personal opens
     Personal; every other folder stays on screen and one click away. */
  useEffect(() => { setOpenFolder(home); setOpenId(null) }, [home])

  const finding = query.trim().length > 0 || tag !== null
  const folderOf = (id: string) => {
    const m = id.match(/^nf-space-(.+)$/)
    if (m) return { name: SPACE_LABELS[m[1] as SpaceId] ?? 'Workspace', path: SPACE_LABELS[m[1] as SpaceId] ?? '' }
    const f = noteFolders.find((x) => x.id === id)
    return f ? { name: f.name, path: `${SPACE_LABELS[f.space]} / ${f.name}` } : { name: 'Notes', path: 'Notes' }
  }

  const allTags = useMemo(() => {
    const count = new Map<string, number>()
    for (const n of notes) for (const t of new Set(tagsOf(n.body))) count.set(t, (count.get(t) ?? 0) + 1)
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [notes])

  const shown = useMemo(() => {
    const q = query.trim()
    const rows = finding
      ? notes.filter((n) => (!tag || tagsOf(n.body).includes(tag)) && (!q || flat(n.body).includes(flat(q))))
      : notes.filter((n) => n.folderId === openFolder)
    return rows.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt)
  }, [notes, finding, tag, query, openFolder])

  const open = notes.find((n) => n.id === openId) ?? null

  /* On a phone the note takes the whole screen, and the screen is wherever he
     had scrolled to. Opening one from halfway down the list otherwise lands him
     in the middle of it, or below its end. */
  const show = (id: string) => {
    setOpenId(id)
    if (window.innerWidth <= 760) window.scrollTo({ top: 0 })
  }

  /* A new note lands where he is standing. In a search there is no folder to
     stand in, so it goes to the workspace he is working in. */
  const create = () => {
    const id = addNote(finding ? home : openFolder)
    show(id)
    setEditing(true)
  }

  const toggleLine = (n: Note, line: number) => {
    const lines = n.body.split('\n')
    lines[line] = lines[line].replace(/^(\s*[-*]\s+\[)([ xX])(\])/, (_m, a, c, b) => `${a}${c === ' ' ? 'x' : ' '}${b}`)
    updateNote(n.id, { body: lines.join('\n') })
  }

  const submitFolder = () => {
    if (!newFolder || !folderName.trim()) { setNewFolder(null); setFolderName(''); return }
    const id = addNoteFolder(newFolder, folderName)
    setNewFolder(null); setFolderName('')
    setOpenFolder(id); setOpenId(null); setQuery(''); setTag(null)
  }

  return (
    <div className="page">
      <Band
        title="Notes"
        metrics={[{ v: String(notes.length), k: notes.length === 1 ? 'note' : 'notes' }]}
        actions={<button className="btn btn-primary" onClick={create}>New note</button>}
      />

      <div className={`nt-wrap${open ? ' with-note' : ''}`}>
        {/* ---- folders ---- */}
        <aside className="nt-rail" aria-label="Folders">
          {SPACES.map((s) => {
            const wid = spaceFolderId(s)
            const mine = noteFolders.filter((f) => f.space === s).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
            const at = (id: string) => !finding && openFolder === id
            const count = (id: string) => notes.filter((n) => n.folderId === id).length
            return (
              <div className="nt-group" key={s}>
                <button
                  className={`nt-folder nt-top${at(wid) ? ' on' : ''}`}
                  aria-current={at(wid) ? 'true' : undefined}
                  onClick={() => { setOpenFolder(wid); setOpenId(null); setQuery(''); setTag(null) }}
                >
                  <span className="nt-fname">{SPACE_LABELS[s]}</span>
                  <span className="mono nt-count">{count(wid) || ''}</span>
                </button>
                {mine.map((f) => (
                  <div className="nt-folder-row" key={f.id}>
                    <button
                      className={`nt-folder${at(f.id) ? ' on' : ''}`}
                      aria-current={at(f.id) ? 'true' : undefined}
                      onClick={() => { setOpenFolder(f.id); setOpenId(null); setQuery(''); setTag(null) }}
                    >
                      <span className="nt-fname">{f.name}</span>
                      <span className="mono nt-count">{count(f.id) || ''}</span>
                    </button>
                    <Dropdown label={`${f.name} options`} className="nt-fkebab">
                      <button role="menuitem" onClick={() => {
                        const name = window.prompt('Folder name', f.name)
                        if (name !== null) renameNoteFolder(f.id, name)
                      }}>Rename</button>
                      <button role="menuitem" className="danger" onClick={() => deleteNoteFolder(f.id)}>
                        Delete folder, keep the notes
                      </button>
                    </Dropdown>
                  </div>
                ))}
                {newFolder === s ? (
                  <input
                    className="textinput nt-newfolder" autoFocus value={folderName}
                    placeholder="Folder name" aria-label={`New folder in ${SPACE_LABELS[s]}`}
                    onChange={(e) => setFolderName(e.target.value)}
                    onBlur={submitFolder}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitFolder(); if (e.key === 'Escape') { setNewFolder(null); setFolderName('') } }}
                  />
                ) : (
                  <button className="nt-addfolder" onClick={() => { setNewFolder(s); setFolderName('') }}>
                    New folder
                  </button>
                )}
              </div>
            )
          })}
        </aside>

        {/* ---- search, tags, list ---- */}
        <div className="nt-list">
          <div className="nt-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" strokeLinecap="round" />
            </svg>
            <input
              className="textinput" type="search" value={query} placeholder="Search every note"
              aria-label="Search notes" onChange={(e) => setQuery(e.target.value)}
            />
            {finding && (
              <button className="btn btn-ghost nt-clear" onClick={() => { setQuery(''); setTag(null) }}>Clear</button>
            )}
          </div>

          {allTags.length > 0 && (
            <div className="nt-tags">
              {allTags.map(([t, n]) => (
                <button key={t} className={`note-chip${tag === t ? ' on' : ''}`} onClick={() => setTag(tag === t ? null : t)}>
                  {t}<span className="mono"> {n}</span>
                </button>
              ))}
              {tag && (
                <button className="nt-renametag" onClick={() => {
                  const to = window.prompt(`Rename ${tag} everywhere it appears`, tag.replace('#', ''))
                  if (to) { renameNoteTag(tag, to); setTag(`#${to.replace(/^#/, '').toLowerCase()}`) }
                }}>Rename {tag}</button>
              )}
            </div>
          )}

          <p className="nt-scope">
            {finding
              ? `${shown.length} ${shown.length === 1 ? 'note' : 'notes'} across every folder`
              : folderOf(openFolder).path}
          </p>

          <ul className="nt-rows">
            {shown.map((n) => (
              <li key={n.id}>
                <button
                  className={`nt-row${n.id === openId ? ' on' : ''}`}
                  aria-current={n.id === openId ? 'true' : undefined}
                  onClick={() => { show(n.id); setEditing(false) }}
                >
                  <span className="nt-swatch" style={{ background: colorBg(n.color) }} aria-hidden="true" />
                  <span className="nt-rowmain">
                    <span className="nt-rowtitle">
                      {n.pinned && <span className="nt-pin" aria-label="Pinned">◆</span>}
                      <Mark text={n.title || 'Empty note'} hit={query.trim() || undefined} />
                    </span>
                    <span className="nt-rowsnip"><Mark text={snippet(n, query)} hit={query.trim() || undefined} /></span>
                  </span>
                  <span className="nt-rowmeta">
                    <span className="mono">{fmtWhen(n.when)}</span>
                    {finding && <span className="nt-rowfolder">{folderOf(n.folderId).name}</span>}
                    {n.conflict && <span className="nt-flag">two versions</span>}
                  </span>
                </button>
              </li>
            ))}
            {shown.length === 0 && (
              <li className="nt-empty">
                {finding
                  ? 'Nothing matches. The search reads every folder in every workspace, so this is the whole answer.'
                  : 'Nothing in this folder yet.'}
              </li>
            )}
          </ul>
        </div>

        {/* ---- the open note ---- */}
        {open && (
          <article className="nt-note" aria-label={open.title || 'Note'}>
            <div className="nt-notebar">
              <button className="btn btn-ghost nt-back" onClick={() => { setOpenId(null); setEditing(false) }} aria-label="Close note">
                Close
              </button>
              <span className="mono nt-when">{fmtWhen(open.when)}</span>
              <div className="nt-swatches" role="radiogroup" aria-label="Note colour">
                {NOTE_COLORS.map((c) => (
                  <button
                    key={c.id} className={`note-swatch${open.color === c.id ? ' on' : ''}`} style={{ background: c.bg }}
                    aria-label={c.id} aria-pressed={open.color === c.id} onClick={() => updateNote(open.id, { color: c.id })}
                  />
                ))}
              </div>
              <Dropdown label="Note options" className="nt-kebab">
                <button role="menuitem" onClick={() => updateNote(open.id, { pinned: !open.pinned })}>
                  {open.pinned ? 'Unpin' : 'Pin to the top'}
                </button>
                <button role="menuitem" onClick={() => {
                  addTask({ title: (open.title || open.body).replace(TAG_RE, '').trim().slice(0, 120), source: 'mc', estimateMin: 0, space: open.space, list: 'backlog', category: 'deep' })
                  setPage('plan')
                }}>Make it a task</button>
                <span className="kebab-head">Move to</span>
                {SPACES.flatMap((s) => [
                  { id: spaceFolderId(s), name: SPACE_LABELS[s] },
                  ...noteFolders.filter((f) => f.space === s).map((f) => ({ id: f.id, name: `${SPACE_LABELS[s]} / ${f.name}` })),
                ]).filter((f) => f.id !== open.folderId).map((f) => (
                  <button key={f.id} role="menuitem" onClick={() => moveNote(open.id, f.id)}>{f.name}</button>
                ))}
                <button role="menuitem" className="danger" onClick={() => { deleteNote(open.id); setOpenId(null) }}>Delete</button>
              </Dropdown>
            </div>

            {open.conflict && (
              <div className="nt-conflict">
                <p className="nt-conflict-head">
                  Another device had a different version of this note, saved {fmtWhen(new Date(open.conflict.at).toISOString().slice(0, 10))}. It is kept here until you say what happens to it.
                </p>
                <pre>{open.conflict.body}</pre>
                <div className="nt-conflict-acts">
                  <button className="btn btn-primary" onClick={() => keepNoteConflict(open.id)}>Add it to this note</button>
                  <button className="btn btn-ghost" onClick={() => dropNoteConflict(open.id)}>Discard it</button>
                </div>
              </div>
            )}

            {editing ? (
              <Editor note={open} onChange={(body) => updateNote(open.id, { body })} onDone={() => setEditing(false)} />
            ) : (
              <div
                className="nt-read" role="textbox" tabIndex={0} aria-label="Note, click to edit"
                onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) setEditing(true) }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setEditing(true) } }}
              >
                {open.body.trim()
                  ? <NoteBody body={open.body} onTag={(t) => { setTag(t); setQuery('') }} onToggle={(l) => toggleLine(open, l)} />
                  : <p className="nt-placeholder">Write it here. A line starting with # and a space is a heading, #like-this is a tag.</p>}
              </div>
            )}
          </article>
        )}
      </div>
    </div>
  )
}

/** The line of a note worth showing under its title: in a search, the line that
 *  actually matched, otherwise whatever follows the title. Never the title
 *  again, because a one-line note printed twice says nothing the second time. */
function snippet(n: Note, query: string): string {
  const lines = n.body.split('\n').map((l) => plain(l)).filter(Boolean)
  const rest = lines.filter((l) => l !== n.title)
  const q = query.trim()
  if (q) {
    const hit = rest.find((l) => flat(l).includes(flat(q)))
    if (hit) return hit.slice(0, 200)
  }
  return (rest[0] ?? '').slice(0, 200)
}

/** A line with its marks taken off, for the places that show text rather than
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

/* Editing is a plain textarea, and that is the whole point: a rich editor would
   be a second project, and its output does not survive a merge the way a string
   does. Reading is where the marks turn into shape. */
function Editor({ note, onChange, onDone }: { note: Note; onChange: (body: string) => void; onDone: () => void }) {
  /* The caret goes to the end of what is already written, not the start, so
     opening a note to add a line does not mean scrolling and clicking first. */
  const atEnd = (el: HTMLTextAreaElement | null) => el?.setSelectionRange(el.value.length, el.value.length)
  return (
    <div className="nt-edit">
      <AutoTextarea
        autoFocus
        onFocus={(e) => atEnd(e.currentTarget)}
        className="textinput" minRows={12} maxRows={40} value={note.body}
        aria-label="Note text"
        placeholder="Write it here. A line starting with # and a space is a heading, #like-this is a tag."
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') onDone() }}
      />
      <button className="btn btn-primary nt-done" onClick={onDone}>Done</button>
    </div>
  )
}
