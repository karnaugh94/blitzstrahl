---
title: The reading year
author: City Libraries
theme: broadsheet
transition: fade
---

# The reading year

What five branches lent, to whom, and what changed. An annual report.

City Libraries · Annual review {.small .muted}

::: notes
A made-up library network, to show the broadsheet theme: light, editorial,
serif. Every number here is invented.
:::

---
layout: stat-grid
---

# The year at a glance

::: stat
1.02M

loans, up 6% on last year
:::

::: stat
31%

of them digital, from 24%
:::

::: stat
5

branches, one of them new
:::

---

# Digital borrowing kept climbing

```chart {@1}
type: line
data: ./loans.csv
x: month
y: loans
series: format
smooth: true
```

Print dipped in summer, as it always does. Digital didn't. {@2 .fade-up}

---
layout: two-col
---

# Who came in

::: left
#### Visits by branch, thousands

```chart {@1}
type: bar
data: ./branches.csv
x: name
y: visits
horizontal: true
labels: true
```
:::

::: right
#### What the numbers hide

- Central carries two fifths of all visits {@2}
- Poblenou, open since March, passed Sants by July {@3}
- [Horta]{.highlight @4} is the one to watch: smallest, and growing fastest {@4}
:::

---
layout: quote
---

> I came for the Wi-Fi. I stayed for the history section.

A reader in Poblenou

---

# Five branches, one city

```map
markers: ./branches.csv
size: visits
labels: true
tiles: osm
```

---

# The most borrowed

| Title | Format | Loans |
|---|---|--:|
| The Shadow of the Wind | Print | 4,210 |
| A Year in Catalonia | Digital | 3,880 |
| Cooking Without Recipes | Print | 3,415 |
| The Quiet Harbour | Digital | 3,102 |
| Maps of Forgotten Streets | Print | 2,977 |

{.sortable .zebra reveal=rows @1}

Click a column to sort it. {.small .muted}

---
layout: end
---

# Next year: open late

Friday hours until ten, at every branch.
