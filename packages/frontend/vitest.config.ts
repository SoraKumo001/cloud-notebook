import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    exclude: ['e2e/**', 'node_modules/**'],
    // Prevent global state (fetch, localStorage) leakage between files
    isolate: true,
    // Force sequential file execution (vitest 4 syntax)
    fileParallelism: false,
    setupFiles: ['./src/test-setup.ts'],
  },
})
