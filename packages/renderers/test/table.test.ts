import { describe, expect, it } from 'vitest'
import { langNumerals } from '@blitzstrahl/core/numbers'
import { cellNumber, compareCells, sortedOrder } from '../src/table.js'

describe('table sorting', () => {
  it('reads numbers the way tables write them', () => {
    expect(cellNumber('1,200')).toBe(1200)
    expect(cellNumber(' -3.5% ')).toBe(-3.5)
    expect(cellNumber('−2')).toBe(-2)
    expect(cellNumber('$4.1M')).toBeCloseTo(4_100_000)
    expect(cellNumber('900k')).toBe(900_000)
    expect(cellNumber('.5')).toBe(0.5)
    expect(cellNumber('Q1')).toBeUndefined()
    expect(cellNumber('12 stores')).toBeUndefined()
  })

  it('orders numbers by value, before text; text naturally', () => {
    expect(compareCells('900k', '1.2M')).toBeLessThan(0)
    expect(compareCells('10', 'apple')).toBeLessThan(0)
    expect(compareCells('item 2', 'item 10')).toBeLessThan(0)
    expect(compareCells('Äpfel', 'apfel')).toBe(0)
  })

  it("reads cells the way the table's language writes numbers (1.0 read German \"3,25\" as 325)", () => {
    const de = langNumerals('de')
    const cells = ['3,25 %', '12,1 %', '4,0 %', '1.234,5 %', '2.000']
    expect(sortedOrder(cells, 'ascending', de).map((i) => cells[i])).toEqual(['3,25 %', '4,0 %', '12,1 %', '1.234,5 %', '2.000'])
    expect(cellNumber('2.000', de)).toBe(2000)
    expect(cellNumber('2.000')).toBe(2)
    expect(cellNumber('3,25 %')).toBeUndefined() // not English: sorts as text
    expect(cellNumber('1 234,5', langNumerals('fr'))).toBe(1234.5)
    expect(cellNumber('11 393')).toBe(11393)
    expect(cellNumber('1 2')).toBeUndefined()
  })

  it('is stable and keeps empty cells last both ways', () => {
    const cells = ['3', '', '1', '3', '2']
    expect(sortedOrder(cells, 'ascending')).toEqual([2, 4, 0, 3, 1])
    expect(sortedOrder(cells, 'descending')).toEqual([0, 3, 4, 2, 1])
  })
})
