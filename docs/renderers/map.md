# `map` renderer

Places on a map: markers, regions, or both, over a street map. The body is
YAML (JSON works too).

````markdown
```map {@1}
center: [41.38, 2.17]
zoom: 12
markers: ./stores.geojson
labels: true
```
````

| Key | Type | Default | Meaning |
|---|---|---|---|
| `center` | `[lat, lng]` | fits the data | What the map is centred on. **Latitude first**, as in most map tools (41.38 N, 2.17 E is Barcelona) |
| `zoom` | number | fits the data | `0` shows the whole world, `12` a city, `16` a few streets, `19` a building. Fractions are fine |
| `markers` | path or list | — | Points: a `./file.geojson` of Point features, a `./file.csv`/`.tsv` with `lat` and `lng` columns, or rows written inline |
| `regions` | path | — | A `./file.geojson` of polygons, drawn as outlines, or coloured by `value` |
| `label` | property | `name` | Which column or property names each marker or region (tooltips, `labels`) |
| `size` | column | — | Sizes each marker by this number (a bubble map) |
| `value` | property | — | Colours each region by this number (a choropleth), from the theme's surface colour to its first chart colour |
| `labels` | boolean | `false` | Show marker names beside the markers |
| `tiles` | URL template or `none` | OpenStreetMap | Where the street map comes from, e.g. `https://tile.example.com/{z}/{x}/{y}.png` (`{s}` picks a subdomain a/b/c). `none` draws only your markers and regions |
| `attribution` | string | `© OpenStreetMap contributors` for the default tiles | Credit shown in the corner. Tile providers require it |
| `roam` | boolean | `true` | Drag to pan and scroll to zoom |

Give `center` and `zoom`, or leave either out and the map fits your markers
and regions. `markers` columns may be named `lat`/`latitude` and
`lng`/`lon`/`long`/`longitude`, in any case.

Inline markers:

```yaml
markers:
  - { name: Born, lat: 41.3851, lng: 2.1826 }
  - { name: Gràcia, lat: 41.4036, lng: 2.1564 }
```

**Look.** Markers use the theme's first chart colour. The street map is
recoloured by the theme's `--blitz-map-tiles` token (a CSS `filter`), so a
light street map sits naturally in a dark deck: aurora inverts it. Maps
render as SVG over image tiles, and stay sharp at any scale.

**Size.** Like a chart, a map fills the slide's width and is
`--blitz-block-height` tall. Set `height=` or `style=` on the fence to
change it.

**Moving the map.** Dragging and scrolling pan and zoom the map, and never
change the slide. Leaving the slide and coming back resets the view.

## Limits

- **The street map needs the network**, and so it's missing offline, even
  in a single-file (`--standalone`) build. Your markers and regions are
  inlined and always draw. For a map that works anywhere, use `regions` with
  `tiles: none`.
- **The default tiles are OpenStreetMap's**, which are free for light use
  under the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
  A talk is light use. For anything heavier (a deck on a busy website, say),
  set `tiles` to a provider you have an account with.
- In a PDF (`blitzstrahl export`), markers and regions stay vector
  graphics, and the tiles are images, as they loaded at export time.
