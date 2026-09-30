/**
 * The `map` renderer (docs/renderers/map.md). Tiles come from a route that
 * draws each tile's z/x/y, so nothing touches the network and alignment can
 * be checked to the pixel.
 */
import type { Server } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { buildAndServe } from './serve.js'

const here = dirname(fileURLToPath(import.meta.url))
let url = ''
let server: Server
const tileRequests: string[] = []

test.beforeAll(async () => {
  // The fixture has a broken block on purpose (the error shown in place is
  // under test), and `build` stops for errors unless forced (M6.6).
  ;({ url, server } = await buildAndServe(join(here, 'fixtures/maps.md'), { force: true }))
})

test.afterAll(() => server?.close())
test.use({ reducedMotion: 'reduce' })

test.beforeEach(async ({ page }) => {
  tileRequests.length = 0
  await page.route('https://tile.openstreetmap.org/**', (route) => {
    const [z, x, y] = new URL(route.request().url()).pathname.slice(1).replace('.png', '').split('/')
    tileRequests.push(`${z}/${x}/${y}`)
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#eef" stroke="#99a"/><text x="10" y="30" font-size="20">${z}/${x}/${y}</text></svg>`,
    })
  })
})

const open = async (page: Page, id: string) => {
  await page.goto(`${url}#/${id}`)
  await page.waitForFunction(() => window.blitz)
}

/** Screen position of `[lng, lat]` according to the tiles on screen. */
const onTiles = (page: Page, sel: string, lng: number, lat: number) =>
  page.evaluate(
    ({ sel, lng, lat }) => {
      const tiles = [...document.querySelectorAll<HTMLImageElement>(`${sel} .blitz-tile`)]
      const [z] = new URL(tiles[0]!.src).pathname.slice(1).split('/').map(Number)
      const n = 2 ** z!
      const φ = (lat * Math.PI) / 180
      const fx = ((lng + 180) / 360) * n
      const fy = ((1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2) * n
      const tile = tiles.find((t) => {
        const [, x, y] = new URL(t.src).pathname.slice(1).replace('.png', '').split('/').map(Number)
        return x === Math.floor(fx) && y === Math.floor(fy)
      })!
      const r = tile.getBoundingClientRect()
      const size = r.width * (256 / (256 + 0.5 * (r.width / tile.offsetWidth)))
      return { x: r.left + (fx % 1) * size, y: r.top + (fy % 1) * size }
    },
    { sel, lng, lat },
  )

/** Centres of the drawn markers (ECharts draws unit circles, scaled). */
const markers = (page: Page, sel: string) =>
  page.locator(`${sel} svg path[d^="M1 0A1 1"]`).evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }
    }),
  )

const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

test('markers sit exactly on the basemap, before and after panning and zooming', async ({ page }) => {
  await open(page, 'stores')
  await expect.poll(async () => (await markers(page, '#stores')).length).toBe(3)
  await expect(page.locator('#stores .blitz-tile').first()).toBeVisible()
  await expect(page.locator('#stores .blitz-map-attribution')).toHaveText('© OpenStreetMap contributors')
  const born = { lng: 2.1826, lat: 41.3851 }
  const closest = async () => {
    const want = await onTiles(page, '#stores', born.lng, born.lat)
    return Math.min(...(await markers(page, '#stores')).map((m) => near(m, want)))
  }
  expect(await closest()).toBeLessThan(1.5)
  expect(tileRequests.every((t) => t.startsWith('13/'))).toBe(true)

  // Drag the map: the tiles follow.
  const box = (await page.locator('#stores').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 180, box.y + box.height / 2 + 70, { steps: 6 })
  await page.mouse.up()
  expect(await closest()).toBeLessThan(1.5)

  // Zoom with the wheel: new tiles at a new zoom level, still aligned.
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -200)
  await expect.poll(() => page.locator('#stores .blitz-tile').first().getAttribute('src')).toMatch(/\/1[45]\//)
  expect(await closest()).toBeLessThan(1.5)
  expect(await page.evaluate(() => window.blitz!.pos)).toEqual({ slide: 1, step: 0 })
})

