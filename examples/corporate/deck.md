---
title: Kestrel Transit · Q3 network report
author: Network Planning
date: October 2026
theme: ./brand/brand.css
css: ./talk.css
background:
  quote: ./brand/img/layout-quote.png
footer: Kestrel Transit · Q3 2026 network report
slide-numbers: "{n} / {total}"
logo: ./brand/img/logo.png
---

Board meeting, October 2026 {.kicker}

# Q3 network report

Journeys, punctuality and what comes next

::: notes
The public corporate example (PLAN §15, M9.5). Kestrel Transit is a
fictional organisation: its template is made by scripts/potx.mjs, and its
theme by `blitzstrahl theme import kestrel.potx`. Every figure is invented.
:::

---

# Where we are

- Journeys are up on the quarter, after a quiet August
- Punctuality rose every week on both networks
- The eastern tram extension opens in November

{reveal=items}

---
layout: section
---

# Journeys

---

# Journeys by month

```chart
type: bar
data: ./ridership.csv
x: month
y: journeys
format: compact
labels: true
```

Source: ticket validations. {.source}

---
layout: two-col
---

# Punctuality

::: left
- Share of departures within three minutes of the timetable
- Trams gain from the new signal priority
- Buses gain from two new bus lanes
:::

::: right
```chart
type: line
data: ./punctuality.csv
x: week
y: [buses, trams]
suffix: " %"
echarts: { yAxis: { min: 85 } }
```
:::

---
layout: stat-grid
---

# The quarter in numbers

::: stat
12.5M

journeys
:::

::: stat
94.1 %

of buses on time in week 39
:::

::: stat
3

new night lines
:::

---
layout: quote
---

> The 14 now comes when the board says it will. That's all I wanted.

A passenger in Harbourside, September 2026

---
layout: section
---

# Next quarter

---

# What comes next

| When | What |
|---|---|
| November | The eastern tram extension opens |
| December | Contactless payment on every bus |
| January | The winter timetable, with later last trams |

---
layout: end
---

# Thank you

Questions to network.planning@kestrel.example
