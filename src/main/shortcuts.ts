import { globalShortcut } from 'electron'
import { config } from './config'
import { startFnKey } from './fnkey'

// Global keys (DESIGN.md §4). Only the fn family is global; ⌘ keys are handled by
// the panel itself while it has focus. Until the native fn addon runs, ⌃⌥K / ⌃⌥P /
// ⌃⌥Q do the same jobs.

export interface ShortcutResult {
  fn: boolean
  fallback: { toggle: boolean; pause: boolean; quiet: boolean }
}

export function registerShortcuts(h: {
  toggle: () => void
  pause: () => void
  quiet: () => void
}): ShortcutResult {
  const fn = startFnKey({
    onTap: h.toggle,
    onChord: (key) => {
      if (key === 'p') h.pause()
      if (key === 'q') h.quiet()
    }
  })
  const reg = (accel: string, fnc: () => void): boolean => {
    try {
      return globalShortcut.register(accel, fnc)
    } catch {
      return false
    }
  }
  return {
    fn: fn.running,
    fallback: {
      toggle: reg(config.fallbackKeys.toggle, h.toggle),
      pause: reg(config.fallbackKeys.pause, h.pause),
      quiet: reg(config.fallbackKeys.quiet, h.quiet)
    }
  }
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}
