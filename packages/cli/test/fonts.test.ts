import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseDeck } from '@blitzstrahl/core'
import { aurora, broadsheet } from '@blitzstrahl/themes'
import type { ThemeFontFile } from '../src/extend.js'
import { deckText, fontDiagnostics, parseRange, standaloneFonts } from '../src/fonts.js'

const themes = join(dirname(fileURLToPath(import.meta.resolve('@blitzstrahl/themes'))), '..')
/** A built-in theme's fonts as the CLI collects them. */
const files = (fonts: typeof aurora.fonts): ThemeFontFile[] =>
  (fonts ?? []).map((f) => ({ family: f.family, file: join(themes, 'dist', String(f.src)), weight: String(f.weight), style: f.style ?? 'normal', ...(f.unicodeRange ? { unicodeRange: f.unicodeRange } : {}) }))
const name = (f: ThemeFontFile) => `${f.family} ${f.file.match(/-(latin-ext|latin|greek|cyrillic|vietnamese)-/)![1]} ${f.style}`
const deck = (md: string) => parseDeck(md, { file: 'deck.md' }).deck
const pick = (md: string, theme = aurora) => standaloneFonts(files(theme.fonts), deckText(deck(md)), theme.tokens, theme.stylesheet).map(name)

describe('fonts: what a standalone file carries', () => {
  it('reads a unicode-range', () => {
    expect(parseRange('U+0000-00FF, U+0131,U+4??')).toEqual([[0, 0xff], [0x131, 0x131], [0x400, 0x4ff]])
  })

  it('an English deck in aurora: Inter, Latin, upright; nothing else', () => {
    expect(pick('# Hello\n\nPlain text.\n')).toEqual(['Inter latin normal'])
  })

  it('adds the scripts the text uses', () => {
    expect(pick('# Zażółć gęślą jaźń\n\nΚαλημέρα, Привет\n')).toEqual(['Inter latin normal', 'Inter latin-ext normal', 'Inter greek normal', 'Inter cyrillic normal'])
  })

  it('adds italics for emphasis, and the code font for code', () => {
    expect(pick('# A\n\nSome *stress* and `code`.\n')).toEqual(['Inter latin normal', 'Inter latin italic', 'JetBrains Mono latin normal', 'JetBrains Mono latin italic'])
  })

  it("broadsheet's CSS sets things in italic, so its italics come along", () => {
    expect(pick('# Hello\n\nPlain text.\n', broadsheet)).toEqual(['Newsreader latin normal', 'Newsreader latin italic', 'Inter latin normal', 'Inter latin italic'])
  })

  it('math is left to KaTeX', () => {
    expect(deckText(deck('# A\n\n$\\alpha$\n')).chars.has('α')).toBe(false)
  })
})

describe('fonts: check', () => {
  const diags = (md: string, theme = aurora, fonts = files(theme.fonts)) => fontDiagnostics(deck(md), fonts, theme.tokens, theme.name).map((d) => [d.severity, d.code, d.message])

  it('says nothing for a built-in theme and European text', () => {
    expect(diags('# Zażółć\n\nΚαλημέρα, Привет, Việt Nam 🎉\n')).toEqual([])
  })

  it('warns about text no shipped font covers, on its slide', () => {
    expect(diags('# One\n\n---\n\n# Two\n\nمرحبا\n')).toEqual([
      ['warning', 'fonts/uncovered', "slide 2 has characters no font of theme `aurora` covers (م ر ح ب ا): they're set in whatever the presenting machine has"],
    ])
  })

  it("mentions a theme whose text font isn't shipped", () => {
    const bare = { ...aurora, name: 'bare', tokens: { ...aurora.tokens, 'font-sans': 'Helvetica, sans-serif' } }
    expect(diags('# A\n', bare, [])).toEqual([
      ['info', 'fonts/not-shipped', "theme `bare` doesn't ship its text font (Helvetica), so the deck is set in whatever the presenting machine has, and its line breaks can differ from one computer to the next"],
    ])
  })
})
