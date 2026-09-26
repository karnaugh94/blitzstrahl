/**
 * The `map` spec and the geometry behind it: web mercator, fitting a view to
 * the data, which tiles cover a view, and reading markers from rows or
 * GeoJSON. Pure (no ECharts, no DOM), so it's unit-tested directly and
 * `check` can validate specs without a browser.
 */
import { delimiterOf, parseDelimited, rowsFrom, type Row } from './data.js'

/** Web mercator's limit: the square world stops here. */
const MAX_LAT = 85.0511287798

/** Side of the whole world in "world units" (zoom-0 pixels): one 256px tile. */
export const WORLD = 256

export interface MapSpec {
  /** `[lat, lng]`. */
  center?: [number, number]
  zoom?: number
  /** A file or `https://` URL: GeoJSON Points, rows as JSON, or CSV/TSV with lat/lng columns. Or inline rows. */
  markers?: string | Row[]
  /** A file or `https://` URL of GeoJSON polygons: outlines, or a choropleth with `value`. */
  regions?: string
  /** Marker or region property with each one's name. Default `name`. */
  label?: string
  /** Numeric marker column that sizes each marker. */
  size?: string
  /** Numeric region property that colours each region. */
  value?: string
  /** Show marker names beside them. */
  labels?: boolean
  /** A tile URL template with `{z}`, `{x}`, `{y}` (and optional `{s}`), a preset (`osm`), or `none` (the default). */
  tiles?: string
  attribution?: string
  /** Pan and zoom with the pointer. */
  roam?: boolean
}

export const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors'
export const MAX_ZOOM = 19

/** Tile providers by name. A deck opts in: there's no default street map (docs/renderers/map.md). */
export const TILE_PRESETS: Readonly<Record<string, { template: string; attribution: string }>> = {
  osm: { template: OSM_TILES, attribution: OSM_ATTRIBUTION },
}

/** The street map a spec asks for, if any, with its credit. */
export function tileSource(s: MapSpec): { template: string; attribution: string } | undefined {
  if (s.tiles === undefined || s.tiles === 'none') return undefined
  const preset = Object.hasOwn(TILE_PRESETS, s.tiles) ? TILE_PRESETS[s.tiles] : undefined
  return { template: preset?.template ?? s.tiles, attribution: s.attribution ?? preset?.attribution ?? '' }
}

export const isUrl = (s: string): boolean => /^https?:\/\//i.test(s)

/**
 * Markers from a file's or a URL's text. JSON (GeoJSON, or a list of rows)
 * is recognised by its content, since a URL often has no extension (an
 * ArcGIS `query?f=geojson`); anything else is CSV, or TSV by extension.
 */
