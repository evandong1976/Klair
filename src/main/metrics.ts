import { appendFile } from 'fs/promises'
import { metricsFile } from './paths'

// Token accounting for the brief's measurement requirement. One JSON line per model
// call: compare runs with KLAIR_BASELINE=full (whole session as context) against the
// default (Graphify + TigerData retrieval). Indexing cost: use GRAPHIFY_OPENROUTER_KEY
// so OpenRouter reports Graphify's usage separately.
export interface MetricLine {
  kind: 'note' | 'suggest' | 'answer' | 'health'
  mode: 'retrieval' | 'baseline'
  inputTokens?: number
  outputTokens?: number
  contextChars?: number
  ms: number
  sessionId?: number | null
}

export function recordMetric(m: MetricLine): void {
  appendFile(metricsFile(), JSON.stringify({ at: new Date().toISOString(), ...m }) + '\n').catch(
    () => undefined
  )
}

export const baselineMode = process.env.KLAIR_BASELINE === 'full'
