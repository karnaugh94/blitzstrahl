/**
 * Document mode (`?mode=doc`, M11.4) and the handout it prints (M11.2):
 * every slide in one page at its final step, from `file://`; notes with
 * `&notes`; printed two slides to a landscape sheet; `export --notes`.
 */
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { build, exportPdf } from '../dist/index.js'
import { serve } from './serve.js'

const here = dirname(fileURLToPath(import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'blitz-doc-'))
copyFileSync(join(here, 'fixtures/data.csv'), join(dir, 'data.csv'))
copyFileSync(join(here, 'fixtures/media/clip.webm'), join(dir, 'clip.webm'))

const LONG = Array.from({ length: 14 }, () => 'This paragraph is here to make the note far too long for half a sheet, so the handout gives its slide a sheet of its own.').join('\n\n')

writeFileSync(
  join(dir, 'deck.md'),
  `---
title: Document fixture
transition: none
---

# Reading

::: notes
Welcome, and **thanks** for coming.
:::

---

# Steps

First {#first @1}

Second {#second @2}

Only while the first shows {#gone @1-1}

---

# A chart

\`\`\`chart {#chart}
type: bar
data: ./data.csv
x: k
y: v
\`\`\`

::: notes
${LONG}
:::

---

# A clip

![](./clip.webm){width=320}

---

# Last {#last-heading}

::: notes
The end.
:::
`,
)

let file = ''
let url = ''
let server: Server
test.beforeAll(async () => {
  file = join(dir, 'deck.html')
  expect((await build(join(dir, 'deck.md'), { standalone: true, outFile: file, quiet: true, overflowCheck: false })).ok).toBe(true)
  const out = join(dir, 'dist')
  expect((await build(join(dir, 'deck.md'), { outDir: out, quiet: true, overflowCheck: false })).ok).toBe(true)
  ;({ url, server } = await serve(out))
})
test.afterAll(() => server?.close())
test.use({ reducedMotion: 'reduce' })

async function openDoc(page: Page, query = '', hash = '') {
  await page.goto(`${pathToFileURL(file).href}?mode=doc${query}${hash}`)
  await page.waitForFunction(() => (window as unknown as { blitzDocument?: unknown }).blitzDocument)
}

const pages = (page: Page) => page.locator('.blitz-doc-page')

test('every slide in one page, at its final step, as its own HTML, from file://', async ({ page }) => {
  await openDoc(page)
  await expect(pages(page)).toHaveCount(5)
  await expect(page.locator('.blitz-viewport')).toBeHidden()
  // Headings intact, nothing held back for a later step.
  await expect(page.locator('.blitz-doc h1')).toHaveText(['Reading', 'Steps', 'A chart', 'A clip', 'Last'])
  await expect(page.locator('#second')).toBeVisible()
  // …and nothing that has left by then.
  await expect(page.locator('#gone')).toBeHidden()
  await expect(page.locator('.blitz-doc [data-blitz-hidden]')).toHaveCount(1)
  // Each slide once: they're the deck's own, moved, not copied.
  expect(await page.locator('#first').count()).toBe(1)
  // Scaled to the width, never beyond the canvas.
  const w = await pages(page).first().locator('.blitz-doc-frame').evaluate((f) => f.getBoundingClientRect().width)
  expect(w).toBeLessThanOrEqual(1280)
  expect(w).toBeGreaterThan(600)
  // Video waits for the reader.
  const clip = page.locator('.blitz-doc video')
  await expect(clip).toHaveJSProperty('controls', true)
  await expect(clip).toHaveJSProperty('paused', true)
  // No notes unless asked for.
  await expect(page.locator('.blitz-doc-notes')).toHaveCount(0)
})

test('charts are drawn as they scroll into view', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 500 })
  await openDoc(page)
  await pages(page).nth(2).scrollIntoViewIfNeeded()
  await expect.poll(() => page.locator('#chart svg path').count()).toBeGreaterThan(2)
})

test('&notes shows each slide\'s notes; a slide\'s address scrolls to it', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 500 })
  await openDoc(page, '&notes', '#/last-heading')
  await expect(page.locator('.blitz-doc-notes')).toHaveCount(3)
  await expect(page.locator('.blitz-doc-notes').first()).toContainText('Welcome, and thanks for coming.')
  await expect(page.locator('.blitz-doc-notes strong').first()).toHaveText('thanks')
  await expect(pages(page).last()).toBeInViewport()
  await expect(pages(page).first()).not.toBeInViewport()
})

