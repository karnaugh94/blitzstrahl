/**
 * Brand (PLAN §15, M9): backgrounds by layout, from the theme and from the
 * deck, with the theme's own files copied or inlined.
 * (Theme fixtures are `.mjs`: under Playwright's loader, a `.js` outside a
 * `"type": "module"` package loads as CommonJS.)
 */
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { build, dev } from '../dist/index.js'
import { buildAndServe } from './serve.js'

test.use({ reducedMotion: 'reduce' })

/**
 * A solid image, over Vite's 4 kB inlining limit: `dev` would otherwise
 * inline it into the page from disk, and never serve it, as it does for small
 * files in the page's `<style>`. Real backgrounds are served.
 */
const SVG = (fill: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"><!-- ${'.'.repeat(5000)} --><rect width="16" height="9" fill="${fill}"/></svg>`

const TOKENS = {
  bg: '#fafafa', fg: '#111111', 'fg-muted': '#666666', accent: '#0055aa',
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((i) => [`chart-${i}`, `#${String(i).repeat(6)}`])),
}

/** A JS theme whose CSS gives two layouts their own art, by relative url(). */
const THEME = `export default {
  name: 'brand',
  tokens: ${JSON.stringify(TOKENS)},
  css: \`
[data-layout="title"] { background-image: url("./art/title.svg"); background-size: cover; }
[data-layout="section"] { background-image: url(./art/section.svg); background-size: cover; }
\`,
}
`

const DECK = `---
title: Brand
theme: ./brand/theme.mjs
background:
  two-col: ./img/content.svg
---

# Title

---
layout: section
---

# Part one

---
layout: two-col
---

# Two columns

---
layout: section
background: none
---

# Bare section

---

# Plain
`

function deckFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-brand-'))
  for (const sub of ['brand/art', 'img']) mkdirSync(join(dir, sub), { recursive: true })
  writeFileSync(join(dir, 'brand', 'theme.mjs'), THEME)
  writeFileSync(join(dir, 'brand', 'art', 'title.svg'), SVG('#ff0000'))
  writeFileSync(join(dir, 'brand', 'art', 'section.svg'), SVG('#00ff00'))
  writeFileSync(join(dir, 'img', 'content.svg'), SVG('#0000ff'))
  const deck = join(dir, 'talk.md')
  writeFileSync(deck, DECK)
  return deck
}

/**
 * Each slide's background, as drawn: the colour of the image its computed
 * `background-image` loads, or `none` and the background colour.
 */
async function backgrounds(page: Page): Promise<string[]> {
  await page.waitForFunction(() => window.blitz)
  return page.evaluate(async () => {
    const out: string[] = []
    for (const slide of document.querySelectorAll<HTMLElement>('.blitz-slide')) {
      const style = getComputedStyle(slide)
      const url = /^url\("(.*)"\)$/.exec(style.backgroundImage)?.[1]
      if (!url) {
        out.push(`none ${style.backgroundColor}`)
        continue
      }
      const img = new Image()
      img.src = url
      try {
        await img.decode()
      } catch {
        out.push(`broken ${url.slice(0, 40)}`)
        continue
      }
      const c = document.createElement('canvas')
      c.width = c.height = 4
      const g = c.getContext('2d')!
      g.drawImage(img, 0, 0, 4, 4)
      const [r, gr, b] = g.getImageData(1, 1, 1, 1).data
      out.push(`rgb(${r}, ${gr}, ${b})`)
    }
    return out
  })
}

const EXPECTED = [
  'rgb(255, 0, 0)', // title: the theme's art
  'rgb(0, 255, 0)', // section: the theme's art
  'rgb(0, 0, 255)', // two-col: the deck's, for that layout
  'none rgb(250, 250, 250)', // `background: none` clears the theme's, and keeps `bg`
  'none rgb(250, 250, 250)', // default: nothing set, the `bg` token
]

