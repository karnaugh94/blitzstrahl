# `chart` renderer

Bar, line, pie and scatter charts. The fence body is YAML (JSON works too). Attributes on the fence (`{@2 dur=600}`) follow syntax.md §4:
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
| `type` | `bar` \| `line` \| `pie` \| `scatter` | *required* | Chart type |
| `data` | path or list | *required* | `./file.csv`, `./file.tsv` or `./file.json` next to the deck, or rows written inline |
| `x` | column | first column | Category axis; the slice names of a pie; the numeric x axis of a scatter |
| `y` | column or list | every other numeric column | One series per column. A pie takes exactly one |
| `series` | column | — | Long data: one series per distinct value of this column (`y` must be a single column). Not for pies |
| `stack` | `true` or column | — | Bar and line. `true` stacks the series. A column name does what `series` does, and stacks |
| `horizontal` | boolean | `false` | Bar: bars run left to right |
| `smooth` | boolean | `false` | Line: curved lines |
| `area` | boolean | `false` | Line: fill under lines |
| `donut` | boolean | `false` | Pie: a ring instead of a disc |
| `size` | column | — | Scatter: sizes each point by this numeric column (a bubble chart) |
| `labels` | boolean | `false`; pie `true` | Value labels on bars and points; names and percentages on slices |
| `legend` | boolean | when >1 series; pie `false` | Show the legend |
| `title` | string | — | Chart title |
| `echarts` | mapping | — | Escape hatch: an ECharts option deep-merged over the generated one |

A key that doesn't apply to the chart's type (`donut` on a bar chart, say)
is an error, not silently ignored.

**Pie.** One slice per distinct value of `x`, sized by the sum of `y` over
its rows, so long data works as it is. Negative values are an error.

````markdown
```chart
type: pie
donut: true
data: ./headcount.csv
x: team
y: people
```
````

**Scatter.** One point per row, at (`x`, `y`). Both must be numeric; the
axes start near the data rather than at zero. With `series`, each group gets
its own colour; with several `y` columns, each column does.

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
