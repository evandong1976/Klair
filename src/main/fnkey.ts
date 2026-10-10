import { join } from 'path'
import { app } from 'electron'

// Optional native addon (native/fn-key) that reports taps of the fn/globe key via a
// CGEventTap. Electron's globalShortcut cannot bind fn on its own. If the addon isn't
// built, or Input Monitoring isn't granted, Klair falls back to ⌃⌥K / ⌃⌥P / ⌃⌥Q.
//
// Addon contract: start(cb: (event: 'tap' | 'chord', key?: string) => void): boolean; stop(): void
//   'tap'   → fn pressed and released with no other key
//   'chord' → fn held while `key` ('p' | 'q') was pressed
// start() also asks macOS for Input Monitoring when it isn't granted yet. That request
// is what makes Klair appear in System Settings › Input Monitoring at all.

interface FnAddon {
  start(cb: (event: 'tap' | 'chord', key?: string) => void): boolean
  stop(): void
}

type Handlers = { onTap: () => void; onChord: (key: string) => void }

let addon: FnAddon | null = null
let handlers: Handlers | null = null
let status: { loaded: boolean; running: boolean; detail: string } = {
  loaded: false,
  running: false,
  detail: 'Not loaded'
}

function load(): FnAddon | null {
  if (addon) return addon
  try {
    const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    addon = require(join(base, 'native', 'fn-key', 'build', 'Release', 'fn_key.node')) as FnAddon
  } catch {
    addon = null
  }
  return addon
}

function tryStart(): typeof status {
  if (process.platform !== 'darwin') {
    status = { loaded: false, running: false, detail: 'fn key capture is macOS-only' }
    return status
  }
  if (status.running || !handlers) return status
  const a = load()
  if (!a) {
    status = {
      loaded: false,
      running: false,
      detail: 'fn add-on not built (pnpm build:native). Using ⌃⌥K instead.'
    }
    return status
  }
  const h = handlers
  const ok = a.start((event, key) => {
    if (event === 'tap') h.onTap()
    else if (key) h.onChord(key)
  })
  status = ok
    ? { loaded: true, running: true, detail: 'fn key active' }
    : {
        loaded: true,
        running: false,
        detail:
          'Input Monitoring not granted. Allow Klair, then Check again (or reopen Klair). Using ⌃⌥K meanwhile.'
      }
  return status
}

export function startFnKey(h: Handlers): typeof status {
  handlers = h
  return tryStart()
}

/**
 * Try again after the user grants Input Monitoring (or builds the addon) without
 * restarting Klair. Also re-sends the permission request, so Klair gets listed.
 */
export function retryFnKey(): typeof status {
  return tryStart()
}

export function stopFnKey(): void {
  addon?.stop()
}

export function fnKeyStatus(): typeof status {
  return status
}
