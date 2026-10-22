import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parseDeck } from '@blitzstrahl/core'
import { pptxToMarkdown } from '../src/pptx.js'
import type { Cell, ChartData, Colour, Item, Paragraph, PictureItem, Run, ShapeItem, TableItem, TextItem } from '../src/pptx-read.js'
import { type NoteParagraph, type PptxPage, noteParagraphs, writePptx } from '../src/write-pptx.js'

/** A 1×1 PNG. */
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))
const META = { title: 'T', lang: 'en', plugins: [], extra: {} } as never
const RED: Colour = { hex: 'c0392b', alpha: 1 }
const BLACK: Colour = { hex: '000000', alpha: 1 }

const run = (t: string): Run => ({ text: t, font: 'Inter', size: 24, colour: BLACK })
const para = (t: string): Paragraph => ({ runs: t ? [run(t)] : [], align: 'l', before: 0, left: 0, indent: 0, level: 0 })
const text = (t: string): TextItem => ({ kind: 'text', rect: { x: 100, y: 200, w: 400, h: 40 }, paragraphs: [para(t)], insets: { l: 0, t: 0, r: 0, b: 0 }, anchor: 't', name: 'Text' })
const title = (t: string): TextItem => ({ ...text(t), rect: { x: 100, y: 50, w: 800, h: 60 }, title: true, name: 'Title' })
const page = (items: Item[], notes: NoteParagraph[] = [], name = ''): PptxPage => ({
  read: { items, theme: { heading: 'Inter', body: 'Inter', text: BLACK, background: { hex: 'ffffff', alpha: 1 }, accents: [RED] } },
  background: PNG,
  pictures: new Map(),
  name,
  notes,
})
const xml = (files: Record<string, Uint8Array>, name: string) => new TextDecoder().decode(files[name])

const NOTES = `# One

::: notes
Say **this** first, then *that*, with \`code\` & more.

- a point
  - under it
- another

1. first
2. second
:::

---

# Two
`

