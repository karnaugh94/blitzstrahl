import { describe, expect, it } from 'vitest'
import { fitView, markersFromGeoJson, markersFromRows, project, tilesFor, unproject, validate, viewBounds } from '../src/map-geo.js'

describe('map geometry', () => {
  it('projects web mercator: the world is one 256-unit tile', () => {
    expect(project([0, 0])).toEqual([128, 128])
    expect(project([-180, 85.0511287798])[0]).toBe(0)
    expect(project([-180, 85.0511287798])[1]).toBeCloseTo(0, 6)
    const [lng, lat] = unproject(project([2.17, 41.38]))
    expect(lng).toBeCloseTo(2.17, 9)
    expect(lat).toBeCloseTo(41.38, 9)
  })

  it('keeps center and zoom when given; center is [lat, lng]', () => {
    expect(fitView([], 800, 400, { center: [41.38, 2.17], zoom: 11 })).toEqual({ center: [2.17, 41.38], zoom: 11 })
  })

  it('fits the data with a margin when zoom is not given', () => {
    const pts = [
      [2.1, 41.3],
      [2.3, 41.5],
    ]
    const v = fitView(pts, 1000, 500, {})
    const [w, n] = viewBounds(v, 1000, 500)[0]
    const [e, s] = viewBounds(v, 1000, 500)[1]
    expect(w).toBeLessThan(2.1)
    expect(e).toBeGreaterThan(2.3)
    expect(n).toBeGreaterThan(41.5)
    expect(s).toBeLessThan(41.3)
    // Snug: the taller side of the data fills 80% of the box.
    const k = 2 ** v.zoom
    const dy = (project([2.1, 41.3])[1] - project([2.3, 41.5])[1]) * k
    expect(dy).toBeCloseTo(400, 0)
  })

  it('covers a box with tiles at the nearest zoom, wrapping x, clipping y', () => {
    const t = tilesFor({ scale: 1, dx: 0, dy: 0 }, 256, 256, 'https://t/{z}/{x}/{y}.png')
    expect(t).toEqual([{ key: '0/0/0', url: 'https://t/0/0/0.png', left: 0, top: 0, size: 256 }])
    // zoom ~2.4 → z2 tiles at 1.32x; the world starts 100px in, so the box
    // straddles the antimeridian and its left edge shows the far east (x = 3).
    const w = tilesFor({ scale: 2 ** 2.4, dx: 100, dy: -10 }, 700, 300, '{z}/{x}/{y}')
    expect(new Set(w.map((x) => x.url.split('/')[0]))).toEqual(new Set(['2']))
    expect(w[0]!.size).toBeCloseTo(64 * 2 ** 2.4)
    expect(w.map((x) => x.key)).toEqual(['2/-1/0', '2/0/0', '2/1/0'])
    expect(w.map((x) => x.url)).toEqual(['2/3/0', '2/0/0', '2/1/0'])
    expect(w[0]!.left).toBeCloseTo(100 - 64 * 2 ** 2.4)
  })

  it('reads markers from rows and from GeoJSON', () => {
    expect(markersFromRows([{ name: 'A', Latitude: 1, lon: 2, n: 5 }], 'name', 'n')).toEqual([{ name: 'A', at: [2, 1], size: 5 }])
    expect(() => markersFromRows([{ x: 1, y: 2 }])).toThrow('`lat` and `lng`')
    const fc = {
      type: 'FeatureCollection' as const,
      features: [
        { type: 'Feature' as const, properties: { title: 'Shop' }, geometry: { type: 'Point', coordinates: [2.17, 41.38] } },
        { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString', coordinates: [] } },
      ],
    }
    expect(markersFromGeoJson(fc, 'title')).toEqual([{ name: 'Shop', at: [2.17, 41.38] }])
  })

  it('validates, catching lat/lng swapped and a map with nowhere to look', () => {
    expect(() => validate({ center: [2.17, 141.38], zoom: 3 })).not.toThrow()
    expect(() => validate({ center: [141.38, 2.17], zoom: 3 })).toThrow('latitude comes first')
    expect(() => validate({ zoom: 3 })).toThrow('say where')
    expect(() => validate({ center: [0, 0], zoom: 25 })).toThrow('`zoom`')
    expect(() => validate({ center: [0, 0], tiles: 'https://x/a.png' })).toThrow('{z}')
    expect(() => validate({ center: [0, 0], value: 'pop' })).toThrow('add a regions file')
  })
})
