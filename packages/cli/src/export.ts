/**
 * `blitzstrahl export`: the deck as a PDF (PLAN §6), one page per slide at
 * its final step, or with `steps`, one page per build step (handouts).
 *
 * The deck is built standalone into a temporary folder and printed by
 * headless Chromium: the runtime lays out the pages (`Deck.print`), waits
 * for charts, tiles and frames, and the browser prints at canvas size, so
 * text stays text.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PrintResult } from '@blitzstrahl/runtime'
import { NO_BROWSER, launchBrowser } from './browser.js'
import { build } from './build.js'

export interface ExportOptions {
  /** The PDF to write. Default: the deck's name with `.pdf`, next to it. */
  outFile?: string
  /** One page per build step. */
  steps?: boolean
  /** Export even if the deck has errors. */
  force?: boolean
  quiet?: boolean
}

export interface ExportResult {
  ok: boolean
  file?: string
  pages?: number
  /** Why it failed, when it did. */
  error?: string
  /** Blocks that weren't ready in time and were printed as they were. */
  warnings: string[]
}

export async function exportPdf(deckPath: string, options: ExportOptions = {}): Promise<ExportResult> {
  const deck = resolve(deckPath)
  const file = resolve(options.outFile ?? join(resolve(deck, '..'), `${basename(deck, extname(deck))}.pdf`))
  const tmp = await mkdtemp(join(tmpdir(), 'blitz-export-'))
  try {
    const page = join(tmp, 'deck.html')
    const built = await build(deck, { standalone: true, outFile: page, overflowCheck: false, quiet: true, force: options.force ?? false })
    if (!built.ok) return { ok: false, error: 'the deck has errors (use --force to export anyway)', warnings: [] }

    const browser = await launchBrowser()
    if (!browser) return { ok: false, error: `can't export: ${NO_BROWSER}`, warnings: [] }
    try {
      const tab = await browser.newPage({ reducedMotion: 'reduce' })
      await tab.goto(pathToFileURL(page).href)
      await tab.waitForFunction(() => (globalThis as { blitz?: unknown }).blitz, undefined, { timeout: 15_000 })
      const canvas = await tab.evaluate(() => (globalThis as unknown as { blitz: { canvas: { width: number; height: number } } }).blitz.canvas)
      await tab.setViewportSize(canvas)
      const printed = await tab.evaluate(
        (steps) => (globalThis as unknown as { blitz: { print(o: { steps: boolean }): Promise<PrintResult> } }).blitz.print({ steps }),
        options.steps ?? false,
      )
      await tab.pdf({ path: file, width: `${canvas.width}px`, height: `${canvas.height}px`, printBackground: true, preferCSSPageSize: true })
      return { ok: true, file, pages: printed.pages, warnings: printed.warnings }
    } finally {
      await browser.close()
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}
