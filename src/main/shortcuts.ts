import { globalShortcut } from 'electron'
import { isBindable } from '../shared/keys'
import { cache } from './cache'
import { config } from './config'
import { startFnKey } from './fnkey'
import { getState, setState } from './state'

// Global keys (DESIGN.md §4). Only the fn family is global; ⌘ keys are handled by
// the panel itself while it has focus. Until the native fn addon runs, ⌃⌥K / ⌃⌥P /
// ⌃⌥Q do the same jobs. fn 1–9 (and always ⌃⌥1–9) jump to the session in that slot.

export interface ShortcutResult {
  fn: boolean
  fallback: { toggle: boolean; pause: boolean; quiet: boolean }
}

let onToggle: () => void = () => {}

const reg = (accel: string, fnc: () => void): boolean => {
  try {
    return globalShortcut.register(accel, fnc)
  } catch {
    return false
  }
}

/** Rebind the open/close shortcut. Keeps the old one if the new one can't be taken. */
export function setToggleKey(accel: string): boolean {
  const old = getState().toggleKey
  if (accel === old) return true
  if (!isBindable(accel) || !reg(accel, onToggle)) return false
  globalShortcut.unregister(old)
  cache.set('toggleKey', accel)
  setState({ toggleKey: accel })
  return true
}

export function registerShortcuts(h: {
  toggle: () => void
  pause: () => void
  quiet: () => void
  session: (slot: number) => void
}): ShortcutResult {
  onToggle = h.toggle
  const fn = startFnKey({
    onTap: h.toggle,
    onChord: (key) => {
      if (key === 'p') h.pause()
      if (key === 'q') h.quiet()
      if (/^[1-9]$/.test(key)) h.session(Number(key))
    }
  })
  for (let n = 1; n <= 9; n++) reg(`Control+Alt+${n}`, () => h.session(n))
  return {
    fn: fn.running,
    fallback: {
      toggle: reg(getState().toggleKey, h.toggle),
      pause: reg(config.fallbackKeys.pause, h.pause),
      quiet: reg(config.fallbackKeys.quiet, h.quiet)
    }
  }
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}
