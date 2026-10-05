import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Builds straight into ../dist, which the Node server serves. During `npm run dev`
// the API is proxied to the live service so dev and prod behave identically.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:8099',
      // The server's own pages, so signing in works from the dev server too.
      '/login': 'http://localhost:8099',
      '/logout': 'http://localhost:8099',
      '/setup': 'http://localhost:8099',
      '/settings': 'http://localhost:8099',
    },
  },
})
