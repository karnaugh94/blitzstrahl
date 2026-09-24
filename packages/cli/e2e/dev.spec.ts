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
