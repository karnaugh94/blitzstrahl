/**
 * The `mermaid` renderer (syntax.md §8, docs/renderers/mermaid.md): drawn
 * in the deck's colours and type, fitted to its block, loaded only when a
 * slide needs it.
 */
import type { Server } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { check } from '../dist/index.js'
import { buildAndServe } from './serve.js'

const here = dirname(fileURLToPath(import.meta.url))
const deck = join(here, 'fixtures/mermaid.md')
let url = ''
let server: Server

test.beforeAll(async () => {
  ;({ url, server } = await buildAndServe(deck))
})

test.afterAll(() => server?.close())

const open = async (page: Page, hash: string) => {
  await page.goto(url + hash)
  await page.waitForFunction(() => window.blitz)
}

const token = (page: Page, name: string) =>
  page.evaluate((n) => {
    const probe = document.createElement('span')
    probe.style.color = `var(--blitz-${n})`
    document.querySelector('.blitz-slide')!.append(probe)
    const c = getComputedStyle(probe).color
    probe.remove()
    return c
  }, name)

test('a flowchart is drawn in the theme’s colours and type, inside its block', async ({ page }) => {
  await open(page, '#/flow')
  const node = page.locator('#flow .node').filter({ hasText: 'Deck IR' })
  await expect(node).toBeVisible()
  const shape = node.locator('polygon, rect, path').first()
  const [fill, stroke] = await shape.evaluate((e) => [getComputedStyle(e).fill, getComputedStyle(e).stroke])
  expect(fill).toBe(await token(page, 'surface-2'))
  expect(stroke).toBe(await token(page, 'accent'))
  const font = await node.evaluate((e) => getComputedStyle(e.querySelector('span, text')!).fontFamily)
  expect(font).toContain('Inter')

})

test('a diagram taller than its block is scaled down to fit', async ({ page }) => {
  await open(page, '#/sequence')
  await expect(page.locator('#seq svg')).toBeVisible()
  const natural = await page.locator('#seq svg').evaluate((s) => (s as SVGSVGElement).viewBox.baseVal.height)
  const [block, svg] = await Promise.all([page.locator('#seq').boundingBox(), page.locator('#seq svg').boundingBox()])
  expect(natural).toBeGreaterThan(block!.height)
  expect(svg!.y).toBeGreaterThanOrEqual(block!.y - 1)
  expect(svg!.y + svg!.height).toBeLessThanOrEqual(block!.y + block!.height + 1)
  expect(svg!.x + svg!.width).toBeLessThanOrEqual(block!.x + block!.width + 1)
})

test('Mermaid only loads when a slide with a diagram is entered', async ({ page }) => {
  const scripts: string[] = []
  page.on('request', (r) => {
    if (r.resourceType() === 'script') scripts.push(new URL(r.url()).pathname)
  })
  await open(page, '')
  await page.waitForLoadState('networkidle')
  const before = scripts.length
  expect(scripts.some((s) => /mermaid/i.test(s))).toBe(false)
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('#flow svg')).toBeVisible()
  expect(scripts.length).toBeGreaterThan(before)
})

test('a stepped diagram is drawn when its step comes', async ({ page }) => {
  await open(page, '#/later-slide')
  await expect(page.locator('#stepped')).toBeHidden()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('#stepped svg')).toBeVisible()
})

test('a diagram Mermaid can’t read says why, on the slide, and leaves nothing behind', async ({ page }) => {
  await open(page, '#/broken')
  await expect(page.locator('[data-blitz-current] .blitz-block-error')).toContainText('Parse error')
  expect(await page.evaluate(() => document.querySelectorAll('body > :not(.blitz-viewport, .blitz-blackout, .blitz-layer, script, template)').length)).toBe(0)
})

test('`check` reports the syntax error at its block', async () => {
  const r = await check(deck, { offline: true, overflow: false })
  expect(r.diagnostics.filter((d) => d.code === 'renderer/mermaid').map((d) => [d.span.start.line, d.message])).toEqual([
    [56, expect.stringMatching(/^`mermaid` block: Parse error on line \d+: Expecting .*got 'EOF'$/)],
  ])
})

test('every diagram prints: PDF export lays them all out at once, with the deck hidden', async ({ page }) => {
  await open(page, '')
  const result = await page.evaluate(() => window.blitz!.print())
  expect(result.pages).toBe(6)
  const blocks = page.locator('.blitz-print [data-blitz-block]')
  await expect(blocks).toHaveCount(5)
  // Four diagrams draw; the broken one shows its error.
  await expect(page.locator('.blitz-print [data-blitz-block] .blitz-mermaid svg')).toHaveCount(4)
  await expect(page.locator('.blitz-print .blitz-block-error')).toHaveCount(1)
  const legend = await page.locator('.blitz-print .legend text').allTextContents()
  expect(legend).toEqual(['Writing', 'Slides', 'Rehearsal'])
})

test('a deck without diagrams doesn’t ship Mermaid', async () => {
  const { readdirSync, readFileSync, mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { build } = await import('../dist/index.js')
  const outDir = mkdtempSync(join(tmpdir(), 'blitz-nomermaid-'))
  const r = await build(join(here, 'fixtures/charts.md'), { outDir, quiet: true, overflowCheck: false })
  expect(r.ok).toBe(true)
  const scripts = readdirSync(join(outDir, 'assets')).filter((f) => f.endsWith('.js'))
  expect(scripts.filter((f) => readFileSync(join(outDir, 'assets', f), 'utf8').includes('mermaid'))).toEqual([])
  expect(scripts.length).toBeLessThan(6)
})
