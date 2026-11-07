/* start_focus / stop_focus: queue a real focus timer command for his open app.
   Honest by construction: the answer says "queued", never "started". */
import * as ops from './ops.ts'
import * as fx from './ops-focus.ts'
import type { Reg } from './reg.ts'

export function register(r: Reg): void {
  const { z, ann, s, db, uid } = r
  const queue = async (made: { row: fx.InboxRow; text: string }) => {
    const { error } = await db.from('mc_inbox').insert(made.row)
    if (error) throw new ops.McError(`Could not queue it: ${error.message}. Nothing was started.`)
    return made.text
  }

  r.tool('start_focus', {
    title: 'Start a focus timer',
    description: `Ask his open Mission Control to start a REAL focus timer, optionally on a task (id or title from a list) and for a number of minutes (default: the task's estimate, else the length set in the app). This only QUEUES the request: the timer lives in his app, not on the server. It starts within about 15 seconds on a device that has Mission Control open, and is dropped after ${fx.FOCUS_TTL_MIN} minutes if none does. An already running focus block is left alone. Never tell him it started; say it was queued. To record focus he already did, that is a different thing.`,
    inputSchema: z.object({ ...s.ref, minutes: z.number().int().min(1).max(fx.MAX_FOCUS_MIN).optional().describe('Block length in minutes'), label: z.string().max(300).optional().describe('What it is for, when no task is named') }),
    annotations: ann.W,
  }, ({ id, title, minutes, label }) => r.safe(async () => {
    let blob: ops.Blob | null = null
    if (id || title) {
      const { data, error } = await db.from('mc_state').select('data').eq('id', uid).maybeSingle()
      if (error) throw new ops.McError(`Could not read Mission Control: ${error.message}`)
      blob = (data?.data as ops.Blob) ?? null
    }
    return queue(fx.startRow(blob, uid, crypto.randomUUID(), { id, title, minutes, label }))
  }))

  r.tool('stop_focus', {
    title: 'Stop the focus timer',
    description: `Ask his open Mission Control to stop the running focus (or break) timer; the time already worked is kept and logged by the app. This only QUEUES the request, same limits as start_focus. Do nothing if no timer is running (the app ignores it). Never tell him it stopped; say it was queued.`,
    inputSchema: z.object({}),
    annotations: ann.WI,
  }, () => r.safe(async () => queue(fx.stopRow(uid, crypto.randomUUID()))))
}
