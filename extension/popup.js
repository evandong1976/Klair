// Klair for Chrome: popup. Shows whether Klair is reachable and observing, what
// happened to the last page, and the on/off switch.

const $ = (id) => document.getElementById(id)

function show(prefix, status, title, detail) {
  $(`${prefix}-dot`).className = `dot ${status}`
  $(`${prefix}-title`).textContent = title
  $(`${prefix}-detail`).textContent = detail
}

function ago(at) {
  const s = Math.round((Date.now() - at) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function showKlair(k) {
  if (!k || k.offline) {
    show('klair', 'fail', "Klair isn't running", 'Open the Klair app on this Mac.')
  } else if (k.refused) {
    show(
      'klair',
      'fail',
      `Klair refused the extension (${k.refused})`,
      "Klair's Start window shows why under Chrome extension."
    )
  } else if (k.observing) {
    show('klair', 'ok', 'Session running', 'New pages are added to it.')
  } else if (k.session) {
    show('klair', 'warn', 'Session paused', 'Pages are sent again when you resume.')
  } else {
    show('klair', 'warn', 'No session running', 'Start one in Klair to add pages.')
  }
}

const RESULT = {
  200: ['ok', 'Added to the session'],
  409: ['warn', "Not added: Klair isn't observing"],
  403: ['fail', 'Refused by Klair (extension id)'],
  0: ['fail', "Klair wasn't reachable"]
}

function showLast(last) {
  if (!last) return
  const [status, text] =
    last.status === 200 && last.reason === 'duplicate'
      ? ['ok', 'Already in the session']
      : (RESULT[last.status] ?? ['fail', `Klair answered ${last.status}`])
  show('last', status, last.title || last.url, `${text} · ${ago(last.at)}`)
}

async function main() {
  const {
    enabled = true,
    last,
    klair
  } = await chrome.storage.local.get(['enabled', 'last', 'klair'])
  $('enabled').checked = enabled
  $('enabled').addEventListener('change', (e) =>
    chrome.storage.local.set({ enabled: e.target.checked })
  )
  showKlair(klair)
  showLast(last)
  showKlair(await chrome.runtime.sendMessage({ type: 'klair:check-in' }).catch(() => null))
}

void main()
