---
blitzstrahl: {{version}}
title: My talk
author: Your Name
theme: {{theme}}
lang: en
---

# My talk

A subtitle, if you like

::: notes
Presenter notes: only you see these. Press P for the presenter view.
:::

---

# One point at a time

- Each `{@+}` is one more press {@+}
- Press Space or the right arrow key for the next {@+}
- Take one away and the list builds faster {@+}

::: notes
The audience sees one bullet per press. Try `{.fade-up @+}` for a different entrance.
:::

---

# A chart from a CSV file

```chart {@1 alt="Actual against plan, quarter by quarter."}
type: bar
data: ./{{data}}
x: quarter
y: [plan, actual]
```

::: notes
Edit {{data}} and save: the chart updates. Chart keys are in docs/renderers/chart.md.
`alt=` is what a screen reader says for the chart.
:::

---
layout: two-col
---

# Two columns

::: left
**Before**

Slides written in a tool that fights you
:::

::: right {@1}
**After**

A markdown file, a live preview, and `blitzstrahl build`
:::

---
layout: end
---

# Thank you

Questions?
