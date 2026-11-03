import type { Project } from './types'
import { toneOf } from './tags'

/** Project colours he can pick from (2026-11-03). `h` is the ink (tag text,
 *  swatch, bar segment), `t` the tint a task row is filled with. Muted enough
 *  to sit beside the room accent, never purple, never the progress green. */
export const HUES = [
  { id: 'sky', name: 'Sky', h: '#1F6E9E', t: '#DDEAF4' },
  { id: 'teal', name: 'Teal', h: '#11706A', t: '#DCEFEC' },
  { id: 'terra', name: 'Terracotta', h: '#A4452A', t: '#F5E0D8' },
  { id: 'ochre', name: 'Ochre', h: '#8A5A0B', t: '#F4E7CF' },
  { id: 'rose', name: 'Rose', h: '#A3335E', t: '#F6DFE8' },
  { id: 'slate', name: 'Slate', h: '#465874', t: '#E2E7EF' },
  { id: 'olive', name: 'Olive', h: '#56660F', t: '#E9EED2' },
  { id: 'brown', name: 'Brown', h: '#77512F', t: '#EEE3D7' },
] as const
export type Hue = (typeof HUES)[number]

/** His pick, or the tone the project already wore before colours were his
 *  to choose, so nothing changes colour on the day this ships. */
export const hueOf = (p: Project, projects: Project[]): Hue =>
  HUES.find((x) => x.id === p.hue) ?? HUES[toneOf(p, projects)]
