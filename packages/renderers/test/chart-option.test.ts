import { describe, expect, it } from 'vitest'
import { chartOption, validate } from '../src/chart-option.js'

const ctx = { dur: 600, reducedMotion: false }
const rows = [
  { region: 'North', q: 'Q1', revenue: 4, units: 10, share: 0.2 },
  { region: 'South', q: 'Q1', revenue: 6, units: 30, share: 0.5 },
  { region: 'North', q: 'Q2', revenue: 5, units: 20, share: 0.3 },
]
type Series = { type: string; data: unknown[]; radius?: unknown; symbolSize?: unknown; name: string }
const series = (o: Record<string, unknown>) => o.series as Series[]

describe('chart spec', () => {
  it('knows every chart type, and says which keys fit which', () => {
    for (const type of ['bar', 'line', 'pie', 'scatter']) expect(() => validate({ type, data: './x.csv' })).not.toThrow()
    expect(() => validate({ type: 'radar', data: './x.csv' })).toThrow('bar, line, pie, scatter')
    expect(() => validate({ type: 'bar', data: './x.csv', donut: true })).toThrow('`donut` applies to pie charts, not bar')
    expect(() => validate({ type: 'pie', data: './x.csv', stack: true })).toThrow('`stack` applies to bar and line charts')
    expect(() => validate({ type: 'line', data: './x.csv', size: 'units' })).toThrow('`size` applies to scatter charts')
  })

  it('pie: one slice per category, summed; a donut is a ring', () => {
    const o = chartOption(validate({ type: 'pie', data: rows, x: 'region', y: 'revenue' }), rows, ctx)
    const [pie] = series(o)
    expect(pie!.type).toBe('pie')
    expect(pie!.data).toEqual([
      { name: 'North', value: 9 },
      { name: 'South', value: 6 },
    ])
    expect(pie!.radius).toEqual([0, '74%'])
    const ring = series(chartOption(validate({ type: 'pie', data: rows, x: 'region', y: 'revenue', donut: true }), rows, ctx))[0]!
    expect((ring.radius as string[])[0]).not.toBe(0)
  })

  it('pie: refuses several columns and negative values', () => {
    expect(() => chartOption(validate({ type: 'pie', data: rows, x: 'region' }), rows, ctx)).toThrow('one `y` column')
    const neg = [{ a: 'x', v: -1 }]
    expect(() => chartOption(validate({ type: 'pie', data: neg }), neg, ctx)).toThrow('negative')
  })

  it('scatter: numeric x, one series per group, sized bubbles', () => {
    const o = chartOption(validate({ type: 'scatter', data: rows, x: 'units', y: 'revenue', series: 'region', size: 'share' }), rows, ctx)
    const s = series(o)
    expect(s.map((x) => x.name)).toEqual(['North', 'South'])
    expect(s[0]!.data).toEqual([
      [10, 4, 0.2],
      [20, 5, 0.3],
    ])
    const size = s[1]!.symbolSize as (v: number[]) => number
    expect(size([30, 6, 0.5])).toBe(60)
    expect(() => chartOption(validate({ type: 'scatter', data: rows, x: 'q', y: 'revenue' }), rows, ctx)).toThrow('must be numeric')
  })

  it('bar and line are unchanged: one series per numeric column', () => {
    const o = chartOption(validate({ type: 'bar', data: rows, x: 'q' }), rows, ctx)
    expect(series(o).map((s) => s.name)).toEqual(['revenue', 'units', 'share'])
  })
})
