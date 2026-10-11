import { compile, ExprError, isBuiltinName, type Scope } from './expr'
import type { CurveSpec, ExplorableSpec, FitFill, FitSpec, LandscapeSpec } from './blocks'

// The engine behind interactive explainers ("explorables"). A model fills in a small
// specification (blocks.ts); this turns it into numbers to draw: the heights of a
// surface, the points of a path, the readouts and the caption for the current slider
// values. The main process uses it to check a specification before showing it, and
// the panel uses it to redraw as a slider moves, so nothing is sent anywhere while
// the user plays.

export type Values = Record<string, number>

/** Names Klair provides inside expressions; a slider can't take one of them. */
const RESERVED = {
  landscape: ['x', 'y', 'z', 'z0', 'gx', 'gy', 'i', 'diverged'],
  curve: ['x'],
  fit: [] as string[] // a fit's sliders are Klair's own (degree, penalty, slope, intercept)
}
const MAX_STEPS = 200
const ID = /^[A-Za-z_Ͱ-Ͽ][A-Za-z0-9_Ͱ-Ͽ]*$/

export interface Told {
  label: string
  text: string
}

export function defaults(spec: ExplorableSpec): Values {
  return Object.fromEntries(spec.controls.map((c) => [c.id, c.value]))
}

export function formatNumber(v: number): string {
  if (Number.isNaN(v)) return 'n/a'
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '-∞'
  const a = Math.abs(v)
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(1).replace('e+', 'e')
  return String(parseFloat(v.toPrecision(3)))
}

// ---------------------------------------------------------------- tidying a model's spec

const clip = (s: unknown, n: number): string =>
  String(s ?? '')
    .trim()
    .slice(0, n)
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback
const ordered = (a: number, b: number): [number, number] =>
  a < b ? [a, b] : a > b ? [b, a] : [a - 1, a + 1]

const inset = (v: number, lo: number, hi: number): number =>
  Math.min(hi - (hi - lo) * 0.08, Math.max(lo + (hi - lo) * 0.08, v))

/** Trim over-long text and extra items, and repair slider ranges. Never throws. */
export function normalizeSpec<T extends ExplorableSpec>(spec: T): T {
  if (spec.template === 'fit') return tidyFit(spec) as T
  const controls = (spec.controls ?? []).slice(0, 3).map((c) => {
    const [min, max] = ordered(num(c.min, 0), num(c.max, 1))
    let step = num(c.step, 0)
    if (step <= 0 || step > max - min) step = (max - min) / 100
    return {
      id: clip(c.id, 24),
      label: clip(c.label, 40),
      min,
      max,
      step,
      value: Math.min(max, Math.max(min, num(c.value, min)))
    }
  })
  const common = {
    title: clip(spec.title, 80),
    intro: clip(spec.intro, 320),
    controls,
    readouts: (spec.readouts ?? [])
      .slice(0, 3)
      .map((r) => ({ label: clip(r.label, 32), value: clip(r.value, 400) })),
    captions: (spec.captions ?? [])
      .slice(0, 5)
      .map((c) => ({ when: clip(c.when, 400), text: clip(c.text, 260) }))
  }
  if (spec.template === 'landscape') {
    const [xMin, xMax] = ordered(num(spec.surface.xMin, -1), num(spec.surface.xMax, 1))
    const [yMin, yMax] = ordered(num(spec.surface.yMin, -1), num(spec.surface.yMax, 1))
    const out: LandscapeSpec = {
      template: 'landscape',
      ...common,
      surface: {
        f: clip(spec.surface.f, 400),
        xMin,
        xMax,
        yMin,
        yMax,
        zLabel: clip(spec.surface.zLabel, 24) || 'Height'
      },
      path: {
        // A start on or beyond the edge is pulled a little way inside.
        startX: inset(num(spec.path.startX, xMin), xMin, xMax),
        startY: inset(num(spec.path.startY, yMin), yMin, yMax),
        nextX: clip(spec.path.nextX, 400),
        nextY: clip(spec.path.nextY, 400),
        steps: clip(spec.path.steps, 400)
      }
    }
    return out as T
  }
  const [xMin, xMax] = ordered(num(spec.xMin, 0), num(spec.xMax, 1))
  const out: CurveSpec = {
    template: 'curve',
    ...common,
    xMin,
    xMax,
    xLabel: clip(spec.xLabel, 32),
    yLabel: clip(spec.yLabel, 32),
    series: (spec.series ?? [])
      .slice(0, 3)
      .map((s) => ({ label: clip(s.label, 32), y: clip(s.y, 400) })),
    markers: (spec.markers ?? [])
      .slice(0, 3)
      .map((m) => ({ label: clip(m.label, 28), x: clip(m.x, 400) }))
  }
  return out as T
}

