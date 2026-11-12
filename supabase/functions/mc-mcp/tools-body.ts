/* Health and the gym (the Cookie Jar's Health and Gym pages). Logic: ops-body.ts.
   - Hevy is read live with the server's own key (secret HEVY_API_KEY, the one the widget uses;
     the app's key lives only in each browser). Nothing here writes to Hevy.
   - Health is read from the zepp_* tables as HIS session (row-level security), and sync_health
     asks the zepp-sync function to pull Intervals now, the app's Sync button. */
import type { Reg } from './reg.ts'
import { McError, dateKey } from './ops.ts'
import { commit, readState } from './commit.ts'
import * as B from './ops-body.ts'

const HEVY = 'https://api.hevyapp.com/v1/workouts'
const MAX_PAGES = 60 // src/hevy.ts MAX_PAGES

async function hevyPage(key: string, page: number): Promise<{ workouts: any[]; page_count: number }> {
  const res = await fetch(`${HEVY}?pageSize=10&page=${page}`, { headers: { 'api-key': key } })
  if (res.status === 401 || res.status === 403) throw new McError('Hevy refused the server\'s key (HEVY_API_KEY). It needs a fresh key from Hevy settings > Developer, set as a Supabase secret.')
  if (res.status === 429) throw new McError('Hevy says too many requests right now. Try again in a minute.')
  if (!res.ok) throw new McError(`Hevy could not be read (${res.status}). I do not know what he trained.`)
  const j = await res.json()
  return { workouts: Array.isArray(j?.workouts) ? j.workouts : [], page_count: Number(j?.page_count) || 1 }
}
/** Every workout in his Hevy history (the app also reads the whole history: PRs need it). */
export async function hevyAll(): Promise<any[]> {
  const key = Deno.env.get('HEVY_API_KEY')
  if (!key) throw new McError('Hevy is not connected on the server (no HEVY_API_KEY secret). I cannot read his workouts.')
  const first = await hevyPage(key, 1)
  const last = Math.min(MAX_PAGES, first.page_count)
  const out = [...first.workouts]
  for (let p = 2; p <= last; p += 6) {
    const batch = await Promise.all(Array.from({ length: Math.min(6, last - p + 1) }, (_, k) => hevyPage(key, p + k)))
    for (const pg of batch) out.push(...pg.workouts)
  }
  return out
}

const back = (n: number) => { const d = new Date(`${dateKey()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }
function range(i: { from?: string; to?: string }, defDays: number) {
  const to = i.to ?? dateKey(); const from = i.from ?? back(defDays - 1)
  if (from > to) throw new McError('from is after to.')
  return { from, to }
}

export function register(r: Reg): void {
  const { z, ann, s } = r
  const db = r.db as any

  r.tool('get_gym', {
    title: 'Gym: workouts, PRs and goals (Hevy)',
    description: 'His training, read live from Hevy (the Gym page): sessions from `from` to `to` (default the last 30 days) with each workout\'s exercises, best set, e1RM, reps, minutes and volume; the PRs set in that range; days since the last session; and every gym goal with its LIVE current value and % (e1RM and rep goals from his real Hevy sets, the sessions goal from all Hevy days, manual goals from the number he keeps). Read only; to tick the Workout habit from Hevy use sync_hevy.',
    inputSchema: z.object({ from: s.date.optional(), to: s.date.optional() }),
    annotations: { ...ann.RO, openWorldHint: true },
  }, (i) => r.safe(async () => {
    const [b, ws] = await Promise.all([readState(r.db, r.uid), hevyAll()])
    return B.gymReport(b, B.parseHevy(ws), range(i, 30))
  }))

  r.tool('sync_hevy', {
    title: 'Sync Hevy into the habits',
    description: 'The app\'s Hevy sync, run from here: every day with a Hevy workout ticks the "Workout / Gym / Fitness" habit, and every day with a stair machine ticks "Bike / Run / Stairs", from `since` (default 30 days ago) to today. Only turns days ON, never off, and skips days already ticked (his rule: Hevy proposes, his own click wins). Returns the days it ticked.',
    inputSchema: z.object({ since: s.date.optional().describe('First day to tick from, YYYY-MM-DD (default 30 days ago, at most 400 days back)') }),
    annotations: { ...ann.WI, openWorldHint: true },
  }, (i) => r.safe(async () => {
    const since = i.since ?? back(30)
    if (since < back(400)) throw new McError('At most 400 days back in one sync.')
    const h = B.parseHevy(await hevyAll())
    return (await commit(r.db, r.uid, (b) => B.hevyHabitTicks(b, h, since))).text
  }))

  r.tool('get_health', {
    title: 'Health: sleep, steps, heart, weight, sessions',
    description: 'The Health page: latest reading of each metric (steps, sleep, sleep score, resting heart rate, weight, fitness CTL / fatigue ATL) WITH the day it was taken and how old it is, the daily rows from `from` to `to` (default the last 14 days), every training session from the watch in that range (type, minutes, heart rate, calories, load, km), and when the sync last ran. Watch -> Zepp -> Intervals.icu -> Mission Control. A stream that went quiet shows its old day: never call an old reading current. Read only; to pull fresh data use sync_health.',
    inputSchema: z.object({ from: s.date.optional(), to: s.date.optional() }),
    annotations: ann.RO,
  }, (i) => r.safe(async () => {
    const q = range(i, 14)
    const [w, a, run] = await Promise.all([
      db.from('zepp_wellness').select('day,resting_hr,sleep_secs,sleep_score,steps,weight,ctl,atl,ramp_rate').order('day', { ascending: false }).limit(400),
      db.from('zepp_activities').select('id,start_date,start_date_local,type,name,moving_time,average_heartrate,max_heartrate,calories,icu_training_load,distance').order('start_date', { ascending: false }).limit(400),
      db.from('zepp_sync_log').select('ran_at,ok,wellness_rows,activity_rows,error').order('ran_at', { ascending: false }).limit(1),
    ])
    const err = w.error ?? a.error
    if (err) throw new McError(`The health data could not be read (${err.message}). I do not know his readings.`)
    return B.healthReport(w.data ?? [], a.data ?? [], run.error ? null : (run.data ?? [])[0] ?? null, q)
  }))

  r.tool('sync_health', {
    title: 'Pull fresh health data now',
    description: 'The Health page\'s Sync button: asks the zepp-sync function to pull the last 60 days from Intervals.icu into Mission Control now (it also runs by itself every two hours). It can take a few minutes; if it is still running when this answers, read get_health again shortly. Writes only the health tables, never his app data.',
    inputSchema: z.object({}),
    annotations: { ...ann.WI, openWorldHint: true },
  }, () => r.safe(async () => {
    const fns = db.functions
    if (!fns || typeof fns.invoke !== 'function') throw new McError('The health sync cannot be reached from here.')
    const call = fns.invoke('zepp-sync', { method: 'POST', body: { lookback_days: 60 } })
    const res = await Promise.race([call, new Promise((ok) => setTimeout(() => ok('slow'), 25000))])
    if (res === 'slow') return 'The health sync is running (Intervals is slow today). Check get_health in a few minutes: lastSync.at shows when it landed.'
    const { data, error } = res as { data: any; error: any }
    if (error) {
      const status = error?.context?.status
      throw new McError(`The health sync failed${status ? ` (${status})` : ''}${status === 401 ? ': it only answers his own session' : ''}. The data was not refreshed.`)
    }
    return { synced: true, wellnessRows: data?.wellness_rows ?? null, activityRows: data?.activity_rows ?? null, note: 'Read get_health for the fresh numbers.' }
  }))
}
