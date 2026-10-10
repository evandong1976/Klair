import { app } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'

// Local layout (screenshots never leave the Mac). <id> is the session's id in the
// local SQLite store (local.ts); the "local-" prefix keeps these apart from folders
// older builds named after TigerData ids.
//   <userData>/sessions/local-<id>/shots/*.png     screenshots
//   <userData>/sessions/local-<id>/notes/*.md      notes Graphify indexes
//   <userData>/sessions/local-<id>/graphify-out/   Graphify's graph
export const SESSION_DIR_PREFIX = 'local-'

export function sessionsRoot(): string {
  return join(app.getPath('userData'), 'sessions')
}

export function sessionDir(sessionId: number): string {
  return join(sessionsRoot(), `${SESSION_DIR_PREFIX}${sessionId}`)
}

export function shotsDir(sessionId: number): string {
  const d = join(sessionDir(sessionId), 'shots')
  mkdirSync(d, { recursive: true })
  return d
}

export function notesDir(sessionId: number): string {
  const d = join(sessionDir(sessionId), 'notes')
  mkdirSync(d, { recursive: true })
  return d
}

export function graphPath(sessionId: number): string {
  return join(sessionDir(sessionId), 'graphify-out', 'graph.json')
}

export function metricsFile(): string {
  return join(app.getPath('userData'), 'metrics.jsonl')
}
