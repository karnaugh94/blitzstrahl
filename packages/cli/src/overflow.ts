/**
 * The build-time overflow check (PLAN §7): load the built deck in a headless
 * browser, let the runtime measure every slide, and report each problem as
 * a warning at the slide's `deck.md:line:col`.
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join, normalize, sep } from 'node:path'
import type { Deck, Diagnostic } from '@blitzstrahl/core'
import { describeOverflow, type Overflow } from '@blitzstrahl/runtime/overflow-report'
import { INSTALL_BROWSER, launchBrowser } from './browser.js'
import { mimeType } from './mime.js'

export interface OverflowCheck {
  diagnostics: Diagnostic[]
  /** Why the check couldn't run (no browser), if it didn't. */
  skipped?: string
}

/**
 * Findings from the runtime → diagnostics, one per problem, at the slide's
 * first non-blank line (`source` is the markdown, to find it).
 */
export function overflowDiagnostics(deck: Deck, found: Overflow[], source?: string): Diagnostic[] {
  const lines = source?.replace(/\r\n?/g, '\n').split('\n')
  return found.flatMap((o) => {
    const slide = deck.slides[o.slide]
    if (!slide) return []
    let line = slide.span.start.line
    while (lines && line < slide.span.end.line && !lines[line - 1]?.trim()) line++
    const point = { line, column: 1 }
    const at = { start: point, end: point }
    const problems = describeOverflow(o)
    const canvas = Object.values(o.beyond).some((v) => v > 0)
    return problems.map((text, k): Diagnostic => ({
      severity: 'warning',
      code: canvas && k === 0 ? 'overflow/canvas' : 'overflow/clipped',
      message: `slide \`${o.id}\` overflows: ${text}`,
      file: deck.source,
      span: at,
    }))
  })
}


/** Serve `root` on a free local port (module scripts need HTTP, not file://). */
async function serve(root: string): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    let file = join(root, normalize(decodeURIComponent((req.url ?? '/').split('?')[0]!)))
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
    if (!(file + sep).startsWith(root + sep) && file !== root) file = ''
    if (!file || !existsSync(file)) {
      res.statusCode = 404
      res.end()
      return
    }
    res.setHeader('content-type', mimeType(file))
    createReadStream(file).pipe(res)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('no port')
  return { server, url: `http://127.0.0.1:${addr.port}/` }
}

/** `page` is the file to open inside `outDir` (default: its index.html). */
export async function checkBuiltOverflow(outDir: string, deck: Deck, source?: string, page = ''): Promise<OverflowCheck> {
  const browser = await launchBrowser()
  if (!browser) {
    return { diagnostics: [], skipped: `no browser to measure slides with; install one with ${INSTALL_BROWSER}` }
  }
  const { server, url } = await serve(outDir)
  try {
    const tab = await browser.newPage({ viewport: deck.meta.canvas, reducedMotion: 'reduce' })
    await tab.goto(url + encodeURIComponent(page))
    await tab.waitForFunction(() => (globalThis as { blitz?: unknown }).blitz, undefined, { timeout: 15_000 })
    const found = await tab.evaluate(() => (globalThis as unknown as { blitz: { checkOverflow(): Promise<Overflow[]> } }).blitz.checkOverflow())
    return { diagnostics: overflowDiagnostics(deck, found, source) }
  } finally {
    await browser.close()
    server.close()
  }
}