// ---------------------------------------------------------------- shared pieces

function controlIds(spec: ExplorableSpec): string[] {
  const ids = spec.controls.map((c) => c.id)
  if (!ids.length) throw new ExprError('There must be at least one slider')
  for (const id of ids) {
    if (!ID.test(id)) throw new ExprError(`Slider id "${id}" must be a plain name such as lr`)
    if (RESERVED[spec.template].includes(id) || isBuiltinName(id)) {
      throw new ExprError(`Slider id "${id}" is a name Klair already uses; choose another`)
    }
  }
  if (new Set(ids).size !== ids.length) throw new ExprError('Two sliders share the same id')
  return ids
}

const holds = (v: number): boolean => v !== 0 && !Number.isNaN(v)

function tellers(
  spec: ExplorableSpec,
  variables: string[]
): {
  readouts(scope: Scope): Told[]
  captionIndex(scope: Scope): number
  caption(scope: Scope): string | null
} {
  const readouts = spec.readouts.map((r) => ({ label: r.label, f: compile(r.value, variables) }))
  const captions = spec.captions.map((c) => ({ text: c.text, when: compile(c.when, variables) }))
  const captionIndex = (scope: Scope): number => captions.findIndex((c) => holds(c.when(scope)))
  return {
    readouts: (scope) => readouts.map((r) => ({ label: r.label, text: formatNumber(r.f(scope)) })),
    captionIndex,
    caption: (scope) => captions[captionIndex(scope)]?.text ?? null
  }
}

/** The starting slider values, plus each slider pushed to either end. */
function probes(spec: ExplorableSpec): Values[] {
  const base = defaults(spec)
  const out = [base]
  for (const c of spec.controls) {
    out.push({ ...base, [c.id]: c.min }, { ...base, [c.id]: c.max })
  }
  return out
}

/** The 1st to 99th percentile of the finite values, so one spike can't flatten the rest. */
function robustRange(samples: number[]): [number, number] {
  const finite = samples.filter(Number.isFinite).sort((a, b) => a - b)
  if (!finite.length) return [0, 1]
  const lo = finite[Math.floor((finite.length - 1) * 0.01)]
  const hi = finite[Math.ceil((finite.length - 1) * 0.99)]
  return hi > lo ? [lo, hi] : [lo - 1, lo + 1]
}

// ---------------------------------------------------------------- landscape

export interface PathPoint {
  x: number
  y: number
  z: number
}

export interface PathResult {
  points: PathPoint[]
  /** The path flew off the map (or stopped being a number). */
  diverged: boolean
}

export interface LandscapeModel {
  /** Heights on an (n + 1) × (n + 1) grid, row by row from (xMin, yMin). */
  grid(values: Values, n: number): Float64Array
  stepCount(values: Values): number
  path(values: Values): PathResult
  /** What readouts and captions can refer to: the sliders plus how the path ended. */
  outcome(values: Values, path: PathResult): Scope
  readouts(scope: Scope): Told[]
  /** Which caption shows (its position in the spec), or -1 for none. */
  captionIndex(scope: Scope): number
  caption(scope: Scope): string | null
}

