// "Do it for me" (shared/options.ts) opens one web page or one app. What to open is named
// by a model reading the screen, so it is checked here before it is ever offered: the
// tile shows exactly this target, and picking the tile is the user's consent.

export interface OpenTarget {
  kind: 'url' | 'app'
  /** The address, or the app's name as macOS shows it. */
  target: string
  /** What the tile says will open. */
  label: string
}

const GENERIC = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu'])

/** "platform.openai.com" → "openai": the name a person would recognise the site by. */
function siteName(host: string): string {
  const labels = host
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.')
  let i = labels.length - 2
  if (i > 0 && GENERIC.has(labels[i])) i--
  return labels[Math.max(0, i)] ?? ''
}

/**
 * The target if it is safe and grounded, else null. Web pages must be https with no
 * credentials in the address. Either kind must be named in `seen` (the note and page
 * text for the screen): a site or app the screen never mentions is a guess, not a next step.
 */
export function openTarget(
  raw: { kind?: string; target?: string } | null | undefined,
  seen: string
): OpenTarget | null {
  const target = raw?.target?.trim() ?? ''
  const text = seen.toLowerCase()
  if (!target) return null
  if (raw?.kind === 'app') {
    // Launched with `open -a <name>` and no shell; a leading "-" would read as a flag.
    if (!/^[\p{L}\p{N}][\p{L}\p{N} .+&'-]{0,39}$/u.test(target)) return null
    const first = target.toLowerCase().split(/[ .]/)[0]
    if (first.length < 3 || !text.includes(first)) return null
    return { kind: 'app', target, label: target }
  }
  if (raw?.kind !== 'url') return null
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  const site = siteName(url.hostname)
  if (site.length < 3 || !text.includes(site)) return null
  const path = url.pathname === '/' ? '' : url.pathname
  return {
    kind: 'url',
    target: url.href,
    label: `${url.hostname.replace(/^www\./, '')}${path}`.slice(0, 48)
  }
}
