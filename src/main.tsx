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
   the first change. When Supabase is not configured this is a no-op. */
async function boot() {
  if (SUPABASE_ENABLED) {
    try {
      const remote = await loadRemoteState()
      if (remote) localStorage.setItem(STORAGE_KEY, remote)
    } catch { /* fall back to whatever is in localStorage */ }
  }
  render()
}

void boot()
