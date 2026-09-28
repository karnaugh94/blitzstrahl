/**
 * Components (syntax.md §5.1, PLAN §15 M10.2). The showcase must pass
 * `build --strict` in aurora, broadsheet and a theme that only sets tokens,
 * with each component drawn: markers, connectors, arrows, accents. Each
 * slide's screenshot is attached to the report, to look at.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { build } from '../dist/index.js'
import { serve } from './serve.js'

const showcase = join(dirname(fileURLToPath(import.meta.url)), '../../../examples/components/deck.md')

const TOKENS = `:root {
  --blitz-bg: #ffffff; --blitz-fg: #1d2330; --blitz-fg-muted: #5d6675; --blitz-accent: #1f6fb2;
  --blitz-chart-1: #1f6fb2; --blitz-chart-2: #e07a1f; --blitz-chart-3: #2a9d6e; --blitz-chart-4: #c23b52;
  --blitz-chart-5: #6b4fb8; --blitz-chart-6: #8a8f99; --blitz-chart-7: #d4a72c; --blitz-chart-8: #3b8fb8;
}
`

/** The showcase in `theme`: a copy with `theme:` set. */
function themed(theme: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-components-'))
  writeFileSync(join(dir, 'tokens.css'), TOKENS)
  writeFileSync(join(dir, 'deck.md'), readFileSync(showcase, 'utf8').replace(/^---\n/, `---\ntheme: ${theme}\n`))
  return join(dir, 'deck.md')
}

/** A pseudo-element's computed property, `none` when it isn't drawn. */
function pseudo(page: Page, selector: string, which: '::before' | '::after', prop: string): Promise<string> {
  return page.locator(selector).first().evaluate((e, [w, p]) => getComputedStyle(e, w).getPropertyValue(p!), [which, prop])
}

const box = (page: Page, selector: string) => page.locator(selector).evaluate((e) => e.getBoundingClientRect().toJSON() as DOMRect)

test.use({ reducedMotion: 'reduce' })

