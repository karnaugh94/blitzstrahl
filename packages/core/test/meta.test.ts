import { describe, expect, it } from 'vitest'
import { parseDeck, RESERVED_DECK_KEYS, toPayload } from '../src/index.js'

const deck = (fm: string) => parseDeck(`---\n${fm}\n---\n\n# One\n`, { file: 'deck.md' })

describe('deck keys', () => {
  it('`thousands` says how the deck\'s data groups thousands, and reaches the page', () => {
    for (const mark of [',', '.', ' ']) {
      const { deck: d, diagnostics } = deck(`thousands: "${mark}"`)
      expect(diagnostics).toEqual([])
      expect(d.meta.thousands).toBe(mark)
      expect(toPayload(d).thousands).toBe(mark)
    }
    expect(toPayload(deck('title: x').deck)).not.toHaveProperty('thousands')
  })

  it('`thousands` takes nothing else', () => {
    const { deck: d, diagnostics } = deck('thousands: "\'"')
    expect(d.meta.thousands).toBeUndefined()
    expect(diagnostics.map((x) => [x.severity, x.code])).toEqual([['error', 'frontmatter/thousands']])
  })

  it('a built key leaves the reserved list', () => {
    expect(RESERVED_DECK_KEYS.has('thousands')).toBe(false)
    expect(RESERVED_DECK_KEYS.has('decimal')).toBe(false)
    expect(RESERVED_DECK_KEYS.has('footer')).toBe(true)
  })
})

describe('deck `background` (syntax.md §3.6)', () => {
  const slides = (fm: string, rest: string) => parseDeck(`---\n${fm}\n---\n\n# Title\n\n---\n\n# Content\n${rest}`, { file: 'deck.md' })

  it('one value is every slide\'s, unless the slide sets its own', () => {
    const { deck: d, diagnostics } = slides('background: ./bg.png', '\n---\nbackground: "#123"\n---\n\n# Own\n')
    expect(diagnostics).toEqual([])
    expect(d.slides.map((s) => s.attrs.background)).toEqual(['./bg.png', './bg.png', '#123'])
    // The image is one asset, however many slides show it.
    expect(d.assets.filter((a) => a.path === 'bg.png')).toHaveLength(1)
  })

  it('one per layout, `default` for the layouts not listed', () => {
    const { deck: d, diagnostics } = slides(
      'background:\n  title: ./t.png\n  default: ./d.png',
      '\n---\nlayout: section\n---\n\n# Part two\n\n---\nbackground: none\n---\n\n# Bare\n',
    )
    expect(diagnostics).toEqual([])
    expect(d.slides.map((s) => s.attrs.background)).toEqual(['./t.png', './d.png', './d.png', 'none'])
    expect(d.assets.map((a) => a.path).sort()).toEqual(['d.png', 't.png'])
  })

  it('a layout left out, with no `default`, keeps the theme\'s', () => {
    const { deck: d } = slides('background:\n  title: ./t.png', '')
    expect(d.slides.map((s) => s.attrs.background)).toEqual(['./t.png', undefined])
  })

  it('an unknown layout is a warning at the key, and the rest still apply', () => {
    const { deck: d, diagnostics } = slides('background:\n  titel: ./t.png\n  default: "#eee"', '')
    expect(diagnostics.map((x) => [x.severity, x.code, x.span.start.line])).toEqual([['warning', 'layout/unknown', 2]])
    expect(diagnostics[0]!.message).toContain('`titel`')
    expect(d.slides.map((s) => s.attrs.background)).toEqual(['#eee', '#eee'])
  })

  it('a list is a warning, and nothing applies', () => {
    const { deck: d, diagnostics } = slides('background: [a, b]', '')
    expect(diagnostics.map((x) => x.code)).toEqual(['frontmatter/type'])
    expect(d.meta.background).toBeUndefined()
    expect(d.slides[1]!.attrs.background).toBeUndefined()
  })

  it('is no longer reserved', () => {
    expect(RESERVED_DECK_KEYS.has('background')).toBe(false)
  })
})
