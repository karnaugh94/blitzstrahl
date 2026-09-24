# Tables

Tables are ordinary GFM tables. Give them attributes with a standalone
attribute block on the line after a blank line (syntax.md §4.2):

```markdown
| City | Stores | Revenue |
|---|--:|--:|
| Lisbon | 7 | $900k |
| Barcelona | 12 | $1.2M |

{.sortable .zebra @1 reveal=rows}
```

| Attribute | Effect |
|---|---|
| `.sortable` | Click a header to sort by that column: ascending, then descending, then back to the order you wrote |
| `.zebra` | Alternate rows are shaded |
| `reveal=rows` | Each body row is its own build step (syntax.md §6.4). The header comes with the table |
| `@n`, effects | The whole table enters at a step, like any block |

**Sorting.** Cells that read as numbers sort by value, and before text:
`1,200`, `-3.5%`, `$4.1M` and `900k` all count as numbers (`k`, `M` and `B`
scale). Text sorts naturally, so `item 2` comes before `item 10`. Empty cells
go last whichever way you sort. Rows glide to their new places, or jump
there under reduced motion.

A sorted table goes back to the order you wrote when you leave the slide, so
it looks the same every time you arrive at it. Sorting happens in the window
you click in. The presenter view's previews keep the written order.

Rows keep their build steps when you sort them: with `reveal=rows`, the row
you wrote first still appears first, wherever it is in the table.

Clicking a sortable table, including in the edge gutters, never changes the
slide. The table itself is part of the page, so it's shown without
JavaScript, in the overview and in PDFs, and the overflow check measures it.
