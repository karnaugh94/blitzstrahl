/**
 * The `chart` spec (docs/renderers/chart.md) → an ECharts option. Pure: no
 * ECharts import and no DOM, so it's unit-tested directly, and `check` can
 * validate specs without a browser.
 */
import { distinct, pivot, rowsFrom, type Row } from './data.js'

export type ChartType = 'bar' | 'line' | 'pie' | 'scatter'

export interface ChartSpec {
  type: ChartType
  data: string | Row[]
  x?: string
  y?: string | string[]
  /** Long data: one series per value of this column. */
  series?: string
  /** `true` stacks the series; a column name pivots by it *and* stacks. */
  stack?: boolean | string
  horizontal?: boolean
  smooth?: boolean
  area?: boolean
  labels?: boolean
  legend?: boolean
  title?: string
  /** Pie: a ring instead of a disc. */
  donut?: boolean
  /** Scatter: a numeric column that sizes each point (a bubble chart). */
  size?: string
  /** Escape hatch: an ECharts option deep-merged over the generated one. */
  echarts?: Record<string, unknown>
}

const TYPES: readonly ChartType[] = ['bar', 'line', 'pie', 'scatter']
const KEYS = new Set(['type', 'data', 'x', 'y', 'series', 'stack', 'horizontal', 'smooth', 'area', 'labels', 'legend', 'title', 'donut', 'size', 'echarts'])
/** Keys that only mean something for some chart types. */
const ONLY: Record<string, readonly ChartType[]> = {
  stack: ['bar', 'line'],
  horizontal: ['bar'],
  smooth: ['line'],
  area: ['line'],
  donut: ['pie'],
  size: ['scatter'],
  series: ['bar', 'line', 'scatter'],
}

/** Check a spec's shape (not its data). Throws a message fit for the author. */
export function validate(spec: unknown): ChartSpec {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('the block must be a YAML mapping')
  const s = spec as Record<string, unknown>
  for (const k of Object.keys(s)) if (!KEYS.has(k)) throw new Error(`unknown key \`${k}\``)
  const types = TYPES.join(', ')
  if (!TYPES.includes(s.type as ChartType)) {
    throw new Error(s.type === undefined ? `\`type\` is required: ${types}` : `unsupported type \`${String(s.type)}\`: use ${types}`)
  }
  const type = s.type as ChartType
  for (const [k, only] of Object.entries(ONLY)) {
    if (s[k] !== undefined && !only.includes(type)) throw new Error(`\`${k}\` applies to ${only.join(' and ')} charts, not ${type}`)
  }
  if (s.data === undefined) throw new Error('`data` is required: a ./file.csv path or a list of rows')
  if (typeof s.data !== 'string') rowsFrom(s.data)
  return s as unknown as ChartSpec
}

export interface OptionContext {
  /** Milliseconds for the entrance animation. */
  dur: number
  reducedMotion: boolean
  /** BCP 47 tag for number formatting (the deck's `lang`). Default: the browser's. */
  locale?: string | undefined
}

/** Numbers as the deck's language writes them: `11,393` in `en`, `11.393` in `de`. */
function numberFormat(locale: string | undefined): (v: unknown) => string {
  let nf: Intl.NumberFormat
  try {
    nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 10 })
  } catch {
    nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 10 })
  }
  return (v) => (typeof v === 'number' ? nf.format(v) : v == null ? '' : String(v))
}

