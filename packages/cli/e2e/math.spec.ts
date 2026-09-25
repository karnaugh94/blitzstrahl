/**
 * Math (syntax.md §12): Pandoc's dollar rules, rendered by KaTeX when the
 * deck is built, with KaTeX's fonts served (static) or inlined (standalone).
 */
import type { Server } from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { build, type BuildResult } from '../dist/index.js'
import { buildAndServe } from './serve.js'

const here = dirname(fileURLToPath(import.meta.url))
const deck = join(here, 'fixtures/math.md')
let url = ''
let server: Server
let built: BuildResult

test.beforeAll(async () => {
  ;({ url, server, result: built } = await buildAndServe(deck))
})

test.afterAll(() => server?.close())

/** The KaTeX font faces that finished loading. */
const loadedFonts = (page: Page) =>
  page.evaluate(async () => {
    await document.fonts.ready
    return [...document.fonts].filter((f) => f.family.startsWith('KaTeX') && f.status === 'loaded').map((f) => f.family)
  })

test('formulas are typeset, with MathML for screen readers, and prices stay text', async ({ page }) => {
  await page.goto(`${url}#/formulas`)
  await page.waitForFunction(() => window.blitz)
  const slide = page.locator('[data-blitz-current]')
  await expect(slide.locator('.math-inline .katex').first()).toBeVisible()
  await expect(slide.locator('.math-display .katex-display')).toHaveCount(2)
  expect(await slide.locator('.katex-mathml math annotation').first().textContent()).toBe('\\frac{a}{b}')
  await expect(slide.getByText('a price of $20 to $30.')).toBeVisible()
  expect(await loadedFonts(page)).toEqual(expect.arrayContaining(['KaTeX_Main', 'KaTeX_Math']))
})

test('math takes build steps like any element', async ({ page }) => {
  await page.goto(`${url}#/formulas`)
  await page.waitForFunction(() => window.blitz)
  await expect(page.locator('#squared')).toBeHidden()
  await expect(page.locator('#fence')).toBeHidden()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('#squared .katex')).toBeVisible()
  await expect(page.locator('#fence')).toBeHidden()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('#fence .katex-display')).toBeVisible()
})

test('TeX that KaTeX can’t read is a warning at its line, shown as its source', async ({ page }) => {
  expect(built.diagnostics).toContainEqual(expect.objectContaining({ code: 'math/tex', span: expect.objectContaining({ start: { line: 28, column: 2 } }) }))
  await page.goto(`${url}#/broken`)
  await page.waitForFunction(() => window.blitz)
  await expect(page.locator('[data-blitz-current] .katex-error')).toHaveText('\\frac{1}{')
})

test('a standalone file carries the fonts its math uses, and no others', async ({ page }) => {
  const outFile = join(mkdtempSync(join(tmpdir(), 'blitz-math-')), 'math.html')
  const r = await build(deck, { standalone: true, outFile, quiet: true, overflowCheck: false })
  expect(r.ok).toBe(true)
  const html = readFileSync(outFile, 'utf8')
  const faces = [...html.matchAll(/@font-face\{[^}]*font-family:(KaTeX_\w+)/g)].map((m) => m[1])
  expect(new Set(faces)).toEqual(new Set(['KaTeX_Main', 'KaTeX_Math', 'KaTeX_Size2']))
  expect(/url\(fonts\//.test(html), 'no font left to fetch').toBe(false)

  const fileUrl = pathToFileURL(outFile).href
  const fetched: string[] = []
  page.on('request', (req) => {
    if (req.url() !== fileUrl && !req.url().startsWith('data:')) fetched.push(req.url())
  })
  await page.goto(`${fileUrl}#/formulas`)
  await page.waitForFunction(() => window.blitz)
  expect(await loadedFonts(page)).toEqual(expect.arrayContaining(['KaTeX_Main', 'KaTeX_Math', 'KaTeX_Size2']))
  expect(fetched).toEqual([])
})
