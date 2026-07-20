import type { LayoutItem } from 'react-grid-layout'
import { SIZE_UNITS, type WidgetInstance } from './types'

/** Column count by container width. One canonical order, derived per width.
    Cells target ~240px and the grid uses the FULL width, ultrawide included. */
export function colsForWidth(width: number): number {
  const factor = width >= 3200 ? 1.32 : width >= 2560 ? 1.2 : width >= 1920 ? 1.08 : 1
  return Math.max(3, Math.min(10, Math.floor((width + 14) / (254 * factor))))
}

/**
 * Shelf-pack widget instances, in order, into a grid of `cols` columns.
 * The stored truth is the ORDER of instances plus each one's size preset;
 * x/y are always derived, so no per-breakpoint layouts can drift apart.
 */
export function packLayout(instances: WidgetInstance[], cols: number): LayoutItem[] {
  const grid: boolean[][] = []
  const free = (x: number, y: number, w: number, h: number) => {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (grid[yy]?.[xx]) return false
      }
    }
    return true
  }
  const fill = (x: number, y: number, w: number, h: number) => {
    for (let yy = y; yy < y + h; yy++) {
      grid[yy] ??= []
      for (let xx = x; xx < x + w; xx++) grid[yy][xx] = true
    }
  }
  const placed = instances.map((inst) => {
    const u = SIZE_UNITS[inst.size]
    const w = Math.min(u.w, cols)
    const h = u.h
    for (let y = 0; ; y++) {
      for (let x = 0; x <= cols - w; x++) {
        if (free(x, y, w, h)) {
          fill(x, y, w, h)
          return { i: inst.id, x, y, w, h }
        }
      }
    }
  })

  /* Fill pass: a widget grows rightward into columns that stayed empty
     across its full row span, so shelves never show holes. */
  for (const item of placed) {
    let gap = 0
    while (
      item.x + item.w + gap < cols &&
      free(item.x + item.w + gap, item.y, 1, item.h)
    ) {
      gap++
    }
    if (gap > 0) {
      fill(item.x + item.w, item.y, gap, item.h)
      item.w += gap
    }
  }
  return placed
}

/** After a drag, read the new visual order back out of the layout. */
export function orderFromLayout(layout: readonly LayoutItem[]): string[] {
  return [...layout].sort((a, b) => a.y - b.y || a.x - b.x).map((l) => l.i)
}

export function formatFresh(minutes: number | null): string {
  if (minutes === null) return 'manual'
  if (minutes < 1) return 'live'
  if (minutes < 60) return `${Math.round(minutes)} min ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`
  return `${Math.round(minutes / (60 * 24))} d ago`
}
