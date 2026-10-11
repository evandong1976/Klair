import assert from 'node:assert/strict'
import { test } from 'node:test'
import { briefDue } from './brief'

test('a brief is first written after two notes, then every six', () => {
  assert.equal(briefDue(0, 1), false)
  assert.equal(briefDue(0, 2), true)
  assert.equal(briefDue(2, 7), false)
  assert.equal(briefDue(2, 8), true)
  assert.equal(briefDue(8, 13), false)
  assert.equal(briefDue(8, 14), true)
})
