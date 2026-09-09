/* SKILLS, read from Supabase rather than bundled: this repo is public, and a
   list of business playbooks, client-facing processes and internal-only
   automation would ship to anyone who opens the site if it lived in the JS
   bundle instead. Same reasoning Bills and Compass already follow for his
   real financial data -- nothing sensitive is ever hardcoded here.

   One shared read, not one per caller (same pattern as compass.ts): the
   dock's compact panel and the full page can both be on screen at once. */
import { useCallback, useSyncExternalStore } from 'react'
import { SUPABASE_ENABLED, readRows } from './supabase'
import { createLiveStore } from './livestore'

export interface Skill {
  workspace: string
  slug: string
  name: string
  description: string
}

export type SkillsState =
  | { status: 'off' }
  | { status: 'signed-out' }
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ok'; skills: Skill[] }

const STALE_MS = 120_000

let readAt = 0
const store = createLiveStore<SkillsState>(
  SUPABASE_ENABLED ? { status: 'loading' } : { status: 'off' },
  { onFirstSubscriber: () => { queueMicrotask(() => { void refresh() }) } },
)

function publish(next: SkillsState): void {
  readAt = Date.now()
  store.publish(next)
}

async function readSkills(): Promise<SkillsState> {
  if (!SUPABASE_ENABLED) return { status: 'off' }
  try {
    const rows = await readRows<{ workspace: string; slug: string; name: string; description: string }>(
      'mc_skills', 'workspace,slug,name,description',
    )
    if (rows === null) return { status: 'signed-out' }
    if (rows.length === 0) return { status: 'empty' }
    return { status: 'ok', skills: rows.sort((a, b) => a.name.localeCompare(b.name)) }
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : 'Skills could not be read.' }
  }
}

let inFlight: Promise<void> | null = null

function refresh(force = false): Promise<void> {
  if (inFlight) return inFlight
  const view = store.getSnapshot()
  if (!SUPABASE_ENABLED) { if (view.status !== 'off') publish({ status: 'off' }); return Promise.resolve() }
  if (!force && view.status !== 'loading' && view.status !== 'off' && Date.now() - readAt < STALE_MS) return Promise.resolve()
  publish({ status: 'loading' })
  inFlight = readSkills()
    .then((s) => { publish(s) })
    .finally(() => { inFlight = null })
  return inFlight
}

export function useSkills(): { state: SkillsState; reload: () => void } {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const reload = useCallback(() => { void refresh(true) }, [])
  return { state, reload }
}
