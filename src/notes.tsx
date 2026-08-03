/* Notes.

   Rebuilt 2026-08-03, same day as the first version, after Michael saw it and
   the design review agreed with him. The first one was a three-pane mail
   client: a folder tree, a message list and a reading pane, holding 21
   navigation controls to serve 11 notes, with his own writing the smallest
   thing on the page. This app is meant to look like Streaks or Sunsama, not
   like Outlook.

   What the rebuild is built on.

   1. TWO STATES, NOT THREE PANES. Browsing is a list. Reading replaces the
      list, it does not squeeze in beside it. One thing on the screen at a time.
   2. THE NOTE IS THE PAGE. No card, no border, no panel around his writing.
      Paper on paper, one centred measure, the title at the size of a title.
   3. FOLDERS ARE A ROW, NOT A WALL. Every folder in every workspace is still
      on screen at all times, as he asked, but as one wrapping strip of chips
      under the heading rather than a rail down the side. Clicking a workspace
      shows everything in it; clicking one of his folders narrows to that.
   4. BROWSING IS BY FOLDER, FINDING IS NOT. A search term or a tag drops the
      folder and reads every note in every workspace, each row saying where it
      came from. A search that only sees the folder you happen to be standing
      in is how a note gets declared lost while sitting three folders away.
   5. THE FIRST LINE IS THE TITLE, everywhere and always. It is a real heading
      in the note, not only in the list, and it is the same size whether he is
      reading or writing. Only the body flips between rendered and raw, so
      there is no moment where his formatted note turns back into plumbing. */

import { useEffect, useMemo, useState } from 'react'
import { AutoTextarea, Band, Dropdown } from './pages1'
import { useStore } from './store'
import { SPACE_LABELS } from './mock'
import { fmtWhen } from './util'
import { SPACES, spaceFolderId, type Note, type SpaceId } from './types'

/* The board's own palette, ids included, so every sticky he ever coloured keeps
   its colour. It lives in the kebab now: a six-dot rainbow above a note about a
   hundred thousand koruna of debt was the loudest thing on the screen. */
const NOTE_COLORS: { id: string; bg: string; label: string }[] = [
  { id: 'amber', bg: '#f6ead0', label: 'Amber' },
  { id: 'coral', bg: '#f3d8cd', label: 'Coral' },
  { id: 'green', bg: '#dbe4d1', label: 'Green' },
  { id: 'blue', bg: '#d3dde6', label: 'Blue' },
  { id: 'clay', bg: '#e4d8cb', label: 'Clay' },
  { id: 'paper', bg: '#fbf8f1', label: 'Paper' },
]
const colorBg = (id: string) => NOTE_COLORS.find((c) => c.id === id)?.bg ?? '#fbf8f1'

/* A tag is a hash followed by at least one tag character. A markdown heading is
   a hash followed by a SPACE, so the two cannot be confused: `# Monday` is a
   heading, `#monday` is a tag. */
const TAG_RE = /#[\p{L}\d_/-]+/gu
const tagsOf = (t: string) => (t.match(TAG_RE) ?? []).map((x) => x.toLowerCase())

/* Czech, so accents are not a wall between him and his own note: typing "ukol"
   has to find "úkol" and "risa" has to find "Říša". Both sides are stripped, so
   it works whichever way round he types it. */
const flat = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

/** Line one, and everything after it. The title is not a second field to keep in
 *  step with the text: it IS the text's first line. */
