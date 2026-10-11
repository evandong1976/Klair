import { useEffect, useMemo, useRef, useState } from 'react'
import type { CurveSpec, ExplorableSpec, FitSpec, LandscapeSpec } from '../../../shared/blocks'
import {
  buildCurve,
  buildFit,
  buildLandscape,
  curveRange,
  defaults,
  fitRange,
  formatNumber,
  landscapeRange,
  type CurveModel,
  type FitModel,
  type LandscapeModel,
  type PathResult,
  type Told,
  type Values
} from '../../../shared/explorable'

// Interactive explainers ("explorables"). A model wrote the specification; everything
// here is Klair's own drawing code. Moving a slider re-evaluates the spec's expressions
// locally (shared/explorable.ts), so playing with one is instant and sends nothing.

export function Explorable({ spec }: { spec: ExplorableSpec }): React.JSX.Element {
  // The main process checks a spec before it is shown, so a failure here is rare
  // (an explainer saved by an older build, say). Say so plainly instead of drawing junk.
  const built = useMemo(() => {
    try {
      if (spec.template === 'landscape') {
        const model = buildLandscape(spec)
        return { kind: 'landscape' as const, spec, model, range: landscapeRange(spec, model) }
      }
      if (spec.template === 'fit') {
        const model = buildFit(spec)
        return { kind: 'fit' as const, spec, model, range: fitRange(model) }
      }
      const model = buildCurve(spec)
      return { kind: 'curve' as const, spec, model, range: curveRange(spec, model) }
    } catch (err) {
      return { kind: 'broken' as const, why: (err as Error).message }
    }
  }, [spec])

  if (built.kind === 'broken') {
    return (
      <p className="m-0 rounded-[14px] bg-white border border-line p-4 text-[14px] text-ink-2">
        This explainer can&apos;t be drawn. {built.why}
      </p>
    )
  }
  if (built.kind === 'landscape') {
    return <Landscape spec={built.spec} model={built.model} range={built.range} />
  }
  if (built.kind === 'fit') {
    return <Fit spec={built.spec} model={built.model} range={built.range} />
  }
  return <Curve spec={built.spec} model={built.model} range={built.range} />
}

// ---------------------------------------------------------------- shared layout

function Frame({
  intro,
  plot,
  side,
  caption,
  alarm = false
}: {
  intro: string
  plot: React.ReactNode
  side: React.ReactNode
  caption: string | null
  /** The thing being shown has gone wrong (a path that flew off): tint the caption. */
  alarm?: boolean
}): React.JSX.Element {
  return (
    <figure className="m-0 rounded-[18px] bg-white border border-line p-4 flex flex-col gap-3.5">
      <p className="m-0 text-[14px] leading-[1.5] text-ink-2 text-pretty">{intro}</p>
      <div className="flex flex-wrap gap-4">
        <div className="flex-[1_1_270px] min-w-0">{plot}</div>
        <div className="flex-[1_1_170px] min-w-0 flex flex-col gap-3.5">{side}</div>
      </div>
      <figcaption
        role="status"
        aria-live="polite"
        className={`min-h-[3.2em] rounded-[12px] border px-3 py-2.5 text-[14px] leading-[1.45] text-ink text-pretty ${
          alarm ? 'bg-blush-3 border-blush-line' : 'bg-sage-tint-2 border-sage-line'
        }`}
      >
        {caption ?? 'Move a slider to see what changes.'}
      </figcaption>
    </figure>
  )
}

const decimals = (step: number): number =>
  step >= 1 ? 0 : Math.min(4, Math.max(0, Math.ceil(-Math.log10(step))))

