/**
 * `blitzstrahl/schema/*.json` (PLAN §15, M8.4; syntax.md §3.5), generated
 * from the tables the validators check by (core/schema.ts, and each
 * renderer's). Only the descriptions are written here: they're for editors,
 * and would only weigh down the pages. `schema.test.ts` writes the files
 * (`pnpm test -u`) and keeps them in step.
 */
import { DECK_RULES, DECK_SCHEMA, SLIDE_SCHEMA, type KeyTable, type Schema } from '@blitzstrahl/core/schema'
import { CHART_RULES, CHART_SCHEMA, EMBED_RULES, EMBED_SCHEMA, EMBED_SHORT, MAP_RULES, MAP_SCHEMA } from '@blitzstrahl/renderers/specs'

const DOCS = 'https://github.com/karnaugh94/blitzstrahl/blob/main/docs'

/** What each key means, as the docs' tables say it (one line, for a hover). */
const DESCRIPTIONS: Record<string, Record<string, string>> = {
  deck: {
    title: "The document's title. Default: the first slide's title",
    author: "The page's author (<meta name=\"author\">)",
    date: 'Free-form',
    lang: "BCP 47 language tag (default en): the audience's text, and how numbers are written and read",
    thousands: 'How numbers are written in the data, when not plainly: "." reads 1.200,5 as 1200.5',
    theme: 'aurora (default), broadsheet, a ./brand.css file, a package (acme finds blitzstrahl-theme-acme), or a ./path to a JS theme',
    canvas: 'Logical canvas size in CSS pixels, e.g. 1280x720 (the default)',
    transition: 'Default slide transition (default fade)',
    'transition-dur': 'Default transition duration, in milliseconds',
    public: 'A ./folder served and copied as it is: a demo page with its scripts, downloads',
    css: 'Stylesheets after the theme\'s: a ./file.css or a list, in order',
    footer: 'One line of inline markdown on every slide, bottom left by default',
    'slide-numbers': 'Number the slides: true shows 3, "{n} / {total}" shows 3 / 12',
    logo: 'An image on every slide, top right by default',
    duration: 'How long the talk should take (20min, 1h30min, 90s): the presenter view counts down and shows your pace',
    'pace-margin': 'How far behind the clock before the pace bar turns amber: 10% of the duration, or a time (2min). Default 5%',
    background: "Every slide's background: an image or a CSS background, or one per layout (title:, section:, default: for the rest). A slide's own wins",
    plugins: 'Plugin packages or ./paths, loaded in order',
  },
  slide: {
    id: "Overrides the slide's id, used in the URL (#results)",
    layout: 'Named layout. Default: default, and title for the first slide',
    transition: 'The transition that enters this slide',
    'transition-dur': 'Duration of that transition, in milliseconds',
    background: 'An image path or URL (covers the canvas), or any CSS background',
    class: "Space-separated classes on the slide's root",
    style: "Inline CSS on the slide's root",
    chrome: 'false: no footer, number or logo on this slide',
  },
  chart: {
    type: 'Chart type',
    data: './file.csv, ./file.tsv or ./file.json next to the deck, or rows written inline',
    x: 'Category axis; the slice names of a pie; the x axis of a scatter. Default: the first column',
    y: 'One series per column. Default: every other numeric column. A pie takes one',
    series: 'Long data: one series per distinct value of this column',
    stack: 'Bar and line: true stacks the series; a column name splits by it and stacks',
    horizontal: 'Bar: bars run left to right',
    smooth: 'Line: curved lines',
    area: 'Line: fill under lines',
    labels: 'Value labels on bars and points; names and percentages on slices (pie: default true)',
    legend: 'Show the legend (default: when there is more than one series)',
    title: 'Chart title',
    donut: 'Pie: a ring instead of a disc',
    size: 'Scatter: sizes each point by this numeric column (a bubble chart)',
    echarts: 'An ECharts option deep-merged over the generated one',
    thousands: "How this chart's data groups thousands, when not plainly. Default: the deck's",
    delimiter: "What separates a CSV's cells, when the header doesn't make it clear",
    time: 'Bar and line: x holds ISO dates, placed to scale on a time axis',
    aggregate: 'Bar, line and pie: how rows with the same x become one value (default sum)',
    sort: 'Bar and pie: order the categories by value',
    format: 'How numbers are shown: "0", "0.0", "0%", "0.0%" or compact',
    prefix: 'Written before every number shown, e.g. "€"',
    suffix: 'Written after every number shown, e.g. " t"',
  },
  map: {
    center: '[latitude, longitude] of the map\'s centre',
    zoom: 'Zoom level, from 0 (the world) to 19 (a building)',
    markers: 'A ./file (GeoJSON, CSV) or https:// URL, or a list of { lat, lng }',
    regions: 'A ./file.geojson or https:// URL of regions to draw',
    label: 'The property or column that names each marker or region',
    size: 'The numeric property or column that sizes each marker',
    value: 'The numeric property that colours each region',
    labels: 'Show the labels on the map',
    tiles: 'Street map: a provider (osm, …), a URL template with {z}, {x} and {y}, or none',
    attribution: "The tile provider's credit, shown on the map",
    roam: 'Let the audience pan and zoom',
    thousands: "How this map's data groups thousands, when not plainly. Default: the deck's",
    delimiter: "What separates a CSV's cells, when the header doesn't make it clear",
  },
  embed: {
    src: 'The page to show: an http:// or https:// URL',
    fallback: "An image shown instead when there's no network: a ./path or a URL",
    zoom: 'Scale the page, from 0.1 to 4: 0.75 shows it at 75 %',
    title: "The frame's accessible name. Default: the site's host",
  },
}

function properties(name: string, table: KeyTable): Record<string, Schema> {
  const text = DESCRIPTIONS[name]!
  const keys = Object.keys(table)
  const missing = keys.filter((k) => !text[k])
  const extra = Object.keys(text).filter((k) => !keys.includes(k))
  if (missing.length || extra.length) throw new Error(`schema ${name}: no description for ${missing.join(', ') || '-'}; described but not a key: ${extra.join(', ') || '-'}`)
  return Object.fromEntries(keys.map((k) => [k, { description: text[k]!, ...table[k]!.schema }]))
}

const header = (title: string, doc: string) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title,
  description: `See ${DOCS}/${doc}`,
})

/** Every schema the package ships, by file name (without `.json`). */
export function schemas(): Record<string, object> {
  const embed = { type: 'object', properties: properties('embed', EMBED_SCHEMA), additionalProperties: false, ...EMBED_RULES }
  return {
    // Frontmatter allows other keys: plugins add their own.
    deck: { ...header('blitzstrahl deck frontmatter', 'syntax.md#31-deck'), type: 'object', properties: properties('deck', DECK_SCHEMA), ...DECK_RULES },
    slide: { ...header('blitzstrahl slide frontmatter', 'syntax.md#32-slide'), type: 'object', properties: properties('slide', SLIDE_SCHEMA) },
    chart: { ...header('blitzstrahl chart block', 'renderers/chart.md'), type: 'object', properties: properties('chart', CHART_SCHEMA), additionalProperties: false, ...CHART_RULES },
    map: { ...header('blitzstrahl map block', 'renderers/map.md'), type: 'object', properties: properties('map', MAP_SCHEMA), additionalProperties: false, ...MAP_RULES },
    embed: { ...header('blitzstrahl embed block', 'renderers/embed.md'), anyOf: [EMBED_SHORT, embed] },
  }
}