export function markersFromText(src: string, text: string, label?: string, size?: string): Marker[] {
  const t = text.trimStart()
  if (t.startsWith('{') || t.startsWith('[')) {
    let value: unknown
    try {
      value = JSON.parse(t)
    } catch (err) {
      throw new Error(`\`${src}\` is not valid JSON: ${(err as Error).message}`)
    }
    if (Array.isArray(value)) return markersFromRows(rowsFrom(value, `\`${src}\``), label, size)
    return markersFromGeoJson(asFeatureCollection(value, '`markers`'), label, size)
  }
  const tsv = /\.tsv$/i.test(src.replace(/[?#].*$/, ''))
  return markersFromRows(parseDelimited(text, tsv ? '\t' : delimiterOf(text)), label, size)
}

const KEYS = new Set(['center', 'zoom', 'markers', 'regions', 'label', 'size', 'value', 'labels', 'tiles', 'attribution', 'roam'])

export function validate(spec: unknown): MapSpec {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('the block must be a YAML mapping')
  const s = spec as Record<string, unknown>
  for (const k of Object.keys(s)) if (!KEYS.has(k)) throw new Error(`unknown key \`${k}\``)
  if (s.center !== undefined) {
    const c = s.center
    if (!Array.isArray(c) || c.length !== 2 || !c.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      throw new Error('`center` must be `[latitude, longitude]`, e.g. [41.38, 2.17]')
    }
    if (Math.abs(c[0]) > 90 || Math.abs(c[1]) > 180) {
      throw new Error(`\`center\` [${c.join(', ')}] is off the globe: latitude comes first, then longitude`)
    }
  }
  if (s.zoom !== undefined && !(typeof s.zoom === 'number' && s.zoom >= 0 && s.zoom <= MAX_ZOOM)) {
    throw new Error(`\`zoom\` must be a number from 0 (the world) to ${MAX_ZOOM} (a building)`)
  }
  if (s.markers !== undefined && typeof s.markers !== 'string' && !Array.isArray(s.markers)) {
    throw new Error('`markers` must be a ./file (GeoJSON, CSV) or an https:// URL, or a list of { lat, lng }')
  }
  if (s.regions !== undefined && typeof s.regions !== 'string') throw new Error('`regions` must be a ./file.geojson or an https:// URL')
  for (const k of ['label', 'size', 'value', 'tiles', 'attribution'] as const) {
    if (s[k] !== undefined && typeof s[k] !== 'string') throw new Error(`\`${k}\` must be text`)
  }
  for (const k of ['labels', 'roam'] as const) {
    if (s[k] !== undefined && typeof s[k] !== 'boolean') throw new Error(`\`${k}\` must be true or false`)
  }
  if (s.value !== undefined && s.regions === undefined) throw new Error('`value` colours `regions`: add a regions file')
  if (s.size !== undefined && s.markers === undefined) throw new Error('`size` sizes `markers`: add markers')
  if (typeof s.tiles === 'string' && s.tiles !== 'none' && !Object.hasOwn(TILE_PRESETS, s.tiles) && !/\{z\}/.test(s.tiles)) {
    throw new Error(`\`tiles\` must be a URL template with {z}, {x} and {y}, a provider (${Object.keys(TILE_PRESETS).join(', ')}), or \`none\``)
  }
  if (s.center === undefined && s.markers === undefined && s.regions === undefined) {
    throw new Error('say where: give `center` and `zoom`, or `markers` or `regions` to fit the map to')
  }
  return s as MapSpec
}

/** `[lng, lat]` → world units, x right and y down. */
export function project([lng, lat]: readonly number[]): [number, number] {
  const φ = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat!)) * Math.PI) / 180
  return [((lng! + 180) / 360) * WORLD, ((1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2) * WORLD]
}

/** World units → `[lng, lat]`. */
export function unproject([x, y]: readonly number[]): [number, number] {
  const n = Math.PI - (2 * Math.PI * y!) / WORLD
  return [(x! / WORLD) * 360 - 180, (Math.atan(Math.sinh(n)) * 180) / Math.PI]
}

export interface View {
  /** `[lng, lat]`. */
  center: [number, number]
  zoom: number
}

/**
 * The view that shows `points` (`[lng, lat]`) in a `width`×`height` box with
 * a margin; `fallbackZoom` when there's only one point. Spec values win.
 */
export function fitView(points: ReadonlyArray<readonly number[]>, width: number, height: number, spec: Pick<MapSpec, 'center' | 'zoom'>): View {
  const given = spec.center ? ([spec.center[1], spec.center[0]] as [number, number]) : undefined
  if (given && spec.zoom !== undefined) return { center: given, zoom: spec.zoom }
  const xy = points.map(project)
  if (!xy.length) return { center: given ?? [0, 0], zoom: spec.zoom ?? 2 }
  const xs = xy.map((p) => p[0])
  const ys = xy.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const center = given ?? unproject([(x0 + x1) / 2, (y0 + y1) / 2])
  if (spec.zoom !== undefined) return { center, zoom: spec.zoom }
  // Around the centre, the data must fit on both sides of it.
  const [cx, cy] = project(center)
  const dx = 2 * Math.max(cx - x0, x1 - cx)
  const dy = 2 * Math.max(cy - y0, y1 - cy)
  const fit = Math.log2(Math.min((width * 0.8) / (dx || 1e-9), (height * 0.8) / (dy || 1e-9)))
  return { center, zoom: Math.max(0, Math.min(16, fit)) }
}

/** The `[lng, lat]` corners of a view in a box: `[[west, north], [east, south]]`. */
export function viewBounds(view: View, width: number, height: number): [[number, number], [number, number]] {
  const [cx, cy] = project(view.center)
  const k = 2 ** view.zoom
  return [unproject([cx - width / 2 / k, cy - height / 2 / k]), unproject([cx + width / 2 / k, cy + height / 2 / k])]
}

/** Where world units land in the box: `px = x * scale + dx`. */
export interface Placement {
  scale: number
  dx: number
  dy: number
}

export interface Tile {
  key: string
  url: string
  left: number
  top: number
  size: number
}

/** The tiles that cover a `width`×`height` box, and where each goes. */
export function tilesFor(p: Placement, width: number, height: number, template: string): Tile[] {
  const z = Math.max(0, Math.min(MAX_ZOOM, Math.round(Math.log2(p.scale))))
  const n = 2 ** z
  const size = (WORLD / n) * p.scale
  const tx0 = Math.floor(-p.dx / size)
  const tx1 = Math.ceil((width - p.dx) / size) - 1
  const ty0 = Math.max(0, Math.floor(-p.dy / size))
  const ty1 = Math.min(n - 1, Math.ceil((height - p.dy) / size) - 1)
  const out: Tile[] = []
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const x = ((tx % n) + n) % n
      const url = template
        .replace('{z}', String(z))
        .replace('{x}', String(x))
        .replace('{y}', String(ty))
        .replace('{s}', 'abc'[(x + ty) % 3]!)
      out.push({ key: `${z}/${tx}/${ty}`, url, left: p.dx + tx * size, top: p.dy + ty * size, size })
    }
  }
  return out
}

