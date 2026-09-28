# Themes

A deck picks its theme in frontmatter: a built-in one (`theme: aurora`),
or your own, written as a CSS file (`theme: ./brand.css`). This page says
how to write one, and lists the **tokens**: the names a theme sets, which
become CSS custom properties `--blitz-<name>` and which everything else
reads (charts, maps, diagrams, the layouts). Token names are stable from
1.0. New ones may be added in minor versions, always with a default. A
theme can also be a JS module (docs/plugins.md §3).

Built-in themes:

- **aurora**: dark, technical. Inter for text, JetBrains Mono for code,
  mint and periwinkle accents. The default.
- **broadsheet**: light, editorial. Newsprint paper, Newsreader serif, Inter
  for tables and captions, JetBrains Mono for code, a masthead rule, newspaper red. Its source
  (`packages/themes/src/broadsheet.ts`) uses only the public contract, so
  it's a good model for writing your own.

## A theme in CSS *(1.1)*

A theme is a stylesheet. Tokens go in `:root`, and everything else is
ordinary CSS for the slides:

```css
/* brand.css */
@font-face {
  font-family: "Acme Sans";
  src: url("./fonts/acme-sans.woff2") format("woff2");
  font-weight: 300 800;
}

:root {
  --blitz-bg: #ffffff;
  --blitz-fg: #22282a;
  --blitz-fg-muted: #5b6468;
  --blitz-accent: #3c7d22;
  --blitz-chart-1: #5ab7b5;
  /* … chart-2 to chart-8, and any optional tokens */
  --blitz-font-sans: "Acme Sans", Verdana, sans-serif;
}

.blitz-slide h1 { font-weight: 800; }
[data-layout="section"] { background-image: url("./img/bg-section.png"); background-size: cover; }
[data-layout="title"] h1 { color: #fff; }
```

```yaml
theme: ./brand.css
```

- The required tokens (below) must be set in `:root`, as they are for a JS
  theme: a missing one is an error, and an unknown `--blitz-` name a
  warning, at `brand.css:line:col`. A theme with errors isn't used: the
  deck falls back to aurora, and `build` stops.
- Relative `url()`s are relative to the CSS file, like any stylesheet's.
  The files they name (fonts, images) are copied into static builds and
  inlined in standalone files, as the deck's own images are. A missing
  one is an error.
- `@font-face` rules are the theme's fonts: `unicode-range` splits a family
  into subsets as for a JS theme (docs/plugins.md §3.2), and `check` knows
  which fonts the theme ships.
- `@import` of another local file works, relative to the importing file,
  with a media query if you like (`@import "./print.css" print`).
  Stylesheets and fonts from other sites (`@import url(https://…)`, Google
  Fonts) are refused: the deck would change, or break, when they do.
- Scope rules to `.blitz-slide` or `[data-layout]` (or `.blitz-chrome`),
  as for any theme: a bare `h1` or `table` would also style the overview
  and the presenter view, and gets a warning.
- In `dev`, saving the file (or a file it imports) restyles the open deck
  without reloading it. Adding or removing a font reloads the page.
- A theme can also be a package: `theme: acme` finds
  `blitzstrahl-theme-acme`, and its `package.json` names the CSS file
  (`"main": "brand.css"`, or `exports`).

A theme can't build on another theme. To change a few things in a built-in
theme, keep it and add a stylesheet (next section).

## Adding to a theme: `css` *(1.1)*

```yaml
theme: broadsheet
css: ./talk.css          # or a list: [./brand-extras.css, ./talk.css]
```

`css` files come after the theme's, in the order listed, so their rules
win at equal specificity. Everything above about `url()`, `@font-face`,
`@import` and `dev` applies to them too, and they can set tokens in `:root`
to change a theme's colours or sizes. A `<style>` in the markdown still
works; a file can be shared by several decks.

## Backgrounds by layout *(1.1)*

A theme sets backgrounds per layout with `[data-layout="…"]`, as above. A
JS theme's `css` can too: its relative `url()`s are relative to the
theme's module file. A slide's background, first match wins:

1. the slide's own `background` key;
2. the deck's `background` key, for that layout or for every slide
   (docs/syntax.md §3.6);
3. the theme's CSS for the slide's layout;
4. the `bg` token.

## Chrome: footer, number, logo *(1.1)*

The deck's footer, slide number and logo (docs/syntax.md §3.6) are in each
slide as

```html
<div class="blitz-chrome">
  <div data-chrome="footer">Report Generator</div>
  <div data-chrome="number">3 / 12</div>
  <img data-chrome="logo" src="…" alt="">
  <div data-chrome="title">…</div> <div data-chrome="author">…</div> <div data-chrome="date">…</div>
</div>
```

with an element only for what the deck sets (the title is always there).
The base styles place the footer bottom left, the number bottom right and
the logo top right, within the slide's padding, in `text-small` and
`fg-muted`, and hide the title, author and date. They hide the number on
the `title`, `section` and `end` layouts. Their rules are written
`.blitz-chrome [data-chrome="…"]`, so a theme's rule of the same form wins,
and a theme's `.blitz-slide img` doesn't reach the logo. A theme restyles
any of it:

```css
.blitz-chrome [data-chrome="logo"] { top: auto; bottom: 24px; height: 40px; }
[data-layout="title"] .blitz-chrome [data-chrome="date"] { display: block; left: 82px; bottom: 60px; }
[data-layout="section"] .blitz-chrome { display: none; }
/* Text on every slide, whatever the deck: a classification label */
.blitz-chrome::after { content: "Classified as ACME NORMAL"; position: absolute; left: 50%; bottom: 8px; }
```

Chrome is laid over the slide's content (`position: absolute` in the
slide), and the content doesn't make room for it: a theme that puts the
footer inside the padding keeps them apart.

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
