import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parseDeck } from '@blitzstrahl/core'
import { pptxToMarkdown } from '../src/pptx.js'
import { noteParagraphs, writePptx } from '../src/write-pptx.js'

/** A 1×1 PNG. */
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))

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

  it('writes a package that reads back: a picture per slide at the slide size, the notes, title and author', () => {
    const { deck } = parseDeck(`---\ntitle: Q3 & more\nauthor: Ana\n---\n\n${NOTES}`, { file: 'talk.md' })
    const pages = deck.slides.map((s) => ({ png: PNG, alt: s.title ?? '', notes: noteParagraphs(s.notes) }))
    const bytes = writePptx(pages, { width: 1280, height: 960 }, deck.meta)
    const files = unzipSync(bytes)
    expect(Object.keys(files).filter((f) => f.startsWith('ppt/media/'))).toEqual(['ppt/media/image1.png', 'ppt/media/image2.png'])
    const slide = new TextDecoder().decode(files['ppt/slides/slide1.xml'])
    expect(slide).toContain('<p:cSld name="One">')
    expect(slide).toContain('descr="One"')
    expect(slide).toContain('<a:ext cx="12192000" cy="9144000"/>')

    const back = pptxToMarkdown(bytes, 'talk.pptx')
    expect(back.source).toContain('title: "Q3 & more"')
    expect(back.source).toContain('author: "Ana"')
    // 4:3, so the deck that reads it back has the same canvas.
    expect(back.source).toContain('canvas: 1280x960')
    const parsed = parseDeck(back.source, { file: 'talk.pptx' })
    expect(parsed.deck.slides).toHaveLength(2)
    expect(parsed.deck.slides[1]!.notes).toEqual([])
    expect(back.source).toContain('::: notes\nSay this first, then that, with code & more.\n\na point\n\nunder it\n\nanother\n\nfirst\n\nsecond\n:::')
  })

  it('escapes what XML would misread, and drops what it can\'t carry', () => {
    const bytes = writePptx([{ png: PNG, alt: 'a < b & "c"', notes: [{ runs: [{ text: 'x\u0001y <z>' }] }] }], { width: 1280, height: 720 }, { title: 'T', lang: 'en', plugins: [], extra: {} } as never)
    const files = unzipSync(bytes)
    expect(new TextDecoder().decode(files['ppt/slides/slide1.xml'])).toContain('descr="a &lt; b &amp; &quot;c&quot;"')
    expect(new TextDecoder().decode(files['ppt/notesSlides/notesSlide1.xml'])).toContain('<a:t>xy &lt;z&gt;</a:t>')
  })
})
