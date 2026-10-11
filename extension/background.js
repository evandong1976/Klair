// Klair for Chrome: background worker.
// Sends pages from the content script to the Klair app on this Mac (a local endpoint on
// 127.0.0.1, see src/main/bridge.ts in the Klair repo), and checks in every minute so
// Klair's Start window can show the extension as connected. Klair only keeps pages
// while a session is observing; otherwise it answers 409 and the page is dropped.
//
// It also carries "select text, tap fn": while a page has text selected it waits on
// Klair for the fn tap, then streams back the short version that replaces the text.

const KLAIR = 'http://127.0.0.1:47821'

async function enabled() {
  const { enabled = true } = await chrome.storage.local.get('enabled')
  return enabled
}

async function sendPage(page) {
  if (!(await enabled())) return
  let status = 0
  let reason = ''
  try {
    const res = await fetch(`${KLAIR}/v1/page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(page)
    })
    status = res.status
    reason = (await res.json().catch(() => ({}))).reason || ''
  } catch {
    status = 0 // Klair isn't running
  }
  await chrome.storage.local.set({
    last: { at: Date.now(), status, reason, title: page.title.slice(0, 120), url: page.url }
  })
}

async function checkIn() {
  let klair = { offline: true }
  try {
    const res = await fetch(`${KLAIR}/v1/status`)
    // Reachable but refused (e.g. 403: Klair expects a different extension id).
    klair = res.ok ? await res.json() : { refused: res.status }
  } catch {
    // Klair isn't running
  }
  const out = { at: Date.now(), ...klair }
  await chrome.storage.local.set({ klair: out })
  return out
}

// One held request per tab while it has text selected; aborted when the selection goes.
const waiting = new Map()

async function waitForFn(tabId) {
  if (!(await enabled())) return { tap: false, off: true }
  waiting.get(tabId)?.abort()
  const abort = new AbortController()
  waiting.set(tabId, abort)
  try {
    const res = await fetch(`${KLAIR}/v1/fn`, { method: 'POST', signal: abort.signal })
    if (!res.ok) return { tap: false, offline: true }
    return { tap: !!(await res.json()).tap }
  } catch {
    // Aborted (selection cleared) or Klair isn't running.
    return { tap: false, offline: !abort.signal.aborted }
  } finally {
    if (waiting.get(tabId) === abort) waiting.delete(tabId)
  }
}

// The content script opens a port per replacement; the answer streams back over it.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'klair:condense') return
  const tab = port.sender?.tab
  if (!tab || port.sender.frameId !== 0 || tab.incognito) return port.disconnect()
  const abort = new AbortController()
  let open = true
  port.onDisconnect.addListener(() => {
    open = false
    abort.abort()
  })
  const post = (m) => {
    if (open) port.postMessage(m)
  }
  port.onMessage.addListener(async (msg) => {
    try {
      const res = await fetch(`${KLAIR}/v1/condense`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: msg.text, title: msg.title, url: msg.url }),
        signal: abort.signal
      })
      if (!res.ok || !res.body) return post({ error: `Klair answered ${res.status}` })
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const delta = decoder.decode(value, { stream: true })
        if (delta) post({ delta })
      }
      post({ done: true })
    } catch {
      post({ error: 'Klair stopped answering' })
    }
  })
})

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'klair:fn-wait') {
    if (!sender.tab || sender.frameId !== 0 || sender.tab.incognito) return false
    waitForFn(sender.tab.id).then(sendResponse)
    return true // answer when fn is tapped, or after Klair's 20 s
  }
  if (msg?.type === 'klair:fn-stop') {
    if (sender.tab) waiting.get(sender.tab.id)?.abort()
    return false
  }
  if (msg?.type === 'klair:page') {
    // Top frame of a normal tab only; never incognito.
    if (sender.tab && sender.frameId === 0 && !sender.tab.incognito) void sendPage(msg.page)
    return false
  }
  if (msg?.type === 'klair:check-in') {
    checkIn().then(sendResponse)
    return true // answer asynchronously
  }
  return false
})

chrome.alarms.create('klair-check-in', { periodInMinutes: 1 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'klair-check-in') void checkIn()
})
chrome.runtime.onInstalled.addListener(() => void checkIn())
chrome.runtime.onStartup.addListener(() => void checkIn())
