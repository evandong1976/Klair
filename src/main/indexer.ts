import { config } from './config'
import { pendingIndexCaptures, setIndexStatus } from './db'
import { indexSession } from './graphify'
import { notesDir, sessionDir } from './paths'

// One Graphify extract per session at a time, debounced. Only committed captures
// with a written note are indexed. Failures are marked and retried on the next run,
// without duplicates (Graphify's extract is incremental). Deleting a session aborts
// its running job and drops anything queued.

interface Job {
  timer: NodeJS.Timeout | null
  running: AbortController | null
  again: boolean
  newNotes: number
  cancelled: boolean
}

const jobs = new Map<number, Job>()
let lastResult: { at: string; ok: boolean; detail: string } | null = null

export function indexerStatus(): typeof lastResult {
  return lastResult
}

function job(sessionId: number): Job {
  let j = jobs.get(sessionId)
  if (!j) {
    j = { timer: null, running: null, again: false, newNotes: 0, cancelled: false }
    jobs.set(sessionId, j)
  }
  return j
}

/** Call after a note is written. Runs after the debounce or once a batch is ready. */
export function scheduleIndex(sessionId: number, opts: { now?: boolean } = {}): void {
  const j = job(sessionId)
  if (j.cancelled) return
  j.newNotes += 1
  if (j.running) {
    j.again = true
    return
  }
  if (j.timer) clearTimeout(j.timer)
  const delay = opts.now || j.newNotes >= config.indexBatch ? 0 : config.indexDebounceMs
  j.timer = setTimeout(() => void runIndex(sessionId), delay)
}

async function runIndex(sessionId: number): Promise<void> {
  const j = job(sessionId)
  j.timer = null
  if (j.cancelled) return
  let ids: number[] = []
  try {
    ids = await pendingIndexCaptures(sessionId)
  } catch {
    return
  }
  if (ids.length === 0) return
  j.newNotes = 0
  j.running = new AbortController()
  try {
    const out = await indexSession(notesDir(sessionId), sessionDir(sessionId), j.running.signal)
    if (j.cancelled) return
    await setIndexStatus(ids, 'indexed')
    lastResult = {
      at: new Date().toISOString(),
      ok: true,
      detail: out.split('\n').slice(-3).join(' ')
    }
  } catch (err) {
    if (j.cancelled) return
    await setIndexStatus(ids, 'failed').catch(() => undefined)
    lastResult = {
      at: new Date().toISOString(),
      ok: false,
      detail: (err as Error).message.slice(0, 200)
    }
    console.warn('graphify extract failed:', lastResult.detail)
  } finally {
    j.running = null
    if (j.again && !j.cancelled) {
      j.again = false
      j.timer = setTimeout(() => void runIndex(sessionId), config.indexDebounceMs)
    }
  }
}

/** Cancel queued and running work so retries cannot recreate deleted context. */
export function cancelIndex(sessionId: number): void {
  const j = job(sessionId)
  j.cancelled = true
  if (j.timer) clearTimeout(j.timer)
  j.running?.abort()
  jobs.delete(sessionId)
}
