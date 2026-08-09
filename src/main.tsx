import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'react-grid-layout/css/styles.css'
import './styles.css'
import App from './App'
import { StoreProvider, STORAGE_KEY } from './store'
import { PomodoroProvider } from './pomodoro'
import { MundiOpusProvider } from './mundiplayer'
import { SUPABASE_ENABLED, clearAuthFragment, currentAccount, loadRemoteState, onAccountChange } from './supabase'
import { mergeStates } from './sync-merge'
import { LOCAL_ONLY_KEY, SignIn } from './signin'

// One root for the container's lifetime: choosing "this device only" swaps the
// sign-in screen for the app, and a second createRoot on the same node warns.
let _root: ReturnType<typeof createRoot> | null = null
const root = () => (_root ??= createRoot(document.getElementById('root')!))

function render() {
  root().render(
    <StrictMode>
      <StoreProvider>
        <MundiOpusProvider>
          <PomodoroProvider>
            <App />
          </PomodoroProvider>
        </MundiOpusProvider>
      </StoreProvider>
    </StrictMode>,
  )
}

/* Signed out on a device that has not opted out, the sign-in screen comes first.
   Choosing "this device only" is remembered, so the choice is asked once rather
   than every time the app opens. */
function renderSignIn() {
  root().render(
    <StrictMode>
      <SignIn onLocalOnly={() => { try { localStorage.setItem(LOCAL_ONLY_KEY, '1') } catch { /* noop */ } render() }} />
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
          if (schema === STORAGE_KEY) {
            /* Merged, never pasted over: this device may hold work the remote
               row does not, when a staler device saved after it. Hydrating the
               remote blob wholesale is how two evenings were lost. */
            const local = localStorage.getItem(STORAGE_KEY)
            localStorage.setItem(STORAGE_KEY, local ? mergeStates(local, remote) : remote)
          } else localStorage.removeItem(STORAGE_KEY)
        }
      } else if (localStorage.getItem(LOCAL_ONLY_KEY) !== '1') {
        renderSignIn()
        return
      }
    } catch { /* fall back to whatever is in localStorage */ }
  }
  render()
}

void boot()