export function buildLandscape(spec: LandscapeSpec): LandscapeModel {
  const ids = controlIds(spec)
  const { xMin, xMax, yMin, yMax } = spec.surface
  if (!(xMin < xMax) || !(yMin < yMax)) throw new ExprError('The map has no area')
  const f = compile(spec.surface.f, ['x', 'y', ...ids])
  const stepVars = ['x', 'y', 'z', 'gx', 'gy', 'i', ...ids]
  const nextX = compile(spec.path.nextX, stepVars)
  const nextY = compile(spec.path.nextY, stepVars)
  const steps = compile(spec.path.steps, ids)
  const tell = tellers(spec, ['x', 'y', 'z', 'z0', 'diverged', ...ids])
  const width = xMax - xMin
  const depth = yMax - yMin
  // Slopes are measured, never written by the model: a wrong derivative was the one
  // mistake models made when asked to supply them.
  const hx = width * 1e-4
  const hy = depth * 1e-4

  const stepCount = (values: Values): number => {
    const n = Math.round(steps(values))
    return Number.isFinite(n) ? Math.min(MAX_STEPS, Math.max(0, n)) : 0
  }

  return {
    grid(values, n) {
      const out = new Float64Array((n + 1) * (n + 1))
      const scope: Scope = { ...values, x: 0, y: 0 }
      for (let j = 0; j <= n; j++) {
        scope.y = yMin + (depth * j) / n
        for (let i = 0; i <= n; i++) {
          scope.x = xMin + (width * i) / n
          out[j * (n + 1) + i] = f(scope)
        }
      }
      return out
    },
    stepCount,
    path(values) {
      const scope: Scope = { ...values, x: 0, y: 0, z: 0, gx: 0, gy: 0, i: 0 }
      const at = (x: number, y: number): number => {
        scope.x = x
        scope.y = y
        return f(scope)
      }
      let x = spec.path.startX
      let y = spec.path.startY
      let z = at(x, y)
      const points: PathPoint[] = [{ x, y, z }]
      let diverged = false
      const n = stepCount(values)
      for (let i = 0; i < n; i++) {
        const gx = (at(x + hx, y) - at(x - hx, y)) / (2 * hx)
        const gy = (at(x, y + hy) - at(x, y - hy)) / (2 * hy)
        Object.assign(scope, { x, y, z, gx, gy, i })
        const nx = nextX(scope)
        const ny = nextY(scope)
        if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
          diverged = true
          break
        }
        x = nx
        y = ny
        z = at(x, y)
        points.push({ x, y, z })
        // A full map-width beyond the edge counts as gone.
        const gone = x < xMin - width || x > xMax + width || y < yMin - depth || y > yMax + depth
        if (gone || !Number.isFinite(z)) {
          diverged = true
          break
        }
      }
      return { points, diverged }
    },
    outcome(values, path) {
      const end = path.points[path.points.length - 1]
      return {
        ...values,
        x: end.x,
        y: end.y,
        z: end.z,
        z0: path.points[0].z,
        diverged: path.diverged ? 1 : 0
      }
    },
    readouts: tell.readouts,
    captionIndex: tell.captionIndex,
    caption: tell.caption
  }
}

/** Height range across the slider extremes, so colours stay put while a slider moves. */
export function landscapeRange(spec: LandscapeSpec, model: LandscapeModel): [number, number] {
  const samples: number[] = []
  for (const v of probes(spec)) samples.push(...model.grid(v, 14))
  return robustRange(samples)
}

// ---------------------------------------------------------------- curve

export interface CurveModel {
  /** Each line sampled at n + 1 evenly spaced x from xMin to xMax. */
  lines(values: Values, n: number): { label: string; ys: Float64Array }[]
  markers(values: Values): { label: string; x: number; y: number }[]
  readouts(values: Values): Told[]
  captionIndex(values: Values): number
  caption(values: Values): string | null
}

export function buildCurve(spec: CurveSpec): CurveModel {
  const ids = controlIds(spec)
  if (!spec.series.length) throw new ExprError('There must be at least one line')
  if (!(spec.xMin < spec.xMax)) throw new ExprError('xMin must be less than xMax')
  const series = spec.series.map((s) => ({ label: s.label, y: compile(s.y, ['x', ...ids]) }))
  const markers = spec.markers.map((m) => ({ label: m.label, x: compile(m.x, ids) }))
  const tell = tellers(spec, ids)
  const width = spec.xMax - spec.xMin
  return {
    lines(values, n) {
      const scope: Scope = { ...values, x: 0 }
      return series.map((s) => {
        const ys = new Float64Array(n + 1)
        for (let i = 0; i <= n; i++) {
          scope.x = spec.xMin + (width * i) / n
          ys[i] = s.y(scope)
        }
        return { label: s.label, ys }
      })
    },
    markers(values) {
      return markers.map((m) => {
        const x = m.x(values)
        return { label: m.label, x, y: series[0].y({ ...values, x }) }
      })
    },
    readouts: (values) => tell.readouts(values),
    captionIndex: (values) => tell.captionIndex(values),
    caption: (values) => tell.caption(values)
  }
}

