/**
 * Magic move within a slide (syntax.md §9.1): consecutive blocks sharing a
 * `key=` take turns in one box, each replacing the one before at its step.
 * Code morphs token by token, anything else moves and resizes, both ways,
 * on both transition engines (neither is used here, but the fallback
 * deletes APIs the runtime might have leaned on).
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { buildAndServe } from './serve.js'

const DECK = `---
title: Stacks
---

# Add

\`\`\`ts {key=add}
function add(a, b) {
  return a + b
}
\`\`\`

\`\`\`ts {key=add @1}
function add(a: number, b: number): number {
  // now with types
  return a + b
}
\`\`\`

After the code

---

# Figures

42% {key=fig}

42% of reports {key=fig @1 .big}
`

let url = ''
let server: Server
test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-stack-'))
  writeFileSync(join(dir, 'deck.md'), DECK)
  ;({ url, server } = await buildAndServe(join(dir, 'deck.md')))
})
test.afterAll(() => server?.close())

const top = (page: Page, sel: string) => page.locator(sel).evaluate((e) => Math.round(e.getBoundingClientRect().top))
const cur = '.blitz-slide[data-blitz-current]'

const settled = (page: Page) =>
  expect.poll(() => page.evaluate(() => document.getAnimations().length + document.querySelectorAll('[data-blitz-lift], [data-blitz-ghost]').length)).toBe(0)

for (const engine of ['view', 'waapi'] as const) {
  test.describe(`${engine} engine`, () => {
    test.beforeEach(async ({ page }) => {
      if (engine === 'waapi') {
        await page.addInitScript(() => {
          delete (Document.prototype as { startViewTransition?: unknown }).startViewTransition
        })
      }
      await page.goto(url)
      await page.waitForFunction(() => window.blitz)
      expect(await page.evaluate(() => window.blitz!.transitions.kind)).toBe(engine)
    })

    test('code blocks share one box and morph into each other at the step, and back', async ({ page }) => {
      const pres = page.locator(`${cur} [data-blitz-stack] > pre`)
      await expect(pres).toHaveCount(2)
      const after = await top(page, `${cur} p`)
      // One box: both versions start at the same place.
      const tops = await pres.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))
      expect(tops[0]).toBe(tops[1])
      expect(await pres.evaluateAll((els) => els.map((e) => getComputedStyle(e).visibility))).toEqual(['visible', 'hidden'])

      await page.keyboard.press('ArrowRight')
      // The new version is lifted and moving; the old one made way at once, with no fade of its own.
      await page.waitForFunction(() => (document.querySelector<HTMLElement>('[data-blitz-lift] pre')?.getAnimations().length ?? 0) > 0)
      const motion = await page.evaluate(() => {
        const moving = new Set<string>()
        for (const a of document.getAnimations()) {
          const el = (a.effect as KeyframeEffect).target as HTMLElement
          if (el.matches('.line > span') && (a.effect as KeyframeEffect).getKeyframes().some((k) => k.transform)) moving.add(el.textContent!)
        }
        const old = document.querySelector('.blitz-slide[data-blitz-current] [data-blitz-stack] > pre')!
        return { moving: [...moving], oldAnimations: old.getAnimations().length }
      })
      expect(motion.moving).toEqual(expect.arrayContaining(['b', 'return']))
      expect(motion.oldAnimations).toBe(0)
      await settled(page)
      expect(await pres.evaluateAll((els) => els.map((e) => getComputedStyle(e).visibility))).toEqual(['hidden', 'visible'])
      // The box is the larger version's all along: nothing below moved.
      expect(await top(page, `${cur} p`)).toBe(after)

      await page.keyboard.press('ArrowLeft')
      await page.waitForFunction(() => (document.querySelector<HTMLElement>('[data-blitz-lift] pre')?.getAnimations().length ?? 0) > 0)
      await settled(page)
      expect(await pres.evaluateAll((els) => els.map((e) => getComputedStyle(e).visibility))).toEqual(['visible', 'hidden'])
      expect(await page.evaluate(() => window.blitz!.pos)).toEqual({ slide: 0, step: 0 })
    })

    test('anything else moves and resizes from the old version onto the new', async ({ page }) => {
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowRight')
      await settled(page)
      await page.keyboard.press('ArrowRight')
      const frames = await page.evaluate(async () => {
        const next = document.querySelectorAll<HTMLElement>('.blitz-slide[data-blitz-current] [data-blitz-stack] > p')[1]!
        const anims = next.getAnimations()
        return anims.map((a) => (a.effect as KeyframeEffect).getKeyframes().map((k) => k.transform))
      })
      expect(frames).toHaveLength(1)
      // From a smaller figure (scaled down) to its own place.
      expect(frames[0]![0]).toMatch(/scale\(0\.\d+/)
      expect(frames[0]![1]).toBe('none')
    })
  })
}

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })
  test('swaps instantly', async ({ page }) => {
    await page.goto(url)
    await page.waitForFunction(() => window.blitz)
    await page.keyboard.press('ArrowRight')
    expect(await page.evaluate(() => document.getAnimations().length + document.querySelectorAll('[data-blitz-lift]').length)).toBe(0)
    expect(await page.locator(`${cur} [data-blitz-stack] > pre`).evaluateAll((els) => els.map((e) => getComputedStyle(e).visibility))).toEqual(['hidden', 'visible'])
  })
})
