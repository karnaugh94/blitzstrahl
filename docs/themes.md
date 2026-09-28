# Themes

A deck picks its theme in frontmatter (`theme: aurora`). Writing a theme is
covered in `docs/plugins.md` §3. This page is the **token contract**: the
names a theme sets, which become CSS custom properties `--blitz-<name>`
and which everything else reads. Token names are stable from 1.0. New ones
may be added in minor versions, always with a default.

Built-in themes:

- **aurora**: dark, technical. Inter for text, JetBrains Mono for code,
  mint and periwinkle accents. The default.
- **broadsheet**: light, editorial. Newsprint paper, Newsreader serif, Inter
  for tables and captions, JetBrains Mono for code, a masthead rule, newspaper red. Its source
  (`packages/themes/src/broadsheet.ts`) uses only the public contract, so
  it's a good model for writing your own.

## Backgrounds by layout *(1.1)*

A theme sets backgrounds per layout with `[data-layout="…"]`:

```js
css: `[data-layout="section"] { background-image: url("./img/bg-section.png"); background-size: cover; }`,
```

Relative `url()`s in a theme's CSS are relative to the theme's file. The
files they name are copied into static builds, served by `dev` and inlined
in standalone files, as the deck's own images are. A missing one is an
error. A slide's background, first match wins:

1. the slide's own `background` key;
2. the deck's `background` key, for that layout or for every slide
   (docs/syntax.md §3.6);
3. the theme's CSS for the slide's layout;
4. the `bg` token.

## Fonts

The built-in themes ship every font they name, so a deck breaks its lines
the same way on every computer. The fonts are under the SIL Open Font
Licence, and their licences ship with them.

| Family | Themes | Scripts |
|---|---|---|
| Inter | aurora, broadsheet | Latin, Latin Extended, Greek, Cyrillic, Vietnamese, and symbols (arrows, ≠ ≤ ≥, ✓ ✗, ½); upright and italic |
| JetBrains Mono | aurora, broadsheet | Latin, Latin Extended, Greek, Cyrillic, Vietnamese; upright and italic |
| Newsreader | broadsheet | Latin, Latin Extended, Vietnamese; upright and italic |

Newsreader has no Greek or Cyrillic letters, so broadsheet sets those in
Inter, also where the rest of the heading is serif, and so are symbols.
JetBrains Mono has no symbols part: an arrow in code comes from the
presenting machine. Other scripts (Arabic,
Hebrew, Chinese, …) and emoji come from the presenting machine; `check`
warns about text no shipped font covers.

Each font is split by script. A browser downloads only the parts a slide
uses, and a standalone file carries only the parts its text uses: a deck in
English carries Inter's Latin part (48 kB) and nothing else of Inter.
Italics come along when something on the slides is italic, and the code
font when there's code.

## Required

Renderers read these from script (ECharts, Mermaid, maps), so they must be
real colours: a hex, `rgb()`, `hsl()` or a colour name, not a `var()` or
`color-mix()`.

| Token | Used for |
|---|---|
| `bg` | Slide background |
| `fg` | Text |
| `fg-muted` | Secondary text, axis labels, captions |
| `accent` | Emphasis, `h3`, links, focus rings, the pen |
| `chart-1` … `chart-8` | The chart palette: series colours in charts, map markers and regions, Mermaid nodes |

## Optional, with defaults

A default that names another token follows it, so a theme that sets `bg`
also moves `surface`. Colours read by renderers are marked ●. Their defaults
are plain `var()`s, which computed styles resolve to real colours.

| Token | Default | Used for |
|---|---|---|
| `surface` ● | `var(--blitz-bg)` | Cards, table stripes, chart tooltips, Mermaid nodes |
| `surface-2` ● | `var(--blitz-surface)` | A second surface level |
| `rule` ● | `var(--blitz-fg-muted)` | Lines: `hr`, table rules, chart grid lines |
| `accent-2` ● | `var(--blitz-accent)` | Secondary accent, gradients |
| `link` | `var(--blitz-accent)` | Links |
| `highlight` ● | `var(--blitz-surface-2)` | The `highlight` effect's marker |
| `bg-glow-1`, `bg-glow-2` | `transparent` | aurora's background glows |
| `letterbox` | `#000` | Around the canvas when the window's shape differs |
| `ink` ● | `var(--blitz-accent)` | The pen (`D`) |
| `laser` | `#ff3344` | The laser pointer (`L`) |
| `font-sans` ● | system UI stack (aurora and broadsheet: Inter) | Body text, charts |
| `font-serif` | Charter, Georgia, … | Display type in themes that use it |
| `font-mono` | `ui-monospace`, … (aurora and broadsheet: JetBrains Mono) | Code |
| `text` | `30px` | Body size |
| `text-small` ● | `22px` | Captions, tables, chart labels |
| `h1`, `h2`, `h3` | `60px`, `46px`, `34px` | Headings |
| `title` | `84px` | The title layout's heading |
| `pad-x`, `pad-y` | `88px`, `64px` | Slide padding (the layouts read these) |
| `gap` | `26px` | Space between blocks and columns |
| `radius` | `12px` | Corners: images, cards, code |
| `block-height` | `420px` | Default height of a render block |
| `transition-dur` | `550ms` | Slide transition duration, unless the deck sets one |
| `map-tiles` | `none` | CSS `filter` for map tiles, e.g. to darken them for a dark theme |
| `code-foreground` | `var(--blitz-fg)` | Code text |

## Syntax highlighting

`code-token-keyword`, `-string`, `-string-expression`, `-function`,
`-constant`, `-parameter`, `-punctuation`, `-comment` and `-link`. A theme
without them shows code in `code-foreground` only.

## Base styles

Every slide gets `color: var(--blitz-fg)`, `background-color:
var(--blitz-bg)` and body text in `text` / `font-sans`, before the theme's
own CSS. Render blocks get `width: 100%` and `height: var(--blitz-block-height)`
(in a column or beside an image, they fill the space left instead); a theme
can override either with `.blitz-slide [data-blitz-block]`. Layout geometry (where each slot of `two-col` sits) is shared by
all themes. Themes style the layouts through `[data-layout="…"]` and the
slot elements (syntax.md §10).
