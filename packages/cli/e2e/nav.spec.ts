/**
 * Runtime behaviour in a real browser, on a deck built by the real CLI:
 * navigation in all three modalities (keyboard, edge click, swipe), gutter
 * suppression, URL state, renderer lifecycle, reduced motion, scaling.
 */
import { mkdtempSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { build } from '../dist/index.js'
import { serve } from './serve.js'

const here = dirname(fileURLToPath(import.meta.url))
let url = ''
let server: Server

test.beforeAll(async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'blitz-e2e-'))
  const r = await build(join(here, 'fixtures/nav.md'), { outDir, quiet: true })
  expect(r.ok).toBe(true)
  ;({ url, server } = await serve(outDir))
})

test.afterAll(() => server?.close())

const pos = (page: Page) => page.evaluate(() => window.blitz!.pos)
const open = async (page: Page, hash = '') => {
  await page.goto(url + hash)
  await page.waitForFunction(() => window.blitz)
}
const hidden = (page: Page, sel: string) => page.locator(sel).evaluate((el) => (el as HTMLElement).dataset.blitzHidden !== undefined)

test('keyboard walks every step and slide, and back', async ({ page }) => {
  await open(page)
  expect(await pos(page)).toEqual({ slide: 0, step: 0 })

  await page.keyboard.press('ArrowRight')
  expect(await pos(page)).toEqual({ slide: 1, step: 0 })
  expect(await hidden(page, '#a')).toBe(true)

  await page.keyboard.press('ArrowRight')
  expect(await pos(page)).toEqual({ slide: 1, step: 1 })
  expect(await hidden(page, '#a')).toBe(false)
  expect(await hidden(page, '#b')).toBe(true)
  await expect(page).toHaveURL(/#\/two\/1$/)

  await page.keyboard.press(' ')
  await page.keyboard.press('PageDown')
  expect(await pos(page)).toEqual({ slide: 2, step: 0 })

  // Retreating from state 0 lands on the previous slide's final state.
  await page.keyboard.press('ArrowLeft')
  expect(await pos(page)).toEqual({ slide: 1, step: 2 })
  expect(await hidden(page, '#b')).toBe(false)
  await page.keyboard.press('PageUp')
  expect(await pos(page)).toEqual({ slide: 1, step: 1 })
  expect(await hidden(page, '#b')).toBe(true)

  await page.keyboard.press('End')
  expect(await pos(page)).toEqual({ slide: 3, step: 0 })
  await page.keyboard.press('Home')
  expect(await pos(page)).toEqual({ slide: 0, step: 0 })
})

test('edge gutters navigate; the middle does not', async ({ page }) => {
  await open(page)
  await page.mouse.click(1260, 100)
  expect(await pos(page)).toEqual({ slide: 1, step: 0 })
  await page.mouse.click(640, 100)
  expect(await pos(page)).toEqual({ slide: 1, step: 0 })
  await page.mouse.click(20, 100)
  expect(await pos(page)).toEqual({ slide: 0, step: 0 })
})

test('gutters ignore links, charts and text selections', async ({ page }) => {
  await open(page, '#/links/1')
  await page.locator('#chart svg').waitFor()

  const link = await page.locator('#edge-link').boundingBox()
  expect(link!.x + link!.width).toBeGreaterThan(1280 * 0.9)
  await page.mouse.click(link!.x + link!.width - 4, link!.y + link!.height / 2)
  expect(await pos(page)).toEqual({ slide: 2, step: 1 })

  const chart = await page.locator('#chart').boundingBox()
  await page.mouse.click(chart!.x + chart!.width - 10, chart!.y + chart!.height / 2)
  expect(await pos(page)).toEqual({ slide: 2, step: 1 })

  await page.evaluate(() => {
    const h = document.querySelector('[data-blitz-current] h1')!
    const range = document.createRange()
    range.selectNodeContents(h)
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(range)
  })
  await page.mouse.click(1275, 60)
  expect(await pos(page)).toEqual({ slide: 2, step: 1 })
})

test.describe('touch', () => {
  test.use({ hasTouch: true })

  test('horizontal swipes navigate, vertical ones do not', async ({ page }) => {
    await open(page)
    const cdp = await page.context().newCDPSession(page)
    const swipe = async (x0: number, y0: number, x1: number, y1: number) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] })
      for (let i = 1; i <= 5; i++) {
        const t = i / 5
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t }] })
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    await swipe(900, 360, 300, 370)
    await expect.poll(() => pos(page)).toEqual({ slide: 1, step: 0 })
    await swipe(640, 100, 650, 600)
    expect(await pos(page)).toEqual({ slide: 1, step: 0 })
    await swipe(300, 360, 900, 350)
    await expect.poll(() => pos(page)).toEqual({ slide: 0, step: 0 })
  })
})

test('deep links survive reload; slides make history entries, steps do not', async ({ page }) => {
  await open(page, '#/two/2')
  expect(await pos(page)).toEqual({ slide: 1, step: 2 })
  await page.reload()
  await page.waitForFunction(() => window.blitz)
  expect(await pos(page)).toEqual({ slide: 1, step: 2 })

  await page.keyboard.press('ArrowRight') // new slide: history entry
  await page.keyboard.press('ArrowRight') // step: replaces
  await expect(page).toHaveURL(/#\/links\/1$/)
  await page.goBack()
  await expect.poll(() => pos(page)).toEqual({ slide: 1, step: 2 })

  await open(page, '#/4')
  expect(await pos(page)).toEqual({ slide: 3, step: 0 })
})

test('a chart mounts only when its step is reached', async ({ page }) => {
  await open(page, '#/links')
  await page.waitForTimeout(300)
  await expect(page.locator('#chart svg')).toHaveCount(0)
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('#chart svg')).toHaveCount(1)
  // Leaving the slide tears it down, so it animates afresh next time.
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('#chart svg')).toHaveCount(0)
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('steps still apply, nothing animates', async ({ page }) => {
    await open(page, '#/two')
    await page.keyboard.press('ArrowRight')
    expect(await hidden(page, '#a')).toBe(false)
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0)
    await page.keyboard.press('End')
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0)
  })
})

test('entrance effects animate on entry and on forward steps only', async ({ page }) => {
  await open(page, '#/two')
  await page.keyboard.press('ArrowRight')
  expect(await page.locator('#a').evaluate((el) => el.getAnimations().length)).toBe(1)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowLeft')
  // Backward snaps: #b is hidden at once, with no animation left running.
  expect(await hidden(page, '#b')).toBe(true)
  expect(await page.locator('#b').evaluate((el) => el.getAnimations().length)).toBe(0)
  await page.keyboard.press('End')
  expect(await page.locator('#end').evaluate((el) => el.getAnimations().length)).toBe(1)
})

test('the canvas scales to fit and letterboxes', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await open(page)
  const box = async () => page.locator('.blitz-stage').boundingBox()
  expect(await box()).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
  await page.setViewportSize({ width: 1000, height: 1000 })
  await expect.poll(async () => (await box())!.width).toBeCloseTo(1000, 0)
  const b = (await box())!
  expect(b.height).toBeCloseTo(562.5, 0)
  expect(b.y).toBeCloseTo((1000 - 562.5) / 2, 0)
})
