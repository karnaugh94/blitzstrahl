import { describe, expect, it } from 'vitest'
import { parseData, parseDelimited, pivot } from '../src/data.js'

describe('parseDelimited', () => {
  it('reads headers, numbers, quotes and blanks', () => {
    const csv = 'quarter,revenue,"note"\r\nQ1,"1,200",plain\nQ2,1.9e3,"said ""hi"", twice"\nQ3,,\n'
    expect(parseDelimited(csv)).toEqual([
      { quarter: 'Q1', revenue: 1200, note: 'plain' },
      { quarter: 'Q2', revenue: 1900, note: 'said "hi", twice' },
      { quarter: 'Q3', revenue: null, note: null },
    ])
  })
  it('keeps numeric-looking identifiers numeric but leaves words alone', () => {
    expect(parseDelimited('a\tb\n2024\tQ1', '\t')).toEqual([{ a: 2024, b: 'Q1' }])
  })
})

describe('parseData', () => {
  it('dispatches on extension', () => {
    expect(parseData('x.json', '[{"a":1}]')).toEqual([{ a: 1 }])
    expect(() => parseData('x.xlsx', '')).toThrow(/csv, .tsv or .json/)
    expect(() => parseData('x.json', '{"a":1}')).toThrow(/list of rows/)
  })
})

describe('pivot', () => {
  it('turns long data into one series per group', () => {
    const rows = [
      { q: 'Q1', region: 'EU', rev: 1 },
      { q: 'Q1', region: 'US', rev: 2 },
      { q: 'Q2', region: 'EU', rev: 3 },
      { q: 'Q2', region: 'EU', rev: 4 },
    ]
    expect(pivot(rows, 'q', 'rev', 'region')).toEqual({
      categories: ['Q1', 'Q2'],
      series: [
        { name: 'EU', data: [1, 7] },
        { name: 'US', data: [2, null] },
      ],
    })
  })
})