describe('a deck as a PowerPoint presentation (export --pptx)', () => {
  it('turns presenter notes into paragraphs: lists, levels, bold, italic and code', () => {
    const notes = parseDeck(NOTES, { file: 'talk.md' }).deck.slides[0]!.notes
    expect(noteParagraphs(notes)).toEqual([
      { runs: [{ text: 'Say ' }, { text: 'this', bold: true }, { text: ' first, then ' }, { text: 'that', italic: true }, { text: ', with ' }, { text: 'code', code: true }, { text: ' & more.' }] },
      { runs: [{ text: 'a point' }], list: { level: 0, ordered: false } },
      { runs: [{ text: 'under it' }], list: { level: 1, ordered: false } },
      { runs: [{ text: 'another' }], list: { level: 0, ordered: false } },
      { runs: [{ text: 'first' }], list: { level: 0, ordered: true } },
      { runs: [{ text: 'second' }], list: { level: 0, ordered: true } },
    ])
  })

  it('writes a package that reads back: editable text, the title as the title, the notes, title and author', () => {
    const { deck } = parseDeck(`---\ntitle: Q3 & more\nauthor: Ana\n---\n\n${NOTES}`, { file: 'talk.md' })
    const pages = deck.slides.map((s) => page([title(s.title ?? ''), text('Body text')], noteParagraphs(s.notes), s.title ?? ''))
    const bytes = writePptx(pages, { width: 1280, height: 960 }, deck.meta)
    const files = unzipSync(bytes)
    // The background is the only picture.
    expect(Object.keys(files).filter((f) => f.startsWith('ppt/media/'))).toEqual(['ppt/media/image1.png', 'ppt/media/image2.png'])
    const slide = xml(files, 'ppt/slides/slide1.xml')
    expect(slide).toContain('<p:cSld name="One">')
    expect(slide).toContain('<p:bg><p:bgPr><a:blipFill')
    expect(slide).toContain('<p:ph type="title"/>')
    expect(slide).toContain('<a:t>Body text</a:t>')
    // Positions in EMU: 9525 to the CSS pixel.
    expect(slide).toContain('<a:off x="952500" y="1905000"/>')

    const back = pptxToMarkdown(bytes, 'talk.pptx')
    expect(back.source).toContain('title: "Q3 & more"')
    expect(back.source).toContain('author: "Ana"')
    // 4:3, so the deck that reads it back has the same canvas.
    expect(back.source).toContain('canvas: 1280x960')
    // A slide with a background picture reads back as it looks, its text still text.
    expect(back.source).toContain('aria-label="One"')
    expect(back.source).toMatch(/>One<\/span>/)
    expect(back.source).toMatch(/>Body text<\/span>/)
    const parsed = parseDeck(back.source, { file: 'talk.pptx' })
    expect(parsed.deck.slides).toHaveLength(2)
    expect(parsed.deck.slides[1]!.notes).toEqual([])
    expect(back.source).toContain('::: notes\nSay this first, then that, with code & more.\n\na point\n\nunder it\n\nanother\n\nfirst\n\nsecond\n:::')
  })

  it('writes lists with their bullets, links as hyperlinks, and boxes as shapes', () => {
    const list: TextItem = {
      ...text('first'),
      paragraphs: ['first', 'second'].map((t) => ({ ...para(t), left: 30, indent: -20, bullet: { char: '•', colour: RED } })),
    }
    const linked: TextItem = { ...text(''), paragraphs: [{ ...para(''), runs: [{ ...run('docs'), link: 'https://example.com/?a=1&b=2' }] }] }
    const box: ShapeItem = { kind: 'shape', rect: { x: 10, y: 10, w: 100, h: 50 }, fill: { colour: RED }, radius: 8, name: 'Box' }
    const files = unzipSync(writePptx([page([list, linked, box])], { width: 1280, height: 720 }, META))
    const slide = xml(files, 'ppt/slides/slide1.xml')
    expect(slide).toContain('<a:buChar char="•"/>')
    expect(slide).toContain('<a:srgbClr val="C0392B">')
    expect(slide).toContain('<a:prstGeom prst="roundRect">')
    expect(slide).toMatch(/<a:hlinkClick r:id="(rId\d+)"\/>/)
    expect(xml(files, 'ppt/slides/_rels/slide1.xml.rels')).toContain('Target="https://example.com/?a=1&amp;b=2" TargetMode="External"')
  })

  it('writes a table as a native table, merged cells and all', () => {
    const cell = (t: string, row: number, col: number, colSpan = 1): Cell => ({ paragraphs: [para(t)], borders: { b: { width: 1, colour: RED } }, insets: { l: 8, t: 4, r: 8, b: 4 }, anchor: 't', row, col, rowSpan: 1, colSpan })
    const table: TableItem = { kind: 'table', rect: { x: 0, y: 0, w: 300, h: 60 }, cols: [100, 200], rows: [30, 30], cells: [cell('Both', 0, 0, 2), cell('a', 1, 0), cell('b', 1, 1)], name: 'Table' }
    const slide = xml(unzipSync(writePptx([page([table])], { width: 1280, height: 720 }, META)), 'ppt/slides/slide1.xml')
    expect(slide).toContain('<a:tbl>')
    expect(slide).toContain('<a:gridCol w="952500"/><a:gridCol w="1905000"/>')
    expect(slide).toContain('gridSpan="2"')
    expect(slide).toContain('hMerge="1"')
    expect(slide).toContain('<a:t>Both</a:t>')
  })

  it('writes a chart as a native chart, with its values in a workbook beside it', () => {
    const chart: ChartData = {
      type: 'bar', categories: ['Q1', 'Q2'], series: [{ name: 'Sales', values: [3, 5], colour: RED }],
      legend: false, textColour: RED, font: 'Inter', fontSize: 18, axis: { min: 0, max: 6, interval: 2 }, numberFormat: '#,##0',
    }
    const picture: PictureItem = { kind: 'picture', rect: { x: 0, y: 0, w: 600, h: 300 }, id: 1, alt: 'Sales', name: 'Chart', chart }
    const files = unzipSync(writePptx([page([picture])], { width: 1280, height: 720 }, META))
    expect(xml(files, 'ppt/slides/slide1.xml')).toContain('<c:chart xmlns:c=')
    const part = xml(files, 'ppt/charts/chart1.xml')
    expect(part).toContain('<c:barDir val="col"/>')
    expect(part).toContain('<c:pt idx="1"><c:v>Q2</c:v></c:pt>')
    expect(part).toContain('<c:max val="6"/><c:min val="0"/>')
    expect(part).toContain('<c:majorUnit val="2"/>')
    expect(xml(files, 'ppt/charts/_rels/chart1.xml.rels')).toContain('../embeddings/Microsoft_Excel_Worksheet1.xlsx')
    const sheet = xml(unzipSync(files['ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx']!), 'xl/worksheets/sheet1.xml')
    expect(sheet).toContain('<is><t>Sales</t></is>')
    expect(sheet).toContain('<c r="B3"><v>5</v></c>')
    expect(xml(files, '[Content_Types].xml')).toContain('<Default Extension="xlsx"')
  })

  it('escapes what XML would misread, and drops what it can\'t carry', () => {
    const bytes = writePptx([page([text('a < b & "c"')], [{ runs: [{ text: 'x\u0001y <z>' }] }], 'a < b & "c"')], { width: 1280, height: 720 }, META)
    const files = unzipSync(bytes)
    expect(new TextDecoder().decode(files['ppt/slides/slide1.xml'])).toContain('<a:t>a &lt; b &amp; &quot;c&quot;</a:t>')
    expect(new TextDecoder().decode(files['ppt/notesSlides/notesSlide1.xml'])).toContain('<a:t>xy &lt;z&gt;</a:t>')
  })
})
