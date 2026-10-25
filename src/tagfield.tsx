/* THE HASHTAG FIELD (2026-10-25). A text input that files what is typed into
   a project: a `#` at the start of a word opens the matching projects under
   the caret, arrows move, Enter or Tab puts the tag in, Esc leaves the text
   alone. A tag that names nothing yet offers to make that project there and
   then, in the workspace the task is being written in. Used by Plan's add box
   and the Edit sheet, so there is one way to file a task, not two. */
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { SPACE_LABELS } from './exceptions'
import { useStore } from './store'
import { SpaceMark } from './ui'
import { activeTag, cleanTag, matchProjects, tagOf, toneOf } from './tags'
import type { Project, SpaceId } from './types'

type Opt = { kind: 'project'; p: Project } | { kind: 'create'; name: string; tag: string }

export function TagField({ value, onChange, onSubmit, projects, createSpace, id, placeholder, label, autoFocus }: {
  value: string
  onChange: (v: string) => void
  /** Enter with the list closed. */
  onSubmit: () => void
  /** In the order to offer them: the current workspace's own first. */
  projects: Project[]
  /** Where a project made from a new tag lives. */
  createSpace: SpaceId
  id?: string; placeholder?: string; label: string; autoFocus?: boolean
}) {
  const { addProject, setProjectTag, projects: all } = useStore()
  const ref = useRef<HTMLInputElement>(null)
  const [caret, setCaret] = useState(0)
  const [hi, setHi] = useState(0)
  /* Esc closes the list for THIS hashtag only; typing a new `#` elsewhere
     opens it again. */
  const [dismissed, setDismissed] = useState<number | null>(null)
  const pendingCaret = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (pendingCaret.current == null || !ref.current) return
    ref.current.setSelectionRange(pendingCaret.current, pendingCaret.current)
    setCaret(pendingCaret.current)
    pendingCaret.current = null
  })

  const at = activeTag(value, caret)
  const open = !!at && dismissed !== at.start
  const opts: Opt[] = []
  if (at && open) {
    for (const p of matchProjects(at.query, projects).slice(0, 6)) opts.push({ kind: 'project', p })
    const typed = cleanTag(at.query)
    /* Only when nothing already starts with it, so "#off" on its way to
       #offplate is not met with an offer to make a project called Off. */
    if (typed && !projects.some((p) => tagOf(p).startsWith(typed))) {
      const name = at.query.replace(/[-_]+/g, ' ').trim()
      opts.push({ kind: 'create', name: name[0].toUpperCase() + name.slice(1), tag: typed })
    }
  }
  const showList = open && opts.length > 0
  const cur = Math.min(hi, opts.length - 1)

  const sync = () => { const el = ref.current; if (el) setCaret(el.selectionStart ?? el.value.length) }
  const put = (tag: string) => {
    if (!at) return
    const after = value.slice(caret)
    const next = `${value.slice(0, at.start)}#${tag}${after.startsWith(' ') ? '' : ' '}${after}`
    pendingCaret.current = at.start + tag.length + 2
    onChange(next)
    setHi(0)
  }
  const choose = (o: Opt) => {
    if (o.kind === 'project') put(tagOf(o.p))
    else {
      /* "#dodge-fixes" makes "Dodge fixes" and keeps the tag as he typed it. */
      const id = addProject(o.name, createSpace)
      if (id) { setProjectTag(id, o.tag); put(o.tag) }
    }
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (showList) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHi((cur + 1) % opts.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHi((cur - 1 + opts.length) % opts.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(opts[cur]); return }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDismissed(at!.start); return }
    }
    if (e.key === 'Enter' && value.trim()) onSubmit()
  }

  const listId = `${id ?? 'tf'}-tags`
  return (
    <div className="tagfield">
      <input
        ref={ref} id={id} className="textinput" value={value} placeholder={placeholder} aria-label={label} autoFocus={autoFocus}
        role="combobox" aria-autocomplete="list" aria-expanded={showList} aria-controls={showList ? listId : undefined}
        aria-activedescendant={showList ? `${listId}-${cur}` : undefined}
        onChange={(e) => { onChange(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); setHi(0); if (dismissed != null && !e.target.value.includes('#')) setDismissed(null) }}
        onSelect={sync} onClick={sync} onKeyUp={sync}
        onKeyDown={onKey}
        onBlur={() => setDismissed(at ? at.start : null)}
        onFocus={() => setDismissed(null)}
      />
      {showList && (
        <div className="kebab-menu tagpop" role="listbox" id={listId} aria-label="Projects">
          {opts.map((o, i) => (
            <button
              key={o.kind === 'project' ? o.p.id : 'new'} id={`${listId}-${i}`} type="button" role="option" tabIndex={-1}
              aria-selected={i === cur} className={i === cur ? 'is-hi' : undefined}
              onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setHi(i)} onClick={() => choose(o)}
            >
              {o.kind === 'project' ? (
                <>
                  <SpaceMark space={o.p.space} always />
                  <b className={`tt${toneOf(o.p, all)}`}>#{tagOf(o.p)}</b>
                  <span className="tagpop-name">{o.p.name}</span>
                </>
              ) : (
                <>
                  <b>#{o.tag}</b>
                  <span className="tagpop-name">New project in {SPACE_LABELS[createSpace]}</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
