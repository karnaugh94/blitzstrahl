/**
 * `export --pptx`: the deck as a PowerPoint presentation, each slide a
 * picture of the printed page, the presenter notes its speaker notes.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { unzipSync } from 'fflate'
import { exportPdf } from '../dist/index.js'
import { pptxToMarkdown } from '../dist/pptx.js'

/** A PNG's width and height, from its header. */
function pngSize(png: Uint8Array): [number, number] {
  const view = new DataView(png.buffer, png.byteOffset)
  return [view.getUint32(16), view.getUint32(20)]
}

test('a slide per slide, pictured at twice the canvas, with its notes and the deck\'s title', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-pptx-out-'))
  const deck = join(dir, 'deck.md')
  writeFileSync(
    deck,
    '---\ntitle: Quarterly review\nauthor: Ada Lovelace\ntransition: none\n---\n\n# Opening\n\n::: notes\nWelcome **everyone**.\n:::\n\n---\n\n# Results\n\nRose {@1}\n\nFell {@2}\n\n::: notes\n- East first\n- then West\n:::\n\n---\nbackground: "#c0392b"\n---\n\n# Red\n',
  )
  const r = await exportPdf(deck, { pptx: true, quiet: true })
  expect(r.ok).toBe(true)
  expect(r.file).toBe(join(dir, 'deck.pptx'))
  expect(r.pages).toBe(3)

  const bytes = readFileSync(r.file!)
  const files = unzipSync(bytes)
  const images = Object.keys(files).filter((f) => f.startsWith('ppt/media/')).sort()
  expect(images).toEqual(['ppt/media/image1.png', 'ppt/media/image2.png', 'ppt/media/image3.png'])
  expect(pngSize(files['ppt/media/image1.png']!)).toEqual([2560, 1440])
  const back = pptxToMarkdown(bytes, 'deck.pptx')
  expect(back.source).toContain('title: "Quarterly review"')
  expect(back.source).toContain('author: "Ada Lovelace"')
  expect(back.source).toContain('::: notes\nWelcome everyone.\n:::')
  expect(back.source).toContain('::: notes\nEast first\n\nthen West\n:::')
  // A picture each, named by its slide's title.
  expect(back.source).toMatch(/role="img" aria-label="Opening"/)
  expect(back.source).toMatch(/role="img" aria-label="Results"/)

  // --steps: a slide for every step, each with its slide's notes.
  const steps = await exportPdf(deck, { outFile: join(dir, 'steps.pptx'), steps: true, quiet: true })
  expect(steps.pages).toBe(1 + 3 + 1)
  const stepped = pptxToMarkdown(readFileSync(steps.file!), 'steps.pptx').source
  expect(stepped.match(/East first/g)).toHaveLength(3)
  // The steps differ: each picture is its own.
  const shots = unzipSync(readFileSync(steps.file!))
  const results = [2, 3, 4].map((n) => Buffer.from(shots[`ppt/media/image${n}.png`]!).toString('base64'))
  expect(new Set(results).size).toBe(3)
})