test('Present goes back to the deck at the slide being read; R comes here', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 500 })
  await openDoc(page, '', '#/steps')
  await page.getByRole('link', { name: 'Present' }).click()
  await page.waitForFunction(() => window.blitz)
  expect(page.url()).not.toContain('mode=doc')
  await expect.poll(() => page.evaluate(() => window.blitz!.pos?.slide)).toBe(1)

  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('r')
  await page.waitForFunction(() => (window as unknown as { blitzDocument?: unknown }).blitzDocument)
  expect(new URL(page.url()).searchParams.get('mode')).toBe('doc')
  expect(new URL(page.url()).hash).toBe('#/a-chart')
  await expect(pages(page).nth(2)).toBeInViewport()
})

test('the presenter view opens the document in a new tab', async ({ page, context }) => {
  await page.goto(`${url}#presenter`)
  const [doc] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: /Read the deck as one page/ }).click()])
  await doc.waitForFunction(() => (window as unknown as { blitzDocument?: unknown }).blitzDocument)
  expect(new URL(doc.url()).searchParams.get('mode')).toBe('doc')
})

/** Page count and the first page's size in points. */
async function pdfShape(pdf: Buffer | Uint8Array) {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false })
  const { width, height } = doc.getPage(0).getSize()
  return { pages: doc.getPageCount(), width: Math.round(width), height: Math.round(height) }
}

test('printed, every sheet is two slides; notes too long carry on after the sheets', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { sheets: string[][] }).sheets = []
    window.print = () => {
      ;(window as unknown as { sheets: string[][] }).sheets.push([...document.querySelectorAll('.blitz-doc-sheet')].map((s) => [...s.querySelectorAll('h1')].map((h) => h.textContent ?? '').join('+')))
    }
  })
  await openDoc(page, '&notes')
  await page.keyboard.press('Control+p')
  await page.waitForFunction(() => (window as unknown as { sheets: string[][] }).sheets.length === 1)
  const [sheets] = await page.evaluate(() => (window as unknown as { sheets: string[][] }).sheets)
  expect(sheets).toEqual(['Reading+Steps', 'A chart+A clip', 'Last'])
  // The long note keeps what fits, and says where the rest is.
  const chartNotes = pages(page).nth(2).locator('.blitz-doc-notes')
  await expect(chartNotes.locator('.blitz-doc-more')).toHaveText('Continued on page 4.')
  const continued = page.locator('.blitz-doc-continued')
  await expect(continued.locator('h1')).toHaveText('Notes, continued')
  await expect(continued.locator('h2')).toHaveText(['3. A chart'])
  // Nothing lost, nothing twice: the paragraphs are split between the two.
  const kept = await chartNotes.locator('p:not(.blitz-doc-more)').count()
  const moved = await continued.locator('p').count()
  expect(kept).toBeGreaterThan(0)
  expect(kept + moved).toBe(14)
  // Its chart was drawn before the dialog, though never scrolled to.
  expect(await page.locator('#chart svg path').count()).toBeGreaterThan(2)
  const shape = await pdfShape(await page.pdf({ preferCSSPageSize: true }))
  expect([shape.width, shape.height]).toEqual([842, 595])
  // One page per sheet, then the continuation.
  expect(shape.pages).toBe(4)

  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await expect(page.locator('.blitz-doc-sheet')).toHaveCount(0)
  await expect(pages(page)).toHaveCount(5)
  // On screen again, the note is whole.
  await expect(continued).toHaveCount(0)
  expect(await chartNotes.locator('p').count()).toBe(14)
})

test('&orientation=portrait prints two rows to a portrait sheet', async ({ page }) => {
  await openDoc(page, '&notes&orientation=portrait')
  await page.evaluate(() => (window as unknown as { blitzDocument: { print(): Promise<unknown> } }).blitzDocument.print())
  const shape = await pdfShape(await page.pdf({ preferCSSPageSize: true }))
  expect([shape.width, shape.height]).toEqual([595, 842])
})

test('export --notes writes the handout, and names a slide whose notes are too long', async () => {
  const out = join(dir, 'handout.pdf')
  const r = await exportPdf(join(dir, 'deck.md'), { notes: true, outFile: out, quiet: true })
  expect(r.ok).toBe(true)
  expect(r.warnings).toHaveLength(1)
  expect(r.warnings[0]).toMatch(/^slide 3 \(A chart\): its notes are about \d+ characters too long for half a sheet; they continue on page 4$/)
  const bytes = readFileSync(out)
  const shape = await pdfShape(bytes)
  expect([shape.width, shape.height]).toEqual([842, 595])
  expect(shape.pages).toBe(r.pages)
  expect(shape.pages).toBe(4)
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  expect(doc.getTitle()).toBe('Document fixture')
})
