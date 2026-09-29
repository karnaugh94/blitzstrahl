/**
 * `blitzstrahl export`: the deck as a PDF (PLAN §6), one page per slide at
 * its final step, or with `steps`, one page per build step (handouts).
 *
 * The deck is built statically into a temporary folder, served on the
 * loopback interface and printed by headless Chromium: the runtime lays out
 * the pages (`Deck.print`), waits for charts, tiles and frames, and the
 * browser prints at canvas size, so text stays text. The PDF is tagged, its
 * outline is the slides' headings, and pdf-lib then writes what Chromium
 * doesn't: author, language and date (M11.1).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join, relative, resolve } from 'node:path'
import type { DeckMeta } from '@blitzstrahl/core'
import type { PrintResult } from '@blitzstrahl/runtime'
import { PDFDocument } from 'pdf-lib'
import { NO_BROWSER, launchBrowser } from './browser.js'
import { build } from './build.js'
import { loadDeck } from './load.js'
import { checkOutFile } from './output.js'
import { printDiagnostics } from './report.js'
import { serveFolder } from './serve.js'
import { VERSION } from './version.js'

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
  checkOutFile(file, deck, 'pdf')
  const tmp = await mkdtemp(join(tmpdir(), 'blitz-export-'))
  try {
    const loaded = await loadDeck(deck, relative(process.cwd(), deck) || deckPath)
    const outDir = join(tmp, 'deck')
    const built = await build(deck, { outDir, loaded, overflowCheck: false, quiet: true, report: false, force: options.force ?? false })
    printDiagnostics(built.diagnostics)
    if (!built.ok) return { ok: false, error: 'the deck has errors (use --force to export anyway)', warnings: [] }

    const browser = await launchBrowser()
    if (!browser) return { ok: false, error: `can't export: ${NO_BROWSER}`, warnings: [] }
    const { server, url } = await serveFolder(outDir)
    try {
      // 2x, for sharp screenshots of embedded pages; text and charts stay vector.
      const tab = await browser.newPage({ reducedMotion: 'reduce', deviceScaleFactor: 2 })
      await tab.goto(url)
      await tab.waitForFunction(() => (globalThis as { blitz?: unknown }).blitz, undefined, { timeout: 15_000 })
      const canvas = await tab.evaluate(() => (globalThis as unknown as { blitz: { canvas: { width: number; height: number } } }).blitz.canvas)
      await tab.setViewportSize(canvas)
      const printed = await tab.evaluate(
        (steps) => (globalThis as unknown as { blitz: { print(o: { steps: boolean }): Promise<PrintResult> } }).blitz.print({ steps }),
        options.steps ?? false,
      )
      const frames = await pictureFrames(tab)
      const pdf = await tab.pdf({ width: `${canvas.width}px`, height: `${canvas.height}px`, printBackground: true, preferCSSPageSize: true, tagged: true, outline: true })
      await writeFile(file, await withMetadata(pdf, loaded.deck.meta))
      return { ok: true, file, pages: printed.pages, warnings: [...printed.warnings, ...frames] }
    } finally {
      await browser.close()
      server.close()
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

/**
 * The deck's title, author and language in the PDF's properties, and its
 * `date` as the creation date when it's a calendar date (it's free-form).
 */
export async function withMetadata(pdf: Uint8Array, meta: DeckMeta): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false })
  doc.setTitle(meta.title, { showInWindowTitleBar: true })
  if (meta.author) doc.setAuthor(meta.author)
  doc.setLanguage(meta.lang)
  doc.setCreator(`blitzstrahl ${VERSION}`)
  doc.setProducer(`blitzstrahl ${VERSION}`)
  const now = new Date()
  doc.setCreationDate(calendarDate(meta.date) ?? now)
  doc.setModificationDate(now)
  return doc.save({ useObjectStreams: false })
}

/** `2026-10-14` → that day (UTC); anything else → undefined. */
export function calendarDate(text: string | undefined): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text?.trim() ?? '')
  if (!m) return undefined
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? d : undefined
}

/** Time for an embedded page's own fade-ins after its network goes quiet. */
const FRAME_SETTLE_MS = 600

type Tab = Awaited<ReturnType<NonNullable<Awaited<ReturnType<typeof launchBrowser>>>['newPage']>>

/**
 * Chromium leaves cross-origin frames blank in a PDF (they render in another
 * process), so each embedded page is swapped for a screenshot of itself
 * before printing (PLAN §11's "build-time screenshot fallback"). A page that
 * didn't load is swapped for its `fallback` image, if it has one.
 */
async function pictureFrames(tab: Tab): Promise<string[]> {
  const warnings: string[] = []
  for (const handle of await tab.locator('.blitz-print iframe').elementHandles()) {
    // Chromium doesn't render cross-origin frames that are off screen, and
    // pages keep drawing after their `load` event (a map fetches its tiles):
    // bring each into view and let it settle, within reason.
    await handle.scrollIntoViewIfNeeded()
    await tab.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
    await tab.waitForTimeout(FRAME_SETTLE_MS)
    const src = (await handle.getAttribute('src')) ?? 'an embedded page'
    const frame = await handle.contentFrame()
    if (!frame || frame.url().startsWith('chrome-error:')) {
      const fallback = await handle.evaluate((f) => (f.closest('.blitz-embed') as unknown as { dataset: { fallback?: string } } | null)?.dataset.fallback)
      if (fallback) await swapForImage(handle, fallback, 'blitz-embed-fallback')
      warnings.push(fallback ? `${src} didn't load; the PDF shows its fallback image` : `${src} didn't load; its frame is blank in the PDF`)
      continue
    }
    const png = await handle.screenshot({ type: 'png' })
    await swapForImage(handle, `data:image/png;base64,${png.toString('base64')}`, 'blitz-embed-shot')
  }
  return warnings
}

async function swapForImage(handle: Awaited<ReturnType<Tab['$']>> & object, src: string, className: string) {
  await handle.evaluate(
    (f, [url, cls]) => {
      const img = f.ownerDocument.createElement('img')
      img.className = cls!
      img.src = url!
      img.alt = ''
      img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top;max-width:none;max-height:none;border-radius:0'
      f.replaceWith(img)
      return img.decode().catch(() => {})
    },
    [src, className],
  )
}

