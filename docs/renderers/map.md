# `map` renderer

Places on a map: markers, regions, or both, over a street map. The body is
YAML (JSON works too).

````markdown
```map {@1}
center: [41.38, 2.17]
zoom: 12
markers: ./stores.geojson
labels: true
tiles: osm
```
````

| Key | Type | Default | Meaning |
|---|---|---|---|
| `center` | `[lat, lng]` | fits the data | What the map is centred on. **Latitude first**, as in most map tools (41.38 N, 2.17 E is Barcelona) |
| `zoom` | number | fits the data | `0` shows the whole world, `12` a city, `16` a few streets, `19` a building. Fractions are fine |
| `markers` | path, URL or list | — | Points: GeoJSON Point features, a list of rows as JSON, or a `.csv`/`.tsv` with `lat` and `lng` columns; from a `./file`, an `https://` URL, or rows written inline |
| `regions` | path or URL | — | GeoJSON polygons, from a `./file.geojson` or an `https://` URL, drawn as outlines, or coloured by `value` |
| `delimiter` | `","`, `";"` or `"\t"` | from the header | What separates the cells of a `markers` CSV, when the header doesn't make it clear |
| `thousands` | `","`, `"."` or `" "` | the deck's | How numbers in `markers` and `regions` are written, if not plainly (docs/renderers/chart.md, *Data*) |
| `label` | property | `name` | Which column or property names each marker or region (tooltips, `labels`) |
| `size` | column | — | Sizes each marker by this number (a bubble map) |
| `value` | property | — | Colours each region by this number (a choropleth), from the theme's surface colour to its first chart colour. The legend writes numbers in the deck's `lang` |
| `labels` | boolean | `false` | Show marker names beside the markers |
| `tiles` | provider, URL template or `none` | `none` | The street map under your data. **There is none unless you name one**: `osm` (OpenStreetMap), or any provider's URL template, e.g. `https://tile.example.com/{z}/{x}/{y}.png` (`{s}` picks a subdomain a/b/c; ArcGIS's `{z}/{y}/{x}` order works too) |
| `attribution` | string | the provider's, for `osm` | Credit shown in the corner. Tile providers require it, and `check` warns when a URL template has none |
| `roam` | boolean | `true` | Drag to pan and scroll to zoom |

**Street maps.** Maps are political, and whose streets and borders you
show is your call, so blitzstrahl doesn't pick a provider for you. Name one
with `tiles`: an organisation's own tile server, a commercial provider, or
`tiles: osm` for OpenStreetMap's public servers (free for light use, a talk
is light use, under the
[OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/)).
Without `tiles`, the map draws your markers and regions on the page's
background, and `check` mentions it.

**Data from a URL.** `markers` and `regions` can come from a web service,
e.g. an ArcGIS feature layer's `…/query?where=1%3D1&f=geojson`. The format
is read from the content, so a URL needn't end in `.geojson`. The server must
allow other pages to read it (CORS: `Access-Control-Allow-Origin: *`), or the
browser refuses; `check` fetches each URL and tells you. The data is fetched
when the slide is shown, so it's always current, and it needs the network
even in a standalone file. Save it as a `./file` to freeze it into the deck.

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
- **`tiles: osm` uses OpenStreetMap's public servers.** For anything
  heavier than a talk (a deck on a busy website, say), use a provider you
  have an account with.
- **Map data from a URL needs the network** too, and a server that allows
  CORS.
- In a PDF (`blitzstrahl export`), markers and regions stay vector
  graphics, and the tiles are images, as they loaded at export time.
