import { app } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'

// Local layout (screenshots never leave the Mac):
//   <userData>/sessions/<id>/shots/*.png     screenshots
//   <userData>/sessions/<id>/notes/*.md      notes Graphify indexes
//   <userData>/sessions/<id>/graphify-out/   Graphify's graph
export function sessionDir(sessionId: number): string {
  return join(app.getPath('userData'), 'sessions', String(sessionId))
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
