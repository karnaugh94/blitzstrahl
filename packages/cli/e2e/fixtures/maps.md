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
tiles: osm
```

---

# Fitted

```map {#fitted}
markers: ./cities.csv
label: city
size: stores
tiles: osm
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

---

# Plain

```map {#plain}
markers:
  - { name: Born, lat: 41.3851, lng: 2.1826 }
  - { name: Gràcia, lat: 41.4036, lng: 2.1564 }
```

---

# Remote

```map {#remote}
markers: https://geo.test/arcgis/rest/services/stores/FeatureServer/0/query?where=1%3D1&f=geojson&outSR=4326
labels: true
```
