# Slide 1 is a title slide

No layout given, so `title`.

---
layout: two-col
---

# Two ways to read it

::: left
The argument.
:::

::: right {.muted @1}
The counter-argument, one step later.
:::

---

# Slots only fill at the top level {layout=three-col}

::: middle
Middle.
:::

:::: columns
::: left
Nested: an ordinary container, no warning.
:::
::::

---
layout: image-right
---

::: image
![A chart](./figure.png)
:::

::: image
Second fill of the same slot: an ordinary container.
:::

---

::: left
Default layout has no `left` slot.
:::

---
layout: two-col
---

::: left
Only named slots; the main slot is omitted.
:::

::: right
Right.
:::

---
layout: magazine
---

Unknown layout falls back to `default`.
