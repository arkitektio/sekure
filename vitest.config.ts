import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Standalone test config — intentionally separate from `electron.vite.config.ts`
// so we don't drag in the Electron main/preload build wiring. The `@` alias
// mirrors electron.vite.config.ts.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    globals: true,
    // Pure-logic suites run in `node`. Suites that touch the DOM opt into jsdom
    // per-file via a `// @vitest-environment jsdom` docblock.
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/renderer/src/**/*.{test,spec}.{ts,tsx}', 'src/main/**/*.{test,spec}.ts'],
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/main/vault/**/*.ts', 'src/main/google/**/*.ts', 'src/main/drive/**/*.ts']
    }
  }
})
