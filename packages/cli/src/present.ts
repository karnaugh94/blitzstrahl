/**
 * `blitzstrahl present` (PLAN §15, M12.6; cli.md, *present*): the deck,
 * built into a temporary folder and served, with a phone as the remote.
 *
 * Who gets what:
 * - This machine (loopback, and addressed as `localhost` or `127.0.0.1`,
 *   so a page that rebinds a name of its own to 127.0.0.1 gets nothing):
 *   the deck, the presenter view, and the relay's deck end.
 * - The network: `/r/<code>`, which pairs a phone once and sends it to the
 *   remote's page with a session secret in the fragment (no cookies);
 *   that page's shell; and the relay's phone end, for that secret only.
 *   Nothing else, not even the slides.
 *
 * The relay passes the phone's intents to the deck and the deck's state
 * to the phone, as server-sent events one way and POSTs the other. The
 * deck stays authoritative (PLAN §4).
 */
import { randomBytes } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces, tmpdir } from 'node:os'
import { dirname, join, normalize, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { isEnvelope, remoteMayAsk, type PresenterMsg } from '@blitzstrahl/runtime/protocol'
import { renderSVG, renderUnicodeCompact } from 'uqr'
import type { Diagnostic } from '@blitzstrahl/core'
import { build } from './build.js'
import { LICENCE_NOTICE } from './html.js'
import { sendFile } from './mime.js'
import { bundleRemote, inlineSafe } from './standalone.js'
import { cacheDir } from './vite.js'

export interface PresentOptions {
  /** Default 5180, or the next free port. */
  port?: number
  /** Open the deck in the default browser (default true). */
  open?: boolean
  /** Serve the deck even with errors. */
  force?: boolean
  quiet?: boolean
}

export interface Presenting {
  ok: true
  /** The deck's warnings (errors too, with `force`). */
  diagnostics: Diagnostic[]
  /** The deck, for this machine: `http://localhost:5180/`. */
  url: string
  port: number
  /** The machine's addresses on its networks, private ones first. */
  addresses: string[]
  /** A new one-time code for a phone: its URL and QR code (the old code stops working). */
  pair(address?: string): { url: string; svg: string; text: string }
  close(): Promise<void>
}

export type PresentResult = Presenting | { ok: false; diagnostics: Diagnostic[] }

const DEFAULT_PORT = 5180
/** Keeps the event streams open through proxies and sleepy radios. */
const KEEPALIVE_MS = 15_000
/** The largest message the relay takes. */
const MAX_BODY = 64 * 1024

export async function present(deckPath: string, options: PresentOptions = {}): Promise<PresentResult> {
  const outDir = await mkdtemp(join(tmpdir(), 'blitzstrahl-present-'))
  const built = await build(deckPath, { outDir, remote: true, overflowCheck: false, quiet: true, force: options.force ?? false, report: false })
  if (!built.ok) {
    await rm(outDir, { recursive: true, force: true })
    return { ok: false, diagnostics: built.diagnostics }
  }
  const deckDir = dirname(resolve(deckPath))
  const remotePage = remoteHtml(await bundleRemote(deckDir, cacheDir(deckDir), true))

  /** The one code that pairs a phone, until it's used or replaced. */
  let code: string | undefined
  /** The paired phone's secret. */
  let session: string | undefined
  const decks = new Set<ServerResponse>()
  const phones = new Set<ServerResponse>()

  const send = (streams: Set<ServerResponse>, msg: PresenterMsg & { blitz: string }) => {
    const line = `data: ${JSON.stringify(msg)}\n\n`
    for (const s of streams) s.write(line)
  }

  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.statusCode = 500
      res.end()
    })
  })

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x')
    const path = url.pathname
    const post = req.method === 'POST'

    // --- the network: pairing, the remote's page, the phone's end of the relay ---
    const pairing = /^\/r\/([\w-]+)$/.exec(path)
    if (pairing && req.method === 'GET') {
      res.setHeader('cache-control', 'no-store')
      res.setHeader('referrer-policy', 'no-referrer')
      if (code && pairing[1] === code) {
        code = undefined
        session = token()
        // The phone paired before is let go.
        for (const s of phones) s.end()
        phones.clear()
        return redirect(res, `/remote#s=${session}`)
      }
      return redirect(res, '/remote')
    }
    if (path === '/remote' && req.method === 'GET') {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.setHeader('referrer-policy', 'no-referrer')
      return res.end(remotePage)
    }
    const phone = (given: string | null | undefined) => !!session && given === session
    if (path === '/_blitz/remote/deck' && req.method === 'GET') {
      if (!phone(header(req, 'x-blitz-session'))) return refuse(res)
      res.setHeader('cache-control', 'no-store')
      return sendFile(req, res, join(outDir, 'index.html'))
    }
    if (path === '/_blitz/remote/events' && req.method === 'GET') {
      if (!phone(url.searchParams.get('s'))) return refuse(res)
      return stream(req, res, phones)
    }
    if (path === '/_blitz/remote/send' && post) {
      if (!phone(header(req, 'x-blitz-session')) || !sameSite(req)) return refuse(res)
      const msg = await body(req)
      // A phone turns slides and starts or pauses the timer; nothing else reaches the deck.
      if (msg && remoteMayAsk(msg)) send(decks, msg)
      return void res.writeHead(204).end()
    }

    // --- this machine only ---
    if (!fromHere(req)) return refuse(res)
    if (path === '/_blitz/remote/deck/events' && req.method === 'GET') return stream(req, res, decks)
    if (path === '/_blitz/remote/deck/send' && post) {
      if (!sameSite(req)) return refuse(res)
      const msg = await body(req)
      // The phone hears where the talk is, and nothing else (no ink).
      if (msg?.type === 'state') send(phones, msg)
      return void res.writeHead(204).end()
    }
    if (path === '/_blitz/remote/pair' && post) {
      if (!sameSite(req)) return refuse(res)
      const p = pair()
      res.setHeader('content-type', 'application/json')
      res.setHeader('cache-control', 'no-store')
      return res.end(JSON.stringify({ url: p.url, svg: p.svg }))
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return refuse(res)
    return serveStatic(req, res, outDir, path)
  }

  const port = await listen(server, options.port ?? DEFAULT_PORT, options.port === undefined)
  const addresses = lanAddresses()
  const keepalive = setInterval(() => {
    for (const s of [...decks, ...phones]) s.write(': keepalive\n\n')
  }, KEEPALIVE_MS)

  function pair(address = addresses[0] ?? 'localhost') {
    code = token()
    const url = `http://${address.includes(':') ? `[${address}]` : address}:${port}/r/${code}`
    return { url, svg: renderSVG(url, { border: 1 }), text: terminalQr(url) }
  }

  const deckUrl = `http://localhost:${port}/`
  if (options.open !== false) openBrowser(deckUrl)

  return {
    ok: true,
    diagnostics: built.diagnostics,
    url: deckUrl,
    port,
    addresses,
    pair,
    async close() {
      clearInterval(keepalive)
      for (const s of [...decks, ...phones]) s.end()
      server.closeAllConnections()
      await new Promise<void>((r) => server.close(() => r()))
      await rm(outDir, { recursive: true, force: true })
    },
  }
}

