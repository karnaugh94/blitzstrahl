/**
 * `blitzstrahl dev`: saving the markdown updates the open deck in place,
 * keeping the current slide and step (PLAN §7).
 */
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { ViteDevServer } from 'vite'
import { dev } from '../dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))
let server: ViteDevServer
let deck = ''

test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-dev-'))
  deck = join(dir, 'nav.md')
  copyFileSync(join(here, 'fixtures/nav.md'), deck)
  copyFileSync(join(here, 'fixtures/data.csv'), join(dir, 'data.csv'))
  server = await dev(deck, { port: 0 })
})

test.afterAll(() => server?.close())

test('saving the deck hot-swaps it and keeps slide and step', async ({ page }) => {
  const base = server.resolvedUrls!.local[0]!
  await page.goto(base + '#/two/2')
  await page.waitForFunction(() => window.blitz)
  await page.evaluate(() => ((window as unknown as { marker: number }).marker = 42))

  writeFileSync(deck, readFileSync(deck, 'utf8').replace('Second {#b @2}', 'Second, edited {#b @2}'))
  await expect(page.locator('#b')).toHaveText('Second, edited')
  expect(await page.evaluate(() => window.blitz!.pos)).toEqual({ slide: 1, step: 2 })
  // Same page, not a reload.
  expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(42)
})

test('the presenter view works under dev, and its notes hot-update', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-dev-presenter-'))
  const talk = join(dir, 'presenter.md')
  copyFileSync(join(here, 'fixtures/presenter.md'), talk)
  const presenting = await dev(talk, { port: 0 })
  try {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(presenting.resolvedUrls!.local[0]!)
    await page.waitForFunction(() => window.blitz)
    const [presenter] = await Promise.all([page.context().waitForEvent('page'), page.keyboard.press('p')])
    presenter.on('pageerror', (e) => errors.push(`presenter: ${String(e)}`))
    await expect(presenter.locator('.bp-status')).toHaveText('Connected')
    await expect(presenter.locator('.bp-notes')).toContainText('Opening notes.')

    writeFileSync(talk, readFileSync(talk, 'utf8').replace('Opening notes.', 'Opening notes, edited.'))
    await expect(presenter.locator('.bp-notes')).toContainText('Opening notes, edited.')
    await presenter.keyboard.press('ArrowRight')
    await expect.poll(() => page.evaluate(() => window.blitz!.pos)).toEqual({ slide: 1, step: 0 })
    expect(errors).toEqual([])
  } finally {
    await presenting.close()
  }
})
