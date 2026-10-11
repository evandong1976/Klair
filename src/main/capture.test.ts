import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHANGE_SHARE, ChangeDetector, MAX_MOVING_MS, changedShare } from './capture'

const W = 64 * 40
const page = (seed: number): Uint8Array =>
  Uint8Array.from({ length: W }, (_, i) => (((i * 7 + seed * 13) % 5) * 40 + 60) & 255)

test('small, local changes are not substantial', () => {
  const a = page(1)
  const b = a.slice()
  for (let i = 0; i < 8; i++) b[i] = 255 - b[i] // a pointer or clock: a handful of cells
  assert.ok(changedShare(a, b) < CHANGE_SHARE)
  assert.equal(changedShare(a, a), 0)
})

test('a different page is substantial', () => {
  assert.ok(changedShare(page(1), page(2)) >= CHANGE_SHARE)
})

test('changes add up against the last stored frame', () => {
  const stored = page(1)
  const now = stored.slice()
  // Each tick changes 2% of cells: never enough tick to tick, enough once added up.
  for (let tick = 1; tick <= 3; tick++) {
    // Flip each cell to the far end of the scale: a clear change whatever CELL_DELTA is.
    for (let i = (tick - 1) * 51; i < tick * 51; i++) now[i] = now[i] < 128 ? 255 : 0
  }
  assert.ok(changedShare(stored, now) >= CHANGE_SHARE)
})

test('a new screen is stored once it holds still, not while it is moving', () => {
  const d = new ChangeDetector()
  assert.equal(d.observe(page(1), '', 0), 'changed') // the first frame is always stored
  assert.equal(d.observe(page(1), '', 4000), 'same')
  // Scrolling: every tick differs from the stored frame and from the tick before it.
  assert.equal(d.observe(page(2), '', 8000), 'moving')
  assert.equal(d.observe(page(3), '', 9000), 'moving')
  // It stops on page 3: that one frame is stored.
  assert.equal(d.observe(page(3), '', 10000), 'changed')
  assert.equal(d.observe(page(3), '', 14000), 'same')
})

test('a screen that never settles is still stored, but only every so often', () => {
  const d = new ChangeDetector()
  d.observe(page(0), '', 0)
  // A video: every frame is unlike every other (seeded noise).
  const frame = (seed: number): Uint8Array => {
    let x = seed * 2654435761
    return Uint8Array.from({ length: W }, () => (x = (x * 1664525 + 1013904223) >>> 0) >>> 24)
  }
  let stored = 0
  for (let t = 1000; t <= MAX_MOVING_MS * 3; t += 1000) {
    if (d.observe(frame(t), '', t) === 'changed') stored++
  }
  assert.ok(stored >= 2 && stored <= 3, `stored ${stored} times`)
})

test('going back to the stored screen is not a change', () => {
  const d = new ChangeDetector()
  d.observe(page(1), '', 0)
  assert.equal(d.observe(page(2), '', 4000), 'moving') // a glance at something else
  assert.equal(d.observe(page(1), '', 5000), 'same')
})
