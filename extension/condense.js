// Klair for Chrome: select text, tap fn, and the passage is replaced in the page by a
// short version (one to three sentences). Runs in the top frame of http/https pages.
//
// The fn key never reaches a web page, so the Klair app listens for it. While this page
// is focused with enough text selected, it waits on Klair (through the background
// worker) for the tap. Without a selection nothing waits, and fn opens Klair as usual.
;(() => {
  const MIN_CHARS = 120 // shorter than this isn't worth shortening; fn opens Klair instead
  const MAX_CHARS = 20_000
  const ROSE = '238, 131, 120'
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const tell = (msg) => {
    try {
      return chrome.runtime.sendMessage(msg).catch(() => null)
    } catch {
      return Promise.resolve(null) // the extension was reloaded; this script is orphaned
    }
  }

  function selectedRange() {
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return null
    const sel = getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
    const range = sel.getRangeAt(0)
    const el =
      range.commonAncestorContainer.nodeType === 1
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement
    // Never rewrite what the user is typing, or text Klair already replaced.
    if (
      !el ||
      el.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), klair-condensed'
      )
    )
      return null
    if (sel.toString().trim().length < MIN_CHARS) return null
    return range
  }

  // ---- waiting for the fn tap

  let waiting = false
  async function wait() {
    if (waiting) return
    waiting = true
    try {
      while (selectedRange()) {
        const r = await tell({ type: 'klair:fn-wait' })
        if (r?.tap) {
          const range = selectedRange()
          if (range) replace(range)
          return
        }
        // Klair isn't running, the extension is switched off, or it couldn't be reached.
        if (!r || r.offline || r.off) await sleep(4000)
      }
    } finally {
      waiting = false
    }
  }

  let timer = 0
  function check() {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (selectedRange()) void wait()
      else void tell({ type: 'klair:fn-stop' })
    }, 120)
  }
  document.addEventListener('selectionchange', check)
  window.addEventListener('focus', check)
  window.addEventListener('blur', check)
  document.addEventListener('visibilitychange', check)

  // ---- replacing the selection

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

  function replace(range) {
    const text = getSelection().toString().trim().slice(0, MAX_CHARS)
    // Where the selection starts: a selection across paragraphs leaves the range between
    // them once it is lifted out, and the short version belongs in the first one.
    const start =
      range.startContainer.nodeType === 1
        ? range.startContainer
        : range.startContainer.parentElement
    const kept = range.extractContents()
    getSelection().removeAllRanges()

    // An unknown element is inline by default, so the short version flows with the page's
    // own text and font. Styles are set from script: a page's CSP can't block those.
    const wrap = document.createElement('klair-condensed')
    const short = document.createElement('span')
    const original = document.createElement('span')
    original.style.display = 'none'
    original.append(kept)
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
    wrap.append(short, original, loading)
    if (start && start.isConnected && !start.contains(range.startContainer)) start.append(wrap)
    else range.insertNode(wrap)

    const restore = () => {
      wrap.replaceWith(...original.childNodes)
    }

    let got = ''
    let finished = false
    let port
    try {
      port = chrome.runtime.connect({ name: 'klair:condense' })
    } catch {
      return restore()
    }
    port.onMessage.addListener((m) => {
      if (m.delta) {
        if (!got) loading.remove()
        got += m.delta
        // Each piece fades in as it arrives; they are merged into plain text at the end.
        const piece = document.createElement('span')
        piece.textContent = m.delta
        short.append(piece)
        if (!calm)
          piece.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' })
      } else if (m.done) {
        finished = true
        port.disconnect()
        if (!got.trim()) return restore()
        finish()
      } else if (m.error) {
        finished = true
        port.disconnect()
        restore()
      }
    })
    port.onDisconnect.addListener(() => {
      if (!finished) restore() // cut off mid-answer: put the page back as it was
    })
    port.postMessage({ text, title: document.title, url: location.href })

    function finish() {
      short.textContent = got.trim()
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
      const show = () => {
        short.style.display = showingShort ? '' : 'none'
        original.style.display = showingShort ? 'none' : 'contents'
        toggle.textContent = showingShort ? 'original' : 'short version'
        toggle.title = showingShort
          ? 'Shortened by Klair. Show what the page said.'
          : "Show Klair's short version again."
      }
      const flip = (e) => {
        e.preventDefault()
        e.stopPropagation()
        showingShort = !showingShort
        show()
      }
      toggle.addEventListener('click', flip)
      toggle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') flip(e)
      })
      show()
      wrap.append(toggle)
    }
  }
})()
