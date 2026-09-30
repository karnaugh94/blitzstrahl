/**
 * The `embed` renderer (docs/renderers/embed.md). The embedded site is a
 * Playwright route, so nothing here touches the network.
 */
import type { Server } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { buildAndServe } from './serve.js'

const here = dirname(fileURLToPath(import.meta.url))
let url = ''
let server: Server

test.beforeAll(async () => {
  // The fixture has a broken block on purpose (the error shown in place is
  // under test), and `build` stops for errors unless forced (M6.6).
  ;({ url, server } = await buildAndServe(join(here, 'fixtures/embeds.md'), { force: true }))
})

test.afterAll(() => server?.close())

test.beforeEach(async ({ page }) => {
  await page.route('https://embed.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Embedded</title><h1>Hello from the embed</h1>' }),
  )
})

const open = async (page: Page, id: string) => {
  await page.goto(`${url}#/${id}`)
  await page.waitForFunction(() => window.blitz)
}

test('the page loads in a frame when its slide is entered, and goes when it is left', async ({ page }) => {
  await open(page, 'start')
  await expect(page.locator('iframe')).toHaveCount(0)
  await page.keyboard.press('ArrowRight')
  const frame = page.locator('#live iframe')
  await expect(frame).toHaveAttribute('src', 'https://embed.test/page')
  await expect(frame).toHaveAttribute('title', 'embed.test')
  await expect(page.frameLocator('#live iframe').locator('h1')).toHaveText('Hello from the embed')
  await expect(page.locator('#live .blitz-embed')).not.toHaveAttribute('data-loading')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('#live iframe')).toHaveCount(0)
})

test('zoom scales the page inside the frame; title names it', async ({ page }) => {
  await open(page, 'zoomed')
  const frame = page.locator('#zoomed iframe')
  await expect(frame).toHaveAttribute('title', 'A zoomed page')
  const box = await page.locator('#zoomed').boundingBox()
  const inner = await frame.evaluate((f) => ({ w: f.offsetWidth, shown: f.getBoundingClientRect().width }))
  expect(inner.w).toBeCloseTo(box!.width * 2, 0)
  expect(inner.shown).toBeCloseTo(box!.width, 0)
})

test('a bare URL is enough', async ({ page }) => {
  await open(page, 'bare')
  await expect(page.locator('#bare iframe')).toHaveAttribute('src', 'https://embed.test/page')
})

test('offline, the fallback image stands in', async ({ page }) => {
  // Only the browser's idea of being online: the deck's own files still load,
  // as they would from a standalone file.
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false }))
  await open(page, 'start')
  await page.keyboard.press('ArrowRight')
  const img = page.locator('#live img.blitz-embed-fallback')
  await expect(img).toHaveAttribute('src', /\/assets\/shot-[0-9a-f]{8}\.svg$/)
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(640)
  await expect(page.locator('#live iframe')).toHaveCount(0)

  // Without a fallback, it says what's missing.
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('#zoomed .blitz-embed-offline')).toHaveText('embed.test needs a network connection')
})

test('a src that is not a URL is reported in place', async ({ page }) => {
  await open(page, 'wrong')
  await expect(page.locator('#wrong .blitz-block-error')).toHaveText('embed: `src` must be an http:// or https:// URL')
})
