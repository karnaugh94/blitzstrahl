/**
 * Drawing and the laser pointer (M4): ink over the slide, in canvas pixels,
 * held by the deck. From the audience window (`D`, `L`, `C`) and from the
 * presenter's current preview, which sends it as intents.
 */
import type { Server } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Frame, type Page } from '@playwright/test'
import { buildAndServe } from './serve.js'

const here = dirname(fileURLToPath(import.meta.url))
let url = ''
let server: Server

test.beforeAll(async () => {
  ;({ url, server } = await buildAndServe(join(here, 'fixtures/presenter.md')))
})

test.afterAll(() => server?.close())

const pos = (page: Page | Frame) => page.evaluate(() => window.blitz?.pos)
const strokes = (page: Page | Frame) => page.locator('.blitz-ink .blitz-stroke')

/** The start of each drawn stroke, in canvas pixels. */
const starts = (page: Page | Frame) =>
  page.evaluate(() => [...document.querySelectorAll('.blitz-ink .blitz-stroke')].map((p) => (p.getAttribute('d') ?? '').match(/^M([\d.]+) ([\d.]+)/)!.slice(1).map((n) => Math.round(Number(n)))))

/** Where the laser dot is, in canvas pixels, or null if it's hidden. */
const laser = (page: Page | Frame) =>
  page.evaluate(() => {
    const dot = document.querySelector<SVGCircleElement>('.blitz-ink .blitz-laser')!
    return dot.style.display === 'none' ? null : [Math.round(Number(dot.getAttribute('cx'))), Math.round(Number(dot.getAttribute('cy')))]
  })

async function draw(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(...from)
  await page.mouse.down()
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 })
  await page.mouse.move(...to, { steps: 4 })
  await page.mouse.up()
}

const open = async (page: Page, hash = '') => {
  await page.goto(url + hash)
  await page.waitForFunction(() => window.blitz)
}

test('D: the pen draws on the slide, where the pointer is, and the page doesn’t turn', async ({ page }) => {
  await open(page)
  await page.keyboard.press('d')
  await draw(page, [400, 300], [700, 420])
  await expect(strokes(page)).toHaveCount(1)
  expect(await starts(page)).toEqual([[400, 300]])
  // A click in the next-page gutter draws a dot instead of advancing.
  await page.mouse.click(1260, 360)
  expect(await pos(page)).toEqual({ slide: 0, step: 0 })
  await expect(strokes(page)).toHaveCount(2)

  // Put the pen down: the gutter turns the page again. The drawing stays with its slide.
  await page.keyboard.press('d')
  await page.mouse.click(1260, 360)
  await expect.poll(() => pos(page)).toEqual({ slide: 1, step: 0 })
  await expect(strokes(page)).toHaveCount(0)
  await page.keyboard.press('ArrowLeft')
  await expect(strokes(page)).toHaveCount(2)
  // C wipes this slide's drawing.
  await page.keyboard.press('c')
  await expect(strokes(page)).toHaveCount(0)
})

test('ink lands in canvas pixels, however the canvas is scaled', async ({ page }) => {
  // 640×480: the canvas is shown at half size, letterboxed 60px from the top.
  await page.setViewportSize({ width: 640, height: 480 })
  await open(page)
  await page.keyboard.press('d')
  await draw(page, [320, 240], [400, 300])
  expect(await starts(page)).toEqual([[640, 360]])
  await page.keyboard.press('d')
  await page.keyboard.press('l')
  await page.mouse.move(160, 150)
  await expect.poll(() => laser(page)).toEqual([320, 180])
})

test('L: the laser follows the pointer, clicks still turn the page, Esc puts it down first', async ({ page }) => {
  await open(page)
  expect(await laser(page)).toBeNull()
  await page.keyboard.press('l')
  await page.mouse.move(500, 200)
  await expect.poll(() => laser(page)).toEqual([500, 200])
  expect(await page.locator('.blitz-viewport').evaluate((v) => getComputedStyle(v).cursor)).toBe('none')
  await page.mouse.click(1260, 360)
  await expect.poll(() => pos(page)).toEqual({ slide: 1, step: 0 })

  await page.keyboard.press('Escape')
  await expect.poll(() => laser(page)).toBeNull()
  await expect(page.locator('.blitz-overview')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.locator('.blitz-overview')).toHaveCount(1)
})

/** Open the deck and press P; resolves to the presenter window. */
async function openBoth(page: Page) {
  await open(page)
  const [presenter] = await Promise.all([page.context().waitForEvent('page'), page.keyboard.press('p')])
  await presenter.waitForLoadState()
  await expect(presenter.locator('.bp-status')).toHaveText('Connected')
  return presenter
}

const currentMirror = (presenter: Page) => {
  const frame = presenter.frame({ url: /#mirror$/ })
  if (!frame) throw new Error('no current mirror')
  return frame
}

test('the presenter draws and points on its preview; the audience sees it, and so does the preview', async ({ page }) => {
  const presenter = await openBoth(page)
  const box = (await presenter.locator('.bp-current .bp-frame').boundingBox())!
  const at = (x: number, y: number): [number, number] => [box.x + (box.width * x) / 1280, box.y + (box.height * y) / 720]

  await presenter.keyboard.press('d')
  await expect(presenter.getByRole('button', { name: 'Draw on the current slide (D)' })).toHaveAttribute('aria-pressed', 'true')
  await draw(presenter, at(320, 360), at(640, 500))
  await expect(strokes(page)).toHaveCount(1)
  expect((await starts(page))[0]![0]).toBeCloseTo(320, -1)
  expect((await starts(page))[0]![1]).toBeCloseTo(360, -1)
  await expect(strokes(currentMirror(presenter))).toHaveCount(1)

  // The audience draws too; the preview shows both.
  await page.keyboard.press('d')
  await draw(page, [900, 200], [1000, 260])
  await expect(strokes(currentMirror(presenter))).toHaveCount(2)

  await presenter.keyboard.press('l')
  await presenter.mouse.move(...at(1000, 600))
  await expect.poll(async () => (await laser(page))?.map((v) => Math.round(v / 10))).toEqual([100, 60])
  await expect.poll(async () => (await laser(currentMirror(presenter)))?.map((v) => Math.round(v / 10))).toEqual([100, 60])
  await presenter.keyboard.press('Escape')
  await expect.poll(() => laser(page)).toBeNull()

  // A reloaded presenter gets the drawing so far.
  await presenter.reload()
  await expect(presenter.locator('.bp-status')).toHaveText('Connected')
  // The preview's frame is rebuilt with the page: wait for it, then for its drawing.
  await expect.poll(async () => (presenter.frame({ url: /#mirror$/ }) ? strokes(currentMirror(presenter)).count() : -1)).toBe(2)

  await presenter.keyboard.press('c')
  await expect(strokes(page)).toHaveCount(0)
  await expect(strokes(currentMirror(presenter))).toHaveCount(0)
})

test('a reloaded audience window comes back without the drawing, and the preview follows', async ({ page }) => {
  const presenter = await openBoth(page)
  await page.keyboard.press('d')
  await draw(page, [300, 300], [500, 400])
  await expect(strokes(currentMirror(presenter))).toHaveCount(1)
  await page.reload()
  await page.waitForFunction(() => window.blitz)
  await expect(presenter.locator('.bp-status')).toHaveText('Connected')
  await expect(strokes(currentMirror(presenter))).toHaveCount(0)
})
