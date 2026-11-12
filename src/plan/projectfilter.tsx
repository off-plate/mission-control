import * as Icon from '../icons'
import { useState } from 'react'
import { useStore } from '../store'
import { Dropdown } from '../ui'
import { tagOf } from '../tags'
import { HUES, hueOf } from '../hues'
import { UNSORTED, type Project, type Task } from '../types'

/* The Projects page folder, shrunk to a glyph: back with its tab, one sheet
   peeking out, the front flap in the workspace colour. Same colour recipe as
   .folder, so a project looks like itself in both places. */
export function FolderGlyph({ cls }: { cls: string }) {
  return (
    <span className={`fg ${cls}`} aria-hidden="true">
      <i className="fg-back" /><i className="fg-paper" /><i className="fg-front" />
    </span>
  )
}

/* The phone's version of the strip above: one folder icon beside Yesterday that
   opens the same choices as a menu (his ask, 2026-10-16). A dot says a filter is
   on. Picks add and remove, like a tap on the strip does on touch. */
export function PhoneProjectFilter({ projects, tasks, sel, inScope, onAll, onPick, onManage }: {
  projects: Project[]; tasks: Task[]; sel: string[]; inScope: (t: Task) => boolean
  onAll: () => void; onPick: (id: string, add: boolean) => void; onManage: () => void
}) {
  const open = (id: string) => tasks.filter((t) => t.projectId === id && !t.done).length
  const total = projects.reduce((a, p) => a + open(p.id), 0)
  return (
    <Dropdown
      label="Filter Plan by project" className="phone-only"
      /* The folder goes straight to the Projects page (his ask, 2026-10-26),
         not to a dropdown of them; the strip above still filters. */
      trigger={() => (
        <button className="btn btn-ghost plan-proj-btn" aria-label="Open Projects" onClick={onManage}>
          <Icon.Folder size={20} />{sel.length > 0 && <span className="plan-proj-dot" aria-hidden="true" />}
        </button>
      )}
    >
      <button role="menuitem" aria-checked={sel.length === 0} onClick={onAll}>All <em className="mono plan-proj-n">{total}</em></button>
      {projects.map((p) => (
        <button key={p.id} role="menuitem" aria-checked={sel.includes(p.id)} onClick={() => onPick(p.id, true)}>
          <FolderGlyph cls={`s-${p.space}`} /><span>{p.name}</span><em className="mono plan-proj-n">{open(p.id)}</em>
        </button>
      ))}
      <button role="menuitem" aria-checked={sel.includes(UNSORTED)} onClick={() => onPick(UNSORTED, true)}>
        <FolderGlyph cls="f-unsorted" /><span>Unsorted</span><em className="mono plan-proj-n">{tasks.filter((t) => !t.projectId && !t.done && inScope(t)).length}</em>
      </button>
      <span className="kebab-sep" />
      <button role="menuitem" onClick={onManage}>Manage projects</button>
    </Dropdown>
  )
}

/* Desktop's project filter: one button where the strip of folders used to be.
   Same choices as the phone's menu, but the button itself opens the menu. */
export function ProjectFilter({ projects, tasks, sel, inScope, onAll, onPick, onManage }: {
  projects: Project[]; tasks: Task[]; sel: string[]; inScope: (t: Task) => boolean
  onAll: () => void; onPick: (id: string, add: boolean) => void; onManage: () => void
}) {
  const open = (id: string) => tasks.filter((t) => t.projectId === id && !t.done).length
  const label = sel.length === 0 ? 'All projects'
    : sel.length === 1 ? (sel[0] === UNSORTED ? 'Unsorted' : projects.find((p) => p.id === sel[0])?.name ?? 'Project')
    : `${sel.length} projects`
  /* A FOLDER, NOT A LABEL (his ask, 2026-11-05): the toolbar keeps one icon for
     projects, and the colours live in this menu's Edit colours instead of a
     second button. A dot on the folder says a filter is on. */
  const { setProjectHue, projects: all } = useStore()
  const [editing, setEditing] = useState(false)
  const keep = (e: React.MouseEvent) => e.stopPropagation()
  return (
    <Dropdown
      label="Filter Plan by project" className="hide-phone"
      trigger={({ onClick, open: isOpen }) => (
        <button className={`btn btn-ghost pf-icobtn${sel.length ? ' is-on' : ''}`} onClick={() => { setEditing(false); onClick() }} aria-expanded={isOpen}
          aria-label={`Projects: ${label}`} title={`Projects: ${label}`}>
          <Icon.Folder size={17} />
        </button>
      )}
    >
      <button role="menuitem" aria-checked={sel.length === 0} onClick={onAll}>All projects <em className="mono plan-proj-n">{tasks.filter((t) => !t.done && inScope(t)).length}</em></button>
      {projects.map((p) => (
        <button key={p.id} role="menuitem" aria-checked={sel.includes(p.id)} onClick={(e) => onPick(p.id, e.shiftKey || e.metaKey || e.ctrlKey)}>
          <FolderGlyph cls={`s-${p.space}`} /><span>{p.name}</span><em className="mono plan-proj-n">{open(p.id)}</em>
        </button>
      ))}
      <button role="menuitem" aria-checked={sel.includes(UNSORTED)} onClick={(e) => onPick(UNSORTED, e.shiftKey || e.metaKey || e.ctrlKey)}>
        <FolderGlyph cls="f-unsorted" /><span>Unsorted</span><em className="mono plan-proj-n">{tasks.filter((t) => !t.projectId && !t.done && inScope(t)).length}</em>
      </button>
      <span className="kebab-sep" />
      {projects.length > 0 && (
        <button role="menuitem" aria-expanded={editing} onClick={(e) => { keep(e); setEditing((v) => !v) }}>
          {editing ? 'Done editing colours' : 'Edit colours'}
        </button>
      )}
      {editing && projects.map((p) => {
        const cur = hueOf(p, all)
        return (
          <div key={`hue-${p.id}`} className="pf-hues" role="group" aria-label={`Colour for ${p.name}`} onClick={keep}>
            <span className="pf-hues-n" style={{ color: cur.h }}>#{tagOf(p)}</span>
            <span className="pf-hues-row">
              {HUES.map((h) => (
                <button key={h.id} role="menuitemradio" aria-checked={cur.id === h.id} aria-label={`${h.name} for ${p.name}`} title={h.name}
                  style={{ background: h.h, color: h.h }} onClick={() => setProjectHue(p.id, h.id)} />
              ))}
            </span>
          </div>
        )
      })}
      <button role="menuitem" onClick={onManage}>Manage projects</button>
    </Dropdown>
  )
}
