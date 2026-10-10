import { createHash } from 'crypto'
import { desktopCapturer, screen, type NativeImage } from 'electron'
import { activeWindow, type ActiveWindow } from './activewindow'

// Periodic screen capture with cheap local change detection. Klair's own windows
// use setContentProtection(true), so they are excluded from these frames on macOS.

export interface Frame {
  at: Date
  png: Buffer
  hash: string // sha1 of the PNG (cache key)
  changed: boolean
  meta: ActiveWindow
}

const THUMB_W = 32
const THUMB_H = 20
const CHANGE_THRESHOLD = 4 // mean absolute grey difference (0–255) that counts as "changed"

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

function diff(a: Uint8Array, b: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}

export class CaptureLoop {
  private timer: NodeJS.Timeout | null = null
  private prevGrey: Uint8Array | null = null
  private prevMetaKey = ''
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
    this.prevGrey = null
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
        this.prevGrey === null ||
        diff(g, this.prevGrey) > CHANGE_THRESHOLD ||
        metaKey !== this.prevMetaKey
      this.prevGrey = g
      this.prevMetaKey = metaKey
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
