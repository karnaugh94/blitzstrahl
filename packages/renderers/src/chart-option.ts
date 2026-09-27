/**
 * The `chart` spec (docs/renderers/chart.md) → an ECharts option. Pure: no
 * ECharts import and no DOM, so it's unit-tested directly, and `check` can
 * validate specs without a browser.
 */
import { THOUSANDS, type Thousands } from '@blitzstrahl/core/numbers'
import { AGGREGATES, aggregate, DELIMITERS, distinct, pivot, rowsFrom, type Aggregate, type Row } from './data.js'

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
  /** How this chart's data groups thousands, if not plainly (D3′). */
  thousands?: Thousands
  /** What separates a CSV's cells, when its header doesn't say. */
  delimiter?: string
  /** Bar and line: `x` holds ISO dates, on a time axis. */
  time?: boolean
  /** How rows that share a category become one value. */
  aggregate?: Aggregate
  /** Bar and pie: categories by value. */
  sort?: 'asc' | 'desc'
  /** `0`, `0.0`, `0%`, `0.0%`, … or `compact`. */
  format?: string
  prefix?: string
  suffix?: string
  /** Escape hatch: an ECharts option deep-merged over the generated one. */
  echarts?: Record<string, unknown>
}

const TYPES: readonly ChartType[] = ['bar', 'line', 'pie', 'scatter']
const KEYS = new Set(['type', 'data', 'x', 'y', 'series', 'stack', 'horizontal', 'smooth', 'area', 'labels', 'legend', 'title', 'donut', 'size', 'echarts', 'thousands', 'delimiter', 'time', 'aggregate', 'sort', 'format', 'prefix', 'suffix'])
/** Keys that only mean something for some chart types. */
const ONLY: Record<string, readonly ChartType[]> = {
  stack: ['bar', 'line'],
  horizontal: ['bar'],
  smooth: ['line'],
  area: ['line'],
  donut: ['pie'],
  size: ['scatter'],
  series: ['bar', 'line', 'scatter'],
  time: ['bar', 'line'],
  aggregate: ['bar', 'line', 'pie'],
  sort: ['bar', 'pie'],
}
/** `0`, `0.00`, `0%`, `0.0%`. */
const PATTERN = /^0(?:\.(0+))?(%?)$/

const quoted = (vs: readonly string[]) => vs.map((v) => JSON.stringify(v)).join(', ')

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
    if (s[k] !== undefined && !only.includes(type)) throw new Error(`\`${k}\` applies to ${only.slice(0, -1).join(', ')}${only.length > 1 ? ' and ' : ''}${only.at(-1)} charts, not ${type}`)
  }
  const oneOf = (k: string, values: readonly unknown[], shown = values.join(', ')) => {
    if (s[k] !== undefined && !values.includes(s[k])) throw new Error(`\`${k}\` must be one of ${shown}`)
  }
  oneOf('thousands', THOUSANDS, quoted(THOUSANDS))
  oneOf('delimiter', DELIMITERS, '",", ";", "\\t"')
  oneOf('aggregate', AGGREGATES)
  oneOf('sort', ['asc', 'desc'])
  for (const k of ['time', 'horizontal', 'smooth', 'area', 'labels', 'legend', 'donut']) oneOf(k, [true, false], 'true, false')
  for (const k of ['prefix', 'suffix']) if (s[k] !== undefined && typeof s[k] !== 'string') throw new Error(`\`${k}\` must be a string, e.g. "€"`)
  if (s.format !== undefined && !(s.format === 'compact' || (typeof s.format === 'string' && PATTERN.test(s.format)))) {
    throw new Error('`format` must be "0", "0.0", "0.00" (decimals), "0%", "0.0%" (a fraction as a percentage) or compact')
  }
  if (s.time && s.sort) throw new Error('a time axis is in date order: drop `sort`, or `time`')
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

/** `format` as `Intl` options: as written by default (up to ten decimals). */
function formatOptions(format: string | undefined): Intl.NumberFormatOptions {
  if (format === 'compact') return { notation: 'compact' }
  const m = format === undefined ? null : PATTERN.exec(format)
  if (!m) return { maximumFractionDigits: 10 }
  const digits = m[1]?.length ?? 0
  return { style: m[2] ? 'percent' : 'decimal', minimumFractionDigits: digits, maximumFractionDigits: digits }
}

function intl(locale: string | undefined, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(locale, options)
  } catch {
    return new Intl.NumberFormat(undefined, options)
  }
}

/**
 * Numbers as the deck's language writes them (`11,393` in `en`, `11.393`
 * in `de`), in the spec's `format`, between its `prefix` and `suffix`.
 */
