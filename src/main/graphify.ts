import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { promisify } from 'util'
import { config } from './config'

const run = promisify(execFile)

// Graphify CLI (`uv tool install graphifyy`). GUI-launched apps don't inherit the
// shell PATH, so GRAPHIFY_BIN may be an absolute path.
//
// Verified with `graphify --help`:
//   extract <dir> --backend openai --out <dir>  → <out>/graphify-out/graph.json (incremental by default)
//   query "<q>" --budget N --graph <path>       → local BFS, no LLM
//   benchmark <graph.json>                      → token reduction vs full corpus

/** Index a session's notes folder. Makes LLM calls through OpenRouter's OpenAI-compatible endpoint. */
export async function indexSession(
  notesDir: string,
  outDir: string,
  signal?: AbortSignal
): Promise<string> {
  const { stdout, stderr } = await run(
    config.graphifyBin,
    ['extract', notesDir, '--backend', 'openai', '--out', outDir, '--no-gitignore'],
    {
      timeout: 600_000,
      signal,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...process.env,
        OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
        // A separate key (GRAPHIFY_OPENROUTER_KEY) lets indexing cost be read on its own in OpenRouter.
        OPENAI_API_KEY: process.env.GRAPHIFY_OPENROUTER_KEY || config.openrouterKey,
        OPENAI_MODEL: config.graphifyModel
      }
    }
  )
  return `${stdout}\n${stderr}`.trim().slice(-2000)
}

/** Retrieve context for a question, capped at a token budget. Local, no LLM. */
export async function queryContext(
  graph: string,
  question: string,
  budget = 1500
): Promise<string> {
  if (!existsSync(graph)) return ''
  const { stdout } = await run(
    config.graphifyBin,
    ['query', question, '--budget', String(budget), '--graph', graph],
    { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 }
  )
  return stdout.trim()
}

export async function graphifyAvailable(): Promise<{ ok: boolean; detail: string }> {
  try {
    await run(config.graphifyBin, ['--help'], { timeout: 10_000 })
    return { ok: true, detail: `Found ${config.graphifyBin}` }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return {
      ok: false,
      detail:
        code === 'ENOENT'
          ? 'graphify not found. Run `uv tool install graphifyy` and set GRAPHIFY_BIN to `which graphify`.'
          : `graphify failed: ${(err as Error).message.slice(0, 160)}`
    }
  }
}
