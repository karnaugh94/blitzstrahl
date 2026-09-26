import { describe, expect, it } from 'vitest'
import { delimiterOf, parseData, parseDelimited, pivot } from '../src/data.js'

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

  it('reads a column with decimal commas as decimals (1.0 read "3,5" as 35)', () => {
    const csv = 'country,rate,people\nES,"3,5","1.234.567"\nDE,"12,25","12.000"\nFR,"0,5","950"\n'
    expect(parseDelimited(csv)).toEqual([
      { country: 'ES', rate: 3.5, people: 1234567 },
      { country: 'DE', rate: 12.25, people: 12000 },
      { country: 'FR', rate: 0.5, people: 950 },
    ])
  })

  it('leaves a comma that is neither a group of three nor a decimal mark as text', () => {
    expect(parseDelimited('a,b\n"1,2,3","1,200"\n')).toEqual([{ a: '1,2,3', b: 1200 }])
  })
})

describe('delimiters', () => {
  it("detects Excel's semicolon CSV, where the comma is the decimal mark", () => {
    const csv = 'Land;Quote;Menschen\nES;3,5;1.234.567\nDE;12,25;12.000\n'
    expect(delimiterOf(csv)).toBe(';')
    expect(parseData('x.csv', csv)).toEqual([
      { Land: 'ES', Quote: 3.5, Menschen: 1234567 },
      { Land: 'DE', Quote: 12.25, Menschen: 12000 },
    ])
    expect(delimiterOf('a,b;c\n1,2\n')).toBe(',')
    expect(delimiterOf('"x;y",b\n1,2\n')).toBe(',')
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
