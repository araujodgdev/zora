import { defineConfig } from 'drizzle-kit'

// Migrations are generated into ./drizzle and committed. drizzle-kit only
// generates them; wrangler applies them to D1 (`pnpm db:migrate`, see
// wrangler.jsonc), so no database credentials are needed here.
export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
})
