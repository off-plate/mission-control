/* Notes.

   Built the way every notes app is built, because Michael asked for TickTick or
   Apple Notes and that is not a thing to have an opinion about: folders on the
   left, the list of notes in a NARROW middle column, the note itself filling
   everything to the right. Three full-height columns that scroll on their own,
   so the page never scrolls as a whole.

   The two versions before this one both got the same thing wrong: they let the
   list run the full width of the screen. A note list is a narrow column, always,
   in every app of this kind, because its job is to be scanned, not read. Rows
   are one line of title and one line of date plus preview. The reading happens
   in the pane beside it.

   The rules that survived from the earlier attempts, because they were right:
   the note itself has no card and no border, its first line is its title, and
   writing looks like reading. Browsing is by folder; searching and tags always
   read every note in every workspace and say which folder each hit came from.
   And every folder in every workspace stays on screen at all times, as he
   asked, which here means the sidebar lists all four workspaces at once rather
   than following the workspace switcher. */

import { useEffect, useMemo, useState } from 'react'
import { AutoTextarea, Dropdown } from './pages1'
import { useStore } from './store'
import { SPACE_LABELS } from './mock'
import { fmtWhen } from './util'
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

/* A tag is a hash followed by at least one tag character. A markdown heading is
   a hash followed by a SPACE, so `# Monday` is a heading and `#monday` is a tag. */
const TAG_RE = /#[\p{L}\d_/-]+/gu
const tagsOf = (t: string) => (t.match(TAG_RE) ?? []).map((x) => x.toLowerCase())

/* Czech, so accents are not a wall between him and his own note: "ukol" finds
   "úkol", "risa" finds "Říša". Both sides stripped, so it works either way. */
const flat = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

/** Line one, and everything after it. The title is not a second field to keep in
 *  step with the text: it IS the text's first line. */
