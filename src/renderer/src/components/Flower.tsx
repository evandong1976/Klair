import { useEffect, useRef } from 'react'
import { drawFlower } from '../../../shared/flower'

// The pixel flower (DESIGN.md §3), drawn on a canvas so pixels stay crisp.
// Animate `res` with useBloom (lib/useBloom.ts) so it grows *and* gains detail.

export function Flower({
  res,
  cell,
  paused = false,
  size: shown,
  label = 'Klair is observing',
  className = ''
}: {
  res: number
  cell: number
  /** On-screen size in px. Defaults to res × cell; set it to change detail without changing size. */
  size?: number
  paused?: boolean
  label?: string
  className?: string
}): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const size = res * cell
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawFlower(ctx, res, cell, { paused })
  }, [res, cell, paused, size])
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      className={`pixelated block ${className}`}
      style={{ width: shown ?? size, height: shown ?? size }}
    />
  )
}
