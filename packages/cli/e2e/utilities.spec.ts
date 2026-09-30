/**
 * The utility-class contract (syntax.md §5.2, docs/themes.md): a theme that
 * only sets tokens still has `.columns`, `.callout`, `.muted` & co. from the
 * base styles; Pandoc's `.column width=` is honoured; and the built-in
 * themes' own rules keep winning over their element rules.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { buildAndServe } from './serve.js'

const TOKENS = `:root {
  --blitz-bg: #ffffff; --blitz-fg: #111111; --blitz-fg-muted: #777777; --blitz-accent: #0055aa;
  --blitz-chart-1: #111; --blitz-chart-2: #222; --blitz-chart-3: #333; --blitz-chart-4: #444;
  --blitz-chart-5: #555; --blitz-chart-6: #666; --blitz-chart-7: #777; --blitz-chart-8: #888;
}
`

const DECK = (theme: string) => `---
theme: ${theme}
---

# Utilities

:::: columns
::: {.column width=40%}
Left {.muted}
:::
::: column
### Right {.muted}
:::
::::

::: callout
Aside, [accented]{.accent} and [small]{.small}.
:::

| a | b |
|---|---|
| 1 | 2 |
| 3 | 4 |

{.zebra}
`

function deck(theme: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-utilities-'))
  writeFileSync(join(dir, 'tokens.css'), TOKENS)
  writeFileSync(join(dir, 'deck.md'), DECK(theme))
  return join(dir, 'deck.md')
}

test('a tokens-only theme gets every utility class from the base styles', async ({ page }) => {
  const { url, server } = await buildAndServe(deck('./tokens.css'))
  try {
    await page.goto(url)
    await page.waitForFunction(() => window.blitz)
    const slide = page.locator('.blitz-slide[data-blitz-current]')
    await expect(slide.locator('.columns')).toHaveCSS('display', 'flex')
    await expect(slide.locator('p.muted')).toHaveCSS('color', 'rgb(119, 119, 119)')
    await expect(slide.locator('span.accent')).toHaveCSS('color', 'rgb(0, 85, 170)')
    await expect(slide.locator('span.small')).toHaveCSS('font-size', '22px')
    await expect(slide.locator('.callout')).toHaveCSS('border-left-color', 'rgb(0, 85, 170)')
    await expect(slide.locator('table.zebra tbody tr').first()).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(slide.locator('table.zebra tbody tr').nth(1)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

    // `width=40%`: 40 % of the row; the other column takes the rest, less the gap.
    const [row, left, right] = await Promise.all(
      ['.columns', '.columns > :first-child', '.columns > :last-child'].map((s) => slide.locator(s).evaluate((e) => e.getBoundingClientRect().width)),
    )
    expect(left! / row!).toBeCloseTo(0.4, 2)
    expect(right! / row!).toBeGreaterThan(0.5)
  } finally {
    server.close()
  }
})

test('aurora keeps its own utility rules: `.muted` beats its accent `h3`', async ({ page }) => {
  const { url, server } = await buildAndServe(deck('aurora'))
  try {
    await page.goto(url)
    await page.waitForFunction(() => window.blitz)
    await expect(page.locator('.blitz-slide[data-blitz-current] h3.muted')).toHaveCSS('color', 'rgb(151, 162, 185)')
  } finally {
    server.close()
  }
})
