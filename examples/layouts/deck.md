---
title: Every layout
author: blitzstrahl
---

# Every layout

One deck, all twelve built-in layouts.

*blitzstrahl · aurora*

---
layout: section
---

# Part one

The structural layouts

---

# default

The layout every slide uses unless it asks for another. Content flows top to
bottom.

- One idea per slide
- Headings carry the argument
- Everything else supports it

---
layout: two-col
---

# two-col

::: left
### The argument

Markdown is the source of truth. The deck is a build artefact, like a binary.
:::

::: right {@1}
### The counter-argument

Some slides are pictures, and pictures don't diff well.
:::

---
layout: three-col
---

# three-col

::: left
### Parse
remark turns markdown into a syntax tree.
:::

::: middle
### Resolve
Steps, slots and blocks become the Deck IR.
:::

::: right
### Render
The runtime hydrates pre-rendered HTML.
:::

---
layout: quote
---

> Layouts are what make a deck look designed, more than colour.

The plan, §5

---
layout: stat-grid
---

# stat-grid

::: stat
12

built-in layouts
:::

::: stat
1280

logical pixels wide
:::

::: stat
0

overflowing slides
:::

---
layout: section
---

# Part two

Pictures and code

---
layout: image-left
---

::: image
![Aurora over hills](./aurora.svg)
:::

## image-left

The image fills its half of the canvas, edge to edge. The text sits beside
it.

---
layout: image-right
---

## image-right

The same, mirrored. The `image` slot can hold a chart too.

::: image
![Aurora over hills](./aurora.svg)
:::

---
layout: full-bleed
---

![Aurora over hills](./aurora.svg)

## full-bleed

The picture covers the whole canvas; everything else is overlaid on it.

---
layout: code
---

## code

```ts
export function next(pos: Position, steps: StepCounts) {
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
layout: end
---

# Thank you

github.com/you/your-talk
