import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CurveSpec, FitFill, LandscapeSpec } from './blocks'
import {
  buildCurve,
  buildFit,
  buildLandscape,
  checkSpec,
  curveRange,
  defaults,
  formatNumber,
  landscapeRange,
  normalizeSpec,
  storyProblem,
  tidyFit,
  unreachableCaptions,
  widenToReach,
  withoutCaptions
} from './explorable'

// Gradient descent on a bowl that is three times steeper in y than in x.
const descent: LandscapeSpec = {
  template: 'landscape',
  title: 'Gradient descent: learning rate',
  intro: 'Raise the learning rate and watch the path.',
  controls: [
    { id: 'lr', label: 'Learning rate', min: 0.01, max: 0.5, step: 0.01, value: 0.1 },
    { id: 'steps', label: 'Steps', min: 1, max: 40, step: 1, value: 20 }
  ],
  surface: { f: 'x^2 + 3*y^2', xMin: -3, xMax: 3, yMin: -3, yMax: 3, zLabel: 'Loss' },
  path: { startX: 2.5, startY: 2, nextX: 'x - lr*gx', nextY: 'y - lr*gy', steps: 'steps' },
  readouts: [{ label: 'Final loss', value: 'z' }],
  captions: [
    { when: 'diverged', text: 'Too big: it flies off.' },
    { when: 'z < 0.01', text: 'It settles at the bottom.' },
    { when: 'true', text: 'Still on its way down.' }
  ]
}

test('a landscape steps along slopes that Klair measures itself', () => {
  const model = buildLandscape(descent)
  const values = defaults(descent)
  const path = model.path(values)
  assert.equal(path.points.length, 21)
  assert.equal(path.diverged, false)
  // One step of x - lr * 2x and y - lr * 6y from (2.5, 2) with lr = 0.1.
  assert.ok(Math.abs(path.points[1].x - 2.0) < 1e-6)
  assert.ok(Math.abs(path.points[1].y - 0.8) < 1e-6)
  const scope = model.outcome(values, path)
  assert.ok(scope.z < scope.z0)
  assert.equal(model.caption(scope), 'It settles at the bottom.')
  assert.match(model.readouts(scope)[0].text, /^\d/)
})

test('the outcome changes with the slider: too large a rate diverges', () => {
  const model = buildLandscape(descent)
  const values = { ...defaults(descent), lr: 0.5 } // y is multiplied by -2 each step
  const path = model.path(values)
  assert.equal(path.diverged, true)
  assert.ok(path.points.length < 21) // stopped once it was off the map
  assert.equal(model.caption(model.outcome(values, path)), 'Too big: it flies off.')
})

test('grid heights and the colour range come from the surface', () => {
  const model = buildLandscape(descent)
  const grid = model.grid(defaults(descent), 6)
  assert.equal(grid.length, 49)
  assert.equal(grid[0], 9 + 27) // (-3, -3)
  assert.equal(grid[3 * 7 + 3], 0) // the centre
  const [lo, hi] = landscapeRange(descent, model)
  assert.ok(lo >= 0 && lo < 1 && hi > 30 && hi <= 36)
})

