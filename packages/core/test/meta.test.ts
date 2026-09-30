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

  it('`blitzstrahl` is a version, major.minor, read as written (M13)', () => {
    const read = (v: string) => {
      const { deck: d, diagnostics } = deck(`blitzstrahl: ${v}`)
      return [d.meta.blitzstrahl, diagnostics.map((x) => `${x.severity} ${x.code}@${x.span.start.line}`)]
    }
    expect(read('1.1')).toEqual(['1.1', []])
    expect(read('"1.2"')).toEqual(['1.2', []])
    // YAML alone would read these as the number 1.1.
    expect(read('1.10')).toEqual(['1.10', []])
    expect(read('1.100')).toEqual(['1.100', []])
    for (const bad of ['1', 'yes', '1.1.0', '"v1.1"', '[1, 1]']) expect(read(bad), bad).toEqual([undefined, ['error frontmatter/blitzstrahl@2']])
    expect(deck('title: x').deck.meta).not.toHaveProperty('blitzstrahl')
  })

  it('a built key leaves the reserved list', () => {
    expect(RESERVED_DECK_KEYS.has('thousands')).toBe(false)
    expect(RESERVED_DECK_KEYS.has('decimal')).toBe(false)
    expect(RESERVED_DECK_KEYS.has('footer')).toBe(false)
    expect(RESERVED_DECK_KEYS.has('css')).toBe(false)
    expect(RESERVED_DECK_KEYS.has('duration')).toBe(false)
  })
})

describe('`duration` and `pace-margin` (presenting.md, *Pacing*)', () => {
  it('a time with units, in ms, reaching the page', () => {
    for (const [v, ms] of [['20min', 1_200_000], ['1h', 3_600_000], ['1h30min', 5_400_000], ['1h 30min', 5_400_000], ['90s', 90_000], ['2.5min', 150_000]] as const) {
      const { deck: d, diagnostics } = deck(`duration: ${v}`)
      expect(diagnostics).toEqual([])
      expect(d.meta.duration).toBe(ms)
      expect(toPayload(d).duration).toBe(ms)
    }
    expect(toPayload(deck('title: x').deck)).not.toHaveProperty('duration')
  })

  it('a bare number is an error that suggests minutes', () => {
    for (const v of ['20', '"20"', 'soon', 'min']) {
      const { deck: d, diagnostics } = deck(`duration: ${v}`)
      expect(d.meta.duration).toBeUndefined()
      expect(diagnostics.map((x) => [x.severity, x.code])).toEqual([['error', 'frontmatter/time']])
    }
    expect(deck('duration: 20').diagnostics[0]!.message).toContain('`20min`')
  })

  it('`pace-margin`: a share of the duration or a time, only with a duration', () => {
    expect(deck('duration: 20min\npace-margin: 10%').deck.meta.paceMargin).toBe(120_000)
    expect(toPayload(deck('duration: 20min\npace-margin: 2min').deck).paceMargin).toBe(120_000)
    expect(deck('duration: 20min').deck.meta.paceMargin).toBeUndefined()
    const alone = deck('pace-margin: 10%')
    expect(alone.deck.meta.paceMargin).toBeUndefined()
    expect(alone.diagnostics.map((x) => [x.severity, x.code])).toEqual([['warning', 'frontmatter/pace-margin']])
    expect(deck('duration: 20min\npace-margin: lots').diagnostics.map((x) => x.code)).toEqual(['frontmatter/time'])
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

describe('chrome keys (syntax.md §3.6)', () => {
  it('`slide-numbers`: true is `{n}`, a template must have `{n}`, false is off', () => {
    expect(deck('slide-numbers: true').deck.meta.slideNumbers).toBe('{n}')
    expect(deck('slide-numbers: "{n} / {total}"').deck.meta.slideNumbers).toBe('{n} / {total}')
    expect(deck('slide-numbers: false').deck.meta.slideNumbers).toBeUndefined()
    const bad = deck('slide-numbers: "Page"')
    expect(bad.diagnostics.map((x) => x.code)).toEqual(['frontmatter/type'])
    expect(bad.deck.meta.slideNumbers).toBeUndefined()
  })

  it('`footer` is one line of inline markdown, and its local links are files the page uses', () => {
    const { deck: d, diagnostics } = deck('footer: "*Acme* · [notes](./notes.pdf)"')
    expect(diagnostics).toEqual([])
    expect(d.meta.footer!.map((n) => (n.type === 'element' ? n.tagName : n.type))).toEqual(['em', 'text', 'a'])
    expect(d.assets.map((a) => a.path)).toEqual(['notes.pdf'])
  })

  it('a `footer` that is more than a line is plain text, with a warning', () => {
    const { deck: d, diagnostics } = deck('footer: "- a list"')
    expect(diagnostics.map((x) => x.code)).toEqual(['frontmatter/type'])
    expect(d.meta.footer).toEqual([{ type: 'text', value: '- a list' }])
  })

  it('`logo` is an asset; `chrome: false` is a slide setting', () => {
    const { deck: d, diagnostics } = parseDeck('---\nlogo: ./img/logo.svg\n---\n\n# A\n\n---\nchrome: false\n---\n\n# B\n\n---\nchrome: "no"\n---\n\n# C\n', { file: 'deck.md' })
    expect(diagnostics.map((x) => x.code)).toEqual(['frontmatter/type'])
    expect(d.assets.map((a) => [a.path, a.kind])).toEqual([['img/logo.svg', 'image']])
    expect(d.slides.map((s) => s.attrs.chrome)).toEqual([undefined, false, undefined])
  })
})
