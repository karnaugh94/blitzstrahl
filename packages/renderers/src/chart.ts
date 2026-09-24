/**
 * The `chart` renderer (syntax.md §8; body schema in docs/renderers/chart.md).
 * M1: `bar` and `line`.
 *
 * ECharts via `echarts/core` with explicit component imports, so this chunk
 * carries only what charts use. SVG output stays sharp at any canvas scale.
 */
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import type { RenderCtx, RenderInstance, Renderer } from '@blitzstrahl/runtime'
import { distinct, parseData, pivot, rowsFrom, type Row } from './data.js'

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TitleComponent, TooltipComponent, SVGRenderer])

export interface ChartSpec {
  type: 'bar' | 'line'
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
  /** Escape hatch: an ECharts option deep-merged over the generated one. */
  echarts?: Record<string, unknown>
}

const TYPES = new Set(['bar', 'line'])
const KEYS = new Set(['type', 'data', 'x', 'y', 'series', 'stack', 'horizontal', 'smooth', 'area', 'labels', 'legend', 'title', 'echarts'])

export function validate(spec: unknown): ChartSpec {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('the block must be a YAML mapping')
  const s = spec as Record<string, unknown>
  for (const k of Object.keys(s)) if (!KEYS.has(k)) throw new Error(`unknown key \`${k}\``)
  if (!TYPES.has(String(s.type))) {
    throw new Error(s.type === undefined ? '`type` is required: bar or line' : `unsupported type \`${String(s.type)}\`: bar or line`)
  }
  if (s.data === undefined) throw new Error('`data` is required: a ./file.csv path or a list of rows')
  if (typeof s.data !== 'string') rowsFrom(s.data)
  return s as unknown as ChartSpec
}

/** Tokens → an ECharts theme, so charts share the deck's palette and type. */
function themeFrom(ctx: RenderCtx) {
  const t = (n: string, fallback: string) => ctx.token(`--blitz-${n}`) || fallback
  const fg = t('fg', '#222')
  const muted = t('fg-muted', '#666')
  const rule = t('rule', '#ddd')
  const font = t('font-sans', 'sans-serif')
  const palette = Array.from({ length: 8 }, (_, i) => ctx.token(`--blitz-chart-${i + 1}`)).filter(Boolean)
  const axis = {
    axisLine: { lineStyle: { color: rule } },
    axisTick: { show: false },
    axisLabel: { color: muted, fontSize: 18, fontFamily: font },
    splitLine: { lineStyle: { color: rule, type: 'dashed' } },
  }
  return {
    color: palette.length ? palette : undefined,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: font, color: fg },
    title: { textStyle: { color: fg, fontSize: 24, fontWeight: 600 } },
    legend: { textStyle: { color: muted, fontSize: 18 }, icon: 'roundRect', itemWidth: 14, itemHeight: 14 },
    tooltip: {
      backgroundColor: t('surface-2', '#fff'),
      borderColor: rule,
      textStyle: { color: fg, fontSize: 16, fontFamily: font },
    },
    categoryAxis: { ...axis, splitLine: { show: false } },
    valueAxis: { ...axis, axisLine: { show: false } },
    line: { symbolSize: 8, lineStyle: { width: 3 } },
  }
}

async function buildOption(spec: ChartSpec, ctx: RenderCtx) {
  const rows = typeof spec.data === 'string' ? parseData(spec.data, await ctx.loadAsset(spec.data)) : spec.data
  if (!rows.length) throw new Error('no rows in `data`')
  const columns = Object.keys(rows[0]!)
  const x = spec.x ?? columns[0]!
  if (!columns.includes(x)) throw new Error(`no column \`${x}\` (have: ${columns.join(', ')})`)
  const by = typeof spec.stack === 'string' ? spec.stack : spec.series
  const ys = spec.y === undefined ? columns.filter((c) => c !== x && c !== by && typeof rows[0]![c] === 'number') : [spec.y].flat()
  for (const y of ys) if (!columns.includes(y)) throw new Error(`no column \`${y}\` (have: ${columns.join(', ')})`)
  if (!ys.length) throw new Error('no numeric column to plot: set `y`')

  let categories: Array<string | number>
  let series: Array<{ name: string; data: Array<number | null> }>
  if (by) {
    if (!columns.includes(by)) throw new Error(`no column \`${by}\` (have: ${columns.join(', ')})`)
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
  const dur = ctx.block.anim?.dur ?? 900
  const categoryAxis = { type: 'category', data: categories, boundaryGap: spec.type === 'bar' }
  const valueAxis = { type: 'value' }

  const option: Record<string, unknown> = {
    animation: !ctx.reducedMotion,
    animationDuration: dur,
    animationEasing: 'cubicOut',
    animationDelay: (i: number) => i * Math.min(60, dur / Math.max(categories.length, 1) / 2),
    grid: { left: 8, right: 24, top: (spec.title ? 56 : 16) + (showLegend ? 44 : 0), bottom: 8, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
    tooltip: { trigger: 'axis', axisPointer: { type: spec.type === 'bar' ? 'shadow' : 'line' } },
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
      label: { show: spec.labels ?? false, position: stacked ? 'inside' : horizontal ? 'right' : 'top', fontSize: 16 },
      emphasis: { focus: 'series' },
    })),
  }
  if (spec.title) option.title = { text: spec.title, left: 0, top: 0 }
  return spec.echarts ? merge(option, spec.echarts) : option
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

/** One registered ECharts theme per distinct set of tokens. */
const themes = new Map<string, string>()

function themeName(ctx: RenderCtx): string {
  const theme = themeFrom(ctx)
  const key = JSON.stringify(theme)
  let name = themes.get(key)
  if (!name) {
    name = `blitz-${themes.size + 1}`
    echarts.registerTheme(name, theme)
    themes.set(key, name)
  }
  return name
}

const chart: Renderer = {
  async mount(el: HTMLElement, raw: unknown, ctx: RenderCtx): Promise<RenderInstance> {
    const spec = validate(raw)
    const option = await buildOption(spec, ctx)
    const instance = echarts.init(el, themeName(ctx), { renderer: 'svg' })
    instance.setOption(option)
    return {
      update() {},
      resize: () => instance.resize(),
      destroy: () => instance.dispose(),
    }
  },
}

export default chart
