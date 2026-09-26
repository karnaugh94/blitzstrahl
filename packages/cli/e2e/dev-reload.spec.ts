/**
 * Editing a local theme, or a file it imports, reaches the open deck under
 * `dev` without a restart (PLAN §15, M6.8). 1.0 imported themes with Node's
 * `import()`, whose cache never forgets a module.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ViteDevServer } from 'vite'
import { dev } from '../dist/index.js'

const REQUIRED = `bg: '#ffffff', fg: '#111111', 'fg-muted': '#555555',
  'chart-1': '#111', 'chart-2': '#222', 'chart-3': '#333', 'chart-4': '#444', 'chart-5': '#555', 'chart-6': '#666', 'chart-7': '#777', 'chart-8': '#888'`

test('a local theme and the files it imports reload in dev', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-dev-reload-'))
  writeFileSync(join(dir, 'talk.md'), '---\ntheme: ./brand.mjs\n---\n\n# Branded\n')
  writeFileSync(join(dir, 'tokens.mjs'), "export const accent = '#cc0000'\n")
  const theme = join(dir, 'brand.mjs')
  writeFileSync(
    theme,
    `import { accent } from './tokens.mjs'\nexport default {\n  name: 'brand',\n  tokens: { ${REQUIRED}, accent },\n  css: '.blitz-slide h1 { color: rgb(255, 0, 0); }',\n}\n`,
  )
  let server: ViteDevServer | undefined
  try {
    server = await dev(join(dir, 'talk.md'), { port: 0 })
    await page.goto(server.resolvedUrls!.local[0]!)
    await page.waitForFunction(() => window.blitz)
    // The page reloads itself mid-poll; a read that meets the navigation just tries again.
    const h1 = () => page.evaluate(() => getComputedStyle(document.querySelector('.blitz-slide h1')!).color).catch(() => undefined)
    const accent = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--blitz-accent').trim()).catch(() => undefined)
    expect(await h1()).toBe('rgb(255, 0, 0)')
    expect(await accent()).toBe('#cc0000')

    writeFileSync(theme, readFileSync(theme, 'utf8').replace('rgb(255, 0, 0)', 'rgb(0, 128, 0)'))
    await expect.poll(h1, { timeout: 10_000 }).toBe('rgb(0, 128, 0)')

    // A file the theme imports, not the theme itself.
    writeFileSync(join(dir, 'tokens.mjs'), "export const accent = '#0055aa'\n")
    await expect.poll(accent, { timeout: 10_000 }).toBe('#0055aa')
  } finally {
    await server?.close()
  }
})