/** 128 random bits, URL-safe. */
const token = () => randomBytes(16).toString('base64url')

const header = (req: IncomingMessage, name: string) => {
  const v = req.headers[name]
  return Array.isArray(v) ? v[0] : v
}

/**
 * The request comes from this machine and names it by a loopback name: a
 * page elsewhere can't reach it by rebinding a name of its own to 127.0.0.1.
 */
function fromHere(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? ''
  const host = (req.headers.host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(addr) && ['localhost', '127.0.0.1', '::1'].includes(host)
}

/** Our own pages' POSTs: JSON with our header, which another site's page can't send without a preflight. */
const sameSite = (req: IncomingMessage) => header(req, 'x-blitz') === '1' && (header(req, 'content-type') ?? 'application/json').startsWith('application/json')

function refuse(res: ServerResponse) {
  res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  res.end('blitzstrahl present: this is served to the paired remote only.\n')
}

function redirect(res: ServerResponse, to: string) {
  res.writeHead(302, { location: to })
  res.end()
}

/** An event stream kept in `streams` until the other end goes. */
function stream(req: IncomingMessage, res: ServerResponse, streams: Set<ServerResponse>) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
  res.write(': hello\n\n')
  streams.add(res)
  req.on('close', () => streams.delete(res))
}

/** A relay message from a POST's body, or undefined if it isn't one. */
async function body(req: IncomingMessage): Promise<(PresenterMsg & { blitz: string }) | undefined> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY) return undefined
    chunks.push(chunk)
  }
  try {
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return isEnvelope(data) ? (data as PresenterMsg & { blitz: string }) : undefined
  } catch {
    return undefined
  }
}

