// Klair for Chrome: content script (top frame of http/https pages).
// Reads the page's whole rendered text, not just the part in view, and hands it to the
// background worker, which sends it to the Klair app on this Mac. Nothing is read
// while the tab is hidden; switching back to a tab tells Klair it's the live page again.
// Also marks the passages Klair's latest answer about this page points to (below).
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
    const samePage = location.href.split('#')[0] === lastUrl.split('#')[0]
    lastUrl = location.href
    if (!samePage) clearMarks()
    onNewPage(1200)
  }, 1000)

  // ---------------------------------------------------------------- highlights
  // After Klair answers about this page, it marks the passages the answer is about, each
  // with a short note (src/main/highlights.ts). The tab on screen asks for them: every 2 s
  // while a Klair session runs, every 10 s otherwise. Passages are found ignoring
  // whitespace and case, the way Klair checked them against the page text, and drawn
  // with the CSS Custom Highlight API, so the page's own DOM is never changed. Numbered
  // badges sit beside them in one overlay layer; hover one (or its passage) for the note.

  const FAST_MS = 2000
  const SLOW_MS = 10_000
  const MAX_INDEX = 400_000
  let marks = { id: null, items: [], ranges: [] }
  let dismissed = null
  let layer = null
  let placing = 0

  function textIndex() {
    const nodes = []
    const offsets = []
    let flat = ''
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.parentElement && !n.parentElement.closest('script,style,noscript,template,#klair-marks')
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT
    })
    for (let n = walker.nextNode(); n && flat.length < MAX_INDEX; n = walker.nextNode()) {
      const t = n.data
      for (let i = 0; i < t.length; i++) {
        const c = t[i]
        if (/\s/.test(c)) continue
        const lower = c.toLowerCase()
        flat += lower.length === 1 ? lower : c
        nodes.push(n)
        offsets.push(i)
      }
    }
    return { flat, nodes, offsets }
  }

  /** The first visible occurrence of a quote, as a Range. */
  function findQuote(index, quote) {
    const key = quote.replace(/\s+/g, '').toLowerCase()
    if (key.length < 8) return null
    for (let at = index.flat.indexOf(key); at >= 0; at = index.flat.indexOf(key, at + 1)) {
      const end = at + key.length - 1
      const range = document.createRange()
      range.setStart(index.nodes[at], index.offsets[at])
      range.setEnd(index.nodes[end], index.offsets[end] + 1)
      if (range.getClientRects().length) return range
    }
    return null
  }

  function clearMarks() {
    if (globalThis.CSS?.highlights) {
      CSS.highlights.delete('klair')
      CSS.highlights.delete('klair-active')
    }
    layer?.remove()
    layer = null
    marks = { id: null, items: [], ranges: [] }
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag)
    e.className = cls
    if (text) e.textContent = text
    return e
  }

  function setActive(i) {
    if (!layer) return
    layer.querySelectorAll('.klair-mark').forEach((m) => {
      m.classList.toggle('open', Number(m.dataset.i) === i)
    })
    if (!globalThis.CSS?.highlights) return
    if (i === null || !marks.ranges[i]) CSS.highlights.delete('klair-active')
    else CSS.highlights.set('klair-active', new Highlight(marks.ranges[i].range))
  }

  function applyMarks(set) {
    clearMarks()
    if (!globalThis.CSS?.highlights || !document.body) return
    const index = textIndex()
    const ranges = []
    set.items.forEach((item, i) => {
      const range = findQuote(index, item.quote)
      if (range) ranges.push({ range, item, n: i + 1 })
    })
    marks = { id: set.id, items: set.items, ranges }
    if (!ranges.length) return
    CSS.highlights.set('klair', new Highlight(...ranges.map((r) => r.range)))
    layer = el('div', '')
    layer.id = 'klair-marks'
    ranges.forEach((r, i) => {
      const mark = el('div', 'klair-mark')
      mark.dataset.i = String(i)
      const badge = el('button', 'klair-badge', String(r.n))
      badge.type = 'button'
      badge.setAttribute('aria-label', `Klair note ${r.n}`)
      badge.addEventListener('click', () => setActive(mark.classList.contains('open') ? null : i))
      const card = el('div', 'klair-card')
      card.append(
        el('span', 'klair-label', `Klair · ${r.n}`),
        el('span', 'klair-note', r.item.note)
      )
      const clear = el('button', 'klair-clear', 'Clear highlights')
      clear.type = 'button'
      clear.addEventListener('click', () => {
        dismissed = marks.id
        clearMarks()
      })
      card.append(clear)
      mark.append(badge, card)
      layer.append(mark)
    })
    document.documentElement.append(layer)
    place()
  }

  const BLOCK = 'p,li,dd,dt,blockquote,td,th,pre,figcaption,h1,h2,h3,h4,h5,h6,section,article,div'
  const BADGE = 20

  /**
   * Where a passage's badge goes: in the margin of its paragraph, level with the
   * passage's first line (left margin, else right), or like a footnote mark just above
   * the end of the passage when the paragraph has no room either side.
   */
  function badgeSpot(range, rects) {
    const first = rects[0]
    const last = rects[rects.length - 1]
    const block = range.startContainer.parentElement?.closest(BLOCK)
    const box = block ? block.getBoundingClientRect() : first
    const midY = first.top + (first.height - BADGE) / 2
    if (box.left - BADGE - 8 >= 4) return { left: box.left - BADGE - 8, top: midY }
    if (box.right + 8 + BADGE <= innerWidth - 4) return { left: box.right + 8, top: midY }
    return { left: Math.min(last.right - 4, innerWidth - BADGE - 4), top: last.top - BADGE * 0.6 }
  }

  function place() {
    if (!layer) return
    const marksEls = layer.querySelectorAll('.klair-mark')
    marks.ranges.forEach((r, i) => {
      const m = marksEls[i]
      const rects = r.range.getClientRects()
      if (!rects.length) return (m.style.display = 'none')
      const { left, top } = badgeSpot(r.range, rects)
      m.style.display = top < -BADGE || top > innerHeight ? 'none' : 'block'
      m.style.left = `${Math.round(left)}px`
      m.style.top = `${Math.round(top)}px`
      m.classList.toggle('flip', left + 310 > innerWidth)
    })
  }

  function schedulePlace() {
    if (!layer || placing) return
    placing = requestAnimationFrame(() => {
      placing = 0
      place()
    })
  }

  addEventListener('scroll', schedulePlace, { capture: true, passive: true })
  addEventListener('resize', schedulePlace, { passive: true })

  // Hovering a marked passage opens its note too.
  let hoverTimer = 0
  addEventListener(
    'mousemove',
    (e) => {
      if (!layer || hoverTimer) return
      hoverTimer = setTimeout(() => {
        hoverTimer = 0
        if (layer.matches(':hover') || layer.querySelector('.klair-mark:hover')) return
        const i = marks.ranges.findIndex((r) =>
          [...r.range.getClientRects()].some(
            (b) =>
              e.clientX >= b.left &&
              e.clientX <= b.right &&
              e.clientY >= b.top &&
              e.clientY <= b.bottom
          )
        )
        setActive(i < 0 ? null : i)
      }, 80)
    },
    { passive: true }
  )

  async function poll() {
    let res = null
    if (document.visibilityState === 'visible') {
      try {
        res = await chrome.runtime.sendMessage({ type: 'klair:highlights' })
      } catch {
        res = null // the extension was reloaded; this old script can't reach it
      }
    }
    if (res && !res.offline) {
      if (res.off || !res.id) {
        if (marks.id) clearMarks()
      } else if (res.id !== dismissed) {
        const gone = marks.ranges.some((r) => !r.range.startContainer.isConnected)
        if (res.id !== marks.id || gone) applyMarks(res)
        else place()
      }
    }
    setTimeout(poll, res?.session ? FAST_MS : SLOW_MS)
  }
  setTimeout(poll, 1500)
})()
