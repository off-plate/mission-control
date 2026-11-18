/* How many minutes a finished task adds to focus. Shared by the app (logActual,
   logSubtaskActual) and the connector (log_task_time), so the rule lives once.

   The time he logs on a task IS his focus on it. Minutes the timer already
   banked today under the same label are part of that, so only the rest is
   added: a timer block of 25 plus "30 min" on the tick = 30 in focus, not 55.
   The ledger row keeps the full logged time either way. */
export function focusTopUp(sessions: { day: string; label?: string | null; minutes: number }[], title: string, day: string, actualMin: number): number {
  const want = title.trim().toLowerCase()
  const already = sessions.filter((f) => f.day === day && (f.label ?? '').trim().toLowerCase() === want).reduce((a, f) => a + (Number(f.minutes) || 0), 0)
  return Math.max(0, Math.round(actualMin) - already)
}
