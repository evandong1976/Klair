import { execFile } from 'child_process'
import { join } from 'path'
import { promisify } from 'util'

const run = promisify(execFile)
// GUI-launched apps do not inherit the shell PATH, so allow an absolute path.
const bin = process.env.GRAPHIFY_BIN || 'graphify'

// Index a session's notes folder. Makes LLM calls through OpenRouter's
// OpenAI-compatible endpoint.
export async function indexSession(dir: string): Promise<void> {
  await run(bin, ['extract', dir, '--backend', 'openai'], {
    timeout: 600_000,
    env: {
      ...process.env,
      OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
      OPENAI_API_KEY: process.env.OPENROUTER_API_KEY,
      OPENAI_MODEL: process.env.GRAPHIFY_MODEL || 'anthropic/claude-haiku-5.5'
    }
  })
}

// Retrieve context for a question, capped at a token budget. Local, no LLM.
export async function queryContext(dir: string, question: string, budget = 1500): Promise<string> {
  const graph = join(dir, 'graphify-out', 'graph.json')
  const { stdout } = await run(bin, ['query', question, '--budget', String(budget), '--graph', graph])
  return stdout
}
