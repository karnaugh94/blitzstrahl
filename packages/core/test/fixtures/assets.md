---
title: Assets
---
background: url(./img/cover.jpg) center / cover
style: "--logo: url('./img/logo.svg')"
---

# Every file the page uses

![A chart](./img/chart.png) and [the report](./docs/report.pdf), [the data](./sales.csv),
[a remote page](https://example.org/x.pdf), [a slide](#/intro) and [the site root](/about).

![Referenced][ref]

[ref]: ./img/ref.png

---

# Raw HTML

<img src="./img/raw.png" srcset="./img/raw.png 1x, ./img/raw@2x.png 2x" alt="raw">

<video poster="./media/poster.jpg" controls><source src="./media/clip.mp4" type="video/mp4"></video>

<style>
.brand { background: url("./img/brand.png") no-repeat; }
@font-face { font-family: House; src: url(./fonts/house.woff2) format("woff2"); }
</style>

A styled paragraph. {style="background-image: url(./img/para.png)"}

---

# Blocks

```chart
type: bar
data: ./sales.csv
```

```embed
src: https://example.org
fallback: ./img/fallback.png
```
