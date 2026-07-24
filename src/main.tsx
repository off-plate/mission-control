import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'react-grid-layout/css/styles.css'
import './styles.css'
import App from './App'
import { StoreProvider } from './store'
import { PomodoroProvider } from './pomodoro'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <PomodoroProvider>
        <App />
      </PomodoroProvider>
    </StoreProvider>
  </StrictMode>,
)
