// Creates .env from .env.example and fills BETTER_AUTH_SECRET with a random value.
// Never overwrites an existing .env.
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

if (existsSync('.env')) {
  console.log('.env already exists; leaving it unchanged.')
  process.exit(0)
}

const secret = randomBytes(32).toString('base64')
const contents = readFileSync('.env.example', 'utf8').replace(
  /^BETTER_AUTH_SECRET=.*$/m,
  `BETTER_AUTH_SECRET=${secret}`,
)
writeFileSync('.env', contents)
console.log('Created .env with a generated BETTER_AUTH_SECRET.')
