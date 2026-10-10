import { app } from 'electron'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'

// Local SQLite cache, e.g. screenshot hash -> vision note, so an unchanged
// screen never costs a second model call. Safe to delete at any time.
const sqlite = new DatabaseSync(join(app.getPath('userData'), 'cache.db'))
sqlite.exec('create table if not exists cache (key text primary key, value text not null)')

const getStmt = sqlite.prepare('select value from cache where key = ?')
const setStmt = sqlite.prepare('insert or replace into cache (key, value) values (?, ?)')

export const cache = {
  get: (key: string): string | undefined => getStmt.get(key)?.value as string | undefined,
  set: (key: string, value: string): void => void setStmt.run(key, value)
}