/** y range across the slider extremes, so the axes hold still while a slider moves. */
export function curveRange(spec: CurveSpec, model: CurveModel): [number, number] {
  const samples: number[] = []
  for (const v of probes(spec)) for (const line of model.lines(v, 60)) samples.push(...line.ys)
  return robustRange(samples)
}

// ---------------------------------------------------------------- fit (data and a fitted model)
//
// The one template where Klair does the computing as well as the drawing. The model
// names the relationship the data follows; Klair scatters points around it once (from
// a seed, so they are the same on every redraw and never move with a slider), fits by
// least squares, and measures the error on those points and on fresh ones.

export interface Point {
  x: number
  y: number
}

/** A small seeded generator, so an explainer's data is identical every time it is drawn. */
function seeded(seed: string): () => number {
  let h = 1779033703
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const gaussian = (rand: () => number): number =>
  Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())

/** Solve A·x = b by elimination with pivoting. A and b are overwritten. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r
    ;[A[col], A[pivot]] = [A[pivot], A[col]]
    ;[b[col], b[pivot]] = [b[pivot], b[col]]
    const d = A[col][col] || 1e-12
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / d
      if (!f) continue
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c]
      b[r] -= f * b[col]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let sum = b[r]
    for (let c = r + 1; c < n; c++) sum -= A[r][c] * x[c]
    x[r] = sum / (A[r][r] || 1e-12)
  }
  return x
}

/**
 * Least-squares polynomial through the points, in u (x rescaled to [-1, 1], which keeps
 * high degrees well behaved). `lambda` is a ridge penalty on every term but the constant.
 */
function polyfit(
  points: Point[],
  degree: number,
  lambda: number,
  u: (x: number) => number
): number[] {
  const m = degree + 1
  const A = Array.from({ length: m }, () => new Array<number>(m).fill(0))
  const b = new Array<number>(m).fill(0)
  const pw = new Array<number>(m)
  for (const p of points) {
    pw[0] = 1
    for (let k = 1; k < m; k++) pw[k] = pw[k - 1] * u(p.x)
    for (let i = 0; i < m; i++) {
      b[i] += pw[i] * p.y
      for (let j = 0; j < m; j++) A[i][j] += pw[i] * pw[j]
    }
  }
  for (let i = 1; i < m; i++) A[i][i] += lambda
  return solve(A, b)
}

const polyval = (coefficients: number[], u: number): number =>
  coefficients.reduceRight((acc, c) => acc * u + c, 0)

const meanSquaredError = (points: Point[], f: (x: number) => number): number =>
  points.reduce((sum, p) => sum + (f(p.x) - p.y) ** 2, 0) / points.length

const nice = (v: number): number => Number(v.toPrecision(2))

/** The least-squares straight line, as a slope and its height at the middle of the plot. */
function bestLineOf(
  points: Point[],
  xMin: number,
  xMax: number
): { slope: number; height: number } {
  const mid = (xMin + xMax) / 2
  const c = polyfit(points, 1, 0, (x) => (2 * (x - mid)) / (xMax - xMin))
  return { slope: (2 * c[1]) / (xMax - xMin), height: c[0] }
}

/** How many fresh points the fit is tested on: enough for a steady error. */
const TEST_POINTS = 60

function fitData(
  spec: FitFill,
  truth: (scope: Scope) => number
): { train: Point[]; test: Point[] } {
  const rand = seeded(`${spec.title}|${spec.truth}|${spec.points}|${spec.noise}`)
  const width = spec.xMax - spec.xMin
  const sample = (n: number): Point[] =>
    Array.from({ length: n }, (_, i) => {
      // Spread across the range with a little jitter, so no two runs of points line up.
      const x = spec.xMin + ((i + 0.2 + 0.6 * rand()) / n) * width
      return { x, y: truth({ x }) + spec.noise * gaussian(rand) }
    })
  return { train: sample(spec.points), test: sample(TEST_POINTS) }
}

/**
 * Tidy what the model filled in and derive the sliders, which for a fit are Klair's:
 * a degree (and optional penalty), or a slope and intercept sized to the data. Never throws.
 */