test('a good spec passes the check; broken ones say what to fix', () => {
  assert.equal(checkSpec(descent), null)
  const withPath = (path: Partial<LandscapeSpec['path']>): LandscapeSpec => ({
    ...descent,
    path: { ...descent.path, ...path }
  })
  assert.match(checkSpec(withPath({ nextX: 'x - rate*gx' })) ?? '', /"rate" is not available/)
  assert.match(checkSpec(withPath({ nextX: 'x', nextY: 'y' })) ?? '', /does not move/)
  assert.match(checkSpec(withPath({ steps: '0' })) ?? '', /steps is 0/)
  const jump = withPath({ nextX: 'x + 100', nextY: 'y' })
  assert.match(checkSpec(jump) ?? '', /has left the map after 1 step\b/)
  // The sliders must be able to change the story: here no rate up to 0.2 ever diverges.
  const timid = {
    ...descent,
    controls: [{ ...descent.controls[0], max: 0.2 }, descent.controls[1]],
    captions: [
      { when: 'diverged', text: 'Too big.' },
      { when: 'true', text: 'Heading down.' }
    ]
  }
  assert.equal(checkSpec(timid), null) // it can be drawn; the complaint is about the story
  const problem = storyProblem(timid) ?? ''
  assert.match(problem, /only ever shows one caption/)
  assert.match(problem, /With lr = 0.2, the path ends at z = /)
  assert.deepEqual(unreachableCaptions(timid), [0])
  // Stretching the slider is enough to reach the missing regime, with no second model call.
  const widened = widenToReach(timid)
  assert.ok(widened.controls[0].max > 1 / 3, `max ${widened.controls[0].max}`)
  assert.deepEqual(unreachableCaptions(widened), [])
  assert.equal(checkSpec(widened), null)
  assert.equal(storyProblem(widened), null)
  assert.equal(widenToReach(descent), descent) // nothing to fix, nothing changed
  assert.deepEqual(withoutCaptions(timid, [0]).captions, [{ when: 'true', text: 'Heading down.' }])
  const flat = { ...descent, surface: { ...descent.surface, f: '4' } }
  assert.match(checkSpec(flat) ?? '', /flat/)
  const clash = { ...descent, controls: [{ ...descent.controls[0], id: 'x' }, descent.controls[1]] }
  assert.match(checkSpec(clash) ?? '', /already uses/)
  const undefinedSurface = { ...descent, surface: { ...descent.surface, f: 'log(x)' } }
  assert.match(checkSpec(undefinedSurface) ?? '', /not a number/)
})

test('normalizeSpec repairs ranges and trims extras', () => {
  const messy = normalizeSpec({
    ...descent,
    controls: [
      { id: ' lr ', label: 'Rate', min: 1, max: 0, step: 0, value: 7 },
      ...Array.from({ length: 5 }, (_, i) => ({ ...descent.controls[1], id: `s${i}` }))
    ],
    surface: { ...descent.surface, xMin: 3, xMax: -3 },
    captions: Array.from({ length: 9 }, () => ({ when: 'true', text: 'x'.repeat(500) }))
  })
  assert.equal(messy.controls.length, 3)
  assert.deepEqual(
    { ...messy.controls[0] },
    { id: 'lr', label: 'Rate', min: 0, max: 1, step: 0.01, value: 1 }
  )
  assert.deepEqual([messy.surface.xMin, messy.surface.xMax], [-3, 3])
  // A start beyond the edge is pulled inside the map.
  const off = normalizeSpec({ ...descent, path: { ...descent.path, startX: 9, startY: -3 } })
  assert.ok(off.path.startX < 3 && off.path.startX > 2 && off.path.startY > -3)
  assert.equal(checkSpec(off), null)
  assert.equal(messy.captions.length, 5)
  assert.equal(messy.captions[0].text.length, 260)
})

const sigmoid: CurveSpec = {
  template: 'curve',
  title: 'Sigmoid steepness',
  intro: 'Raise k to sharpen the step.',
  controls: [{ id: 'k', label: 'Steepness', min: 0.5, max: 10, step: 0.5, value: 1 }],
  xMin: -6,
  xMax: 6,
  xLabel: 'input',
  yLabel: 'output',
  series: [{ label: 'sigmoid', y: '1 / (1 + exp(-k*x))' }],
  markers: [{ label: 'midpoint', x: '0' }],
  readouts: [{ label: 'Slope at 0', value: 'k / 4' }],
  captions: [
    { when: 'k > 5', text: 'Nearly a hard step.' },
    { when: 'true', text: 'A gentle S.' }
  ]
}

