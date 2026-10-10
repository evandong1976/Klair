import { existsSync } from 'fs'
import { readFile, readdir } from 'fs/promises'
import { join } from 'path'
import type { Provenance } from '../shared/types'
import { config } from './config'
import { searchNotes } from './db'
import { queryContext } from './graphify'
import { baselineMode } from './metrics'
import { graphPath, notesDir } from './paths'

// One entry point for "relevant history": Graphify graph context plus TigerData
// keyword search over notes (this and earlier sessions), deduped, labelled with
// provenance and trimmed to a budget. If Graphify fails or hasn't indexed yet,
// TigerData search alone still supplies earlier context.

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
  let searchOk = false

  const [graph, hits] = await Promise.allSettled([
    queryContext(graphPath(opts.sessionId), question, Math.round(config.retrievalBudget * 0.6)),
    searchNotes(question, { excludeCaptureId: opts.excludeCaptureId, limit: 6 })
  ])

  if (graph.status === 'fulfilled' && graph.value) {
    graphOk = true
    parts.push(
      `## Graph context (Graphify)\n${graph.value.slice(0, Math.round(budgetChars * 0.6))}`
    )
  }

  if (hits.status === 'fulfilled') {
    searchOk = true
    const seen = new Set<string>()
    const lines: string[] = []
    for (const h of hits.value) {
      const key = h.body.slice(0, 120)
      if (seen.has(key)) continue
      seen.add(key)
      const earlier = h.sessionId !== opts.sessionId
      const label =
        h.provenance === 'assistant'
          ? `Klair's earlier answer · ${timeLabel(h.createdAt)}`
          : `${earlier ? 'Earlier session' : 'Earlier tab'} · ${timeLabel(h.createdAt)}`
      sources.push({
        kind: h.provenance === 'assistant' ? 'assistant' : 'earlier',
        label,
        captureId: h.captureId ?? undefined
      })
      lines.push(
        `### ${label}${h.provenance === 'assistant' ? ' (generated earlier, not observed)' : ''}\n${h.body.slice(0, 900)}`
      )
    }
    if (lines.length) parts.push(`## Related notes (TigerData search)\n${lines.join('\n\n')}`)
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