export function tidyFit(spec: FitFill | FitSpec): FitSpec {
  const [xMin, xMax] = ordered(num(spec.xMin, 0), num(spec.xMax, 10))
  const fill: FitFill = {
    title: clip(spec.title, 80),
    intro: clip(spec.intro, 320),
    captions: (spec.captions ?? [])
      .slice(0, 5)
      .map((c) => ({ when: clip(c.when, 400), text: clip(c.text, 260) })),
    xMin,
    xMax,
    xLabel: clip(spec.xLabel, 32),
    yLabel: clip(spec.yLabel, 32),
    truth: clip(spec.truth, 400),
    points: Math.min(40, Math.max(8, Math.round(num(spec.points, 16)))),
    noise: Math.abs(num(spec.noise, 1)),
    mode: spec.mode === 'line' ? 'line' : 'degree',
    maxDegree: Math.min(9, Math.max(2, Math.round(num(spec.maxDegree, 8)))),
    penalty: spec.penalty === true
  }
  // Overfitting only shows when the curve has nearly as much freedom as there are points
  // (measured: with 20 points a degree-9 curve tests no worse than a degree-2 one; with
  // 12 it is seven times worse). So the shown points are kept close to the top degree.
  if (fill.mode === 'degree') fill.points = Math.min(fill.points, fill.maxDegree + 4)
  let controls: FitSpec['controls']
  if (fill.mode === 'degree') {
    controls = [
      { id: 'degree', label: 'Degree of the curve', min: 1, max: fill.maxDegree, step: 1, value: 1 }
    ]
    if (fill.penalty) {
      controls.push({
        id: 'penalty',
        label: 'Penalty strength',
        min: 0,
        max: 3,
        step: 0.05,
        value: 0
      })
    }
  } else {
    // A hand-set line is a slope and a height, the height taken at the middle of the plot.
    // (Taken at x = 0, the classic intercept, the two sliders fight each other: every
    // change of slope swings the line away from the points and the height has to chase it.)
    // Sized from the data, when the relationship can be evaluated; a broken one is
    // reported by checkSpec, and these defaults are never seen.
    let slope = { min: -5, max: 5, step: 0.05, value: 0 }
    let height = { min: -10, max: 10, step: 0.1, value: 0 }
    try {
      const { train } = fitData(fill, compile(fill.truth, ['x']))
      const ys = train.map((p) => p.y).filter(Number.isFinite)
      const lo = Math.min(...ys)
      const hi = Math.max(...ys)
      const span = hi - lo || 1
      const best = bestLineOf(train, xMin, xMax).slope
      const reach = Math.max(Math.abs(best) * 2, span / (xMax - xMin))
      const sMin = nice(Math.min(0, best) - reach)
      const sMax = nice(Math.max(0, best) + reach)
      // The start is a flat line through the average: the "no relationship" guess.
      slope = { min: sMin, max: sMax, step: nice((sMax - sMin) / 200), value: 0 }
      const range = { min: nice(lo - span * 0.3), max: nice(hi + span * 0.3) }
      const step = nice((range.max - range.min) / 200)
      const mean = ys.reduce((a, b) => a + b, 0) / ys.length
      height = { ...range, step, value: snap({ ...range, step }, mean) }
    } catch {
      /* keep the defaults */
    }
    controls = [
      { id: 'slope', label: 'Slope', ...slope },
      { id: 'height', label: 'Height', ...height }
    ]
  }
  return { template: 'fit', ...fill, controls, readouts: [] }
}

export interface FitModel {
  /** The data points. Fixed for the life of the explainer: no slider moves them. */
  train: Point[]
  /** Fresh points from the same relationship, kept back to test the fit on. */
  test: Point[]
  /** The best straight line through the shown points. */
  best: { slope: number; height: number }
  /** The relationship the data came from, sampled at n + 1 evenly spaced x. */
  truth(n: number): Float64Array
  /** The fitted (or hand-set) model for these slider values. */
  fitted(values: Values): (x: number) => number
  /** What captions can refer to: the sliders, plus the errors Klair measured. */
  outcome(values: Values): Scope
  readouts(scope: Scope): Told[]
  captionIndex(scope: Scope): number
  caption(scope: Scope): string | null
}

