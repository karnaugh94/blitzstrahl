import { describe, expect, it } from 'vitest'
import { dataNumerals, findNumeral, formatNumber, langNumerals, numberStyle, readNumber, thousandsFor } from '../src/numbers.js'

const [EN, DE, FR] = ['en', 'de', 'fr'].map(langNumerals) as [ReturnType<typeof langNumerals>, ReturnType<typeof langNumerals>, ReturnType<typeof langNumerals>]

describe('numbers', () => {
  it('reads data plainly: a dot for decimals, nothing between the thousands', () => {
    expect(readNumber('1200')).toBe(1200)
    expect(readNumber('3.5')).toBe(3.5)
    expect(readNumber('2.000')).toBe(2)
    expect(readNumber('-0.25')).toBe(-0.25)
    expect(readNumber('1.9e3')).toBe(1900)
    expect(readNumber('.5')).toBe(0.5)
    expect(readNumber('1,200')).toBeUndefined() // 1.0 read this as 1200
    expect(readNumber('3,5')).toBeUndefined()
    expect(readNumber('11 393')).toBeUndefined()
    expect(readNumber('Q1')).toBeUndefined()
  })

  it('reads data with the thousands mark it declares, in groups of three', () => {
    expect(readNumber('1,200.5', dataNumerals(','))).toBe(1200.5)
    expect(readNumber('1200', dataNumerals(','))).toBe(1200)
    expect(readNumber('12,25', dataNumerals(','))).toBeUndefined()
    expect(readNumber('1.200,5', dataNumerals('.'))).toBe(1200.5)
    expect(readNumber('3,5', dataNumerals('.'))).toBe(3.5)
    expect(readNumber('12.345.678', dataNumerals('.'))).toBe(12345678)
    expect(readNumber('11 393,5', dataNumerals(' '))).toBe(11393.5)
    expect(readNumber('11\u202f393', dataNumerals(' '))).toBe(11393)
    expect(readNumber('−3,5', dataNumerals('.'))).toBe(-3.5)
    expect(readNumber('1,2,3', dataNumerals(','))).toBeUndefined()
  })

  it('suggests the thousands mark that would read a numeral', () => {
    expect(thousandsFor('1,200')).toBe(',')
    expect(thousandsFor('3,5')).toBe('.')
    expect(thousandsFor('1.234,5')).toBe('.')
    expect(thousandsFor('1,200', '.')).toBe('.') // a `;` file: most likely German
    expect(thousandsFor('1,2,3')).toBeUndefined()
  })

  it('reads text for the audience the way its language writes numbers', () => {
    expect(langNumerals('en').decimal).toBe('.')
    expect(readNumber('11 393', langNumerals('en'))).toBe(11393)
    expect(langNumerals('de-AT').decimal).toBe(',')
    expect(readNumber('1.234,5', langNumerals('de'))).toBe(1234.5)
    expect(readNumber('4,2', langNumerals('de'))).toBe(4.2)
    expect(readNumber('2.000', langNumerals('de'))).toBe(2000)
    expect(readNumber('1 234,5', langNumerals('fr'))).toBe(1234.5)
    expect(readNumber('1 234,5', langNumerals('sv'))).toBe(1234.5)
    expect(readNumber('1,200', langNumerals('en'))).toBe(1200)
    expect(readNumber('4,2', langNumerals('en'))).toBeUndefined()
    expect(langNumerals('not a tag!')).toEqual(langNumerals('en'))
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
    const de = numberStyle('1.234,50', DE)
    expect(formatNumber(617.25, de)).toBe('617,25')
    expect(formatNumber(1234.5, de)).toBe('1.234,50')
    expect(formatNumber(2.1, numberStyle('4,2', DE))).toBe('2,1')
    expect(formatNumber(12345, numberStyle('11 393', '.'))).toBe('12 345')
    expect(formatNumber(1500.5, numberStyle('1,234.50', EN))).toBe('1,500.50')
    expect(formatNumber(-1.25, numberStyle('−3,5', DE))).toBe('−1,3')
    expect(formatNumber(-0.01, numberStyle('0', EN))).toBe('0')
  })
})