/** Build the ECharts option for validated spec and loaded rows. */
export function chartOption(spec: ChartSpec, rows: Row[], ctx: OptionContext): Record<string, unknown> {
  if (!rows.length) throw new Error('no rows in `data`')
  const columns = Object.keys(rows[0]!)
  const need = (c: string) => {
    if (!columns.includes(c)) throw new Error(`no column \`${c}\` (have: ${columns.join(', ')})`)
    return c
  }
  const x = need(spec.x ?? columns[0]!)
  const by = typeof spec.stack === 'string' ? spec.stack : spec.series
  if (by) need(by)
  const numeric = (c: string) => rows.some((r) => typeof r[c] === 'number')
  const ys = (spec.y === undefined ? columns.filter((c) => c !== x && c !== by && c !== spec.size && numeric(c)) : [spec.y].flat()).map(need)
  if (!ys.length) throw new Error('no numeric column to plot: set `y`')

  const num = numberFormat(ctx.locale)
  const base: Record<string, unknown> = {
    animation: !ctx.reducedMotion,
    animationDuration: ctx.dur,
    animationEasing: 'cubicOut',
  }
  const option: Record<string, unknown> =
    spec.type === 'pie'
      ? pieOption(spec, rows, x, ys, base, num)
      : spec.type === 'scatter'
        ? scatterOption(spec, rows, x, ys, by, base, need, num)
        : cartesianOption(spec, rows, x, ys, by, base, num)
  if (spec.title) option.title = { text: spec.title, left: 0, top: 0 }
  return spec.echarts ? merge(option, spec.echarts) : option
}

type Format = (v: unknown) => string

function cartesianOption(spec: ChartSpec, rows: Row[], x: string, ys: string[], by: string | undefined, base: Record<string, unknown>, num: Format) {
  let categories: Array<string | number>
  let series: Array<{ name: string; data: Array<number | null> }>
  if (by) {
    if (ys.length > 1) throw new Error('with `series`/`stack: <column>`, `y` must be a single column')
    ;({ categories, series } = pivot(rows, x, ys[0]!, by))
  } else {
    categories = distinct(rows, x)
    series = ys.map((y) => ({
      name: y,
      data: categories.map((c) => {
        const v = rows.find((r) => r[x] === c)?.[y]
        return typeof v === 'number' ? v : null
      }),
    }))
  }

  const stacked = spec.stack !== undefined && spec.stack !== false
  const horizontal = spec.type === 'bar' && spec.horizontal === true
  const showLegend = spec.legend ?? series.length > 1
  const dur = base.animationDuration as number
  const categoryAxis = { type: 'category', data: categories, boundaryGap: spec.type === 'bar' }
  const valueAxis = { type: 'value', axisLabel: { formatter: num } }

  return {
    ...base,
    animationDelay: (i: number) => i * Math.min(60, dur / Math.max(categories.length, 1) / 2),
    grid: grid(spec, showLegend),
    tooltip: { trigger: 'axis', axisPointer: { type: spec.type === 'bar' ? 'shadow' : 'line' }, valueFormatter: num },
    legend: { show: showLegend, top: spec.title ? 44 : 0, left: 0 },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series: series.map((s) => ({
      ...s,
      type: spec.type,
      ...(stacked ? { stack: 'total' } : {}),
      ...(spec.type === 'line'
        ? { smooth: spec.smooth ?? false, showSymbol: categories.length <= 24, ...(spec.area ? { areaStyle: { opacity: 0.18 } } : {}) }
        : { barMaxWidth: 64, itemStyle: { borderRadius: stacked ? 0 : horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0] } }),
      label: { show: spec.labels ?? false, position: stacked ? 'inside' : horizontal ? 'right' : 'top', fontSize: 16, formatter: (p: { value: unknown }) => num(p.value) },
      emphasis: { focus: 'series' },
    })),
  }
}

