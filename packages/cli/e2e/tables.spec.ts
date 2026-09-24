/**
 * Sortable tables (syntax.md §8, `.sortable`): the `table` renderer enhances
 * the authored table in place.
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
  ;({ url, server } = await buildAndServe(join(here, 'fixtures/tables.md')))
})

test.afterAll(() => server?.close())

const open = async (page: Page, hash = '') => {
  await page.goto(url + hash)
  await page.waitForFunction(() => window.blitz)
}
const column = (page: Page, table: string, col: number) =>
  page.locator(`${table} tbody tr`).evaluateAll((rows, c) => rows.map((r) => (r as HTMLTableRowElement).cells[c]!.textContent), col)
const header = (page: Page, table: string, col: number) => page.locator(`${table} th`).nth(col).getByRole('button')

test('headers cycle ascending, descending, as written; numbers sort by value', async ({ page }) => {
  await open(page)
  await expect(header(page, '#stores', 0)).toBeVisible()
  const written = ['Lisbon', 'Barcelona', 'Porto', 'Aachen']
  expect(await column(page, '#stores', 0)).toEqual(written)

  await header(page, '#stores', 2).click()
  expect(await column(page, '#stores', 2)).toEqual(['$300k', '$900k', '$1.2M', '$2.1M'])
  await expect(page.locator('#stores th').nth(2)).toHaveAttribute('aria-sort', 'ascending')

  await header(page, '#stores', 2).click()
  expect(await column(page, '#stores', 2)).toEqual(['$2.1M', '$1.2M', '$900k', '$300k'])
  await expect(page.locator('#stores th').nth(2)).toHaveAttribute('aria-sort', 'descending')

  await header(page, '#stores', 2).click()
  expect(await column(page, '#stores', 0)).toEqual(written)
  await expect(page.locator('#stores th[aria-sort]')).toHaveCount(0)

  // An empty cell stays last, whichever way the column is sorted.
  await header(page, '#stores', 1).click()
  expect(await column(page, '#stores', 1)).toEqual(['7', '9', '12', ''])
  await header(page, '#stores', 1).click()
  expect(await column(page, '#stores', 1)).toEqual(['12', '9', '7', ''])
})

test('a header in the edge gutter sorts instead of navigating', async ({ page }) => {
  await open(page)
  const box = (await header(page, '#stores', 0).boundingBox())!
  expect(box.x).toBeLessThan(1280 * 0.1)
  await page.mouse.click(box.x + 4, box.y + box.height / 2)
  expect(await page.evaluate(() => window.blitz!.pos)).toEqual({ slide: 0, step: 0 })
  expect(await column(page, '#stores', 0)).toEqual(['Aachen', 'Barcelona', 'Lisbon', 'Porto'])
})

test('leaving the slide puts the table back as written', async ({ page }) => {
  await open(page)
  await header(page, '#stores', 0).click()
  await page.keyboard.press('ArrowRight')
  expect(await column(page, '#stores', 0)).toEqual(['Lisbon', 'Barcelona', 'Porto', 'Aachen'])
  await page.keyboard.press('ArrowLeft')
  // Remounted once, not wrapped twice.
  await expect(page.locator('#stores th .blitz-sort')).toHaveCount(3)
  await expect(page.locator('#stores .blitz-sort .blitz-sort')).toHaveCount(0)
  await header(page, '#stores', 0).click()
  expect(await column(page, '#stores', 0)).toEqual(['Aachen', 'Barcelona', 'Lisbon', 'Porto'])
})

test('rows keep their build steps when sorted', async ({ page }) => {
  await open(page, '#/revealed')
  const shown = () =>
    page.locator('#revealed tbody tr').evaluateAll((rows) =>
      rows.filter((r) => (r as HTMLElement).dataset.blitzHidden === undefined).map((r) => (r as HTMLTableRowElement).cells[1]!.textContent),
    )
  await page.keyboard.press('ArrowRight')
  expect(await shown()).toEqual(['b'])
  await header(page, '#revealed', 0).click()
  expect(await column(page, '#revealed', 1)).toEqual(['a', 'b'])
  expect(await shown()).toEqual(['b'])
  await page.keyboard.press('ArrowRight')
  expect(await shown()).toEqual(['a', 'b'])
})

test('a sortable table is content, not a render block: sized by its rows, shown in the overview', async ({ page }) => {
  await open(page)
  const h = await page.locator('#stores').evaluate((el) => el.offsetHeight)
  expect(h).toBeLessThan(400)
  await page.keyboard.press('Escape')
  const thumb = page.locator('.blitz-thumb').first()
  await expect(thumb.locator('table td').first()).toHaveText('Lisbon')
  await expect(thumb.locator('[data-blitz-placeholder]')).toHaveCount(0)
})