const headOf = (body: string) => (body.split('\n')[0] ?? '').replace(/^\s*#{1,3}\s+/, '')
const restOf = (body: string) => body.split('\n').slice(1).join('\n')
const join = (head: string, rest: string) => (rest ? `${head}\n${rest}` : head)

/* ---- markdown-lite ---------------------------------------------------------
   Enough marks to write in, no editor to maintain. Headings, quotes, bullets,
   checkboxes he can tick without entering an edit mode, bold, italic, code,
   links and tags. */

const INLINE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|https?:\/\/[^\s]+|#[\p{L}\d_/-]+)/gu

function Inline({ text, onTag, hit }: { text: string; onTag?: (t: string) => void; hit?: string }) {
  return (
    <>
      {text.split(INLINE).map((p, i) => {
        if (!p) return null
        if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>
        if (/^\*[^*]+\*$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>
        if (/^`[^`]+`$/.test(p)) return <code key={i}>{p.slice(1, -1)}</code>
        if (/^https?:\/\//.test(p)) {
          return <a key={i} href={p} target="_blank" rel="noreferrer" className="linkish">{p.replace(/^https?:\/\/(www\.)?/, '').slice(0, 44)}</a>
        }
        if (/^#/.test(p)) return <button key={i} className="nt-tag" onClick={() => onTag?.(p.toLowerCase())}>{p}</button>
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

/** The body, minus its first line: that one is the title and is drawn above. */
function NoteBody({ body, onTag, onToggle }: { body: string; onTag: (t: string) => void; onToggle: (line: number) => void }) {
  return (
    <div className="nt-body">
      {body.split('\n').map((raw, i) => {
        const line = raw.trimEnd()
        if (!line.trim()) return <div className="nt-gap" key={i} />
        const box = line.match(/^\s*[-*]\s+\[([ xX])\]\s?(.*)$/)
        if (box) {
          const on = box[1] !== ' '
          return (
            <div className={`nt-check${on ? ' on' : ''}`} key={i}>
              <button role="checkbox" aria-checked={on} onClick={() => onToggle(i)} aria-label={box[2] || 'item'}>
                {on && (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" aria-hidden="true">
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
  const [searching, setSearching] = useState(false)
  const [editing, setEditing] = useState(false)
  /* The note just made, so its title takes the caret rather than its body. */
  const [fresh, setFresh] = useState<string | null>(null)
  const [naming, setNaming] = useState<{ space?: SpaceId; folder?: string; value: string } | null>(null)

  /* The workspace switcher decides which folder opens. Every folder stays on
     screen either way, one click from wherever he is standing. */
  useEffect(() => { setOpenFolder(home); setOpenId(null) }, [home])

  const finding = query.trim().length > 0 || tag !== null
  const spaceOf = (id: string) => id.match(/^nf-space-(.+)$/)?.[1] as SpaceId | undefined
  const nameOf = (id: string) => {
    const s = spaceOf(id)
    if (s) return SPACE_LABELS[s] ?? 'Notes'
    return noteFolders.find((f) => f.id === id)?.name ?? 'Notes'
  }
  /* A workspace chip holds everything in that workspace, his folders included,
     because "click Personal and see my personal notes" is what he asked for.
     Counting only the loose ones made the first build say Personal 1 above a
     Personal that had eight. */
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

  const open = notes.find((n) => n.id === openId) ?? null

  const show = (id: string) => { setOpenId(id); window.scrollTo({ top: 0 }) }
  const create = () => {
    /* A new note lands where he is standing. Standing in a workspace rather
       than one of his folders, it lands loose in that workspace. */
    const id = addNote(finding ? home : openFolder)
    show(id)
    setFresh(id)
    setEditing(false)
  }
  const goFolder = (id: string) => { setOpenFolder(id); setOpenId(null); setQuery(''); setTag(null) }

  const toggleLine = (n: Note, line: number) => {
    const lines = restOf(n.body).split('\n')
    lines[line] = lines[line].replace(/^(\s*[-*]\s+\[)([ xX])(\])/, (_m, a, c, b) => `${a}${c === ' ' ? 'x' : ' '}${b}`)
    updateNote(n.id, { body: join(n.body.split('\n')[0] ?? '', lines.join('\n')) })
  }

  const submitName = () => {
    if (!naming) return
    const v = naming.value.trim()
    if (v && naming.space) { const id = addNoteFolder(naming.space, v); goFolder(id) }
    if (v && naming.folder) renameNoteFolder(naming.folder, v)
    setNaming(null)
  }

  /* ---- reading and writing one note ---- */
  if (open) {
    const head = headOf(open.body)
    const rest = restOf(open.body)
    return (
      <div className="page nt-reading">
        <div className="nt-topbar">
          <button className="nt-back" onClick={() => { setOpenId(null); setEditing(false) }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {nameOf(open.folderId)}
          </button>
          <Dropdown label="Note options" className="nt-kebab">
            <button role="menuitem" onClick={() => updateNote(open.id, { pinned: !open.pinned })}>
              {open.pinned ? 'Unpin' : 'Pin to the top'}
            </button>
            <button role="menuitem" onClick={() => {
              addTask({ title: (head || open.body).replace(TAG_RE, '').trim().slice(0, 120), source: 'mc', estimateMin: 0, space: open.space, list: 'backlog', category: 'deep' })
              setPage('plan')
            }}>Make it a task</button>
            <span className="kebab-head">Move to</span>
            {SPACES.flatMap((s) => [
              { id: spaceFolderId(s), name: SPACE_LABELS[s] },
              ...noteFolders.filter((f) => f.space === s).map((f) => ({ id: f.id, name: `${SPACE_LABELS[s]} / ${f.name}` })),
            ]).filter((f) => f.id !== open.folderId).map((f) => (
              <button key={f.id} role="menuitem" onClick={() => moveNote(open.id, f.id)}>{f.name}</button>
            ))}
            <span className="kebab-head">Colour</span>
            <div className="nt-swatches" role="radiogroup" aria-label="Note colour">
              {NOTE_COLORS.map((c) => (
                <button
                  key={c.id} className={`note-swatch${open.color === c.id ? ' on' : ''}`} style={{ background: c.bg }}
                  aria-label={c.label} aria-pressed={open.color === c.id} onClick={() => updateNote(open.id, { color: c.id })}
                />
              ))}
            </div>
            <button role="menuitem" className="danger" onClick={() => { deleteNote(open.id); setOpenId(null) }}>Delete</button>
          </Dropdown>
        </div>

        <article className="nt-sheet">
          {/* The title is always a title, and always editable. There is no state
              in which his note is a wall of one size. */}
          <input
            className="nt-title" value={head} placeholder="Untitled" aria-label="Note title"
            autoFocus={open.id === fresh}
            onChange={(e) => updateNote(open.id, { body: join(e.target.value, rest) })}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setFresh(null); setEditing(true) } }}
          />

          {open.conflict && (
            <div className="nt-conflict">
              <p className="nt-conflict-head">
                Another device had a different version of this note. It is kept here until you say what happens to it.
              </p>
              <pre>{open.conflict.body}</pre>
              <div className="nt-conflict-acts">
                <button className="btn btn-primary" onClick={() => keepNoteConflict(open.id)}>Add it to this note</button>
                <button className="btn btn-ghost" onClick={() => dropNoteConflict(open.id)}>Discard it</button>
              </div>
            </div>
          )}

          {editing ? (
            <AutoTextarea
              autoFocus className="nt-write" minRows={14} maxRows={200} value={rest} aria-label="Note text"
              onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
              onChange={(e) => updateNote(open.id, { body: join(head, e.target.value) })}
              onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false) }}
              onBlur={() => setEditing(false)}
            />
          ) : (
            <div
              className="nt-read" role="textbox" tabIndex={0} aria-label="Note, click to write"
              onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) setEditing(true) }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setEditing(true) } }}
            >
              {rest.trim()
                ? <NoteBody body={rest} onTag={(t) => { setOpenId(null); setTag(t); setQuery('') }} onToggle={(l) => toggleLine(open, l)} />
                : <p className="nt-empty-body">&nbsp;</p>}
            </div>
          )}

          <p className="nt-stamp mono">edited {fmtWhen(open.when)}</p>
        </article>
      </div>
    )
  }

  /* ---- browsing ---- */
  return (
    <div className="page">
      <Band title={finding ? 'Everything' : nameOf(openFolder)} actions={<button className="btn btn-primary" onClick={create}>New note</button>} />

      <div className="nt-controls">
        <div className="nt-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" strokeLinecap="round" />
          </svg>
          <input
            className="textinput" type="search" value={query} placeholder="Search every note"
            aria-label="Search notes"
            onFocus={() => setSearching(true)}
            onBlur={() => window.setTimeout(() => setSearching(false), 180)}
            onChange={(e) => setQuery(e.target.value)}
          />
          {finding && <button className="nt-clear" onClick={() => { setQuery(''); setTag(null) }}>Clear</button>}
        </div>

        {/* Tags are a way of finding, so they live with the search rather than
            standing above every list forever getting longer. */}
        {(searching || tag) && allTags.length > 0 && (
          <div className="nt-tags">
            {allTags.map(([t, n]) => (
              <button key={t} className={`nt-chip nt-chip-tag${tag === t ? ' on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => setTag(tag === t ? null : t)}>
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

        {/* Every folder in every workspace, always on screen, as he asked. One
            wrapping strip, not a rail: the rail was 21 controls for 11 notes. */}
        <div className="nt-folders">
          {SPACES.map((s) => {
            const wid = spaceFolderId(s)
            const mine = noteFolders.filter((f) => f.space === s).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
            const at = (id: string) => !finding && openFolder === id
            const count = (id: string) => notes.filter((n) => inFolder(n, id)).length
            return (
              <div className="nt-fgroup" key={s}>
                <button className={`nt-chip nt-chip-space${at(wid) ? ' on' : ''}`} onClick={() => goFolder(wid)}>
                  {SPACE_LABELS[s]}<i>{count(wid) || ''}</i>
                </button>
                {mine.map((f) => (naming?.folder === f.id ? (
                  <input
                    key={f.id} className="nt-rename" autoFocus value={naming.value} aria-label={`Rename ${f.name}`}
                    onChange={(e) => setNaming({ ...naming, value: e.target.value })}
                    onBlur={submitName}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitName(); if (e.key === 'Escape') setNaming(null) }}
                  />
                ) : (
                  <span className="nt-chipwrap" key={f.id}>
                    <button className={`nt-chip${at(f.id) ? ' on' : ''}`} onClick={() => goFolder(f.id)}>
                      {f.name}<i>{count(f.id) || ''}</i>
                    </button>
                    {at(f.id) && (
                      <Dropdown label={`${f.name} options`} className="nt-fkebab">
                        <button role="menuitem" onClick={() => setNaming({ folder: f.id, value: f.name })}>Rename</button>
                        <button role="menuitem" className="danger" onClick={() => deleteNoteFolder(f.id)}>Delete folder, keep the notes</button>
                      </Dropdown>
                    )}
                  </span>
                )))}
                {naming?.space === s ? (
                  <input
                    className="nt-rename" autoFocus value={naming.value} placeholder="Folder name"
                    aria-label={`New folder in ${SPACE_LABELS[s]}`}
                    onChange={(e) => setNaming({ ...naming, value: e.target.value })}
                    onBlur={submitName}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitName(); if (e.key === 'Escape') setNaming(null) }}
                  />
                ) : (
                  <button className="nt-chip nt-chip-add" aria-label={`New folder in ${SPACE_LABELS[s]}`} onClick={() => setNaming({ space: s, value: '' })}>+</button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {finding && (
        <p className="nt-scope mono">{shown.length} {shown.length === 1 ? 'note' : 'notes'}, every folder</p>
      )}

      <div className="panel nt-panel">
        <ul className="nt-rows">
          {shown.map((n) => (
            <li key={n.id}>
              <button className="nt-row" onClick={() => show(n.id)}>
                <span className="nt-swatch" style={{ background: colorBg(n.color) }} aria-hidden="true" />
                <span className="nt-rowmain">
                  <span className="nt-rowtitle">
                    {n.pinned && <span className="nt-pin" aria-label="Pinned">◆</span>}
                    <Mark text={headOf(n.body) || 'Untitled'} hit={query.trim() || undefined} />
                  </span>
                  {snippet(n, query) && (
                    <span className="nt-rowsnip"><Mark text={snippet(n, query)} hit={query.trim() || undefined} /></span>
                  )}
                  <span className="nt-rowmeta mono">
                    {fmtWhen(n.when)}
                    {finding && <> · {nameOf(n.folderId)}</>}
                    {n.conflict && <span className="nt-flag"> · two versions</span>}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {shown.length === 0 && (
            <li className="nt-none">{finding ? 'Nothing matches.' : 'Nothing here yet.'}</li>
          )}
        </ul>
      </div>
    </div>
  )
}

/** The two lines of a note worth showing under its title: in a search, the line
 *  that actually matched, otherwise whatever follows the title. Never the title
 *  again, because a one-line note printed twice says nothing the second time. */
function snippet(n: Note, query: string): string {
  const head = headOf(n.body)
  const lines = restOf(n.body).split('\n').map((l) => plain(l)).filter(Boolean).filter((l) => l !== head)
  const q = query.trim()
  if (q) {
    const hit = lines.find((l) => flat(l).includes(flat(q)))
    if (hit) return hit.slice(0, 220)
  }
  return lines.slice(0, 2).join(' ').slice(0, 220)
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
