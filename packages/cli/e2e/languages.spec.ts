/**
 * The words blitzstrahl adds (PLAN §14 D9, syntax.md §3.3): what the
 * audience hears follows the deck's `lang`; the overlays and the presenter
 * view are for whoever presents, so they follow the browser's language.
 */
import type { Server } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { buildAndServe } from './serve.js'

const here = dirname(fileURLToPath(import.meta.url))
let url = ''
let server: Server

test.beforeAll(async () => {
  ;({ url, server } = await buildAndServe(join(here, 'fixtures/numbers-de.md')))
})
test.afterAll(() => server?.close())

test.describe('a German deck in an English browser', () => {
  test.use({ locale: 'en-GB' })

  test('the live region speaks German; the key help is English', async ({ page }) => {
    await page.goto(url)
    await page.waitForFunction(() => window.blitz)
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.blitz-sr')).toHaveText('Quoten (2 von 5)')
    await page.keyboard.press('?')
    await expect(page.locator('.blitz-help h2')).toHaveText('Keyboard')
  })
})

test.describe('a German deck in a French browser', () => {
  test.use({ locale: 'fr-FR' })

  test('the overlays and the presenter view are French', async ({ page }) => {
    await page.goto(url)
    await page.waitForFunction(() => window.blitz)
    await page.keyboard.press('?')
    await expect(page.locator('.blitz-help h2')).toHaveText('Clavier')
    await page.keyboard.press('?')
    await page.keyboard.press('g')
    await expect(page.locator('.blitz-goto-input')).toHaveAttribute('placeholder', '1–5, identifiant ou titre')
    await page.keyboard.press('Escape')
    const [presenter] = await Promise.all([page.context().waitForEvent('page'), page.keyboard.press('p')])
    await expect(presenter.locator('.bp-position')).toHaveText('Diapositive 1 sur 5')
    await expect(presenter).toHaveTitle('Présentateur · Zahlen')
  })
})
