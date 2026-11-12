/* The Cookie Jar (#/timeline): momentum, the flywheel, the ladder. READ ONLY, because the app
   never stores momentum: it replays the log every time (src/momentum.ts, copied verbatim into
   momentum-app.ts). The inputs are the ones src/timeline.tsx passes: every space, habits, the
   habit log, tasks, focus blocks, outreach touches on prospects, and the days a training session
   reached the health pipeline (zepp_activities). Logic: ops-jar.ts. */
import type { Reg } from './reg.ts'
import { readState } from './commit.ts'
import * as J from './ops-jar.ts'

export function register(r: Reg): void {
  const { z, ann } = r

  r.tool('get_momentum', {
    title: 'Momentum and the Cookie Jar',
    description: 'The Cookie Jar page (his "Jar"): momentum right now (0-100) and its state name (Cold, Turning over, Carrying itself, Hard to stop, Runs without you), the day chain (current, longest, whether today still counts), TODAY in detail (points earned vs a full day, habits / tasks / focus / hard thing / outreach against their targets, what is still missing to keep the day), the ladder rungs by day, week or month (zoom d/w/m, newest first), and the two futures from the give-up screen (keep going vs stop) over `days` (default 30). Computed from his real log exactly as the page computes it; momentum is derived, never stored, so it cannot be edited: it moves when habits, tasks, focus and outreach are logged. Finances are not part of it (use the bills tools).',
    inputSchema: z.object({
      zoom: z.enum(['d', 'w', 'm']).optional().describe('Ladder rungs: d days (default), w weeks, m months'),
      rows: z.number().int().min(1).max(60).optional().describe('How many rungs (default 14 days, 8 weeks, 4 months)'),
      days: z.number().int().min(7).max(365).optional().describe('How far ahead the two futures run (default 30)'),
    }),
    annotations: ann.RO,
  }, (i) => r.safe(async () => {
    const [b, res] = await Promise.all([
      readState(r.db, r.uid),
      (r.db as any).from('zepp_activities').select('start_date,start_date_local').order('start_date', { ascending: false }).limit(400),
    ])
    const workoutDays = res?.error ? null : J.sessionDays(res?.data ?? [])
    return J.cookieJar(b, { ...i, workoutDays })
  }))
}