test("a static build copies the theme's backgrounds and applies the deck's by layout", async ({ page }) => {
  const { url, server, result } = await buildAndServe(deckFolder())
  try {
    expect(result.diagnostics).toEqual([])
    await page.goto(url)
    expect(await backgrounds(page)).toEqual(EXPECTED)
  } finally {
    server.close()
  }
})

test("a standalone file carries the theme's backgrounds", async ({ page }) => {
  const outFile = join(mkdtempSync(join(tmpdir(), 'blitz-brand-out-')), 'talk.html')
  const r = await build(deckFolder(), { standalone: true, outFile, quiet: true, overflowCheck: false })
  expect(r.ok).toBe(true)
  expect(readFileSync(outFile, 'utf8')).not.toContain('./art/')
  await page.goto(pathToFileURL(outFile).href)
  expect(await backgrounds(page)).toEqual(EXPECTED)
})

test("dev serves the theme's backgrounds, and only those files of its folder", async ({ page, request }) => {
  const deck = deckFolder()
  writeFileSync(join(deck, '..', 'brand', 'secret.txt'), 'SECRET')
  const server = await dev(deck, { port: 0 })
  try {
    const base = server.resolvedUrls!.local[0]!
    await page.goto(base)
    expect(await backgrounds(page)).toEqual(EXPECTED)
    const res = await request.get(`${base}@fs${join(deck, '..', 'brand', 'secret.txt')}`)
    expect(res.status()).toBeGreaterThanOrEqual(400)
  } finally {
    await server.close()
  }
})

test("a theme that names a missing file is an error at the deck's `theme` key", async () => {
  const deck = deckFolder()
  writeFileSync(join(deck, '..', 'brand', 'theme.mjs'), THEME.replace('./art/title.svg', './art/nope.svg'))
  const r = await build(deck, { outDir: mkdtempSync(join(tmpdir(), 'blitz-brand-out-')), quiet: true, overflowCheck: false })
  expect(r.ok).toBe(false)
  expect(r.diagnostics.map((d) => [d.code, d.span.start.line])).toEqual([['theme/invalid', 3]])
  expect(r.diagnostics[0]!.message).toContain('./art/nope.svg')
})

// Chrome: footer, slide numbers, logo (syntax.md §3.6).

const PDF = '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 3 3]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'

const CHROME = `---
title: Chrome
author: Ana Ruiz
date: September 2026
footer: Report Generator · [the report](./docs/report.pdf) · *draft*
slide-numbers: "{n} / {total}"
logo: ./img/logo.svg
---

# Title

---

# Content

Later {@1}

<style>
[data-layout="title"] .blitz-chrome [data-chrome="date"] { display: block; left: 88px; bottom: 100px; }
.blitz-chrome [data-chrome="number"] { color: rgb(255, 0, 0); }
</style>

---
layout: section
---

# Part two

---
layout: full-bleed
chrome: false
---

# A photo

---
layout: end
---

# Thanks
`

function chromeFolder(deck = CHROME): string {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-chrome-'))
  for (const sub of ['img', 'docs']) mkdirSync(join(dir, sub))
  writeFileSync(join(dir, 'img', 'logo.svg'), SVG('#0055aa'))
  writeFileSync(join(dir, 'docs', 'report.pdf'), PDF)
  const file = join(dir, 'talk.md')
  writeFileSync(file, deck)
  return file
}

/** Each slide's chrome as shown: `name: text` for each item that's displayed; a logo that drew is `logo`. */
async function chromeShown(page: Page): Promise<string[][]> {
  await page.waitForFunction(() => window.blitz)
  return page.evaluate(async () => {
    const out: string[][] = []
    for (const slide of document.querySelectorAll<HTMLElement>('.blitz-slide')) {
      // Laid out, as the audience would see it.
      slide.style.display = 'grid'
      const shown: string[] = []
      for (const el of slide.querySelectorAll<HTMLElement>('.blitz-chrome > [data-chrome]')) {
        if (getComputedStyle(el).display === 'none') continue
        if (el instanceof HTMLImageElement) {
          await el.decode().catch(() => {})
          shown.push(el.naturalWidth > 0 ? 'logo' : 'broken logo')
        } else shown.push(`${el.dataset.chrome}: ${el.textContent}`)
      }
      slide.style.display = ''
      out.push(shown)
    }
    return out
  })
}

