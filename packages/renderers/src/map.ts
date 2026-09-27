/**
 * The `map` renderer (syntax.md §8; docs/renderers/map.md): markers and
 * regions drawn by ECharts' `geo` component on a web mercator projection,
 * over a basemap of raster tiles.
 *
 * ECharts has no tile layer, so the tiles are plain `<img>`s under the
 * chart. After every render and every pan or zoom, two known points are
 * converted to pixels (`convertToPixel`, public API) to find where the
 * projection put the world, and the tiles are laid out to match. That keeps
 * the basemap exactly under ECharts' own roam, without reaching into its
 * internals.
 *
 * Tiles need a tile server, so a map's basemap needs the network, even in a
 * standalone build. `tiles: none` draws only the deck's own data.
 */
import { MapChart, ScatterChart } from 'echarts/charts'
import { GeoComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import type { RenderCtx, RenderInstance, Renderer } from '@blitzstrahl/runtime'
import type { Row } from './data.js'
import {
  MAX_ZOOM,
  WORLD,
  asFeatureCollection,
  fitView,
  geometryPoints,
  markersFromRows,
  markersFromText,
  project,
  tileSource,
  tilesFor,
  unproject,
  validate,
  viewBounds,
  type FeatureCollection,
  type MapSpec,
  type Marker,
  type Placement,
} from './map-geo.js'

export { validate, type MapSpec } from './map-geo.js'

echarts.use([MapChart, ScatterChart, GeoComponent, TooltipComponent, VisualMapComponent, SVGRenderer])

/** Registered ECharts maps (GeoJSON), by content. */
const maps = new Map<string, string>()

function registerMap(fc: FeatureCollection): string {
  const key = JSON.stringify(fc)
  let name = maps.get(key)
  if (!name) {
    name = `blitz-map-${maps.size + 1}`
    echarts.registerMap(name, fc as never)
    maps.set(key, name)
  }
  return name
}

/**
 * For a basemap with markers only. ECharts' geo can't lay out a map with no
 * features, so this one has a single, invisible feature: the whole world.
 */
const WORLD_ONLY: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: '' },
      geometry: { type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] },
    },
  ],
}

async function loadJson(path: string, ctx: RenderCtx): Promise<unknown> {
  try {
    return JSON.parse(await ctx.loadAsset(path))
  } catch (err) {
    throw new Error(`\`${path}\` is not valid JSON: ${(err as Error).message}`)
  }
}

async function loadMarkers(spec: MapSpec, src: string | Row[], ctx: RenderCtx): Promise<Marker[]> {
  if (typeof src !== 'string') return markersFromRows(src, spec.label, spec.size)
  return markersFromText(src, await ctx.loadAsset(src), spec.label, spec.size, { read: (t) => ctx.number(t, spec.thousands), delimiter: spec.delimiter })
}

/** Name every region by `label`, so ECharts (which reads `name`) shows it. */
function named(fc: FeatureCollection, label: string): FeatureCollection {
  if (label === 'name') return fc
  return {
    ...fc,
    features: fc.features.map((f) => ({ ...f, properties: { ...f.properties, name: f.properties?.[label] ?? '' } })),
  }
}

function numberFormat(locale: string): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 10 })
  } catch {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 10 })
  }
}

/** Resolves once an image has loaded or failed. */
function settled(img: HTMLImageElement): Promise<void> {
  return new Promise((resolve) => {
    img.addEventListener('load', () => resolve(), { once: true })
    img.addEventListener('error', () => resolve(), { once: true })
  })
}

/** `#rrggbb` at an opacity (ECharts parses colours itself; `color-mix` isn't one it knows). */
function alpha(color: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color)
  if (!m) return color
  const n = parseInt(m[1]!, 16)
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