function serveStatic(req: IncomingMessage, res: ServerResponse, root: string, path: string) {
  let file = join(root, normalize(decodeURIComponent(path)))
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  if (!(file + sep).startsWith(root + sep) || !existsSync(file)) {
    res.statusCode = 404
    return res.end()
  }
  // Chunks and assets are content-hashed: the presenter's previews reuse them instead of fetching again (M12.4).
  res.setHeader('cache-control', path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
  sendFile(req, res, file)
}

/**
 * Listen on every address, IPv6 and IPv4 where the system has both; on the
 * next port if `port` is taken and `next` allows (0: any free port).
 */
async function listen(server: Server, port: number, next: boolean): Promise<number> {
  for (let p = port; p < port + 20; p++) {
    for (const host of ['::', '0.0.0.0']) {
      const err = await new Promise<NodeJS.ErrnoException | undefined>((r) => {
        server.once('error', r)
        server.listen(p, host, () => {
          server.off('error', r)
          r(undefined)
        })
      })
      if (!err) {
        const addr = server.address()
        return addr && typeof addr === 'object' ? addr.port : p
      }
      if (err.code === 'EADDRINUSE') break
      if (err.code !== 'EAFNOSUPPORT' && err.code !== 'EADDRNOTAVAIL') throw err
    }
    if (!next) throw Object.assign(new Error(`port ${p} is taken`), { code: 'EADDRINUSE' })
  }
  throw new Error(`no free port from ${port} to ${port + 19}`)
}

/** This machine's IPv4 addresses on its networks: private ones (a home or office network) first. */
export function lanAddresses(): string[] {
  const all = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a!.address)
  const priv = (a: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)
  return [...all.filter(priv), ...all.filter((a) => !priv(a))]
}

/**
 * The QR code for a terminal. uqr draws it for a dark background (light
 * blocks are the code's light modules); on a light one it would be
 * inverted, which some phone cameras won't read. So on a terminal with
 * colour, each line sets white on black itself.
 */
function terminalQr(url: string): string {
  const text = renderUnicodeCompact(url, { border: 1 })
  if (!process.stdout.isTTY || process.env.NO_COLOR) return text
  return text
    .split('\n')
    .map((line) => `\x1b[97;40m${line}\x1b[0m`)
    .join('\n')
}

function remoteHtml(code: string): string {
  return `<!doctype html>
${LICENCE_NOTICE}
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<meta name="generator" content="blitzstrahl">
<title>blitzstrahl</title>
</head>
<body>
<script type="module">${inlineSafe(code)}</script>
</body>
</html>
`
}

function openBrowser(url: string) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]
  try {
    spawn(cmd, args as string[], { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
  } catch {
    // no browser to open: the address is printed
  }
}