const FOOTER = 'footer: Report Generator · the report · draft'
const CHROME_SHOWN = [
  [FOOTER, 'logo', 'date: September 2026'], // title: no number; the deck's <style> shows the date
  [FOOTER, 'number: 2 / 5', 'logo'],
  [FOOTER, 'logo'], // section: no number
  [], // chrome: false
  [FOOTER, 'logo'], // end: no number
]

test('a static build puts the footer, the number and the logo on each slide', async ({ page, request }) => {
  const { url, server, result } = await buildAndServe(chromeFolder())
  try {
    expect(result.diagnostics).toEqual([])
    await page.goto(url)
    expect(await chromeShown(page)).toEqual(CHROME_SHOWN)
    // The footer is markdown: its link was copied with the build.
    const href = await page.locator('[data-chrome="footer"] a').first().getAttribute('href')
    expect((await request.get(new URL(href!, url).href)).status()).toBe(200)
    await expect(page.locator('[data-chrome="footer"] em').first()).toHaveText('draft')
  } finally {
    server.close()
  }
})

test('a standalone file carries the logo and the footer link', async ({ page }) => {
  const outFile = join(mkdtempSync(join(tmpdir(), 'blitz-chrome-out-')), 'talk.html')
  const r = await build(chromeFolder(), { standalone: true, outFile, quiet: true, overflowCheck: false })
  expect(r.ok).toBe(true)
  await page.goto(pathToFileURL(outFile).href)
  expect(await chromeShown(page)).toEqual(CHROME_SHOWN)
  expect(await page.locator('[data-chrome="footer"] a').first().getAttribute('href')).toMatch(/^data:application\/pdf/)
})

test('chrome sits in the padding: footer bottom left, number bottom right, logo top right; themes restyle it', async ({ page }) => {
  const { url, server } = await buildAndServe(chromeFolder())
  try {
    await page.goto(`${url}#/content`)
    await page.waitForFunction(() => window.blitz)
    const boxes = await page.evaluate(() => {
      const slide = document.querySelector<HTMLElement>('[data-blitz-current]')!
      const s = slide.getBoundingClientRect()
      const k = s.width / 1280
      const out: Record<string, { left: number; right: number; top: number; bottom: number }> = {}
      for (const el of slide.querySelectorAll<HTMLElement>('.blitz-chrome > [data-chrome]')) {
        const b = el.getBoundingClientRect()
        if (b.width) out[el.dataset.chrome!] = { left: (b.left - s.left) / k, right: (b.right - s.left) / k, top: (b.top - s.top) / k, bottom: (b.bottom - s.top) / k }
      }
      return out
    })
    // aurora: pad-x 88, pad-y 64.
    expect(boxes.footer!.left).toBeCloseTo(88, 0)
    expect(boxes.footer!.top).toBeGreaterThan(720 - 64)
    expect(boxes.footer!.bottom).toBeLessThan(720)
    expect(boxes.number!.right).toBeCloseTo(1280 - 88, 0)
    expect(boxes.number!.top).toBeGreaterThan(720 - 64)
    expect(boxes.logo!.right).toBeCloseTo(1280 - 88, 0)
    expect(boxes.logo!.bottom).toBeLessThan(64)
    expect(boxes.logo!.top).toBeGreaterThan(0)
    await expect(page.locator('[data-blitz-current] [data-chrome="number"]')).toHaveCSS('color', 'rgb(255, 0, 0)')
  } finally {
    server.close()
  }
})

