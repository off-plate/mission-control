/* WIDGETS / SPACES. Split out of store.tsx (2026-09-09). The widget layout
   per Space -- what's on it, what size, in what order -- with no dependency
   on any other domain: unlike habits/goals/routines, nothing here reads or
   writes tasks, contacts, or the ledger. */
import { useState } from 'react'
import { DEFAULT_SPACES, WIDGET_DEFS } from '../mock'
import type { SizeKey, SpaceId, WidgetInstance, WidgetType } from '../types'
import { newId } from './shared'

export interface WidgetsSlice {
  spaces: Record<SpaceId, WidgetInstance[]>
  setSpaces: (next: Record<SpaceId, WidgetInstance[]>) => void
  reorderSpace: (space: SpaceId, order: string[]) => void
  resizeWidget: (space: SpaceId, id: string, size: SizeKey) => void
  removeWidget: (space: SpaceId, id: string) => void
  addWidget: (space: SpaceId, type: WidgetType) => void
  moveWidget: (space: SpaceId, id: string, dir: -1 | 1) => void
}

export function useWidgetsSlice(
  persisted: { spaces?: Record<SpaceId, WidgetInstance[]> } | null,
): WidgetsSlice {
  const [spaces, setSpaces] = useState(persisted?.spaces ?? DEFAULT_SPACES)

  const reorderSpace = (sp: SpaceId, order: string[]): void =>
    setSpaces((prev) => {
      const byId = new Map(prev[sp].map((w) => [w.id, w]))
      const next = order.map((id) => byId.get(id)).filter(Boolean) as WidgetInstance[]
      for (const w of prev[sp]) if (!order.includes(w.id)) next.push(w)
      return { ...prev, [sp]: next }
    })

  const resizeWidget = (sp: SpaceId, id: string, size: SizeKey): void =>
    setSpaces((prev) => ({ ...prev, [sp]: prev[sp].map((w) => (w.id === id ? { ...w, size } : w)) }))

  const removeWidget = (sp: SpaceId, id: string): void =>
    setSpaces((prev) => ({ ...prev, [sp]: prev[sp].filter((w) => w.id !== id) }))

  const addWidget = (sp: SpaceId, type: WidgetType): void =>
    setSpaces((prev) => ({
      ...prev,
      [sp]: [...prev[sp], { id: newId(type), type, size: WIDGET_DEFS[type].defaultSize }],
    }))

  const moveWidget = (sp: SpaceId, id: string, dir: -1 | 1): void =>
    setSpaces((prev) => {
      const list = [...prev[sp]]
      const i = list.findIndex((w) => w.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= list.length) return prev
      ;[list[i], list[j]] = [list[j], list[i]]
      return { ...prev, [sp]: list }
    })

  return { spaces, setSpaces, reorderSpace, resizeWidget, removeWidget, addWidget, moveWidget }
}
