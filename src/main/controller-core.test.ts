import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ControllerCore } from './controller-core'
import type { SuggestionSet } from '../shared/types'

const cfg = { dwellMs: 60_000, cooldownMs: 120_000, dismissQuietMs: 600_000 }

function setup(): { core: ControllerCore; clock: { t: number } } {
  const clock = { t: 1_000_000 }
  const core = new ControllerCore(cfg, () => clock.t)
  core.setObserving(true)
  return { core, clock }
}

function makeSet(id: string, captureId: number, generationId: number): SuggestionSet {
  return {
    id,
    generationId,
    captureId,
    createdAt: new Date().toISOString(),
    topic: 't',
    whereTitle: 'w',
    whereRead: 'r',
    sources: [],
    ideas: [1, 2, 3].map((k) => ({
      id: `${id}-${k}`,
      key: k,
      title: `idea ${k}`,
      subtitle: 's',
      kind: 'other' as const,
      prompt: 'p'
    }))
  }
}

test('dwell requests suggestions once, never executes', () => {
  const { core, clock } = setup()
  core.onCapture(1, true)
  clock.t += 59_000
  assert.deepEqual(core.tick(), [])
  clock.t += 2_000
  const fx = core.tick()
  assert.equal(fx.length, 1)
  assert.equal(fx[0].type, 'requestSuggestions')
  assert.deepEqual(core.tick(), [], 'no second request while in flight')
  assert.ok(!fx.some((e) => e.type === 'execute'))
})

test('late result after screen change is dropped', () => {
  const { core, clock } = setup()
  core.onCapture(1, true)
  clock.t += 61_000
  const [req] = core.tick()
  assert.equal(req.type, 'requestSuggestions')
  core.onCapture(2, true)
  const gen = req.type === 'requestSuggestions' ? req.generationId : -1
  assert.deepEqual(core.onSuggestions(gen, makeSet('a', 1, gen)), [])
  assert.equal(core.current, null)
})

test('valid selection executes; stale, duplicate and missing keys are rejected', () => {
  const { core, clock } = setup()
  core.onCapture(1, true)
  clock.t += 61_000
  const [req] = core.tick()
  const gen = req.type === 'requestSuggestions' ? req.generationId : -1
  core.onSuggestions(gen, makeSet('a', 1, gen))
  assert.equal(core.select(2, 'zzz')[0].type, 'rejectSelection')
  assert.equal(core.select(9)[0].type, 'rejectSelection')
  const ok = core.select(2, 'a')
  assert.equal(ok[0].type, 'execute')
  const dup = core.select(2, 'a')
  assert.deepEqual(dup, [{ type: 'rejectSelection', reason: 'duplicate' }])
  core.executionFinished()
  assert.equal(core.select(3)[0].type, 'execute', 'another pick after the first finishes')
})

test('dismiss invalidates and keeps quiet; cooldown spaces requests', () => {
  const { core, clock } = setup()
  core.onCapture(1, true)
  clock.t += 61_000
  const [req] = core.tick()
  const gen = req.type === 'requestSuggestions' ? req.generationId : -1
  core.onSuggestions(gen, makeSet('a', 1, gen))
  const fx = core.dismiss()
  assert.equal(fx[0].type, 'invalidateSuggestions')
  assert.deepEqual(core.select(1), [{ type: 'rejectSelection', reason: 'no-suggestions' }])
  core.onCapture(2, true)
  clock.t += 61_000
  assert.deepEqual(core.tick(), [], 'quiet after dismiss')
  clock.t += 600_000
  assert.equal(core.tick()[0].type, 'requestSuggestions')
})

test('failed generation allows a quiet retry after cooldown', () => {
  const { core, clock } = setup()
  core.onCapture(1, true)
  clock.t += 61_000
  const [req] = core.tick()
  const gen = req.type === 'requestSuggestions' ? req.generationId : -1
  core.onSuggestionsFailed(gen)
  clock.t += 10_000
  assert.deepEqual(core.tick(), [], 'cooldown preserved')
  clock.t += 120_000
  assert.equal(core.tick()[0].type, 'requestSuggestions')
})

test('screen change while panel is open keeps the ideas', () => {
  const { core, clock } = setup()
  core.onCapture(1, true)
  clock.t += 61_000
  const [req] = core.tick()
  const gen = req.type === 'requestSuggestions' ? req.generationId : -1
  core.onSuggestions(gen, makeSet('a', 1, gen))
  core.setPanelOpen(true)
  assert.deepEqual(core.onCapture(2, true), [])
  assert.equal(core.current?.id, 'a')
})

test('requestNow ignores dwell but not in-flight requests', () => {
  const { core } = setup()
  core.onCapture(1, true)
  const fx = core.requestNow()
  assert.equal(fx[0].type, 'requestSuggestions')
  assert.deepEqual(core.requestNow(), [])
})
