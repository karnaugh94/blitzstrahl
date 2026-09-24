/**
 * The keyboard map beyond navigation (PLAN §8): `Esc` overview, `B`
 * blackout, `G` go to, `?` help, and that each overlay owns the keyboard
 * and the mouse while it's open.
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
  ;({ url, server } = await buildAndServe(join(here, 'fixtures/nav.md')))
})

test.afterAll(() => server?.close())

const pos = (page: Page) => page.evaluate(() => window.blitz!.pos)
const open = async (page: Page, hash = '') => {
  await page.goto(url + hash)
  await page.waitForFunction(() => window.blitz)
}

test('Esc opens the overview; arrows and Enter pick a slide', async ({ page }) => {
  await open(page, '#/two/1')
  await page.keyboard.press('Escape')
  const overview = page.getByRole('dialog', { name: 'All slides' })
  await expect(overview).toBeVisible()
  await expect(overview.getByRole('option')).toHaveCount(4)
  await expect(overview.getByRole('option', { name: '2. Two' })).toHaveAttribute('aria-current', 'true')

  // Keys belong to the overview now, not the deck.
  await page.keyboard.press('ArrowRight')
  expect(await pos(page)).toEqual({ slide: 1, step: 1 })
  await expect(overview.getByRole('option', { name: '3. Links and charts' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(overview).toHaveCount(0)
  expect(await pos(page)).toEqual({ slide: 2, step: 0 })

  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(overview).toHaveCount(0)
  expect(await pos(page)).toEqual({ slide: 2, step: 0 })
})

test('overview: a click picks that slide, even at the right edge', async ({ page }) => {
  await open(page)
  await page.keyboard.press('o')
  // The overview's own background at the edge is not a gutter.
  await page.mouse.click(1275, 8)
  expect(await pos(page)).toEqual({ slide: 0, step: 0 })
  const last = page.getByRole('option', { name: '4. Last' })
  const box = (await last.boundingBox())!
  await page.mouse.click(box.x + box.width - 4, box.y + 20)
  expect(await pos(page)).toEqual({ slide: 3, step: 0 })
})

test('overview thumbnails show every step and duplicate no ids', async ({ page }) => {
  await open(page, '#/two')
  await page.keyboard.press('Escape')
  const thumb = page.getByRole('option', { name: '2. Two' })
  await expect(thumb.getByText('Second')).toBeVisible()
  expect(await page.locator('[id="a"]').count()).toBe(1)
  expect(await thumb.locator('[data-blitz-placeholder]').count()).toBe(0)
  expect(await page.getByRole('option', { name: '3. Links and charts' }).locator('[data-blitz-placeholder="chart"]').count()).toBe(1)
})

test('B blacks out; navigation still works underneath; B or . brings it back', async ({ page }) => {
  await open(page)
  const black = page.locator('.blitz-blackout')
  await page.keyboard.press('b')
  await expect(black).toHaveAttribute('data-blitz-on', '')
  expect(await page.evaluate(() => window.blitz!.blackout)).toBe(true)
  await page.keyboard.press('ArrowRight')
  expect(await pos(page)).toEqual({ slide: 1, step: 0 })
  // A click on the black screen doesn't navigate.
  await page.mouse.click(1260, 360)
  expect(await pos(page)).toEqual({ slide: 1, step: 0 })
  await page.keyboard.press('b')
  await expect(black).not.toHaveAttribute('data-blitz-on', '')
  await page.keyboard.press('.')
  await expect(black).toHaveAttribute('data-blitz-on', '')
})

test('G goes to a slide by number, id or title', async ({ page }) => {
  await open(page)
  const dialog = page.getByRole('dialog', { name: 'Go to slide' })
  await page.keyboard.press('g')
  await expect(dialog.getByRole('textbox')).toBeFocused()
  await page.keyboard.type('3')
  await expect(dialog).toContainText('3 · Links and charts')
  await page.keyboard.press('Enter')
  expect(await pos(page)).toEqual({ slide: 2, step: 0 })

  await page.keyboard.press('G')
  await page.keyboard.type('las')
  await page.keyboard.press('Enter')
  expect(await pos(page)).toEqual({ slide: 3, step: 0 })

  await page.keyboard.press('g')
  await page.keyboard.type('nope')
  await page.keyboard.press('Enter')
  await expect(dialog).toContainText('No such slide')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  expect(await pos(page)).toEqual({ slide: 3, step: 0 })
})

test('? shows the keys, unstyled by the theme', async ({ page }) => {
  await open(page)
  await page.keyboard.press('?')
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(dialog).toContainText('Overview of all slides')
  // aurora uppercases table headers on slides; the help table must not be.
  expect(await dialog.locator('th').first().evaluate((el) => getComputedStyle(el).textTransform)).toBe('none')
  await page.keyboard.press('?')
  await expect(dialog).toHaveCount(0)
})