function Sliders({
  spec,
  values,
  onChange
}: {
  spec: ExplorableSpec
  values: Values
  onChange: (id: string, value: number) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {spec.controls.map((c) => (
        <label key={c.id} className="flex flex-col gap-1">
          <span className="flex items-baseline justify-between gap-2 text-[13px]">
            <span className="font-bold text-ink">{c.label}</span>
            <span className="tabular-nums font-semibold text-ink-2">
              {values[c.id].toFixed(decimals(c.step))}
            </span>
          </span>
          <input
            type="range"
            min={c.min}
            max={c.max}
            step={c.step}
            value={values[c.id]}
            onChange={(e) => onChange(c.id, parseFloat(e.target.value))}
            className="klair-slider w-full m-0"
            style={
              {
                '--fill': `${((values[c.id] - c.min) / (c.max - c.min)) * 100}%`
              } as React.CSSProperties
            }
          />
        </label>
      ))}
    </div>
  )
}

function Readouts({ items }: { items: Told[] }): React.JSX.Element | null {
  if (!items.length) return null
  return (
    <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[13px]">
      {items.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-muted">{r.label}</dt>
          <dd className="m-0 font-bold tabular-nums text-right text-ink">{r.text}</dd>
        </div>
      ))}
    </dl>
  )
}

function useValues(spec: ExplorableSpec): [Values, (id: string, value: number) => void] {
  const [values, setValues] = useState(() => defaults(spec))
  return [values, (id, value) => setValues((v) => ({ ...v, [id]: value }))]
}

// ---------------------------------------------------------------- landscape (3D surface)

const GRID = 34 // cells per side
const RELIEF = 0.9 // how tall the full height range stands, relative to half the map's width
const VIEW_3D = { yaw: -0.68, pitch: 0.62 } // radians; pitch is the camera's height above the horizon
const TOP_DOWN = Math.PI / 2

// Low ground is sage, high ground is rose: Klair's own palette, in bands like a contour map.
const STOPS: [number, [number, number, number]][] = [
  [0, [95, 115, 71]],
  [0.25, [156, 170, 119]],
  [0.5, [228, 233, 214]],
  [0.72, [252, 228, 226]],
  [1, [238, 131, 120]]
]
const BANDS = 12

function colour(t: number, shade: number): string {
  const banded = Math.min(1, Math.max(0, Math.round(t * BANDS) / BANDS))
  let k = 1
  while (k < STOPS.length - 1 && banded > STOPS[k][0]) k++
  const [t0, a] = STOPS[k - 1]
  const [t1, b] = STOPS[k]
  const f = (banded - t0) / (t1 - t0 || 1)
  const ch = (i: number): number => Math.round((a[i] + (b[i] - a[i]) * f) * shade)
  return `rgb(${Math.min(255, ch(0))},${Math.min(255, ch(1))},${Math.min(255, ch(2))})`
}

interface View {
  yaw: number
  pitch: number
}

