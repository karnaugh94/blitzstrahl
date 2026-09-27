---
title: Europa in Zahlen
lang: de
thousands: "."
transition: fade
---

# Europa in Zahlen

Ein Beispiel in vielen Sprachen und mit deutschen Zahlen.

Alle Zahlen sind erfunden. {.small .muted}

::: notes
The European sample deck (PLAN §13): Polish, Czech, Greek and Bulgarian
text, German numbers. Every figure is invented.
:::

---

# Sprachen

- **Polski:** *Zażółć gęślą jaźń* — pchnąć w tę łódź jeża lub ośm skrzyń fig.
- **Čeština:** Příliš žluťoučký kůň úpěl ďábelské ódy.
- **Ελληνικά:** Ξεσκεπάζω την ψυχοφθόρα βδελυγμία.
- **Български:** Под южно дърво, цъфтящо в синьо, бягаше малко пухкаво зайче.
- **Magyar, Română:** Árvíztűrő tükörfúrógép · Șapte țânțari în câmpie.

Der Schlüssel heißt `radanteil_prozent`. {.small}

---

# Ελληνική επικεφαλίδα

Überschriften in einer Serifenschrift ohne griechische Buchstaben bleiben
trotzdem in einer mitgelieferten Schrift.

---

# Radverkehr {#radverkehr}

```chart {#rad}
type: bar
data: ./radverkehr.csv
x: Stadt
y: Radanteil
sort: desc
horizontal: true
labels: true
format: "0.0"
suffix: " %"
```

---

# Wege pro Tag {#wege}

| Stadt | Wege pro Tag | Radanteil |
|---|--:|--:|
| Kraków | 1.234.000 | 3,5 % |
| Praha | 987.500 | 2,8 % |
| Αθήνα | 1.450.250 | 1,9 % |
| Leipzig | 612.000 | 18,5 % |
| Utrecht | 455.800 | 42,1 % |

{.sortable #wege-tabelle}

---
layout: stat-grid
---

# Auf einen Blick {#blick}

::: stat
[42,1 %]{#spitze .count-up @1}

Radanteil in Utrecht
:::

::: stat
[1.450.250]{#athen .count-up @1}

Wege pro Tag in Αθήνα
:::
