/* Supabase connection.
   Paste your project's two values below to connect the app to a real database.
   - SUPABASE_URL:      Project Settings -> API -> Project URL   (https://xxxx.supabase.co)
   - SUPABASE_ANON_KEY: Project Settings -> API -> anon public key (starts eyJ...)
   The anon key is meant to live in a web app, so it is safe to ship here.
   While these are empty the app persists to this browser only (localStorage). */

export const SUPABASE_URL = ''
export const SUPABASE_ANON_KEY = ''

export const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

/* Single-user for now: one row holds the whole app state as JSON. */
export const STATE_ROW_ID = 'default'
