/* The outbox.

   Why this exists: the store used to fire a debounced saveRemoteState and drop
   the result on the floor. Offline, that call fails and nothing ever retries it,
   so an evening of work sat in localStorage and reached the server only if he
   happened to edit something else while connected. Worse, coming back online
   pulled the stale remote, found local was already a superset, changed nothing,
   and therefore never triggered a save at all. The work was safe on the device
   and invisible everywhere else.

   So: every push goes through here. A push that fails marks the state dirty and
   is retried on a backoff, on reconnect, and on the next launch. The dirty flag
   is persisted, so quitting while offline does not lose the intent to sync.

   This is shared code. The website gets it too; the desktop app is not special. */

import { useEffect, useState } from 'react'
import { saveRemoteState, SUPABASE_ENABLED, type SaveResult } from './supabase'

export type SyncPhase = 'off' | 'synced' | 'saving' | 'waiting' | 'offline' | 'error'

export interface SyncStatus {
  phase: SyncPhase
  online: boolean
  /** When local last had changes that the server does not have. */
  dirtySince: number | null
  lastSyncedAt: number | null
  /** One short factual line. Never a reassurance. */
  detail: string
}

const DIRTY_KEY = 'mc-sync-dirty'
const LAST_KEY = 'mc-sync-last'

/* Backoff. Short enough that a brief drop resolves on its own, long enough that
   a genuinely offline afternoon is not a thousand failed requests. */
const BACKOFF = [2000, 5000, 10000, 30000, 60000, 120000]

function readNum(key: string): number | null {
  try { const v = localStorage.getItem(key); return v ? Number(v) || null : null } catch { return null }
}
function writeNum(key: string, v: number | null): void {
  try { v === null ? localStorage.removeItem(key) : localStorage.setItem(key, String(v)) } catch { /* private mode */ }
}

type Saver = (json: string) => Promise<SaveResult>

export class Outbox {
  /* The saver is injected so the state machine can be exercised without a network
     or an account. Everything below is about WHEN to write, which is exactly the
     part that was wrong before and the part worth testing. */
  constructor(private readonly save: Saver = saveRemoteState, private readonly enabled = SUPABASE_ENABLED) {
    this.phase = this.enabled ? 'synced' : 'off'
  }

  private latest: string | null = null
  private inFlight = false
  private attempt = 0
  private timer: number | undefined
  private listeners = new Set<(s: SyncStatus) => void>()
  private phase: SyncPhase = 'synced'
  private detail = ''
  private started = false

  status(): SyncStatus {
    return {
      phase: this.phase,
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
      dirtySince: readNum(DIRTY_KEY),
      lastSyncedAt: readNum(LAST_KEY),
      detail: this.detail,
    }
  }

  subscribe(fn: (s: SyncStatus) => void): () => void {
    this.listeners.add(fn)
    fn(this.status())
    return () => { this.listeners.delete(fn) }
  }

  private emit(): void {
    const s = this.status()
    this.listeners.forEach((fn) => { try { fn(s) } catch { /* a bad listener is not the sync's problem */ } })
  }

  private set(phase: SyncPhase, detail = ''): void {
    this.phase = phase
    this.detail = detail
    this.emit()
  }

  /** Wire the reconnect and wake triggers. Safe to call more than once. */
  start(): void {
    if (this.started || typeof window === 'undefined') return
    this.started = true
    const wake = () => { if (readNum(DIRTY_KEY) !== null) this.run('wake') }
    window.addEventListener('online', () => { this.attempt = 0; this.set('saving', 'back online'); wake() })
    window.addEventListener('offline', () => this.set('offline', 'no connection'))
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake() })
    /* Anything left dirty by a previous run, including a quit while offline. */
    if (readNum(DIRTY_KEY) !== null) this.set('waiting', 'changes from last session not sent yet')
  }

  /** The store hands over the whole state. Latest supersedes: the blob is the
   *  unit of truth, so an older queued copy has no value once a newer one exists. */
  push(json: string): void {
    if (!this.enabled) return
    this.latest = json
    if (readNum(DIRTY_KEY) === null) writeNum(DIRTY_KEY, Date.now())
    this.run('push')
  }

  /** Try now. Called by push, by the retry timer, and by the reconnect triggers. */
  private run(_why: string): void {
    if (!this.enabled || this.inFlight) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.set('offline', 'no connection, changes are held on this device')
      this.schedule()
      return
    }
    if (!this.latest) {
      /* Dirty from a previous session: the store re-pushes on boot, so there is
         nothing to send until it does. */
      return
    }
    this.inFlight = true
    this.set('saving', '')
    const body = this.latest
    void this.save(body).then((res) => {
      this.inFlight = false
      if (res.ok) {
        this.attempt = 0
        /* Only clear the flag if nothing newer arrived while this was in flight. */
        if (this.latest === body) {
          writeNum(DIRTY_KEY, null)
          writeNum(LAST_KEY, Date.now())
          this.set('synced', '')
        } else {
          this.run('follow-up')
        }
        return
      }
      if (res.reason === 'signed-out') {
        /* Local-only by choice or by session expiry. Not an error to shout about,
           and not something a retry fixes. */
        writeNum(DIRTY_KEY, null)
        this.set('off', '')
        return
      }
      this.set(res.reason === 'offline' ? 'offline' : 'error', res.message ?? '')
      this.schedule()
    })
  }

  private schedule(): void {
    window.clearTimeout(this.timer)
    const wait = BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)]
    this.attempt += 1
    this.timer = window.setTimeout(() => this.run('retry'), wait)
  }

  /** Send now and wait for the answer. Used when the window is closing. */
  async flush(): Promise<void> {
    if (!this.enabled || !this.latest) return
    const res = await this.save(this.latest)
    if (res.ok) { writeNum(DIRTY_KEY, null); writeNum(LAST_KEY, Date.now()); this.set('synced', '') }
  }

  /** True when this device holds work the server has not acknowledged. */
  get dirty(): boolean { return readNum(DIRTY_KEY) !== null }
}

export const outbox = new Outbox()

/** Human-readable, factual, no reassurance. Used by the settings row. */
export function describe(s: SyncStatus): string {
  if (s.phase === 'off') return 'This device only'
  if (s.phase === 'saving') return 'Saving'
  if (s.phase === 'offline') return s.dirtySince ? 'Offline, changes held here' : 'Offline'
  if (s.phase === 'error') return 'Cannot reach the server, still trying'
  if (s.phase === 'waiting') return 'Changes not sent yet'
  if (s.lastSyncedAt) {
    const mins = Math.floor((Date.now() - s.lastSyncedAt) / 60000)
    if (mins < 1) return 'Synced just now'
    if (mins < 60) return `Synced ${mins} min ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `Synced ${hrs} h ago`
    return `Synced ${Math.floor(hrs / 24)} d ago`
  }
  return 'Synced'
}

/** Live sync state for anything that wants to show it. */
export function useSyncStatus(): SyncStatus {
  const [s, setS] = useState<SyncStatus>(() => outbox.status())
  useEffect(() => {
    const off = outbox.subscribe(setS)
    /* "Synced 4 min ago" has to keep counting even when nothing is happening. */
    const t = window.setInterval(() => setS(outbox.status()), 30000)
    return () => { off(); window.clearInterval(t) }
  }, [])
  return s
}
