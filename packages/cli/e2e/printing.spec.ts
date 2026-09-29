/**
 * Printing from the browser (M11.3): Ctrl+P lays out every slide and waits
 * for its renders before the dialog; the browser's own menu gets what can
 * be laid out at once; the presenter view prints the deck, not itself.
 */
import { join, dirname } from 'node:path'
import type { Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { buildAndServe } from './serve.js'

const here = dirname(fileURLToPath(import.meta.url))
let url = ''
let server: Server

test.beforeAll(async () => {
  ;({ url, server } = await buildAndServe(join(here, 'fixtures/printing.md')))
})
test.afterAll(() => server?.close())
test.use({ reducedMotion: 'reduce' })

interface Printed {
  pages: number
  /** Bars drawn per page. */
  drawn: number[]
  missing: string[]
  state: string | undefined
}

declare global {
  interface Window {
    printed: Printed[]
  }
}

test.beforeEach(async ({ page }) => {
  // The dialog can't be driven headless: record what it would have printed.
  await page.addInitScript(() => {
    window.printed = []
    window.print = () => {
      const pages = [...document.querySelectorAll('.blitz-print > .blitz-slide')]
      window.printed.push({
        pages: pages.length,
        drawn: pages.map((p) => p.querySelectorAll('[data-blitz-block] svg path').length),
        missing: [...document.querySelectorAll('.blitz-print-missing')].map((m) => m.textContent ?? ''),
        state: document.documentElement.dataset.blitzPrinting,
      })
    }
  })
})

const pdfPages = async (page: Page) => ((await page.pdf({ preferCSSPageSize: true })).toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length

test('Ctrl+P lays out every slide, waits for its charts, then prints; the deck stays on screen', async ({ page }) => {
  await page.goto(url)
  await page.waitForFunction(() => window.blitz)
  await page.keyboard.press('Control+p')
  await page.waitForFunction(() => window.printed.length === 1)
  const [p] = await page.evaluate(() => window.printed)
  expect(p!.pages).toBe(4)
  expect(p!.state).toBe('quiet')
  // Both charts drawn, the one never shown included.
  expect(p!.drawn[1]).toBeGreaterThan(2)
  expect(p!.drawn[2]).toBeGreaterThan(2)
  expect(p!.missing).toEqual([])

  // On screen, nothing changed: same slide, pages out of sight.
  await expect(page.locator('.blitz-viewport')).toBeVisible()
  await expect(page.locator('.blitz-slide[data-blitz-current]')).toHaveAttribute('data-blitz-slide', 'printing')
  expect(await page.locator('.blitz-print').evaluate((el) => getComputedStyle(el).visibility)).toBe('hidden')
  // In print, one page per slide.
  expect(await pdfPages(page)).toBe(4)

  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await expect(page.locator('.blitz-print')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.dataset.blitzPrinting)).toBeUndefined()
})

test('the browser\'s Print menu prints at once: charts shown so far, and a frame for the rest', async ({ page }) => {
  await page.goto(`${url}#/shown`)
  await page.waitForFunction(() => document.querySelectorAll('#seen svg path').length > 2)
  await page.keyboard.press('End')
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')))
  const pages = page.locator('.blitz-print > .blitz-slide')
  await expect(pages).toHaveCount(4)
  expect(await pages.nth(1).locator('svg path').count()).toBeGreaterThan(2)
  await expect(pages.nth(2).locator('.blitz-print-missing')).toHaveText('Regional sales')
  expect(await pdfPages(page)).toBe(4)
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await expect(page.locator('.blitz-print')).toHaveCount(0)
})

test('the presenter view\'s Print prints the deck\'s slides, not the view', async ({ page }) => {
  await page.goto(`${url}#presenter`)
  const print = page.getByRole('button', { name: /Print every slide/ })
  await print.click()
  await page.waitForFunction(() => window.printed.length === 1)
  const [p] = await page.evaluate(() => window.printed)
  expect(p!.pages).toBe(4)
  expect(p!.drawn[2]).toBeGreaterThan(2)
  expect(await pdfPages(page)).toBe(4)
  // And Ctrl+P there does the same.
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await page.keyboard.press('Control+p')
  await page.waitForFunction(() => window.printed.length === 2)
})
