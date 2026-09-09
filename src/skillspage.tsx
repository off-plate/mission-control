/* THE SKILLS PAGE. His ask, verbatim (2026-09-09): "I have so many skills...
   need to have it somehow somewhere." A plain reference page, not a tool --
   what exists, across every workspace, and what it does. Reads from
   Supabase (skills.ts), never bundled: see that file's own header for why.

   One flat list, always. He tried a workspace filter (All/Jarvis/Sofia)
   and a follow-up correction removed it the same day: "do not filter it by
   Jarvis and Sofia nor all... I don't want them separated." Search is the
   only narrowing this page does. */
import { useState } from 'react'
import { useSkills, type Skill } from './skills'
import { Band } from './ui'

const WORKSPACE_LABEL: Record<string, string> = { jarvis: 'Jarvis', sofia: 'Sofia' }

export function SkillsPage() {
  const { state, reload } = useSkills()
  const [q, setQ] = useState('')

  const all: Skill[] = state.status === 'ok' ? state.skills : []

  const needle = q.trim().toLowerCase()
  const filtered = all.filter((s) => (
    !needle || s.name.toLowerCase().includes(needle) || s.description.toLowerCase().includes(needle)
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
          <input
            className="textinput skillspage-search"
            type="search"
            placeholder={`Search ${all.length} skills…`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

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
