/**
 * M4's exit test: `examples/auto-animate`, the deck that shows off
 * auto-animate, magic move, math and a chart moving between layouts. It
 * builds cleanly, and every transition moves exactly what the two slides
 * share, on both engines.
 */
import type { Server } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { build } from '../dist/index.js'
import { serve } from './serve.js'

const here = dirname(fileURLToPath(import.meta.url))
const deck = join(here, '../../../examples/auto-animate/deck.md')
let url = ''
let server: Server

test.beforeAll(async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'blitz-showcase-'))
  // `--strict`: nothing may overflow. And no warnings at all.
  const r = await build(deck, { outDir, quiet: true, report: false, strict: true })
  expect(r.ok).toBe(true)
  expect([...r.diagnostics, ...r.overflow].filter((d) => d.severity !== 'info')).toEqual([])
  ;({ url, server } = await serve(outDir))
})

test.afterAll(() => server?.close())

/** What moves from the previous slide: keys, content matches (tag and text), and `code` for magic move. */
function moving(page: Page) {
  return page.evaluate(() => {
    const out = new Set<string>()
    for (const a of document.getAnimations()) {
      const effect = a.effect as KeyframeEffect
      const t = effect.target as HTMLElement | null
      if (!t?.closest?.('[data-blitz-current]') || t.classList.contains('blitz-slide')) continue
      if (!effect.getKeyframes().some((k) => String(k.transform ?? '').includes('scale'))) continue
      out.add(t.dataset.blitzKey ? `#${t.dataset.blitzKey}` : `${t.localName} ${(t.textContent ?? '').trim()}`)
    }
    if (document.querySelector('[data-blitz-lift]')) out.add('code')
    return [...out].sort()
  })
}

const EXPECTED: string[][] = [
  ['#logo', 'h2 Everything that stays, moves'],
  ['#logo'],
  ['#html', '#ir', '#logo', '#md', 'h2 One pipeline'],
  ['#logo'],
  ['#logo', 'h2 A list that grows', 'li Chart', 'li Collect'],
  ['#logo', 'li Chart', 'li Clean', 'li Collect', 'li Tell the story'],
  [],
  ['code', 'h2 Code, one change at a time'],
  ['code', 'h2 Code, one change at a time'],
  [],
  ['#energy', '#logo', 'h2 Math, typeset when the deck is built'],
  ['#logo'],
  ['#logo', '#sales', 'h2 Revenue by region'],
  ['#logo'],
]

for (const engine of ['view', 'waapi'] as const) {
  test(`every slide moves what it shares with the last (${engine} engine)`, async ({ page }) => {
    if (engine === 'waapi') {
      await page.addInitScript(() => {
        delete (Document.prototype as { startViewTransition?: unknown }).startViewTransition
      })
    }
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(url)
    await page.waitForFunction(() => window.blitz)
    expect(await page.evaluate(() => window.blitz!.transitions.kind)).toBe(engine)
    const count = await page.evaluate(() => window.blitz!.slideCount)
    expect(count).toBe(EXPECTED.length + 1)
    const seen: string[][] = []
    for (let i = 0; i < count - 1; i++) {
      await page.evaluate((n) => window.blitz!.goto(n, 99), i)
      await expect.poll(() => page.evaluate(() => window.blitz!.transitions.running || document.getAnimations().length > 0)).toBe(false)
      await page.evaluate((n) => window.blitz!.goto(n + 1, 0), i)
      // Every transition cross-fades the slides (two animations) before anything else.
      await page.waitForFunction(() => document.getAnimations().length >= 2)
      await page.waitForFunction(() => !document.querySelector('[data-blitz-lift]') || (document.querySelector<HTMLElement>('[data-blitz-lift] pre')?.getAnimations().length ?? 0) > 0)
      seen.push(await moving(page))
      await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()))
    }
    expect(seen).toEqual(EXPECTED)
    expect(errors).toEqual([])
  })
}
