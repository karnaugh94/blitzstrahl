/**
 * Video and audio (syntax.md §13, PLAN §15 M10.3): a clip plays on entry or
 * at its step, stops and rewinds on leaving, is paused and silent in the
 * presenter's mirrors, and prints its poster or its frame at `start`.
 *
 * clip.webm is four seconds of solid colour, one a second: red, green,
 * blue, white (VP8: Playwright's Chromium has no H.264). poster.png is
 * magenta. So a pixel says which frame is showing.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, test, type Frame, type Page } from '@playwright/test'
import { build } from '../dist/index.js'
import { buildAndServe } from './serve.js'

const here = dirname(fileURLToPath(import.meta.url))

const DECK = `---
title: Media
---

# Media

---

# Plays on entry

![The clip](./clip.webm){start=1.5 width=320}

---

# At its step

Before

![](./clip.webm){@1 poster=./poster.png width=320}

---

# Audio

![A tone](./tone.ogg)

---

# Loops

![](./clip.webm){start=0.5 end=1.2 loop=true width=320}

---

# Waits

![](./clip.webm){autoplay=false end=0.8 width=320}
`

function deck(): string {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-media-'))
  cpSync(join(here, 'fixtures/media'), dir, { recursive: true })
  writeFileSync(join(dir, 'deck.md'), DECK)
  return join(dir, 'deck.md')
}

let url = ''
let server: Server
test.beforeAll(async () => {
  ;({ url, server } = await buildAndServe(deck()))
})
test.afterAll(() => server?.close())

type Clip = { paused: boolean; muted: boolean; time: number }
/** The clip on slide `n` (0-based) of this page. */
const clip = (page: Page | Frame, n: number) =>
  page.evaluate((i) => {
    const m = document.querySelectorAll('.blitz-stage > .blitz-slide')[i]!.querySelector<HTMLMediaElement>('video, audio')!
    return { paused: m.paused, muted: m.muted, time: m.currentTime } as Clip
  }, n)

test('a clip plays on entry with sound, and stops and rewinds to `start` on leaving', async ({ page }) => {
  await page.goto(url)
  await page.waitForFunction(() => window.blitz)
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await clip(page, 1)).time, { timeout: 5000 }).toBeGreaterThan(1.7)
  expect(await clip(page, 1)).toMatchObject({ paused: false, muted: false })

  await page.keyboard.press('ArrowRight')
  await expect.poll(() => clip(page, 1)).toEqual({ paused: true, muted: false, time: 1.5 })
  // Slide 3's clip waits for its step.
  expect((await clip(page, 2)).paused).toBe(true)
})

test('a clip with a step plays at its step, and rewinds when stepping back hides it', async ({ page }) => {
  await page.goto(`${url}#/at-its-step`)
  await page.waitForFunction(() => window.blitz)
  await page.waitForTimeout(300)
  expect(await clip(page, 2)).toEqual({ paused: true, muted: false, time: 0 })
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await clip(page, 2)).time, { timeout: 5000 }).toBeGreaterThan(0.2)
  expect((await clip(page, 2)).paused).toBe(false)
  await page.keyboard.press('ArrowLeft')
  await expect.poll(() => clip(page, 2)).toEqual({ paused: true, muted: false, time: 0 })
})

test('audio has controls and plays like video', async ({ page }) => {
  await page.goto(`${url}#/at-its-step/1`)
  await page.waitForFunction(() => window.blitz)
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.blitz-slide[data-blitz-current] audio')).toHaveAttribute('controls', '')
  await expect(page.locator('.blitz-slide[data-blitz-current] audio')).toHaveAttribute('aria-label', 'A tone')
  await expect.poll(async () => (await clip(page, 3)).time, { timeout: 5000 }).toBeGreaterThan(0.2)
})

