import assert from 'node:assert/strict'
import { test } from 'node:test'
import { claimFnHold, trackFn } from './fnkey'

// trackFn is fed what the native addon reports; claimFnHold is what a click in Chrome asks.

test('a plain fn tap acts (opens the panel)', () => {
  trackFn('down', 1000)
  trackFn('up', 1100)
  assert.equal(trackFn('tap', 1100), true)
})

test('fn held while a paragraph is clicked: the click gets it, and letting go does nothing', () => {
  trackFn('down', 5000)
  assert.equal(claimFnHold(5300), true)
  trackFn('up', 5600)
  assert.equal(trackFn('tap', 5600), false)
  // The next plain tap is back to normal.
  trackFn('down', 9000)
  trackFn('up', 9100)
  assert.equal(trackFn('tap', 9100), true)
})

test('a click that asks just after fn was let go still counts, briefly', () => {
  trackFn('down', 20_000)
  trackFn('up', 20_200)
  assert.equal(claimFnHold(20_300), true)
  assert.equal(claimFnHold(21_000), false)
})

test('a click with fn up is an ordinary click', () => {
  trackFn('down', 30_000)
  trackFn('up', 30_100)
  trackFn('tap', 30_100)
  assert.equal(claimFnHold(40_000), false)
})

test('a missed release does not leave fn held forever', () => {
  trackFn('down', 100_000)
  assert.equal(claimFnHold(100_000 + 31_000), false)
})
