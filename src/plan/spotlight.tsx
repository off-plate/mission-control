import * as Icon from '../icons'
import { useEffect, useRef, useState } from 'react'
import { Linkify } from '../widgets'
import { SpaceMark, TagMark } from '../ui'
import { type Project, type Task } from '../types'

/* The strip itself. Folder glyph, name, open-task count: the same facts a
   project card on the Projects page carries, in one row. Plain click selects
   that one project (click it again to clear); shift/cmd/ctrl-click adds or
   removes; on touch there is no modifier, so a tap toggles. */
/* Spotlight-style search (his ask, 2026-10-11): a centred box over the page,
   type, arrow to a task, Enter or click to jump to its project with the row
   highlighted (jumpTo, unchanged). Every task, every workspace. */
export function Spotlight({ q, setQ, matches, projects, onPick, onClose }: {
  q: string; setQ: (v: string) => void; matches: Task[]; projects: Project[]
  onPick: (t: Task) => void; onClose: () => void
}) {
  const [hi, setHi] = useState(0)
  useEffect(() => setHi(0), [q])
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  return (
    <div className="spot-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="spot" role="dialog" aria-label="Search every task">
        <div className="spot-field">
          <Icon.Search size={18} />
          <input
            ref={ref} value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search every task, every workspace"
            aria-label="Search every task"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              else if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, matches.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)) }
              else if (e.key === 'Enter' && matches[hi]) onPick(matches[hi])
            }}
          />
          <kbd>Esc</kbd>
        </div>
        {q.trim() && (
          <ul className="spot-results" role="listbox">
            {matches.length === 0 && <li className="empty">Nothing matches.</li>}
            {matches.map((t, i) => {
              const proj = t.projectId ? projects.find((p) => p.id === t.projectId) : undefined
              return (
                <li key={t.id}>
                  <button className={`plan-search-hit${i === hi ? ' is-hi' : ''}`} onMouseEnter={() => setHi(i)} onClick={() => onPick(t)}>
                    <SpaceMark space={t.space} always />
                    <span className="plan-search-hit-title"><Linkify text={t.title} /> <TagMark project={proj} /></span>
                    <span className="plan-search-hit-where mono">{proj ? proj.name : t.list === 'today' ? "today's plan" : 'backlog'}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