function pieOption(spec: ChartSpec, rows: Row[], x: string, ys: string[], base: Record<string, unknown>, num: Format) {
  if (ys.length > 1) throw new Error(`a pie shows one \`y\` column (found ${ys.join(', ')}): set \`y\``)
  const y = ys[0]!
  const data = distinct(rows, x).map((name) => ({
    name: String(name),
    value: rows.filter((r) => r[x] === name).reduce((a, r) => a + (typeof r[y] === 'number' ? r[y] : 0), 0),
  }))
  if (data.some((d) => d.value < 0)) throw new Error(`a pie can't show negative values (column \`${y}\`)`)
  const showLegend = spec.legend ?? false
  const labels = spec.labels ?? true
  const top = (spec.title ? 56 : 0) + (showLegend ? 44 : 0)
  return {
    ...base,
    tooltip: { trigger: 'item', valueFormatter: num },
    legend: { show: showLegend, top: spec.title ? 44 : 0, left: 0 },
    series: [
      {
        type: 'pie',
        name: y,
        data,
        top,
        // Labels need room beside the pie, especially in a narrow column.
        radius: spec.donut ? [labels ? '38%' : '46%', labels ? '60%' : '74%'] : [0, labels ? '60%' : '74%'],
        center: ['50%', '52%'],
        startAngle: 90,
        padAngle: spec.donut ? 1.5 : 0,
        itemStyle: { borderRadius: spec.donut ? 6 : 0, borderWidth: spec.donut ? 0 : 2 },
        // Whole percents, and never cut off: a narrow column still reads.
        label: { show: labels, formatter: (p: { name: string; percent: number }) => `${p.name}  ${Math.round(p.percent)}%`, fontSize: 18, overflow: 'none' },
        labelLine: { show: labels, length: 14, length2: 18 },
        emphasis: { scaleSize: 6 },
      },
    ],
  }
}

function scatterOption(
  spec: ChartSpec,
  rows: Row[],
  x: string,
  ys: string[],
  by: string | undefined,
  base: Record<string, unknown>,
  need: (c: string) => string,
  num: Format,
) {
  if (!rows.every((r) => r[x] === null || typeof r[x] === 'number')) throw new Error(`a scatter's \`x\` must be numeric (column \`${x}\` has text)`)
  if (by && ys.length > 1) throw new Error('with `series`, `y` must be a single column')
  const size = spec.size === undefined ? undefined : need(spec.size)
  const maxSize = size ? Math.max(...rows.map((r) => (typeof r[size] === 'number' ? Math.abs(r[size]) : 0)), 1e-9) : 1
  const point = (r: Row, y: string) => [r[x], r[y], ...(size ? [r[size]] : [])]
  const groups: Array<{ name: string; data: unknown[] }> = by
    ? distinct(rows, by).map((g) => ({ name: String(g), data: rows.filter((r) => r[by] === g).map((r) => point(r, ys[0]!)) }))
    : ys.map((y) => ({ name: y, data: rows.map((r) => point(r, y)) }))
  const showLegend = spec.legend ?? groups.length > 1
  // Padded, so points at the extremes don't sit on the axes.
  const valueAxis = (name: string) => ({ type: 'value', name, nameLocation: 'middle', nameGap: 36, scale: true, boundaryGap: ['8%', '8%'], axisLabel: { formatter: num } })
  return {
    ...base,
    animationDelay: (i: number) => Math.min(i * 12, 600),
    grid: { ...grid(spec, showLegend), left: 40, bottom: 40 },
    tooltip: { trigger: 'item' },
    legend: { show: showLegend, top: spec.title ? 44 : 0, left: 0 },
    xAxis: { ...valueAxis(x), splitLine: { show: false } },
    yAxis: valueAxis(by || ys.length === 1 ? ys[0]! : ''),
    series: groups.map((g) => ({
      type: 'scatter',
      name: g.name,
      data: g.data,
      symbolSize: size
        ? (v: number[]) => 8 + 52 * Math.sqrt(Math.abs(Number(v[2]) || 0) / maxSize)
        : 14,
      itemStyle: { opacity: size ? 0.75 : 0.9 },
      label: { show: spec.labels ?? false, position: 'top', fontSize: 14, formatter: (p: { value: unknown[] }) => num(p.value[1]) },
      emphasis: { focus: 'series' },
    })),
  }
}

function grid(spec: ChartSpec, legend: boolean) {
  return { left: 8, right: 24, top: (spec.title ? 56 : 16) + (legend ? 44 : 0), bottom: 8, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' }
}

function merge(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out = { ...base }
  for (const [k, v] of Object.entries(over)) {
    const b = out[k]
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object' && !Array.isArray(b)
        ? merge(b as Record<string, unknown>, v as Record<string, unknown>)
        : v
  }
  return out
}