test("the presenter's mirrors show the clip paused and silent while the deck plays it", async ({ page }) => {
  await page.goto(url)
  await page.waitForFunction(() => window.blitz)
  const [presenter] = await Promise.all([page.context().waitForEvent('page'), page.keyboard.press('p')])
  await presenter.waitForLoadState()
  await expect(presenter.locator('.bp-status')).toHaveText('Connected')
  await page.bringToFront()
  await page.keyboard.press('ArrowRight')

  const current = presenter.frame({ url: /#mirror$/ })!
  const next = presenter.frame({ url: /#mirror-still$/ })!
  await expect.poll(() => current.evaluate(() => window.blitz?.pos)).toEqual({ slide: 1, step: 0 })
  await expect.poll(async () => (await clip(page, 1)).time, { timeout: 5000 }).toBeGreaterThan(1.7)
  await page.waitForTimeout(500)
  expect(await clip(current, 1)).toEqual({ paused: true, muted: true, time: 1.5 })
  expect(await clip(next, 2)).toMatchObject({ paused: true, muted: true })
})

test('printing shows the frame at `start`, or the poster', async ({ page }) => {
  await page.goto(url)
  await page.waitForFunction(() => window.blitz)
  await page.evaluate(() => window.blitz!.print())
  const printed = await page.evaluate(() => {
    const [atStart, withPoster] = [...document.querySelectorAll<HTMLVideoElement>('.blitz-print video')]
    const c = document.createElement('canvas')
    c.width = c.height = 1
    const g = c.getContext('2d')!
    g.drawImage(atStart!, 160, 90, 1, 1, 0, 0, 1, 1)
    return { time: atStart!.currentTime, ready: atStart!.readyState, pixel: [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)], poster: withPoster!.poster }
  })
  expect(printed.time).toBe(1.5)
  expect(printed.ready).toBeGreaterThanOrEqual(2)
  // Green: the second second.
  expect(printed.pixel[1]).toBeGreaterThan(200)
  expect(printed.pixel[0]).toBeLessThan(60)
  expect(await page.evaluate(async (src) => (await fetch(src)).ok, printed.poster)).toBe(true)
})

test('a standalone file carries the clip inline, and it plays from file://', async ({ page }) => {
  const d = deck()
  const outFile = join(dirname(d), 'deck.html')
  const r = await build(d, { standalone: true, outFile, quiet: true, overflowCheck: false })
  expect(r.ok).toBe(true)
  expect(readFileSync(outFile, 'utf8')).toContain('src="data:video/webm;base64,')
  await page.goto(`${pathToFileURL(outFile).href}#/media`)
  await page.waitForFunction(() => window.blitz)
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await clip(page, 1)).time, { timeout: 5000 }).toBeGreaterThan(1.7)
})

test('`end` with `loop` goes back to `start`; `autoplay=false` waits for a click, and `end` holds the frame', async ({ page }) => {
  await page.goto(`${url}#/audio`)
  await page.waitForFunction(() => window.blitz)
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => page.evaluate(() => window.blitz!.pos)).toEqual({ slide: 4, step: 0 })
  // Sample the loop for longer than one pass: never past `end` (plus a frame's slack), and back near `start`.
  const times = await page.evaluate(async () => {
    const v = document.querySelector<HTMLVideoElement>('.blitz-slide[data-blitz-current] video')!
    const seen: number[] = []
    const until = performance.now() + 2200
    while (performance.now() < until) {
      seen.push(v.currentTime)
      await new Promise((r) => setTimeout(r, 50))
    }
    return seen
  })
  expect(Math.max(...times)).toBeLessThan(1.5)
  const wrapped = times.findIndex((t, i) => i > 0 && t < times[i - 1]! - 0.3)
  expect(wrapped).toBeGreaterThan(0)
  expect(times[wrapped]).toBeGreaterThanOrEqual(0.5)

  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(400)
  expect(await clip(page, 5)).toMatchObject({ paused: true, time: 0 })
  await page.locator('.blitz-slide[data-blitz-current] video').click()
  await expect.poll(async () => (await clip(page, 5)).paused, { timeout: 5000 }).toBe(true)
  const held = (await clip(page, 5)).time
  expect(held).toBeGreaterThanOrEqual(0.8)
  expect(held).toBeLessThan(1.2)
  expect(await page.evaluate(() => window.blitz!.pos)).toEqual({ slide: 5, step: 0 })
})
