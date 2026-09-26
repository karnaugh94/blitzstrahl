/**
 * The `chart` renderer (syntax.md §8; body schema in docs/renderers/chart.md):
 * bar, line, pie and scatter. The spec → option logic is in `chart-option.ts`.
 *
 * ECharts via `echarts/core` with explicit component imports, so this chunk
 * carries only what charts use. SVG output stays sharp at any canvas scale.
 */
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import type { RenderCtx, RenderInstance, Renderer } from '@blitzstrahl/runtime'
import { chartOption, validate, type ChartSpec } from './chart-option.js'
import { parseData } from './data.js'

export { validate, type ChartSpec }

echarts.use([BarChart, LineChart, PieChart, ScatterChart, GridComponent, LegendComponent, TitleComponent, TooltipComponent, SVGRenderer])

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
    nameTextStyle: { color: muted, fontSize: 18, fontFamily: font },
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
    pie: { label: { color: fg, fontFamily: font }, labelLine: { lineStyle: { color: muted } }, itemStyle: { borderColor: t('bg', '#fff') } },
  }
}

async function buildOption(spec: ChartSpec, el: HTMLElement, ctx: RenderCtx) {
  const rows = typeof spec.data === 'string' ? parseData(spec.data, await ctx.loadAsset(spec.data)) : spec.data
  // Numbers follow the deck's `lang` (on <html>, or an element's own `lang`).
  const locale = el.closest('[lang]')?.getAttribute('lang') || undefined
  return chartOption(spec, rows, { dur: ctx.block.anim?.dur ?? 900, reducedMotion: ctx.reducedMotion, locale })
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
    const option = await buildOption(spec, el, ctx)
    const instance = echarts.init(el, themeName(ctx), { renderer: 'svg' })
    const ready = new Promise<void>((resolve) => instance.on('finished', () => resolve()))
    instance.setOption(option)
    return {
      update() {},
      resize: () => instance.resize(),
      destroy: () => instance.dispose(),
      ready,
    }
  },
}

export default chart