const map: Renderer = {
  async mount(el: HTMLElement, raw: unknown, ctx: RenderCtx): Promise<RenderInstance> {
    const spec = validate(raw)
    const doc = el.ownerDocument
    const t = (n: string, fallback: string) => ctx.token(`--blitz-${n}`) || fallback
    const legend = numberFormat(el.closest('[lang]')?.getAttribute('lang') || ctx.lang)

    const markers = spec.markers === undefined ? [] : await loadMarkers(spec, spec.markers, ctx)
    const regions = spec.regions === undefined ? undefined : named(asFeatureCollection(await loadJson(spec.regions, ctx), '`regions`'), spec.label ?? 'name')

    const tilesLayer = doc.createElement('div')
    tilesLayer.className = 'blitz-map-tiles'
    const chartEl = doc.createElement('div')
    chartEl.className = 'blitz-map-chart'
    el.append(tilesLayer, chartEl)
    const tiles = tileSource(spec)
    const template = tiles?.template
    if (template) {
      const credit = doc.createElement('div')
      credit.className = 'blitz-map-attribution'
      credit.textContent = tiles!.attribution
      if (credit.textContent) el.append(credit)
    }

    const width = el.clientWidth || 800
    const height = el.clientHeight || 450
    const points = [...markers.map((m) => m.at), ...(regions ? geometryPoints(regions) : [])]
    const view = fitView(points, width, height, spec)
    const accent = t('chart-1', '#3b82f6')
    const maxSize = Math.max(...markers.map((m) => Math.abs(m.size ?? 0)), 1e-9)
    const values = regions && spec.value ? regions.features.map((f) => Number(f.properties?.[spec.value!])).filter(Number.isFinite) : []

    const option: Record<string, unknown> = {
      animation: !ctx.reducedMotion,
      animationDuration: ctx.block.anim?.dur ?? 700,
      animationEasing: 'backOut',
      tooltip: {
        trigger: 'item',
        backgroundColor: t('surface-2', '#fff'),
        borderColor: t('rule', '#ddd'),
        textStyle: { color: t('fg', '#222'), fontSize: 16, fontFamily: t('font-sans', 'sans-serif') },
      },
      geo: {
        map: registerMap(regions ?? WORLD_ONLY),
        projection: { project, unproject },
        boundingCoords: viewBounds(view, width, height),
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        roam: spec.roam ?? true,
        // Relative to the first view: from the whole world to the tiles' limit.
        scaleLimit: { min: 2 ** (Math.min(0, 1 - view.zoom)), max: 2 ** (MAX_ZOOM - view.zoom) },
        silent: !regions,
        itemStyle: regions
          ? { areaColor: alpha(t('surface', '#eeeeee'), template ? 0.35 : 0.8), borderColor: t('fg-muted', '#888'), borderWidth: 1 }
          : { areaColor: 'transparent', borderWidth: 0 },
        emphasis: { itemStyle: { areaColor: t('highlight', accent) }, label: { show: false } },
        select: { disabled: true },
        label: { show: false },
      },
      series: [
        ...(values.length
          ? [
              {
                type: 'map',
                geoIndex: 0,
                data: regions!.features.map((f) => ({ name: String(f.properties?.name ?? ''), value: Number(f.properties?.[spec.value!]) })),
              },
            ]
          : []),
        ...(markers.length
          ? [
              {
                type: 'scatter',
                coordinateSystem: 'geo',
                data: markers.map((m) => ({ name: m.name, value: m.size === undefined ? m.at : [...m.at, m.size] })),
                symbolSize: spec.size ? (v: number[]) => 10 + 40 * Math.sqrt(Math.abs(Number(v[2]) || 0) / maxSize) : 18,
                itemStyle: { color: accent, borderColor: t('bg', '#fff'), borderWidth: 2, opacity: 0.95 },
                label: {
                  show: spec.labels ?? false,
                  formatter: '{b}',
                  position: 'right',
                  color: t('fg', '#222'),
                  fontSize: 18,
                  fontFamily: t('font-sans', 'sans-serif'),
                  textBorderColor: t('bg', '#fff'),
                  textBorderWidth: 3,
                },
                tooltip: { formatter: (p: { name: string; value: number[] }) => (spec.size ? `${p.name}: ${p.value[2]}` : p.name) || '·' },
                emphasis: { scale: 1.3 },
                zlevel: 1,
              },
            ]
          : []),
      ],
    }
    if (values.length) {
      option.visualMap = {
        type: 'continuous',
        min: Math.min(...values),
        max: Math.max(...values),
        seriesIndex: 0,
        inRange: { color: [t('surface-2', '#eef'), accent] },
        calculable: false,
        // The legend writes numbers in the deck's (or the block's) language.
        text: [legend.format(Math.max(...values)), legend.format(Math.min(...values))],
        left: 16,
        bottom: 16,
        textStyle: { color: t('fg-muted', '#666'), fontSize: 14 },
      }
    }

    const chart = echarts.init(chartEl, undefined, { renderer: 'svg' })
    const imgs = new Map<string, HTMLImageElement>()
    let pending: Promise<void>[] = []

    /** Where the projection put the world, from two known points. */
    const placement = (): Placement | undefined => {
      const a = chart.convertToPixel({ geoIndex: 0 }, unproject([0, 0])) as number[] | undefined
      const b = chart.convertToPixel({ geoIndex: 0 }, unproject([WORLD, WORLD])) as number[] | undefined
      if (!a || !b || !Number.isFinite(a[0]! + b[0]!)) return undefined
      const scale = (b[0]! - a[0]!) / WORLD
      return scale > 0 ? { scale, dx: a[0]!, dy: a[1]! } : undefined
    }

    const layTiles = () => {
      if (!template) return
      const p = placement()
      if (!p) return
      const want = tilesFor(p, chartEl.clientWidth, chartEl.clientHeight, template)
      const keep = new Set(want.map((w) => w.key))
      for (const [key, img] of imgs) {
        if (!keep.has(key)) {
          img.remove()
          imgs.delete(key)
        }
      }
      pending = []
      for (const w of want) {
        let img = imgs.get(w.key)
        if (!img) {
          img = doc.createElement('img')
          img.className = 'blitz-tile'
          img.alt = ''
          img.decoding = 'async'
          img.draggable = false
          img.src = w.url
          imgs.set(w.key, img)
          tilesLayer.append(img)
        }
        if (!img.complete) pending.push(settled(img))
        // Overlap by a hair so seams never show between scaled tiles.
        img.style.cssText = `left:${w.left}px;top:${w.top}px;width:${w.size + 0.5}px;height:${w.size + 0.5}px`
      }
    }

    // `finished` alone would do, but only once animations settle; `georoam`
    // keeps the tiles under the map while it moves.
    chart.on('georoam', layTiles)
    chart.on('finished', layTiles)
    const rendered = new Promise<void>((resolve) => chart.on('finished', () => resolve()))
    chart.setOption(option)
    layTiles()

    return {
      update() {},
      resize() {
        chart.resize()
        layTiles()
      },
      destroy() {
        chart.dispose()
        el.replaceChildren()
      },
      /** Rendered, and the tiles it shows have loaded (or failed). */
      get ready() {
        return rendered.then(() => Promise.all(pending)).then(() => undefined)
      },
    }
  },
}

export default map
