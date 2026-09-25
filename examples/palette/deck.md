---
title: The full palette
author: blitzstrahl
transition: fade
---

# The full palette

Every kind of content blitzstrahl draws, in one deck.

::: notes
This deck is M3's exit check: it exports to PDF and to a single file.
:::

---

# Words, lists, emphasis

- Markdown in, **a deck** out {@+}
- [Highlights]{.highlight @+}, ~~strikes~~, `code` {@=}
- Links that don't change the slide: [blitzstrahl](https://example.com) {@+}

> A slide is a canvas, not a document.

---
layout: code
---

## Code, highlighted in theme colours

```ts
export function next(pos: Position, steps: StepCounts) {
  // One more press on this slide, or on to the next one.
  if (pos.step < (steps[pos.slide] ?? 0)) {
    return { slide: pos.slide, step: pos.step + 1 }
  }
  if (pos.slide < steps.length - 1) {
    return { slide: pos.slide + 1, step: 0 }
  }
  return undefined
}
```

---

# A table you can sort

| Store | City | Opened | Revenue |
|---|---|--:|--:|
| Born | Barcelona | 2019 | $1.2M |
| Gràcia | Barcelona | 2021 | $860k |
| Chiado | Lisbon | 2022 | $540k |
| Ribeira | Porto | 2023 | $310k |

{.sortable .zebra reveal=rows @1}

Click a header to sort. {.muted .small}

---

# Revenue by region

```chart {@1}
type: bar
data: ./sales.csv
x: quarter
y: revenue
stack: region
```

---
layout: two-col
---

# Shares and spread

::: left
```chart
type: pie
donut: true
data: ./sales.csv
x: region
y: revenue
```
:::

::: right
```chart
type: scatter
data: ./cities.csv
x: lng
y: lat
size: stores
```
:::

---

# Growth

```chart
type: line
smooth: true
area: true
data:
  - { quarter: Q1, target: 3.6, actual: 4.1 }
  - { quarter: Q2, target: 4.4, actual: 5.1 }
  - { quarter: Q3, target: 5.2, actual: 6.0 }
  - { quarter: Q4, target: 6.0, actual: 7.9 }
```

---

# Where the stores are

```map
center: [41.395, 2.175]
zoom: 13
markers: ./stores.geojson
labels: true
tiles: osm
```

---

# Across Iberia

```map
markers: ./cities.csv
label: city
size: stores
tiles: osm
```

---

# A live page

```embed
src: https://www.openstreetmap.org/export/embed.html?bbox=2.13%2C41.37%2C2.22%2C41.42&layer=mapnik
fallback: ./aurora.svg
title: OpenStreetMap, Barcelona
```

---
layout: image-right
---

# Pictures

Images are inlined into a standalone file, so they travel with it.

::: image
![aurora](./aurora.svg)
:::

---
layout: end
---

# That's the palette

One markdown file. {.muted}
