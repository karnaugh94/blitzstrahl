/**
 * Accessibility (M11.6): axe over every example deck, in both built-in
 * themes (and the corporate example's own), in document mode (every
 * slide), the deck with each overlay open, and the presenter view. Serious
 * and critical findings fail; the rest are attached to the report.
 */
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { build } from '../dist/index.js'
import { serve } from './serve.js'

const here = dirname(fileURLToPath(import.meta.url))
const examples = join(here, '../../../examples')

/** Each example's deck file, and the themes it's checked in. */
const decks = readdirSync(examples).map((name) => {
  const file = readdirSync(join(examples, name)).find((f) => f.endsWith('.md'))!
  const own = /^theme:\s*(\.\S+)/m.exec(readFileSync(join(examples, name, file), 'utf8'))?.[1]
  return { name, file, themes: ['aurora', 'broadsheet', ...(own ? [own] : [])] }
})

test.use({ reducedMotion: 'reduce' })

// The examples, copied once (they share data: `../palette/sales.csv`), without their builds.
const copy = mkdtempSync(join(tmpdir(), 'blitz-a11y-'))
cpSync(examples, copy, { recursive: true, filter: (f) => !/[\\/](dist|[^\\/]+\.(pdf|html))$/.test(f) })

/** Nothing leaves the machine: tiles are a flat picture, other sites a plain page. */
async function offline(page: Page) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) =>
    route.request().resourceType() === 'image'
      ? route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#dde"/></svg>' })
      : route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><title>Stand-in</title><p>A stand-in page.</p></html>' }),
  )
}

async function audit(page: Page, what: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const serious = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  const minor = r.violations.filter((v) => !serious.includes(v))
  if (minor.length) await test.info().attach(`${what}: minor`, { body: JSON.stringify(minor.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target) })), null, 2), contentType: 'application/json' })
  expect(serious.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')} ${n.any[0]?.message ?? ''}`).join(' | ')}`), what).toEqual([])
}

for (const deck of decks) {
  for (const theme of deck.themes) {
    test.describe(`${deck.name} in ${theme}`, () => {
      let url = ''
      let server: Server
      test.beforeAll(async () => {
        // The example with `theme:` set, beside its original in the copy.
        const dir = join(copy, deck.name)
        const md = readFileSync(join(dir, deck.file), 'utf8')
        const themed = join(dir, `a11y-${theme.replace(/\W+/g, '')}.md`)
        writeFileSync(themed, /^theme:/m.test(md) ? md.replace(/^theme:.*$/m, `theme: ${theme}`) : md.replace(/^---\n/, `---\ntheme: ${theme}\n`))
        const out = mkdtempSync(join(tmpdir(), `blitz-a11y-${deck.name}-`))
        const r = await build(themed, { outDir: out, quiet: true, overflowCheck: false, report: false })
        expect(r.ok).toBe(true)
        ;({ url, server } = await serve(out))
      })
      test.afterAll(() => server?.close())

      test('document mode: every slide, with notes', async ({ page }) => {
        await offline(page)
        await page.goto(`${url}?mode=doc&notes`)
        await page.waitForFunction(() => (window as unknown as { blitzDocument?: unknown }).blitzDocument)
        await page.evaluate(() => (window as unknown as { blitzDocument: { print(): Promise<unknown> } }).blitzDocument.print())
        await audit(page, 'document mode')
      })

      test('the deck, and each overlay', async ({ page }) => {
        await offline(page)
        await page.goto(url)
        await page.waitForFunction(() => window.blitz)
        await audit(page, 'first slide')
        for (const [key, what] of [['o', 'overview'], ['?', 'key help'], ['g', 'go-to']] as const) {
          await page.keyboard.press(key)
          await expect(page.getByRole('dialog')).toBeVisible()
          await audit(page, what)
          await page.keyboard.press('Escape')
          await expect(page.getByRole('dialog')).toHaveCount(0)
        }
      })

      test('the presenter view', async ({ page }) => {
        await offline(page)
        await page.goto(`${url}#presenter`)
        await expect(page.locator('.bp')).toBeVisible()
        await audit(page, 'presenter view')
      })
    })
  }
}