export function buildFit(spec: FitSpec): FitModel {
  if (!(spec.xMin < spec.xMax)) throw new ExprError('xMin must be less than xMax')
  const truth = compile(spec.truth, ['x'])
  const { train, test } = fitData(spec, truth)
  const line = spec.mode === 'line'
  const tell = tellers(
    spec,
    line
      ? ['slope', 'height', 'error', 'bestError']
      : ['degree', 'penalty', 'trainError', 'testError', 'bestDegree']
  )
  const mid = (spec.xMin + spec.xMax) / 2
  const width = spec.xMax - spec.xMin
  const u = (x: number): number => (2 * (x - mid)) / width
  // The penalty slider is gentle at first and strong by its end.
  const lambda = (penalty: number): number =>
    (train.length * (Math.exp(Math.max(0, penalty || 0)) - 1)) / 20
  const polynomial = (degree: number, penalty: number): ((x: number) => number) => {
    const d = Math.min(spec.maxDegree, Math.max(1, Math.round(degree) || 1))
    const c = polyfit(train, d, lambda(penalty), u)
    return (x) => polyval(c, u(x))
  }
  const best = bestLineOf(train, spec.xMin, spec.xMax)
  const bestError = meanSquaredError(train, (x) => best.height + best.slope * (x - mid))

  const fitted = (values: Values): ((x: number) => number) =>
    line
      ? (x) => values.height + values.slope * (x - mid)
      : polynomial(values.degree, values.penalty ?? 0)

  return {
    train,
    test,
    best,
    truth(n) {
      const out = new Float64Array(n + 1)
      for (let i = 0; i <= n; i++) out[i] = truth({ x: spec.xMin + (width * i) / n })
      return out
    },
    fitted,
    outcome(values) {
      if (line) {
        return { ...values, error: meanSquaredError(train, fitted(values)), bestError }
      }
      const penalty = values.penalty ?? 0
      let bestDegree = 1
      let lowest = Infinity
      for (let d = 1; d <= spec.maxDegree; d++) {
        const e = meanSquaredError(test, polynomial(d, penalty))
        if (e < lowest) {
          lowest = e
          bestDegree = d
        }
      }
      const f = fitted(values)
      return {
        ...values,
        penalty,
        trainError: meanSquaredError(train, f),
        testError: meanSquaredError(test, f),
        bestDegree
      }
    },
    readouts(scope) {
      return line
        ? [
            { label: 'Your error', text: formatNumber(scope.error) },
            { label: 'Lowest possible', text: formatNumber(scope.bestError) }
          ]
        : [
            { label: 'Error on these points', text: formatNumber(scope.trainError) },
            { label: 'Error on new points', text: formatNumber(scope.testError) }
          ]
    },
    captionIndex: tell.captionIndex,
    caption: tell.caption
  }
}

/** y range that holds the data and the relationship, fixed while sliders move. */
export function fitRange(model: FitModel): [number, number] {
  return robustRange([
    ...model.train.map((p) => p.y),
    ...model.test.map((p) => p.y),
    ...model.truth(60)
  ])
}

// ---------------------------------------------------------------- checking a spec

/** How far apart the smallest and largest finite values are (0 when all the same). */
const spread = (values: ArrayLike<number>): number => {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (!Number.isFinite(v)) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return hi > lo ? hi - lo : 0
}

const finiteShare = (values: ArrayLike<number>): number => {
  let n = 0
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) n++
  return values.length ? n / values.length : 0
}

// ---------------------------------------------------------------- can the sliders tell a story?

/** For one setting of the sliders: which caption shows, and (for a landscape) how the path ended. */
function watcher(spec: ExplorableSpec): (values: Values) => { caption: number; note: string } {
  if (spec.template === 'curve') {
    const model = buildCurve(spec)
    return (values) => ({ caption: model.captionIndex(values), note: '' })
  }
  if (spec.template === 'fit') {
    const model = buildFit(spec)
    return (values) => {
      const scope = model.outcome(values)
      const seen = Object.entries(scope)
        .filter(([k]) => !(k in values))
        .map(([k, v]) => `${k} = ${formatNumber(v)}`)
      return { caption: model.captionIndex(scope), note: seen.join(', ') }
    }
  }
  const model = buildLandscape(spec)
  return (values) => {
    const end = model.outcome(values, model.path(values))
    return {
      caption: model.captionIndex(end),
      note: `the path ends at z = ${formatNumber(end.z)} (it started at ${formatNumber(end.z0)}), diverged = ${end.diverged}`
    }
  }
}

type Control = ExplorableSpec['controls'][number]

/** The nearest value the slider can land on, written the way a range input reports it. */
function snap(c: Pick<Control, 'min' | 'max' | 'step'>, v: number): number {
  const digits = Math.max(decimalsOf(c.step), decimalsOf(c.min))
  const k = Math.round((Math.min(c.max, Math.max(c.min, v)) - c.min) / c.step)
  return Math.min(c.max, Number((c.min + k * c.step).toFixed(digits)))
}

