// Imported first so env files are loaded before any module reads process.env.
// Order: real environment > .env.local > .env (earlier sources win),
// looking in the working directory first, then the app's data folder.
import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { parseEnv } from 'util'

// A packaged Klair.app starts with cwd "/", so it also reads <userData>/.env.
const dirs = [process.cwd(), app.getPath('userData')]
for (const file of dirs.flatMap((d) => ['.env.local', '.env'].map((n) => join(d, n)))) {
  if (!existsSync(file)) continue
  try {
    const parsed = parseEnv(readFileSync(file, 'utf8'))
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined && value !== undefined) process.env[key] = value
    }
  } catch (err) {
    console.warn(`could not read ${file}:`, err)
  }
}
