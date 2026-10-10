import { generateText } from 'ai'
import { systemPreferences } from 'electron'
import type { HealthCheck, HealthReport } from '../shared/types'
import { fastModel } from './ai'
import { cache } from './cache'
import { config } from './config'
import { capabilities, getPool, migrate, ping, timescaleVersion } from './db'
import { retryFnKey } from './fnkey'
import { graphifyAvailable } from './graphify'
import { recordMetric } from './metrics'

// Checks every connection Klair depends on. Shown on the Start window; failures
// drive the States cards (see controller.ts).

// 8×8 PNG (pale pink square) used to confirm the model accepts images.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGN411yBFTEMLQkA4gl6Qb675DkAAAAASUVORK5CYII=',
  'base64'
)

let last: HealthReport | null = null
let migrated = false

export function lastHealth(): HealthReport | null {
  return last
}

export function healthOk(id: HealthCheck['id']): boolean {
  return last?.checks.find((c) => c.id === id)?.status === 'ok'
}

async function checkOpenRouter(): Promise<HealthCheck> {
  const base = { id: 'openrouter' as const, label: 'AI models via OpenRouter' }
  if (!config.openrouterKey) {
    return {
      ...base,
      status: 'fail',
      detail: 'OPENROUTER_API_KEY is not set in .env.local or .env'
    }
  }
  const t = Date.now()
  try {
    const res = await generateText({
      model: fastModel,
      maxOutputTokens: 5,
      abortSignal: AbortSignal.timeout(20_000),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Reply with the single word OK.' },
            { type: 'image', image: TINY_PNG, mediaType: 'image/png' }
          ]
        }
      ]
    })
    const ms = Date.now() - t
    recordMetric({
      kind: 'health',
      mode: 'retrieval',
      ms,
      inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens
    })
    return { ...base, status: 'ok', detail: `${config.fastModel} accepts images · ${ms} ms` }
  } catch (err) {
    return {
      ...base,
      status: 'fail',
      detail: `${config.fastModel}: ${(err as Error).message.slice(0, 160)}`
    }
  }
}

async function checkTigerData(): Promise<HealthCheck> {
  const base = { id: 'tigerdata' as const, label: 'TigerData database' }
  if (!getPool()) {
    return { ...base, status: 'fail', detail: 'DATABASE_URL is not set: sessions cannot be saved' }
  }
  try {
    const ms = await ping()
    if (!migrated) {
      await migrate()
      migrated = true
    }
    const ts = await timescaleVersion()
    const parts = [
      `${ms} ms`,
      ts ? `TimescaleDB ${ts}` : 'no TimescaleDB',
      capabilities.continuousAggregate ? 'insights aggregate on' : 'insights from raw rows',
      capabilities.textsearch === 'bm25' ? 'BM25 search' : 'full-text search'
    ]
    return { ...base, status: ts ? 'ok' : 'warn', detail: parts.join(' · ') }
  } catch (err) {
    return { ...base, status: 'fail', detail: (err as Error).message.slice(0, 160) }
  }
}

function checkScreen(): HealthCheck {
  const base = { id: 'screen' as const, label: 'Screen recording' }
  if (process.platform !== 'darwin') return { ...base, status: 'ok', detail: 'Not required here' }
  const s = systemPreferences.getMediaAccessStatus('screen')
  return s === 'granted'
    ? { ...base, status: 'ok', detail: 'Allowed' }
    : { ...base, status: 'fail', detail: 'Needed before Klair can see anything' }
}

function checkFn(): HealthCheck {
  // Retries the tap, so a grant made while Klair is open is picked up by "Check again".
  const s = retryFnKey()
  return {
    id: 'fnkey',
    label: 'The fn key',
    status: s.running ? 'ok' : 'warn',
    detail: s.detail
  }
}

let inflight: Promise<HealthReport> | null = null

/** Run every check. Concurrent callers share one run (avoids racing migrations). */
export function runHealth(opts: { skipModel?: boolean } = {}): Promise<HealthReport> {
  inflight ??= doRunHealth(opts).finally(() => {
    inflight = null
  })
  return inflight
}

async function doRunHealth(opts: { skipModel?: boolean }): Promise<HealthReport> {
  const [openrouter, tiger, graphify] = await Promise.all([
    opts.skipModel && last
      ? Promise.resolve(last.checks.find((c) => c.id === 'openrouter') as HealthCheck)
      : checkOpenRouter(),
    checkTigerData(),
    graphifyAvailable()
  ])
  const checks: HealthCheck[] = [
    checkScreen(),
    checkFn(),
    tiger,
    openrouter,
    {
      id: 'graphify',
      label: 'Graphify',
      status: graphify.ok ? 'ok' : 'warn',
      detail: graphify.ok
        ? graphify.detail
        : `${graphify.detail} Answers will use on-screen context only.`
    },
    {
      id: 'cache',
      label: 'Local cache',
      status: cache.ok() ? 'ok' : 'warn',
      detail: cache.ok() ? 'node:sqlite ready' : 'Unavailable; continuing uncached'
    }
  ]
  last = { at: new Date().toISOString(), checks, capabilities: { ...capabilities } }
  return last
}
