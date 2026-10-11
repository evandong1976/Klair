/**
 * Klair pixel flower: framework-neutral reference implementation.
 * Mirrors design/canvas/Flower.dc.html exactly; see design/DESIGN.md §3.
 *
 * The flower is a vector description sampled onto an N×N grid, so "more
 * defined" simply means a higher resolution:
 *   resting  → flowerPixels(11)  drawn at 4px cells = 44px
 *   open     → flowerPixels(30)  drawn at 4px cells = 120px
 *   in panel → flowerPixels(30)  drawn at 3px cells = 90px
 *   paused   → flowerPixels(11, { paused: true })   (greyscale)
 *
 * Bloom animation: bloomSteps(11, 30) → [11, 14, …, 29, 30], one step every 55ms.
 */

export type Pixel = string | null // CSS color, or null = transparent

export interface FlowerOptions {
  paused?: boolean
  /** Which flower to draw (Appearance setting). Defaults to the blush blossom. */
  style?: FlowerStyleId
}

export const FLOWER_COLORS = {
  center: '#EE8378',
  inner: '#F4A39B',
  crease: '#F8BDB7',
  petalMid: '#F9C9C4',
  petalOuter: '#FCDDDA',
  petalEdge: '#FFEEEC',
  budInner: '#F9C3BE',
  budOuter: '#FDE0DE',
  stem: '#9CAA77',
  leafShade: '#8A9868',
  leafLight: '#A9B583'
} as const

type Bloom = Record<
  'center' | 'inner' | 'crease' | 'petalMid' | 'petalOuter' | 'petalEdge' | 'budInner' | 'budOuter',
  string
>

/**
 * The flowers the user can pick from. Each is the same plant (stems and leaves are
 * shared) with its own petal count and bloom colours, so every size and the bloom
 * animation work unchanged.
 */
export const FLOWER_STYLES = {
  blossom: { label: 'Blossom', petals: 5, bloom: FLOWER_COLORS },
  buttercup: {
    label: 'Buttercup',
    petals: 6,
    bloom: {
      center: '#D9902F',
      inner: '#E8A93F',
      crease: '#F0C95A',
      petalMid: '#F6D873',
      petalOuter: '#F9E394',
      petalEdge: '#FCEEB8',
      budInner: '#F5D66E',
      budOuter: '#FAE7A2'
    }
  },
  marigold: {
    label: 'Marigold',
    petals: 8,
    bloom: {
      center: '#C2571B',
      inner: '#DD7A2B',
      crease: '#F0A04A',
      petalMid: '#F4B05C',
      petalOuter: '#F8C67F',
      petalEdge: '#FBDDAA',
      budInner: '#F5B869',
      budOuter: '#FAD79C'
    }
  },
  violet: {
    label: 'Violet',
    petals: 5,
    bloom: {
      center: '#7E5BB5',
      inner: '#9B7BCB',
      crease: '#B9A0DD',
      petalMid: '#C6B1E4',
      petalOuter: '#D9CBEE',
      petalEdge: '#EBE2F6',
      budInner: '#C9B6E6',
      budOuter: '#E1D6F2'
    }
  },
  bluebell: {
    label: 'Bluebell',
    petals: 4,
    bloom: {
      center: '#3F6FB5',
      inner: '#6C93CF',
      crease: '#93B2E0',
      petalMid: '#A9C3E8',
      petalOuter: '#C6D8F1',
      petalEdge: '#E1EBF8',
      budInner: '#B3CAEB',
      budOuter: '#D6E3F5'
    }
  }
} as const satisfies Record<string, { label: string; petals: number; bloom: Bloom }>

export type FlowerStyleId = keyof typeof FLOWER_STYLES
export const DEFAULT_FLOWER_STYLE: FlowerStyleId = 'blossom'
export const isFlowerStyle = (v: unknown): v is FlowerStyleId =>
  typeof v === 'string' && Object.hasOwn(FLOWER_STYLES, v)

type Style = { petals: number; bloom: Bloom }

const C = FLOWER_COLORS

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  const x = ax + t * dx - px
  const y = ay + t * dy - py
  return Math.sqrt(x * x + y * y)
}

/** Blossom centred at (cx, cy), radius R, rotated by rot radians, in the style's petals and colours. */
function blossom(
  u: number,
  v: number,
  cx: number,
  cy: number,
  R: number,
  rot: number,
  st: Style
): Pixel {
  const B = st.bloom
  const dx = u - cx
  const dy = v - cy
  const r = Math.sqrt(dx * dx + dy * dy) / R
  if (r > 1) return null
  const th = Math.atan2(dy, dx) - rot
  const lobe = Math.abs(Math.cos((th * st.petals) / 2))
  const edge = 0.38 + 0.62 * Math.pow(lobe, 0.6)
  if (r > edge) return null
  const rel = r / edge
  if (r < 0.14) return B.center
  if (r < 0.28) return B.inner
  if (lobe < 0.3 && rel > 0.25 && rel < 0.8) return B.crease
  if (rel < 0.55) return B.petalMid
  if (rel < 0.85) return B.petalOuter
  return B.petalEdge
}

