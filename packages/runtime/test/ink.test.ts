import { describe, expect, it } from 'vitest'
import { InkBook, strokePath, type Stroke } from '../src/ink.js'

const stroke = (id: string, points: number[]): Stroke => ({ id, color: '#fff', width: 6, points })

describe('ink book', () => {
  it('keeps strokes per slide; a repeated id replaces (the stroke grew)', () => {
    const book = new InkBook()
    book.apply({ op: 'stroke', slide: 0, stroke: stroke('a1', [0, 0]) })
    book.apply({ op: 'stroke', slide: 0, stroke: stroke('a1', [0, 0, 5, 5]) })
    book.apply({ op: 'stroke', slide: 2, stroke: stroke('p1', [1, 1]) })
    expect(book.strokes.get(0)).toEqual([stroke('a1', [0, 0, 5, 5])])
    expect([...book.strokes.keys()]).toEqual([0, 2])
  })

  it('clears one slide, and a sync replaces everything; the laser changes nothing', () => {
    const book = new InkBook()
    book.apply({ op: 'stroke', slide: 0, stroke: stroke('a1', [0, 0]) })
    book.apply({ op: 'stroke', slide: 1, stroke: stroke('a2', [0, 0]) })
    book.apply({ op: 'laser', at: [3, 4] })
    book.apply({ op: 'clear', slide: 0 })
    expect([...book.strokes.keys()]).toEqual([1])
    const copy = new InkBook()
    copy.apply(book.snapshot())
    expect(copy.strokes).toEqual(book.strokes)
    copy.apply({ op: 'sync', strokes: {} })
    expect(copy.strokes.size).toBe(0)
  })
})

describe('stroke path', () => {
  it('draws a dot, a line, and curves through the midpoints', () => {
    expect(strokePath([])).toBe('')
    expect(strokePath([10, 20])).toBe('M10 20L10 20')
    expect(strokePath([0, 0, 10, 0])).toBe('M0 0L10 0')
    expect(strokePath([0, 0, 10, 0, 10, 10])).toBe('M0 0Q10 0 10 5L10 10')
  })
})
