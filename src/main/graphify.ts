import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { config } from './config'

const run = promisify(execFile)

// Graphify CLI (Python package `graphifyy`). On a Mac with Homebrew:
//   brew install pipx && pipx ensurepath && pipx install graphifyy
// pipx puts the `graphify` command in ~/.local/bin, which apps often can't see on
// their PATH, so Klair looks in the usual places itself. GRAPHIFY_BIN overrides.
//
// Verified with `graphify --help`:
//   extract <dir> --backend openai --out <dir>  → <out>/graphify-out/graph.json (incremental by default)
//   query "<q>" --budget N --graph <path>       → local BFS, no LLM
//   benchmark <graph.json>                      → token reduction vs full corpus

let resolved: string | null = null

/** Find the graphify binary: GRAPHIFY_BIN, common install folders, then the login shell's PATH. */
export async function resolveGraphifyBin(): Promise<string | null> {
  if (process.env.GRAPHIFY_BIN) return process.env.GRAPHIFY_BIN
  if (resolved && existsSync(resolved)) return resolved
  const home = homedir()
  const candidates = [
    join(home, '.local', 'bin', 'graphify'), // pipx / uv default
    '/opt/homebrew/bin/graphify', // Homebrew on Apple silicon
    '/usr/local/bin/graphify' // Homebrew on Intel
  ]
  for (const c of candidates) {
    if (existsSync(c)) return (resolved = c)
  }
  // Same PATH as Terminal (login shell), for anything installed elsewhere.
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const { stdout } = await run(shell, ['-lc', 'command -v graphify'], { timeout: 5000 })
    const p = stdout.trim().split('\n').pop()
    if (p && existsSync(p)) return (resolved = p)
  } catch {
    /* not found */
  }
  return null
}

async function bin(): Promise<string> {
  const b = await resolveGraphifyBin()
  if (!b) {
    const err = new Error('graphify not found') as NodeJS.ErrnoException
    err.code = 'ENOENT'
    throw err
  }
  return b
}

/** Index a session's notes folder. Makes LLM calls through OpenRouter's OpenAI-compatible endpoint. */
export async function indexSession(
  notesDir: string,
  outDir: string,
  signal?: AbortSignal
): Promise<string> {
  const { stdout, stderr } = await run(
    await bin(),
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
    await bin(),
    ['query', question, '--budget', String(budget), '--graph', graph],
    { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 }
  )
  return stdout.trim()
}

export async function graphifyAvailable(): Promise<{ ok: boolean; detail: string }> {
  try {
    const b = await bin()
    await run(b, ['--help'], { timeout: 10_000 })
    return { ok: true, detail: `Found ${b}` }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return {
      ok: false,
      detail:
        code === 'ENOENT'
          ? 'graphify not found. In Terminal: brew install pipx && pipx ensurepath && pipx install graphifyy, then click Check again.'
          : `graphify failed: ${(err as Error).message.slice(0, 160)}`
    }
  }
}
