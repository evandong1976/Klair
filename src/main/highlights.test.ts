import assert from 'node:assert/strict'
import { test } from 'node:test'
import { groundedHighlights, samePage } from './highlights'

const page = `Gradient descent

In mathematics, gradient descent is a first-order iterative algorithm for minimizing a
differentiable multivariate function. The step size, also called the learning rate,
controls how far each update moves.`

test('only quotes that are really on the page are kept', () => {
  const kept = groundedHighlights(page, [
    // On the page, across a line break and with different spacing and case.
    {
      quote: 'a first-order iterative algorithm for  Minimizing a differentiable',
      note: 'what it is'
    },
    // Made up: not on the page.
    { quote: 'gradient descent always finds the global minimum', note: 'wrong' },
    // Too short to place reliably.
    { quote: 'step', note: 'short' },
    // The same passage twice.
    { quote: 'A first-order iterative algorithm for minimizing a differentiable', note: 'again' },
    // Wrapped in quote marks by the model; note with an em dash.
    { quote: '"also called the learning rate"', note: 'η — the step size' }
  ])
  assert.deepEqual(
    kept.map((k) => k.quote),
    [
      'a first-order iterative algorithm for Minimizing a differentiable',
      'also called the learning rate'
    ]
  )
  assert.equal(kept[1].note, 'η, the step size')
})

test('at most four passages, each with a note', () => {
  const lines = Array.from({ length: 6 }, (_, i) => `sentence number ${i} is here`)
  const kept = groundedHighlights(
    lines.join('. '),
    lines.map((quote) => ({ quote, note: 'n' })).concat([{ quote: lines[0], note: ' ' }])
  )
  assert.equal(kept.length, 4)
  assert.equal(groundedHighlights(lines[0], [{ quote: lines[0], note: '  ' }]).length, 0)
})

test('jumping to a section keeps the page', () => {
  assert.ok(samePage('https://a.org/wiki/X', 'https://a.org/wiki/X#History'))
  assert.ok(!samePage('https://a.org/wiki/X', 'https://a.org/wiki/Y'))
})
