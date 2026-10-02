/* Off-Plate and Michael's Corner stopped being workspaces on 2026-10-02 and
   became projects inside Personal. This is the one place that moves saved data
   across, and it is deliberately idempotent: it runs on every load and on every
   state that arrives from another device, because a phone still on the old
   bundle keeps writing rows with the old space until it updates.

   What it does, and nothing else:
   - any row anywhere whose space is offplate or corner becomes Personal;
   - a task that was one of those also gets that project, unless it already has
     one, so the O and M marks in All keep telling him where it came from;
   - the Off-Plate and Michael's Corner projects are created once ('seed');
   - the two spaces' widget layouts and note folders are folded into Personal's. */
import { PROJECT_CORNER, PROJECT_OFFPLATE } from './types/core'

type Row = Record<string, unknown>

const OLD_SPACE_PROJECT: Record<string, string> = { offplate: PROJECT_OFFPLATE, corner: PROJECT_CORNER }
const PROJECT_NAME: Record<string, string> = { [PROJECT_OFFPLATE]: 'Off-Plate', [PROJECT_CORNER]: 'Michael’s Corner' }

/** `nf-space-offplate` -> `nf-space-personal`, `nf-braindump-corner` -> `nf-braindump-personal`. */
const foldFolderId = (id: unknown) =>
  typeof id === 'string' ? id.replace(/^(nf-(?:space|braindump)-)(?:offplate|corner)$/, '$1personal') : id

export const SEED_KEY = 'fix:spaces-two'

export function foldSpaces(p: Row, today: string): void {
  const removed = (p.removedSeeds as string[] | undefined) ?? []
  p.removedSeeds = removed
  const projects = ((p.projects as Row[] | undefined) ?? []).map((r) => ({ ...r }))
  if (!removed.includes(SEED_KEY)) {
    removed.push(SEED_KEY)
    for (const id of [PROJECT_OFFPLATE, PROJECT_CORNER]) {
      if (!projects.some((r) => r.id === id)) projects.push({ id, name: PROJECT_NAME[id], space: 'personal', createdAt: today })
    }
  }
  p.projects = projects
  const have = new Set(projects.map((r) => r.id as string))

  for (const [key, val] of Object.entries(p)) {
    if (!Array.isArray(val)) continue
    let touched = false
    const next = val.map((row) => {
      if (!row || typeof row !== 'object') return row
      const r = row as Row
      const old = OLD_SPACE_PROJECT[r.space as string]
      if (!old) return row
      touched = true
      const out: Row = { ...r, space: 'personal' }
      if (key === 'tasks' && !out.projectId && have.has(old)) out.projectId = old
      return out
    })
    if (touched) p[key] = next
  }

  /* Notes and their folders. Folder ids are derived from the space, so the two
     retired ones are re-pointed, and the Brain dumps folders they each held
     collapse into the one Personal already has. */
  if (Array.isArray(p.noteFolders)) {
    const seen = new Set<string>()
    p.noteFolders = (p.noteFolders as Row[])
      .map((f) => ({ ...f, id: foldFolderId(f.id), parentId: foldFolderId(f.parentId) }))
      .filter((f) => (seen.has(f.id as string) ? false : (seen.add(f.id as string), true)))
  }
  if (Array.isArray(p.notes)) {
    p.notes = (p.notes as Row[]).map((n) => (typeof n.folderId === 'string' && foldFolderId(n.folderId) !== n.folderId ? { ...n, folderId: foldFolderId(n.folderId) } : n))
  }

  if (p.spaces && typeof p.spaces === 'object') {
    const spaces = { ...(p.spaces as Row) }
    delete spaces.offplate
    delete spaces.corner
    p.spaces = spaces
  }
}
