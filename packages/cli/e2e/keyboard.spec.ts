/**
 * Keyboard only (M11.6): every overlay opens with focus inside it, keeps
 * Tab inside it, and gives focus back when it closes; the presenter view
 * and document mode can be walked with Tab, each stop visibly focused.
 */
import { join, dirname } from 'node:path'
import type { Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { buildAndServe } from './serve.js'

const here = dirname(fileURLToPath(import.meta.url))
let url = ''
let server: Server

test.beforeAll(async () => {
  ;({ url, server } = await buildAndServe(join(here, 'fixtures/nav.md')))
})
test.afterAll(() => server?.close())
test.use({ reducedMotion: 'reduce' })

async function deck(page: Page) {
  await page.goto(url)
  await page.waitForFunction(() => window.blitz)
}

const inside = (page: Page, selector: string) => page.evaluate((s) => !!document.activeElement?.closest(s), selector)
const ringed = (l: Locator) => l.evaluate((e) => getComputedStyle(e).outlineStyle !== 'none' || getComputedStyle(e).boxShadow !== 'none')

test('the key help: focus in, Tab stays in, Esc gives it back', async ({ page }) => {
  await deck(page)
  await page.keyboard.press('?')
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(dialog).toBeFocused()
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab')
    expect(await inside(page, '.blitz-help')).toBe(true)
  }
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  expect(await inside(page, '.blitz-help')).toBe(true)
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  // The deck has the keys again.
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => page.evaluate(() => window.blitz!.pos?.slide)).toBe(1)
})

test('the overview: one tab stop, arrows choose, Enter goes there', async ({ page }) => {
  await deck(page)
  await page.keyboard.press('o')
  const current = page.getByRole('option', { name: '1. One' })
  await expect(current).toBeFocused()
  // Tab doesn't wander into the thumbnails' own links, or out of the dialog.
  await page.keyboard.press('Tab')
  await expect(current).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('option', { name: '3. Links and charts' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.blitz!.pos?.slide)).toBe(2)
})

test('go to: type, Enter; Esc leaves the deck where it was', async ({ page }) => {
  await deck(page)
  await page.keyboard.press('g')
  await expect(page.getByRole('textbox')).toBeFocused()
  await page.keyboard.type('last')
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => window.blitz!.pos?.slide)).toBe(3)
  await page.keyboard.press('g')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('textbox')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await page.evaluate(() => window.blitz!.pos?.slide)).toBe(3)
})

test('the presenter view: every button in reach of Tab, each visibly focused', async ({ page }) => {
  await page.goto(`${url}#presenter`)
  const buttons = page.locator('.bp button:visible')
  const n = await buttons.count()
  expect(n).toBeGreaterThan(10)
  const reached = new Set<string>()
  for (let i = 0; i < n + 2; i++) {
    await page.keyboard.press('Tab')
    const focused = page.locator(':focus')
    if (await focused.count()) {
      const label = (await focused.getAttribute('aria-label')) ?? (await focused.textContent()) ?? ''
      if (await focused.evaluate((e) => e.matches('.bp button'))) {
        expect(await ringed(focused), label).toBe(true)
        reached.add(label)
      }
    }
  }
  expect(reached.size).toBe(n)
  // The slide grid from its button: focus inside, and back on the button after.
  const slides = page.getByRole('button', { name: /All slides/ })
  await slides.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('option', { name: /^1\. One/ })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(slides).toBeFocused()
})

test('document mode: Tab reaches Present and Print first, visibly', async ({ page }) => {
  await page.goto(`${url}?mode=doc`)
  await page.waitForFunction(() => (window as unknown as { blitzDocument?: unknown }).blitzDocument)
  await page.keyboard.press('Tab')
  const present = page.getByRole('link', { name: 'Present' })
  await expect(present).toBeFocused()
  expect(await ringed(present)).toBe(true)
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Print' })).toBeFocused()
  // Then the slides' own links, in order.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'a link at the right edge' })).toBeFocused()
})