function numberFormat(locale: string | undefined, spec: Pick<ChartSpec, 'format' | 'prefix' | 'suffix'> = {}): (v: unknown) => string {
  const nf = intl(locale, formatOptions(spec.format))
  return (v) => (typeof v === 'number' ? `${spec.prefix ?? ''}${nf.format(v)}${spec.suffix ?? ''}` : v == null ? '' : String(v))
}

/** A pie slice's share, in the language and, when `format` is a percentage, its decimals. */
function percentFormat(locale: string | undefined, format: string | undefined): (percent: number) => string {
  const m = format === undefined ? null : PATTERN.exec(format)
  const digits = m?.[2] ? (m[1]?.length ?? 0) : 0
  const nf = intl(locale, { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits })
  return (percent) => nf.format(percent / 100)
}

/**
 * Things worth saying about a chart that aren't problems: bars and lines
 * sum a category that repeats (a pie always does). Empty if nothing.
 */
export function chartNotes(spec: ChartSpec, rows: Row[]): string[] {
  if ((spec.type !== 'bar' && spec.type !== 'line') || spec.series || spec.aggregate || typeof spec.stack === 'string' || !rows.length) return []
  const x = spec.x ?? Object.keys(rows[0]!)[0]!
  const count = new Map<unknown, number>()
  for (const r of rows) count.set(r[x], (count.get(r[x]) ?? 0) + 1)
  const repeated = [...count].find(([, n]) => n > 1)
  if (!repeated) return []
  return [`\`${x}\` repeats (${String(repeated[0])} is on ${repeated[1]} rows), so each category shows the sum of its rows; set \`series\` to split them, or \`aggregate\` to say how to combine them`]
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
  // Counting rows needs no column to count; the series is named for what it counts.
  const counting = spec.aggregate === 'count' && spec.y === undefined
  const ys = counting ? [COUNT] : (spec.y === undefined ? columns.filter((c) => c !== x && c !== by && c !== spec.size && numeric(c)) : [spec.y].flat()).map(need)
  if (!ys.length) throw new Error('no numeric column to plot: set `y`')

  const num = numberFormat(ctx.locale, spec)
  const base: Record<string, unknown> = {
    animation: !ctx.reducedMotion,
    animationDuration: ctx.dur,
    animationEasing: 'cubicOut',
  }
  const option: Record<string, unknown> =
    spec.type === 'pie'
      ? pieOption(spec, rows, x, ys, base, num, ctx.locale)
      : spec.type === 'scatter'
        ? scatterOption(spec, rows, x, ys, by, base, need, num)
        : cartesianOption(spec, rows, x, ys, by, base, num, ctx.locale)
  if (spec.title) option.title = { text: spec.title, left: 0, top: 0 }
  return spec.echarts ? merge(option, spec.echarts) : option
}

type Format = (v: unknown) => string

/** The series `aggregate: count` makes when there's no `y`. */
const COUNT = 'count'

/** Categories ordered by `sort`: by their value, or their total over several series. Stable. */
function sortCategories<T extends { data: Array<number | null> }>(categories: Array<string | number>, series: T[], sort: 'asc' | 'desc'): { categories: Array<string | number>; series: T[] } {
  const total = (i: number) => series.reduce((a, s) => a + (s.data[i] ?? 0), 0)
  const order = categories.map((_, i) => i).sort((i, j) => (sort === 'asc' ? total(i) - total(j) : total(j) - total(i)) || i - j)
  return { categories: order.map((i) => categories[i]!), series: series.map((s) => ({ ...s, data: order.map((i) => s.data[i]!) })) }
}

