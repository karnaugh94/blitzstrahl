import { describe, expect, it } from 'vitest'
import { flipFrames, pairCandidates, type Candidate, type Placement } from '../src/morph.js'

/** Elements are strings; `a/b` is inside `a`. */
const contains = (a: string, b: string) => b.startsWith(`${a}/`)
const pairs = (from: Candidate<string>[], to: Candidate<string>[]) => pairCandidates(from, to, contains).map((p) => `${p.from}→${p.to}`)

describe('auto-animate pairing (syntax.md §9)', () => {
  it('pairs keys first, then content, identical content in document order', () => {
    expect(
      pairs(
        [{ el: 'logo', key: 'logo' }, { el: 'x', sig: 'p x' }, { el: 'x2', sig: 'p x' }, { el: 'only', sig: 'p only' }],
        [{ el: 'y', sig: 'p x' }, { el: 'LOGO', key: 'logo' }, { el: 'y2', sig: 'p x' }],
      ),
    ).toEqual(['logo→LOGO', 'x→y', 'x2→y2'])
  })

  it('a keyed element pairs only by its key', () => {
    expect(pairs([{ el: 'a', key: 'k' }], [{ el: 'b', sig: 'p same' }])).toEqual([])
  })

  it('the first of a repeated key pairs', () => {
    expect(pairs([{ el: 'a', key: 'k' }, { el: 'a2', key: 'k' }], [{ el: 'b', key: 'k' }, { el: 'b2', key: 'k' }])).toEqual(['a→b'])
  })

  it('never pairs inside (or around) an element that already moves', () => {
    expect(
      pairs(
        [{ el: 'card', key: 'card' }, { el: 'card/title', sig: 'h T' }, { el: 'list', sig: 'ul L' }, { el: 'list/item', sig: 'li I' }],
        [{ el: 'card', key: 'card' }, { el: 'title', sig: 'h T' }, { el: 'list', sig: 'ul L' }, { el: 'list/item', sig: 'li I' }],
      ),
    ).toEqual(['card→card', 'list→list'])
  })
})

describe('FLIP keyframes', () => {
  const at = (left: number, top: number, width: number, size = width, k = 1): Placement => ({
    box: { left, top, width },
    anchor: { left, top, width },
    size,
    k,
  })

  it('moves and scales about the anchor corner, in local pixels', () => {
    const self = { ...at(100, 100, 400, 20, 2), anchor: { left: 140, top: 120, width: 100 } }
    const other = at(300, 60, 200, 40, 2)
    expect(flipFrames(self, other, 'to')).toEqual([
      { transformOrigin: '20px 10px', transform: 'none' },
      { transformOrigin: '20px 10px', transform: 'translate(80px, -30px) scale(2)' },
    ])
    expect(flipFrames(self, other, 'from').map((k) => k.transform)).toEqual(['translate(80px, -30px) scale(2)', 'none'])
  })
})
