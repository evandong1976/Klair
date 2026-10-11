import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compile, ExprError } from './expr'

const run = (src: string, scope: Record<string, number> = {}): number =>
  compile(src, Object.keys(scope))(scope)

test('arithmetic follows the usual precedence', () => {
  assert.equal(run('1 + 2 * 3'), 7)
  assert.equal(run('(1 + 2) * 3'), 9)
  assert.equal(run('2 ^ 3 ^ 2'), 512) // right-associative
  assert.equal(run('-2 ^ 2'), -4) // the minus applies to the whole power
  assert.equal(run('2 ^ -1'), 0.5)
  assert.equal(run('2 ** 3'), 8)
  assert.equal(run('10 % 4'), 2)
  assert.equal(run('1e-3 * 1000'), 1)
})

test('variables, constants and functions', () => {
  assert.equal(run('x - lr * gx', { x: 2, lr: 0.5, gx: 4 }), 0)
  assert.ok(Math.abs(run('sin(pi / 2)') - 1) < 1e-12)
  assert.equal(run('max(1, 2, 3)'), 3)
  assert.equal(run('Math.exp(0)'), 1)
  assert.equal(run('sigmoid(0)'), 0.5)
  assert.equal(run('clamp(5, 0, 1)'), 1)
  // A declared variable wins over a constant of the same name.
  assert.equal(run('e + 1', { e: 10 }), 11)
})

test('comparisons, booleans and conditionals', () => {
  assert.equal(run('lr > 0.3 && diverged', { lr: 0.5, diverged: 1 }), 1)
  assert.equal(run('lr > 0.3 && diverged', { lr: 0.5, diverged: 0 }), 0)
  assert.equal(run('lr < 0.1 or lr > 1', { lr: 2 }), 1)
  assert.equal(run('!diverged', { diverged: 0 }), 1)
  assert.equal(run('true'), 1)
  assert.equal(run('x > 0 ? x : 0', { x: -3 }), 0)
  assert.equal(run('z == z0', { z: 1, z0: 1 }), 1)
  // Chained the way math is written, not the way JavaScript reads it.
  assert.equal(run('0.05 <= lr <= 0.4', { lr: 0.2 }), 1)
  assert.equal(run('0.05 <= lr <= 0.4', { lr: 0.9 }), 0)
})

test('math as it appears on a page still parses', () => {
  assert.equal(run('a − b', { a: 5, b: 3 }), 2) // U+2212 minus
  assert.equal(run('2×x', { x: 4 }), 8)
  assert.equal(run('2x + 3(x + 1)', { x: 2 }), 13)
  assert.equal(run('x ≤ 1', { x: 1 }), 1)
})

test('anything that is not plain math is refused when compiling', () => {
  const bad = [
    'foo + 1', // unknown name
    'alert(1)', // unknown function
    'constructor(1)', // not found through the prototype
    'toString',
    'x +', // incomplete
    'x.y', // no property access
    'process.exit()',
    'x; y',
    '"hi"',
    '(x'
  ]
  for (const src of bad) {
    assert.throws(() => compile(src, ['x']), ExprError, src)
  }
  assert.throws(() => compile('lr * 2', ['x', 'y']), /may use: x, y/)
})
