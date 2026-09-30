/**
 * Numbers in a German deck (PLAN D3′): data says how it's written
 * (`thousands: "."`), charts write numbers in German, and a table, which is
 * text for the audience, is read the way German writes numbers.
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
  ;({ url, server } = await buildAndServe(join(here, 'fixtures/numbers-de.md')))
})
test.afterAll(() => server?.close())
test.use({ reducedMotion: 'reduce' })

const open = async (page: Page, id: string) => {
  await page.goto(`${url}#/${id}`)
  await page.waitForFunction(() => window.blitz)
}

test('a German CSV charts 3,5 as 3.5, and its labels are German', async ({ page }) => {
  await open(page, 'quoten')
  const labels = page.locator('#quote svg text')
  await expect(labels.filter({ hasText: /^3,5 %$/ })).toHaveCount(1)
  await expect(labels.filter({ hasText: /^12,5 %$/ })).toHaveCount(1)
  await expect(labels.filter({ hasText: /^1\.234,5 %$/ })).toHaveCount(1)
})

test('a time axis labels its dates in German', async ({ page }) => {
  await open(page, 'verlauf')
  await expect(page.locator('#verlauf-chart svg text', { hasText: /^(Jan\.|Feb\.|März|Apr\.|Mai|Juni) 2024$/ }).first()).toBeVisible()
})

test('a sortable table sorts German numbers by value', async ({ page }) => {
  await open(page, 'tabelle')
  await page.locator('th', { hasText: 'Quote' }).locator('button').click()
  await expect(page.locator('tbody tr td:first-child')).toHaveText(['ES', 'DE', 'PL', 'FR'])
})

test("a choropleth's legend writes its numbers in German", async ({ page }) => {
  await open(page, 'karte')
  const legend = page.locator('#karte-map svg text')
  await expect(legend.filter({ hasText: /^90\.000$/ })).toHaveCount(1)
  await expect(legend.filter({ hasText: /^1\.234,5$/ })).toHaveCount(1)
})
