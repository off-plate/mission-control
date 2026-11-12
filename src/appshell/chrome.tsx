import { Orb } from '../orb'
import { Component, type ReactNode } from 'react'
import { useStore } from '../store'
import { ago, describe, useSyncStatus } from '../sync'

/* Is this thing up to date, and where did the last change come from.

   He asked for it after working on the laptop, editing on the phone, and having
   no way to tell whether the two had met. The answer was already in the app, on
   the Settings page, which is exactly where nobody looks to find out whether
   something that should be automatic is working.

   Two facts, one line. Ordinarily it says when the state last reached the
   server. When a change arrived from somewhere else it says so instead, and
   keeps saying so until he writes something here, because "your phone's edit
   landed" is the news and "synced" is the assumption.

   Alert by exception on the phone: at that width the ordinary case is a dot
   with no words, and the words come back the moment there is something to say. */
export function SyncPip() {
  const sync = useSyncStatus()
  const { syncOrigin } = useStore()

  const settled = sync.phase === 'synced' || sync.phase === 'off'
  /* A pending or failed push is about THIS device and outranks the news from
     another one: telling him his phone's edit arrived while his own is stuck in
     an outbox would be true and useless. */
  const fromElsewhere = Boolean(syncOrigin) && settled
  const text = fromElsewhere && syncOrigin
    ? `Updated from ${syncOrigin.name} ${ago(syncOrigin.at)}`
    : describe(sync)

  /* The dot answers one question only: is sync healthy. A change arriving from
     his phone is not a warning and not a problem, so it is the same green as an
     ordinary sync and the WORDS carry the difference. The alternative was a
     fifth colour for "news", and `.status-dot.manual` is already redefined
     further down the stylesheet to the same amber as `warn`, so reusing it
     would have made "your phone's edit landed" look exactly like "still
     saving". */
  const tone = sync.phase === 'off' ? 'off'
    : sync.phase === 'error' || sync.phase === 'offline' ? 'alert'
    : sync.phase === 'saving' || sync.phase === 'waiting' ? 'warn'
    : 'connected'

  /* Quiet on a phone means the dot alone. News from another device is exactly
     the case that has earned its words, so it is never quiet. */
  const quiet = tone === 'connected' && !fromElsewhere

  return (
    <span className="syncpip" data-quiet={quiet || undefined} title={sync.detail || text}>
      {/* The dot is an orb (his ask, 2026-10-04): a still globe when all is
          saved, moving only while it saves, tinted when something is wrong. */}
      <span className="syncorb" title={text}>
        <Orb state={tone === 'warn' ? 'connecting' : 'searching'} size={22} paused={tone !== 'warn'}
          color={tone === 'alert' ? '#C2412D' : undefined} label={text} />
      </span>
      <span className="syncpip-text">{text}</span>
    </span>
  )
}

/* One failing page must not take the whole shell with it: the header, the nav
   and every other tab keep working while the broken view shows a card. */
export class PageBoundary extends Component<{ children: ReactNode; page: string }, { failed: boolean; why: string }> {
  state = { failed: false, why: '' }
  static getDerivedStateFromError(error: unknown) {
    return { failed: true, why: error instanceof Error ? error.message : String(error) }
  }
  /* SAY WHAT BROKE. This card used to swallow the error whole: he hit it
     repeatedly (2026-09-12) and there was nothing in the console and nothing
     on screen to say why, so every report was "it keeps happening" and every
     answer was a guess. The message goes to the console with its component
     stack, and onto the card, so the next screenshot carries its own cause. */
  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    console.error('[page crashed]', this.props.page, error, info?.componentStack ?? '')
  }
  componentDidUpdate(prev: { page: string }) {
    if (prev.page !== this.props.page && this.state.failed) this.setState({ failed: false, why: '' })
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="page">
          <div className="panel" style={{ maxWidth: 620 }}>
            <span className="microcap">This view hit an error</span>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', marginTop: 8 }}>
              Nothing was lost. Every other tab still works; open one from the menu above, or reload to try this one again.
            </p>
            {this.state.why && (
              <p className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--alert)', marginTop: 10, wordBreak: 'break-word' }}>
                {this.state.why}
              </p>
            )}
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => location.reload()}>Reload</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
