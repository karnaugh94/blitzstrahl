/**
 * `blitzstrahl theme import` end to end (PLAN §15, M9.4): the command line
 * on a generated template, then its sample deck, built under `--strict` and
 * looked at in the browser.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { makeTemplate } from '../../../scripts/potx.mjs'
import { buildAndServe } from './serve.js'

const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url))
const cli = (dir: string, ...args: string[]) => spawnSync(process.execPath, [BIN, ...args], { cwd: dir, encoding: 'utf8' })

test.use({ reducedMotion: 'reduce' })

test('import a template, then present its sample deck', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-theme-import-'))
  writeFileSync(join(dir, 'kestrel.potx'), makeTemplate())

  const r = cli(dir, 'theme', 'import', 'kestrel.potx', '--out', 'brand')
  expect(r.stderr).toBe('')
  expect(r.status).toBe(0)
  expect(r.stdout).toContain('wrote brand/brand.css, brand/sample.md and the pictures in brand/img')
  expect(r.stdout).toContain('colours: bg #ffffff, fg #1b2a3a, accent #0b7a75, accent-2 #e07a1f')
  expect(r.stdout).toContain('  - layout "Quote": matches no blitzstrahl layout')
  expect(r.stdout).toContain('npx blitzstrahl dev brand/sample.md')

  // Again, into the same folder: refused, and nothing changes.
  const again = cli(dir, 'theme', 'import', 'kestrel.potx', '--out', 'brand')
  expect(again.status).toBe(2)
  expect(again.stderr).toMatch(/^blitzstrahl: brand isn't empty; nothing was written/)
  expect(cli(dir, 'theme', 'export', 'x.potx').status).toBe(2)

  // The sample builds with nothing overflowing.
  const { url, server, result } = await buildAndServe(join(dir, 'brand', 'sample.md'), { overflowCheck: true, strict: true })
  try {
    expect(result.overflow).toEqual([])
    expect(result.diagnostics.filter((d) => d.severity !== 'info')).toEqual([])
    await page.goto(url)
    await page.waitForFunction(() => window.blitz)
    const look = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.blitz-slide')].map((s) => {
        s.style.display = 'grid'
        const style = getComputedStyle(s)
        const logo = s.querySelector<HTMLImageElement>('[data-chrome="logo"]')
        const box = logo && getComputedStyle(logo).display !== 'none' ? logo.getBoundingClientRect() : undefined
        const at = s.getBoundingClientRect()
        const k = at.width / 1280
        const out = {
          layout: s.dataset.layout,
          image: /url\(/.test(style.backgroundImage),
          colour: style.backgroundColor,
          text: getComputedStyle(s.querySelector('h1')!).color,
          logo: box ? [Math.round((box.left - at.left) / k), Math.round((box.top - at.top) / k), Math.round(box.width / k)] : null,
        }
        s.style.display = ''
        return out
      }),
    )
    expect(look.slice(0, 3)).toEqual([
      { layout: 'title', image: true, colour: 'rgb(255, 255, 255)', text: 'rgb(27, 42, 58)', logo: [1042, 20, 150] },
      { layout: 'section', image: false, colour: 'rgb(8, 92, 88)', text: 'rgb(255, 255, 255)', logo: [1042, 20, 150] },
      { layout: 'default', image: true, colour: 'rgb(255, 255, 255)', text: 'rgb(27, 42, 58)', logo: [1042, 20, 150] },
    ])
    expect(await page.locator('[data-chrome="logo"]').first().evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBe(120)
  } finally {
    server.close()
  }
})
