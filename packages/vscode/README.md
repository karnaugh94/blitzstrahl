# blitzstrahl for VS Code

Write a [blitzstrahl](https://github.com/karnaugh94/blitzstrahl) deck with
its preview beside you, its problems in the Problems panel, and its keys
completed as you type. Works in VS Code and VSCodium, from the
Marketplace or Open VSX.

The extension doesn't bring its own blitzstrahl: it runs **the one your
project installed** (`npm install --save-dev blitzstrahl`, 1.1 or later), so
the preview, the diagnostics and the PDF are exactly what your build gives.

## What it does

| | |
|---|---|
| **Preview** | `blitzstrahl: Preview Deck` (or the lightning bolt in the editor's title bar) opens the deck beside the markdown, on the dev server (`blitzstrahl dev`). Saving updates it in place, on the same slide and step. Moving the cursor into another slide shows that slide |
| **Problems** | `blitzstrahl check --offline` runs when a deck is opened and saved (or as you type: see *Checking as you type*), and its findings (errors, warnings, overflowing slides) appear in the Problems panel and under the text, at the line `check` names. A data file's problem is shown on the data file |
| **Completion** | Keys and values in the deck's frontmatter, a slide's frontmatter, and the body of a `chart`, `map` or `embed` block, with each key's description on hover |
| **Snippets** | Render blocks, containers, components and notes (below) |
| **Present** | `blitzstrahl: Present` runs `blitzstrahl present` in a terminal: the deck opens in your browser, and the terminal shows the phone remote's QR code |
| **Export PDF** | `blitzstrahl: Export PDF` asks which PDF (a page per slide, per step, or the handout with notes) and writes it next to the deck |
| **Check** | `blitzstrahl: Check` runs the full `check`, network included: embedded sites that refuse framing, map data URLs |

## Which files are decks

A markdown file is a deck, checked and with the preview button, when its
frontmatter says so:

```yaml
---
blitzstrahl: 1.1
title: Quarterly review
---
```

The value is the blitzstrahl the deck is written for ([syntax, §3.1](https://github.com/karnaugh94/blitzstrahl/blob/main/docs/syntax.md#31-deck));
`blitzstrahl new` writes it. Nothing else marks a deck: other markdown (a
README, a Marp deck, a site's page with its own `theme:`) is left alone.

A deck without the line still works with every command. The first time
you use one on it, the extension offers to add the line; say no and it
asks again next time rather than guessing.

## The preview

- It's the dev server's page in a panel, so everything works as in the
  browser: keys, clicks, charts, the overview (`O`), the dev panel's
  list of problems. Clicking a problem there opens the line in this
  window.
- The cursor leads, the preview follows: putting the cursor in a slide
  shows that slide, at its first step. Paging through the preview doesn't
  move the cursor. `blitzstrahl.preview.followCursor` turns following off.
- One dev server per previewed deck, on a free port (never one another
  server is using), started when the preview opens and stopped when it
  closes. It opens in its own panel, beside VS Code's Markdown preview or
  any HTML previewer, and replaces neither. **Open in Browser** (in the
  preview's title bar) opens the same page in your browser.
- For the talk itself use **Present**, not the preview: the presenter view
  (`P`) needs a browser window of its own.
- In a remote window (SSH, WSL, a container), the preview reaches the dev
  server through VS Code's port forwarding.

## Snippets

| Prefix | Inserts |
|---|---|
| `slide` | A separator and a new slide's heading |
| `chart` | A `chart` block: type, data, x, y |
| `map` | A `map` block |
| `embed` | An `embed` block |
| `mermaid` | A `mermaid` block |
| `math` | A display-math block |
| `notes` | `::: notes` … `:::` |
| `two-col` | A two-column slide: `layout: two-col`, `::: left`, `::: right` |
| `steps`, `timeline`, `cards`, `flow`, `compare`, `stats` | The component, with `as=` and sample items |
| `callout` | A callout container |

## Settings

| Setting | Default | |
|---|---|---|
| `blitzstrahl.check` | `onSave` | When to run `check --offline`: `onSave`, `onType` (a moment after you stop typing, on the unsaved text), or `off` |
| `blitzstrahl.preview.followCursor` | `true` | The preview shows the slide the cursor is in |
| `blitzstrahl.preview.where` | `beside` | `beside`: a panel next to the markdown. `browser`: your default browser, for those who prefer their own (the cursor isn't followed there, and the server stops when you close the deck) |
| `blitzstrahl.cliPath` | *(found)* | blitzstrahl's `bin.js`, if it isn't in the deck's `node_modules` |
| `blitzstrahl.nodePath` | *(VS Code's own)* | The Node that runs blitzstrahl (22 or later) |

**Finding blitzstrahl.** The extension looks for `node_modules/blitzstrahl`
from the deck's folder upwards. If there isn't one, it says so and offers
the install command; it never downloads blitzstrahl itself.

**Finding Node.** blitzstrahl needs Node 22 or later. The extension runs it
with the Node inside VS Code, so it works even when `node` isn't on the
`PATH` VS Code was started with (common with nvm). `blitzstrahl.nodePath`
chooses another.

## Checking as you type

With `blitzstrahl.check: onType`, the extension runs `check --stdin` half a
second after you stop typing, on the text in the editor, and drops a run
that a newer edit makes stale. It's the same `check`, so the same rules
as the build's. Each run measures overflow in a headless browser (about a
second on a 20-slide deck), which is why it isn't the default. The preview
still updates on save.

## What it doesn't do

- **Follow the preview with the cursor.** Only the other way round.
- Completion inside `{...}` attribute blocks (effects, `as=` values):
  not yet.

## Licence

EUPL-1.2, like blitzstrahl.
