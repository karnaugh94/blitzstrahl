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
| `delimiter` | `","`, `";"` or `"\t"` | from the header | What separates a CSV's cells, when the header doesn't make it clear |
| `thousands` | `","`, `"."` or `" "` | the deck's | Your data groups thousands with this mark, and uses the other one (or, for `" "`, a comma) as its decimal mark (see *Data*) |
| `x` | column | first column | Category axis; the slice names of a pie; the numeric x axis of a scatter |
| `time` | boolean | `false` | Bar and line: `x` holds dates, placed to scale on a time axis (see *Dates*) |
| `y` | column or list | every other numeric column | One series per column. A pie takes exactly one |
| `aggregate` | `sum`, `mean`, `min`, `max` or `count` | `sum` | Bar, line and pie: how rows with the same `x` (and `series`) become one value. `count` counts the rows and needs no `y` |
| `sort` | `asc` or `desc` | as in the data | Bar and pie: order the categories by value (by their total, with several series) |
| `series` | column | — | Long data: one series per distinct value of this column (`y` must be a single column). Not for pies |
| `stack` | `true` or column | — | Bar and line. `true` stacks the series. A column name does what `series` does, and stacks |
| `horizontal` | boolean | `false` | Bar: bars run left to right, categories top to bottom in the data's order |
| `smooth` | boolean | `false` | Line: curved lines |
| `area` | boolean | `false` | Line: fill under lines |
| `donut` | boolean | `false` | Pie: a ring instead of a disc |
| `size` | column | — | Scatter: sizes each point by this numeric column (a bubble chart) |
| `labels` | boolean | `false`; pie `true` | Value labels on bars and points; names and percentages on slices |
| `format` | `"0"`, `"0.0"`, `"0%"`, `"0.0%"`, `compact`, … | as written | How numbers are shown (see *Numbers*) |
| `prefix`, `suffix` | string | — | Written before or after every number shown: `prefix: "€"`, `suffix: " t"` |
| `legend` | boolean | when >1 series; pie `false` | Show the legend |
| `title` | string | — | Chart title |
| `echarts` | mapping | — | Escape hatch: an ECharts option deep-merged over the generated one |

A key that doesn't apply to the chart's type (`donut` on a bar chart, say)
is an error, not silently ignored.

**Repeated categories.** When `x` has the same value on several rows and
there's no `series`, a bar or line shows the sum of those rows, as a pie
does. `check` mentions it, in case you meant `series`; setting `aggregate`
says you meant it. `aggregate: mean` shows their average instead, and
`aggregate: count` how many rows there are:

````markdown
```chart
type: bar
data: ./stores.csv
x: country
aggregate: count
sort: desc
```
````

**Numbers.** Labels, value axes and tooltips write numbers the way the
deck's `lang` does: `11,393` in `en`, `11.393` in `de`. `format` sets how
many decimals, or another style:

| `format` | 0.425 in `en` | in `de` |
|---|---|---|
| `"0"` | 0 | 0 |
| `"0.0"` | 0.4 | 0,4 |
| `"0.00"` | 0.43 | 0,43 |
| `"0%"`, `"0.0%"` | 43%, 42.5% | 43 %, 42,5 % |
| `compact` | 12K, 1.3M (for 12000, 1250000) | 12.000, 1,3 Mio. |

The pattern always uses `.`, whatever the language: `"0.0"` means one
decimal. `%` formats read the data as fractions (0.425 is 42.5 %). If your
data is already in percent (42.5), use `suffix: " %"` instead. Pie
percentages follow `format` too, when it's a `%` one.

**Dates.** With `time: true`, `x` holds dates written the ISO way: `2024`,
`2024-03`, `2024-03-15`, or `2024-03-15T09:30`. They're placed to scale,
so a gap in the data shows as a gap, and the axis labels them in the deck's
language (`Mar 2024`, `März 2024`). A value that isn't such a date is an
error that names it. Without `time`, dates are categories, evenly spaced,
as written.

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

**Data.** CSV and TSV need a header row. A CSV separated by semicolons (as
Excel writes it where the comma is the decimal mark) is recognised by its
header; `delimiter` settles it when the header can't.

Write numbers in data plainly: a dot for decimals and nothing between the
thousands, so `1200`, `3.5`, `-0.25`, `2.000` (which is 2). This is the
same in every language. How numbers are *shown* follows the deck's `lang`
(see *Numbers*). How they're *written* in data never does.

A cell that's a number written some other way, such as `1,200`, `3,5` or
`1.234,5`, is an error naming its file and row, because reading it would be
a guess. If your data comes like that (a spreadsheet exported with German
or French settings, say), say which mark groups its thousands, on the chart
or once for the whole deck:

| `thousands` | Reads | as |
|---|---|---|
| `","` | `1,200.5` | 1200.5 |
| `"."` | `1.200,5`, `3,5` | 1200.5, 3.5 |
| `" "` | `1 200,5`, `3,5` | 1200.5, 3.5 |

Under `thousands`, groups must be of three: `12,25` under `thousands: ","`
is still an error. A group of plain digits (`1200`) is fine either way.

JSON must be a list of objects. Inline rows are the same shape:

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

**Screen readers** *(1.1)*. A chart is read as one image, described from
its data in the deck's language: its type, title, series and first values.
`alt=` on the fence says what it means instead, and the description
follows it (syntax.md §8.2).

**Errors.** Problems with the spec, such as an unknown key or a missing
column, show up in place of the chart and in the browser console.
