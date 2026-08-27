import { defineConfig } from 'vitest/config'
import path from 'path'

// Vitest config for web/ unit + integration tests. The `@` alias mirrors the
// Next.js / tsconfig path alias so route handlers import the same way under test.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  // .tsx under test (e.g. the free-list TeaserTable rendered via
  // react-dom/server) needs the automatic JSX runtime, matching Next's compile.
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['app/api/**/*.ts', 'lib/**/*.ts'],
    },
  },
})
