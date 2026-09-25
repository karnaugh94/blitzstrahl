/**
 * The built-in themes: every example deck builds under `--strict` (no slide
 * overflows) in each, and broadsheet's own fonts load, served and from a
 * standalone file.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { build } from '../dist/index.js'
import { buildAndServe } from './serve.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')

/** A copy of an example deck, set to `theme`. The whole folder: decks share data files. */
function themed(example: string, theme: string): string {
  const dir = mkdtempSync(join(tmpdir(), `blitz-${theme}-`))
  cpSync(join(root, 'examples'), dir, { recursive: true, filter: (src) => !/\/dist$|\.(pdf|html)$/.test(src) })
  const deck = join(dir, example, 'deck.md')
  const md = readFileSync(deck, 'utf8')
  writeFileSync(deck, /^theme:/m.test(md) ? md.replace(/^theme:.*$/m, `theme: ${theme}`) : md.replace(/^---\n/, `---\ntheme: ${theme}\n`))
  return deck
}

for (const theme of ['aurora', 'broadsheet']) {
  for (const example of ['layouts', 'palette', 'auto-animate']) {
    test(`${example} fits every slide in ${theme}`, async () => {
      test.setTimeout(120_000)
      const outDir = mkdtempSync(join(tmpdir(), 'blitz-themes-out-'))
      const r = await build(themed(example, theme), { outDir, quiet: true, strict: true, report: false })
      expect(r.diagnostics.filter((d) => d.severity !== 'info')).toEqual([])
      expect(r.overflow).toEqual([])
      expect(r.ok).toBe(true)
    })
  }
}

async function newsreader(page: Page) {
  await page.waitForFunction(() => window.blitz)
  await expect(page.locator('.blitz-slide').first()).toHaveCSS('background-color', 'rgb(247, 244, 236)')
  expect(await page.evaluate(async () => (await document.fonts.load('30px Newsreader')).length)).toBe(1)
  expect(await page.evaluate(async () => (await document.fonts.load('italic 30px Newsreader')).length)).toBe(1)
}

test('broadsheet ships its fonts in a static build', async ({ page }) => {
  const { url, server } = await buildAndServe(themed('layouts', 'broadsheet'))
  try {
    await page.goto(url)
    await newsreader(page)
  } finally {
    server.close()
  }
})

test('broadsheet inlines its fonts into a standalone file', async ({ page }) => {
  const outFile = join(mkdtempSync(join(tmpdir(), 'blitz-broadsheet-')), 'deck.html')
  const r = await build(themed('layouts', 'broadsheet'), { standalone: true, outFile, quiet: true, overflowCheck: false })
  expect(r.ok).toBe(true)
  expect(readFileSync(outFile, 'utf8')).toContain('font-family: "Newsreader"; src: url("data:font/woff2;base64,')
  await page.goto(pathToFileURL(outFile).href)
  await newsreader(page)
})
