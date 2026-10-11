import { existsSync } from 'fs'
import { readFile, stat } from 'fs/promises'
import type { ProjectGraph } from '../shared/types'
import { exportHtml } from './graphify'
import { projectIndexStatus, scheduleIndex } from './indexer'
import * as store from './local'
import { graphHtmlPath, graphPath } from './paths'

// The Knowledge graph pane's view of a project's Graphify graph: how big it is, when
// it was built, whether a build is running, and its graph.html (Graphify's own
// interactive view, exported next to graph.json after each build).

export async function projectGraph(projectId: number): Promise<ProjectGraph | null> {
  const p = await store.getProject(projectId)
  if (!p) return null
  const index = projectIndexStatus(projectId)
  const json = graphPath(projectId)
  let nodes: number | null = null
  let edges: number | null = null
  let communities: number | null = null
  let builtAt: string | null = null
  if (existsSync(json)) {
    try {
      const g = JSON.parse(await readFile(json, 'utf8')) as {
        nodes?: { community?: unknown }[]
        links?: unknown[]
        edges?: unknown[]
      }
      nodes = g.nodes?.length ?? 0
      edges = (g.links ?? g.edges ?? []).length
      communities = new Set((g.nodes ?? []).map((n) => n.community)).size
      builtAt = (await stat(json)).mtime.toISOString()
      // Graphs built before graph.html was exported get one now.
      if (!existsSync(graphHtmlPath(projectId))) await exportHtml(json).catch(() => undefined)
    } catch {
      /* a graph being written right now; the pane asks again shortly */
    }
  }
  const failed = index.last?.ok === false
  return {
    projectId,
    name: p.name,
    notes: p.notes,
    status: index.building
      ? 'building'
      : existsSync(graphHtmlPath(projectId))
        ? 'ready'
        : failed
          ? 'failed'
          : 'none',
    nodes,
    edges,
    communities,
    builtAt,
    detail: failed ? (index.last?.detail ?? null) : null
  }
}

/** Build the project's graph now, from all of its notes. */
export function rebuildGraph(projectId: number): void {
  scheduleIndex(projectId, { now: true, force: true })
}
