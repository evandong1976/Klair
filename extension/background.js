// Klair for Chrome: background worker.
// Sends pages from the content script to the Klair app on this Mac (a local endpoint on
// 127.0.0.1, see src/main/bridge.ts in the Klair repo), fetches the passages Klair marked
// on the tab on screen, and checks in every minute so Klair's Start window can show the
// extension as connected. Klair only keeps pages
// while a session is observing; otherwise it answers 409 and the page is dropped.

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

/** Passages Klair marked on this page after an answer about it (none if it has none). */
async function highlightsFor(url) {
  if (!(await enabled())) return { off: true }
  try {
    const res = await fetch(`${KLAIR}/v1/highlights?url=${encodeURIComponent(url)}`)
    return res.ok ? await res.json() : { offline: true }
  } catch {
    return { offline: true } // Klair isn't running
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'klair:highlights') {
    if (!sender.tab || sender.frameId !== 0 || sender.tab.incognito || !sender.url) return false
    highlightsFor(sender.url).then(sendResponse)
    return true // answer asynchronously
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