const headOf = (body: string) => (body.split('\n')[0] ?? '').replace(/^\s*#{1,3}\s+/, '')
const restOf = (body: string) => body.split('\n').slice(1).join('\n')
const join = (head: string, rest: string) => (rest ? `${head}\n${rest}` : head)

/* ---- markdown-lite ------------------------------------------------------- */

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

/** The search term, lit where it appears. A result list that will not show you
 *  WHY a note matched makes you open every one of them. */
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

/** The body minus its first line: that one is the title, drawn above. */
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
  const [fresh, setFresh] = useState<string | null>(null)
  const [naming, setNaming] = useState<{ space?: SpaceId; folder?: string; value: string } | null>(null)
  /* On a phone there is one column, so the note is a place you go to and come
     back from. On a desktop all three are on screen and there is nowhere to go. */
  const [phone, setPhone] = useState(() => window.innerWidth < 1000)
  useEffect(() => {
    const on = () => setPhone(window.innerWidth < 1000)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])

  /* The workspace switcher decides which folder opens. Every folder stays in
     the sidebar either way, one click from wherever he is standing. */
  useEffect(() => { setOpenFolder(home); setOpenId(null) }, [home])

  const finding = query.trim().length > 0 || tag !== null
  const spaceOf = (id: string) => id.match(/^nf-space-(.+)$/)?.[1] as SpaceId | undefined
  const nameOf = (id: string) => {
    const s = spaceOf(id)
    return s ? (SPACE_LABELS[s] ?? 'Notes') : (noteFolders.find((f) => f.id === id)?.name ?? 'Notes')
  }
  /* A workspace holds everything in it, his own folders included, because
     "click Personal and see my personal notes" is what he asked for. */
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

  /* On a desktop the reading pane is never empty while there is something to
     read: the first note of the folder opens itself, the way it does in Notes
     and in TickTick. On a phone nothing opens until he picks something. */
  useEffect(() => {
    if (phone) return
    if (openId && shown.some((n) => n.id === openId)) return
    setOpenId(shown[0]?.id ?? null)
    setEditing(false)
  }, [phone, shown, openId])

  const open = notes.find((n) => n.id === openId) ?? null

  const create = () => {
    const id = addNote(finding ? home : openFolder)
    setOpenId(id)
    setFresh(id)
    setEditing(false)
    window.scrollTo({ top: 0 })
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
    <div className={`nt-app${reading ? ' is-reading' : ''}`}>
      {/* ---- folders ---- */}
      <aside className="nt-side" aria-label="Folders">
        {SPACES.map((s) => {
          const wid = spaceFolderId(s)
          const mine = noteFolders.filter((f) => f.space === s).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
          const at = (id: string) => !finding && openFolder === id
          const count = (id: string) => notes.filter((n) => inFolder(n, id)).length
          return (
            <div className="nt-group" key={s}>
              <button className={`nt-folder nt-folder-top${at(wid) ? ' on' : ''}`} aria-current={at(wid) ? 'true' : undefined} onClick={() => goFolder(wid)}>
                <span className="nt-fname">{SPACE_LABELS[s]}</span>
                <span className="nt-count mono">{count(wid) || ''}</span>
              </button>
              {mine.map((f) => (naming?.folder === f.id ? (
                <input
                  key={f.id} className="nt-rename textinput" autoFocus value={naming.value} aria-label={`Rename ${f.name}`}
                  onChange={(e) => setNaming({ ...naming, value: e.target.value })}
                  onBlur={submitName}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitName(); if (e.key === 'Escape') setNaming(null) }}
                />
              ) : (
                <div className="nt-folder-row" key={f.id}>
                  <button className={`nt-folder${at(f.id) ? ' on' : ''}`} aria-current={at(f.id) ? 'true' : undefined} onClick={() => goFolder(f.id)}>
                    <span className="nt-fname">{f.name}</span>
                    <span className="nt-count mono">{count(f.id) || ''}</span>
                  </button>
                  {at(f.id) && (
                    <Dropdown label={`${f.name} options`} className="nt-fkebab">
                      <button role="menuitem" onClick={() => setNaming({ folder: f.id, value: f.name })}>Rename</button>
                      <button role="menuitem" className="danger" onClick={() => deleteNoteFolder(f.id)}>Delete folder, keep the notes</button>
                    </Dropdown>
                  )}
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
                onClick={() => { setOpenId(n.id); setEditing(false); if (phone) window.scrollTo({ top: 0 }) }}
              >
                <span className="nt-rowtitle">
                  {n.pinned && <span className="nt-pin" aria-hidden="true">◆</span>}
                  <span className="nt-swatch" style={{ background: colorBg(n.color) }} aria-hidden="true" />
                  <span className="nt-rowname"><Mark text={headOf(n.body) || 'Untitled'} hit={query.trim() || undefined} /></span>
                </span>
                <span className="nt-rowsub">
                  <span className="nt-when mono">{fmtWhen(n.when)}</span>
                  {snippet(n, query) && <span className="nt-rowsnip"><Mark text={snippet(n, query)} hit={query.trim() || undefined} /></span>}
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
            <div className="nt-topbar">
              {phone && (
                <button className="nt-back" onClick={() => { setOpenId(null); setEditing(false) }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                    <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {nameOf(open.folderId)}
                </button>
              )}
              {kebab(open)}
            </div>

            <article className="nt-sheet">
              <AutoTextarea
                className="nt-title" minRows={1} maxRows={12} value={headOf(open.body)}
                placeholder="Untitled" aria-label="Note title" autoFocus={open.id === fresh}
                onChange={(e) => updateNote(open.id, { body: join(e.target.value.replace(/\n/g, ' '), restOf(open.body)) })}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setFresh(null); setEditing(true) } }}
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

              {editing ? (
                <AutoTextarea
                  autoFocus className="nt-write" minRows={12} maxRows={400} value={restOf(open.body)} aria-label="Note text"
                  onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
                  onChange={(e) => updateNote(open.id, { body: join(headOf(open.body), e.target.value) })}
                  onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false) }}
                  onBlur={() => setEditing(false)}
                />
              ) : (
                <div
                  className="nt-read" role="textbox" tabIndex={0} aria-label="Note, click to write"
                  onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) setEditing(true) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setEditing(true) } }}
                >
                  {restOf(open.body).trim()
                    ? <NoteBody body={restOf(open.body)} onTag={(t) => { setTag(t); setQuery(''); if (phone) setOpenId(null) }} onToggle={(l) => toggleLine(open, l)} />
                    : <p className="nt-blank">&nbsp;</p>}
                </div>
              )}

              <p className="nt-stamp mono">edited {fmtWhen(open.when)}</p>
            </article>
          </>
        ) : (
          <div className="nt-nothing" />
        )}
      </section>
    </div>
  )
}

/** The one line under a row's title: in a search, the line that actually
 *  matched, otherwise whatever follows the title. Never the title again. */
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
