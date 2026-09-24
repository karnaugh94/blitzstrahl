/**
 * Layout geometry (syntax.md §10), on the example deck that shows every
 * built-in layout: slots land where the layout puts them.
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
  ;({ url, server } = await buildAndServe(join(here, '../../../examples/layouts/deck.md')))
})

test.afterAll(() => server?.close())

test.use({ reducedMotion: 'reduce' })

/** Canvas-space boxes of the current slide's slots. */
async function slots(page: Page, id: string) {
  await page.goto(`${url}#/${id}`)
  await page.waitForFunction(() => window.blitz)
  return page.evaluate(() => {
    const out: Record<string, { x: number; y: number; w: number; h: number }> = {}
    for (const el of document.querySelectorAll<HTMLElement>('[data-blitz-current] > .blitz-slot')) {
      out[el.dataset.slot!] = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }
    }
    return out
  })
}

test('two-col: heading spans the top, columns split the rest', async ({ page }) => {
  const s = await slots(page, 'two-col')
  expect(Object.keys(s)).toEqual(['main', 'left', 'right'])
  expect(s.left!.y).toBeGreaterThan(s.main!.y + s.main!.h - 1)
  expect(s.right!.y).toBe(s.left!.y)
  expect(s.right!.x).toBeGreaterThan(s.left!.x + s.left!.w)
  expect(s.left!.w).toBe(s.right!.w)
})

test('three-col: three equal columns', async ({ page }) => {
  const s = await slots(page, 'three-col')
  expect(s.left!.y).toBe(s.middle!.y)
  expect(s.middle!.y).toBe(s.right!.y)
  expect(s.left!.x).toBeLessThan(s.middle!.x)
  expect(s.middle!.x).toBeLessThan(s.right!.x)
  expect(s.left!.w).toBe(s.right!.w)
})

test('image-left / image-right: the image slot bleeds to its edge', async ({ page }) => {
  const l = await slots(page, 'image-left')
  expect(l.image).toEqual({ x: 0, y: 0, w: 640, h: 720 })
  expect(l.main!.x).toBe(640)
  const r = await slots(page, 'image-right')
  expect(r.image).toEqual({ x: 640, y: 0, w: 640, h: 720 })
  const img = await page.locator('[data-blitz-current] [data-slot="image"] img').boundingBox()
  expect(img).toEqual({ x: 640, y: 0, width: 640, height: 720 })
})

test('full-bleed: the image covers the canvas', async ({ page }) => {
  await slots(page, 'full-bleed')
  const img = await page.locator('[data-blitz-current] img').boundingBox()
  expect(img).toEqual({ x: 0, y: 0, width: 1280, height: 720 })
})

test('title and end centre their content vertically; section centres its heading', async ({ page }) => {
  await slots(page, 'part-one')
  const h = (await page.locator('[data-blitz-current] h1').boundingBox())!
  expect(Math.abs(h.x + h.width / 2 - 640)).toBeLessThan(2)

  for (const id of ['every-layout', 'thank-you']) {
    const s = await slots(page, id)
    const kids = await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>('[data-blitz-current] > [data-slot="main"]')!
      const first = main.firstElementChild as HTMLElement
      const last = main.lastElementChild as HTMLElement
      return { top: first.offsetTop, bottom: last.offsetTop + last.offsetHeight }
    })
    const above = kids.top - s.main!.y
    const below = s.main!.y + s.main!.h - kids.bottom
    expect(Math.abs(above - below), id).toBeLessThan(4)
  }
})
