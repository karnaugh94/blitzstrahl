/**
 * The build-time overflow check (PLAN §7): load the built deck in a headless
 * browser, let the runtime measure every slide, and report each problem as
 * a warning at the slide's `deck.md:line:col`.
 */
import type { Deck, Diagnostic } from '@blitzstrahl/core'
import { describeOverflow, type Overflow } from '@blitzstrahl/runtime/overflow-report'
import { INSTALL_BROWSER, launchBrowser } from './browser.js'
import { serveFolder } from './serve.js'

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

/** `page` is the file to open inside `outDir` (default: its index.html). */
export async function checkBuiltOverflow(outDir: string, deck: Deck, source?: string, page = ''): Promise<OverflowCheck> {
  const browser = await launchBrowser()
  if (!browser) {
    return { diagnostics: [], skipped: `no browser to measure slides with; install one with ${INSTALL_BROWSER}` }
  }
  const { server, url } = await serveFolder(outDir)
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