function cartesianOption(spec: ChartSpec, rows: Row[], x: string, ys: string[], by: string | undefined, base: Record<string, unknown>, num: Format, locale: string | undefined) {
  let categories: Array<string | number>
  let series: Array<{ name: string; data: Array<number | null> }>
  if (by) {
    if (ys.length > 1) throw new Error('with `series`/`stack: <column>`, `y` must be a single column')
    ;({ categories, series } = pivot(rows, x, ys[0]!, by, spec.aggregate))
  } else {
    categories = distinct(rows, x)
    // A category written on several rows shows their sum (or `aggregate`), as a pie slice does.
    series = ys.map((y) => ({ name: y, data: categories.map((c) => aggregate(rows.filter((r) => r[x] === c).map((r) => r[y]), spec.aggregate)) }))
  }
  if (spec.sort) ({ categories, series } = sortCategories(categories, series, spec.sort))
  const time = spec.time ? timeAxis(categories, locale) : undefined

  const stacked = spec.stack !== undefined && spec.stack !== false
  const horizontal = spec.type === 'bar' && spec.horizontal === true
  const showLegend = spec.legend ?? series.length > 1
  const dur = base.animationDuration as number
  // Horizontal bars list categories top to bottom, in the data's order (ECharts starts at the bottom).
  const categoryAxis = time
    ? { type: 'time', minInterval: time.interval, axisLabel: { formatter: time.label, hideOverlap: true }, ...(horizontal ? { inverse: true } : {}) }
    : { type: 'category', data: categories, boundaryGap: spec.type === 'bar', ...(horizontal ? { inverse: true } : {}) }
  const valueAxis = { type: 'value', axisLabel: { formatter: num } }

  return {
    ...base,
    animationDelay: (i: number) => i * Math.min(60, dur / Math.max(categories.length, 1) / 2),
    grid: grid(spec, showLegend),
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: spec.type === 'bar' ? 'shadow' : 'line', ...(time ? { label: { formatter: (p: { value: number }) => time.label(p.value) } } : {}) },
      valueFormatter: num,
    },
    legend: { show: showLegend, top: spec.title ? 44 : 0, left: 0 },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series: series.map((s) => ({
      ...s,
      // On a time axis each point is [date, value], in date order.
      ...(time ? { data: categories.map((c, i) => [time.at(c), s.data[i]]).sort((a, b) => (a[0] as number) - (b[0] as number)) } : {}),
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

/** ISO dates: `2024`, `2024-03`, `2024-03-15`, `2024-03-15T09:30(:00)`. */
const ISO = /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?)?)?$/
const DAY = 86_400_000
/** Per precision: the shortest gap between ticks, and how a date is labelled. */
const PRECISION = [
  { interval: 365 * DAY, parts: { year: 'numeric' } },
  { interval: 28 * DAY, parts: { month: 'short', year: 'numeric' } },
  { interval: DAY, parts: { day: 'numeric', month: 'short', year: 'numeric' } },
  { interval: 60_000, parts: { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } },
] as const

/**
 * `time: true`: each category as a date (UTC), and labels in the deck's
 * language at the finest precision the data writes (`März 2024` for months).
 */
export function timeAxis(values: ReadonlyArray<string | number>, locale: string | undefined) {
  const at = new Map<string | number, number>()
  let precision = 0
  for (const v of values) {
    const m = ISO.exec(String(v))
    const [y, mo = 1, d = 1, h = 0, mi = 0, sec = 0] = (m?.slice(1) ?? []).map((p) => (p === undefined ? undefined : Number(p)))
    const t = m ? Date.UTC(y!, mo! - 1, d, h, mi, sec) : NaN
    const back = new Date(t)
    if (!m || back.getUTCMonth() !== mo! - 1 || back.getUTCDate() !== d) {
      throw new Error(`\`time\`: \`${String(v)}\` isn't a date written the ISO way (2024, 2024-03, 2024-03-15 or 2024-03-15T09:30)`)
    }
    precision = Math.max(precision, m[4] ? 3 : m[3] ? 2 : m[2] ? 1 : 0)
    at.set(v, t)
  }
  const { interval, parts } = PRECISION[precision]!
  let df: Intl.DateTimeFormat
  try {
    df = new Intl.DateTimeFormat(locale, { ...parts, timeZone: 'UTC' })
  } catch {
    df = new Intl.DateTimeFormat(undefined, { ...parts, timeZone: 'UTC' })
  }
  return { at: (v: string | number) => at.get(v)!, interval, label: (t: number) => df.format(t) }
}

function pieOption(spec: ChartSpec, rows: Row[], x: string, ys: string[], base: Record<string, unknown>, num: Format, locale: string | undefined) {
  if (ys.length > 1) throw new Error(`a pie shows one \`y\` column (found ${ys.join(', ')}): set \`y\``)
  const y = ys[0]!
  const data = distinct(rows, x).map((name) => ({
    name: String(name),
    value: aggregate(rows.filter((r) => r[x] === name).map((r) => r[y]), spec.aggregate) ?? 0,
  }))
  if (spec.sort) data.sort((a, b) => (spec.sort === 'asc' ? a.value - b.value : b.value - a.value))
  const percent = percentFormat(locale, spec.format)
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
        // Whole percents (or `format`'s), in the deck's language, and never cut off: a narrow column still reads.
        label: { show: labels, formatter: (p: { name: string; percent: number }) => `${p.name}  ${percent(p.percent)}`, fontSize: 18, overflow: 'none' },
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
