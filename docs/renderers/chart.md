# `chart` renderer

Bar and line charts (M1). More chart types arrive in M3. The fence body is YAML
(JSON works too). Attributes on the fence (`{@2 dur=600}`) follow syntax.md §4:
the chart mounts, and plays its entrance animation, when its step is reached.

````markdown
```chart {@1}
type: bar
data: ./sales.csv
x: quarter
y: revenue
stack: region
```
````

| Key | Type | Default | Meaning |
|---|---|---|---|
| `type` | `bar` \| `line` | *required* | Chart type |
| `data` | path or list | *required* | `./file.csv`, `./file.tsv` or `./file.json` next to the deck, or rows written inline |
| `x` | column | first column | Category axis |
| `y` | column or list | every other numeric column | One series per column |
| `series` | column | — | Long data: one series per distinct value of this column (`y` must be a single column) |
| `stack` | `true` or column | — | `true` stacks the series. A column name does what `series` does, and stacks |
| `horizontal` | boolean | `false` | Bars run left to right |
| `smooth` | boolean | `false` | Curved lines |
| `area` | boolean | `false` | Fill under lines |
| `labels` | boolean | `false` | Value labels on bars and points |
| `legend` | boolean | when >1 series | Show the legend |
| `title` | string | — | Chart title |
| `echarts` | mapping | — | Escape hatch: an ECharts option deep-merged over the generated one |

**Data.** CSV and TSV need a header row. Cells that look like numbers become
numbers (`1,200` is 1200). JSON must be a list of objects. Inline rows are the
same shape:

```yaml
data:
  - { quarter: Q1, target: 3.6, actual: 4.1 }
  - { quarter: Q2, target: 4.4, actual: 5.1 }
```

**Look.** Colours, type and gridlines come from the theme's tokens
(`--blitz-chart-1` … `--blitz-chart-8`, `--blitz-fg`, `--blitz-rule`, …), so a
chart always matches the deck. Charts render as SVG, so they're sharp at any
screen size, and they stay interactive: hovering shows values, and clicking a
chart never changes the slide.

**Size.** A chart fills the slide's width and is `--blitz-block-height` tall
(420px in aurora). Set `height=300` or `style="height: 300px"` on the fence to
change it.

**Errors.** Problems with the spec, such as an unknown key or a missing
column, show up in place of the chart and in the browser console.
