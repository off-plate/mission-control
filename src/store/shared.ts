/* Genuinely cross-domain helpers -- used by every slice under src/store/,
   not owned by any one of them. Split out of store.tsx (2026-09-09) as
   part of untangling that file's single 1,800-line StoreProvider into one
   hook per domain. */
import { localDateKey } from '../util'

/* Ids must survive reloads without colliding: a plain counter restarts at the
   same numbers and duplicates ids already persisted (then one delete removes
   two rows). Time-based prefix + burst counter is collision-proof. */
let seq = 0
export const newId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}`
export const todayKey = (): string => localDateKey()
