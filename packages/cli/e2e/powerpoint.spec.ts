/**
 * PowerPoint presentations as decks (docs/powerpoint.md): the slides draw
 * as laid out, the theme doesn't restyle them, charts render, and what's
 * past a slide's edge is hidden without counting as overflow.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { makePresentation } from '../../../scripts/pptx.mjs'
import { build } from '../dist/index.js'
import { buildAndServe } from './serve.js'

const deck = join(mkdtempSync(join(tmpdir(), 'blitz-pptx-')), 'kestrel.pptx')
writeFileSync(deck, makePresentation())
let url = ''
let server: Server

test.beforeAll(async () => {
  ;({ url, server } = await buildAndServe(deck))
})
test.afterAll(() => server?.close())
test.use({ reducedMotion: 'reduce' })

const open = async (page: Page, n: number) => {
  await page.goto(`${url}#/slide-${n}`)
  await page.waitForFunction(() => window.blitz)
}
const current = '.blitz-slide[data-blitz-current] .blitz-pptx'

test('a slide draws where PowerPoint puts it, at the canvas scale', async ({ page }) => {
  await open(page, 1)
  const title = page.locator(current).getByText('Quarterly review')
  await expect(title).toBeVisible()
  // 60pt is 80px on the canvas; the viewport is the canvas here.
  expect(await title.evaluate((e) => getComputedStyle(e).fontSize)).toBe('80px')
})

test("the theme's rules don't reach the slide's own tables", async ({ page }) => {
  await open(page, 3)
  const cell = page.locator(`${current} td`).first()
  await expect(cell).toHaveText('Region')
  // aurora pads cells 10px 22px and rules their bottoms; the table style's own padding and fill win.
  expect(await cell.evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).paddingLeft])).toEqual(['rgb(11, 122, 117)', '9.6px'])
})

test('a chart renders in its own colours', async ({ page }) => {
  await open(page, 3)
  const chart = page.locator('.blitz-slide[data-blitz-current] [data-blitz-block] svg')
  await chart.waitFor()
  await expect.poll(() => chart.locator('path[fill]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('fill')!.toLowerCase()))])).toEqual(expect.arrayContaining(['#0b7a75', '#e07a1f']))
})

test("what's past a slide's edge is hidden, and isn't overflow", async () => {
  const r = await build(deck, { outDir: mkdtempSync(join(tmpdir(), 'blitz-pptx-out-')), quiet: true, strict: true })
  expect(r.overflow).toEqual([])
  expect(r.ok).toBe(true)
})
