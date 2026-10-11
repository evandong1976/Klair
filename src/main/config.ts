import { DEFAULT_BRIDGE_PORT, KLAIR_EXTENSION_ID } from './bridge'

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
  graphifyModel: env.GRAPHIFY_MODEL || 'anthropic/claude-haiku-5.5',
  // Picked for speed from a benchmark on real Klair prompts (2026-10-10, via OpenRouter):
  //   screen note: Gemini 3.5 Flash-Lite ~2.5 s, GPT-5.4 mini ~4.0 s, Claude Haiku 5.5 ~5.2 s
  //   answer:      GPT-5.4 mini ~1.6 s (first word ~0.6 s), Claude Haiku 5.5 ~2.7 s
  // Any OpenRouter model that accepts images works; override with the env vars.
  fastModel: pick('FAST_MODEL') ?? 'google/gemini-3.5-flash-lite',
  answerModel: pick('ANSWER_MODEL') ?? 'openai/gpt-5.4-mini',

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
  /** Offer files that finish downloading during a session (KLAIR_WATCH_DOWNLOADS=off to stop). */
  watchDownloads: pick('WATCH_DOWNLOADS') !== 'off',
  /** Folder to watch; defaults to the user's Downloads folder. */
  downloadsDir: pick('DOWNLOADS_DIR') ?? null,
  /** Local port the Chrome extension sends pages to (extension/background.js uses the same). */
  bridgePort: num('BRIDGE_PORT', DEFAULT_BRIDGE_PORT),
  /** Only this extension may send pages; the default is pinned by extension/manifest.json. */
  extensionId: pick('EXTENSION_ID') ?? KLAIR_EXTENSION_ID,
  /** Accelerators used until the native fn addon is available (or when fn is busy). */
  fallbackKeys: {
    toggle: pick('TOGGLE_KEY') ?? 'Control+Alt+K',
    pause: 'Control+Alt+P',
    quiet: 'Control+Alt+Q'
  }
}

export type Config = typeof config
