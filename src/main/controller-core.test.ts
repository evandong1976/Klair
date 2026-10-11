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

function shown(core: ControllerCore, clock: { t: number }, id: string, captureId: number): void {
  core.onCapture(captureId, true)
  clock.t += 61_000
  const [req] = core.tick()
  const gen = req.type === 'requestSuggestions' ? req.generationId : -1
  core.onSuggestions(gen, makeSet(id, captureId, gen))
}

test('screen change while the panel is open leaves the ideas alone until it closes', () => {
  const { core, clock } = setup()
  shown(core, clock, 'a', 1)
  core.setPanelOpen(true)
  assert.deepEqual(core.onCapture(2, true), [])
  assert.deepEqual(core.onCapture(3, true), [])
  assert.equal(core.current?.id, 'a')
  assert.equal(core.select(1)[0].type, 'execute') // the shortcuts still work
  core.executionFinished()
  // Closing applies the latest held change: the old ideas go, new ones wait for a dwell.
  const fx = core.setPanelOpen(false)
  assert.deepEqual(
    fx.map((e) => e.type),
    ['invalidateSuggestions']
  )
  assert.equal(core.currentCaptureId, 3)
})

test('asking for ideas with the panel open uses the screen as it is now', () => {
  const { core, clock } = setup()
  shown(core, clock, 'a', 1)
  core.setPanelOpen(true)
  core.onCapture(2, true)
  const fx = core.requestNow()
  assert.deepEqual(
    fx.map((e) => e.type),
    ['invalidateSuggestions', 'requestSuggestions']
  )
  assert.equal(fx[1].type === 'requestSuggestions' && fx[1].captureId, 2)
})

test('a running idea keeps its set; ideas refresh for the new screen afterwards', () => {
  const { core, clock } = setup()
  shown(core, clock, 'a', 1)
  core.setPanelOpen(true)
  assert.equal(core.select(1)[0].type, 'execute')
  assert.deepEqual(core.onCapture(2, true), [])
  assert.equal(core.current?.id, 'a')
  core.executionFinished()
  const fx = core.requestNow()
  assert.deepEqual(
    fx.map((e) => e.type),
    ['invalidateSuggestions', 'requestSuggestions']
  )
})

test('requestNow ignores dwell but not in-flight requests', () => {
  const { core } = setup()
  core.onCapture(1, true)
  const fx = core.requestNow()
  assert.equal(fx[0].type, 'requestSuggestions')
  assert.deepEqual(core.requestNow(), [])
})

test('a pinned selection stays the context until it is cleared', () => {
  const { core, clock } = setup()
  shown(core, clock, 'a', 1)
  core.setPanelOpen(true)
  const pinned = core.pin(10)
  assert.deepEqual(
    pinned.map((e) => e.type),
    ['invalidateSuggestions', 'requestSuggestions']
  )
  assert.equal(pinned[1].type === 'requestSuggestions' && pinned[1].captureId, 10)
  // Automatic captures keep coming but don't replace the selection.
  assert.deepEqual(core.onCapture(11, true), [])
  assert.deepEqual(core.onCapture(12, true), [])
  assert.equal(core.currentCaptureId, 10)
  // Clearing it returns to the latest automatic capture.
  const back = core.unpin()
  assert.equal(core.currentCaptureId, 12)
  const last = back.at(-1)
  assert.equal(last?.type === 'requestSuggestions' ? last.captureId : null, 12)
  assert.equal(core.pinnedCaptureId, null)
  assert.deepEqual(core.unpin(), [])
})

test('a pinned selection wins over a screen change held while the panel is open', () => {
  const { core, clock } = setup()
  shown(core, clock, 'a', 1)
  core.setPanelOpen(true)
  assert.deepEqual(core.onCapture(2, true), []) // held: the panel is open
  const fx = core.pin(9) // the user selects an area: an explicit choice, applied at once
  assert.equal(core.currentCaptureId, 9)
  assert.ok(fx.some((e) => e.type === 'requestSuggestions' && e.captureId === 9))
  assert.deepEqual(core.setPanelOpen(false), []) // nothing left over from the held change
  assert.equal(core.currentCaptureId, 9)
  core.unpin()
  assert.equal(core.currentCaptureId, 2) // back to the latest screen
})

