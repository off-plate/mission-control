import type { LayoutItem } from 'react-grid-layout'
import { SIZE_UNITS, type WidgetInstance } from './types'

/** Column count by container width. One canonical order, derived per width. */
export function colsForWidth(width: number): number {
  if (width >= 1460) return 8
  if (width >= 1180) return 6
  if (width >= 900) return 4
  return 3
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
  return instances.map((inst) => {
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
}

/** After a drag, read the new visual order back out of the layout. */
export function orderFromLayout(layout: readonly LayoutItem[]): string[] {
  return [...layout].sort((a, b) => a.y - b.y || a.x - b.x).map((l) => l.i)
}

export function formatFresh(minutes: number | null): string {
  if (minutes === null) return 'by you'
  if (minutes < 1) return 'live'
  if (minutes < 60) return `${Math.round(minutes)} min ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`
  return `${Math.round(minutes / (60 * 24))} d ago`
}
