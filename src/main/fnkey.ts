import { join } from 'path'
import { app } from 'electron'

// Optional native addon (native/fn-key) that reports taps of the fn/globe key via a
// CGEventTap. Electron's globalShortcut cannot bind fn on its own. If the addon isn't
// built, or Input Monitoring isn't granted, Klair falls back to ⌃⌥K / ⌃⌥P / ⌃⌥Q.
//
// Addon contract: start(cb: (event: FnEvent, key?: string) => void): boolean; stop(): void
//   'down' / 'up' → fn pressed / released
//   'tap'   → fn pressed and released with no other key
//   'chord' → fn held while `key` ('p' | 'q' | '1'–'9') was pressed
// start() also asks macOS for Input Monitoring when it isn't granted yet. That request
// is what makes Klair appear in System Settings › Input Monitoring at all.

type FnEvent = 'tap' | 'chord' | 'down' | 'up'

interface FnAddon {
  start(cb: (event: FnEvent, key?: string) => void): boolean
  stop(): void
}

// fn held + a click on a paragraph in Chrome shortens that paragraph (condense.ts).
// The page can't see fn, so it asks Klair whether fn is held (claimFnHold). A hold
// that was used that way is "claimed": releasing fn then doesn't also open the panel.
const HOLD_GRACE_MS = 400 // the click's question can arrive just after fn is let go
const HOLD_MAX_MS = 30_000 // a missed 'up' must not leave fn "held" forever
let downAt = 0
let upAt = 0
let claimed = false

/** Is fn held right now (or was a moment ago)? If so, this hold won't open the panel. */
export function claimFnHold(now = Date.now()): boolean {
  const held = downAt > upAt ? now - downAt < HOLD_MAX_MS : upAt > 0 && now - upAt < HOLD_GRACE_MS
  if (held) claimed = true
  return held
}

/** Exported for tests: feed it what the addon reports. Returns whether a tap should act. */
export function trackFn(event: FnEvent, now = Date.now()): boolean {
  if (event === 'down') {
    downAt = now
    claimed = false
  } else if (event === 'up') {
    upAt = now
  } else if (event === 'tap') {
    const act = !claimed
    claimed = false
    return act
  }
  return false
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
    if (event === 'tap') {
      if (trackFn(event)) h.onTap()
    } else if (event === 'chord') {
      if (key) h.onChord(key)
    } else trackFn(event)
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
