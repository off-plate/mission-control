/* THE FLOATING SKILLS SUMMARY. Same shell Bills and Timeline already use
   (billsdock-*), because a search box over a scrollable list of rows is the
   same shape as their own label/value rows, just longer. 170 real skills
   across two workspaces (2026-09-09) -- too many to browse without a filter,
   so this is the one dock panel that leads with a search input rather than
   a glanceable headline. */
import { useMemo, useState, type ReactNode } from 'react'
import { useStore } from './store'
import { useSkills, type Skill } from './skills'
import * as Icon from './icons'

export function SkillsChip() {
  return <Icon.DockBook size={22} />
}

const WORKSPACE_LABEL: Record<string, string> = { jarvis: 'Jarvis', sofia: 'Sofia' }

export function SkillsPanel({ dockControls, onOpenFull }: { dockControls?: ReactNode; onOpenFull?: () => void }) {
  const { setPage } = useStore()
  const { state } = useSkills()
  const [q, setQ] = useState('')

  const openFull = () => { setPage('skills'); onOpenFull?.() }

  const all: Skill[] = state.status === 'ok' ? state.skills : []
  const needle = q.trim().toLowerCase()
  const shown = needle
    ? all.filter((s) => s.name.toLowerCase().includes(needle) || s.description.toLowerCase().includes(needle))
    : all

  return (
    <div className="billsdock-panel">
      <div className="billsdock-head">
        <span className="billsdock-title">Skills</span>
        <button className="btn btn-primary dock-open-btn" onClick={openFull} title="Open Skills">
          <Icon.ExternalLink size={13} />
          Skills
        </button>
        {dockControls}
      </div>
      <div className="billsdock-body">
        {state.status === 'off' && <p className="empty">Sync is off on this device.</p>}
        {state.status === 'signed-out' && <p className="empty">Not signed in on this device.</p>}
        {state.status === 'error' && <p className="empty">{state.message}</p>}
        {state.status === 'loading' && <p className="empty">Loading…</p>}
        {state.status === 'empty' && <p className="empty">No skills synced yet.</p>}
        {state.status === 'ok' && (
          <>
            <input
              className="textinput skillsdock-search"
              type="search"
              placeholder={`Search ${all.length} skills…`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
            <div className="skillsdock-list">
              {shown.length === 0 ? (
                <p className="empty">Nothing matches.</p>
              ) : shown.map((s) => (
                <div className="skillsdock-row" key={`${s.workspace}/${s.slug}`}>
                  <div className="skillsdock-rowhead">
                    <b>{s.name}</b>
                    <span className={`skillsdock-ws skillsdock-ws-${s.workspace}`}>{WORKSPACE_LABEL[s.workspace] ?? s.workspace}</span>
                  </div>
                  <p className="skillsdock-desc">{s.description}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
