import { app } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'

// Local layout, one folder per project (screenshots and added files never leave the
// Mac). <id> is the project's id in the local SQLite store (local.ts).
//   <userData>/projects/local-<id>/shots/*.png           screenshots
//   <userData>/projects/local-<id>/files/                files added from Downloads
//   <userData>/projects/local-<id>/notes/*.md            notes Graphify indexes
//   <userData>/projects/local-<id>/graphify-out/         the project's graph (graph.json, graph.html)
export const PROJECT_DIR_PREFIX = 'local-'

export function projectsRoot(): string {
  return join(app.getPath('userData'), 'projects')
}

export function projectDir(projectId: number): string {
  return join(projectsRoot(), `${PROJECT_DIR_PREFIX}${projectId}`)
}

function sub(projectId: number, name: string): string {
  const d = join(projectDir(projectId), name)
  mkdirSync(d, { recursive: true })
  return d
}

export const shotsDir = (projectId: number): string => sub(projectId, 'shots')
export const notesDir = (projectId: number): string => sub(projectId, 'notes')
/** Copies of files the user added from Downloads. */
export const filesDir = (projectId: number): string => sub(projectId, 'files')

export function graphDir(projectId: number): string {
  return join(projectDir(projectId), 'graphify-out')
}

export function graphPath(projectId: number): string {
  return join(graphDir(projectId), 'graph.json')
}

/** Graphify's interactive view of the project's graph (graphify export html). */
export function graphHtmlPath(projectId: number): string {
  return join(graphDir(projectId), 'graph.html')
}

export function metricsFile(): string {
  return join(app.getPath('userData'), 'metrics.jsonl')
}