function drawLandscape(
  canvas: HTMLCanvasElement,
  spec: LandscapeSpec,
  grid: Float64Array,
  range: [number, number],
  path: PathResult,
  view: View
): void {
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (!w || !h) return
  const dpr = window.devicePixelRatio || 1
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const { xMin, xMax, yMin, yMax } = spec.surface
  const [zMin, zMax] = range
  const scale = 0.31 * Math.min(w, h)
  const cx = w / 2
  const cy = h / 2
  const sinYaw = Math.sin(view.yaw)
  const cosYaw = Math.cos(view.yaw)
  const sinPitch = Math.sin(view.pitch)
  const cosPitch = Math.cos(view.pitch)
  const level = (z: number): number => Math.min(1.04, Math.max(-0.04, (z - zMin) / (zMax - zMin)))
  // u, v in [-1, 1] across the map; t in [0, 1] up the height range.
  const project = (u: number, v: number, t: number): [number, number, number] => {
    const X = u * cosYaw - v * sinYaw
    const Y = u * sinYaw + v * cosYaw
    const Z = (t - 0.5) * RELIEF
    return [cx + X * scale, cy - (Y * sinPitch + Z * cosPitch) * scale, Y * cosPitch - Z * sinPitch]
  }

  const n = GRID
  const side = n + 1
  const sx = new Float32Array(side * side)
  const sy = new Float32Array(side * side)
  const depth = new Float32Array(side * side)
  const lv = new Float32Array(side * side)
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const k = j * side + i
      lv[k] = level(grid[k])
      const p = project(-1 + (2 * i) / n, -1 + (2 * j) / n, lv[k])
      sx[k] = p[0]
      sy[k] = p[1]
      depth[k] = p[2]
    }
  }

  // Far cells first, so nearer ones paint over them.
  const cells: number[] = []
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * side + i
      if (
        Number.isFinite(grid[a]) &&
        Number.isFinite(grid[a + 1]) &&
        Number.isFinite(grid[a + side]) &&
        Number.isFinite(grid[a + side + 1])
      ) {
        cells.push(a)
      }
    }
  }
  const far = (a: number): number => depth[a] + depth[a + 1] + depth[a + side] + depth[a + side + 1]
  cells.sort((p, q) => far(q) - far(p))

  const cell = 2 / n
  ctx.lineWidth = 0.5
  ctx.strokeStyle = 'rgba(63, 74, 44, 0.16)'
  for (const a of cells) {
    const b = a + 1
    const c = a + side + 1
    const d = a + side
    // A little light from one side, so slopes read as slopes.
    const nx = -(lv[b] - lv[a]) * RELIEF * cell
    const ny = -(lv[d] - lv[a]) * RELIEF * cell
    const nz = cell * cell
    const lit = (nx * -0.45 + ny * -0.35 + nz * 0.82) / Math.hypot(nx, ny, nz)
    ctx.fillStyle = colour((lv[a] + lv[b] + lv[c] + lv[d]) / 4, 0.8 + 0.26 * Math.max(0, lit))
    ctx.beginPath()
    ctx.moveTo(sx[a], sy[a])
    ctx.lineTo(sx[b], sy[b])
    ctx.lineTo(sx[c], sy[c])
    ctx.lineTo(sx[d], sy[d])
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }

  // The path, lifted a touch so it sits on the surface. It is drawn up to the edge of
  // the map and no further.
  const toMap = (p: { x: number; y: number; z: number }): [number, number, number] => [
    (2 * (p.x - xMin)) / (xMax - xMin) - 1,
    (2 * (p.y - yMin)) / (yMax - yMin) - 1,
    level(p.z) + 0.012
  ]
  const onMap = (m: [number, number, number]): boolean => Math.abs(m[0]) <= 1 && Math.abs(m[1]) <= 1
  const dots: [number, number][] = []
  const line: [number, number][] = []
  let prev = toMap(path.points[0])
  if (onMap(prev)) {
    const first = project(...prev)
    line.push([first[0], first[1]])
    dots.push([first[0], first[1]])
    for (let i = 1; i < path.points.length; i++) {
      const next = toMap(path.points[i])
      if (!Number.isFinite(next[0]) || !Number.isFinite(next[1])) break
      if (onMap(next)) {
        const p = project(...next)
        line.push([p[0], p[1]])
        dots.push([p[0], p[1]])
        prev = next
        continue
      }
      // Leaving: stop where the segment crosses the edge.
      let s = 1
      for (const axis of [0, 1] as const) {
        const delta = next[axis] - prev[axis]
        if (delta > 0) s = Math.min(s, (1 - prev[axis]) / delta)
        else if (delta < 0) s = Math.min(s, (-1 - prev[axis]) / delta)
      }
      const edge = project(
        prev[0] + (next[0] - prev[0]) * s,
        prev[1] + (next[1] - prev[1]) * s,
        Math.min(1.04, prev[2] + (next[2] - prev[2]) * s)
      )
      line.push([edge[0], edge[1]])
      break
    }
  }
  if (line.length > 1) {
    const stroke = (width: number, style: string): void => {
      ctx.lineWidth = width
      ctx.strokeStyle = style
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      line.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.stroke()
    }
    stroke(4.5, 'rgba(255, 255, 255, 0.9)')
    stroke(1.8, '#2d3128')
  }
  const dot = (x: number, y: number, r: number, fill: string, ring: string): void => {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = fill
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = ring
    ctx.stroke()
  }
  if (dots.length <= 60)
    for (const [x, y] of dots.slice(1, -1)) dot(x, y, 2.1, '#ffffff', '#2d3128')
  if (dots.length) {
    dot(dots[0][0], dots[0][1], 4, '#ffffff', '#2d3128')
    // The end is only marked if the path is still on the map.
    const [ex, ey] = dots[dots.length - 1]
    if (dots.length > 1 && line.length === dots.length) dot(ex, ey, 4.5, '#2d3128', '#ffffff')
  }
}

