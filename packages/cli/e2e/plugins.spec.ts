/**
 * The plugin API (docs/plugins.md), end to end: a deck with a local theme
 * (tokens, CSS, a font) and a local plugin (a renderer, an entrance and an
 * emphasis effect, a frontmatter key), plus a CSS `@keyframes blitz-*`
 * effect. Every output mode: static, standalone and dev.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import type { ViteDevServer } from 'vite'
import { build, dev } from '../dist/index.js'
import { buildAndServe } from './serve.js'

const here = dirname(fileURLToPath(import.meta.url))
const deck = join(here, 'fixtures/plugins/deck.md')

async function exercise(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.waitForFunction(() => window.blitz)

  // Theme: tokens reach the slide, and its font file loads.
  const slide = page.locator('.blitz-slide').first()
  await expect(slide).toHaveCSS('background-color', 'rgb(250, 248, 240)')
  await expect(page.locator('h1')).toHaveCSS('font-family', '"Test Serif", Georgia, serif')
  expect(await page.evaluate(async () => (await document.fonts.load('30px "Test Serif"')).length)).toBe(1)

  // Renderer: mounts at its step, with the deck's frontmatter and tokens.
  const poll = page.locator('[data-blitz-block] .poll')
  await expect(poll).toHaveCount(0)
  await page.keyboard.press('ArrowRight')
  await expect(poll).toHaveText('Ship it? yes / no')
  await expect(poll).toHaveAttribute('data-endpoint', 'https://polls.test/launch')
  await expect(poll).toHaveAttribute('data-accent', 'rgb(194, 65, 12)')
  // The theme doesn't size render blocks; the base CSS does (block-height's default).
  expect(await page.locator('[data-blitz-block]').evaluate((el) => [el.offsetWidth > 0, el.offsetHeight])).toEqual([true, 420])

  // Entrance effect from the plugin: its keyframes, on an inline span made a box.
  await page.keyboard.press('ArrowRight')
  const frames = (id: string) =>
    page.evaluate((id) => document.getElementById(id)!.getAnimations().flatMap((a) => (a.effect as KeyframeEffect).getKeyframes().map((k) => k.transform)), id)
  expect(await frames('wobbly')).toEqual(['rotate(-8deg)', 'rotate(4deg)', 'none'])
  await expect(page.locator('#wobbly')).toHaveCSS('display', 'inline-block')
  await expect(poll).toHaveAttribute('data-step', '2')

  // Emphasis effect: its base style, then its active style.
  await expect(page.locator('#lit')).toHaveCSS('color', 'rgb(0, 0, 255)')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('#lit')).toHaveCSS('color', 'rgb(255, 0, 0)')

  // A CSS `@keyframes blitz-spin` in the deck is an effect too.
  await page.keyboard.press('ArrowRight')
  expect(await frames('spun')).toEqual(['rotate(-90deg)', 'none'])
  await expect(page.locator('#spun')).toHaveCSS('display', 'inline-block')

  expect(errors).toEqual([])
}

test('static build', async ({ page }) => {
  const { url, server, result } = await buildAndServe(deck)
  try {
    expect(result.diagnostics).toEqual([])
    await page.goto(url)
    await exercise(page)
  } finally {
    server.close()
  }
})

test('standalone file', async ({ page }) => {
  const outFile = join(mkdtempSync(join(tmpdir(), 'blitz-plugins-')), 'deck.html')
  const r = await build(deck, { standalone: true, outFile, quiet: true, overflowCheck: false })
  expect(r.ok).toBe(true)
  // The runtime's licence notice travels with every page (EUPL-1.2).
  expect(readFileSync(outFile, 'utf8')).toMatch(/^<!doctype html>\n<!--\n  Made with blitzstrahl \d+\.\d+\.\d+(-[\w.]+)?\. The slide runtime in this page is\n  \(c\) the blitzstrahl authors, licensed under the EUPL-1\.2/)
  await page.goto(pathToFileURL(outFile).href)
  await exercise(page)
})

test('dev server', async ({ page }) => {
  let server: ViteDevServer | undefined
  try {
    server = await dev(deck, { port: 0 })
    await page.goto(server.resolvedUrls!.local[0]!)
    await exercise(page)
  } finally {
    await server?.close()
  }
})
