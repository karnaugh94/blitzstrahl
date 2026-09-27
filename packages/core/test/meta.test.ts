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
