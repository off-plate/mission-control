/* THE SKILLS PAGE. His ask, verbatim (2026-09-09): "I have so many skills...
   need to have it somehow somewhere." A plain reference page, not a tool --
   what exists, across every workspace, and what it does. Reads from
   Supabase (skills.ts), never bundled: see that file's own header for why. */
import { useMemo, useState } from 'react'
import { useSkills, type Skill } from './skills'
import { Band, Segmented } from './ui'

const WORKSPACE_LABEL: Record<string, string> = { jarvis: 'Jarvis', sofia: 'Sofia' }

export function SkillsPage() {
  const { state, reload } = useSkills()
  const [q, setQ] = useState('')
  const [ws, setWs] = useState<'all' | string>('all')

  const all: Skill[] = state.status === 'ok' ? state.skills : []
  const workspaces = useMemo(() => Array.from(new Set(all.map((s) => s.workspace))).sort(), [all])

  const needle = q.trim().toLowerCase()
  const filtered = all.filter((s) => (
    (ws === 'all' || s.workspace === ws)
    && (!needle || s.name.toLowerCase().includes(needle) || s.description.toLowerCase().includes(needle))
  ))

  return (
    <div className="page">
      <Band title="Skills" metrics={[
        { v: String(filtered.length), k: filtered.length === all.length ? 'total' : `of ${all.length}` },
      ]} />

      {state.status === 'off' && <div className="empty">Sync is off on this device.</div>}
      {state.status === 'signed-out' && <div className="empty">Not signed in on this device.</div>}
      {state.status === 'error' && (
        <div className="empty">
          {state.message}
          <div style={{ marginTop: 'var(--s3)' }}><button className="btn btn-quiet" onClick={reload}>Try again</button></div>
        </div>
      )}
      {state.status === 'loading' && <div className="empty">Loading…</div>}
      {state.status === 'empty' && <div className="empty">No skills synced yet.</div>}

      {state.status === 'ok' && (
        <>
          <div className="skillspage-toolbar">
            <input
              className="textinput skillspage-search"
              type="search"
              placeholder={`Search ${all.length} skills…`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {workspaces.length > 1 && (
              <Segmented
                label="Workspace"
                size="sm"
                value={ws}
                onPick={setWs}
                options={[{ id: 'all', label: 'All' }, ...workspaces.map((w) => ({ id: w, label: WORKSPACE_LABEL[w] ?? w }))]}
              />
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="empty">Nothing matches.</div>
          ) : (
            <div className="skillspage-list">
              {filtered.map((s) => (
                <div className="skillspage-row" key={`${s.workspace}/${s.slug}`}>
                  <div className="skillspage-rowhead">
                    <h3>{s.name}</h3>
                    <span className={`skillsdock-ws skillsdock-ws-${s.workspace}`}>{WORKSPACE_LABEL[s.workspace] ?? s.workspace}</span>
                  </div>
                  <p className="skillspage-desc">{s.description}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
