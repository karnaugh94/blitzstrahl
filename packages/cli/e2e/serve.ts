import { createReadStream, existsSync, mkdtempSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { build, type BuildOptions, type BuildResult } from '../dist/index.js'

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }

/** Minimal static server for built decks. */
export async function serve(root: string): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    let file = join(root, normalize(decodeURIComponent((req.url ?? '/').split('?')[0]!)))
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
    if (!file.startsWith(root) || !existsSync(file)) {
      res.statusCode = 404
      res.end()
      return
    }
    res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream')
    createReadStream(file).pipe(res)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${addr.port}/`, server }
}

/**
 * Build a deck with the real CLI into a temp dir and serve it. The overflow
 * check (a second browser) is off unless a test asks for it.
 */
export async function buildAndServe(deck: string, options: BuildOptions = {}): Promise<{ url: string; server: Server; result: BuildResult }> {
  const outDir = mkdtempSync(join(tmpdir(), 'blitz-e2e-'))
  const result = await build(deck, { outDir, quiet: true, overflowCheck: false, ...options })
  if (!result.ok) throw new Error(`build of ${deck} failed`)
  return { ...(await serve(outDir)), result }
}
