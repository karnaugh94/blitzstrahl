---
title: PDF fixture
transition: none
---

# Title

---

# Steps

First {#first @1}

Second {#second @2}

[Stressed]{#stressed .highlight @1}

---

# Chart

```chart {#chart}
type: bar
data: ./data.csv
```

---

# Map

```map {#map}
center: [41.39, 2.17]
zoom: 12
markers:
  - { name: Here, lat: 41.39, lng: 2.17 }
```
