import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Demo build is served from off-plate.github.io/mission-control (GitHub Pages, /docs on main)
export default defineConfig({
  plugins: [react()],
  base: '/mission-control/',
  build: { outDir: 'docs' },
})
