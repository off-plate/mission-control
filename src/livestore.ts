/* THE SUBSCRIBE/PUBLISH/SNAPSHOT PLUMBING every module-level "one shared
   read, not one per caller" store in this app was hand-copying: calendar.ts,
   compass.ts, and billspage.tsx's two stores (account + bills data) each
   wrote their own `let view`, `const listeners = new Set()`, a `publish()`
   that mutates the view and notifies every listener, and a `subscribe()`
   that adds/removes a listener and runs a callback on the first subscriber
   in and the last one out. useSyncExternalStore itself is React's; this is
   just the three functions it needs, in one place instead of four.

   Deliberately thin. What is NOT here, on purpose, because it differs
   between every real store: what "stale" means, whether to poll on a timer,
   whether to cache to localStorage, whether a read is keyed by an outside
   value like which account is signed in. Each store still owns that policy
   -- this only ever holds the current value and says when it changed. */

export interface LiveStore<T> {
  /** The current value, read outside of React (a refresh() deciding whether
   *  it already has a fresh-enough answer, an assistant action reading past
   *  a stale render -- see billspage.tsx's ensure()). */
  getSnapshot: () => T
  /** Set a new value and notify every current listener. */
  publish: (next: T) => void
  /** useSyncExternalStore's own subscribe function. onFirstSubscriber runs
   *  once when the listener count goes 0 -> 1 (the moment to kick off a
   *  fetch, start a timer, or attach an outside event listener);
   *  onLastUnsubscribe runs once when it goes back to 0 (the moment to tear
   *  any of that down). Neither is called for the second, third, ...
   *  subscriber -- that is the whole point of sharing one store. */
  subscribe: (f: () => void) => () => void
}

export function createLiveStore<T>(
  initial: T,
  opts?: { onFirstSubscriber?: () => void; onLastUnsubscribe?: () => void },
): LiveStore<T> {
  let view = initial
  const listeners = new Set<() => void>()

  const getSnapshot = (): T => view

  const publish = (next: T): void => {
    view = next
    for (const f of [...listeners]) f()
  }

  const subscribe = (f: () => void): (() => void) => {
    listeners.add(f)
    if (listeners.size === 1) opts?.onFirstSubscriber?.()
    return () => {
      listeners.delete(f)
      if (listeners.size === 0) opts?.onLastUnsubscribe?.()
    }
  }

  return { getSnapshot, publish, subscribe }
}
