/**
 * Magic move (syntax.md §9.1): code blocks paired by auto-animate morph
 * token by token, on both transition engines.
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
  ;({ url, server } = await buildAndServe(join(here, 'fixtures/magic.md')))
})

test.afterAll(() => server?.close())

/** Viewport positions of a code block's tokens, by text (first occurrence), boxed as they move. */
function tokens(page: Page, scope: string): Promise<Record<string, [number, number]>> {
  return page.evaluate((scope) => {
    const out: Record<string, [number, number]> = {}
    const pre = document.querySelector<HTMLElement>(`${scope} pre`)!
    pre.dataset.blitzTokens = ''
    for (const t of pre.querySelectorAll<HTMLElement>('.line > span')) {
      const r = t.getBoundingClientRect()
      out[t.textContent!] ??= [Math.round(r.left), Math.round(r.top)]
    }
    delete pre.dataset.blitzTokens
    return out
  }, scope)
}

const freeze = (page: Page, at: number) =>
  page.evaluate((at) => {
    for (const a of document.getAnimations()) {
      a.pause()
      a.currentTime = Number(a.effect!.getTiming().duration) * at
    }
  }, at)

/** What each token of the moving code is doing. */
function tokenMotion(page: Page) {
  return page.evaluate(() => {
    const moving = new Set<string>()
    const fading = new Set<string>()
    for (const a of document.getAnimations()) {
      const effect = a.effect as KeyframeEffect
      const el = effect.target as HTMLElement | null
      if (!el?.matches?.('.line > span')) continue
      const frames = effect.getKeyframes()
      if (frames.some((k) => k.transform)) moving.add(el.textContent!)
      else if (frames[0]!.opacity === '0') fading.add(el.textContent!)
    }
    const ghosts = [...document.querySelectorAll('[data-blitz-ghost]')].map((g) => g.textContent)
    return { moving: [...moving].sort(), fading: [...fading].sort(), ghosts }
  })
}

/** The lifted block is moving. (On View Transitions its animations start at `ready`, a moment after the lift.) */
const morphing = (page: Page) =>
  page.waitForFunction(() => (document.querySelector<HTMLElement>('[data-blitz-lift] pre')?.getAnimations().length ?? 0) > 0)

const settled = (page: Page) =>
  expect.poll(() => page.evaluate(() => window.blitz!.transitions.running || document.getAnimations().length > 0)).toBe(false)

for (const engine of ['view', 'waapi'] as const) {
  test.describe(`${engine} engine`, () => {
    test.beforeEach(async ({ page }) => {
      if (engine === 'waapi') {
        await page.addInitScript(() => {
          delete (Document.prototype as { startViewTransition?: unknown }).startViewTransition
        })
      }
    })

    const open = async (page: Page, hash = '') => {
      await page.goto(url + hash)
      await page.waitForFunction(() => window.blitz)
      expect(await page.evaluate(() => window.blitz!.transitions.kind)).toBe(engine)
    }

    test('tokens that stay move, new ones fade in, and each starts where it was', async ({ page }) => {
      await open(page)
      const before = await tokens(page, '[data-blitz-current]')
      await page.keyboard.press('ArrowRight')
      await morphing(page)
      await freeze(page, 0)
      const motion = await tokenMotion(page)
      // Line 1 gains types, so what follows the first `a` moves right; a new line pushes `return` down.
      expect(motion.moving).toEqual(expect.arrayContaining([')', 'b', 'return', '{', '}']))
      expect(motion.moving).not.toContain('function')
      expect(motion.fading).toEqual(['/', 'number', 'now', 'types', 'with', ':'].sort())
      expect(motion.ghosts).toEqual([])
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('[data-blitz-slide="add"] pre')!).visibility), 'the old block makes way').toBe('hidden')
      const start = await tokens(page, '[data-blitz-lift]')
      for (const t of ['function', 'add', 'return', '}', 'b']) expect(start[t], t).toEqual(before[t])

      await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()))
      await settled(page)
      expect(await page.locator('[data-blitz-lift], [data-blitz-ghost]').count()).toBe(0)
      expect(await page.locator('[data-blitz-current] pre').count()).toBe(1)
      // (Chromium may leave an empty `style=""` behind once the CSSOM has been touched.)
      expect(await page.evaluate(() => [...document.querySelectorAll('pre')].map((p) => p.style.cssText).filter(Boolean)), 'every block is back as it was').toEqual([])
    })

    test('removed tokens fade out where they were', async ({ page }) => {
      await open(page, '#/add-2')
      await page.keyboard.press('ArrowRight')
      await morphing(page)
      expect((await tokenMotion(page)).ghosts).toEqual(['/', '/', 'now', 'with', 'types'])
      await settled(page)
      expect(await page.locator('[data-blitz-ghost]').count()).toBe(0)
    })

    test('moving code stays at full strength while the slides cross-fade', async ({ page }) => {
      await open(page)
      await page.keyboard.press('ArrowRight')
      await morphing(page)
      await freeze(page, 0.5)
      const full = await page.evaluate(() => {
        const pre = document.querySelector<HTMLElement>('[data-blitz-lift] pre')!
        let opacity = 1
        for (let el: HTMLElement | null = pre; el; el = el.parentElement) opacity *= Number(getComputedStyle(el).opacity)
        if (document.querySelector('[data-blitz-lift]')!.closest('[data-blitz-current], [data-blitz-outgoing]')) return 0
        // View Transitions: the layer is captured on its own (the browser fades
        // it in), and that fade is overridden to full opacity.
        const lifted = document.getAnimations().filter((a) => (a.effect as KeyframeEffect).pseudoElement === '::view-transition-new(blitz-lift-0)')
        if (window.blitz!.transitions.kind === 'waapi') return lifted.length ? 0 : opacity
        const captured = lifted.some((a) => a instanceof CSSAnimation && a.animationName === '-ua-view-transition-fade-in')
        const full = lifted.some((a) => !(a instanceof CSSAnimation) && (a.effect as KeyframeEffect).getKeyframes().every((k) => k.opacity === '1'))
        return captured && full ? opacity : 0
      })
      expect(full).toBe(1)
    })
  })
}
