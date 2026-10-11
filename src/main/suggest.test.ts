import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MENUS, topOptions } from '../shared/options'
import { defaultSuggestions, suggestionsFromNote } from './suggest'
import type { VisionNote } from './notes'

const note: VisionNote = {
  topic: 'Gradient descent: learning rate',
  note: 'Wikipedia article on gradient descent.',
  whereRead: 'You are on the section about the step size.',
  options: [
    { id: 'summarize', about: '' },
    { id: 'explain', about: 'The update rule.' }
  ],
  explore: { offer: false, template: 'none', concept: '' },
  hasContent: true,
  chromePageOnScreen: false
}

const base = { captureId: 7, generationId: 1, capturedAt: new Date().toISOString() }
const study = { ...base, type: 'study' as const }
const ids = (set: { ideas: { option?: string }[] }): (string | undefined)[] =>
  set.ideas.map((i) => i.option)

test('the three standing options show first, with fixed wording, marked as being checked', () => {
  const set = defaultSuggestions(study)
  assert.equal(set.thinking, true)
  assert.deepEqual(
    set.ideas.map((i) => [i.key, i.title, i.subtitle]),
    topOptions('study').map((o, i) => [i + 1, o.title, o.line])
  )
})

test('only menu entries the note picked are offered, in menu order, worded by the menu', () => {
  const set = suggestionsFromNote({
    ...study,
    note: {
      ...note,
      // Out of order, twice, and one that is not on the study menu.
      options: [
        { id: 'explain', about: 'The update rule.' },
        { id: 'summarize', about: 'ignored: this entry asks for no name' },
        { id: 'explain', about: 'Something else' },
        { id: 'handoff', about: '' }
      ]
    }
  })
  assert.deepEqual(ids(set), ['summarize', 'explain'])
  assert.deepEqual(
    set.ideas.map((i) => [i.key, i.title, i.subtitle]),
    [
      [1, 'Summarize this', 'The whole page, with what matters here'],
      [2, 'Explain a concept', 'The update rule']
    ]
  )
  assert.match(set.ideas[1].prompt, /It is about: The update rule$/)
  assert.ok(!set.thinking && !set.all)
})

test('with nothing usable picked, the standing three are offered', () => {
  const set = suggestionsFromNote({ ...study, note: { ...note, options: [] } })
  assert.deepEqual(
    ids(set),
    topOptions('study').map((o) => o.id)
  )
})

test('an explainer is offered when the note has something to draw, picked or not', () => {
  const explore = { offer: true, template: 'landscape', concept: 'Learning rate' } as const
  const set = suggestionsFromNote({ ...study, note: { ...note, explore } })
  const tile = set.ideas.find((i) => i.option === 'interactive')
  assert.equal(tile?.title, 'Play with it')
  assert.equal(tile?.subtitle, 'Learning rate')
  assert.deepEqual(tile?.interactive, { template: 'landscape', concept: 'Learning rate' })
  // Said yes but named no template: nothing to draw, so no tile, whatever was picked.
  const vague = { offer: true, template: 'none', concept: 'Something' } as const
  const none = suggestionsFromNote({
    ...study,
    note: { ...note, explore: vague, options: [{ id: 'interactive', about: '' }] }
  })
  assert.ok(!ids(none).includes('interactive'))
})

test('"Connect to earlier" needs an earlier topic that is really in the project', () => {
  const picked = { ...note, options: [{ id: 'relate', about: 'Linear regression' }] }
  const context = 'Project "ML". Covered earlier:\n- Simple linear regression: least squares'
  assert.deepEqual(ids(suggestionsFromNote({ ...study, note: picked, context })), ['relate'])
  // A new project has nothing earlier; and a topic the project never covered is a guess.
  assert.ok(!ids(suggestionsFromNote({ ...study, note: picked })).includes('relate'))
  const invented = { ...note, options: [{ id: 'relate', about: 'Fourier transforms' }] }
  assert.ok(!ids(suggestionsFromNote({ ...study, note: invented, context })).includes('relate'))
  // The topic on screen, covered before under the same name, is not a connection.
  const same = { ...note, options: [{ id: 'relate', about: 'Gradient descent' }] }
  const before = `${context}\n- Gradient descent: overview and history`
  assert.ok(!ids(suggestionsFromNote({ ...study, note: same, context: before })).includes('relate'))
})

test('"Do it for me" says exactly what opens, and only for a site the screen names', () => {
  const work = { ...base, type: 'work' as const }
  const stuck: VisionNote = {
    ...note,
    note: 'Terminal: Error: OPENAI_API_KEY is not set. See the OpenAI dashboard.',
    options: [{ id: 'fix', about: 'OPENAI_API_KEY is not set' }],
    open: { kind: 'url', target: 'https://platform.openai.com/api-keys' }
  }
  const set = suggestionsFromNote({ ...work, note: stuck })
  const tile = set.ideas.find((i) => i.option === 'do')
  assert.equal(tile?.subtitle, 'Open platform.openai.com/api-keys in your browser')
  assert.equal(tile?.open?.target, 'https://platform.openai.com/api-keys')
  const elsewhere = { ...stuck, open: { kind: 'url', target: 'https://example.org/keys' } as const }
  assert.ok(!ids(suggestionsFromNote({ ...work, note: elsewhere })).includes('do'))
})

test('"All options" lists the whole menu and dims what cannot run here', () => {
  const set = suggestionsFromNote({ ...study, note, all: true })
  assert.equal(set.all, true)
  assert.deepEqual(
    ids(set),
    MENUS.study.map((o) => o.id)
  )
  assert.deepEqual(
    set.ideas.map((i) => i.key),
    MENUS.study.map((_, i) => i + 1)
  )
  const dimmed = set.ideas.filter((i) => i.disabled).map((i) => [i.option, i.subtitle])
  assert.deepEqual(dimmed, [
    ['interactive', 'Nothing here to draw'],
    ['relate', 'Nothing earlier in this project yet']
  ])
  // What the note named is kept on the entries it picked.
  assert.equal(set.ideas.find((i) => i.option === 'explain')?.subtitle, 'The update rule')
})
