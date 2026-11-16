import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

// Migrations are generated into ./drizzle and committed.
// `pnpm db:migrate` applies them to DATABASE_URL (from .env or the shell).
export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
