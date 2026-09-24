---
title: Markdown in, a deck worth watching out
author: blitzstrahl
---

# blitzstrahl

Markdown in. A deck worth watching out.

::: notes
Welcome. This whole deck is one markdown file — `examples/thin-slice/talk.md`.
Press → or Space to advance, ← to go back, F for fullscreen.
:::

---

# Why another deck tool?

- Markdown decks break silently {@+}
- Charts look pasted in from another document {@+}
- Build steps fight the tool instead of the story {@+}

So we started from the syntax, not the runtime. {.fade-up @+}

::: notes
Three complaints, one per click. Then the punchline.
:::

---

# Build steps are one sigil

```markdown
Revenue {@1}

[up 42%]{.pop @=}

Costs {@+}
```

Revenue {@1}

[up **42%**]{.pop @=}

Costs {@+}

[down 8%]{.pop @=}

---

# Revenue by region

```chart {@1 dur=900}
type: bar
data: ./sales.csv
x: quarter
y: revenue
stack: region
```

::: notes
Data comes from `sales.csv`, next to the markdown. Hover the bars: charts stay
interactive, and clicking them never flips the slide.
:::

---

# Growth, quarter by quarter

```chart {@1}
type: line
data:
  - { quarter: Q1, target: 3.6, actual: 4.1 }
  - { quarter: Q2, target: 4.4, actual: 5.1 }
  - { quarter: Q3, target: 5.2, actual: 6.0 }
  - { quarter: Q4, target: 6.0, actual: 7.9 }
x: quarter
y: [target, actual]
smooth: true
area: true
```

We beat target in **every** quarter. {.fade-up @+}

---

# The pipeline

1. Collect
2. Clean
3. Chart
4. Present

{reveal=items .fade-left @1}

Each item is its own step. [No manual numbering.]{.highlight @+}

---

# Numbers that move

::::: columns
::: {.center}
[1280]{.count-up .big @1}

logical pixels wide
:::
::: {.center}
[720]{.count-up .big @=}

tall, scaled to any screen
:::
:::::

::: notes
Nested containers take more colons on the outer one.
:::

---

# Where it goes next

| Milestone | Brings |
|---|---|
| M2 | Transitions, layouts, presenter mode |
| M3 | Maps, embeds, PDF export |
| M4 | Magic move, math, mermaid |

{.zebra reveal=rows @1}

---

# Thank you

Questions? {.fade-up @1}
