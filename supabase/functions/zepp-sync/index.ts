/* THE HEALTH SYNC. Intervals.icu to Supabase, in one place.

   This used to live in off-plate/zepp-health as two separate things: a Node
   worker on a GitHub Actions cron, and a Netlify function whose only job was
   to hold a GitHub token so the app's Sync button could dispatch that cron.
   Three services and two copies of the same intent, for one job.

   It is one function now, and it is the only implementation. The button calls
   it. The cron calls it. There is no GitHub token anywhere any more, and no
   Netlify.

   The key stays here rather than in the app: supabase/functions is deployed,
   never bundled, so nothing in this file reaches the browser. That is the
   whole point -- an Intervals key in a public bundle can read every workout,
   weight and resting heart rate on the account.

   Deploy:
     supabase secrets set INTERVALS_API_KEY="..." INTERVALS_ATHLETE_ID="i..."
     supabase functions deploy zepp-sync

   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are handed to every edge function
   by the platform, so they are not secrets to set. The service role is what
   lets this write rows that RLS would otherwise refuse: the writer is a cron,
   not a signed-in person. */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOW = [
  'https://off-plate.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
]

/* Every header supabase-js actually sends. A preflight that does not name all
   of them is refused by the browser before the real request goes out, and the
   symptom is a useless "Failed to send a request to the Edge Function" while
   curl against the same URL answers 200. */
const cors = (origin: string | null) => ({
  'access-control-allow-origin': origin && ALLOW.includes(origin) ? origin : ALLOW[0],
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
  'vary': 'origin',
})

const OWNER = Deno.env.get('ZEPP_USER_EMAIL') ?? 'mihael.florian@gmail.com'
const KEY = Deno.env.get('INTERVALS_API_KEY') ?? ''
const ATHLETE = Deno.env.get('INTERVALS_ATHLETE_ID') ?? ''

const ymd = (d: Date) => d.toISOString().slice(0, 10)

async function intervals(path: string): Promise<any[]> {
  const auth = 'Basic ' + btoa('API_KEY:' + KEY)
  const res = await fetch(`https://intervals.icu/api/v1/athlete/${ATHLETE}${path}`, {
    headers: { Authorization: auth },
  })
  if (!res.ok) throw new Error(`Intervals ${res.status} ${res.statusText} for ${path}`)
  return await res.json()
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const head = cors(origin)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: head })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: head })

  if (!KEY || !ATHLETE) {
    return new Response(JSON.stringify({ ok: false, error: 'Intervals credentials are not configured' }),
      { status: 500, headers: { ...head, 'content-type': 'application/json' } })
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  let days = 60
  try {
    const body = await req.json()
    const asked = Number(body?.lookback_days)
    /* A year is the most the page can ask for, and the floor stops a typo
       turning into a full-history refetch on every button press. */
    if (Number.isFinite(asked)) days = Math.min(400, Math.max(1, Math.round(asked)))
  } catch { /* no body is fine, 60 days is the default */ }

  let wellnessRows = 0
  let activityRows = 0
  try {
    /* Rows are owned by the signed-in account, so the sync has to write them
       under the same user_id the app reads as. Looked up by email rather than
       hard-coded: an id pasted into source is a silent mismatch waiting for
       the day the account is rebuilt. */
    const { data: users, error: uErr } = await sb.auth.admin.listUsers()
    if (uErr) throw uErr
    const owner = users.users.find((u) => u.email === OWNER)
    if (!owner) throw new Error(`No account for ${OWNER}. Sign in on the site once first.`)

    const newest = new Date()
    const oldest = new Date()
    oldest.setDate(oldest.getDate() - days)
    const window = `?oldest=${ymd(oldest)}&newest=${ymd(newest)}`
    const stamp = new Date().toISOString()

    const wellness = await intervals(`/wellness${window}`)
    const mappedW = wellness.map((r) => ({
      user_id: owner.id,
      day: r.id,
      resting_hr: r.restingHR ?? null,
      sleep_secs: r.sleepSecs ?? null,
      sleep_score: r.sleepScore ?? null,
      sleep_quality: r.sleepQuality ?? null,
      steps: r.steps ?? null,
      weight: r.weight ?? null,
      ctl: r.ctl ?? null,
      atl: r.atl ?? null,
      atl_load: r.atlLoad ?? null,
      ctl_load: r.ctlLoad ?? null,
      ramp_rate: r.rampRate ?? null,
      raw: r,
      updated_at: stamp,
    }))
    if (mappedW.length) {
      const { error } = await sb.from('zepp_wellness').upsert(mappedW, { onConflict: 'user_id,day' })
      if (error) throw error
      wellnessRows = mappedW.length
    }

    const acts = await intervals(`/activities${window}`)
    const mappedA = acts.map((r) => ({
      id: r.id,
      user_id: owner.id,
      start_date: r.start_date,
      start_date_local: r.start_date_local,
      type: r.type,
      sub_type: r.sub_type,
      name: r.name,
      description: r.description,
      device_name: r.device_name,
      moving_time: r.moving_time,
      elapsed_time: r.elapsed_time,
      distance: r.distance,
      total_elevation_gain: r.total_elevation_gain,
      average_speed: r.average_speed,
      max_speed: r.max_speed,
      average_heartrate: r.average_heartrate,
      max_heartrate: r.max_heartrate,
      average_cadence: r.average_cadence,
      calories: r.calories,
      trimp: r.trimp,
      icu_training_load: r.icu_training_load,
      has_heartrate: r.has_heartrate,
      raw: r,
      updated_at: stamp,
    }))
    if (mappedA.length) {
      const { error } = await sb.from('zepp_activities').upsert(mappedA, { onConflict: 'id' })
      if (error) throw error
      activityRows = mappedA.length
    }

    /* The page watches this table for a row newer than the one it saw when the
       button was pressed. It is how "Syncing" becomes "Synced", so it is
       written on the failure path too -- a sync that dies silently leaves the
       button spinning until it times out. */
    await sb.from('zepp_sync_log').insert({
      ok: true, wellness_rows: wellnessRows, activity_rows: activityRows, error: null,
    })
    return new Response(JSON.stringify({ ok: true, wellness_rows: wellnessRows, activity_rows: activityRows }),
      { status: 200, headers: { ...head, 'content-type': 'application/json' } })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await sb.from('zepp_sync_log').insert({
      ok: false, wellness_rows: wellnessRows, activity_rows: activityRows, error: message.slice(0, 1000),
    })
    return new Response(JSON.stringify({ ok: false, error: message }),
      { status: 500, headers: { ...head, 'content-type': 'application/json' } })
  }
})
