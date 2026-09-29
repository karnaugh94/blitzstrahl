/**
 * `alt=` on render blocks (syntax.md §8.2, M11.5): charts, maps, diagrams
 * and formulas are one picture to a screen reader, named by `alt`; a chart
 * or map is also described from its data, in the deck's language; an
 * embed's frame is named instead.
 */
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { exportPdf } from '../dist/index.js'
import { buildAndServe } from './serve.js'

const here = dirname(fileURLToPath(import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'blitz-alt-'))
copyFileSync(join(here, 'fixtures/data.csv'), join(dir, 'data.csv'))

const deck = (lang: string) => `---
title: Alt fixture
lang: ${lang}
transition: none
---

# Described

\`\`\`chart {#described alt="Sales rose."}
type: bar
data: ./data.csv
x: k
y: v
\`\`\`

---

# Plain

\`\`\`chart {#plain}
type: bar
data: ./data.csv
x: k
y: v
\`\`\`

---

# Places

\`\`\`map {#places alt="Two offices."}
markers:
  - { name: Lisbon, lat: 38.72, lng: -9.14 }
  - { name: Porto, lat: 41.15, lng: -8.61 }
\`\`\`

---

# Flow

\`\`\`mermaid {#flow alt="Markdown becomes a deck."}
flowchart LR
  A --> B
\`\`\`

---

# Frame

\`\`\`embed {#frame alt="The project's home page"}
src: http://127.0.0.1:9/
\`\`\`

---

# Formula

\`\`\`math {#formula alt="E equals m c squared"}
E = mc^2
\`\`\`
`

writeFileSync(join(dir, 'en.md'), deck('en'))
writeFileSync(join(dir, 'de.md'), deck('de'))

let en = ''
let de = ''
const servers: Server[] = []
test.beforeAll(async () => {
  for (const [name, set] of [['en', (u: string) => (en = u)], ['de', (u: string) => (de = u)]] as const) {
    const { url, server } = await buildAndServe(join(dir, `${name}.md`))
    servers.push(server)
    set(url)
  }
})
test.afterAll(() => servers.forEach((s) => s.close()))
test.use({ reducedMotion: 'reduce' })

async function at(page: Page, url: string, slide: string) {
  await page.goto(`${url}#/${slide}`)
  await page.waitForFunction(() => window.blitz)
}

const name = (page: Page, id: string) => page.locator(`#${id}`).getAttribute('aria-label')

test('a chart is one image, named by alt, then described from its data', async ({ page }) => {
  await at(page, en, 'described')
  const chart = page.getByRole('img', { name: /^Sales rose\. Bar chart\./ })
  await expect(chart).toHaveCount(1)
  // Its values, as ECharts reads them out.
  await expect.poll(() => name(page, 'described')).toMatch(/a 1; b 2\.$/)
})

test('without alt, the description is the name', async ({ page }) => {
  await at(page, en, 'plain')
  await expect(page.locator('#plain')).toHaveAttribute('role', 'img')
  await expect.poll(() => name(page, 'plain')).toMatch(/^Bar chart\./)
})

test('the description is in the deck\'s language', async ({ page }) => {
  await at(page, de, 'described')
  await expect.poll(() => name(page, 'described')).toMatch(/^Sales rose\. Balkendiagramm\./)
  await at(page, de, 'places')
  await expect.poll(() => name(page, 'places')).toBe('Two offices. Karte. 2 Orte: Lisbon, Porto.')
})

test('a map names its places; leaving and coming back doesn\'t repeat anything', async ({ page }) => {
  await at(page, en, 'places')
  await expect(page.getByRole('img', { name: 'Two offices. Map. 2 places: Lisbon, Porto.' })).toHaveCount(1)
  await page.keyboard.press('ArrowRight')
  // Left: the block is as the page had it.
  await expect(page.locator('#places')).toHaveAttribute('aria-label', 'Two offices.')
  await page.keyboard.press('ArrowLeft')
  await expect.poll(() => name(page, 'places')).toBe('Two offices. Map. 2 places: Lisbon, Porto.')
})

test('a diagram and a formula are named by alt; an embed\'s frame is', async ({ page }) => {
  await at(page, en, 'flow')
  await expect(page.getByRole('img', { name: 'Markdown becomes a deck.' })).toHaveCount(1)
  await at(page, en, 'frame')
  await expect(page.locator('#frame iframe')).toHaveAttribute('title', 'The project\'s home page')
  // The frame's page stays reachable: the block itself isn't an image.
  await expect(page.locator('#frame')).not.toHaveAttribute('role', 'img')
  await at(page, en, 'formula')
  await expect(page.getByRole('img', { name: 'E equals m c squared' })).toHaveCount(1)
})

test('document mode names them too', async ({ page }) => {
  await page.goto(`${en}?mode=doc`)
  await page.waitForFunction(() => (window as unknown as { blitzDocument?: unknown }).blitzDocument)
  await page.evaluate(() => (window as unknown as { blitzDocument: { print(): Promise<unknown> } }).blitzDocument.print())
  await expect.poll(() => name(page, 'described')).toMatch(/^Sales rose\. Bar chart\./)
  await expect(page.getByRole('img', { name: 'Markdown becomes a deck.' })).toHaveCount(1)
})

test('the exported PDF carries alt as the figure\'s alternate text', async () => {
  const r = await exportPdf(join(dir, 'en.md'), { outFile: join(dir, 'en.pdf'), quiet: true })
  expect(r.ok).toBe(true)
  const pdf = readFileSync(r.file!, 'latin1')
  expect(pdf).toMatch(/\/Alt\s*\(Markdown becomes a deck\.\)/)
  expect(pdf).toMatch(/\/Alt\s*\(E equals m c squared\)/)
})
