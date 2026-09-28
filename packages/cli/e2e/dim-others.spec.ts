/**
 * `dim-others` (syntax.md §6.3): at its step, everything else in its parent
 * dims, list items and bare text alike; before it, nothing is dimmed.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { buildAndServe } from './serve.js'

const DECK = `# Dim

- Collect
- Clean {.dim-others @1}
- Chart

The [key point]{.dim-others @2} of this sentence.
`

test.use({ reducedMotion: 'reduce' })

test('dim-others dims list items and the bare text beside it', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-dim-'))
  writeFileSync(join(dir, 'deck.md'), DECK)
  const { url, server } = await buildAndServe(join(dir, 'deck.md'))
  try {
    const opacities = () =>
      page.evaluate(() => {
        const slide = document.querySelector('.blitz-slide[data-blitz-current]')!
        const o = (e: Element) => Number(getComputedStyle(e).opacity)
        const p = slide.querySelector('p')!
        return { items: [...slide.querySelectorAll('li')].map(o), text: [...p.children].map(o), words: [...p.children].map((c) => c.textContent) }
      })
    await page.goto(url)
    await page.waitForFunction(() => window.blitz)
    await expect.poll(opacities).toEqual({ items: [1, 1, 1], text: [1, 1, 1], words: ['The ', 'key point', ' of this sentence.'] })
    await page.keyboard.press('ArrowRight')
    await expect.poll(opacities).toMatchObject({ items: [0.3, 1, 0.3], text: [1, 1, 1] })
    await page.keyboard.press('ArrowRight')
    // Emphasis without an out-step stays on (§6.3): the list is still dimmed.
    await expect.poll(opacities).toMatchObject({ items: [0.3, 1, 0.3], text: [0.3, 1, 0.3] })
  } finally {
    server.close()
  }
})
