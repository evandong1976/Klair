import { useEffect, useRef, useState } from 'react'
import type { SelectionRect } from '../../../shared/types'
import { Key } from '../components/ui'
import { klair } from '../lib/useKlair'

// The selection overlay (⌘S in the panel): covers one display, dims it, and lets the
// user drag out an area. Letting go sends the rectangle to the main process, which
// captures that area at full resolution. esc, or a click without a drag, cancels.
// The window is excluded from screen capture, so the dimming never ends up in the shot.

type Point = { x: number; y: number }

const MIN = 8 // smaller than this is a click, not a selection
const DIM = 'rgba(45, 49, 40, 0.38)'

function toRect(a: Point, b: Point): SelectionRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  }
}

export function SelectWindow(): React.JSX.Element {
  // The window is reused between selections; finishing or cancelling clears the drag.
  // The drag lives in a ref so each mouse event sees it at once (state lags a render).
  // `shown` mirrors it for drawing.
  const drag = useRef<{ start: Point; end: Point } | null>(null)
  const [shown, setShown] = useState<{ start: Point; end: Point } | null>(null)
  const set = (d: { start: Point; end: Point } | null): void => {
    drag.current = d
    setShown(d)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      set(null)
      void klair.cancelSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const rect = shown ? toRect(shown.start, shown.end) : null
  const big = !!rect && rect.width >= MIN && rect.height >= MIN

  const finish = (): void => {
    const d = drag.current
    set(null)
    const r = d ? toRect(d.start, d.end) : null
    if (r && r.width >= MIN && r.height >= MIN) void klair.finishSelection(r)
    else void klair.cancelSelection()
  }

  return (
    <div
      className="fixed inset-0 cursor-crosshair select-none overflow-hidden"
      onMouseDown={(e) => {
        if (e.button !== 0) return
        const p = { x: e.clientX, y: e.clientY }
        set({ start: p, end: p })
      }}
      onMouseMove={(e) => {
        if (drag.current) set({ ...drag.current, end: { x: e.clientX, y: e.clientY } })
      }}
      onMouseUp={(e) => {
        if (!drag.current) return
        drag.current = { ...drag.current, end: { x: e.clientX, y: e.clientY } }
        finish()
      }}
    >
      {big && rect ? (
        <>
          {/* The clear window onto the screen; the shadow dims everything around it. */}
          <div
            className="absolute border-2 border-rose rounded-[3px] pointer-events-none"
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              boxShadow: `0 0 0 9999px ${DIM}`
            }}
          />
          <span
            className="absolute px-2 py-1 rounded-[8px] bg-white/90 text-ink text-[12px] font-bold font-mono pointer-events-none shadow-[0_2px_8px_rgba(45,49,40,0.18)]"
            style={{
              left: rect.x,
              top:
                rect.y + rect.height + 8 > window.innerHeight - 32
                  ? rect.y - 30
                  : rect.y + rect.height + 8
            }}
          >
            {`${Math.round(rect.width)} × ${Math.round(rect.height)}`}
          </span>
        </>
      ) : (
        <div className="absolute inset-0 pointer-events-none" style={{ background: DIM }} />
      )}

      {!shown ? (
        <div className="absolute left-1/2 top-[72px] -translate-x-1/2 flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-white/90 text-ink text-[14px] font-bold pointer-events-none shadow-[0_4px_16px_rgba(45,49,40,0.22)]">
          Drag to select an area for Klair
          <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-3">
            <Key variant="small">esc</Key> cancel
          </span>
        </div>
      ) : null}
    </div>
  )
}
