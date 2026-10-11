// Klair for Chrome: hold fn and click a paragraph (or a bulleted item, for its whole
// list), and it is replaced in the page by a short version (one to three sentences) that keeps what matters for the project you
// are working on. Runs in the top frame of http/https pages.
//
// The fn key never reaches a web page, so the Klair app watches it. When a paragraph is
// clicked, this asks Klair (through the background worker) whether fn is held. An
// ordinary click gets "no" and nothing happens.
//
// Holding fn and clicking a short version shortens it again.
;(() => {
  const MIN_CHARS = 80 // shorter than this isn't worth shortening
  const MIN_AGAIN_CHARS = 60 // a short version below this is as short as it gets
  const MAX_CHARS = 20_000
  const ROSE = '238, 131, 120'
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches

  const BLOCKS = 'p, li, blockquote, dd, dt, figcaption, td, th, pre'
  // Clicks on these do their own thing; never shorten around them.
  const BUSY =
    'a, button, input, textarea, select, label, summary, video, audio, [role="button"], [role="link"], [contenteditable]:not([contenteditable="false"])'

  // Each short version on the page: whether it can be shortened again, and how.
  const states = new WeakMap()

  /** The paragraph (or list, quote, cell) under a click, if it has enough text. */
  function paragraphAt(target) {
    if (!(target instanceof Element) || target.closest(BUSY)) return null
    let block = target.closest(BLOCKS)
    if (!block) {
      // Pages built from plain <div>s: the nearest ancestor holding a paragraph's worth
      // of text, as long as it isn't a whole section of the page.
      for (let el = target; el && el !== document.body; el = el.parentElement) {
        const n = (el.innerText || '').trim().length
        if (n > 4000) return null
        if (n >= MIN_CHARS) {
          block = el
          break
        }
      }
    }
    // A bulleted item stands for its list: all the points (and their sub-points) become
    // one short version. A list too long to send whole is left to the one item.
    const list = block?.closest('li')?.parentElement
    if (list?.matches('ul, ol') && (list.innerText || '').trim().length <= MAX_CHARS) block = list
    if (!block || block.querySelector('klair-condensed')) return null
    return (block.innerText || '').trim().length >= MIN_CHARS ? block : null
  }

  // mousedown, not click: the question reaches Klair while fn is still down.
  document.addEventListener(
    'mousedown',
    (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      // A click on a short version shortens it again; anywhere else, the paragraph.
      const done = e.target instanceof Element ? e.target.closest('klair-condensed') : null
      const again = done && states.get(done)
      const block = done ? null : paragraphAt(e.target)
      if (done ? !again || !again.canShorten() : !block) return
      if (e.target instanceof Element && e.target.closest('[role="button"]')) return
      let asked
      try {
        asked = chrome.runtime.sendMessage({ type: 'klair:fn-held' })
      } catch {
        return // the extension was reloaded; this script is orphaned
      }
      asked
        .then((r) => {
          if (!r?.held) return
          if (again) {
            if (again.canShorten()) again.shorten()
            return
          }
          if (!block.isConnected || block.querySelector('klair-condensed')) return
          const range = document.createRange()
          range.selectNodeContents(block)
          replace(range, (block.innerText || '').trim())
        })
        .catch(() => {})
    },
    true
  )

  // ---- replacing the paragraph

  function bar(width) {
    const b = document.createElement('span')
    Object.assign(b.style, {
      display: 'block',
      width,
      height: '0.72em',
      margin: '0.36em 0',
      borderRadius: '0.36em',
      background: `linear-gradient(90deg, rgba(${ROSE}, 0.16) 25%, rgba(${ROSE}, 0.38) 50%, rgba(${ROSE}, 0.16) 75%)`,
      backgroundSize: '200% 100%'
    })
    if (!calm) {
      b.animate([{ backgroundPosition: '100% 0' }, { backgroundPosition: '-100% 0' }], {
        duration: 1100,
        iterations: Infinity,
        easing: 'linear'
      })
    }
    return b
  }

  function loadingBars() {
    const loading = document.createElement('span')
    Object.assign(loading.style, {
      display: 'inline-block',
      width: '100%',
      maxWidth: '36em',
      verticalAlign: 'top'
    })
    loading.setAttribute('role', 'status')
    loading.setAttribute('aria-label', 'Klair is shortening this')
    loading.append(bar('100%'), bar('64%'))
    return loading
  }

  /**
   * Ask Klair for the short version of `text` and stream it into `short`, behind a
   * shimmer until the first word arrives. Resolves with the new text, or null if
   * nothing usable came back (the caller puts things back as they were).
   */
  function stream(text, again, short, loading) {
    return new Promise((resolve) => {
      let got = ''
      let finished = false
      let port
      try {
        port = chrome.runtime.connect({ name: 'klair:condense' })
      } catch {
        return resolve(null)
      }
      const end = (value) => {
        if (finished) return
        finished = true
        loading.remove()
        try {
          port.disconnect()
        } catch {
          // already closed
        }
        resolve(value)
      }
      port.onMessage.addListener((m) => {
        if (m.delta) {
          if (!got) {
            loading.remove()
            short.textContent = ''
          }
          got += m.delta
          // Each piece fades in as it arrives; they are merged into plain text at the end.
          const piece = document.createElement('span')
          piece.textContent = m.delta
          short.append(piece)
          if (!calm)
            piece.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' })
        } else if (m.done) end(got.trim() || null)
        else if (m.error) end(null)
      })
      port.onDisconnect.addListener(() => end(null)) // cut off mid-answer
      port.postMessage({ text, title: document.title, url: location.href, again })
    })
  }

  function settle(short, text) {
    short.textContent = text
    Object.assign(short.style, {
      background: `rgba(${ROSE}, 0.09)`,
      borderRadius: '0.25em',
      boxShadow: `0 0 0 0.12em rgba(${ROSE}, 0.09)`
    })
    if (!calm) {
      short.animate(
        [{ background: `rgba(${ROSE}, 0.32)` }, { background: `rgba(${ROSE}, 0.09)` }],
        { duration: 900, easing: 'ease-out' }
      )
    }
  }

  async function replace(range, full) {
    const kept = range.extractContents()
    getSelection().removeAllRanges()

    // An unknown element is inline by default, so the short version flows with the page's
    // own text and font. Styles are set from script: a page's CSP can't block those.
    const wrap = document.createElement('klair-condensed')
    const short = document.createElement('span')
    const original = document.createElement('span')
    original.style.display = 'none'
    original.append(kept)
    const loading = loadingBars()
    wrap.append(short, original, loading)
    range.insertNode(wrap)

    const text = await stream(full.slice(0, MAX_CHARS), false, short, loading)
    if (!text) return wrap.replaceWith(...original.childNodes) // put the page back as it was
    settle(short, text)

    // A small switch back to what the page said, and forward again.
    const toggle = document.createElement('span')
    toggle.setAttribute('role', 'button')
    toggle.tabIndex = 0
    Object.assign(toggle.style, {
      marginLeft: '0.5em',
      fontSize: '0.72em',
      fontWeight: '600',
      letterSpacing: '0.02em',
      color: '#a8463d',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      userSelect: 'none'
    })
    let showingShort = true
    let busy = false
    const show = () => {
      short.style.display = showingShort ? '' : 'none'
      original.style.display = showingShort ? 'none' : 'contents'
      toggle.textContent = showingShort ? 'original' : 'short version'
      toggle.title = showingShort
        ? 'Shortened by Klair. Show what the page said. Hold fn and click the text to shorten it again.'
        : "Show Klair's short version again."
    }
    const flip = (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (busy) return
      showingShort = !showingShort
      show()
    }
    toggle.addEventListener('click', flip)
    toggle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') flip(e)
    })
    show()
    wrap.append(toggle)

    states.set(wrap, {
      canShorten: () => !busy && showingShort && short.textContent.trim().length >= MIN_AGAIN_CHARS,
      // fn + click on the short version: the same shimmer, then a tighter version of it.
      async shorten() {
        busy = true
        const before = short.textContent
        const again = loadingBars()
        short.style.display = 'none'
        wrap.insertBefore(again, toggle)
        const shown = () => (short.style.display = '')
        // The old text stays hidden behind the shimmer until the first new word.
        const firstWord = new MutationObserver(() => {
          firstWord.disconnect()
          shown()
        })
        firstWord.observe(short, { childList: true })
        const tighter = await stream(before, true, short, again)
        firstWord.disconnect()
        shown()
        // Nothing came back, or it wasn't shorter: keep what was there.
        settle(short, tighter && tighter.length < before.length ? tighter : before)
        busy = false
      }
    })
  }
})()
