import { watch, type FSWatcher } from 'fs'
import { readdir, stat } from 'fs/promises'
import { join } from 'path'

// Watches the Downloads folder while a session observes and reports each finished
// download once. Browsers write to a temporary name (.crdownload, .part, .download)
// and rename it when done, so temporary names are skipped and a file only counts once
// its size has stopped changing. Files that were already there when watching started
// are never reported. All filesystem calls are async: on macOS the first read of
// ~/Downloads may wait on a permission prompt, and that must not block Klair.

export interface Download {
  path: string
  name: string
  size: number
  /** When the file appeared (birth time, else modified time), ms since epoch. */
  at: number
}

const TEMP = /\.(crdownload|part|partial|download|tmp|opdownload)$/i
const SETTLE_MS = 1500

export function isCandidate(name: string): boolean {
  return !name.startsWith('.') && !name.startsWith('~$') && !TEMP.test(name)
}

export class DownloadWatcher {
  private watcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null
  private since = 0
  private reported = new Set<string>()
  private sizes = new Map<string, number>()
  private scanning = false

  constructor(
    private dir: string,
    private onDownload: (d: Download) => void,
    private onError: (err: Error) => void = () => {},
    private settleMs = SETTLE_MS
  ) {}

  get running(): boolean {
    return this.watcher !== null
  }

  /** Report files that appear from now on. */
  start(now = Date.now()): void {
    if (this.watcher) return
    this.since = now
    try {
      this.watcher = watch(this.dir, { persistent: false }, () => this.schedule(300))
      this.watcher.on('error', (err) => this.onError(err))
    } catch (err) {
      this.onError(err as Error)
    }
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.sizes.clear()
  }

  private schedule(ms: number): void {
    if (!this.watcher) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.scan(), ms)
  }

  private async scan(): Promise<void> {
    if (this.scanning || !this.watcher) return
    this.scanning = true
    let unsettled = false
    try {
      for (const name of await readdir(this.dir)) {
        if (!isCandidate(name) || this.reported.has(name)) continue
        const path = join(this.dir, name)
        const st = await stat(path).catch(() => null)
        if (!st || !st.isFile() || st.size === 0) continue
        const at = st.birthtimeMs || st.mtimeMs
        if (at < this.since - 2000) continue // was there before the session
        // Report only once the size has held steady across two scans.
        if (this.sizes.get(name) !== st.size) {
          this.sizes.set(name, st.size)
          unsettled = true
          continue
        }
        this.sizes.delete(name)
        this.reported.add(name)
        this.onDownload({ path, name, size: st.size, at })
      }
    } catch (err) {
      this.onError(err as Error)
    } finally {
      this.scanning = false
    }
    if (unsettled) this.schedule(this.settleMs)
  }
}
