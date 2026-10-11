import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mdBlocks, mdInline } from './markdown'

test('maths in LaTeX is picked out of a sentence, inline and on display', () => {
  assert.deepEqual(mdInline('Suppose \\(g(x)=x+1\\) and **so** on.'), [
    { type: 'text', text: 'Suppose ' },
    { type: 'math', tex: 'g(x)=x+1', display: false },
    { type: 'text', text: ' and ' },
    { type: 'strong', text: 'so' },
    { type: 'text', text: ' on.' }
  ])
  assert.deepEqual(mdInline('error \\[ E_{in}(g)=\\frac{2}{3} \\] and $$a^2$$'), [
    { type: 'text', text: 'error' },
    { type: 'math', tex: 'E_{in}(g)=\\frac{2}{3}', display: true },
    { type: 'text', text: 'and' },
    { type: 'math', tex: 'a^2', display: true }
  ])
})

test('a star or backtick inside maths is maths; maths inside code is code; prices stay', () => {
  assert.deepEqual(mdInline('\\(a*b*c\\)'), [{ type: 'math', tex: 'a*b*c', display: false }])
  assert.deepEqual(mdInline('type `\\(x\\)` here'), [
    { type: 'text', text: 'type ' },
    { type: 'code', text: '\\(x\\)' },
    { type: 'text', text: ' here' }
  ])
  assert.deepEqual(mdInline('from $5 to $10'), [{ type: 'text', text: 'from $5 to $10' }])
})

test('a numbered step followed by bullets and display maths keeps its shape and its number', () => {
  const blocks = mdBlocks(
    [
      '1) Compute each training error term',
      '- For \\(x=1\\): error \\(=(2-2)^2=0\\)',
      '- For \\(x=2\\): error \\(=(3-2)^2=1\\)',
      '',
      '2) Average them for in-sample error',
      '\\[',
      'E_{in}(g)=\\frac{1}{3}(0+1+1)',
      '',
      '- \\frac{0}{3}',
      '\\]',
      '',
      'Result: \\(E_{in}(g)\\approx 0.67\\).'
    ].join('\n')
  )
  assert.deepEqual(
    blocks.map((b) => b.type),
    ['ol', 'ul', 'ol', 'p', 'p']
  )
  const [first, bullets, second, display] = blocks
  assert.ok(first.type === 'ol' && first.start === 1)
  assert.ok(bullets.type === 'ul' && bullets.items.length === 2)
  assert.deepEqual(bullets.type === 'ul' && bullets.items[0][1], {
    type: 'math',
    tex: 'x=1',
    display: false
  })
  // "2)" stays 2, and the display block spanning lines (one blank, one starting "-") is whole.
  assert.ok(second.type === 'ol' && second.start === 2)
  assert.deepEqual(display.type === 'p' && display.inline, [
    { type: 'math', tex: 'E_{in}(g)=\\frac{1}{3}(0+1+1) - \\frac{0}{3}', display: true }
  ])
})

test('fenced code is kept verbatim, closed or still streaming', () => {
  const blocks = mdBlocks(
    'A prompt:\n\n```text\nYou are **helping** with \\(x\\).\n\n- keep this\n```\n\nDone.'
  )
  assert.deepEqual(blocks[1], {
    type: 'code',
    language: 'text',
    source: 'You are **helping** with \\(x\\).\n\n- keep this'
  })
  assert.deepEqual(
    blocks.map((b) => b.type),
    ['p', 'code', 'p']
  )
  assert.deepEqual(mdBlocks('```\nhalf wri').at(-1), {
    type: 'code',
    language: 'text',
    source: 'half wri'
  })
})

test('lines of a paragraph stay separate lines, with no gap around a display equation', () => {
  const [p] = mdBlocks('Three points:\n\\(x=1\\)\n\\(x=2\\)\nso:\n\\[\nx^2\n\\]\ndone')
  assert.deepEqual(p.type === 'p' && p.inline, [
    { type: 'text', text: 'Three points:\n' },
    { type: 'math', tex: 'x=1', display: false },
    { type: 'text', text: '\n' },
    { type: 'math', tex: 'x=2', display: false },
    { type: 'text', text: '\nso:' },
    { type: 'math', tex: 'x^2', display: true },
    { type: 'text', text: 'done' }
  ])
})

test('an indented bullet is a sub-point of the one above it', () => {
  const [list] = mdBlocks('- Suppose the data are:\n  - \\(y_1=1\\)\n- Then predict')
  assert.ok(list.type === 'ul')
  assert.deepEqual(list.type === 'ul' && list.nested, [false, true, false])
  assert.equal(list.type === 'ul' && list.items.length, 3)
})

test('headings, wrapped paragraphs and indented list lines', () => {
  assert.deepEqual(
    mdBlocks('## Title\nfirst line\nsecond line\n\n- item\n  goes on\n- next').map((b) =>
      b.type === 'ul' ? b.items.length : b.type
    ),
    ['h', 'p', 2]
  )
})
