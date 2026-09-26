/**
 * Every local file a deck refers to (Markdown images and links, raw HTML,
 * CSS url()s, backgrounds) ships with each build and works there, and
 * `dev` serves those files and nothing else in the deck's folder
 * (PLAN §15, M6.2 and M6.3).
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { build, dev } from '../dist/index.js'
import { buildAndServe } from './serve.js'

const SVG = (fill: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="${fill}"/></svg>`
const PDF = '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 3 3]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'

/** A tenth of a second of 8-bit mono silence, as a WAV. */
function wav(): Buffer {
  const samples = 800
  const b = Buffer.alloc(44 + samples, 128)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + samples, 4)
  b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(8000, 24)
  b.writeUInt32LE(8000, 28)
  b.writeUInt16LE(1, 32)
  b.writeUInt16LE(8, 34)
  b.write('data', 36)
  b.writeUInt32LE(samples, 40)
  return b
}

const DECK = `---
title: Files
---
background: ./img/bg.svg
---

# Raw HTML

<img id="raw" src="./img/raw.svg" alt="raw">

<audio id="tone" src="./media/tone.wav" controls></audio>

<style>
.blitz-slide .brand { width: 40px; height: 30px; background: url("./img/brand.svg"); }
</style>

::: brand
:::

---
background: ./img/bg.svg
---

# Links

[The report](./docs/report.pdf){#report} and [the data](./sales.csv){#data}

---
background: ./img/bg.svg
---

# Same background, third time
`

function deckFolder(): { dir: string; deck: string } {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-assets-'))
  for (const sub of ['img', 'media', 'docs', 'private']) mkdirSync(join(dir, sub))
  writeFileSync(join(dir, 'img', 'bg.svg'), SVG('#123456'))
  writeFileSync(join(dir, 'img', 'raw.svg'), SVG('#cc0000'))
  writeFileSync(join(dir, 'img', 'brand.svg'), SVG('#00aa00'))
  writeFileSync(join(dir, 'media', 'tone.wav'), wav())
  writeFileSync(join(dir, 'docs', 'report.pdf'), PDF)
  writeFileSync(join(dir, 'sales.csv'), 'q,v\nQ1,1\n')
  writeFileSync(join(dir, 'private', 'salaries.csv'), 'SECRET\n')
  const deck = join(dir, 'talk.md')
  writeFileSync(deck, DECK)
  return { dir, deck }
}

/**
 * The raw image drew, and the <style> url() and every background point at a
 * file the build shipped: served (`http`), or inside the file (`standalone`).
 */
async function expectPageFiles(page: Page, mode: 'http' | 'standalone') {
  await page.waitForFunction(() => window.blitz)
  await page.waitForFunction(() => (document.getElementById('raw') as HTMLImageElement | null)?.naturalWidth === 40)
  const urls = await page.evaluate(() => {
    const url = (css: string) => /^url\("(.*)"\)$/.exec(css)?.[1] ?? css
    return [
      url(getComputedStyle(document.querySelector('.brand')!).backgroundImage),
      ...[...document.querySelectorAll<HTMLElement>('.blitz-slide')].map((s) => url(getComputedStyle(s).backgroundImage)),
    ]
  })
  for (const u of urls) {
    if (mode === 'standalone') expect(u).toMatch(/^data:image\/svg\+xml;base64,/)
    else expect(await page.evaluate(async (href) => (await fetch(href)).status, u), u).toBe(200)
  }
}

test('a static build ships every file the deck refers to', async ({ page }) => {
  const { deck } = deckFolder()
  const { url, server } = await buildAndServe(deck)
  try {
    await page.goto(url)
    await expectPageFiles(page, 'http')
    const fetched = await page.evaluate(async () => {
      const get = async (href: string) => {
        const r = await fetch(href)
        return { href: new URL(href, location.href).pathname, status: r.status, type: r.headers.get('content-type') }
      }
      return {
        report: await get(document.querySelector<HTMLAnchorElement>('#report')!.href),
        data: await get(document.querySelector<HTMLAnchorElement>('#data')!.href),
        tone: await get(document.querySelector<HTMLAudioElement>('#tone')!.src),
      }
    })
    // Linked files keep their own names (what a download is saved as), in a content-hashed folder.
    expect(fetched.report.href).toMatch(/\/assets\/[0-9a-f]{8}\/report\.pdf$/)
    expect(fetched.report.status).toBe(200)
    expect(fetched.data.href).toMatch(/\/assets\/[0-9a-f]{8}\/sales\.csv$/)
    expect(fetched.data.status).toBe(200)
    expect(fetched.tone.status).toBe(200)
  } finally {
    server.close()
  }
})

test('a standalone file carries every file, each image once, and its links download', async ({ page }) => {
  const { dir, deck } = deckFolder()
  const out = join(dir, 'talk.html')
  const r = await build(deck, { standalone: true, outFile: out, quiet: true, overflowCheck: false })
  expect(r.ok).toBe(true)
  const html = readFileSync(out, 'utf8')
  // The background three slides share is in the file once.
  const bg = `data:image/svg+xml;base64,${Buffer.from(SVG('#123456')).toString('base64')}`
  expect(html.split(bg).length - 1).toBe(1)
  // The payload carries no copy of the page's images.
  const payload = /<script type="application\/json" id="blitz-payload">(.*?)<\/script>/s.exec(html)![1]!
  expect(payload).not.toContain('data:image')

  await page.goto(pathToFileURL(out).href)
  await expectPageFiles(page, 'standalone')
  const link = await page.evaluate(() => {
    const a = document.querySelector<HTMLAnchorElement>('#report')!
    return { href: a.getAttribute('href')!.slice(0, 28), download: a.getAttribute('download') }
  })
  expect(link).toEqual({ href: 'data:application/pdf;base64,', download: 'report.pdf' })
  expect(await page.evaluate(() => document.querySelector<HTMLAudioElement>('#tone')!.getAttribute('src')!.slice(0, 15))).toBe('data:audio/wav;')
})

test('dev serves the files the deck uses, and nothing else in its folder', async ({ page, request }) => {
  const { dir, deck } = deckFolder()
  const server = await dev(deck, { port: 0 })
  try {
    const base = server.resolvedUrls!.local[0]!
    for (const path of ['private/salaries.csv', 'talk.md', 'img/raw.svg', `@fs${dir}/private/salaries.csv`]) {
      const res = await request.get(base + path)
      expect(res.status(), path).toBeGreaterThanOrEqual(400)
      expect(await res.text(), path).not.toContain('SECRET')
    }
    await page.goto(base)
    await expectPageFiles(page, 'http')
    const raw = await page.evaluate(() => document.getElementById('raw')!.getAttribute('src'))
    expect(raw).toMatch(/^\/_blitz\/asset\//)
    expect((await request.get(base + raw!.slice(1))).status()).toBe(200)
  } finally {
    await server.close()
  }
})
