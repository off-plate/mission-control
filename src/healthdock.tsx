/* THE FLOATING HEALTH GLANCE. The dock's other panels answer one question
   each, and this one's is "am I still training, and what is it costing me to
   have stopped" -- fitness now against its own peak, and how long since a
   session. The full page carries the charts; this carries the verdict. */
import { type ReactNode } from 'react'
import { useStore } from './store'
import { agoFrom, daysSince, fmtDay, fmtHm, lastReading, rollUpByDay, totals, useHealth, useHealthSync, withinDays } from './health'
import * as Icon from './icons'

export function HealthChip() {
  return <Icon.DockHeartbeat size={22} />
}

export function HealthPanel({ dockControls, onOpenFull }: { dockControls?: ReactNode; onOpenFull?: () => void }) {
  const { setPage } = useStore()
  const { state } = useHealth()
  const { sync, start } = useHealthSync()

  const openFull = () => { setPage('health'); onOpenFull?.() }

  const days = state.status === 'ok' ? state.days : []
  const sessions = state.status === 'ok' ? state.sessions : []
  const fitness = lastReading(days, 'ctl')
  const peak = days.reduce((m, d) => (d.ctl != null && d.ctl > m ? d.ctl : m), 0)
  const sessionDays = rollUpByDay(sessions)
  const last = sessionDays[0] ?? null
  const week = totals(withinDays(sessionDays, 7))
  const busy = sync.phase === 'asking' || sync.phase === 'running'

  return (
    <div className="billsdock-panel">
      <div className="billsdock-head">
        <span className="billsdock-title">Health</span>
        <button className="btn btn-primary dock-open-btn" onClick={openFull} title="Open Health">
          <Icon.ExternalLink size={13} />
          Health
        </button>
        {dockControls}
      </div>
      <div className="billsdock-body">
        {state.status === 'off' && <p className="empty">Sync is off on this device.</p>}
        {state.status === 'signed-out' && <p className="empty">Not signed in on this device.</p>}
        {state.status === 'error' && <p className="empty">{state.message}</p>}
        {state.status === 'loading' && <p className="empty">Reading the watch…</p>}
        {state.status === 'empty' && <p className="empty">Nothing has synced yet.</p>}
        {state.status === 'ok' && (
          <div className="hpdock">
            <div className="hpdock-lead">
              <b>{fitness ? fitness.value.toFixed(1) : '—'}</b>
              <span>fitness{peak ? `, ${Math.round(((fitness?.value ?? 0) / peak) * 100)}% of peak` : ''}</span>
            </div>
            <div className="hpdock-rows">
              <div className="hpdock-row">
                <span>Last session</span>
                <b>{last ? `${fmtDay(last.day)}, ${daysSince(last.day)}d ago` : 'none on record'}</b>
              </div>
              <div className="hpdock-row">
                <span>This week</span>
                <b>{week.days ? `${week.days} ${week.days === 1 ? 'day' : 'days'}, ${fmtHm(week.minutes)}` : 'nothing yet'}</b>
              </div>
              <div className="hpdock-row">
                <span>Synced</span>
                <b>{state.lastRun ? agoFrom(state.lastRun.ran_at) : 'never'}</b>
              </div>
            </div>
            <button className="btn btn-quiet hpdock-sync" onClick={start} disabled={busy}>
              <Icon.Repeat size={13} className={busy ? 'hp-spin' : undefined} />
              {busy ? 'Syncing…' : 'Sync now'}
            </button>
            {sync.phase === 'done' && <p className="hpdock-note">Synced {sync.run.wellness_rows ?? 0} days, {sync.run.activity_rows ?? 0} sessions.</p>}
            {sync.phase === 'failed' && <p className="hpdock-note is-bad">{sync.message}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
