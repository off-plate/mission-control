/* THE PROJECTS PAGE. Split out of pages1.tsx (2026-09-09). */
import { useState } from 'react'
import { SPACE_LABELS } from './exceptions'
import { useStore } from './store'
import { Sheet } from './modals'
import { Band, Dropdown, SpaceMark } from './ui'
import { SPACES, type Project, type SpaceId } from './types'

function ProjectCard({ p, onOpen, onRename, onDelete }: { p: Project; onOpen: () => void; onRename: () => void; onDelete: () => void }) {
  const { tasks } = useStore()
  const own = tasks.filter((t) => t.projectId === p.id)
  const waiting = own.filter((t) => t.list === 'backlog' && !t.done).length
  return (
    <div className={`projcard s-${p.space}`}>
      <button className="projcard-open" onClick={onOpen}>
        <h3>{p.name}</h3>
        <div className="proj-stats"><span><b>{waiting}</b> waiting</span><span><b>{own.length}</b> total</span></div>
      </button>
      <Dropdown label={`Options for ${p.name}`} className="projcard-kebab">
        <button role="menuitem" onClick={onRename}>Rename</button>
        <button role="menuitem" className="danger" onClick={onDelete}>Delete</button>
      </Dropdown>
    </div>
  )
}

function RenameProjectSheet({ project, onClose }: { project: Project; onClose: () => void }) {
  const { renameProject } = useStore()
  const [name, setName] = useState(project.name)
  const save = () => { if (!name.trim()) return; renameProject(project.id, name); onClose() }
  return (
    <Sheet title="Rename project" onClose={onClose}>
      <label className="field-label" htmlFor="rp-name">Name</label>
      <input
        id="rp-name" className="textinput" style={{ width: '100%' }}
        value={name} autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) save() }}
      />
      <div className="sheet-actions">
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!name.trim()} onClick={save}>Save</button>
      </div>
    </Sheet>
  )
}

/** Deleting a project with nothing in it just deletes it -- there's nothing to
 *  ask about. One with tasks in it needs a real choice: those tasks already
 *  live in the Space's own Plan too, so "move" is just dropping the tag,
 *  never a data move, but "delete" is real and needs to say so plainly. */
function DeleteProjectSheet({ project, count, onClose }: { project: Project; count: number; onClose: () => void }) {
  const { deleteProject } = useStore()
  const go = (mode: 'move' | 'delete') => { deleteProject(project.id, mode); onClose() }
  return (
    <Sheet title={`Delete "${project.name}"?`} onClose={onClose}>
      <p style={{ margin: '0 0 var(--s4)', color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>
        {count} {count === 1 ? 'task is' : 'tasks are'} tagged to this project. They can stay, filed as ordinary tasks in {SPACE_LABELS[project.space]}'s own Plan, or go with the project.
      </p>
      <div className="sheet-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => go('move')}>Keep the tasks, delete the project</button>
        <button className="btn btn-danger" onClick={() => go('delete')}>Delete the project and its tasks</button>
      </div>
    </Sheet>
  )
}

/* Which Space it's for is never asked: the "+ New project" tile that opens
   this already lives inside one Space's own section, in Projects and in
   every grouping under All alike, so the answer is already known. */
function NewProjectSheet({ space, onClose }: { space: SpaceId; onClose: () => void }) {
  const { addProject } = useStore()
  const [name, setName] = useState('')
  const save = () => { if (!name.trim()) return; addProject(name.trim(), space); onClose() }
  return (
    <Sheet title={`New project in ${SPACE_LABELS[space]}`} onClose={onClose}>
      <label className="field-label" htmlFor="np-name">Name</label>
      <input
        id="np-name" className="textinput" style={{ width: '100%' }}
        value={name} autoFocus placeholder="e.g. a client name, a workstream…"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) save() }}
      />
      <div className="sheet-actions">
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!name.trim()} onClick={save}>Create project</button>
      </div>
    </Sheet>
  )
}

export function ProjectsPage() {
  const { projects, tasks, view, setSpace, enterProject, deleteProject } = useStore()
  const [addingIn, setAddingIn] = useState<SpaceId | null>(null)
  const [renaming, setRenaming] = useState<Project | null>(null)
  const [deleting, setDeleting] = useState<Project | null>(null)

  const openProject = (p: Project) => {
    setSpace(p.space)
    enterProject(p.id)
  }
  const askDelete = (p: Project) => {
    const count = tasks.filter((t) => t.projectId === p.id).length
    if (count === 0) deleteProject(p.id, 'move')
    else setDeleting(p)
  }
  const bySpace = (sp: SpaceId) => projects.filter((p) => p.space === sp)
  const grid = (sp: SpaceId) => (
    <div className="projgrid">
      {bySpace(sp).map((p) => (
        <ProjectCard key={p.id} p={p} onOpen={() => openProject(p)} onRename={() => setRenaming(p)} onDelete={() => askDelete(p)} />
      ))}
      <button className="projcard projcard-new" onClick={() => setAddingIn(sp)}>+ New project</button>
    </div>
  )

  return (
    <div className="page">
      <Band title="Projects" />
      {view === 'all'
        ? SPACES.map((sp) => (
          <div className="projsection" key={sp}>
            <div className="projsection-head"><SpaceMark space={sp} /><span className="microcap">{SPACE_LABELS[sp]}</span></div>
            {grid(sp)}
          </div>
        ))
        : grid(view)}
      {addingIn && <NewProjectSheet space={addingIn} onClose={() => setAddingIn(null)} />}
      {renaming && <RenameProjectSheet project={renaming} onClose={() => setRenaming(null)} />}
      {deleting && <DeleteProjectSheet project={deleting} count={tasks.filter((t) => t.projectId === deleting.id).length} onClose={() => setDeleting(null)} />}
    </div>
  )
}

/* ---------------- HABITS ---------------- */



/* A longer window than the week. One square a day, oldest on the left, so sixty
   or a hundred days reads as a shape rather than a wall of ticks. Green means
   kept, exactly as it does everywhere else; nothing marks a missed day, because
   a wall of misses is the guilt mechanic this app exists to avoid. */
