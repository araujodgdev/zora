import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts on purpose: tests run in Node against the
// local Docker Postgres (TEST_DATABASE_URL), without the Workers runtime.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Database tests share one database; run files one at a time.
    fileParallelism: false,
  },
})