test('without center and zoom, the map fits the markers; size makes bubbles', async ({ page }) => {
  await open(page, 'fitted')
  await expect.poll(async () => (await markers(page, '#fitted')).length).toBe(4)
  const box = (await page.locator('#fitted').boundingBox())!
  const ms = await markers(page, '#fitted')
  for (const m of ms) {
    expect(m.x).toBeGreaterThan(box.x)
    expect(m.x).toBeLessThan(box.x + box.width)
    expect(m.y).toBeGreaterThan(box.y)
    expect(m.y).toBeLessThan(box.y + box.height)
  }
  const widths = ms.map((m) => m.w).sort((a, b) => a - b)
  expect(widths[3]! / widths[0]!).toBeGreaterThan(1.8)
  const barcelona = await onTiles(page, '#fitted', 2.17, 41.39)
  const biggest = ms.find((m) => m.w === widths[3])!
  expect(near(biggest, barcelona)).toBeLessThan(1.5)
})

test.describe('on a 2x screen', () => {
  test.use({ deviceScaleFactor: 2 })

  test('the street map loads the next zoom level, so it stays sharp, and markers stay on it', async ({ page }) => {
    await open(page, 'stores')
    await expect.poll(async () => (await markers(page, '#stores')).length).toBe(3)
    await expect(page.locator('#stores .blitz-tile').first()).toBeVisible()
    expect(tileRequests.length).toBeGreaterThan(0)
    expect(tileRequests.every((t) => t.startsWith('14/'))).toBe(true)
    const want = await onTiles(page, '#stores', 2.1826, 41.3851)
    expect(Math.min(...(await markers(page, '#stores')).map((m) => near(m, want)))).toBeLessThan(1.5)
  })
})

test('regions: a choropleth by `value`, with no tiles at all', async ({ page }) => {
  await open(page, 'regions')
  await page.locator('#regions svg').waitFor()
  await expect(page.locator('#regions .blitz-tile')).toHaveCount(0)
  await expect(page.locator('#regions .blitz-map-attribution')).toHaveCount(0)
  const fills = await page.locator('#regions svg path').evaluateAll((els) =>
    els.map((e) => e.getAttribute('fill')).filter((f) => f && f !== 'none' && f !== 'transparent'),
  )
  expect(new Set(fills).size).toBeGreaterThanOrEqual(2)
  expect(tileRequests).toEqual([])
})

test('a map names its street map: without `tiles` there is none, and no request', async ({ page }) => {
  await open(page, 'plain')
  await expect.poll(async () => (await page.locator('#plain svg path').count()) > 0).toBe(true)
  await expect(page.locator('#plain .blitz-tile')).toHaveCount(0)
  await expect(page.locator('#plain .blitz-map-attribution')).toHaveCount(0)
  expect(tileRequests).toEqual([])

  await open(page, 'stores')
  await expect(page.locator('#stores .blitz-map-attribution')).toHaveText('© OpenStreetMap contributors')
})

test('markers from a URL with no extension (an ArcGIS query), read by content', async ({ page }) => {
  const requests: string[] = []
  await page.route('https://geo.test/**', (route) => {
    requests.push(route.request().url())
    return route.fulfill({
      contentType: 'application/geo+json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { name: 'Born' }, geometry: { type: 'Point', coordinates: [2.1826, 41.3851] } },
          { type: 'Feature', properties: { name: 'Sants' }, geometry: { type: 'Point', coordinates: [2.1404, 41.3792] } },
        ],
      }),
    })
  })
  await open(page, 'remote')
  await expect(page.locator('#remote')).toContainText('Sants')
  expect(requests).toEqual(['https://geo.test/arcgis/rest/services/stores/FeatureServer/0/query?where=1%3D1&f=geojson&outSR=4326'])
})

test('a map mistake is explained in place', async ({ page }) => {
  await open(page, 'swapped')
  await expect(page.locator('#swapped .blitz-block-error')).toContainText('latitude comes first')
})
