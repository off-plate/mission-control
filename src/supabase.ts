/* Thin Supabase layer. The whole app state is stored as one JSON row in mc_state
   (single-user, no auth yet). When config is empty this module is inert and the app
   stays on localStorage, so nothing breaks until you paste your keys in config.ts. */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { STATE_ROW_ID, SUPABASE_ANON_KEY, SUPABASE_ENABLED, SUPABASE_URL } from './config'

const TABLE = 'mc_state'
let client: SupabaseClient | null = null

function db(): SupabaseClient | null {
  if (!SUPABASE_ENABLED) return null
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  return client
}

/** The saved state as a JSON string, or null if none / not configured. */
export async function loadRemoteState(): Promise<string | null> {
  const c = db()
  if (!c) return null
  try {
    const { data, error } = await c.from(TABLE).select('data').eq('id', STATE_ROW_ID).maybeSingle()
    if (error) { console.warn('supabase load:', error.message); return null }
    return data?.data ? JSON.stringify(data.data) : null
  } catch (e) {
    console.warn('supabase load failed', e)
    return null
  }
}

/** Upsert the whole state blob. */
export async function saveRemoteState(json: string): Promise<void> {
  const c = db()
  if (!c) return
  try {
    const data = JSON.parse(json)
    const { error } = await c.from(TABLE).upsert({ id: STATE_ROW_ID, data, updated_at: new Date().toISOString() })
    if (error) console.warn('supabase save:', error.message)
  } catch (e) {
    console.warn('supabase save failed', e)
  }
}

/** Clear the saved state (used by Reset the demo). */
export async function deleteRemoteState(): Promise<void> {
  const c = db()
  if (!c) return
  try { await c.from(TABLE).delete().eq('id', STATE_ROW_ID) } catch (e) { console.warn('supabase delete failed', e) }
}

export { SUPABASE_ENABLED }
