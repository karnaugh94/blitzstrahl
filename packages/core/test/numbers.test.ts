import { describe, expect, it } from 'vitest'
import { decimalMark, findNumeral, formatNumber, numberStyle, readNumber } from '../src/numbers.js'

describe('numbers', () => {
  it('reads a comma as a decimal mark only where nothing else fits', () => {
    expect(decimalMark(['3,5', '12,25'])).toBe(',')
    expect(decimalMark(['1.234,5'])).toBe(',')
    expect(decimalMark(['1.234.567'])).toBe(',')
    expect(decimalMark(['1 234,5'])).toBe(',')
    expect(decimalMark(['1,200', '12,250'])).toBe('.') // the documented reading
    expect(decimalMark(['3.5', '1,200'])).toBe('.')
    expect(decimalMark(['1,234.5', '3,5'])).toBe('.') // conflicting: never guess a comma
    expect(decimalMark(['Q1', '', '2024'])).toBe('.')
  })

  it('reads numerals with either mark, and only real groups of three', () => {
    expect(readNumber('1,200')).toBe(1200)
    expect(readNumber('12,345.6')).toBe(12345.6)
    expect(readNumber('1.9e3')).toBe(1900)
    expect(readNumber('.5')).toBe(0.5)
    expect(readNumber('3,5')).toBeUndefined() // 1.0 read this as 35
    expect(readNumber('1,2,3')).toBeUndefined()
    expect(readNumber('3,5', ',')).toBe(3.5)
    expect(readNumber('1.234,5', ',')).toBe(1234.5)
    expect(readNumber('12.345.678', ',')).toBe(12345678)
    expect(readNumber('11 393,5', ',')).toBe(11393.5)
    expect(readNumber('11 393')).toBe(11393)
    expect(readNumber('−3,5', ',')).toBe(-3.5)
    expect(readNumber('1 2')).toBeUndefined()
    expect(readNumber('Q1')).toBeUndefined()
  })

  it('finds the numeral in a text, however it is grouped', () => {
    expect(findNumeral('Wachstum: 4,2 %')).toEqual({ index: 10, text: '4,2' })
    expect(findNumeral('1.234.567 Menschen')!.text).toBe('1.234.567')
    expect(findNumeral('11 393 visites')!.text).toBe('11 393')
    expect(findNumeral('$1,234.50 each')!.text).toBe('1,234.50')
    expect(findNumeral('Q3 2024')!.text).toBe('3')
    expect(findNumeral('−3,5 °C')!.text).toBe('−3,5')
    expect(findNumeral('none')).toBeUndefined()
  })

  it('writes values in the style of the numeral they count towards', () => {
    const de = numberStyle('1.234,50', ',')
    expect(formatNumber(617.25, de)).toBe('617,25')
    expect(formatNumber(1234.5, de)).toBe('1.234,50')
    expect(formatNumber(2.1, numberStyle('4,2', ','))).toBe('2,1')
    expect(formatNumber(12345, numberStyle('11 393', '.'))).toBe('12 345')
    expect(formatNumber(1500.5, numberStyle('1,234.50', '.'))).toBe('1,500.50')
    expect(formatNumber(-1.25, numberStyle('−3,5', ','))).toBe('−1,3')
    expect(formatNumber(-0.01, numberStyle('0', '.'))).toBe('0')
  })
})
