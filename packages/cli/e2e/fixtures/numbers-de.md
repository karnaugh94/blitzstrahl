---
title: Zahlen
lang: de
thousands: "."
transition: none
---

# Zahlen

---

# Quoten {#quoten}

```chart {#quote}
type: bar
data: ./quoten.csv
x: Land
y: Quote
labels: true
format: "0.0"
suffix: " %"
```

---

# Verlauf {#verlauf}

```chart {#verlauf-chart}
type: line
time: true
data:
  - { monat: "2024-01", fälle: 3 }
  - { monat: "2024-03", fälle: 5 }
  - { monat: "2024-06", fälle: 4 }
```

---

# Tabelle {#tabelle}

| Land | Quote |
|---|--:|
| ES | 3,5 |
| PL | 1.234,5 |
| DE | 12,5 |
| FR | 2.000 |

{.sortable}

---

# Karte {#karte}

```map {#karte-map}
regions: ./regionen.geojson
value: pop
```
