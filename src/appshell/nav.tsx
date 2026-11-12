import { ProjectMark } from '../ui'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SPACE_LABELS } from '../mock'
import { useStore } from '../store'
import { SPACES, UNSORTED, type PageId } from '../types'

export function PageNav({
  tabs, page, setPage, onMouseEnter,
}: {
  tabs: { id: PageId; label: string }[]
  page: PageId
  setPage: (p: PageId) => void
  onMouseEnter?: () => void
}) {
  const { projects, tasks, openProjectId, view, setSpace, enterProject } = useStore()
  const activeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [page])

  /* A preview, not a menu: hovering Plan jumps straight into a project without
     a click, and clicking Plan itself still just opens Plan. Projects' own tab
     left the row on his instruction (2026-09-15), so the one "All projects"
     row at the end is now the door to the directory where they are made.

     Portalled to the body rather than nested under .nav: .nav clips to its
     OWN box while revealing (clip-path: inset(0), part of its slide-down
     animation), so a normal absolutely-positioned child anchored below it
     was invisible -- present in the DOM, computed as visible, painted
     nowhere. Fixed position, measured from the trigger's own rect, is the
     way out of an ancestor that clips by design. */
  const [hoverOpen, setHoverOpen] = useState(false)
  const [hoverRect, setHoverRect] = useState<{ top: number; left: number } | null>(null)
  const hoverTimer = useRef<number | undefined>(undefined)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const showHover = () => {
    window.clearTimeout(hoverTimer.current)
    const r = wrapRef.current?.getBoundingClientRect()
    if (r) setHoverRect({ top: r.bottom + 12, left: r.left })
    setHoverOpen(true)
  }
  const hideHoverSoon = () => { hoverTimer.current = window.setTimeout(() => setHoverOpen(false), 350) }
  const hoverProjects = view === 'all' ? projects : projects.filter((p) => p.space === view)
  /* Each workspace's default folder: its tasks with no project. */
  const unsortedSpaces = view === 'all' ? SPACES : [view]

  return (
    <nav className="nav" aria-label="Pages" onMouseEnter={onMouseEnter}>
      {tabs.map((t) => {
        const button = (
          <button
            key={t.id}
            ref={page === t.id ? activeRef : undefined}
            className="nav-tab"
            aria-current={page === t.id ? 'page' : undefined}
            onClick={() => setPage(t.id)}
          >
            {t.label}
          </button>
        )
        if (t.id !== 'plan') return button
        return (
          <span className="kebab-wrap" key={t.id} ref={wrapRef} onMouseEnter={showHover} onMouseLeave={hideHoverSoon}>
            {button}
            {hoverRect && createPortal(
              /* Same object as .nav itself (same background, radius, padding,
                 gap, same .nav-tab rows), just turned on its side, and the
                 SAME drawer reveal .topstick > .nav uses (clip-path closing
                 over a translate, not a fade) -- copied rather than shared
                 because this one has to animate on its own class, outside
                 .topstick's DOM, where that selector can't reach it. Stays
                 mounted once first opened so closing gets the same
                 transition as opening, instead of vanishing instantly. */
              <div
                className={`nav projnav-menu${hoverOpen ? ' is-open' : ''}`}
                role="menu"
                aria-label="Projects"
                style={{ top: hoverRect.top, left: hoverRect.left }}
                onMouseEnter={showHover}
                onMouseLeave={hideHoverSoon}
              >
                {unsortedSpaces.map((sp) => (
                  <button key={`u-${sp}`} className="projrow" data-space="none" role="menuitem" aria-current={openProjectId === UNSORTED && view === sp ? 'true' : undefined} onClick={() => { setSpace(sp); enterProject(UNSORTED); setHoverOpen(false) }}>
                    <span className="projectmark"><b aria-hidden="true">·</b></span>
                    <span className="projrow-name">{view === 'all' ? `Unsorted, ${SPACE_LABELS[sp]}` : 'Unsorted'}</span>
                    <span className="projrow-n mono">{tasks.filter((t) => t.space === sp && !t.projectId && !t.done).length}</span>
                  </button>
                ))}
                {hoverProjects.map((p) => (
                  <button key={p.id} className="projrow" data-space={p.space} role="menuitem" aria-current={openProjectId === p.id ? 'true' : undefined} onClick={() => { setSpace(p.space); enterProject(p.id); setHoverOpen(false) }}>
                    <ProjectMark project={p} />
                    <span className="projrow-name">{p.name}</span>
                    <span className="projrow-n mono">{tasks.filter((t) => t.projectId === p.id && !t.done).length}</span>
                  </button>
                ))}
                <button className="projrow projnav-all" role="menuitem" onClick={() => { setPage('projects'); setHoverOpen(false) }}>
                  <span className="projrow-name">All projects</span>
                </button>
              </div>,
              document.body,
            )}
          </span>
        )
      })}
    </nav>
  )
}