/** How many decimals a number is written with (0.05 → 2), up to 8. */
function decimalsOf(v: number): number {
  for (let d = 0; d < 8; d++) {
    if (Math.abs(v * 10 ** d - Math.round(v * 10 ** d)) < 1e-9) return d
  }
  return 8
}

/**
 * Values a slider can actually land on (its own steps, written the way a range input
 * reports them), thinned to about `count` and always including both ends and the start.
 * Sampling the real stops means a condition such as "m == 2" is judged as the user
 * would meet it.
 */
function stops(c: Control, count: number): number[] {
  const last = Math.max(1, Math.round((c.max - c.min) / c.step))
  const picks = new Set<number>([0, last, Math.round((c.value - c.min) / c.step)])
  const n = Math.min(count, last + 1)
  for (let i = 0; i < n; i++) picks.add(Math.round((last * i) / Math.max(1, n - 1)))
  return [...picks]
    .filter((k) => k >= 0 && k <= last)
    .sort((x, y) => x - y)
    .map((k) => snap(c, c.min + k * c.step))
}

/**
 * Slider settings to try: a grid over every combination of sliders (a caption may need
 * two of them), plus each slider swept finely with the others at their starting values.
 * A landscape walks a whole path per setting, so it gets a smaller grid than a curve.
 */
function settings(spec: ExplorableSpec): Values[] {
  const budget = spec.template === 'curve' ? 4000 : spec.template === 'fit' ? 600 : 400
  const per = Math.max(3, Math.floor(Math.pow(budget, 1 / spec.controls.length)))
  let grid: Values[] = [{}]
  for (const c of spec.controls) {
    grid = grid.flatMap((g) => stops(c, per).map((v) => ({ ...g, [c.id]: v })))
  }
  const base = defaults(spec)
  for (const c of spec.controls) {
    for (const v of stops(c, 60)) grid.push({ ...base, [c.id]: v })
  }
  // For a line set by hand, "you found the best line" is true in one small spot that a
  // grid can step over: try the nearest the sliders can get to it.
  if (spec.template === 'fit' && spec.mode === 'line') {
    const { best } = buildFit(spec)
    const [slope, height] = spec.controls
    grid.push({ slope: snap(slope, best.slope), height: snap(height, best.height) })
  }
  return grid
}

/** Captions (by position) that no slider setting ever shows. Empty if the spec can't be built. */
export function unreachableCaptions(spec: ExplorableSpec): number[] {
  try {
    const watch = watcher(spec)
    const shown = new Set(settings(spec).map((v) => watch(v).caption))
    return spec.captions.map((_, i) => i).filter((i) => !shown.has(i))
  } catch {
    return []
  }
}

/** What the model is told when captions can't be reached, with what was seen at the ends. */
export function unreachableReport(spec: ExplorableSpec, dead: number[]): string {
  const watch = watcher(spec)
  const base = defaults(spec)
  const ends = spec.controls.flatMap((c) =>
    [c.min, c.max].map((value) => {
      const note = watch({ ...base, [c.id]: value }).note
      return note ? `With ${c.id} = ${formatNumber(value)}, ${note}.` : ''
    })
  )
  const which = dead.map((i) => `"${spec.captions[i].when}"`).join(', ')
  return `No slider setting ever shows the caption${dead.length > 1 ? 's' : ''} with condition ${which}. Widen a slider's range until it reaches that regime, or fix the condition. ${ends.filter(Boolean).join(' ')}`.trim()
}

/** The same spec without captions that can never show. */
export function withoutCaptions<T extends ExplorableSpec>(spec: T, dead: number[]): T {
  return { ...spec, captions: spec.captions.filter((_, i) => !dead.includes(i)) }
}

/**
 * Models are poor at the arithmetic of where a regime begins: asked for a learning-rate
 * slider that reaches "too large", they often stop just short of it. When a caption can
 * never show, try stretching one slider's top end until it can. A wider range costs
 * nothing and saves a second model call.
 */
