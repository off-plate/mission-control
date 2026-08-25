import { Component, useEffect, useMemo, useState, type ReactNode } from 'react'
import ReactGridLayout, { useContainerWidth } from 'react-grid-layout'
import { colsForWidth, orderFromLayout, packLayout } from './derive'
import { WIDGET_DEFS } from './mock'
import { useStore } from './store'
import type { SpaceId, WidgetInstance } from './types'
import { WidgetBody } from './widgets'
import * as Icon from './icons'

class WidgetBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="empty">
          This widget hit an error. The rest of the page keeps working.
        </div>
      )
    }
    return this.props.children
  }
}

function WidgetFrame({ inst, space }: { inst: WidgetInstance; space: SpaceId }) {
  const { editing, resizeWidget, removeWidget, setPage } = useStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const def = WIDGET_DEFS[inst.type]
  const stale = def.freshMinutes !== null && def.freshMinutes > def.staleAfter

  return (
    <section className={`widget${stale ? ' is-stale' : ''}`} aria-label={def.title}>
      <header className="widget-head">
        <button
          className="widget-title-btn"
          onClick={() => { if (!editing) setPage(def.page) }}
          aria-label={`Open ${def.title}`}
        >
          <h2 className="widget-title">{def.title}</h2>
        </button>
        {/* No freshness theatre. Every widget reads local data that is current
            by definition; "2 min ago" seconds after first load was a seeded
            constant wearing a timestamp's clothes. Stamps return when a real
            synced source exists to be stale. */}
        {editing && (
          <button
            className="widget-menu-btn"
            aria-label={`Options for ${def.title}`}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <Icon.More size={16} />
          </button>
        )}
      </header>
      {menuOpen && editing && (
        <div className="widget-menu" role="menu">
          <div className="size-row" role="group" aria-label="Widget size">
            {def.supportedSizes.map((s) => (
              <button
                key={s}
                className="size-opt"
                aria-pressed={inst.size === s}
                onClick={() => { resizeWidget(space, inst.id, s); setMenuOpen(false) }}
              >
                {s}
              </button>
            ))}
          </div>
          <button className="remove" onClick={() => removeWidget(space, inst.id)}>
            Remove widget
          </button>
        </div>
      )}
      <div className={`widget-body${inst.type === 'tasks' ? ' scroll' : ''}`}>
        <WidgetBoundary>
          <WidgetBody type={inst.type} space={space} size={inst.size} />
        </WidgetBoundary>
      </div>
    </section>
  )
}

function PhoneStack({
  instances, space, editing, moveWidget,
}: {
  instances: WidgetInstance[]
  space: SpaceId
  editing: boolean
  moveWidget: (space: SpaceId, id: string, dir: -1 | 1) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const VISIBLE = 4
  const shown = showAll || editing ? instances : instances.slice(0, VISIBLE)
  const hidden = instances.slice(VISIBLE)
  return (
    <div className="stack">
      {shown.map((inst, i) => (
        <div key={inst.id} style={{ position: 'relative' }}>
          {editing && (
            <div className="stack-reorder" style={{ position: 'absolute', top: 8, right: 8, zIndex: 5 }}>
              <button aria-label="Move up" onClick={() => moveWidget(space, inst.id, -1)} disabled={i === 0}>↑</button>
              <button aria-label="Move down" onClick={() => moveWidget(space, inst.id, 1)} disabled={i === instances.length - 1}>↓</button>
            </div>
          )}
          <WidgetFrame inst={inst} space={space} />
        </div>
      ))}
      {!editing && hidden.length > 0 && (
        <button className="btn btn-quiet" onClick={() => setShowAll((v) => !v)}>
          {showAll
            ? 'Show less'
            : `More: ${hidden.map((h) => WIDGET_DEFS[h.type].title.toLowerCase()).join(', ')}`}
        </button>
      )}
    </div>
  )
}

/* The phone breakpoint comes from the viewport, not from the measured container.
   On a space switch the container remounts and reports width 0 for a frame; the
   old check (`width > 0 && width < 640`) read that as "not a phone" and rendered
   the absolutely positioned desktop grid inside a 390px box, so widgets painted
   on top of each other with their text running off-screen. */
function useIsPhone(): boolean {
  const q = '(max-width: 639px)'
  const [is, setIs] = useState(() => (typeof window === 'undefined' ? false : window.matchMedia(q).matches))
  useEffect(() => {
    const mq = window.matchMedia(q)
    const on = () => setIs(mq.matches)
    mq.addEventListener('change', on)
    on()
    return () => mq.removeEventListener('change', on)
  }, [])
  return is
}

export function SpaceGrid() {
  const { spaces, space, editing, reorderSpace, moveWidget } = useStore()
  const instances = spaces[space]
  const { width, containerRef, mounted } = useContainerWidth()
  const phone = useIsPhone()

  const cols = colsForWidth(width || 1280)
  const margin = 14
  const cellW = (width - margin * (cols - 1)) / cols
  const rowHeight = Math.max(150, Math.min(250, cellW * 0.85))

  const layout = useMemo(() => packLayout(instances, cols), [instances, cols])

  return (
    <div ref={containerRef as React.RefObject<HTMLDivElement>} className={`grid-wrap${editing ? ' editing' : ''}`}>
      {mounted && phone && (
        <PhoneStack instances={instances} space={space} editing={editing} moveWidget={moveWidget} />
      )}
      {/* Never lay out the desktop grid against an unmeasured container. */}
      {mounted && !phone && width > 0 && (
        <ReactGridLayout
          layout={layout}
          width={width}
          gridConfig={{ cols, rowHeight, margin: [margin, margin], containerPadding: [0, 0] }}
          dragConfig={{ enabled: editing, handle: '.widget-head' }}
          resizeConfig={{ enabled: false }}
          onDragStop={(l) => reorderSpace(space, orderFromLayout(l))}
        >
          {instances.map((inst) => (
            <div key={inst.id}>
              <WidgetFrame inst={inst} space={space} />
            </div>
          ))}
        </ReactGridLayout>
      )}
    </div>
  )
}
