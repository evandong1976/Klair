import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHANGE_SHARE, changedShare } from './capture'

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
