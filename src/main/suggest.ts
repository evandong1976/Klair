import { randomUUID } from 'crypto'
import type { Idea, SuggestionSet } from '../shared/types'
import { interactiveOffer, type InteractiveOffer, type VisionNote } from './notes'

// Suggestion Engine: packages the ideas the vision note proposed for a screen (⌘1–9).
// No model call here, so ideas are ready as soon as the note is. It only *proposes*;
// nothing here executes assistance.

/** The tile that opens an interactive explainer, added after the note's own ideas. */
export function interactiveIdea(setId: string, key: number, offer: InteractiveOffer): Idea {
  return {
    id: `${setId}:${key}`,
    key,
    title: offer.title,
    subtitle: offer.subtitle || 'Move the sliders and see what changes',
    kind: 'interactive',
    prompt: `Interactive explainer: ${offer.concept}`,
    interactive: { template: offer.template, concept: offer.concept }
  }
}

export function suggestionsFromNote(input: {
  captureId: number
  generationId: number
  note: VisionNote
  capturedAt: string
  /** Title of the Chrome page this screen shows, when its full text was matched. */
  pageTitle?: string | null
  /** An area the user selected, rather than a whole-screen capture. */
  selection?: boolean
}): SuggestionSet {
  const id = randomUUID()
  const at = new Date(input.capturedAt).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit'
  })
  const ideas: Idea[] = input.note.ideas.slice(0, 8).map((idea, i) => {
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
  // The note also says whether this screen has a concept worth playing with. Because
  // that comes from the same call as the ideas, the tile is there from the start.
  const offer = interactiveOffer(input.note)
  if (offer) ideas.push(interactiveIdea(id, ideas.length + 1, offer))
  return {
    id,
    generationId: input.generationId,
    captureId: input.captureId,
    createdAt: new Date().toISOString(),
    topic: input.note.topic,
    whereTitle: input.note.topic,
    whereRead: input.note.whereRead.slice(0, 240),
    sources: [
      {
        kind: 'screen',
        label: `${input.selection ? 'Your selection' : 'On screen'} · ${at}`,
        captureId: input.captureId
      },
      ...(input.pageTitle
        ? [
            {
              kind: 'screen' as const,
              label: `Full page · ${input.pageTitle.slice(0, 40)}`,
              captureId: input.captureId
            }
          ]
        : [])
    ],
    ideas
  }
}
