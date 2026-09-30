import { describe, expect, it } from 'vitest'
import { chartNotes, chartOption, timeAxis, validate } from '../src/chart-option.js'

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
      '`region` repeats (North is on 2 rows), so each category shows the sum of its rows; set `series` to split them, or `aggregate` to say how to combine them',
    ])
    expect(chartNotes(validate({ type: 'bar', data: rows, x: 'region', y: 'revenue', aggregate: 'sum' }), rows)).toEqual([])
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

  it('checks the 1.1 keys: which charts they fit, and their values', () => {
    expect(() => validate({ type: 'scatter', data: './x.csv', time: true })).toThrow('`time` applies to bar and line charts')
    expect(() => validate({ type: 'line', data: './x.csv', sort: 'asc' })).toThrow('`sort` applies to bar and pie charts')
    expect(() => validate({ type: 'scatter', data: './x.csv', aggregate: 'sum' })).toThrow('`aggregate` applies to bar, line and pie')
    expect(() => validate({ type: 'bar', data: './x.csv', aggregate: 'median' })).toThrow('`aggregate` must be one of sum, mean, min, max, count')
    expect(() => validate({ type: 'bar', data: './x.csv', thousands: "'" })).toThrow('`thousands` must be one of ",", ".", " "')
    expect(() => validate({ type: 'bar', data: './x.csv', delimiter: '|' })).toThrow('`delimiter` must be one of')
    expect(() => validate({ type: 'bar', data: './x.csv', format: '#,##0' })).toThrow('`format` must be')
    expect(() => validate({ type: 'bar', data: './x.csv', time: true, sort: 'asc' })).toThrow('date order')
    for (const format of ['0', '0.0', '0.000', '0%', '0.0%', 'compact']) expect(() => validate({ type: 'bar', data: './x.csv', format })).not.toThrow()
  })

  it('format, prefix and suffix write every number, in the deck language', () => {
    const d = [{ k: 'a', v: 0.425 }]
    const fmt = (spec: Record<string, unknown>, locale: string) => {
      const o = chartOption(validate({ type: 'bar', data: d, ...spec }), d, { ...ctx, locale })
      return (o.tooltip as { valueFormatter: (v: unknown) => string }).valueFormatter
    }
    expect(fmt({ format: '0.0' }, 'en')(0.425)).toBe('0.4')
    expect(fmt({ format: '0.00' }, 'de')(0.425)).toBe('0,43')
    expect(fmt({ format: '0.0%' }, 'en')(0.425)).toBe('42.5%')
    expect(fmt({ format: '0.0%' }, 'de')(0.425)).toBe('42,5\u00a0%')
    expect(fmt({ format: 'compact' }, 'en')(1250000)).toBe('1.3M')
    expect(fmt({ prefix: '€', format: '0' }, 'en')(1200)).toBe('€1,200')
    expect(fmt({ suffix: ' t' }, 'de')(2.5)).toBe('2,5 t')
  })

  it('aggregate: mean, count (with no y), and a pie of means', () => {
    const mean = chartOption(validate({ type: 'bar', data: rows, x: 'region', y: 'revenue', aggregate: 'mean' }), rows, ctx)
    expect(series(mean)[0]!.data).toEqual([4.5, 6])
    const count = chartOption(validate({ type: 'bar', data: rows, x: 'region', aggregate: 'count' }), rows, ctx)
    expect(series(count).map((s) => [s.name, s.data])).toEqual([['count', [2, 1]]])
    const byQ = chartOption(validate({ type: 'bar', data: rows, x: 'q', y: 'revenue', series: 'region', aggregate: 'max' }), rows, ctx)
    expect(series(byQ).map((s) => s.data)).toEqual([[4, 5], [6, null]])
    const pie = chartOption(validate({ type: 'pie', data: rows, x: 'region', y: 'revenue', aggregate: 'min' }), rows, ctx)
    expect(series(pie)[0]!.data).toEqual([{ name: 'North', value: 4 }, { name: 'South', value: 6 }])
  })

  it('sort orders bars by value (their total over series) and slices by size', () => {
    const d = [{ c: 'a', v: 2 }, { c: 'b', v: 9 }, { c: 'c', v: 5 }]
    const desc = chartOption(validate({ type: 'bar', data: d, sort: 'desc', horizontal: true }), d, ctx)
    expect((desc.yAxis as { data: unknown[] }).data).toEqual(['b', 'c', 'a'])
    expect(series(desc)[0]!.data).toEqual([9, 5, 2])
    const asc = chartOption(validate({ type: 'bar', data: rows, x: 'q', y: 'revenue', series: 'region', sort: 'asc' }), rows, ctx)
    expect((asc.xAxis as { data: unknown[] }).data).toEqual(['Q2', 'Q1']) // Q1 totals 10, Q2 5
    const pie = chartOption(validate({ type: 'pie', data: d, sort: 'asc' }), d, ctx)
    expect((series(pie)[0]!.data as Array<{ name: string }>).map((s) => s.name)).toEqual(['a', 'c', 'b'])
  })

  it('pie percentages are written in the deck language, to format\'s decimals', () => {
    const d = [{ c: 'a', v: 1 }, { c: 'b', v: 2 }]
    const label = (spec: Record<string, unknown>, locale: string) => {
      const o = chartOption(validate({ type: 'pie', data: d, ...spec }), d, { ...ctx, locale })
      return (series(o)[0] as unknown as { label: { formatter: (p: { name: string; percent: number }) => string } }).label.formatter({ name: 'a', percent: 33.33 })
    }
    expect(label({}, 'en')).toBe('a  33%')
    expect(label({}, 'de')).toBe('a  33\u00a0%')
    expect(label({ format: '0.0%' }, 'en')).toBe('a  33.3%')
  })

  it('time: ISO dates to scale, in date order, labelled in the deck language', () => {
    const d = [{ m: '2024-03', v: 1 }, { m: '2024-01', v: 2 }, { m: '2024-07', v: 3 }]
    const o = chartOption(validate({ type: 'line', data: d, time: true }), d, { ...ctx, locale: 'de' })
    const axis = o.xAxis as { type: string; axisLabel: { formatter: (t: number) => string } }
    expect(axis.type).toBe('time')
    expect(series(o)[0]!.data).toEqual([[Date.UTC(2024, 0), 2], [Date.UTC(2024, 2), 1], [Date.UTC(2024, 6), 3]])
    expect(axis.axisLabel.formatter(Date.UTC(2024, 2))).toBe('März 2024')
    expect(timeAxis([2024, 2025], 'en').label(Date.UTC(2025, 0))).toBe('2025') // CSV years arrive as numbers
    expect(timeAxis(['2024-03-15T09:30'], 'en').interval).toBe(60_000)
    expect(() => timeAxis(['2024-13'], 'en')).toThrow("`2024-13` isn't a date written the ISO way")
    expect(() => timeAxis(['03/2024'], 'en')).toThrow('ISO')
    expect(() => timeAxis(['2024-02-30'], 'en')).toThrow('ISO')
  })
})
