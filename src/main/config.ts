// All configuration in one place. KLAIR_* wins; CLAIRE_* is read as a legacy fallback.
const env = process.env

function pick(name: string): string | undefined {
  const v = env[`KLAIR_${name}`] ?? env[`CLAIRE_${name}`]
  return v === undefined || v === '' ? undefined : v
}

function num(name: string, fallback: number): number {
  const v = Number(pick(name))
  return Number.isFinite(v) && v > 0 ? v : fallback
}

export const config = {
  openrouterKey: env.OPENROUTER_API_KEY ?? '',
  databaseUrl: env.DATABASE_URL ?? '',
  graphifyBin: env.GRAPHIFY_BIN || 'graphify',
  graphifyModel: env.GRAPHIFY_MODEL || 'anthropic/claude-haiku-5.5',
  fastModel: pick('FAST_MODEL') ?? 'anthropic/claude-haiku-5.5',
  answerModel: pick('ANSWER_MODEL') ?? 'anthropic/claude-sonnet-5.5',

  captureMs: num('CAPTURE_MS', 4000),
  dwellMs: num('DWELL_MS', 60_000),
  cooldownMs: num('COOLDOWN_MS', 120_000),
  dismissQuietMs: num('DISMISS_QUIET_MS', 10 * 60_000),
  quietMs: 30 * 60_000,
  retentionDays: num('RETENTION_DAYS', 14),
  indexDebounceMs: num('INDEX_DEBOUNCE_MS', 20_000),
  indexBatch: num('INDEX_BATCH', 5),
  retrievalBudget: num('RETRIEVAL_BUDGET', 1500),

  activeWindow: pick('ACTIVE_WINDOW') === 'applescript',
  /** Accelerators used until the native fn addon is available (or when fn is busy). */
  fallbackKeys: {
    toggle: pick('TOGGLE_KEY') ?? 'Control+Alt+K',
    pause: 'Control+Alt+P',
    quiet: 'Control+Alt+Q'
  }
}

export type Config = typeof config
