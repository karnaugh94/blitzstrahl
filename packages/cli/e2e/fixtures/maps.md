---
title: Maps fixture
transition: none
---

# Start

---

# Stores

```map {#stores}
center: [41.395, 2.175]
zoom: 13
markers: ./stores.geojson
labels: true
```

---

# Fitted

```map {#fitted}
markers: ./cities.csv
label: city
size: stores
```

---

# Regions

```map {#regions}
regions: ./regions.geojson
value: pop
tiles: none
```

---

# Swapped

```map {#swapped}
center: [141.38, 2.17]
zoom: 4
```
