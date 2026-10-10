// The "open Klair" shortcut: turning a key press into an Electron accelerator
// ("Control+Alt+K") and an accelerator into the symbols shown in the UI ("⌃⌥K").

const CODES: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Return',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backquote: '`'
}

const SYMBOLS: Record<string, string> = {
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Command: '⌘',
  Return: '↵',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→'
}

interface KeyPress {
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/** Uses the physical key (`code`), since ⌥ changes the character a key types. */
export function accelFromEvent(e: KeyPress): string | null {
  const key =
    /^Key([A-Z])$/.exec(e.code)?.[1] ??
    /^Digit(\d)$/.exec(e.code)?.[1] ??
    /^(F\d{1,2})$/.exec(e.code)?.[1] ??
    CODES[e.code]
  if (!key) return null // a modifier on its own, or a key we don't bind
  const mods = [
    e.ctrlKey && 'Control',
    e.altKey && 'Alt',
    e.shiftKey && 'Shift',
    e.metaKey && 'Command'
  ].filter(Boolean) as string[]
  const accel = [...mods, key].join('+')
  return isBindable(accel) ? accel : null
}

/** A global shortcut needs ⌃, ⌥ or ⌘ (or to be an F-key), or it would eat normal typing. */
export function isBindable(accel: string): boolean {
  const parts = accel.split('+')
  const key = parts.pop() ?? ''
  if (!key || !parts.every((m) => ['Control', 'Alt', 'Shift', 'Command'].includes(m))) return false
  return /^F\d{1,2}$/.test(key) || parts.some((m) => m !== 'Shift')
}

export function prettyAccel(accel: string): string {
  const parts = accel.split('+')
  const key = parts.pop() ?? ''
  const mods = parts.map((m) => SYMBOLS[m] ?? m).join('')
  return mods + (SYMBOLS[key] ?? key)
}
