---
title: Standalone fixture
transition: none
---

# One file

![logo](./shot.svg){#logo width=320}

::: notes
Say hello.
:::

---

# Chart

```chart {#chart}
type: bar
data: ./data.csv
```

---

# Table

| Name | N |
|---|--:|
| b | 2 |
| a | 1 |

{#table .sortable}

---

# Plain {#plain}

Nothing but text. `</script>` and `<!--` in code must not break the page.

```js
const s = '</script><!-- not a comment'
```
