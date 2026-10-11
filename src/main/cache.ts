import { app } from 'electron'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'

// Local SQLite cache, e.g. screenshot hash -> vision note, so an unchanged
// screen never costs a second model call. Not canonical; safe to delete any time.
let sqlite: DatabaseSync | null = null
let getStmt: ReturnType<DatabaseSync['prepare']> | null = null
let setStmt: ReturnType<DatabaseSync['prepare']> | null = null
let delStmt: ReturnType<DatabaseSync['prepare']> | null = null

function open(): boolean {
  if (sqlite) return true
  try {
    sqlite = new DatabaseSync(join(app.getPath('userData'), 'cache.db'))
    sqlite.exec('create table if not exists cache (key text primary key, value text not null)')
    getStmt = sqlite.prepare('select value from cache where key = ?')
    setStmt = sqlite.prepare('insert or replace into cache (key, value) values (?, ?)')
    delStmt = sqlite.prepare('delete from cache where key = ?')
    return true
  } catch (err) {
    console.warn('cache unavailable:', (err as Error).message)
    return false
  }
}

export const cache = {
  ok: (): boolean => open(),
  get: (key: string): string | undefined =>
    open()
      ? ((getStmt?.get(key) as { value?: string } | undefined)?.value ?? undefined)
      : undefined,
  set: (key: string, value: string): void => {
    if (open()) setStmt?.run(key, value)
  },
  delete: (key: string): void => {
    if (open()) delStmt?.run(key)
  },
  /** Delete every key matching a SQL LIKE pattern, e.g. "note:%:<hash>". */
  deleteMatching: (pattern: string): void => {
    if (open()) sqlite?.prepare('delete from cache where key like ?').run(pattern)
  }
}
