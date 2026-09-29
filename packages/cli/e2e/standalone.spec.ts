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
  // The page that says it needs a server (its words are data in every page now).
  expect(html).not.toContain("location.protocol === 'file:'")

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

test('typing #presenter onto an open deck turns that tab into the presenter view', async ({ page }) => {
  await open(page)
  await page.evaluate(() => {
    location.hash = '#presenter'
  })
  await expect(page.locator('.bp-notes')).toBeVisible()
  expect(new URL(page.url()).hash).toBe('#presenter')
})

test('when the browser blocks P’s window, a link opens a presenter that drives the deck', async ({ page, context }) => {
  // What Firefox does: a key press isn't permission for a pop-up.
  await page.addInitScript(() => {
    window.open = () => null
  })
  await open(page)
  await page.keyboard.press('p')
  const link = page.getByRole('link', { name: 'Open the presenter view' })
  await expect(link).toBeVisible()
  const [presenter] = await Promise.all([context.waitForEvent('page'), link.click()])
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(presenter.locator('.bp-notes')).toContainText('Say hello.')
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
  // The dev panel is the dev server's alone (dev-panel.ts).
  expect(text(minimal)).not.toContain('blitz-dev-panel')
  expect(text(minimal)).not.toContain(table)
  expect(text(file)).toContain(table)
  expect(text(file)).not.toContain(map)
  expect(text(file)).not.toContain(embed)
})

/**
 * Measured 2026-09-24: 69 kB and 650 kB. Raise deliberately, never to make a test pass.
 * Raised 2026-09-25 (M4): 91.5 kB bare, now carrying auto-animate, magic move,
 * `lines=` and the laser/pen in every deck's runtime (of which 26 kB is CSS,
 * unminified; minifying it would save ~5 kB).
 * Raised 2026-09-27 (M7.4): 116.8 kB bare. The overlays and the presenter
 * view speak the browser's language even offline, so every page carries
 * all seven languages' strings (21 kB of JSON).
 * Raised 2026-09-27 (M7.1): 181.4 kB bare. aurora ships Inter, and an
 * English deck carries its Latin face, inlined (48 kB, 64 kB as base64).
 * Nothing else of the shipped fonts: no italics, code font or other scripts.
 * With a chart and inline code: 803 kB, JetBrains Mono's Latin face included.
 * Not raised 2026-09-28 (M8.1): 183.3 kB bare. The dev panel's words, in all
 * seven languages, ride with the UI strings (1.9 kB); the panel itself is a
 * dev-only module and never in a build (asserted above).
 * Raised 2026-09-28 (M9): 185.1 kB bare, +1.8 kB over 1383fcc. The chrome's
 * base CSS (footer, number and logo placement, shared by every theme), a
 * `.blitz-chrome` holding the (hidden) title on every slide, and the base
 * rule that puts links in the `link` token.
 * Raised 2026-09-28 (M10): 188.7 kB bare, +2.3 kB over ae86aab. Video and
 * audio (media.ts: play on entry or step, rewind on leave, `end`, `loop`,
 * the print frame) are in every runtime, since a standalone file is one
 * bundle. (M10.1's utility classes, 1.2 kB, fitted under the old budget;
 * the components' 8.7 kB of CSS ships only in decks that use `as=`.)
 * Then 190.05 kB: magic move within a slide (M10.4: stack swaps, their
 * morph and the stack's CSS), +1.35 kB.
 * Raised 2026-09-29 (M11): 209.2 kB bare, +19.2 kB. Document mode (M11.4:
 * the slides as one page, the two-to-a-sheet handout and its CSS) is
 * +9.9 kB, measured by building without it; the user chose to always ship
 * it rather than put it behind a flag. The rest is printing from the
 * browser (Ctrl+P, the menu's synchronous layout, snapshots) and the new
 * words, which a standalone file carries in all seven languages.
 * Then 211.1 kB: what charts and maps say to screen readers (M11.5), eleven
 * words and templates in seven languages, +1.9 kB. They ship with the
 * page's other words even when the deck has no chart.
 * Then 214.1 kB: the handout's "Notes, continued" (every sheet alike, the
 * rest of long notes after the sheets, its page found by laying it out),
 * +3.0 kB.
 * Then 222.4 kB: pacing and rehearsal in the presenter view (M12.1–2),
 * +8.3 kB against develop: ten words in seven languages (2.7 kB), the
 * pace bar's and timer's CSS (1.5 kB, the presenter's stylesheet is an
 * unminified string), the rest code. A `file://` deck needs its presenter
 * view, so none of it can stay out. The chart deck carries the same
 * (870.5 kB).
 * Then 228.4 kB: the pen's colours, highlighter and undo, strokes sent as
 * additions, the next preview's ink (M12.3, M12.7), +6.0 kB: nine words
 * in seven languages (2.6 kB, three of them in the key help, which the
 * audience window has too), the rest code and the swatches' CSS.
 * Then 232.5 kB: the overview's real thumbnails and the next preview's
 * embed card (M12.4–5), +4.2 kB: drawing blocks off screen, giving copies
 * ids of their own, the card and its one word in seven languages.
 */
const BUDGET = { minimal: 233_000, withChart: 889_000 }
