import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { z } from 'zod'

// The local endpoint the Chrome extension (extension/) talks to. It listens on
// 127.0.0.1 only. A request must carry either the extension's own origin
// (`chrome-extension://<id>`, pinned by the manifest's "key") or no Origin at all:
// Chrome may leave Origin off requests an extension makes under its host permissions,
// while a web page can't hide its origin (browsers always send Origin on POST, and a
// GET a page can't read gains it nothing). Any other origin is refused. The Host check
// stops DNS-rebinding pages from reaching the port under another name.
//
//   GET  /v1/status   → { app: 'klair', session, observing }   (extension heartbeat)
//   POST /v1/page     ← { url, title, text, description?, truncated? }
//                     → 200 { stored } · 409 { reason } when no session is observing

/** Pinned by the "key" in extension/manifest.json. */
export const KLAIR_EXTENSION_ID = 'jndibkpbjoldneahpgmofeoekkpeaepo'
export const DEFAULT_BRIDGE_PORT = 47821

const MAX_BODY_BYTES = 3 * 1024 * 1024
const MAX_TEXT_CHARS = 250_000

const pageSchema = z.object({
  url: z.string().url().max(4096),
  title: z.string().max(1000).default(''),
  description: z.string().max(2000).default(''),
  text: z.string().max(MAX_TEXT_CHARS),
  truncated: z.boolean().default(false)
})

export type BrowserPage = z.infer<typeof pageSchema>

export interface BridgeHandlers {
  onPage(page: BrowserPage): Promise<{ stored: boolean; reason?: string }>
  status(): { session: boolean; observing: boolean }
}

export interface BridgeInfo {
  listening: boolean
  error: string | null
  port: number
  /** Last request from the extension (any route), ms since epoch. */
  lastSeenAt: number | null
  lastPageAt: number | null
  /** The last request refused, for diagnosing an extension that can't connect. */
  lastRefused: { at: number; status: number; origin: string | null; host: string } | null
}

export class Bridge {
  private server: Server | null = null
  private state: BridgeInfo
  private readonly origin: string

  constructor(
    private handlers: BridgeHandlers,
    private opts: { port: number; extensionId: string }
  ) {
    this.origin = `chrome-extension://${opts.extensionId}`
    this.state = {
      listening: false,
      error: null,
      port: opts.port,
      lastSeenAt: null,
      lastPageAt: null,
      lastRefused: null
    }
  }

  info(): BridgeInfo {
    return { ...this.state }
  }

  listen(): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer((req, res) => void this.handle(req, res))
      server.once('error', (err: NodeJS.ErrnoException) => {
        this.state.error =
          err.code === 'EADDRINUSE' ? `Port ${this.opts.port} is in use` : err.message
        resolve(false)
      })
      server.listen(this.opts.port, '127.0.0.1', () => {
        this.server = server
        this.state.listening = true
        this.state.port = (server.address() as { port: number }).port
        resolve(true)
      })
    })
  }

  close(): void {
    this.server?.close()
    this.server = null
    this.state.listening = false
  }

  private send(res: ServerResponse, code: number, body?: unknown): void {
    res.writeHead(code, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': this.origin,
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Private-Network': 'true',
      Vary: 'Origin'
    })
    res.end(body === undefined ? undefined : JSON.stringify(body))
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const port = this.state.port
    const host = req.headers.host ?? ''
    const origin = req.headers.origin ?? null
    const refuse = (status: number): void => {
      this.state.lastRefused = { at: Date.now(), status, origin, host }
      console.warn(
        `chrome bridge: refused ${req.method} ${req.url} (${status}) origin=${origin} host=${host}`
      )
      res.writeHead(status).end()
    }
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return refuse(421)
    if (origin !== null && origin !== this.origin) return refuse(403)
    this.state.lastSeenAt = Date.now()
    const path = (req.url ?? '').split('?')[0]
    if (req.method === 'OPTIONS') return this.send(res, 204)
    if (req.method === 'GET' && path === '/v1/status') {
      return this.send(res, 200, { app: 'klair', ...this.handlers.status() })
    }
    if (req.method === 'POST' && path === '/v1/page') {
      let raw: string
      try {
        raw = await readBody(req)
      } catch {
        return this.send(res, 413, { error: 'too large' })
      }
      let page: BrowserPage
      try {
        page = pageSchema.parse(JSON.parse(raw))
      } catch {
        return this.send(res, 400, { error: 'bad page' })
      }
      if (!/^https?:/.test(page.url)) return this.send(res, 400, { error: 'bad page' })
      try {
        const out = await this.handlers.onPage(page)
        if (out.stored || out.reason === 'duplicate') this.state.lastPageAt = Date.now()
        return this.send(res, out.stored || out.reason === 'duplicate' ? 200 : 409, out)
      } catch (err) {
        return this.send(res, 500, { error: (err as Error).message.slice(0, 200) })
      }
    }
    this.send(res, 404, { error: 'not found' })
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
