import { createHash } from 'crypto'
import { desktopCapturer, screen, type Display, type NativeImage } from 'electron'
import type { SelectionRect } from '../shared/types'
import { activeWindow, type ActiveWindow } from './activewindow'

// Periodic screen capture with cheap local change detection. The screen is checked
// every interval, but a frame only counts as `changed` (and is stored, noted and
// offered ideas for) when it is a *meaningful* change, decided by ChangeDetector:
//   1. it differs substantially from the last *stored* frame (comparing with the stored
//      frame, not the previous tick, lets slow edits add up), and
//   2. the screen has stopped moving. Scrolling, video or a terminal printing output
//      differ on every tick; storing each of those would re-note the screen and
//      replace the ideas every few seconds. One settled screen is stored instead.
// Klair's own windows use setContentProtection(true), so they are excluded on macOS.

export interface Frame {
  at: Date
  png: Buffer
  hash: string // sha1 of the PNG (cache key)
  changed: boolean
  meta: ActiveWindow
}

// Measured on real pages (1440×900): switching pages or scrolling a line changes 17–45%
// of 64×40 cells; a moved pointer, a clock tick or the panel opening changes under 0.5%.
const THUMB_W = 64
const THUMB_H = 40
const CELL_DELTA = 24 // grey levels (0–255) a cell must move to count as changed
export const CHANGE_SHARE = 0.05 // share of cells that must change: "substantial"
export const SETTLE_SHARE = 0.02 // tick-to-tick change below this means the screen is still
export const MAX_MOVING_MS = 20_000 // a screen that never settles is still stored this often
const RECHECK_MS = 1000 // look again this soon while waiting for the screen to settle

function grey(img: NativeImage): Uint8Array {
  const small = img.resize({ width: THUMB_W, height: THUMB_H, quality: 'good' })
  const bgra = small.toBitmap()
  const out = new Uint8Array(THUMB_W * THUMB_H)
  for (let i = 0; i < out.length; i++) {
    const b = bgra[i * 4]
    const g = bgra[i * 4 + 1]
    const r = bgra[i * 4 + 2]
    out[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
  }
  return out
}

/** Share (0–1) of thumbnail cells whose grey level moved by more than CELL_DELTA. */
export function changedShare(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return 1
  let n = 0
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > CELL_DELTA) n++
  return n / a.length
}

/** same: nothing new. moving: different, but still changing. changed: store this frame. */
export type Change = 'same' | 'moving' | 'changed'

/** Decides which frames are a meaningful change. Pure, so it can be tested. */
export class ChangeDetector {
  private stored: Uint8Array | null = null // thumbnail of the last stored frame
  private storedMeta = ''
  private prev: Uint8Array | null = null // thumbnail of the previous tick
  private movingSince: number | null = null

  observe(g: Uint8Array, metaKey: string, now: number): Change {
    const prev = this.prev
    this.prev = g
    if (this.stored === null) return this.store(g, metaKey)
    const differs = changedShare(g, this.stored) >= CHANGE_SHARE || metaKey !== this.storedMeta
    if (!differs) {
      this.movingSince = null
      return 'same'
    }
    this.movingSince ??= now
    const still = prev !== null && changedShare(g, prev) < SETTLE_SHARE
    if (!still && now - this.movingSince < MAX_MOVING_MS) return 'moving'
    return this.store(g, metaKey)
  }

  private store(g: Uint8Array, metaKey: string): Change {
    this.stored = g
    this.storedMeta = metaKey
    this.movingSince = null
    return 'changed'
  }
}

export class CaptureLoop {
  private timer: NodeJS.Timeout | null = null
  private recheck: NodeJS.Timeout | null = null
  private detector = new ChangeDetector()
  private busy = false

  constructor(
    private intervalMs: number,
    private onFrame: (f: Frame) => Promise<void> | void,
    private onError: (err: Error) => void
  ) {}

  get running(): boolean {
    return this.timer !== null
  }

  start(): void {
    if (this.timer) return
    this.detector = new ChangeDetector()
    this.timer = setInterval(() => void this.tick(), this.intervalMs)
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.recheck) clearTimeout(this.recheck)
    this.timer = this.recheck = null
  }

  private async tick(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      const display = screen.getPrimaryDisplay()
      const scale = Math.min(1, 1440 / display.size.width)
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.round(display.size.width * scale),
          height: Math.round(display.size.height * scale)
        }
      })
      const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
      if (!src || src.thumbnail.isEmpty()) throw new Error('Screen capture returned nothing')
      const meta = await activeWindow()
      const g = grey(src.thumbnail)
      const metaKey = `${meta.appName}|${meta.windowTitle}|${meta.url}`
      const change = this.detector.observe(g, metaKey, Date.now())
      const changed = change === 'changed'
      // Waiting for the screen to settle: don't make the user wait a whole interval.
      if (change === 'moving' && this.timer && !this.recheck) {
        this.recheck = setTimeout(() => {
          this.recheck = null
          void this.tick()
        }, RECHECK_MS)
      }
      const png = changed ? src.thumbnail.toPNG() : Buffer.alloc(0)
      await this.onFrame({
        at: new Date(),
        png,
        hash: changed ? createHash('sha1').update(png).digest('hex') : '',
        changed,
        meta
      })
    } catch (err) {
      this.onError(err as Error)
    } finally {
      this.busy = false
    }
  }
}

/**
 * One area of a display at full (Retina) resolution, as PNG. `rect` is in the
 * display's points, relative to its top-left corner (the selection overlay's CSS px).
 */
export async function captureArea(display: Display, rect: SelectionRect): Promise<Buffer> {
  const sf = display.scaleFactor
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.size.width * sf),
      height: Math.round(display.size.height * sf)
    }
  })
  const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  if (!src || src.thumbnail.isEmpty()) throw new Error('Screen capture returned nothing')
  const img = src.thumbnail
  const size = img.getSize()
  // Pixels per point actually delivered (the thumbnail may come back smaller than asked).
  const k = size.width / display.size.width
  const x = Math.max(0, Math.round(rect.x * k))
  const y = Math.max(0, Math.round(rect.y * k))
  const width = Math.min(size.width - x, Math.round(rect.width * k))
  const height = Math.min(size.height - y, Math.round(rect.height * k))
  if (width < 1 || height < 1) throw new Error('The selected area is off screen')
  return img.crop({ x, y, width, height }).toPNG()
}
