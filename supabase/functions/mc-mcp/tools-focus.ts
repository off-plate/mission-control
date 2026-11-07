/* The focus timer: start, stop, pause, resume, extend, break, status.
   Written into the synced `activeFocus` field, so Mission Control shows it on any device. */
import * as fx from './ops-focus.ts'
import type { Reg } from './reg.ts'

export function register(r: Reg): void {
  const { z, ann, s, read, write } = r
  const minutes = z.number().int().min(1).max(fx.MAX_FOCUS_MIN)

  r.tool('start_focus', {
    title: 'Start a focus timer',
    description: "Start a REAL focus timer in Mission Control, optionally on a task (id or title from a list; the label and space come from it) for a number of minutes (default: the task's estimate; otherwise pass minutes). Without a task, pass space (personal or work) and optionally a label. It runs on every device at once and logs itself when it ends. Refuses while a focus block is already running or finished-but-unlogged: stop_focus first. A running break is replaced.",
    inputSchema: z.object({ ...s.ref, minutes: minutes.optional().describe('Block length in minutes'), label: z.string().max(300).optional().describe('What it is for, when no task is given'), space: s.space.optional().describe('Required when no task is given') }),
    annotations: ann.W,
  }, ({ id, title, minutes: m, label, space }) => write((b) => fx.startFocus(b, { id, title, minutes: m, label, space })))

  r.tool('stop_focus', {
    title: 'Stop the focus timer',
    description: 'Stop the running focus or break timer. Minutes already worked in a focus block are logged as a focus session (whole minutes, as the app does). Does nothing if no timer is running.',
    inputSchema: z.object({}), annotations: ann.WI,
  }, () => write((b) => fx.stopFocus(b)))

  r.tool('pause_focus', { title: 'Pause the timer', description: 'Freeze the running focus or break timer with its remaining time.', inputSchema: z.object({}), annotations: ann.WI }, () => write((b) => fx.pauseFocus(b)))
  r.tool('resume_focus', { title: 'Resume the timer', description: 'Resume a paused timer from the time it had left.', inputSchema: z.object({}), annotations: ann.WI }, () => write((b) => fx.resumeFocus(b)))
  r.tool('extend_focus', {
    title: 'More focus',
    description: 'Keep going: logs what the running block has worked so far, then starts a fresh block of the given minutes under the same name (the app\'s "more focus instead").',
    inputSchema: z.object({ minutes }), annotations: ann.W,
  }, ({ minutes: m }) => write((b) => fx.extendFocus(b, m)))
  r.tool('start_break', {
    title: 'Start a break', description: 'Start a break timer of the given minutes. Refuses while a focus block is running: stop_focus first.',
    inputSchema: z.object({ minutes }), annotations: ann.W,
  }, ({ minutes: m }) => write((b) => fx.startBreak(b, m)))
  r.tool('get_focus_timer', { title: 'Focus timer status', description: 'Is a focus or break timer running, what for, and how long is left.', inputSchema: z.object({}), annotations: ann.RO }, () => read((b) => fx.focusStatus(b)))
}
