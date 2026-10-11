import assert from 'node:assert/strict'
import { test } from 'node:test'
import { suggestionsFromNote } from './suggest'
import type { VisionNote } from './notes'

const note = {
  topic: 'Gradient descent: learning rate',
  note: 'Wikipedia article on gradient descent.',
  whereRead: 'You are on the section about the step size.',
  ideas: [
    { title: 'Summarize this section', subtitle: 'The main idea in a few lines', kind: 'summary' },
    { title: 'Explain the update rule', subtitle: 'What each symbol means', kind: 'explain' },
    { title: 'Why can it overshoot?', subtitle: 'When the step is too big', kind: 'explain' }
  ],
  explore: { offer: false, template: 'none', concept: '', title: '', subtitle: '' },
  hasContent: true,
  chromePageOnScreen: false
} as VisionNote

const base = { captureId: 7, generationId: 1, capturedAt: new Date().toISOString() }
const none = { offer: false, template: 'none', concept: '', title: '', subtitle: '' } as const

test("an interactive explainer is offered as one more idea, alongside the note's own", () => {
  const plain = suggestionsFromNote({ ...base, note: { ...note, explore: none } })
  assert.equal(plain.ideas.length, 3)
  assert.ok(plain.ideas.every((i) => i.kind !== 'interactive'))

  const set = suggestionsFromNote({
    ...base,
    note: {
      ...note,
      explore: {
        offer: true,
        template: 'landscape',
        concept: 'Learning rate in gradient descent',
        title: 'Play with the learning rate',
        subtitle: 'Slide the step size and watch the path'
      }
    }
  })
  assert.equal(set.ideas.length, 4)
  const tile = set.ideas[3]
  assert.equal(tile.key, 4) // ⌘4
  assert.equal(tile.kind, 'interactive')
  assert.equal(tile.title, 'Play with the learning rate')
  assert.deepEqual(tile.interactive, {
    template: 'landscape',
    concept: 'Learning rate in gradient descent'
  })
})

test('a note without a usable offer adds no tile', () => {
  // Said yes but named no template, and a note cached before explainers existed.
  const vague = { ...none, offer: true, concept: 'Something', title: 'Try it' }
  assert.equal(suggestionsFromNote({ ...base, note: { ...note, explore: vague } }).ideas.length, 3)
  const old = { ...note } as Partial<VisionNote>
  delete old.explore
  assert.equal(suggestionsFromNote({ ...base, note: old as VisionNote }).ideas.length, 3)
})
