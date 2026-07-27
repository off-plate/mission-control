/* Supabase connection.
   Paste your project's two values below to connect the app to a real database.
   - SUPABASE_URL:      Project Settings -> API -> Project URL   (https://xxxx.supabase.co)
   - SUPABASE_ANON_KEY: Project Settings -> API -> anon public key (starts eyJ...)
   The anon key is meant to live in a web app, so it is safe to ship here.
   While these are empty the app persists to this browser only (localStorage). */

export const SUPABASE_URL = 'https://fhfempisopwsdkmvywbt.supabase.co'
export const SUPABASE_ANON_KEY = 'sb_publishable_MDxQPm0SzLHFTnDqg-eyyQ_0yposnES'

/* ?noremote in the URL runs the app fully local: no remote hydration, no remote
   writes. Used by automated testing so the real database is never touched. */
const NO_REMOTE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('noremote')

export const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY) && !NO_REMOTE

/* Single-user for now: one row holds the whole app state as JSON. */
export const STATE_ROW_ID = 'default'
