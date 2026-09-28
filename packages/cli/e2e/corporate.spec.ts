/**
 * The public corporate example (PLAN §15, M9.5): a deck in a theme imported
 * from a PowerPoint template, with the deck's chrome. It must pass
 * `build --strict`: no slide overflows, nothing to warn about.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { build } from '../dist/index.js'
import { serve } from './serve.js'

const deck = join(dirname(fileURLToPath(import.meta.url)), '../../../examples/corporate/deck.md')

test.use({ reducedMotion: 'reduce' })

test('the corporate example passes build --strict, in its imported theme, with its chrome', async ({ page }) => {
  test.setTimeout(120_000)
  const outDir = mkdtempSync(join(tmpdir(), 'blitz-corporate-'))
  const r = await build(deck, { outDir, quiet: true, strict: true, report: false })
  expect(r.diagnostics.filter((d) => d.severity !== 'info')).toEqual([])
  expect(r.overflow).toEqual([])
  expect(r.ok).toBe(true)

  const { url, server } = await serve(outDir)
  try {
    await page.goto(url)
    await page.waitForFunction(() => window.blitz)
    const slides = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.blitz-slide')].map((s) => {
        const style = getComputedStyle(s)
        return [s.dataset.layout, /url\(/.test(style.backgroundImage) ? 'picture' : style.backgroundColor, s.querySelector('[data-chrome="number"]')?.textContent ?? '']
      }),
    )
    expect(slides).toEqual([
      ['title', 'picture', '1 / 10'],
      ['default', 'picture', '2 / 10'],
      ['section', 'rgb(8, 92, 88)', '3 / 10'],
      ['default', 'picture', '4 / 10'],
      ['two-col', 'rgb(255, 255, 255)', '5 / 10'],
      ['stat-grid', 'rgb(255, 255, 255)', '6 / 10'],
      // The template's "Quote" layout matched nothing: the deck gives its picture to `quote`.
      ['quote', 'picture', '7 / 10'],
      ['section', 'rgb(8, 92, 88)', '8 / 10'],
      ['default', 'picture', '9 / 10'],
      ['end', 'rgb(255, 255, 255)', '10 / 10'],
    ])
    await expect(page.locator('[data-blitz-current] [data-chrome="footer"]')).toHaveText('Kestrel Transit · Q3 2026 network report')
    expect(await page.locator('[data-blitz-current] [data-chrome="logo"]').evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBe(120)
  } finally {
    server.close()
  }
})
