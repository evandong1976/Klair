// Klair never shows an em dash. Models are asked not to write them (notes.ts,
// execute.ts), and everything on its way to a window passes through here as well, so
// text from models, saved sessions and other apps' window titles is covered too.

/** "a — b" → "a, b". A dash that opens a line is simply dropped. */
export function noEmDash(text: string): string {
  if (!text.includes('—')) return text
  return text.replace(/^[ \t]*—[ \t]*/gm, '').replace(/[ \t]*—[ \t]*/g, ', ')
}

/** noEmDash for every string inside a value (state objects, IPC results). */
export function deepNoEmDash<T>(value: T): T {
  if (typeof value === 'string') return noEmDash(value) as T
  if (Array.isArray(value)) return value.map(deepNoEmDash) as T
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepNoEmDash(v)])) as T
  }
  return value
}
