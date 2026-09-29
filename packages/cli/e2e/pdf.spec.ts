/**
 * PDF export (PLAN §6): the runtime's print layout, and `exportPdf` end to end.
 */
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { PDFDict, PDFDocument, PDFName, type PDFArray, type PDFRef } from 'pdf-lib'
import { exportPdf } from '../dist/index.js'
import { buildAndServe } from './serve.js'

const here = dirname(fileURLToPath(import.meta.url))
let url = ''
let server: Server

test.beforeAll(async () => {
  ;({ url, server } = await buildAndServe(join(here, 'fixtures/pdf.md')))
})

test.afterAll(() => server?.close())
test.use({ reducedMotion: 'reduce' })

test.beforeEach(async ({ page }) => {
  // Slow tiles, so printing has to wait for them.
  await page.route('https://tile.openstreetmap.org/**', async (route) => {
    await new Promise((r) => setTimeout(r, 800))
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#dde"/></svg>' })
  })
})

async function print(page: Page, steps: boolean) {
  await page.goto(url)
  await page.waitForFunction(() => window.blitz)
  return page.evaluate((s) => window.blitz!.print({ steps: s }), steps)
}

const pages = (page: Page) => page.locator('.blitz-print > .blitz-slide')

test('one page per slide, at its final step, with everything rendered', async ({ page }) => {
  const r = await print(page, false)
  expect(r).toEqual({ pages: 4, warnings: [] })
  await expect(pages(page)).toHaveCount(4)
  await expect(page.locator('.blitz-viewport')).toBeHidden()

  const steps = pages(page).nth(1)
  await expect(steps.locator('#first')).not.toHaveAttribute('data-blitz-hidden')
  await expect(steps.locator('#second')).not.toHaveAttribute('data-blitz-hidden')
  await expect(steps.locator('#stressed')).toHaveAttribute('data-blitz-active')

  // Ready means rendered: the chart's bars and the map's tiles are there.
  expect(await pages(page).nth(2).locator('#chart svg path').count()).toBeGreaterThan(2)
  const tiles = pages(page).nth(3).locator('.blitz-tile')
  expect(await tiles.count()).toBeGreaterThan(0)
  expect(await tiles.evaluateAll((els) => els.every((i) => (i as HTMLImageElement).complete))).toBe(true)
  expect(await pages(page).nth(3).locator('svg path[d^="M1 0A1 1"]').count()).toBe(1)

  const size = await pages(page).first().evaluate((el) => [el.offsetWidth, el.offsetHeight])
  expect(size).toEqual([1280, 720])
})

test('--steps: a page for every state of every slide', async ({ page }) => {
  const r = await print(page, true)
  expect(r.pages).toBe(1 + 3 + 1 + 1)
  const step = (n: number) => pages(page).nth(1 + n)
  await expect(step(0).locator('#first')).toHaveAttribute('data-blitz-hidden')
  await expect(step(0).locator('#stressed')).not.toHaveAttribute('data-blitz-active')
  await expect(step(1).locator('#first')).not.toHaveAttribute('data-blitz-hidden')
  await expect(step(1).locator('#second')).toHaveAttribute('data-blitz-hidden')
  await expect(step(1).locator('#stressed')).toHaveAttribute('data-blitz-active')
  await expect(step(2).locator('#second')).not.toHaveAttribute('data-blitz-hidden')
})

test('export writes a PDF: a page per slide, at the canvas size', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'blitz-pdf-')), 'deck.pdf')
  // No map here: the exporter's own browser would fetch real tiles.
  const r = await exportPdf(join(here, 'fixtures/nav.md'), { outFile: out, quiet: true })
  expect(r.ok).toBe(true)
  const pdf = readFileSync(out, 'latin1')
  expect(pdf.startsWith('%PDF-')).toBe(true)
  const count = (pdf.match(/\/Type\s*\/Page\b/g) ?? []).length
  expect(count).toBe(r.pages)
  expect(r.pages).toBeGreaterThan(2)
  // 1280×720 CSS px = 960×540 pt.
  expect(pdf).toMatch(/\/MediaBox\s*\[\s*0 0 960 540\s*\]/)
})