test("chrome isn't measured for overflow: a footer too long for its line is cut, not reported", async () => {
  const deck = chromeFolder(CHROME.replace(/^footer: .*$/m, `footer: ${'A footer that runs on and on '.repeat(8)}`))
  const r = await build(deck, { outDir: mkdtempSync(join(tmpdir(), 'blitz-chrome-out-')), quiet: true, strict: true, report: false })
  expect(r.overflow).toEqual([])
  expect(r.ok).toBe(true)
})

for (const engine of ['view', 'waapi'] as const) {
  test(`auto-animate leaves chrome alone (${engine} engine)`, async ({ page }) => {
    if (engine === 'waapi') {
      await page.addInitScript(() => {
        delete (Document.prototype as { startViewTransition?: unknown }).startViewTransition
      })
    }
    // The logo (an image, which auto-animate pairs by source) sits elsewhere
    // on the second slide: paired, it would move there.
    const deck = chromeFolder(`---
footer: Same footer
logo: ./img/logo.svg
---

# One {transition=auto-animate}

- Stays

---
layout: two-col
transition: auto-animate
---

# One

- Stays

<style>[data-layout="two-col"] .blitz-chrome [data-chrome="logo"] { top: 300px; }</style>
`)
    const { url, server } = await buildAndServe(deck)
    try {
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.goto(url)
      await page.waitForFunction(() => window.blitz)
      await page.keyboard.press('ArrowRight')
      // What moves: new-slide elements with a FLIP animation, and View Transition captures.
      const moving = await page.waitForFunction(() => {
        const out: string[] = []
        for (const a of document.getAnimations()) {
          const effect = a.effect as KeyframeEffect
          const target = effect.target as HTMLElement | null
          if (!target || effect.pseudoElement) continue
          if (target.closest('[data-blitz-current]') && effect.getKeyframes().some((k) => String(k.transform ?? 'none') !== 'none')) {
            out.push(target.closest('.blitz-chrome') ? 'chrome' : (target.textContent ?? '').trim())
          }
        }
        return out.length ? out.sort() : undefined
      })
      expect(await moving.jsonValue()).toEqual(['One', 'Stays'])
    } finally {
      server.close()
    }
  })
}

test('chrome prints, and a slide keeps its number on every step', async ({ page }) => {
  const { url, server } = await buildAndServe(chromeFolder())
  try {
    await page.goto(url)
    await page.waitForFunction(() => window.blitz)
    expect(await page.evaluate(() => window.blitz!.print({ steps: true }))).toEqual({ pages: 6, warnings: [] })
    await page.emulateMedia({ media: 'print' })
    const numbers = page.locator('.blitz-print > .blitz-slide [data-chrome="number"]')
    await expect(numbers.nth(1)).toBeVisible()
    expect(await page.locator('.blitz-print > .blitz-slide').evaluateAll((pages) =>
      pages.map((p) => p.querySelector('[data-chrome="number"]')?.textContent ?? ''))).toEqual(['1 / 5', '2 / 5', '2 / 5', '3 / 5', '', '5 / 5'])
    await expect(page.locator('.blitz-print > .blitz-slide [data-chrome="footer"]').first()).toBeVisible()
  } finally {
    server.close()
  }
})

// CSS themes and `css:` (docs/themes.md, *A theme in CSS*).

const INTER = join(fileURLToPath(new URL('../../themes/fonts/inter-latin-wght-normal.woff2', import.meta.url)))

const BRAND_CSS = `@import "./parts/layouts.css";

@font-face {
  font-family: "Brand Sans";
  src: url("./fonts/brand.woff2") format("woff2");
  font-weight: 100 900;
}

:root {
  --blitz-bg: #fdfdf8;
  --blitz-fg: #222222;
  --blitz-fg-muted: #555555;
  --blitz-accent: #3c7d22;
${[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `  --blitz-chart-${i}: #${String(i).repeat(6)};`).join('\n')}
  --blitz-font-sans: "Brand Sans", sans-serif;
}

