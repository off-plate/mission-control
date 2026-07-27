import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'react-grid-layout/css/styles.css'
import './styles.css'
import App from './App'
import { StoreProvider, STORAGE_KEY } from './store'
import { PomodoroProvider } from './pomodoro'
import { SUPABASE_ENABLED, clearAuthFragment, currentAccount, loadRemoteState, onAccountChange } from './supabase'

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <StoreProvider>
        <PomodoroProvider>
          <App />
        </PomodoroProvider>
      </StoreProvider>
    </StrictMode>,
  )
}

/* A magic link lands with the session in the URL fragment. The client picks it up
   by itself, but not always before the first getSession call, so wait briefly for
   it rather than booting signed out and flashing the sign-in card. */
async function accountAfterLink(): Promise<Awaited<ReturnType<typeof currentAccount>>> {
  const me = await currentAccount()
  if (me || !/access_token=/.test(location.hash)) return me
  return new Promise((resolve) => {
    const off = onAccountChange((a) => { if (a) { off(); resolve(a) } })
    window.setTimeout(() => { off(); void currentAccount().then(resolve) }, 4000)
  })
}

/* Signed in, the saved row is the source of truth and is hydrated into localStorage
   before the store reads it. Signed out, or with sync not configured, the app runs
   on this device alone and nothing is read or written remotely.

   If there is no saved row yet, localStorage is left untouched (no data loss) and
   the store seeds the row on the first change.

   The remote row carries the schema it was written under. Bumping the local key
   alone did nothing: the old row was hydrated straight into the new key, so a clean
   slate came back full. A row from a different schema is ignored, the app seeds
   fresh, and the first change overwrites the row. */
async function boot() {
  if (SUPABASE_ENABLED) {
    try {
      const me = await accountAfterLink()
      clearAuthFragment()
      if (me) {
        const remote = await loadRemoteState()
        if (remote) {
          const schema = (JSON.parse(remote) as { schema?: string }).schema
          if (schema === STORAGE_KEY) localStorage.setItem(STORAGE_KEY, remote)
          else localStorage.removeItem(STORAGE_KEY)
        }
      }
    } catch { /* fall back to whatever is in localStorage */ }
  }
  render()
}

void boot()