test('embedded pages are in the PDF as pictures; one that fails prints its fallback', async () => {
  // Chromium prints cross-origin frames blank, so export photographs them.
  const site = createServer((_, res) => {
    res.setHeader('content-type', 'text/html')
    res.end('<body style="background:#fc6;font:60px sans-serif">Framed</body>')
  })
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r))
  const port = (site.address() as { port: number }).port
  const dir = mkdtempSync(join(tmpdir(), 'blitz-pdf-embed-'))
  copyFileSync(join(here, 'fixtures/shot.svg'), join(dir, 'shot.svg'))
  const deck = join(dir, 'deck.md')
  writeFileSync(
    deck,
    `# Live\n\n\`\`\`embed\nsrc: http://127.0.0.1:${port}/\n\`\`\`\n\n---\n\n# Down\n\n\`\`\`embed\nsrc: http://127.0.0.1:9/\nfallback: ./shot.svg\n\`\`\`\n`,
  )
  try {
    const r = await exportPdf(deck, { quiet: true })
    expect(r.ok).toBe(true)
    expect(r.warnings).toEqual(['http://127.0.0.1:9/ didn\'t load; the PDF shows its fallback image'])
    const images = (readFileSync(r.file!, 'latin1').match(/\/Subtype\s*\/Image/g) ?? []).length
    expect(images).toBeGreaterThanOrEqual(2)
  } finally {
    site.close()
  }

  // A deck without embeds or images has no pictures at all: charts stay vector.
  const plain = await exportPdf(join(here, 'fixtures/nav.md'), { outFile: join(dir, 'nav.pdf'), quiet: true })
  expect((readFileSync(plain.file!, 'latin1').match(/\/Subtype\s*\/Image/g) ?? []).length).toBe(0)
})


/** Each bookmark's title, depth and page (from 1). */
async function outline(file: string) {
  const doc = await PDFDocument.load(readFileSync(file), { updateMetadata: false })
  const pages = doc.getPages().map((p) => p.ref.toString())
  const found: string[] = []
  const walk = (item: PDFDict | undefined, depth: number) => {
    for (; item; item = item.lookupMaybe(PDFName.of('Next'), PDFDict)) {
      const title = (item.lookup(PDFName.of('Title')) as unknown as { decodeText(): string }).decodeText()
      const dest = item.lookup(PDFName.of('Dest')) as PDFArray
      found.push(`${'  '.repeat(depth)}${title} p${pages.indexOf((dest.get(0) as PDFRef).toString()) + 1}`)
      walk(item.lookupMaybe(PDFName.of('First'), PDFDict), depth + 1)
    }
  }
  walk(doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict)?.lookupMaybe(PDFName.of('First'), PDFDict), 0)
  return { doc, found }
}

test('the PDF is tagged, bookmarked by heading, and carries the deck\'s metadata (M11.1)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-pdf-a11y-'))
  const deck = join(dir, 'deck.md')
  writeFileSync(
    deck,
    '---\ntitle: Quarterly review\nauthor: Ada Lovelace\ndate: 2026-10-14\nlang: de\n---\n\n# Opening\n\n---\n\n# Results\n\n## East {@1}\n\nRose.\n\n## West {@2}\n\nFell.\n\n---\n\nNo heading on this slide.\n',
  )
  const r = await exportPdf(deck, { quiet: true })
  expect(r.ok).toBe(true)
  const { doc, found } = await outline(r.file!)
  expect(found).toEqual(['Opening p1', 'Results p2', '  East p2', '  West p2'])
  expect(doc.getTitle()).toBe('Quarterly review')
  expect(doc.getAuthor()).toBe('Ada Lovelace')
  expect(doc.catalog.lookup(PDFName.of('Lang'))?.toString()).toBe('(de)')
  expect(doc.getCreationDate()?.toISOString()).toBe('2026-10-14T00:00:00.000Z')
  expect(doc.catalog.lookupMaybe(PDFName.of('StructTreeRoot'), PDFDict)).toBeDefined()
  expect(doc.catalog.lookup(PDFName.of('MarkInfo'), PDFDict).get(PDFName.of('Marked'))?.toString()).toBe('true')

  // --steps: a heading is bookmarked on the first page that shows it, once.
  const steps = await exportPdf(deck, { outFile: join(dir, 'steps.pdf'), steps: true, quiet: true })
  expect(steps.pages).toBe(1 + 3 + 1)
  expect((await outline(steps.file!)).found).toEqual(['Opening p1', 'Results p2', '  East p3', '  West p4'])
})

test('a free-form date leaves the creation date at export time', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-pdf-date-'))
  const deck = join(dir, 'deck.md')
  writeFileSync(deck, '---\ndate: Autumn 2026\n---\n\n# One\n')
  const before = Date.now() - 2000
  const r = await exportPdf(deck, { quiet: true })
  const { doc } = await outline(r.file!)
  expect(doc.getCreationDate()!.getTime()).toBeGreaterThan(before)
  expect(doc.getAuthor()).toBeUndefined()
})
