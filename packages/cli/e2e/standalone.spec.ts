/**
 * `build --standalone` (PLAN §6): one .html that runs from file://, with
 * nothing fetched from anywhere, and only the renderers the deck uses.
 */
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { build } from '../dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const out = mkdtempSync(join(tmpdir(), 'blitz-standalone-'))

async function standalone(deck: string): Promise<string> {
  const outFile = join(out, deck.replace(/\.md$/, '.html'))
  const r = await build(join(here, 'fixtures', deck), { standalone: true, outFile, quiet: true, overflowCheck: false })
  expect(r.ok).toBe(true)
  expect(r.index).toBe(outFile)
  return outFile
}

let file = ''
test.beforeAll(async () => {
  file = await standalone('standalone.md')
})

/** Open the file, recording every request that isn't the file itself. */
async function open(page: Page, hash = '') {
  const url = pathToFileURL(file).href
  const requests: string[] = []
  page.on('request', (r) => {
    if (r.url() !== url && !r.url().startsWith('data:')) requests.push(r.url())
  })
  await page.goto(url + hash)
  await page.waitForFunction(() => window.blitz)
  return requests
}

test('the file holds everything: no scripts, styles or images to fetch', async ({ page }) => {
  const html = readFileSync(file, 'utf8')
  expect(html).not.toMatch(/<script[^>]+src=/)
  expect(html).not.toMatch(/<link[^>]+stylesheet/)
  expect(html).not.toContain('assets/')
  expect(html).not.toContain('can’t run from a file')

  const requests = await open(page)
  await expect.poll(() => page.locator('#logo').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(640)
  expect(await page.locator('#logo').getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/)

  await page.keyboard.press('ArrowRight')
  await expect(page.locator('#chart svg rect, #chart svg path').first()).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await page.locator('#table th').first().getByRole('button').click()
  await expect(page.locator('#table tbody td').first()).toHaveText('a')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('#plain')).toBeVisible()
  expect(requests).toEqual([])
})

test('script-like text in the deck stays text', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await open(page, '#/plain')
  await expect(page.locator('[data-blitz-current] pre')).toContainText("const s = '</script><!-- not a comment'")
  expect(errors).toEqual([])
})

test('the presenter view works from the file, previews included', async ({ page, context }) => {
  await open(page)
  const [presenter] = await Promise.all([context.waitForEvent('page'), page.keyboard.press('p')])
  await presenter.waitForLoadState()
  expect(new URL(presenter.url()).hash).toBe('#presenter')
  await expect(presenter.locator('.bp-notes')).toContainText('Say hello.')
  const next = presenter.frameLocator('iframe').nth(1)
  await expect(next.locator('[data-blitz-current] h1')).toHaveText('Chart')
  await presenter.keyboard.press('ArrowRight')
  await expect.poll(() => page.evaluate(() => window.blitz!.pos)).toEqual({ slide: 1, step: 0 })
})

test('only the renderers the deck uses are bundled, within the size budget', async () => {
  const minimal = await standalone('minimal.md')
  const size = (f: string) => statSync(f).size
  const text = (f: string) => readFileSync(f, 'utf8')
  // Budget (PLAN §9): runtime + theme alone, and with ECharts for a chart.
  expect(size(minimal)).toBeLessThan(BUDGET.minimal)
  expect(size(file)).toBeLessThan(BUDGET.withChart)
  // Each renderer's own messages mark whether its code is in the file.
  const table = '`.sortable` applies to a table'
  const map = 'say where: give `center`'
  const embed = '`src` must be an http'
  expect(text(minimal)).not.toContain('echarts')
  expect(text(minimal)).not.toContain(table)
  expect(text(file)).toContain(table)
  expect(text(file)).not.toContain(map)
  expect(text(file)).not.toContain(embed)
})

/** Measured 2026-09-24: 69 kB and 650 kB. Raise deliberately, never to make a test pass. */
const BUDGET = { minimal: 90_000, withChart: 800_000 }
