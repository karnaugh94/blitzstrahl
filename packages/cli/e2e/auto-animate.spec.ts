/**
 * auto-animate (syntax.md §9) on both engines: paired elements move from
 * their place on the old slide to their place on the new one.
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
  ;({ url, server } = await buildAndServe(join(here, 'fixtures/morph.md')))
})

test.afterAll(() => server?.close())

interface Box {
  x: number
  y: number
  h: number
}

/** Where an element's text is drawn, transforms included. */
function textBox(page: Page, selector: string): Promise<Box> {
  return page.evaluate((sel) => {
    const el = document.querySelector(`[data-blitz-current] ${sel}`)!
    const r = document.createRange()
    r.selectNodeContents(el)
    const b = r.getBoundingClientRect()
    return { x: Math.round(b.left), y: Math.round(b.top), h: Math.round(b.height) }
  }, selector)
}

/** Freeze every running animation at a fraction of its duration. */
const freeze = (page: Page, at: number) =>
  page.evaluate((at) => {
    for (const a of document.getAnimations()) {
      a.pause()
      a.currentTime = Number(a.effect!.getTiming().duration) * at
    }
  }, at)

/** Where an element's border box is drawn, transforms included. */
function box(page: Page, selector: string): Promise<{ x: number; y: number }> {
  return page.evaluate((sel) => {
    const b = document.querySelector(`[data-blitz-current] ${sel}`)!.getBoundingClientRect()
    return { x: Math.round(b.left), y: Math.round(b.top) }
  }, selector)
}

/**
 * Text of the new slide's elements moving in from the old slide, and how
 * many old ones move out. On View Transitions an old element only counts
 * if the browser captured it on its own (its fade-out exists) and it moves.
 */
function morphs(page: Page): Promise<{ in: string[]; out: number }> {
  return page.evaluate(() => {
    const incoming: string[] = []
    let out = 0
    const captured = new Set<string>()
    const moved = new Set<string>()
    for (const a of document.getAnimations()) {
      const effect = a.effect as KeyframeEffect
      const pseudo = effect.pseudoElement ?? ''
      if (pseudo.startsWith('::view-transition-old(blitz-morph-') && (a as CSSAnimation).animationName === '-ua-view-transition-fade-out') captured.add(pseudo)
      if (!effect.getKeyframes().some((k) => String(k.transform ?? 'none').includes('scale'))) continue
      const target = effect.target as HTMLElement
      if (pseudo) moved.add(pseudo)
      else if (target.closest('[data-blitz-outgoing]')) out++
      else if (target.closest('[data-blitz-current]')) incoming.push((target.textContent ?? '').trim())
    }
    out += [...moved].filter((p) => captured.has(p)).length
    return { in: incoming.sort(), out }
  })
}

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

    test('pairs by key and by content, and only what the new slide shows', async ({ page }) => {
      await open(page)
      await page.keyboard.press('ArrowRight')
      // "Later" is on both slides, but the new slide hides it until step 1.
      await expect.poll(() => morphs(page)).toEqual({ in: ['A line that stays', 'Card', 'Morph'], out: 3 })
      await settled(page)
    })

    test('a heading moves and shrinks from its old place into its new one', async ({ page }) => {
      await open(page)
      const before = await textBox(page, 'h1')
      const card = await box(page, '.card')
      await page.keyboard.press('ArrowRight')
      await page.waitForFunction(() => document.getAnimations().length > 0)
      await freeze(page, 0)
      const start = await textBox(page, 'h2')
      expect(await box(page, '.card'), 'the card starts where it was').toEqual(card)
      await freeze(page, 1)
      const end = await textBox(page, 'h2')
      await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()))
      await settled(page)
      const after = await textBox(page, 'h2')

      expect(Math.abs(start.x - before.x), 'starts where the title was').toBeLessThanOrEqual(1)
      expect(Math.abs(start.y - before.y)).toBeLessThanOrEqual(1)
      expect(Math.abs(start.h - before.h), 'at the title’s size').toBeLessThanOrEqual(2)
      expect(end).toEqual(after)
      expect(after.h).toBeLessThan(before.h * 0.8)
    })

    test('going back morphs too, into the earlier slide at its last step', async ({ page }) => {
      await open(page, '#/morph-2')
      await page.keyboard.press('ArrowLeft')
      await expect.poll(() => morphs(page)).toEqual({ in: ['A line that stays', 'Card', 'Morph'], out: 3 })
      await settled(page)
      expect(await page.evaluate(() => window.blitz!.pos)).toEqual({ slide: 0, step: 0 })
    })

    test('an element revealed by a step pairs once it is shown', async ({ page }) => {
      await open(page, '#/morph-2/1')
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => morphs(page)).toEqual({ in: ['Later'], out: 1 })
      await settled(page)
      // Back again lands on step 1, where "Later" is shown: it pairs.
      await page.keyboard.press('ArrowLeft')
      await expect.poll(() => morphs(page)).toEqual({ in: ['Later'], out: 1 })
    })
  })
}
