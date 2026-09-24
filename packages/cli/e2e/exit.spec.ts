/**
 * M3's exit criterion (PLAN §10): a deck using every content type exports to
 * PDF and to a single file. The deck is `examples/palette`, copied with its
 * map tiles and embedded page pointed at a local server, so the test needs
 * no network.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'
import { build, exportPdf } from '../dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))
let site: Server
let deck = ''

test.beforeAll(async () => {
  site = createServer((req, res) => {
    if (req.url?.startsWith('/tiles/')) {
      res.setHeader('content-type', 'image/svg+xml')
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#ccd"/></svg>')
    } else {
      res.setHeader('content-type', 'text/html')
      res.end('<h1>An embedded page</h1>')
    }
  })
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r))
  const local = `http://127.0.0.1:${(site.address() as { port: number }).port}`
  const dir = mkdtempSync(join(tmpdir(), 'blitz-exit-'))
  cpSync(join(here, '../../../examples/palette'), dir, { recursive: true, filter: (f) => !/\.(html|pdf)$/.test(f) })
  deck = join(dir, 'deck.md')
  const md = readFileSync(deck, 'utf8')
    .replace(/```map\n/g, `\`\`\`map\ntiles: ${local}/tiles/{z}/{x}/{y}.svg\n`)
    .replace(/^src: https:\/\/.*$/m, `src: ${local}/`)
  expect(md).toContain(`tiles: ${local}`)
  expect(md).toContain(`src: ${local}/`)
  writeFileSync(deck, md)
})

test.afterAll(() => site?.close())

test('it becomes one file that runs from disk, every slide rendering', async ({ page }) => {
  const outFile = deck.replace(/\.md$/, '.html')
  const r = await build(deck, { standalone: true, outFile, quiet: true, report: false, overflowCheck: false })
  expect(r.ok).toBe(true)
  expect(r.diagnostics.filter((d) => d.severity !== 'info')).toEqual([])

  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(pathToFileURL(outFile).href)
  await page.waitForFunction(() => window.blitz)
  const count = await page.evaluate(() => window.blitz!.slideCount)
  expect(count).toBe(12)
  for (let i = 0; i < count; i++) {
    await page.evaluate((n) => window.blitz!.goto(n, 99), i)
    const blocks = page.locator('[data-blitz-current] [data-blitz-block]')
    for (let b = 0; b < (await blocks.count()); b++) await expect(blocks.nth(b).locator(':scope > *').first()).toBeVisible()
    await expect(page.locator('[data-blitz-current] .blitz-block-error')).toHaveCount(0)
  }
  expect(errors).toEqual([])
})

test('it exports to PDF, one page per slide, with nothing left unfinished', async () => {
  const r = await exportPdf(deck, { quiet: true })
  expect(r).toMatchObject({ ok: true, pages: 12, warnings: [] })
  const pdf = readFileSync(r.file!, 'latin1')
  expect((pdf.match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(12)
})