test('a curve is sampled, marked and described for the slider values', () => {
  const model = buildCurve(sigmoid)
  const [line] = model.lines({ k: 1 }, 12)
  assert.equal(line.ys.length, 13)
  assert.equal(line.ys[6], 0.5) // x = 0
  assert.deepEqual(model.markers({ k: 1 }), [{ label: 'midpoint', x: 0, y: 0.5 }])
  assert.equal(model.readouts({ k: 2 })[0].text, '0.5')
  assert.equal(model.caption({ k: 8 }), 'Nearly a hard step.')
  assert.equal(model.caption({ k: 1 }), 'A gentle S.')
  const [lo, hi] = curveRange(sigmoid, model)
  assert.ok(lo >= 0 && lo < 0.01 && hi > 0.99 && hi <= 1)
  assert.equal(checkSpec(sigmoid), null)
  assert.match(checkSpec({ ...sigmoid, series: [{ label: 'a', y: '2' }] }) ?? '', /flat/)
})

test('numbers are short enough to read at a glance', () => {
  assert.equal(formatNumber(0.123456), '0.123')
  assert.equal(formatNumber(12), '12')
  assert.equal(formatNumber(1234.5), '1230')
  assert.equal(formatNumber(0.00012), '1.2e-4')
  assert.equal(formatNumber(2500000), '2.5e6')
  assert.equal(formatNumber(Infinity), '∞')
  assert.equal(formatNumber(NaN), 'n/a')
})

test('a caption that needs two sliders at exact values counts as reachable', () => {
  const line: CurveSpec = {
    template: 'curve',
    title: 'Fit a line',
    intro: 'Match the target line.',
    controls: [
      { id: 'm', label: 'Slope', min: 0, max: 4, step: 0.1, value: 1 },
      { id: 'b', label: 'Intercept', min: -2, max: 4, step: 0.1, value: 0 }
    ],
    xMin: 0,
    xMax: 10,
    xLabel: 'x',
    yLabel: 'y',
    series: [
      { label: 'Yours', y: 'm*x + b' },
      { label: 'Target', y: '2*x + 1' }
    ],
    markers: [],
    readouts: [],
    captions: [
      { when: 'm == 2 && b == 1', text: 'A perfect match.' },
      { when: 'true', text: 'Keep adjusting.' }
    ]
  }
  assert.deepEqual(unreachableCaptions(line), [])
  assert.equal(storyProblem(line), null)
})

// Data from a gentle curve; the model only names the relationship and writes captions.
const overfit: FitFill = {
  title: 'Polynomial regression fit',
  intro: 'Raise the degree and compare the two errors.',
  xMin: 0,
  xMax: 10,
  xLabel: 'x',
  yLabel: 'y',
  truth: '5 + 2*sin(0.6*x)',
  points: 12,
  noise: 1,
  mode: 'degree',
  maxDegree: 9,
  penalty: true,
  captions: [
    { when: 'degree < bestDegree', text: 'Too simple: it misses the pattern.' },
    { when: 'degree == bestDegree', text: 'About right.' },
    { when: 'true', text: 'Too flexible: it chases the noise.' }
  ]
}

test('fit: the data never moves, whatever the sliders do', () => {
  const spec = tidyFit(overfit)
  const model = buildFit(spec)
  const before = JSON.stringify([model.train, model.test])
  for (let degree = 1; degree <= 9; degree++) {
    model.fitted({ degree, penalty: degree / 3 })
    model.outcome({ degree, penalty: degree / 3 })
  }
  assert.equal(JSON.stringify([model.train, model.test]), before)
  // The same spec always draws the same points.
  assert.equal(JSON.stringify(buildFit(tidyFit(overfit)).train), JSON.stringify(model.train))
  assert.equal(model.train.length, 12)
  assert.equal(model.test.length, 60)
  assert.ok(model.train.every((p) => p.x >= 0 && p.x <= 10 && Number.isFinite(p.y)))
})

