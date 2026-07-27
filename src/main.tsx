import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'react-grid-layout/css/styles.css'
import './styles.css'
import App from './App'
import { StoreProvider, STORAGE_KEY } from './store'
import { PomodoroProvider } from './pomodoro'
import { SUPABASE_ENABLED, loadRemoteState } from './supabase'

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

/* When Supabase is configured, hydrate localStorage from the saved state before the
   store reads it, so the database is the source of truth. If there is no saved row
   yet, we leave localStorage untouched (no data loss) and the store seeds the row on
   the first change. When Supabase is not configured this is a no-op.

   The remote row carries the schema it was written under. Bumping the local key
   alone did nothing: the old row was hydrated straight into the new key, so a
   clean slate came back full. A row from a different schema is ignored, the app
   seeds fresh, and the first change overwrites the row. */
async function boot() {
  if (SUPABASE_ENABLED) {
    try {
      const remote = await loadRemoteState()
      if (remote) {
        const schema = (JSON.parse(remote) as { schema?: string }).schema
        if (schema === STORAGE_KEY) localStorage.setItem(STORAGE_KEY, remote)
        else localStorage.removeItem(STORAGE_KEY)
      }
    } catch { /* fall back to whatever is in localStorage */ }
  }
  render()
}

void boot()