export function widenToReach<T extends ExplorableSpec>(spec: T): T {
  if (spec.template === 'fit') return spec // its sliders are Klair's, already sized to the data
  const dead = unreachableCaptions(spec)
  if (!dead.length) return spec
  for (const factor of [1.25, 1.5, 2, 3, 4]) {
    for (let i = 0; i < spec.controls.length; i++) {
      const max = spec.controls[i].max
      if (!(max > 0)) continue
      const wider = {
        ...spec,
        controls: spec.controls.map((c, j) =>
          j === i ? { ...c, max: Number((max * factor).toPrecision(2)) } : c
        )
      }
      if (unreachableCaptions(wider).length < dead.length && !checkSpec(wider)) return wider
    }
  }
  return spec
}

/**
 * A drawable explainer whose caption never changes is worth one more try: the sliders
 * should reach more than one regime. It is not a reason to show nothing, though. The
 * picture still responds to the sliders, so the caller falls back to it if the second
 * try is no better.
 */
export function storyProblem(spec: ExplorableSpec): string | null {
  if (spec.captions.length < 2) return null
  const dead = unreachableCaptions(spec)
  if (spec.captions.length - dead.length > 1) return null
  return `Moving the sliders across their ranges only ever shows one caption, so there is nothing to discover. ${unreachableReport(spec, dead)}`
}

/**
 * Can this specification be drawn at all? Returns what is wrong, worded so the model
 * can fix it on a second try, or null when it can. (Whether it tells a good story is
 * storyProblem's question.)
 */
export function checkSpec(spec: ExplorableSpec): string | null {
  try {
    const start = defaults(spec)
    if (spec.template === 'landscape') {
      const model = buildLandscape(spec)
      for (const v of probes(spec)) {
        if (finiteShare(model.grid(v, 10)) < 0.9) {
          return 'surface.f is not a number over much of the map at some slider settings. Keep it defined everywhere on the map.'
        }
      }
      if (!(spread(model.grid(start, 10)) > 1e-9)) {
        return 'surface.f is flat. It must vary across the map.'
      }
      const { xMin, xMax, yMin, yMax } = spec.surface
      const { startX, startY } = spec.path
      if (startX < xMin || startX > xMax || startY < yMin || startY > yMax) {
        return 'path.startX and path.startY must be inside the map.'
      }
      if (model.stepCount(start) < 1) {
        return 'path.steps is 0 at the starting slider values. Start with enough steps to see the path.'
      }
      const path = model.path(start)
      const first = path.points[0]
      if (path.points.every((p) => p.x === first.x && p.y === first.y)) {
        return 'The path does not move. Check path.nextX and path.nextY.'
      }
      // Leaving the map in the end can be the point (sliding off a saddle). Leaving it
      // straight away means the starting values show nothing.
      const inside = path.points.findIndex(
        (p) => p.x < xMin || p.x > xMax || p.y < yMin || p.y > yMax
      )
      if (inside !== -1 && inside < Math.min(4, path.points.length)) {
        return `With the starting slider values the path starts at (${formatNumber(startX)}, ${formatNumber(startY)}) and has left the map after ${inside} step${inside === 1 ? '' : 's'}. Start it where the surface is gentler, or take smaller steps, so it stays on the map for a while; let other slider values show it going wrong.`
      }
      const scope = model.outcome(start, path)
      model.readouts(scope)
      model.caption(scope)
      return null
    }
    if (spec.template === 'fit') {
      const model = buildFit(spec)
      if (finiteShare(model.truth(60)) < 1) {
        return 'truth is not a number everywhere between xMin and xMax. Keep it defined across the whole range.'
      }
      if (!(spread(model.train.map((p) => p.y)) > 1e-9)) {
        return 'The data is flat. Give truth a shape, or the points some noise.'
      }
      const scope = model.outcome(start)
      model.readouts(scope)
      model.caption(scope)
      return null
    }
    const model = buildCurve(spec)
    for (const v of probes(spec)) {
      for (const line of model.lines(v, 50)) {
        if (finiteShare(line.ys) < 0.9) {
          return `The line "${line.label}" is not a number over much of the x range at some slider settings. Keep it defined from xMin to xMax.`
        }
      }
    }
    if (!model.lines(start, 50).some((l) => spread(l.ys) > 1e-9)) {
      return 'Every line is flat. At least one must vary with x.'
    }
    model.markers(start)
    model.readouts(start)
    model.caption(start)
    return null
  } catch (err) {
    return err instanceof ExprError
      ? err.message
      : `The specification could not be used: ${(err as Error).message}`
  }
}
