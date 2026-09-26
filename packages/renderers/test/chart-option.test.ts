import { describe, expect, it } from 'vitest'
import { chartNotes, chartOption, validate } from '../src/chart-option.js'

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
    expect(pie!.radius).toEqual([0, '60%'])
    const bare = series(chartOption(validate({ type: 'pie', data: rows, x: 'region', y: 'revenue', labels: false }), rows, ctx))[0]!
    expect(bare.radius).toEqual([0, '74%'])
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

  it('numbers follow the deck language: labels, value axes, tooltips', () => {
    const big = [{ country: 'FR', cases: 11393 }, { country: 'DE', cases: 2500.5 }]
    type Fmt = (v: unknown) => string
    const parts = (o: Record<string, unknown>) => ({
      label: (series(o)[0] as unknown as { label: { formatter: (p: { value: unknown }) => string } }).label.formatter,
      axis: (o.yAxis as { axisLabel: { formatter: Fmt } }).axisLabel.formatter,
      tooltip: (o.tooltip as { valueFormatter: Fmt }).valueFormatter,
    })
    const en = parts(chartOption(validate({ type: 'bar', data: big, labels: true }), big, { ...ctx, locale: 'en' }))
    expect(en.label({ value: 11393 })).toBe('11,393')
    expect(en.axis(12000)).toBe('12,000')
    expect(en.tooltip(2500.5)).toBe('2,500.5')
    const de = parts(chartOption(validate({ type: 'bar', data: big, labels: true }), big, { ...ctx, locale: 'de' }))
    expect(de.label({ value: 11393 })).toBe('11.393')
    // A malformed `lang` falls back to the browser's locale rather than failing the chart.
    expect(() => chartOption(validate({ type: 'bar', data: big }), big, { ...ctx, locale: 'not a tag!' })).not.toThrow()
  })

  it('bar and line sum a category that repeats, as pie does, and say so', () => {
    const o = chartOption(validate({ type: 'bar', data: rows, x: 'region', y: 'revenue' }), rows, ctx)
    expect(series(o)[0]!.data).toEqual([9, 6]) // North 4 + 5; 1.0 showed 4
    expect(chartNotes(validate({ type: 'bar', data: rows, x: 'region', y: 'revenue' }), rows)).toEqual([
      '`region` repeats (North is on 2 rows), so each category shows the sum of its rows; set `series` to split them',
    ])
    expect(chartNotes(validate({ type: 'bar', data: rows, x: 'region', y: 'revenue', series: 'q' }), rows)).toEqual([])
    expect(chartNotes(validate({ type: 'pie', data: rows, x: 'region', y: 'revenue' }), rows)).toEqual([])
  })

  it('horizontal bars run top to bottom in data order', () => {
    const o = chartOption(validate({ type: 'bar', horizontal: true, data: rows, x: 'q', y: 'units' }), rows, ctx)
    expect(o.yAxis).toMatchObject({ type: 'category', data: ['Q1', 'Q2'], inverse: true })
    const v = chartOption(validate({ type: 'bar', data: rows, x: 'q', y: 'units' }), rows, ctx)
    expect((v.xAxis as { inverse?: boolean }).inverse).toBeUndefined()
  })

  it('bar and line are unchanged: one series per numeric column', () => {
    const o = chartOption(validate({ type: 'bar', data: rows, x: 'q' }), rows, ctx)
    expect(series(o).map((s) => s.name)).toEqual(['revenue', 'units', 'share'])
  })
})
