import { config } from './config'
import {
  pendingIndexCaptures,
  pendingIndexFiles,
  pendingIndexPages,
  setFileIndexStatus,
  setIndexStatus,
  setPageIndexStatus
} from './local'
import { graphifyError, indexSession } from './graphify'
import { notesDir, projectDir } from './paths'

// One Graphify graph per project, built from that project's notes folder. One extract
// per project at a time, debounced. Only committed captures with a written note, and
// Chrome pages and added files with a written file, are indexed. Failures are marked
// and retried on the next run, without duplicates (Graphify's extract is incremental).
// A rebuild (after old context was pruned, or from the Knowledge graph pane) re-extracts
// everything. Deleting a project aborts its running job and drops anything queued.

interface Job {
  timer: NodeJS.Timeout | null
  running: AbortController | null
  again: boolean
  force: boolean
  newNotes: number
  cancelled: boolean
  last: { at: string; ok: boolean; detail: string } | null
}

const jobs = new Map<number, Job>()
let lastResult: { at: string; ok: boolean; detail: string } | null = null

/** The latest build result across projects (for the health check). */
export function indexerStatus(): typeof lastResult {
  return lastResult
}

/** Whether a project's graph is being built, and how its last build went. */
export function projectIndexStatus(projectId: number): {
  building: boolean
  last: Job['last']
} {
  const j = jobs.get(projectId)
  return { building: !!j?.running, last: j?.last ?? null }
}

function job(projectId: number): Job {
  let j = jobs.get(projectId)
  if (!j) {
    j = {
      timer: null,
      running: null,
      again: false,
      force: false,
      newNotes: 0,
      cancelled: false,
      last: null
    }
    jobs.set(projectId, j)
  }
  return j
}

/**
 * Call after a note is written. Runs after the debounce or once a batch is ready;
 * `now` runs it at once, `force` re-extracts the whole project.
 */
export function scheduleIndex(
  projectId: number,
  opts: { now?: boolean; force?: boolean } = {}
): void {
  const j = job(projectId)
  if (j.cancelled) return
  j.newNotes += 1
  if (opts.force) j.force = true
  if (j.running) {
    j.again = true
    return
  }
  if (j.timer) clearTimeout(j.timer)
  const delay = opts.now || j.newNotes >= config.indexBatch ? 0 : config.indexDebounceMs
  j.timer = setTimeout(() => void runIndex(projectId), delay)
}

async function runIndex(projectId: number): Promise<void> {
  const j = job(projectId)
  j.timer = null
  if (j.cancelled) return
  let ids: number[] = []
  let pageIds: number[] = []
  let fileIds: number[] = []
  try {
    ids = await pendingIndexCaptures(projectId)
    pageIds = await pendingIndexPages(projectId)
    fileIds = await pendingIndexFiles(projectId)
  } catch {
    return
  }
  const force = j.force
  if (!force && ids.length === 0 && pageIds.length === 0 && fileIds.length === 0) return
  j.newNotes = 0
  j.force = false
  j.running = new AbortController()
  try {
    const out = await indexSession(notesDir(projectId), projectDir(projectId), j.running.signal, {
      force
    })
    if (j.cancelled) return
    await setIndexStatus(ids, 'indexed')
    await setPageIndexStatus(pageIds, 'indexed')
    await setFileIndexStatus(fileIds, 'indexed')
    j.last = lastResult = {
      at: new Date().toISOString(),
      ok: true,
      detail: out.split('\n').slice(-3).join(' ')
    }
  } catch (err) {
    if (j.cancelled) return
    await setIndexStatus(ids, 'failed').catch(() => undefined)
    await setPageIndexStatus(pageIds, 'failed').catch(() => undefined)
    await setFileIndexStatus(fileIds, 'failed').catch(() => undefined)
    j.last = lastResult = { at: new Date().toISOString(), ok: false, detail: graphifyError(err) }
    console.warn(`graphify extract failed (project ${projectId}):`, lastResult.detail)
  } finally {
    j.running = null
    if (j.again && !j.cancelled) {
      j.again = false
      j.timer = setTimeout(() => void runIndex(projectId), config.indexDebounceMs)
    }
  }
}

/** Cancel queued and running work so retries cannot recreate deleted context. */
export function cancelIndex(projectId: number): void {
  const j = job(projectId)
  j.cancelled = true
  if (j.timer) clearTimeout(j.timer)
  j.running?.abort()
  jobs.delete(projectId)
}
