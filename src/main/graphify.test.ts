import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compactGraph, screenQuery } from './graphify'

const out = `Graph: /x/graph.json (168 nodes) | Traversal: BFS depth=2 | Start: ['Linear Regression'] | 3 nodes found

[i] Complete answer over budget: all 3 nodes and 2 edges shown.

NODE Linear Regression [src=capture-336.md loc=slide 47 community=2]
NODE Model selection (overfitting, regularization) [src=capture-338.md loc=slide 47 community=2]
NODE Midterm 1 Exam (Oct 14, 2026, 6 MTC 215) [src=capture-326.md loc=None community=3]
EDGE Classical ML --references [EXTRACTED]--> Linear Regression at=capture-338.md:slide 47
EDGE Regression Problem --conceptually_related_to [INFERRED]--> Linear Regression`

test('graph query output becomes concept names and links', () => {
  assert.equal(
    compactGraph(out),
    [
      '- Linear Regression',
      '- Model selection (overfitting, regularization)',
      '- Midterm 1 Exam (Oct 14, 2026, 6 MTC 215)',
      '- Classical ML → Linear Regression (references)',
      '- Regression Problem → Linear Regression (conceptually related to)'
    ].join('\n')
  )
  assert.equal(compactGraph(out, 2).split('\n').length, 2)
  assert.equal(compactGraph(''), '')
})

test('the graph is asked about the topic, not the site', () => {
  assert.equal(
    screenQuery(
      'Gradient descent - Wikipedia',
      'Gradient descent - Wikipedia',
      'https://en.wikipedia.org/wiki/Gradient_descent#Learning_rate'
    ),
    'Gradient descent'
  )
  assert.equal(
    screenQuery('Lecture 3: Linear models | Brightspace', null, 'https://x.edu/%E0%A4%A'),
    'Lecture 3: Linear models'
  )
  assert.equal(screenQuery(null, null, null), '')
})
