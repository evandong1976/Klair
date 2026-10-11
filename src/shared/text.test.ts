import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deepNoEmDash, noEmDash } from './text'

test('em dashes are replaced, whatever the spacing', () => {
  assert.equal(noEmDash('Gradient descent — learning rate'), 'Gradient descent, learning rate')
  assert.equal(noEmDash('fast—but noisy'), 'fast, but noisy')
  assert.equal(noEmDash('— a guess\nplain line'), 'a guess\nplain line')
  assert.equal(
    noEmDash('ranges like 1–9 and hyphen-ated words stay'),
    'ranges like 1–9 and hyphen-ated words stay'
  )
})

test('every string in a nested value is cleaned; other values are untouched', () => {
  const at = new Date(0)
  const out = deepNoEmDash({ title: 'A — B', ideas: [{ subtitle: 'x—y', key: 1 }], at, none: null })
  assert.deepEqual(out, { title: 'A, B', ideas: [{ subtitle: 'x, y', key: 1 }], at, none: null })
  assert.equal(out.at, at)
})