test('fit: a real least-squares fit, so more freedom never fits the shown points worse', () => {
  const model = buildFit(tidyFit(overfit))
  const errors = [1, 2, 3, 5, 7, 9].map((degree) => model.outcome({ degree, penalty: 0 }))
  for (let i = 1; i < errors.length; i++) {
    assert.ok(errors[i].trainError <= errors[i - 1].trainError + 1e-9, `degree step ${i}`)
  }
  // ...while on fresh points the most flexible curve is not the best one.
  const last = errors[errors.length - 1]
  assert.ok(last.bestDegree < 9, `bestDegree ${last.bestDegree}`)
  assert.ok(last.testError > last.trainError)
  // A penalty reins the curve in: it fits the shown points less tightly.
  const free = model.outcome({ degree: 9, penalty: 0 })
  const held = model.outcome({ degree: 9, penalty: 3 })
  assert.ok(held.trainError > free.trainError)
  assert.equal(
    model.caption(model.outcome({ degree: 1, penalty: 0 })),
    'Too simple: it misses the pattern.'
  )
  assert.equal(model.caption(free), 'Too flexible: it chases the noise.')
  assert.equal(checkSpec(tidyFit(overfit)), null)
  assert.deepEqual(unreachableCaptions(tidyFit(overfit)), [])
})

test('fit: a straight-line relationship is recovered exactly when there is no noise', () => {
  const spec = tidyFit({ ...overfit, truth: '3 + 2*x', noise: 0, penalty: false, maxDegree: 4 })
  const model = buildFit(spec)
  const f = model.fitted({ degree: 1 })
  assert.ok(Math.abs(f(0) - 3) < 1e-9 && Math.abs(f(10) - 23) < 1e-9)
  assert.ok(model.outcome({ degree: 1 }).trainError < 1e-18)
})

test('fit: fitting a line by hand, with sliders sized to the data', () => {
  const spec = tidyFit({
    ...overfit,
    truth: '30 - 2.5*x',
    noise: 1.5,
    mode: 'line',
    captions: [
      { when: 'error < bestError * 1.1', text: 'As good as a straight line gets.' },
      { when: 'true', text: 'Keep adjusting.' }
    ]
  })
  assert.deepEqual(
    spec.controls.map((c) => c.id),
    ['slope', 'height']
  )
  const [slope, height] = spec.controls
  assert.equal(slope.value, 0) // starts flat, away from the answer
  assert.ok(slope.min < -2.5 && slope.max >= 0, `slope ${slope.min}..${slope.max}`)
  // The height is the line's value in the middle of the plot (x = 5), where it is 17.5.
  assert.ok(height.min < 10 && height.max > 25, `height ${height.min}..${height.max}`)

  const model = buildFit(spec)
  const start = model.outcome(defaults(spec))
  assert.ok(start.error > start.bestError * 2)
  // No line beats the least-squares one; the true line comes close to it.
  const near = model.outcome({ slope: -2.5, height: 17.5 })
  assert.ok(near.error >= near.bestError && near.error < near.bestError * 1.5)
  assert.equal(model.caption(start), 'Keep adjusting.')
  assert.equal(checkSpec(spec), null)
  // The best line is within reach of the sliders, so its caption can show.
  assert.deepEqual(unreachableCaptions(spec), [])
})

test('fit: a relationship that cannot be evaluated is reported, not drawn', () => {
  assert.match(
    checkSpec(tidyFit({ ...overfit, truth: 'log(x - 20)' })) ?? '',
    /truth is not a number/
  )
  assert.match(checkSpec(tidyFit({ ...overfit, truth: 'a*x' })) ?? '', /"a" is not available/)
  assert.match(checkSpec(tidyFit({ ...overfit, truth: '4', noise: 0 })) ?? '', /flat/)
  // Out-of-range choices are repaired, not rejected.
  const fixed = tidyFit({ ...overfit, points: 500, maxDegree: 40, noise: -1 })
  // Shown points are kept near the top degree, so too much freedom visibly overfits.
  assert.deepEqual([fixed.points, fixed.maxDegree, fixed.noise], [13, 9, 1])
  assert.equal(tidyFit({ ...overfit, mode: 'line', points: 500 }).points, 40)
})
