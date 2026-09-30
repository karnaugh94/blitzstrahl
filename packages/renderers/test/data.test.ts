import { describe, expect, it } from 'vitest'
import { dataNumerals, readNumber } from '@blitzstrahl/core/numbers'
import { aggregate, delimiterOf, parseData, parseDelimited, pivot } from '../src/data.js'

const de = (t: string) => readNumber(t, dataNumerals('.'))

describe('parseDelimited', () => {
  it('reads headers, numbers, quotes and blanks', () => {
    const csv = 'quarter,revenue,"note"\r\nQ1,"1200",plain\nQ2,1.9e3,"said ""hi"", twice"\nQ3,,\n'
    expect(parseDelimited(csv)).toEqual([
      { quarter: 'Q1', revenue: 1200, note: 'plain' },
      { quarter: 'Q2', revenue: 1900, note: 'said "hi", twice' },
      { quarter: 'Q3', revenue: null, note: null },
    ])
  })
  it('keeps numeric-looking identifiers numeric but leaves words alone', () => {
    expect(parseDelimited('a\tb\n2024\tQ1', '\t')).toEqual([{ a: 2024, b: 'Q1' }])
  })

  it('reads data plainly in every language: 2.000 is 2', () => {
    expect(parseDelimited('a,b\n2.000,-0.25\n')).toEqual([{ a: 2, b: -0.25 }])
  })

  it('stops at a number written another way, at its line, and says what would read it (1.0 read "1,200" as 1200)', () => {
    expect(() => parseDelimited('city,people\nLisbon,545\n"Porto, north","1,200"\n', ',', undefined, '`x.csv`')).toThrow(
      '`x.csv`, line 3: `1,200` in `people` isn\'t a number as data writes them',
    )
    expect(() => parseDelimited('a\n"1,200"\n')).toThrow('`thousands: ","`')
    expect(() => parseDelimited('a\n"3,5"\n')).toThrow('`thousands: "."`')
    expect(() => parseDelimited('a\n"quoted\nline"\n"3,5"\n')).toThrow('line 4:')
  })

  it('reads a file written with thousands marks when told how', () => {
    const csv = 'country,rate,people\nES,"3,5","1.234.567"\nDE,"12,25","12.000"\n'
    expect(parseDelimited(csv, ',', de)).toEqual([
      { country: 'ES', rate: 3.5, people: 1234567 },
      { country: 'DE', rate: 12.25, people: 12000 },
    ])
  })

  it('leaves a comma that no way of writing numbers explains as text', () => {
    expect(parseDelimited('a,b\n"1,2,3",1200\n')).toEqual([{ a: '1,2,3', b: 1200 }])
  })
})

describe('delimiters', () => {
  it("detects Excel's semicolon CSV, and suggests how its numbers are written", () => {
    const csv = 'Land;Quote;Menschen\nES;3,5;1.234.567\nDE;12,25;12.000\n'
    expect(delimiterOf(csv)).toBe(';')
    expect(() => parseData('x.csv', csv)).toThrow('`thousands: "."`')
    expect(parseData('x.csv', csv, { read: de })).toEqual([
      { Land: 'ES', Quote: 3.5, Menschen: 1234567 },
      { Land: 'DE', Quote: 12.25, Menschen: 12000 },
    ])
    expect(delimiterOf('a,b;c\n1,2\n')).toBe(',')
    expect(delimiterOf('"x;y",b\n1,2\n')).toBe(',')
  })

  it('takes the delimiter a spec gives', () => {
    expect(parseData('x.csv', 'a|b;c\n1|2\n', { delimiter: '|' })).toEqual([{ a: 1, 'b;c': 2 }])
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

describe('aggregate', () => {
  it('sums by default; mean, min, max; count counts rows', () => {
    const v = [4, null, 2, 'x', 6]
    expect(aggregate(v)).toBe(12)
    expect(aggregate(v, 'mean')).toBe(4)
    expect(aggregate(v, 'min')).toBe(2)
    expect(aggregate(v, 'max')).toBe(6)
    expect(aggregate(v, 'count')).toBe(5)
    expect(aggregate([null, 'x'])).toBeNull()
  })
})
