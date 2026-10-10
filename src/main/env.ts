// Imported first so env files are loaded before any module reads process.env.
// Order: real environment > .env.local > .env (earlier sources win).
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { parseEnv } from 'util'

for (const name of ['.env.local', '.env']) {
  const file = join(process.cwd(), name)
  if (!existsSync(file)) continue
  try {
    const parsed = parseEnv(readFileSync(file, 'utf8'))
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined && value !== undefined) process.env[key] = value
    }
  } catch (err) {
    console.warn(`could not read ${name}:`, err)
  }
}
