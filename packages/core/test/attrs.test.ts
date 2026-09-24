import { describe, expect, it } from 'vitest'
import { parseAttrs, scanAttrBlock } from '../src/attrs.js'

describe('parseAttrs (syntax.md §4.1)', () => {
  it('reads every token kind', () => {
    const r = parseAttrs(`.a #b @2-4 dur=400 style="color: red" title='it\\'s'`)
    expect(r.errors).toEqual([])
    expect(r.valid).toBe(6)
    expect(r.attrs).toEqual({
      classes: ['a'],
      id: 'b',
      step: { kind: 'abs', in: 2, out: 4 },
      pairs: [
        { key: 'dur', value: '400', offset: 11 },
        { key: 'style', value: 'color: red', offset: 19 },
        { key: 'title', value: "it's", offset: 38 },
      ],
    })
  })

  it.each([
    ['@+', { kind: 'next' }],
    ['@=', { kind: 'same' }],
    ['@0', { kind: 'abs', in: 0 }],
    ['@12', { kind: 'abs', in: 12 }],
  ])('step %s', (tok, step) => {
    expect(parseAttrs(tok).attrs.step).toEqual(step)
  })

  it.each(['', 'foo', 'x, y', '.5', '#1', '"quoted"'])('%j has no valid token (literal text)', (s) => {
    expect(parseAttrs(s).valid).toBe(0)
  })

  it('reports invalid tokens next to valid ones', () => {
    const r = parseAttrs('fade @1')
    expect(r.valid).toBe(1)
    expect(r.errors).toEqual([
      { code: 'attr/unknown-token', message: 'unknown token `fade`: did you mean `.fade`?', offset: 0 },
    ])
  })

  it('counts a mistyped step as intent, so it is reported rather than printed', () => {
    expect(parseAttrs('@4-2').valid).toBe(1)
    expect(parseAttrs('@x').valid).toBe(0)
  })

  it.each([
    ['@4-2', 'attr/bad-step'],
    ['@x', 'attr/bad-step'],
    ['#a #b', 'attr/duplicate-id'],
    ['@1 @2', 'attr/duplicate-step'],
    ['.a k="open', 'attr/unterminated-quote'],
    ['.a k=', 'attr/empty-value'],
  ])('%s → %s', (s, code) => {
    expect(parseAttrs(s).errors.map((e) => e.code)).toContain(code)
  })
})

describe('scanAttrBlock', () => {
  it('respects quotes and stops at line ends', () => {
    expect(scanAttrBlock('{a="}" .b} tail')).toBe(10)
    expect(scanAttrBlock('{.a\n}')).toBe(-1)
    expect(scanAttrBlock('x{.a}')).toBe(-1)
    expect(scanAttrBlock('{.a}', 0)).toBe(4)
  })
})