test('switching project starts afresh: no ideas, held change or selection carry over', () => {
  const { core, clock } = setup()
  shown(core, clock, 'a', 1)
  core.pin(5)
  core.resetContext()
  assert.equal(core.current, null)
  assert.equal(core.currentCaptureId, null)
  assert.equal(core.pinnedCaptureId, null)
  assert.equal(core.select(1)[0].type, 'rejectSelection') // the old ideas are gone
  // The new project's first capture becomes the context.
  core.onCapture(20, true)
  assert.equal(core.currentCaptureId, 20)
})

test('standing options show at once; the checked list replaces them, and a pick carries over', () => {
  const { core } = setup()
  core.onCapture(1, true)
  core.setPanelOpen(true)
  const [req] = core.requestNow()
  assert.equal(req.type, 'requestSuggestions')
  const gen = (req as { generationId: number }).generationId

  const standing = { ...makeSet('standing', 1, gen), thinking: true }
  assert.deepEqual(core.onDefaults(gen, standing), [{ type: 'publishSuggestions', set: standing }])
  // Still being checked: asking again does not start a second request.
  assert.deepEqual(core.requestNow(), [])
  // A standing option can be picked before the check is back...
  assert.equal(core.select(1, 'standing')[0].type, 'execute')
  // ...and the checked list then takes its place without letting it be picked twice.
  const checked = makeSet('checked', 1, gen)
  assert.deepEqual(core.onSuggestions(gen, checked), [{ type: 'publishSuggestions', set: checked }])
  assert.deepEqual(core.select(2, 'checked'), [{ type: 'rejectSelection', reason: 'duplicate' }])
  // A key pressed against the list that was just replaced does nothing.
  core.executionFinished()
  assert.deepEqual(core.select(1, 'standing'), [{ type: 'rejectSelection', reason: 'stale' }])
})

test('standing options for another screen or request are dropped; a failed check keeps them', () => {
  const { core } = setup()
  core.onCapture(1, true)
  core.setPanelOpen(true)
  const gen = (core.requestNow()[0] as { generationId: number }).generationId
  assert.deepEqual(core.onDefaults(gen + 1, { ...makeSet('late', 1, gen + 1), thinking: true }), [])
  assert.deepEqual(core.onDefaults(gen, { ...makeSet('other', 2, gen), thinking: true }), [])

  const standing = { ...makeSet('standing', 1, gen), thinking: true }
  core.onDefaults(gen, standing)
  const [kept] = core.onSuggestionsFailed(gen)
  assert.equal(kept.type, 'publishSuggestions')
  const set = (kept as { set: SuggestionSet }).set
  assert.equal(set.id, 'standing')
  assert.equal(set.thinking, false)
  assert.equal(core.select(3, 'standing')[0].type, 'execute')
})

test('"All options" swaps the list for the same screen; a dimmed option cannot be picked', () => {
  const { core } = setup()
  core.onCapture(1, true)
  core.setPanelOpen(true)
  const gen = (core.requestNow()[0] as { generationId: number }).generationId
  const short = makeSet('short', 1, gen)
  core.onSuggestions(gen, short)

  const all = { ...makeSet('all', 1, gen), all: true }
  all.ideas[2] = { ...all.ideas[2], disabled: true }
  assert.deepEqual(core.replace(all), [{ type: 'publishSuggestions', set: all }])
  assert.deepEqual(core.select(3, 'all'), [{ type: 'rejectSelection', reason: 'no-such-key' }])
  // Not for another screen, and not while one of the options is running.
  assert.deepEqual(core.replace(makeSet('elsewhere', 2, gen)), [])
  assert.equal(core.select(1, 'all')[0].type, 'execute')
  assert.deepEqual(core.replace(short), [])
})
