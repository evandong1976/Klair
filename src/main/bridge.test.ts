import assert from 'node:assert/strict'
import { request } from 'node:http'
import { after, before, test } from 'node:test'
import { Bridge, type BrowserPage } from './bridge'

const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'
const pages: BrowserPage[] = []
let observing = true
const bridge = new Bridge(
  {
    onPage: async (p) => {
      if (!observing) return { stored: false, reason: 'no-session' }
      pages.push(p)
      return { stored: true }
    },
    status: () => ({ session: observing, observing }),
    condense: async function* (input) {
      if (input.text === 'fail') throw new Error('model down')
      yield 'Short '
      yield `version of ${input.text.length} chars.`
    }
  },
  { port: 0, extensionId: 'abcdefghijklmnopabcdefghijklmnop' }
)
let port = 0

before(async () => {
  assert.equal(await bridge.listen(), true)
  port = bridge.info().port
})
after(() => bridge.close())

function call(
  method: string,
  path: string,
  opts: { origin?: string; host?: string; body?: string } = {}
): Promise<{ status: number; headers: Record<string, unknown>; json: unknown }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { host: opts.host ?? `127.0.0.1:${port}` }
    if (opts.origin !== undefined) headers.origin = opts.origin
    if (opts.body !== undefined) headers['content-type'] = 'application/json'
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          json: data ? JSON.parse(data) : null
        })
      )
    })
    req.on('error', reject)
    req.end(opts.body)
  })
}

const page = (over: Partial<BrowserPage> = {}): string =>
  JSON.stringify({
    url: 'https://en.wikipedia.org/wiki/Gradient_descent',
    title: 'GD',
    text: 'x'.repeat(100),
    ...over
  })

test('web pages and other extensions are refused', async () => {
  const n = pages.length
  assert.equal(
    (await call('POST', '/v1/page', { origin: 'https://evil.example', body: page() })).status,
    403
  )
  assert.equal(
    (await call('POST', '/v1/page', { origin: 'chrome-extension://other', body: page() })).status,
    403
  )
  assert.equal(pages.length, n)
  assert.equal(bridge.info().lastRefused?.origin, 'chrome-extension://other')
  assert.equal(bridge.info().lastRefused?.status, 403)
})

test('requests without an Origin are accepted (Chrome may omit it for extensions)', async () => {
  const s = await call('GET', '/v1/status')
  assert.equal(s.status, 200)
  const r = await call('POST', '/v1/page', { body: page({ title: 'no origin' }) })
  assert.equal(r.status, 200)
  assert.equal(pages.at(-1)?.title, 'no origin')
})

test('another host name is refused (DNS rebinding)', async () => {
  const r = await call('GET', '/v1/status', { origin: EXT, host: `attacker.example:${port}` })
  assert.equal(r.status, 421)
})

test('the extension can check in and preflight', async () => {
  const s = await call('GET', '/v1/status', { origin: EXT })
  assert.equal(s.status, 200)
  assert.deepEqual(s.json, { app: 'klair', session: true, observing: true })
  assert.equal(s.headers['access-control-allow-origin'], EXT)
  assert.equal((await call('OPTIONS', '/v1/page', { origin: EXT })).status, 204)
  assert.ok(bridge.info().lastSeenAt)
})

test('a page is handed to the session; 409 when nothing is observing', async () => {
  const r = await call('POST', '/v1/page', { origin: EXT, body: page() })
  assert.equal(r.status, 200)
  assert.deepEqual(r.json, { stored: true })
  assert.equal(pages.at(-1)?.title, 'GD')
  assert.equal(pages.at(-1)?.truncated, false)
  observing = false
  const off = await call('POST', '/v1/page', { origin: EXT, body: page() })
  observing = true
  assert.equal(off.status, 409)
})

test('malformed pages are rejected', async () => {
  assert.equal((await call('POST', '/v1/page', { origin: EXT, body: '{' })).status, 400)
  assert.equal(
    (await call('POST', '/v1/page', { origin: EXT, body: page({ url: 'file:///etc/passwd' }) }))
      .status,
    400
  )
  assert.equal(
    (await call('POST', '/v1/page', { origin: EXT, body: page({ text: 'x'.repeat(250_001) }) }))
      .status,
    400
  )
})

test('fn goes to a page that is waiting with text selected, and to Klair otherwise', async () => {
  assert.equal(bridge.fnTap(), false) // nobody waiting: the tap opens Klair as usual
  const waiting = call('POST', '/v1/fn', { origin: EXT })
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(bridge.fnTap(), true)
  const r = await waiting
  assert.equal(r.status, 200)
  assert.deepEqual(r.json, { tap: true })
  assert.equal(bridge.fnTap(), false) // answered waiters don't linger
})

test('a page that stops waiting no longer takes the fn tap', async () => {
  const req = request({
    host: '127.0.0.1',
    port,
    method: 'POST',
    path: '/v1/fn',
    headers: { origin: EXT }
  })
  req.on('error', () => {}) // destroying it below reports a hang-up
  req.end()
  await new Promise((r) => setTimeout(r, 50))
  req.destroy() // the selection was cleared: the extension aborts its request
  await new Promise((r) => setTimeout(r, 100))
  assert.equal(bridge.fnTap(), false)
})

test('a web page cannot wait for fn or ask for a short version', async () => {
  assert.equal((await call('POST', '/v1/fn', { origin: 'https://evil.example' })).status, 403)
  const r = await call('POST', '/v1/condense', {
    origin: 'https://evil.example',
    body: JSON.stringify({ text: 'x' })
  })
  assert.equal(r.status, 403)
})

function raw(body: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/v1/condense',
        headers: { origin: EXT, 'content-type': 'application/json' }
      },
      (res) => {
        let text = ''
        res.on('data', (c) => (text += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
      }
    )
    req.on('error', reject)
    req.end(body)
  })
}

test('a selection is streamed back as its short version', async () => {
  const r = await raw(JSON.stringify({ text: 'x'.repeat(300), title: 'GD' }))
  assert.equal(r.status, 200)
  assert.equal(r.text, 'Short version of 300 chars.')
})

test('bad selections and model failures are reported, not streamed', async () => {
  assert.equal((await raw('{')).status, 400)
  assert.equal((await raw(JSON.stringify({ text: '   ' }))).status, 400)
  assert.equal((await raw(JSON.stringify({ text: 'x'.repeat(20_001) }))).status, 400)
  assert.equal((await raw(JSON.stringify({ text: 'fail' }))).status, 502)
})