.blitz-slide h1 { font-weight: 800; }
`

const LAYOUTS_CSS = `[data-layout="section"] { background-image: url("../art/section.svg"); background-size: cover; }\n`

function cssDeck(md: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-css-theme-'))
  for (const sub of ['brand/parts', 'brand/art', 'brand/fonts']) mkdirSync(join(dir, sub), { recursive: true })
  writeFileSync(join(dir, 'brand', 'brand.css'), BRAND_CSS)
  writeFileSync(join(dir, 'brand', 'parts', 'layouts.css'), LAYOUTS_CSS)
  writeFileSync(join(dir, 'brand', 'art', 'section.svg'), SVG('#00ff00'))
  writeFileSync(join(dir, 'brand', 'fonts', 'brand.woff2'), readFileSync(INTER))
  writeFileSync(join(dir, 'talk.css'), ':root { --blitz-accent: #aa0000; }\n.blitz-slide .note { color: var(--blitz-accent); }\n')
  const file = join(dir, 'talk.md')
  writeFileSync(file, md)
  return file
}

const CSS_DECK = `---
title: CSS theme
theme: ./brand/brand.css
css: ./talk.css
---

# Title

A note {.note}

---
layout: section
---

# Part one
`

/** What the CSS theme and `css:` did to the page. */
async function styled(page: Page) {
  await page.waitForFunction(() => window.blitz)
  return page.evaluate(async () => {
    await document.fonts.ready
    const slides = document.querySelectorAll<HTMLElement>('.blitz-slide')
    const root = getComputedStyle(document.documentElement)
    return {
      bg: getComputedStyle(slides[0]!).backgroundColor,
      chart1: root.getPropertyValue('--blitz-chart-1').trim(),
      // `css:` comes after the theme, so its token wins.
      note: getComputedStyle(slides[0]!.querySelector('.note')!).color,
      font: document.fonts.check('800 30px "Brand Sans"') && [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Brand Sans' && f.status === 'loaded'),
      section: /^url\(/.test(getComputedStyle(slides[1]!).backgroundImage),
    }
  })
}

const STYLED = { bg: 'rgb(253, 253, 248)', chart1: '#111111', note: 'rgb(170, 0, 0)', font: true, section: true }

test('a CSS theme and `css:` style a static build: tokens, fonts, imports, backgrounds', async ({ page }) => {
  const { url, server, result } = await buildAndServe(cssDeck(CSS_DECK))
  try {
    expect(result.diagnostics.filter((d) => d.severity !== 'info')).toEqual([])
    await page.goto(url)
    expect(await styled(page)).toEqual(STYLED)
  } finally {
    server.close()
  }
})

test('a standalone file carries a CSS theme, its font and its images', async ({ page }) => {
  const outFile = join(mkdtempSync(join(tmpdir(), 'blitz-css-out-')), 'talk.html')
  const r = await build(cssDeck(CSS_DECK), { standalone: true, outFile, quiet: true, overflowCheck: false })
  expect(r.ok).toBe(true)
  const html = readFileSync(outFile, 'utf8')
  expect(html).not.toMatch(/url\("\/|brand\.woff2|section\.svg/)
  await page.goto(pathToFileURL(outFile).href)
  expect(await styled(page)).toEqual(STYLED)
})

test('a package whose entry is a CSS file is a CSS theme', async ({ page }) => {
  const deck = cssDeck(CSS_DECK.replace('theme: ./brand/brand.css', 'theme: acme'))
  const pkg = join(deck, '..', 'node_modules', 'blitzstrahl-theme-acme')
  mkdirSync(join(pkg, 'parts'), { recursive: true })
  for (const f of ['brand.css', 'parts/layouts.css']) writeFileSync(join(pkg, f), readFileSync(join(deck, '..', 'brand', f)))
  cpSync(join(deck, '..', 'brand', 'art'), join(pkg, 'art'), { recursive: true })
  cpSync(join(deck, '..', 'brand', 'fonts'), join(pkg, 'fonts'), { recursive: true })
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'blitzstrahl-theme-acme', version: '1.0.0', main: 'brand.css' }))
  const { url, server } = await buildAndServe(deck)
  try {
    await page.goto(url)
    expect(await styled(page)).toEqual(STYLED)
  } finally {
    server.close()
  }
})

test("a CSS theme's problems are reported where they are, and a broken one isn't used", async () => {
  const deck = cssDeck(CSS_DECK)
  writeFileSync(join(deck, '..', 'brand', 'brand.css'), BRAND_CSS.replace('  --blitz-accent: #3c7d22;\n', '').replace('.blitz-slide h1', 'h1'))
  writeFileSync(join(deck, '..', 'brand', 'parts', 'layouts.css'), LAYOUTS_CSS.replace('section.svg', 'nope.svg'))
  const r = await build(deck, { outDir: mkdtempSync(join(tmpdir(), 'blitz-css-out-')), quiet: true, overflowCheck: false })
  expect(r.ok).toBe(false)
  // Stylesheets are named as the deck is, from the working folder.
  const name = (file: string) => file.replace(/^.*blitz-css-theme-[^/]+\//, '')
  expect(r.diagnostics.filter((d) => d.severity !== 'info').map((d) => [d.severity, d.code, name(d.file), d.span.start.line])).toEqual([
    ['error', 'css/missing', 'brand/parts/layouts.css', 1],
    ['error', 'theme/invalid', 'talk.md', 3],
    ['warning', 'css/unscoped', 'brand/brand.css', 24],
  ])
})

test('dev restyles the page when a CSS theme or its import changes, without reloading it', async ({ page }) => {
  const deck = cssDeck(CSS_DECK)
  const server = await dev(deck, { port: 0 })
  try {
    await page.goto(server.resolvedUrls!.local[0]!)
    expect(await styled(page)).toEqual(STYLED)
    await page.evaluate(() => ((window as { kept?: boolean }).kept = true))
    writeFileSync(join(deck, '..', 'brand', 'brand.css'), BRAND_CSS.replace('--blitz-bg: #fdfdf8', '--blitz-bg: #102030'))
    await expect(page.locator('.blitz-slide').first()).toHaveCSS('background-color', 'rgb(16, 32, 48)')
    writeFileSync(join(deck, '..', 'talk.css'), ':root { --blitz-accent: #0000aa; }\n.blitz-slide .note { color: var(--blitz-accent); }\n')
    await expect(page.locator('.note')).toHaveCSS('color', 'rgb(0, 0, 170)')
    expect(await page.evaluate(() => (window as { kept?: boolean }).kept)).toBe(true)
  } finally {
    await server.close()
  }
})

test("dev lists a stylesheet's problems on the page, and opens the stylesheet there", async ({ page }) => {
  const deck = cssDeck(CSS_DECK)
  const dir = join(deck, '..')
  const editorLog = join(dir, 'opened.txt')
  writeFileSync(join(dir, 'editor.sh'), `#!/bin/sh\necho "$@" > '${editorLog}'\n`)
  chmodSync(join(dir, 'editor.sh'), 0o755)
  process.env.LAUNCH_EDITOR = join(dir, 'editor.sh')
  const server = await dev(deck, { port: 0 })
  try {
    await page.goto(server.resolvedUrls!.local[0]!)
    await page.waitForFunction(() => window.blitz)
    writeFileSync(join(dir, 'brand', 'brand.css'), BRAND_CSS.replace('.blitz-slide h1', 'h1'))
    const item = page.locator('.blitz-dev-list li', { hasText: 'overview' })
    await page.locator('.blitz-dev-toggle').click()
    await expect(item.locator('.blitz-dev-at')).toHaveText(/brand\/brand\.css:25:1$/)
    await item.locator('.blitz-dev-at').click()
    await expect.poll(() => (existsSync(editorLog) ? readFileSync(editorLog, 'utf8').trim() : '')).toBe(`${join(dir, 'brand', 'brand.css')} 25 1`)
  } finally {
    delete process.env.LAUNCH_EDITOR
    await server.close()
  }
})
