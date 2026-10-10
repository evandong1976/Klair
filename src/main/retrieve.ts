import { existsSync } from 'fs'
import { readFile, readdir } from 'fs/promises'
import { join } from 'path'
import type { Provenance } from '../shared/types'
import { config } from './config'
import * as db from './db'
import * as store from './local'
import { queryContext } from './graphify'
import { baselineMode } from './metrics'
import { graphPath, notesDir } from './paths'

// One entry point for "relevant history": Graphify graph context plus keyword search
// over notes, deduped, labelled with provenance and trimmed to a budget. Notes from
// the running session (and any not yet uploaded) are searched in the local SQLite
// store; earlier, uploaded sessions are searched in TigerData. Any one source
// failing still leaves the others.

export interface Retrieved {
  text: string
  sources: Provenance[]
  graphOk: boolean
  searchOk: boolean
  historyUnavailable: boolean
  chars: number
}

const CHARS_PER_TOKEN = 4

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export async function retrieve(
  question: string,
  opts: { sessionId: number; excludeCaptureId: number | null }
): Promise<Retrieved> {
  if (baselineMode) return fullSessionBaseline(opts.sessionId)
  const budgetChars = config.retrievalBudget * CHARS_PER_TOKEN
  const parts: string[] = []
  const sources: Provenance[] = []
  let graphOk = false

  const [graph, localHits, remoteHits] = await Promise.allSettled([
    queryContext(graphPath(opts.sessionId), question, Math.round(config.retrievalBudget * 0.6)),
    store.searchNotes(question, {
      sessionId: opts.sessionId,
      excludeCaptureId: opts.excludeCaptureId,
      limit: 6
    }),
    db.getPool() ? db.searchNotes(question, { limit: 4 }) : Promise.resolve([])
  ])
  const hits = [localHits, remoteHits].flatMap((h) => (h.status === 'fulfilled' ? h.value : []))
  const searchOk = localHits.status === 'fulfilled' || remoteHits.status === 'fulfilled'

  if (graph.status === 'fulfilled' && graph.value) {
    graphOk = true
    parts.push(
      `## Graph context (Graphify)\n${graph.value.slice(0, Math.round(budgetChars * 0.6))}`
    )
  }

  if (hits.length) {
    const seen = new Set<string>()
    const lines: string[] = []
    for (const h of hits) {
      const key = h.body.slice(0, 120)
      if (seen.has(key)) continue
      seen.add(key)
      const earlier = h.origin === 'remote' || h.sessionId !== opts.sessionId
      const label =
        h.provenance === 'assistant'
          ? `Klair's earlier answer · ${timeLabel(h.createdAt)}`
          : `${earlier ? 'Earlier session' : 'Earlier tab'} · ${timeLabel(h.createdAt)}`
      sources.push({
        kind: h.provenance === 'assistant' ? 'assistant' : 'earlier',
        label,
        // Only local capture ids can open a screenshot on this Mac.
        captureId: h.origin === 'local' ? (h.captureId ?? undefined) : undefined
      })
      lines.push(
        `### ${label}${h.provenance === 'assistant' ? ' (generated earlier, not observed)' : ''}\n${h.body.slice(0, 900)}`
      )
    }
    if (lines.length) parts.push(`## Related notes (session search)\n${lines.join('\n\n')}`)
  }

  let text = parts.join('\n\n')
  if (text.length > budgetChars) text = text.slice(0, budgetChars)
  return {
    text,
    sources: sources.slice(0, 3),
    graphOk,
    searchOk,
    historyUnavailable: !graphOk && !searchOk,
    chars: text.length
  }
}

/** KLAIR_BASELINE=full: every note in the session, for token comparisons. */
async function fullSessionBaseline(sessionId: number): Promise<Retrieved> {
  const dir = notesDir(sessionId)
  let text = ''
  if (existsSync(dir)) {
    const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort()
    for (const f of files) text += (await readFile(join(dir, f), 'utf8')) + '\n\n'
  }
  return {
    text,
    sources: [],
    graphOk: false,
    searchOk: false,
    historyUnavailable: text.length === 0,
    chars: text.length
  }
}
