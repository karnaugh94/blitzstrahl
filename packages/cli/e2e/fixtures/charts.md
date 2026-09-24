---
title: Charts fixture
transition: none
---

# Pie

```chart {#pie}
type: pie
data:
  - { team: Core, people: 5 }
  - { team: Runtime, people: 3 }
  - { team: Design, people: 2 }
```

---

# Donut

```chart {#donut}
type: pie
donut: true
data:
  - { team: Core, people: 5 }
  - { team: Runtime, people: 3 }
```

---

# Scatter

```chart {#scatter}
type: scatter
x: units
y: revenue
series: region
size: share
data:
  - { region: North, units: 10, revenue: 4, share: 0.2 }
  - { region: South, units: 30, revenue: 6, share: 0.5 }
  - { region: North, units: 20, revenue: 5, share: 0.3 }
```

---

# Mistake

```chart {#bad}
type: bar
donut: true
data: [{ a: x, b: 1 }]
```
