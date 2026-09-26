/**
 * Chart types beyond bar and line (docs/renderers/chart.md): they render,
 * in the theme's palette, and spec mistakes show in place.
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
  // The fixture has a broken block on purpose (the error shown in place is
  // under test), and `build` stops for errors unless forced (M6.6).
  ;({ url, server } = await buildAndServe(join(here, 'fixtures/charts.md'), { force: true }))
})

test.afterAll(() => server?.close())
test.use({ reducedMotion: 'reduce' })

const open = async (page: Page, id: string) => {
  await page.goto(`${url}#/${id}`)
  await page.waitForFunction(() => window.blitz)
}
/** Fill colours of the chart's filled shapes, ignoring the background and axes. */
const fills = (page: Page, sel: string) =>
  page.locator(`${sel} svg path[fill]`).evaluateAll((els) =>
    [...new Set(els.map((e) => e.getAttribute('fill')!.toLowerCase()))].filter((f) => f !== 'none' && f !== 'transparent'),
  )

test('pie: one slice per category, in the theme palette', async ({ page }) => {
  await open(page, 'pie')
  await page.locator('#pie svg').waitFor()
  const palette = await page.evaluate(() => [1, 2, 3].map((i) => getComputedStyle(document.documentElement).getPropertyValue(`--blitz-chart-${i}`).trim().toLowerCase()))
  await expect.poll(() => fills(page, '#pie')).toEqual(expect.arrayContaining(palette))
  await expect(page.locator('#pie svg text', { hasText: 'Core' })).toHaveCount(1)
  await expect(page.locator('#pie svg text', { hasText: '50%' })).toHaveCount(1)
})

test('bar: value labels and axis use thousands separators (deck `lang`)', async ({ page }) => {
  await open(page, 'big-numbers')
  await expect(page.locator('#big svg text', { hasText: /^11,393$/ })).toHaveCount(1)
  await expect(page.locator('#big svg text', { hasText: /^12,000$/ })).toHaveCount(1)
})

test('donut: a ring, with a hole in the middle', async ({ page }) => {
  await open(page, 'donut')
  const box = (await page.locator('#donut').boundingBox())!
  await page.locator('#donut svg path').first().waitFor()
  const centre = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName.toLowerCase(), { x: box.x + box.width / 2, y: box.y + box.height * 0.52 })
  expect(centre).not.toBe('path')
})

test('scatter: every point drawn, bubbles sized by `size`', async ({ page }) => {
  await open(page, 'scatter')
  await page.locator('#scatter svg').waitFor()
  // ECharts draws each point as a unit circle, scaled by its transform.
  const r = await page.locator('#scatter svg path[d^="M1 0A1 1"]').evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect().width).sort((a, b) => a - b),
  )
  expect(r).toHaveLength(3)
  expect(r[2]!).toBeGreaterThan(r[0]! * 1.4)
  await expect(page.locator('#scatter svg text', { hasText: 'North' })).toHaveCount(1)
})

test('a spec mistake shows in place of the chart', async ({ page }) => {
  await open(page, 'mistake')
  await expect(page.locator('#bad .blitz-block-error')).toHaveText('chart: `donut` applies to pie charts, not bar')
})
