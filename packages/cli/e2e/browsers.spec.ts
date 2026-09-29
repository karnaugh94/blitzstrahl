/**
 * The presenter's two windows in every browser Playwright has here (M12.7):
 * Chromium, and Firefox and WebKit when installed (playwright.config.ts).
 * `P` opens the presenter view; where the browser blocks that pop-up, the
 * deck offers a link instead (presenting.md, *Limits*). Either way the
 * presenter drives the deck, over HTTP and from a standalone file.
 */
import type { Server } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { build } from '../dist/index.js'
import { buildAndServe } from './serve.js'

const here = dirname(fileURLToPath(import.meta.url))
let url = ''
let server: Server
let file = ''

test.beforeAll(async () => {
  ;({ url, server } = await buildAndServe(join(here, 'fixtures/presenter.md')))
  file = join(mkdtempSync(join(tmpdir(), 'blitz-browsers-')), 'presenter.html')
  const r = await build(join(here, 'fixtures/presenter.md'), { standalone: true, outFile: file, quiet: true, overflowCheck: false })
  expect(r.ok).toBe(true)
})

test.afterAll(() => server?.close())

const pos = (page: Page) => page.evaluate(() => window.blitz?.pos)

/** Press P; resolves to the presenter window, by the pop-up or, if it's blocked, by the deck's link. */
async function presenterOf(page: Page): Promise<{ presenter: Page; blocked: boolean }> {
  const opened = page.context().waitForEvent('page', { timeout: 3000 }).catch(() => undefined)
  await page.keyboard.press('p')
  let presenter = await opened
  const blocked = !presenter
  if (!presenter) {
    const link = page.getByRole('link', { name: 'Open the presenter view' })
    await expect(link).toBeVisible()
    ;[presenter] = await Promise.all([page.context().waitForEvent('page'), link.click()])
  }
  await presenter.waitForLoadState()
  await expect(presenter.locator('.bp-status')).toHaveText('Connected', { timeout: 10_000 })
  return { presenter, blocked }
}

// Playwright lets every browser open pop-ups; `blocked` does what a pop-up
// blocker does to the deck's `window.open` (Firefox doesn't count a key
// press as permission), so the link is what opens the presenter.
for (const where of ['http', 'file'] as const) {
  for (const popups of ['allowed', 'blocked'] as const) {
    test(`P opens the presenter view, which drives the deck (${where}, pop-ups ${popups})`, async ({ page }) => {
      if (popups === 'blocked') await page.addInitScript(() => (window.open = () => null))
      await page.goto(where === 'http' ? url : pathToFileURL(file).href)
      await page.waitForFunction(() => window.blitz)
      const { presenter, blocked } = await presenterOf(page)
      expect(blocked).toBe(popups === 'blocked')

      await expect(presenter.locator('.bp-notes')).toContainText('Say hello.')
      await presenter.keyboard.press('ArrowRight')
      await expect.poll(() => pos(page)).toEqual({ slide: 1, step: 0 })
      await expect(presenter.locator('.bp-position')).toHaveText('Slide 2 of 4 · Step 0 of 2')
      // And the other way: the deck's keys reach the presenter.
      await page.keyboard.press('End')
      await expect(presenter.locator('.bp-position')).toHaveText('Slide 4 of 4')
      await expect(presenter.locator('.bp-notes')).toContainText('Closing notes.')

      // A reloaded presenter reconnects.
      await presenter.reload()
      await expect(presenter.locator('.bp-status')).toHaveText('Connected', { timeout: 10_000 })
      await presenter.keyboard.press('Home')
      await expect.poll(() => pos(page)).toEqual({ slide: 0, step: 0 })
    })
  }
}