/** Normalised ellipse distance (≤ 1 inside) or null when outside. */
function ellipse(
  u: number,
  v: number,
  cx: number,
  cy: number,
  a: number,
  b: number,
  ang: number
): number | null {
  const dx = u - cx
  const dy = v - cy
  const c = Math.cos(-ang)
  const s = Math.sin(-ang)
  const x = dx * c - dy * s
  const y = dx * s + dy * c
  const d = (x * x) / (a * a) + (y * y) / (b * b)
  return d <= 1 ? d : null
}

/** Lens-shaped leaf; shade on one side of the midrib, light on the other. */
function leaf(
  u: number,
  v: number,
  cx: number,
  cy: number,
  a: number,
  b: number,
  ang: number
): Pixel {
  const dx = u - cx
  const dy = v - cy
  const c = Math.cos(-ang)
  const s = Math.sin(-ang)
  const x = dx * c - dy * s
  const y = dx * s + dy * c
  if (Math.abs(x) > a) return null
  const half = b * (1 - (x * x) / (a * a))
  if (Math.abs(y) > half) return null
  return y < 0 ? C.leafShade : C.leafLight
}

const LEAVES: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [0.53, 0.81, 0.12, 0.045, 0.45],
  [0.24, 0.77, 0.1, 0.04, -0.55],
  [0.63, 0.63, 0.085, 0.035, -0.5]
]

const STEMS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.34, 0.98, 0.4, 0.74],
  [0.4, 0.74, 0.47, 0.56],
  [0.47, 0.56, 0.58, 0.36],
  [0.41, 0.7, 0.31, 0.56],
  [0.49, 0.52, 0.77, 0.57]
]

/** Colour at normalised point (u, v) ∈ [0,1]², drawn front to back. */
function sample(u: number, v: number, stemHalfWidth: number, st: Style): Pixel {
  const a = blossom(u, v, 0.62, 0.28, 0.22, -0.25, st)
  if (a) return a
  const b = blossom(u, v, 0.3, 0.54, 0.17, 0.45, st)
  if (b) return b
  const bud = ellipse(u, v, 0.83, 0.56, 0.075, 0.05, -0.25)
  if (bud !== null) return bud < 0.4 ? st.bloom.budInner : st.bloom.budOuter
  if (ellipse(u, v, 0.765, 0.57, 0.03, 0.035, 0) !== null) return C.leafShade // sepal
  for (const l of LEAVES) {
    const col = leaf(u, v, l[0], l[1], l[2], l[3], l[4])
    if (col) return col
  }
  for (const s of STEMS) {
    if (segDist(u, v, s[0], s[1], s[2], s[3]) < stemHalfWidth) return C.stem
  }
  return null
}

function toGrey(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const L = Math.round(0.3 * r + 0.59 * g + 0.11 * b)
  return `rgb(${L},${L},${Math.max(0, L - 4)})`
}

/** Row-major res×res pixel colours (null = transparent). res is clamped to 6–48. */
export function flowerPixels(res: number, opts: FlowerOptions = {}): Pixel[] {
  const N = Math.max(6, Math.min(48, Math.round(res)))
  const stemHalfWidth = Math.max(0.018, 0.6 / N) // keeps stems ≥ ~1px at low res
  const st = FLOWER_STYLES[opts.style ?? DEFAULT_FLOWER_STYLE]
  const out: Pixel[] = []
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      let c = sample((i + 0.5) / N, (j + 0.5) / N, stemHalfWidth, st)
      if (c && opts.paused) c = toGrey(c)
      out.push(c)
    }
  }
  return out
}

/** Resolution sequence for the bloom/shrink animation (default +3 per frame). */
export function bloomSteps(from: number, to: number, step = 3): number[] {
  const seq = [from]
  let r = from
  while (r !== to) {
    r = r < to ? Math.min(to, r + step) : Math.max(to, r - step)
    seq.push(r)
  }
  return seq
}

/** Draw onto a 2D canvas sized res*cell CSS px (scale for devicePixelRatio yourself). */
export function drawFlower(
  ctx: CanvasRenderingContext2D,
  res: number,
  cell: number,
  opts: FlowerOptions = {}
): void {
  const N = Math.max(6, Math.min(48, Math.round(res)))
  const px = flowerPixels(N, opts)
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, N * cell, N * cell)
  for (let k = 0; k < px.length; k++) {
    const c = px[k]
    if (!c) continue
    ctx.fillStyle = c
    ctx.fillRect((k % N) * cell, Math.floor(k / N) * cell, cell, cell)
  }
}
