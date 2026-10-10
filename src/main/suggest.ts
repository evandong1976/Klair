import { randomUUID } from 'crypto'
import type { SuggestionSet } from '../shared/types'
import type { VisionNote } from './notes'

// Suggestion Engine: packages the three ideas the vision note proposed for a screen.
// No model call here, so ideas are ready as soon as the note is. It only *proposes*;
// nothing here executes assistance.

export function suggestionsFromNote(input: {
  captureId: number
  generationId: number
  note: VisionNote
  capturedAt: string
}): SuggestionSet {
  const id = randomUUID()
  const at = new Date(input.capturedAt).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit'
  })
  return {
    id,
    generationId: input.generationId,
    captureId: input.captureId,
    createdAt: new Date().toISOString(),
    topic: input.note.topic,
    whereTitle: input.note.topic,
    whereRead: input.note.whereRead.slice(0, 240),
    sources: [{ kind: 'screen', label: `On screen · ${at}`, captureId: input.captureId }],
    ideas: input.note.ideas.slice(0, 3).map((idea, i) => {
      const title = idea.title.slice(0, 60)
      const subtitle = idea.subtitle.slice(0, 90)
      return {
        id: `${id}:${i + 1}`,
        key: i + 1,
        title,
        subtitle,
        kind: idea.kind,
        prompt: `${title}. ${subtitle}`
      }
    })
  }
}
