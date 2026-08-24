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

/** Call an Edge Function as the signed-in user. The calendar proxy verifies
 *  the JWT, so nobody without his session can pull his work calendar through
 *  it: the function is the only thing holding the feed's secret address, and a
 *  function anyone may call is the same as publishing that address. */
export async function callFunction(name: string): Promise<{ ok: true; data: unknown } | { ok: false; reason: 'off' | 'signed-out' | 'error'; message?: string }> {
  const c = db()
  if (!c) return { ok: false, reason: 'off' }
  const me = await currentAccount()
  if (!me) return { ok: false, reason: 'signed-out' }
  try {
    /* supabase-js decides the shape from the response's content-type: JSON comes
       back already parsed, text/plain as a string, anything else as a Blob. So
       the value is handed on as-is and the caller reads what it asked for.
       This used to force everything through a string, which turned a parsed
       object into "[object Object]" the moment the function started answering
       JSON, and the app reported the calendar as unreadable. */
    const { data, error } = await c.functions.invoke(name, { method: 'GET' })
    if (error) return { ok: false, reason: 'error', message: error.message }
    return { ok: true, data }
  } catch (e) {
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : 'unreachable' }
  }
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

/* Sign-in is a code typed back in, not a link clicked.

   The Supabase project is shared with his other apps, and its email template is
   the one Compass wrote: it sends a numeric code rather than a confirmation URL.
   Rather than fight over a template several apps depend on, take the code. It
   also sidesteps the redirect allow-list entirely, and a link still works if the
   template ever changes, because the client reads one out of the URL by itself. */

/* Supabase phrases its refusals for developers. These are the ones he can
   actually hit, said plainly. Anything else is passed through as-is rather than
   swallowed, because a message I did not anticipate is worth seeing. */
function plainly(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('signups not allowed')) return 'That address has no account here. Use the one your other apps sign in with.'
  if (m.includes('invalid') || m.includes('expired')) return 'That code did not work. They expire after an hour, so ask for a new one.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many tries. Wait a minute and ask again.'
  if (m.includes('failed to fetch') || m.includes('network')) return 'No connection. The app keeps working on this device.'
  return msg
}

/** Email a one-time sign-in code. Returns an error message, or null on success. */
export async function sendSignInCode(email: string): Promise<string | null> {
  const c = db()
  if (!c) return 'Sync is not configured in this build.'
  const { error } = await c.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: location.origin + location.pathname },
  })
  return error ? plainly(error.message) : null
}

/** Exchange the emailed code for a session. Returns an error message, or null. */
export async function signInWithCode(email: string, code: string): Promise<string | null> {
  const c = db()
  if (!c) return 'Sync is not configured in this build.'
  const { error } = await c.auth.verifyOtp({
    email: email.trim(),
    token: code.replace(/\s+/g, ''),
    type: 'email',
  })
  return error ? plainly(error.message) : null
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

/* A read has three outcomes, and collapsing them to null was a bug waiting to
   happen: "no row yet" and "the network is down" are opposites. The first means
   this device's copy is the only copy and should be written; the second means we
   know nothing and must not write anything, or an offline laptop would overwrite
   a phone's good data with its own stale blob the moment one packet got through. */
export type Head =
  | { ok: true; json: string | null }
  | { ok: false; reason: 'offline' | 'signed-out' | 'error'; message?: string }

export async function loadRemoteHead(): Promise<Head> {
  const c = db()
  if (!c) return { ok: false, reason: 'signed-out' }
  const me = await currentAccount()
  if (!me) return { ok: false, reason: 'signed-out' }
  try {
    const { data, error } = await c.from(TABLE).select('data').eq('id', me.id).maybeSingle()
    if (error) return { ok: false, reason: 'error', message: error.message }
    return { ok: true, json: data?.data ? JSON.stringify(data.data) : null }
  } catch (e) {
    // Thrown, rather than returned as an error, is what a dead connection looks like.
    return { ok: false, reason: 'offline', message: e instanceof Error ? e.message : String(e) }
  }
}

/** The saved state as a JSON string, or null if none / signed out / unreachable. */
export async function loadRemoteState(): Promise<string | null> {
  const head = await loadRemoteHead()
  return head.ok ? head.json : null
}

import { mergeStates } from './sync-merge'

export type SaveResult =
  | { ok: true; merged: string }
  | { ok: false; reason: 'offline' | 'signed-out' | 'error'; message?: string }

/** Upsert the state against the signed-in account. NEVER blind: the remote head
 *  is read first and the dated logs of both sides are united, so a save from a
 *  stale tab can no longer erase work a fresher one already banked.
 *
 *  If the head cannot be READ, this refuses to write and says so. The caller
 *  retries later. Writing anyway is how an offline device silently wins. */
export async function saveRemoteState(json: string): Promise<SaveResult> {
  const c = db()
  if (!c) return { ok: false, reason: 'signed-out' }
  const me = await currentAccount()
  if (!me) return { ok: false, reason: 'signed-out' }

  const head = await loadRemoteHead()
  if (!head.ok) return { ok: false, reason: head.reason, message: head.message }

  try {
    const merged = head.json ? mergeStates(json, head.json) : json
    const data = JSON.parse(merged)
    const { error } = await c.from(TABLE).upsert({ id: me.id, owner: me.id, data, updated_at: new Date().toISOString() })
    if (error) return { ok: false, reason: 'error', message: error.message }
    return { ok: true, merged }
  } catch (e) {
    return { ok: false, reason: 'offline', message: e instanceof Error ? e.message : String(e) }
  }
}

/** Read rows from another app's tables in this same project (Compass). Returns
 *  null when signed out or unconfigured, which every caller must handle as
 *  "no data", never as zero. */
export async function readRows<T>(table: string, columns: string): Promise<T[] | null> {
  const c = db()
  const me = await currentAccount()
  if (!c || !me) return null
  const { data, error } = await c.from(table).select(columns)
  if (error) throw new Error(error.message)
  return (data ?? []) as T[]
}

/** Clear the saved state (used by Reset). */
export async function deleteRemoteState(): Promise<void> {
  const c = db()
  const me = await currentAccount()
  if (!c || !me) return
  try { await c.from(TABLE).delete().eq('id', me.id) } catch (e) { console.warn('supabase delete failed', e) }
}

export { SUPABASE_ENABLED }