export interface Marker {
  name: string
  /** `[lng, lat]`. */
  at: [number, number]
  size?: number
}

const LAT = ['lat', 'latitude']
const LNG = ['lng', 'lon', 'long', 'longitude']

/** Markers from rows with lat/lng columns (CSV or inline YAML). */
export function markersFromRows(rows: Row[], label = 'name', size?: string): Marker[] {
  if (!rows.length) return []
  const cols = Object.keys(rows[0]!)
  const find = (names: string[]) => cols.find((c) => names.includes(c.toLowerCase()))
  const lat = find(LAT)
  const lng = find(LNG)
  if (!lat || !lng) throw new Error(`markers need \`lat\` and \`lng\` columns (have: ${cols.join(', ')})`)
  if (size && !cols.includes(size)) throw new Error(`no column \`${size}\` for \`size\` (have: ${cols.join(', ')})`)
  return rows.map((r, i) => {
    const at: [number, number] = [Number(r[lng]), Number(r[lat])]
    if (!at.every(Number.isFinite)) throw new Error(`marker ${i + 1} has no usable \`${lat}\`/\`${lng}\``)
    const m: Marker = { name: r[label] == null ? '' : String(r[label]), at }
    if (size) m.size = Number(r[size]) || 0
    return m
  })
}

interface Feature {
  type: 'Feature'
  geometry: { type: string; coordinates: unknown } | null
  properties: Record<string, unknown> | null
}

export interface FeatureCollection {
  type: 'FeatureCollection'
  features: Feature[]
}

export function asFeatureCollection(value: unknown, what: string): FeatureCollection {
  const v = value as { type?: unknown; features?: unknown }
  if (v?.type === 'Feature') return { type: 'FeatureCollection', features: [value as Feature] }
  if (v?.type !== 'FeatureCollection' || !Array.isArray(v.features)) throw new Error(`${what} must be a GeoJSON FeatureCollection`)
  return value as FeatureCollection
}

/** Markers from GeoJSON Point features; other geometry is skipped. */
export function markersFromGeoJson(fc: FeatureCollection, label = 'name', size?: string): Marker[] {
  const out: Marker[] = []
  for (const f of fc.features) {
    if (f.geometry?.type !== 'Point') continue
    const [lng, lat] = f.geometry.coordinates as number[]
    const props = f.properties ?? {}
    const m: Marker = { name: props[label] == null ? '' : String(props[label]), at: [Number(lng), Number(lat)] }
    if (size) m.size = Number(props[size]) || 0
    out.push(m)
  }
  if (!out.length) throw new Error('`markers` has no Point features')
  return out
}

/** Every `[lng, lat]` in a GeoJSON geometry, for fitting the view. */
export function geometryPoints(fc: FeatureCollection): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const walk = (c: unknown) => {
    if (Array.isArray(c) && typeof c[0] === 'number') out.push([c[0], c[1] as number])
    else if (Array.isArray(c)) c.forEach(walk)
  }
  for (const f of fc.features) walk(f.geometry?.coordinates)
  return out
}
