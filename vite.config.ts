import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'

/* The build's own identity, stamped in at build time and shown in Settings.
   Its whole job is to end an argument: when a fix is reported as "still not
   fixed", the first question is whether the browser is even running the build
   that contains it, and until now neither of us could answer that. Now the
   screen says so. */
const BUILD = (() => {
  try {
    const sha = execSync('git rev-parse --short HEAD').toString().trim()
    const when = new Date().toISOString().slice(0, 16).replace('T', ' ')
    return `${sha} ${when}`
  } catch {
    return 'dev'
  }
})()

// Demo build is served from off-plate.github.io/mission-control (GitHub Pages, /docs on main)
export default defineConfig({
  plugins: [react()],
  base: '/mission-control/',
  build: { outDir: 'docs' },
  define: { __BUILD__: JSON.stringify(BUILD) },
})
