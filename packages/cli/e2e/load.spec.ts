/**
 * The presenter view's load (PLAN §15, M12.4): its page and its two
 * previews against the audience window alone, on a deck with a chart, a
 * map, a diagram and an embedded page. Target: at most twice the
 * audience's memory and network. Measured without HTTP caching (this
 * server sends no cache headers), so every preview fetches its own copy:
 * the worst case.
 */
import type { Server } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { buildAndServe } from './serve.js'

const here = dirname(fileURLToPath(import.meta.url))
let url = ''
let server: Server

test.beforeAll(async () => {
  ;({ url, server } = await buildAndServe(join(here, 'fixtures/heavy.md')))
})

test.afterAll(() => server?.close())

/** A weighty embedded page (a dashboard's script), and map tiles: all local. */
const EMBED = `<!doctype html><title>Dashboard</title><h1>Dashboard</h1><script>var x = "${'a'.repeat(300_000)}"</script>`
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

interface Measured {
  ctx: BrowserContext
  /** Bytes that crossed the network, per page (its same-origin frames included). */
  bytes: Map<Page, number>
}

async function context(browser: Browser): Promise<Measured> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.route('https://embed.test/**', (r) => r.fulfill({ contentType: 'text/html', body: EMBED }))
  await ctx.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ contentType: 'image/png', body: TILE }))
  const bytes = new Map<Page, number>()
  ctx.on('page', async (page) => {
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Network.enable')
    cdp.on('Network.loadingFinished', (e) => bytes.set(page, (bytes.get(page) ?? 0) + e.encodedDataLength))
  })
  return { ctx, bytes }
}

/** The page's JavaScript heap after a garbage collection, in bytes. */
async function heap(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('HeapProfiler.collectGarbage')
  await cdp.send('Performance.enable')
  const { metrics } = await cdp.send('Performance.getMetrics')
  return metrics.find((m) => m.name === 'JSHeapUsedSize')!.value
}

/** Every slide in turn, each given time to draw. */
async function walk(page: Page) {
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(1000)
  }
}

