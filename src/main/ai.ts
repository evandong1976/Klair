import { createOpenRouter } from '@openrouter/ai-sdk-provider'

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY })

// OpenRouter model slugs. Tune per demo latency/quality.
export const fastModel = openrouter(process.env.CLAIRE_FAST_MODEL || 'anthropic/claude-haiku-5.5')
export const answerModel = openrouter(
  process.env.CLAIRE_ANSWER_MODEL || 'anthropic/claude-sonnet-5.5'
)
