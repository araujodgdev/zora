import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts on purpose: tests run in Node. Database tests
// get an in-memory D1 database from test/db.ts (workerd through Wrangler).
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Each database test file starts its own workerd process: give that time.
    hookTimeout: 30_000,
  },
})
