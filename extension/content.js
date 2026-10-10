// Klair for Chrome: content script (top frame of http/https pages).
// Reads the page's whole rendered text, not just the part in view, and hands it to the
// background worker, which sends it to the Klair app on this Mac. Nothing is read
// while the tab is hidden; switching back to a tab tells Klair it's the live page again.
;(() => {
  const MAX_CHARS = 200_000
  const MIN_CHARS = 40

  let lastUrl = location.href
  let lastSent = { url: '', length: 0 }
  let timer = 0

  function extract() {
    const body = document.body
    if (!body) return null
    const full = (body.innerText || '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    const description =
      document.querySelector('meta[name="description"]')?.getAttribute('content') || ''
    return {
      url: location.href,
      title: (document.title || '').slice(0, 1000),
      description: description.slice(0, 2000),
      text: full.slice(0, MAX_CHARS),
      truncated: full.length > MAX_CHARS
    }
  }

  /** force: send even if this version was already sent (the tab became the live one). */
  function send(force) {
    if (document.visibilityState !== 'visible') return
    const page = extract()
    if (!page || page.text.length < MIN_CHARS) return
    // Same page again: only re-send when much more content arrived (lazy loading).
    const grewBy = Math.abs(page.text.length - lastSent.length)
    if (!force && page.url === lastSent.url && grewBy < Math.max(500, lastSent.length * 0.2)) return
    lastSent = { url: page.url, length: page.text.length }
    try {
      chrome.runtime.sendMessage({ type: 'klair:page', page }).catch(() => {})
    } catch {
      // The extension was reloaded or removed; this old content script can't reach it.
    }
  }

  function schedule(ms, force = false) {
    clearTimeout(timer)
    timer = setTimeout(() => send(force), ms)
  }

  // After the page settles, then once more for content that loads late.
  function onNewPage(settleMs) {
    schedule(settleMs)
    setTimeout(() => schedule(0), 5000)
  }

  onNewPage(800)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule(300, true)
  })
  // Single-page apps change the URL without a page load.
  setInterval(() => {
    if (location.href === lastUrl) return
    lastUrl = location.href
    onNewPage(1200)
  }, 1000)
})()
