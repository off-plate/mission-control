/* Thin Supabase layer. The whole app state is stored as one JSON row in mc_state,
   owned by the signed-in account. When config is empty this module is inert and the
   app stays on localStorage, so nothing breaks until you paste your keys in config.ts.

   The anon key ships inside the page, which means anything the anon role can read is
   public. So the row is scoped to auth.uid() in the database and every read and write
   here goes out with a session attached. Signed out, this module does nothing and the
   app runs entirely on this device. */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_ENABLED, SUPABASE_URL } from './config'

const TABLE = 'mc_state'
let client: SupabaseClient | null = null

function db(): SupabaseClient | null {
  if (!SUPABASE_ENABLED) return null
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      // The session is what makes the row readable at all, so it has to survive a
      // reload; otherwise every visit would be a fresh login.
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  }
  return client
}

export interface Account { id: string; email: string }

/** The signed-in account, or null. Null also covers "sync is not configured". */
export async function currentAccount(): Promise<Account | null> {
  const c = db()
  if (!c) return null
  try {
    const { data } = await c.auth.getSession()
    const u = data.session?.user
    return u ? { id: u.id, email: u.email ?? '' } : null
  } catch { return null }
}

/** Fires whenever the account changes, including when a magic link lands. */
export function onAccountChange(fn: (a: Account | null) => void): () => void {
  const c = db()
  if (!c) return () => {}
  const { data } = c.auth.onAuthStateChange((_e, session) => {
    const u = session?.user
    fn(u ? { id: u.id, email: u.email ?? '' } : null)
  })
  return () => data.subscription.unsubscribe()
}

/** Email a one-time sign-in link. Returns an error message, or null on success. */
export async function sendSignInLink(email: string): Promise<string | null> {
  const c = db()
  if (!c) return 'Sync is not configured in this build.'
  const { error } = await c.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: location.origin + location.pathname },
  })
  return error ? error.message : null
}

export async function signOutAccount(): Promise<void> {
  const c = db()
  if (!c) return
  try { await c.auth.signOut() } catch { /* nothing to do */ }
}

/** Drops the magic-link fragment once the session is stored, so a live token is
 *  not left sitting in the address bar or in browser history. */
export function clearAuthFragment(): void {
  if (typeof location === 'undefined') return
  if (!/access_token=|error_description=/.test(location.hash)) return
  history.replaceState(null, '', location.pathname + location.search)
}

/** The saved state as a JSON string, or null if none / signed out. */
export async function loadRemoteState(): Promise<string | null> {
  const c = db()
  const me = await currentAccount()
  if (!c || !me) return null
  try {
    const { data, error } = await c.from(TABLE).select('data').eq('id', me.id).maybeSingle()
    if (error) { console.warn('supabase load:', error.message); return null }
    return data?.data ? JSON.stringify(data.data) : null
  } catch (e) {
    console.warn('supabase load failed', e)
    return null
  }
}

/** Upsert the whole state blob against the signed-in account. */
export async function saveRemoteState(json: string): Promise<void> {
  const c = db()
  const me = await currentAccount()
  if (!c || !me) return
  try {
    const data = JSON.parse(json)
    const { error } = await c.from(TABLE).upsert({ id: me.id, owner: me.id, data, updated_at: new Date().toISOString() })
    if (error) console.warn('supabase save:', error.message)
  } catch (e) {
    console.warn('supabase save failed', e)
  }
}

/** Clear the saved state (used by Reset). */
export async function deleteRemoteState(): Promise<void> {
  const c = db()
  const me = await currentAccount()
  if (!c || !me) return
  try { await c.from(TABLE).delete().eq('id', me.id) } catch (e) { console.warn('supabase delete failed', e) }
}

export { SUPABASE_ENABLED }
