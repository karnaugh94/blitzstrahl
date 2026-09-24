/**
 * Slide transitions (syntax.md §9) on both engines: View Transitions, and
 * the WAAPI fallback that browsers without them (Safari) get. The fallback
 * is exercised by removing `startViewTransition` before the runtime boots.
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
  ;({ url, server } = await buildAndServe(join(here, 'fixtures/transitions.md')))
})

test.afterAll(() => server?.close())

interface SlideAnim {
  role: 'old' | 'new'
  frames: string[]
  direction: string
}

/** The running slide animations, whichever engine plays them. */
function slideAnims(page: Page): Promise<SlideAnim[]> {
  return page.evaluate(() => {
    const out: SlideAnim[] = []
    for (const a of document.getAnimations()) {
      const effect = a.effect as KeyframeEffect
      const frames = effect.getKeyframes().map((k) => String(k.transform ?? k.opacity))
      const direction = effect.getTiming().direction ?? 'normal'
      const pseudo = effect.pseudoElement
      if (pseudo?.includes('blitz-stage')) {
        out.push({ role: pseudo.includes('old') ? 'old' : 'new', frames, direction })
      } else if (effect.target instanceof HTMLElement && effect.target.classList.contains('blitz-slide')) {
        out.push({ role: effect.target.dataset.blitzOutgoing !== undefined ? 'old' : 'new', frames, direction })
      }
    }
    return out.sort((x, y) => x.role.localeCompare(y.role))
  })
}

/** Slide animations only exist for a few hundred ms: poll often. */
const fast = { intervals: [20] }

const pos = (page: Page) => page.evaluate(() => window.blitz!.pos)
const current = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-blitz-current]')].map((s) => s.dataset.blitzSlide))
const settled = (page: Page) =>
  expect
    .poll(() =>
      page.evaluate(
        () => window.blitz!.transitions.running || document.querySelectorAll('[data-blitz-outgoing]').length + document.getAnimations().length > 0,
      ),
    )
    .toBe(false)

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

    test('push-left moves both slides left', async ({ page }) => {
      await open(page)
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => slideAnims(page), fast).toEqual([
        { role: 'new', frames: ['translateX(100%)', 'none'], direction: 'normal' },
        { role: 'old', frames: ['none', 'translateX(-100%)'], direction: 'normal' },
      ])
      await settled(page)
      expect(await current(page)).toEqual(['pushed'])
    })

    test('going back plays the entered slide’s transition mirrored', async ({ page }) => {
      await open(page, '#/covered')
      await page.keyboard.press('ArrowLeft')
      // cover-up, backwards: the covering slide slides back down, off the old one.
      await expect.poll(() => slideAnims(page), fast).toEqual([
        { role: 'new', frames: ['none', 'none'], direction: 'reverse' },
        { role: 'old', frames: ['translateY(100%)', 'none'], direction: 'reverse' },
      ])
      await settled(page)
      expect(await current(page)).toEqual(['pushed'])
    })

    test('uncover moves the old slide away over the new', async ({ page }) => {
      await open(page, '#/covered')
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => slideAnims(page), fast).toEqual([
        { role: 'new', frames: ['none', 'none'], direction: 'normal' },
        { role: 'old', frames: ['none', 'translateX(100%)'], direction: 'normal' },
      ])
      // …and it's the old slide that paints on top.
      const top = await page.evaluate(
        () =>
          document.documentElement.dataset.blitzVtTop ??
          (document.querySelector<HTMLElement>('[data-blitz-outgoing]')?.style.zIndex === '2' ? 'old' : 'new'),
      )
      expect(top).toBe('old')
    })

    test('`none` cuts at once', async ({ page }) => {
      await open(page, '#/chart')
      await page.keyboard.press('ArrowRight')
      expect(await current(page)).toEqual(['cut'])
      expect(await slideAnims(page)).toEqual([])
    })

    test('rapid input lands on the right slide with nothing left over', async ({ page }) => {
      await open(page)
      for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
      expect(await pos(page)).toEqual({ slide: 3, step: 0 })
      await settled(page)
      expect(await current(page)).toEqual(['chart'])
    })

    test('a click during a transition still navigates', async ({ page }) => {
      await open(page)
      await page.mouse.click(1260, 360)
      await page.mouse.click(1260, 360)
      await expect.poll(() => pos(page)).toEqual({ slide: 2, step: 0 })
      await settled(page)
      expect(await current(page)).toEqual(['covered'])
    })

    test('the moving slides stay inside the canvas', async ({ page }) => {
      // Letterboxed: 1280×720 canvas centred in a taller window.
      await page.setViewportSize({ width: 1280, height: 1000 })
      await open(page, '#/pushed')
      // cover-up: the entering slide rises from below the canvas.
      const band = { x: 0, y: 1000 - 130, width: 1280, height: 130 }
      const idle = await page.screenshot({ clip: band })
      await page.keyboard.press('ArrowRight')
      await expect.poll(async () => (await slideAnims(page)).length, fast).toBe(2)
      await page.evaluate(() =>
        document.getAnimations().forEach((a) => {
          a.pause()
          a.currentTime = 200
        }),
      )
      expect(await page.screenshot({ clip: band })).toEqual(idle)
    })

    test('while blacked out, slides cut instead of transitioning', async ({ page }) => {
      // A view transition paints above everything, the black screen included.
      await open(page)
      await page.keyboard.press('b')
      await page.keyboard.press('ArrowRight')
      expect(await page.evaluate(() => window.blitz!.transitions.running)).toBe(false)
      expect(await slideAnims(page)).toEqual([])
      expect(await current(page)).toEqual(['pushed'])
    })

    test.describe('reduced motion', () => {
      test.use({ reducedMotion: 'reduce' })

      test('every transition is a cut', async ({ page }) => {
        await open(page)
        await page.keyboard.press('ArrowRight')
        expect(await current(page)).toEqual(['pushed'])
        expect(await slideAnims(page)).toEqual([])
      })
    })
  })
}

test('fallback: a chart stays on the outgoing slide until it has left', async ({ page }) => {
  await page.addInitScript(() => {
    delete (Document.prototype as { startViewTransition?: unknown }).startViewTransition
  })
  await page.goto(url + '#/chart')
  await page.waitForFunction(() => window.blitz)
  await expect(page.locator('#chart svg')).toHaveCount(1)
  await page.keyboard.press('ArrowLeft')
  // Still there while the slide moves away…
  expect(await page.locator('[data-blitz-outgoing] #chart svg').count()).toBe(1)
  // …and torn down once it's out of sight.
  await expect(page.locator('#chart svg')).toHaveCount(0)
  expect(await page.locator('[data-blitz-outgoing]').count()).toBe(0)
})
