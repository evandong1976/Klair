import { createHash } from 'crypto'
import { desktopCapturer, screen, type NativeImage } from 'electron'
import { activeWindow, type ActiveWindow } from './activewindow'

// Periodic screen capture with cheap local change detection. The screen is checked
// every interval, but a frame only counts as `changed` (and is stored, noted and
// offered ideas for) when it differs substantially from the last *stored* frame:
// comparing with the stored frame, not the previous tick, lets slow edits (typing,
// gradual scrolling) add up instead of slipping under the threshold one tick at a time.
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

export class CaptureLoop {
  private timer: NodeJS.Timeout | null = null
  private storedGrey: Uint8Array | null = null // thumbnail of the last stored frame
  private storedMetaKey = ''
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
    this.storedGrey = null
    this.timer = setInterval(() => void this.tick(), this.intervalMs)
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
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
      const changed =
        this.storedGrey === null ||
        changedShare(g, this.storedGrey) >= CHANGE_SHARE ||
        metaKey !== this.storedMetaKey
      if (changed) {
        this.storedGrey = g
        this.storedMetaKey = metaKey
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
