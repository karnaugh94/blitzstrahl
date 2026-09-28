/**
 * Brand (PLAN §15, M9): backgrounds by layout, from the theme and from the
 * deck, with the theme's own files copied or inlined.
 * (Theme fixtures are `.mjs`: under Playwright's loader, a `.js` outside a
 * `"type": "module"` package loads as CommonJS.)
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
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