function Landscape({
  spec,
  model,
  range
}: {
  spec: LandscapeSpec
  model: LandscapeModel
  range: [number, number]
}): React.JSX.Element {
  const [values, setValue] = useValues(spec)
  const [view, setView] = useState<View>(VIEW_3D)
  const [size, setSize] = useState(0)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)

  const grid = useMemo(() => model.grid(values, GRID), [model, values])
  const path = useMemo(() => model.path(values), [model, values])
  const scope = model.outcome(values, path)

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (canvas.current) drawLandscape(canvas.current, spec, grid, range, path, view)
  }, [spec, grid, range, path, view, size])

  const turn = (dYaw: number, dPitch: number): void =>
    setView((v) => ({
      yaw: v.yaw + dYaw,
      pitch: Math.min(TOP_DOWN, Math.max(0.3, v.pitch + dPitch))
    }))
  const topDown = view.pitch > TOP_DOWN - 0.02

  const viewButton = (label: string, on: boolean, go: () => void): React.JSX.Element => (
    <button
      type="button"
      aria-pressed={on}
      onClick={go}
      className={`h-[30px] px-3 rounded-[8px] border-0 text-[12.5px] cursor-pointer ${
        on
          ? 'bg-white font-bold text-ink shadow-[0_1px_3px_rgba(110,70,65,0.14)]'
          : 'bg-transparent font-semibold text-ink-2'
      }`}
    >
      {label}
    </button>
  )

  return (
    <Frame
      intro={spec.intro}
      alarm={path.diverged}
      caption={model.caption(scope)}
      plot={
        <div className="flex flex-col gap-2">
          <canvas
            ref={canvas}
            role="img"
            tabIndex={0}
            aria-label={`${spec.title}: a surface showing ${spec.surface.zLabel.toLowerCase()}, with a path of ${path.points.length - 1} steps${path.diverged ? ' that leaves the map' : ''}. Drag or use the arrow keys to turn it.`}
            className="w-full aspect-square max-h-[300px] rounded-[12px] bg-ground cursor-grab active:cursor-grabbing touch-none"
            onPointerDown={(e) => {
              drag.current = { x: e.clientX, y: e.clientY }
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => {
              if (!drag.current) return
              turn((e.clientX - drag.current.x) * 0.012, (e.clientY - drag.current.y) * 0.01)
              drag.current = { x: e.clientX, y: e.clientY }
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onKeyDown={(e) => {
              const step: Record<string, [number, number]> = {
                ArrowLeft: [-0.12, 0],
                ArrowRight: [0.12, 0],
                ArrowUp: [0, 0.1],
                ArrowDown: [0, -0.1]
              }
              if (!step[e.key] || e.metaKey || e.ctrlKey) return
              e.preventDefault()
              turn(...step[e.key])
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
              low
              <span
                aria-hidden="true"
                className="h-1.5 w-14 rounded-full"
                style={{
                  background: `linear-gradient(90deg, ${STOPS.map(
                    ([t, c]) => `rgb(${c.join(',')}) ${t * 100}%`
                  ).join(', ')})`
                }}
              />
              high {spec.surface.zLabel.toLowerCase()}
            </span>
            <span className="flex gap-0.5 p-0.5 rounded-[10px] bg-ground">
              {viewButton('3D', !topDown, () => setView(VIEW_3D))}
              {viewButton('Top', topDown, () => setView({ yaw: 0, pitch: TOP_DOWN }))}
            </span>
          </div>
        </div>
      }
      side={
        <>
          <Sliders spec={spec} values={values} onChange={setValue} />
          <Readouts items={model.readouts(scope)} />
          <span className="text-[12px] text-muted">Drag the surface to turn it.</span>
        </>
      }
    />
  )
}

// ---------------------------------------------------------------- curve

const LINE_COLOURS = ['#ee8378', '#56623f', '#4b5044']
const SAMPLES = 140

function Curve({
  spec,
  model,
  range
}: {
  spec: CurveSpec
  model: CurveModel
  range: [number, number]
}): React.JSX.Element {
  const [values, setValue] = useValues(spec)
  const W = 300
  const H = 230
  const pad = { left: 38, right: 10, top: 10, bottom: 30 }
  const [lo, hi] = range
  const X = (x: number): number =>
    pad.left + ((x - spec.xMin) / (spec.xMax - spec.xMin)) * (W - pad.left - pad.right)
  // The lines get a little air above and below. Values far outside the frame are pinned
  // just beyond it, so a spike can't wreck the path.
  const AIR = 0.08
  const Y = (y: number): number => {
    const t = Math.min(1.3, Math.max(-0.3, (y - lo) / (hi - lo)))
    return H - pad.bottom - (AIR + t * (1 - 2 * AIR)) * (H - pad.top - pad.bottom)
  }

  const lines = useMemo(() => model.lines(values, SAMPLES), [model, values])
  const paths = lines.map((line) => {
    let d = ''
    let pen = false
    for (let i = 0; i <= SAMPLES; i++) {
      const y = line.ys[i]
      if (!Number.isFinite(y)) {
        pen = false
        continue
      }
      const x = spec.xMin + ((spec.xMax - spec.xMin) * i) / SAMPLES
      d += `${pen ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(y).toFixed(1)} `
      pen = true
    }
    return d
  })
  const markers = model
    .markers(values)
    .filter((m) => Number.isFinite(m.y) && m.x >= spec.xMin && m.x <= spec.xMax)
  const zero = lo < 0 && hi > 0 ? Y(0) : null
  const tick = 'text-[10px] fill-muted'
  // An axis end that is zero for all practical purposes reads as 0, not 2.5e-13.
  const label = (v: number, span: number): string =>
    Math.abs(v) < Math.abs(span) * 1e-3 ? '0' : formatNumber(v)

  return (
    <Frame
      intro={spec.intro}
      caption={model.caption(values)}
      plot={
        <div className="flex flex-col gap-1.5">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`${spec.title}: ${spec.yLabel} against ${spec.xLabel}`}
            className="w-full rounded-[12px] bg-ground"
          >
            <clipPath id="klair-plot">
              <rect
                x={pad.left}
                y={pad.top}
                width={W - pad.left - pad.right}
                height={H - pad.top - pad.bottom}
              />
            </clipPath>
            {zero !== null ? (
              <line x1={pad.left} x2={W - pad.right} y1={zero} y2={zero} stroke="#e2d3d0" />
            ) : null}
            <line
              x1={pad.left}
              x2={W - pad.right}
              y1={H - pad.bottom}
              y2={H - pad.bottom}
              stroke="#c9d1b6"
            />
            <line x1={pad.left} x2={pad.left} y1={pad.top} y2={H - pad.bottom} stroke="#c9d1b6" />
            <g clipPath="url(#klair-plot)">
              {paths.map((d, i) => (
                <path
                  key={i}
                  d={d}
                  fill="none"
                  stroke={LINE_COLOURS[i % LINE_COLOURS.length]}
                  strokeWidth={i === 0 ? 2.4 : 1.8}
                  strokeDasharray={i === 0 ? undefined : '5 4'}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
              {markers.map((m) => (
                <circle
                  key={m.label}
                  cx={X(m.x)}
                  cy={Y(m.y)}
                  r={4.5}
                  fill="#2d3128"
                  stroke="#ffffff"
                  strokeWidth={1.5}
                />
              ))}
            </g>
            {markers.map((m) => (
              <text
                key={m.label}
                x={Math.min(W - pad.right - 4, X(m.x) + 8)}
                y={Math.max(pad.top + 10, Y(m.y) - 8)}
                textAnchor={X(m.x) > W * 0.7 ? 'end' : 'start'}
                className="text-[10.5px] font-semibold fill-ink"
              >
                {m.label}
              </text>
            ))}
            <text x={pad.left - 5} y={Y(hi) + 3} textAnchor="end" className={tick}>
              {label(hi, hi - lo)}
            </text>
            <text x={pad.left - 5} y={Y(lo) + 3} textAnchor="end" className={tick}>
              {label(lo, hi - lo)}
            </text>
            <text x={pad.left} y={H - pad.bottom + 12} textAnchor="middle" className={tick}>
              {label(spec.xMin, spec.xMax - spec.xMin)}
            </text>
            <text x={W - pad.right} y={H - pad.bottom + 12} textAnchor="end" className={tick}>
              {label(spec.xMax, spec.xMax - spec.xMin)}
            </text>
            <text
              x={(pad.left + W - pad.right) / 2}
              y={H - 6}
              textAnchor="middle"
              className="text-[10.5px] fill-ink-3"
            >
              {spec.xLabel}
            </text>
          </svg>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
            <span>{spec.yLabel}</span>
            {lines.map((line, i) => (
              <span key={line.label} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="w-4 h-0.5 rounded-full"
                  style={{ background: LINE_COLOURS[i % LINE_COLOURS.length] }}
                />
                {line.label}
              </span>
            ))}
          </div>
        </div>
      }
      side={
        <>
          <Sliders spec={spec} values={values} onChange={setValue} />
          <Readouts items={model.readouts(values)} />
        </>
      }
    />
  )
}

// ---------------------------------------------------------------- fit (data and a fitted model)

// The points are the model's own (shared/explorable.ts makes them once from a seed), so
// they stay exactly where they are while the fitted curve moves through them.

function Fit({
  spec,
  model,
  range
}: {
  spec: FitSpec
  model: FitModel
  range: [number, number]
}): React.JSX.Element {
  const [values, setValue] = useValues(spec)
  const W = 300
  const H = 230
  const pad = { left: 38, right: 10, top: 10, bottom: 30 }
  const [lo, hi] = range
  const AIR = 0.1
  const X = (x: number): number =>
    pad.left + ((x - spec.xMin) / (spec.xMax - spec.xMin)) * (W - pad.left - pad.right)
  // A wild curve is pinned a little way beyond the frame and clipped there.
  const Y = (y: number): number => {
    const t = Math.min(2, Math.max(-1, (y - lo) / (hi - lo)))
    return H - pad.bottom - (AIR + t * (1 - 2 * AIR)) * (H - pad.top - pad.bottom)
  }
  const line = spec.mode === 'line'

  const fitted = useMemo(() => model.fitted(values), [model, values])
  const scope = useMemo(() => model.outcome(values), [model, values])
  const path = (ys: (i: number) => number): string => {
    let d = ''
    for (let i = 0; i <= SAMPLES; i++) {
      const x = spec.xMin + ((spec.xMax - spec.xMin) * i) / SAMPLES
      const y = ys(i)
      if (Number.isFinite(y)) d += `${d ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(y).toFixed(1)} `
    }
    return d
  }
  const truth = useMemo(() => model.truth(SAMPLES), [model])
  const fittedPath = path((i) => fitted(spec.xMin + ((spec.xMax - spec.xMin) * i) / SAMPLES))
  // A dozen of the held-back points, spread across the plot, stand for "new data".
  const fresh = line ? [] : model.test.filter((_, i) => i % 5 === 2)
  const tick = 'text-[10px] fill-muted'
  const label = (v: number, span: number): string =>
    Math.abs(v) < Math.abs(span) * 1e-3 ? '0' : formatNumber(v)
  const key = (mark: React.ReactNode, text: string): React.JSX.Element => (
    <span className="flex items-center gap-1.5">
      {mark}
      {text}
    </span>
  )

  return (
    <Frame
      intro={spec.intro}
      caption={model.caption(scope)}
      plot={
        <div className="flex flex-col gap-1.5">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`${spec.title}: ${model.train.length} data points of ${spec.yLabel} against ${spec.xLabel}, with ${line ? 'a line set by hand' : 'a fitted curve'}`}
            className="w-full rounded-[12px] bg-ground"
          >
            <clipPath id="klair-fit-plot">
              <rect
                x={pad.left}
                y={pad.top}
                width={W - pad.left - pad.right}
                height={H - pad.top - pad.bottom}
              />
            </clipPath>
            <line
              x1={pad.left}
              x2={W - pad.right}
              y1={H - pad.bottom}
              y2={H - pad.bottom}
              stroke="#c9d1b6"
            />
            <line x1={pad.left} x2={pad.left} y1={pad.top} y2={H - pad.bottom} stroke="#c9d1b6" />
            <g clipPath="url(#klair-fit-plot)">
              {/* With a line set by hand, the true pattern is the thing to find: not shown. */}
              {line ? null : (
                <path
                  d={path((i) => truth[i])}
                  fill="none"
                  stroke="#9caa77"
                  strokeWidth={1.6}
                  strokeDasharray="5 4"
                />
              )}
              {/* How far the hand-set line is from each point: what "error" adds up. */}
              {line
                ? model.train.map((p, i) => (
                    <line
                      key={i}
                      x1={X(p.x)}
                      x2={X(p.x)}
                      y1={Y(p.y)}
                      y2={Y(fitted(p.x))}
                      stroke="#ee8378"
                      strokeWidth={1.2}
                      opacity={0.75}
                    />
                  ))
                : null}
              <path
                d={fittedPath}
                fill="none"
                stroke="#ee8378"
                strokeWidth={2.4}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {fresh.map((p, i) => (
                <circle
                  key={`n${i}`}
                  cx={X(p.x)}
                  cy={Y(p.y)}
                  r={3}
                  fill="none"
                  stroke="#686d60"
                  strokeWidth={1.1}
                  opacity={0.7}
                />
              ))}
              {model.train.map((p, i) => (
                <circle
                  key={i}
                  cx={X(p.x)}
                  cy={Y(p.y)}
                  r={3.6}
                  fill="#3f4a2c"
                  stroke="#ffffff"
                  strokeWidth={1.3}
                />
              ))}
            </g>
            <text x={pad.left - 5} y={Y(hi) + 3} textAnchor="end" className={tick}>
              {label(hi, hi - lo)}
            </text>
            <text x={pad.left - 5} y={Y(lo) + 3} textAnchor="end" className={tick}>
              {label(lo, hi - lo)}
            </text>
            <text x={pad.left} y={H - pad.bottom + 12} textAnchor="middle" className={tick}>
              {label(spec.xMin, spec.xMax - spec.xMin)}
            </text>
            <text x={W - pad.right} y={H - pad.bottom + 12} textAnchor="end" className={tick}>
              {label(spec.xMax, spec.xMax - spec.xMin)}
            </text>
            <text
              x={(pad.left + W - pad.right) / 2}
              y={H - 6}
              textAnchor="middle"
              className="text-[10.5px] fill-ink-3"
            >
              {spec.xLabel}
            </text>
          </svg>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
            <span>{spec.yLabel}</span>
            {key(
              <span aria-hidden="true" className="w-2 h-2 rounded-full bg-sage-deeper" />,
              'data'
            )}
            {fresh.length
              ? key(
                  <span
                    aria-hidden="true"
                    className="w-2 h-2 rounded-full border border-muted box-border"
                  />,
                  'new data'
                )
              : null}
            {key(
              <span aria-hidden="true" className="w-4 h-0.5 rounded-full bg-rose" />,
              line ? 'your line' : 'fitted curve'
            )}
            {line
              ? null
              : key(
                  <span
                    aria-hidden="true"
                    className="w-4 h-0 border-t-2 border-dashed border-sage"
                  />,
                  'true pattern'
                )}
          </div>
        </div>
      }
      side={
        <>
          <Sliders spec={spec} values={values} onChange={setValue} />
          <Readouts items={model.readouts(scope)} />
        </>
      }
    />
  )
}