test('the next preview shows an embedded page as a card; the current one loads it', async ({ page }) => {
  await page.route('https://embed.test/**', (r) => r.fulfill({ contentType: 'text/html', body: EMBED }))
  await page.goto(url + '#/flow')
  await page.waitForFunction(() => window.blitz)
  const [presenter] = await Promise.all([page.context().waitForEvent('page'), page.keyboard.press('p')])
  await expect(presenter.locator('.bp-status')).toHaveText('Connected')
  const next = () => presenter.frame({ url: /#mirror-still$/ })!
  const current = () => presenter.frame({ url: /#mirror$/ })!
  await expect(next().locator('.blitz-embed-card')).toContainText('The live dashboard')
  await expect(next().locator('.blitz-embed-card')).toContainText('embed.test')
  await expect(next().locator('iframe')).toHaveCount(0)

  await presenter.keyboard.press('ArrowRight')
  await expect(current().locator('.blitz-embed iframe')).toHaveAttribute('title', 'The live dashboard')
  // The audience's embed is the real page.
  await expect(page.locator('.blitz-embed iframe')).toHaveCount(1)
})

test('the presenter view loads at most twice what the audience window does', async ({ browser }) => {
  test.setTimeout(60_000)
  const audience = await context(browser)
  const deck = await audience.ctx.newPage()
  await deck.goto(url)
  await deck.waitForFunction(() => window.blitz)
  await walk(deck)
  const a = { heap: await heap(deck), bytes: audience.bytes.get(deck)! }

  const both = await context(browser)
  const deck2 = await both.ctx.newPage()
  await deck2.goto(url)
  await deck2.waitForFunction(() => window.blitz)
  const [presenter] = await Promise.all([both.ctx.waitForEvent('page'), deck2.keyboard.press('p')])
  await expect(presenter.locator('.bp-status')).toHaveText('Connected')
  await walk(presenter)
  const p = { heap: await heap(presenter), bytes: both.bytes.get(presenter)! }

  const kb = (n: number) => `${Math.round(n / 1024)} kB`
  test.info().annotations.push({ type: 'load', description: `audience: heap ${kb(a.heap)}, network ${kb(a.bytes)}; presenter: heap ${kb(p.heap)}, network ${kb(p.bytes)}` })
  // The deck really drew: ECharts, the map's and Mermaid's code all came over.
  expect(a.bytes).toBeGreaterThan(2_000_000)
  expect(p.heap / a.heap).toBeLessThanOrEqual(2)
  expect(p.bytes / a.bytes).toBeLessThanOrEqual(2)
  await audience.ctx.close()
  await both.ctx.close()
})

// --- M12.5: an overview with the real charts ---

/** What each thumbnail's render blocks show: a drawing (svg, img, canvas copy), a card, or the placeholder. */
const thumbBlocks = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.blitz-overview .blitz-thumb')].map((t) =>
      [...t.querySelectorAll<HTMLElement>('[data-blitz-block]')].map((b) =>
        b.dataset.blitzPlaceholder !== undefined ? 'placeholder' : b.querySelector('.blitz-embed-card') ? 'card' : b.querySelector('svg, img') ? 'drawn' : 'empty',
      ),
    ),
  )

test('the overview shows charts, maps and diagrams as drawn, and embedded pages as cards', async ({ page }) => {
  await page.route('https://embed.test/**', (r) => r.fulfill({ contentType: 'text/html', body: EMBED }))
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ contentType: 'image/png', body: TILE }))
  await page.goto(url + '#/revenue')
  await page.waitForFunction(() => window.blitz)
  await expect(page.locator('.blitz-slide[data-blitz-current] [data-blitz-block] svg').first()).toBeVisible()
  // Slides: title, revenue (chart), stores (map), flow (mermaid), live (embed), thanks.
  await page.keyboard.press('o')
  // The chart on screen is there at once; the embed is a card at once.
  const now = await thumbBlocks(page)
  expect(now[1]).toEqual(['drawn'])
  expect(now[4]).toEqual(['card'])
  // The map and the diagram, never shown, are drawn in the background.
  await expect.poll(() => thumbBlocks(page), { timeout: 15_000 }).toEqual([[], ['drawn'], ['drawn'], ['drawn'], ['card'], []])
  // The chart in the thumbnail is the chart's own drawing.
  expect(await page.locator('.blitz-overview .blitz-thumb').nth(1).locator('svg text').allTextContents()).toContain('North')
  // Drawing left nothing behind, and the deck didn't move.
  await page.keyboard.press('Escape')
  await expect(page.locator('.blitz-thumb-canvas')).toHaveCount(0)
  expect(await page.evaluate(() => window.blitz!.pos)).toEqual({ slide: 1, step: 0 })

  // Kept: the next overview has them all at once.
  await page.keyboard.press('o')
  expect(await thumbBlocks(page)).toEqual([[], ['drawn'], ['drawn'], ['drawn'], ['card'], []])
  await page.keyboard.press('Escape')

  // With the live diagram on the page too, its copy has ids of its own, and its styles still reach it.
  await page.evaluate(() => window.blitz!.goto(3, 0))
  await expect(page.locator('.blitz-slide[data-blitz-current] [data-blitz-block] svg .node')).not.toHaveCount(0)
  await page.keyboard.press('o')
  const ids = await page.evaluate(() => [...document.querySelectorAll('[id]')].map((e) => e.id))
  expect(ids.filter((id, k) => ids.indexOf(id) !== k)).toEqual([])
  const fill = (sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).fill)
  const live = await fill('.blitz-slide[data-blitz-current] [data-blitz-block] svg .node rect')
  expect(await fill('.blitz-overview .blitz-thumb:nth-child(4) [data-blitz-block] svg .node rect')).toBe(live)
})

test('the presenter’s grid shows the real charts too', async ({ page }) => {
  await page.route('https://embed.test/**', (r) => r.fulfill({ contentType: 'text/html', body: EMBED }))
  await page.context().route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ contentType: 'image/png', body: TILE }))
  await page.goto(url)
  await page.waitForFunction(() => window.blitz)
  const [presenter] = await Promise.all([page.context().waitForEvent('page'), page.keyboard.press('p')])
  await expect(presenter.locator('.bp-status')).toHaveText('Connected')
  await presenter.keyboard.press('o')
  await expect.poll(() => thumbBlocks(presenter), { timeout: 15_000 }).toEqual([[], ['drawn'], ['drawn'], ['drawn'], ['card'], []])
})
