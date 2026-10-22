/**
 * `export --pptx`: the deck as an editable PowerPoint presentation. Text is
 * text, tables are tables, charts are charts; the theme's backdrop is the
 * slide's background picture; the presenter notes are its speaker notes.
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

const text = (files: Record<string, Uint8Array>, name: string) => new TextDecoder().decode(files[name])

test('a slide per slide: editable text, a native table and chart, its notes and the deck\'s title', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-pptx-out-'))
  const deck = join(dir, 'deck.md')
  writeFileSync(
    deck,
    [
      '---\ntitle: Quarterly review\nauthor: Ada Lovelace\ntransition: none\n---\n\n# Opening\n\nWelcome to **the** review.\n\n::: notes\nWelcome **everyone**.\n:::',
      '# Results\n\n- Rose {@1}\n- Fell {@2}\n\n::: notes\n- East first\n- then West\n:::',
      '# Regions\n\n| Region | Sales |\n|---|---:|\n| East | 12 |\n| West | 9 |',
      '# Trend\n\n```chart\ntype: bar\ndata:\n  - { q: Q1, sales: 3 }\n  - { q: Q2, sales: 5 }\nx: q\ny: sales\n```',
    ].join('\n\n---\n\n'),
  )
  const r = await exportPdf(deck, { pptx: true, quiet: true })
  expect(r.ok).toBe(true)
  expect(r.file).toBe(join(dir, 'deck.pptx'))
  expect(r.pages).toBe(4)

  const bytes = readFileSync(r.file!)
  const files = unzipSync(bytes)
  // The backgrounds, at twice the canvas.
  expect(pngSize(files['ppt/media/image1.png']!)).toEqual([2560, 1440])
  const one = text(files, 'ppt/slides/slide1.xml')
  expect(one).toContain('<p:ph type="title"/>')
  expect(one).toContain('<a:t>Opening</a:t>')
  expect(one).toMatch(/b="1"[^>]*>.*?<a:t>the<\/a:t>/)
  const two = text(files, 'ppt/slides/slide2.xml')
  expect(two).toContain('<a:t>Rose</a:t>')
  expect(two).toContain('<a:t>Fell</a:t>')
  const three = text(files, 'ppt/slides/slide3.xml')
  expect(three).toContain('<a:tbl>')
  expect(three).toContain('<a:t>West</a:t>')
  expect(text(files, 'ppt/slides/slide4.xml')).toContain('<c:chart ')
  expect(text(files, 'ppt/charts/chart1.xml')).toContain('<c:v>Q2</c:v>')
  expect(files['ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx']).toBeDefined()

  const back = pptxToMarkdown(bytes, 'deck.pptx')
  expect(back.source).toContain('title: "Quarterly review"')
  expect(back.source).toContain('author: "Ada Lovelace"')
  expect(back.source).toContain('::: notes\nWelcome everyone.\n:::')
  expect(back.source).toContain('::: notes\nEast first\n\nthen West\n:::')

  // --steps: a slide for every step, each with its slide's notes; a step not yet shown isn't there.
  const steps = await exportPdf(deck, { outFile: join(dir, 'steps.pptx'), steps: true, quiet: true })
  expect(steps.pages).toBe(1 + 3 + 1 + 1)
  const stepped = unzipSync(readFileSync(steps.file!))
  expect(pptxToMarkdown(readFileSync(steps.file!), 'steps.pptx').source.match(/East first/g)).toHaveLength(3)
  expect(text(stepped, 'ppt/slides/slide2.xml')).not.toContain('<a:t>Rose</a:t>')
  expect(text(stepped, 'ppt/slides/slide3.xml')).toContain('<a:t>Rose</a:t>')
  expect(text(stepped, 'ppt/slides/slide3.xml')).not.toContain('<a:t>Fell</a:t>')
  expect(text(stepped, 'ppt/slides/slide4.xml')).toContain('<a:t>Fell</a:t>')
})

test('a Mermaid flowchart is shapes and connectors; other diagrams stay pictures', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-pptx-flow-'))
  const deck = join(dir, 'deck.md')
  writeFileSync(
    deck,
    [
      '---\ntitle: Flows\ntransition: none\n---\n\n# Flow\n\n```mermaid\nflowchart LR\n  A[One] --> B{Two}\n  B -->|yes| C([Three])\n  B -.-> D[(Four)]\n```',
      '# Sequence\n\n```mermaid\nsequenceDiagram\n  Ann->>Bo: Hello\n```',
    ].join('\n\n---\n\n'),
  )
  const r = await exportPdf(deck, { pptx: true, quiet: true })
  expect(r.ok).toBe(true)
  const files = unzipSync(readFileSync(r.file!))
  const flow = text(files, 'ppt/slides/slide1.xml')
  expect(flow).toContain('<p:grpSp>')
  expect(flow).toContain('<a:prstGeom prst="flowChartDecision">')
  expect(flow).toContain('<a:prstGeom prst="flowChartTerminator">')
  expect(flow).toContain('<a:prstGeom prst="can">')
  for (const label of ['One', 'Two', 'Three', 'Four', 'yes']) expect(flow).toContain(`<a:t>${label}</a:t>`)
  // Three edges, each glued at both ends.
  expect(flow.match(/<p:cxnSp>/g)).toHaveLength(3)
  expect(flow.match(/<a:stCxn id="\d+" idx="\d+"\/><a:endCxn id="\d+" idx="\d+"\/>/g)).toHaveLength(3)
  expect(flow).toContain('<a:prstDash val="sysDot"/>')
  expect(flow).toContain('<a:tailEnd type="triangle"')
  // Only the background is a picture on that slide; the sequence diagram is one.
  expect(text(files, 'ppt/slides/_rels/slide1.xml.rels').match(/relationships\/image"/g)).toHaveLength(1)
  expect(text(files, 'ppt/slides/_rels/slide2.xml.rels').match(/relationships\/image"/g)).toHaveLength(2)
})