for (const theme of ['aurora', 'broadsheet', './tokens.css']) {
  test(`the components showcase fits and draws every component in ${theme}`, async ({ page }) => {
    test.setTimeout(120_000)
    const outDir = mkdtempSync(join(tmpdir(), 'blitz-components-out-'))
    const r = await build(themed(theme), { outDir, quiet: true, strict: true, report: false })
    expect(r.diagnostics.filter((d) => d.severity !== 'info')).toEqual([])
    expect(r.overflow).toEqual([])
    expect(r.ok).toBe(true)

    const { url, server } = await serve(outDir)
    try {
      await page.setViewportSize({ width: 1280, height: 720 })
      const go = async (hash: string) => {
        await page.goto(`${url}#/${hash}`)
        await page.waitForFunction(() => window.blitz)
        await page.evaluate(() => document.fonts.ready)
      }
      const cur = '.blitz-slide[data-blitz-current]'

      // steps: numbered markers, not the theme's bullets; an arrow into each later item.
      await go('how-a-report-is-made')
      const steps = `${cur} ol[data-as="steps"]`
      expect(await pseudo(page, `${steps} > li`, '::before', 'content')).toBe('counter(blitz-item)')
      expect(await pseudo(page, `${steps} > li`, '::before', 'width')).toBe('48px')
      expect(await pseudo(page, `${steps} > li`, '::after', 'content')).toBe('none')
      expect(await pseudo(page, `${steps} > li:nth-child(2)`, '::after', 'content')).toBe('""')
      // reveal=items: item 2 (and its arrow) arrives at step 1.
      await expect(page.locator(`${steps} > li:nth-child(2)`)).toHaveCSS('visibility', 'hidden')
      await go('how-a-report-is-made/1')
      await expect(page.locator(`${steps} > li:nth-child(2)`)).toHaveCSS('visibility', 'visible')
      const [one, two] = [await box(page, `${steps} > li:nth-child(1)`), await box(page, `${steps} > li:nth-child(2)`)]
      expect(two.left).toBeGreaterThan(one.right)
      await go('how-a-report-is-made/99')
      await test.info().attach(`steps (${theme})`, { body: await page.screenshot(), contentType: 'image/png' })

      // timeline: a line and a stop per item.
      await go('three-generations-of-reporting/99')
      expect(await pseudo(page, `${cur} [data-as="timeline"]`, '::before', 'content')).toBe('""')
      expect(await pseudo(page, `${cur} [data-as="timeline"] > li`, '::before', 'width')).toBe('48px')
      await test.info().attach(`timeline (${theme})`, { body: await page.screenshot(), contentType: 'image/png' })

      // flow: boxes in a row, an arrow into each later one; cards beside each other.
      await go('the-blueprint/99')
      const flow = `${cur} [data-as="flow"]`
      const [a, b] = [await box(page, `${flow} > li:nth-child(1)`), await box(page, `${flow} > li:nth-child(2)`)]
      expect(b.left).toBeGreaterThan(a.right + 40)
      expect(Math.abs(b.top - a.top)).toBeLessThan(2)
      expect(await pseudo(page, `${flow} > li:nth-child(1)`, '::before', 'content')).toBe('none')
      expect(await pseudo(page, `${flow} > li:nth-child(2)`, '::before', 'content')).toBe('""')
      const accent = await page.locator(cur).evaluate((s) => getComputedStyle(s).getPropertyValue('--blitz-accent').trim())
      const accentRgb = await page.evaluate((c) => {
        const d = document.createElement('div')
        d.style.color = c
        document.body.append(d)
        const rgb = getComputedStyle(d).color
        d.remove()
        return rgb
      }, accent)
      await expect(page.locator(`${flow} > li.accent`)).toHaveCSS('background-color', accentRgb)
      const [c1, c2] = [await box(page, `${cur} [data-as="cards"] > :nth-child(1)`), await box(page, `${cur} [data-as="cards"] > :nth-child(2)`)]
      expect(c2.left).toBeGreaterThan(c1.right)
      await test.info().attach(`flow and cards (${theme})`, { body: await page.screenshot(), contentType: 'image/png' })

      // chevrons: arrow-shaped, the marked one in the accent.
      await go('the-road-to-open-source/99')
      await expect(page.locator(`${cur} [data-as="chevrons"] > li`).first()).toHaveCSS('clip-path', /polygon/)
      await expect(page.locator(`${cur} [data-as="chevrons"] > li.accent`)).toHaveCSS('background-color', accentRgb)
      await test.info().attach(`chevrons (${theme})`, { body: await page.screenshot(), contentType: 'image/png' })

      // compare: an arrow in each row, and between two containers.
      await go('what-changed/99')
      expect(await pseudo(page, `${cur} table[data-as="compare"] tbody td:last-child`, '::before', 'content')).toBe('""')
      await expect(page.locator(`${cur} table[data-as="compare"] tbody td:last-child`).first()).toHaveCSS('color', accentRgb)
      await test.info().attach(`compare table (${theme})`, { body: await page.screenshot(), contentType: 'image/png' })
      await go('two-sides/99')
      expect(await pseudo(page, `${cur} div[data-as="compare"] > :last-child`, '::before', 'content')).toBe('""')
      const [left, right] = [await box(page, `${cur} div[data-as="compare"] > :first-child`), await box(page, `${cur} div[data-as="compare"] > :last-child`)]
      expect(right.left).toBeGreaterThan(left.right + 80)
      await test.info().attach(`compare containers (${theme})`, { body: await page.screenshot(), contentType: 'image/png' })

      // cards (four in a row) and stats (three, figures large).
      await go('four-lessons/99')
      const cards = await page.locator(`${cur} [data-as="cards"] > *`).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))
      expect(new Set(cards).size).toBe(1)
      await test.info().attach(`cards (${theme})`, { body: await page.screenshot(), contentType: 'image/png' })
      await go('by-the-numbers')
      const figure = await page.locator(`${cur} [data-as="stats"] > * > :first-child`).first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize))
      const caption = await page.locator(`${cur} [data-as="stats"] > * > :last-child`).first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize))
      expect(figure).toBeGreaterThan(caption * 2.5)
      await test.info().attach(`stats (${theme})`, { body: await page.screenshot(), contentType: 'image/png' })
    } finally {
      server.close()
    }
  })
}
