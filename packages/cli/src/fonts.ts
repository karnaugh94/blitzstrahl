/**
 * What a deck's text asks of its theme's fonts (PLAN §15, M7.1): which
 * shipped faces a standalone file must carry, and what `check` should say
 * about fonts that aren't shipped or text that none covers. Pure: it reads
 * the IR, never a browser.
 */
import type { Deck, Diagnostic, HastNode, SourceSpan } from '@blitzstrahl/core'
import { TOKEN_DEFAULTS } from '@blitzstrahl/themes'
import type { ThemeFontFile } from './extend.js'

/** A `unicode-range` as inclusive [from, to] code point pairs (`U+0000-00FF`, `U+0131`, `U+4??`). */
export function parseRange(range: string): Array<[number, number]> {
  return range.split(',').flatMap((part) => {
    const m = /^\s*U\+([0-9A-F?]+)(?:-([0-9A-F]+))?\s*$/i.exec(part)
    if (!m) return []
    const from = parseInt(m[1]!.replace(/\?/g, '0'), 16)
    const to = m[2] ? parseInt(m[2], 16) : parseInt(m[1]!.replace(/\?/g, 'F'), 16)
    return [[from, to] as [number, number]]
  })
}

const inRanges = (ranges: ReadonlyArray<[number, number]>, cp: number) => ranges.some(([a, b]) => cp >= a && cp <= b)

/** Text that needs no font of the theme's: spaces, controls, emoji and their joiners. */
const NO_FONT = /[\s\p{Cc}\p{Cf}\p{Extended_Pictographic}\u{FE00}-\u{FE0F}\u{1F3FB}-\u{1F3FF}]/u

/** Elements whose text is set in italic by default. */
const ITALIC_TAGS = new Set(['em', 'i', 'cite', 'var', 'dfn', 'address'])
const CODE_TAGS = new Set(['code', 'pre', 'kbd', 'samp'])

export interface DeckText {
  /** Every character on the slides (not the notes, not math), with the first slide it's on. */
  chars: Map<string, number>
  italic: boolean
  code: boolean
}

/** What the slides' text is made of. Math is left out: KaTeX brings its own fonts. */
export function deckText(deck: Deck): DeckText {
  const out: DeckText = { chars: new Map(), italic: false, code: false }
  const walk = (node: HastNode, slide: number) => {
    if (node.type === 'text') {
      for (const ch of node.value) if (!out.chars.has(ch) && !NO_FONT.test(ch)) out.chars.set(ch, slide)
      return
    }
    if (node.type !== 'element') return
    const classes = node.properties.className
    if (Array.isArray(classes) && classes.includes('math')) return
    if (ITALIC_TAGS.has(node.tagName)) out.italic = true
    if (CODE_TAGS.has(node.tagName)) out.code = true
    if (typeof node.properties.style === 'string' && /italic|oblique/.test(node.properties.style)) out.italic = true
    for (const kid of node.children) walk(kid as HastNode, slide)
  }
  deck.slides.forEach((s, i) => s.content.forEach((n) => walk(n, i)))
  return out
}

/** The first family a `font-family` list names, unquoted (`"Inter", sans-serif` → `Inter`). */
export function firstFamily(list: string): string {
  return (list.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '')
}

/**
 * The faces a standalone file needs, of the theme's: those whose range
 * covers some of the text; the code font's only if there's code; italics
 * only if something is italic (an `<em>`, or a rule in the theme's or the
 * deck's CSS). A browser still picks among them by `unicode-range`.
 */
export function standaloneFonts(fonts: readonly ThemeFontFile[], text: DeckText, tokens: Readonly<Record<string, string>>, css: string): ThemeFontFile[] {
  const mono = firstFamily(tokens['font-mono'] ?? TOKEN_DEFAULTS['font-mono'] ?? '')
  const italic = text.italic || /font-style\s*:\s*(italic|oblique)|font:[^;}]*\bitalic\b/i.test(css)
  const cps = [...text.chars.keys()].map((c) => c.codePointAt(0)!)
  return fonts.filter((f) => {
    if (f.style !== 'normal' && !italic) return false
    if (f.family === mono && !text.code) return false
    if (!f.unicodeRange) return true
    const ranges = parseRange(f.unicodeRange)
    return cps.some((cp) => inRanges(ranges, cp))
  })
}

/**
 * What `check` says about fonts: an info when the theme's text font isn't
 * one it ships (so it's whatever the presenting machine has), and a warning
 * for text that no shipped face covers.
 */
export function fontDiagnostics(
  deck: Deck,
  fonts: readonly ThemeFontFile[],
  tokens: Readonly<Record<string, string>>,
  theme: string,
  slideSpan: (index: number) => SourceSpan = (i) => deck.slides[i]!.span,
): Diagnostic[] {
  const out: Diagnostic[] = []
  const at = { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } }
  const text = firstFamily(tokens['font-sans'] ?? TOKEN_DEFAULTS['font-sans'] ?? '')
  const shipped = new Set(fonts.map((f) => f.family))
  if (!shipped.has(text)) {
    out.push({
      severity: 'info',
      code: 'fonts/not-shipped',
      message: `theme \`${theme}\` doesn't ship its text font (${text}), so the deck is set in whatever the presenting machine has, and its line breaks can differ from one computer to the next`,
      file: deck.source,
      span: at,
    })
  }
  if (!fonts.length) return out
  // A face without a range covers everything, as far as anyone can tell.
  if (fonts.some((f) => !f.unicodeRange)) return out
  const ranges = fonts.flatMap((f) => parseRange(f.unicodeRange!))
  const bySlide = new Map<number, string[]>()
  for (const [ch, slide] of deckText(deck).chars) {
    if (inRanges(ranges, ch.codePointAt(0)!)) continue
    bySlide.set(slide, [...(bySlide.get(slide) ?? []), ch])
  }
  for (const [slide, chars] of bySlide) {
    const shown = chars.slice(0, 6).join(' ') + (chars.length > 6 ? ' …' : '')
    out.push({
      severity: 'warning',
      code: 'fonts/uncovered',
      message: `slide ${slide + 1} has characters no font of theme \`${theme}\` covers (${shown}): they're set in whatever the presenting machine has`,
      file: deck.source,
      span: slideSpan(slide),
    })
  }
  return out
}
