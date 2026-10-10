import { join } from 'path'
import { app } from 'electron'

// Optional native addon (native/fn-key) that reports taps of the fn/globe key via a
// CGEventTap. Electron's globalShortcut cannot bind fn on its own. If the addon isn't
// built, or Input Monitoring isn't granted, Klair falls back to ⌃⌥K / ⌃⌥P / ⌃⌥Q.
//
// Addon contract: start(cb: (event: 'tap' | 'chord', key?: string) => void): boolean; stop(): void
//   'tap'   → fn pressed and released with no other key
//   'chord' → fn held while `key` ('p' | 'q') was pressed

interface FnAddon {
  start(cb: (event: 'tap' | 'chord', key?: string) => void): boolean
  stop(): void
}

let addon: FnAddon | null = null
let status: { loaded: boolean; running: boolean; detail: string } = {
  loaded: false,
  running: false,
  detail: 'Not loaded'
}

export function startFnKey(handlers: {
  onTap: () => void
  onChord: (key: string) => void
}): typeof status {
  if (process.platform !== 'darwin') {
    status = { loaded: false, running: false, detail: 'fn key capture is macOS-only' }
    return status
  }
  try {
    const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    addon = require(join(base, 'native', 'fn-key', 'build', 'Release', 'fn_key.node')) as FnAddon
  } catch {
    status = {
      loaded: false,
      running: false,
      detail: 'fn add-on not built (pnpm build:native). Using ⌃⌥K instead.'
    }
    return status
  }
  const ok = addon.start((event, key) => {
    if (event === 'tap') handlers.onTap()
    else if (key) handlers.onChord(key)
  })
  status = ok
    ? { loaded: true, running: true, detail: 'fn key active' }
    : {
        loaded: true,
        running: false,
        detail: 'Input Monitoring not granted, so fn is unavailable. Using ⌃⌥K instead.'
      }
  return status
}

export function stopFnKey(): void {
  addon?.stop()
}

export function fnKeyStatus(): typeof status {
  return status
}
