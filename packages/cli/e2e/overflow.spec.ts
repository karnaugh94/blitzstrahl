/**
 * The overflow detector (PLAN §7): no slide overflows undetected. `build`
 * lists every overflowing slide at its line, `--strict` fails, and the dev
 * server badges the slide and outlines the culprits.
 */
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { build, dev } from '../dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = join(here, 'fixtures/overflow.md')
const out = () => mkdtempSync(join(tmpdir(), 'blitz-overflow-'))

test('build warns about each overflowing slide, at its line', async () => {
  const r = await build(fixture, { outDir: out(), quiet: true })
  expect(r.ok).toBe(true)
  expect(r.overflow.map((d) => [d.span.start.line, d.code, d.message])).toEqual([
    [12, 'overflow/canvas', expect.stringMatching(/^slide `bullets` overflows: content runs off the canvas: \d+px past the bottom$/)],
    [32, 'overflow/clipped', expect.stringMatching(/^slide `a-wide-code-block` overflows: a code block cuts off its content \(\d+px on the right hidden\)$/)],
    [40, 'overflow/canvas', expect.stringMatching(/past the right$/)],
    // Hidden build steps still take their space: a later step overflowing counts.
    [46, 'overflow/canvas', expect.stringMatching(/past the bottom$/)],
  ])
})

test('--strict fails the build when a slide overflows', async () => {
  const r = await build(fixture, { outDir: out(), quiet: true, strict: true })
  expect(r.ok).toBe(false)
  expect(r.index).toBeDefined()
})

test('the example decks fit', async () => {
  for (const deck of ['thin-slice/talk.md', 'layouts/deck.md']) {
    const r = await build(join(here, '../../../examples', deck), { outDir: out(), quiet: true, strict: true })
    expect(r.overflow, deck).toEqual([])
    expect(r.ok, deck).toBe(true)
  }
})

test('dev badges an overflowing slide and outlines the culprit, and clears when fixed', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-dev-overflow-'))
  const deck = join(dir, 'overflow.md')
  copyFileSync(fixture, deck)
  const server = await dev(deck, { port: 0 })
  try {
    await page.goto(server.resolvedUrls!.local[0]! + '#/a-wide-code-block')
    await page.waitForFunction(() => window.blitz)
    const badge = page.locator('.blitz-overflow-badge')
    await expect(badge).toBeVisible()
    await expect(badge).toContainText('a code block cuts off its content')
    await expect(page.locator('[data-blitz-current] pre[data-blitz-overflow]')).toHaveCount(1)

    await page.keyboard.press('Home')
    await expect(badge).toBeHidden()

    await page.goto(server.resolvedUrls!.local[0]! + '#/bullets')
    await expect(badge).toBeVisible()
    writeFileSync(deck, readFileSync(deck, 'utf8').replace(/^- Point number (\d\d).*\n/gm, '').replace(/^- Point number [4-9].*\n/gm, ''))
    await expect(badge).toBeHidden()
    await expect(page.locator('[data-blitz-current] [data-blitz-overflow]')).toHaveCount(0)
  } finally {
    await server.close()
  }
})

test.describe('BLITZSTRAHL_SKIP_OVERFLOW_CHECK', () => {
  test.afterEach(() => {
    delete process.env.BLITZSTRAHL_SKIP_OVERFLOW_CHECK
  })

  test('skips the check; --strict checks anyway', async () => {
    process.env.BLITZSTRAHL_SKIP_OVERFLOW_CHECK = '1'
    const skipped = await build(fixture, { outDir: out(), quiet: true })
    expect(skipped.ok).toBe(true)
    expect(skipped.overflow).toEqual([])
    const strict = await build(fixture, { outDir: out(), quiet: true, strict: true })
    expect(strict.ok).toBe(false)
    expect(strict.overflow.length).toBeGreaterThan(0)
  })

  test('"0" or "false" leaves the check on', async () => {
    process.env.BLITZSTRAHL_SKIP_OVERFLOW_CHECK = 'false'
    const r = await build(fixture, { outDir: out(), quiet: true })
    expect(r.overflow.length).toBeGreaterThan(0)
  })
})
