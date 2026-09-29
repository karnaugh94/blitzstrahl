# Changelog

All notable changes to blitzstrahl. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[semver](https://semver.org): the syntax (`docs/syntax.md`), the plugin API
(`docs/plugins.md`) and the theme tokens (`docs/themes.md`) change
incompatibly only in a major version.

**Fixed (visible)** lists fixes that change what an existing deck looks like
or how a command behaves. 1.0 did something wrong there, and a deck that
relied on it will notice.

## [Unreleased]

### Fixed (visible)

- Links are in the theme's `link` token (default: its `accent`) even when
  the theme's own CSS doesn't say so, as the token table promised. A
  theme that set `link` without styling links showed the browser's blue.
- A chart's `x`, `y`, `series`, `size`, `stack`, `title` and `echarts` are
  checked like its other keys: `x: [a, b]` or `echarts: 5` is an error
  that stops `build`, where 1.0 drew a broken chart. The same checks now
  write the JSON Schemas, so the two can't disagree.
- `transition-dur` takes a number of milliseconds (`600`, `600ms`) and
  nothing else: 1.0 also took `1e3`, `0x10` and an empty value.
- Slide `id`, `background`, `class` and `style` warn when they aren't text.
  1.0 turned a list or mapping into `[object Object]`.
- `dev` no longer answers Vite's `/__open-in-editor`, which opened any file
  it was given for anyone who could reach the server (with `--host`, the
  whole network). The page's editor links open only the deck's files, and
  only from the machine running `dev`.
- Value labels beside bars and points are in the theme's text colour. 1.0
  drew them in ECharts' dark grey with a white halo, which read as
  outlined text on a dark theme.

### Changed

- `check` loads the deck once: its overflow build reuses it (1.0 read,
  parsed and highlighted the deck twice).
- **Numbers in data are written plainly, in every language**: a dot for
  decimals and nothing between the thousands (`1200`, `3.5`; `2.000` is
  2). A data cell written any other way (`1,200`, `3,5`, `1.234,5`) stops
  the build with its file and line, instead of being guessed. 1.0 read
  `1,200` as 1200, and 1.0.1's column-by-column detection of decimal
  commas is gone. Data written with thousands marks says so with the new
  `thousands` key (deck, chart or map): `thousands: "."` reads a German
  Excel export (`1.234,5`, `3,5`). The error suggests the right value.
- Sortable tables and `count-up` read numbers the way the deck's `lang`
  (or the element's own `lang=`) writes them: `1.234,5` in `de`,
  `1 234,5` in `fr`. In an English deck, `4,2` is text. Spaces group
  digits in every language.
- Pie percentages are written in the deck's language (`43 %` in `de`).
- `export` prints a static build served on the loopback interface for
  the length of the export, instead of a standalone file: faster, and
  the page is printed exactly as it's served.
- A slide's accessible name and role description are in the deck's
  language (`Folie 3` in `de`); 1.0 said `Slide 3` in every language.

- **aurora and broadsheet ship their fonts**: Inter and JetBrains Mono
  (and broadsheet's Newsreader), in Latin, Latin Extended, Greek, Cyrillic
  and Vietnamese, upright and italic, under the OFL. A deck now breaks its
  lines the same way on every computer. Inter also ships a symbols part
  (arrows, `≠`, `≤`, `✓`, fractions) that Fontsource's subsets leave out.
  Where Inter wasn't installed
  before, text metrics change, so `check` can find overflow a deck didn't
  have: run it before your next talk. A standalone file carries only the
  faces its text uses (an English deck: Inter's Latin face, 64 kB).

### Added

- Backgrounds for every slide from the deck: `background:` in the deck's
  frontmatter, one value or one per layout (`title:`, `section:`,
  `default:` for the rest). A slide's own still wins, and
  `background: none` clears it.
- `blitzstrahl theme import template.potx`: a CSS theme from a PowerPoint
  template (or presentation): its colours, fonts, backgrounds by layout
  and logo, a sample deck, and a list of what it couldn't carry over.
- A corporate example deck (`examples/corporate`), in a theme imported
  from the PowerPoint template beside it.
- **Themes written in CSS**: `theme: ./brand.css`, tokens in `:root`,
  fonts by `@font-face`, and local `@import`s. The recommended way to
  write a theme; JS themes stay. Packages can ship one too.
- `css:` in the deck's frontmatter: stylesheets after the theme's, to
  change a built-in theme or share styles between decks.
- In `dev`, saving a CSS theme or a `css:` file restyles the deck without
  reloading the page.
- A footer, slide numbers and a logo on every slide, from the deck:
  `footer:` (inline markdown), `slide-numbers:` (`true`, or a template
  like `"{n} / {total}"`) and `logo:`. None on a slide with
  `chrome: false`, and no number on title, section and end slides.
  Themes place and restyle them, and can show the deck's title, author
  and date.
- Themes can give each layout its own background: relative `url()`s in a
  theme's CSS are relative to the theme's file, and the files are copied
  into builds, served by `dev` and inlined in standalone files.
- `dev` shows the deck's errors and warnings on the page, each opening your
  editor at its line, with a banner while the deck has errors. It updates on
  every save.
- `blitzstrahl new [talk.md] [--theme]`: a starter deck with a chart and
  its data file. It never replaces a file.
- `check --format json | github` and `build --format …`: diagnostics as one
  JSON document, or as GitHub Actions annotations on the pull request.
- JSON Schemas for deck and slide frontmatter and for `chart`, `map` and
  `embed` blocks, as `blitzstrahl/schema/*.json`, for editors.
- Deck key `public: ./folder`: a folder `dev` serves and static builds copy
  as it is, at the same path, for a demo page with its own scripts, or
  downloads. No dotfiles, nothing a link leads to outside it.
- `ThemeFont.unicodeRange`: a theme can split a family into subsets, and
  standalone files carry only the subsets their text uses.
- `check` says when a theme doesn't ship its text font (info), and warns
  about text that no shipped font covers.
- Charts: `format` (`"0.0"`, `"0%"`, `compact`, …), `prefix` and `suffix`
  for every number shown; `aggregate` (`sum`, `mean`, `min`, `max`,
  `count`) for rows that share a category; `sort: asc | desc` for bars and
  pies; `time: true` for a time axis of ISO dates, labelled in the deck's
  language; `delimiter` for CSVs whose header doesn't make it clear.
- A map's choropleth legend writes numbers in the deck's language.
- Street maps stay sharp on projectors and high-resolution screens: tiles
  are loaded for the size the map is shown at. `{r}` in a tile template
  asks a provider for its high-resolution (`@2x`) tiles.
- Plugins: `RenderCtx.lang`, and `RenderCtx.number(text, thousands?)` to
  read data the way the built-in renderers do.
- blitzstrahl speaks English, German, French, Spanish, Italian, Polish and
  Swedish. What the audience hears or reads from it (the screen reader's
  slide announcements, footnote labels, embed notices) follows the deck's
  `lang`; the overview, go-to box, key help and presenter view follow the
  browser's language. A bare standalone file grows by 21 kB for them.
- Utility classes every theme has: `.columns`, `.column`, `.callout`,
  `.muted`, `.accent`, `.small`, `.big`, `.center` and `.zebra`. A theme
  that only sets tokens gets a plain look for each from the base styles,
  at zero specificity, so any rule of the theme's wins. A 1.0 theme that
  styles `.callout` or `.columns` itself gets the base rules' other
  properties too (a callout's background, say).
- Pandoc's columns: `::: {.column width=40%}` inside `:::: columns` gets
  that width. `width=` and `height=` on any container set its size (1.0
  wrote a `<div width>` that did nothing).
- Components, with the new attribute key `as=`: `steps`, `timeline` and
  `chevrons` on a list; `flow` and `cards` on a list or a container;
  `compare` (before → after) on a two-column table or a two-part
  container; `stats` on a container. Written as ordinary markdown, drawn by
  the theme from four new tokens (`marker`, `marker-fg`, `connector`,
  `accent-fg`, all with defaults). `{.accent}` on an item marks it. A deck
  that styles its own `.timeline` or `.card` is unaffected: `as=` adds
  `data-as`, never a class. Pages that don't use them don't carry their CSS.
- `reveal=items` on a container reveals its child blocks one step at a
  time.
- Video and audio: `![caption](./demo.mp4)` (or `.webm`, `.mp3`, `.ogg`,
  …) is a player. It plays when it appears, on entry or at its step, and
  stops and rewinds when it's left. Keys `autoplay`, `loop`, `muted`,
  `controls`, `poster`, `start` and `end`. The presenter's previews show
  it paused and silent; PDFs print its poster or its frame at `start`;
  standalone files carry it inline. 1.0 wrote an `<img>` that showed
  nothing.
- `dev`, and the overflow check's server, answer HTTP range requests, so
  videos can seek.
- Footnotes can be defined on any slide, such as all at the end of the
  deck, and each slide that cites one lists it. 1.0 showed a footnote only
  if it was defined on the slide that cited it, and dropped it without a
  word otherwise. Warnings for a citation defined nowhere, a definition
  cited nowhere, and a label defined twice.
- `dim-others` dims the bare text beside its element, not only other
  elements.
- Magic move within a slide: consecutive blocks with the same `key=`, each
  at a later step, take turns in one box, and each morphs into the next
  (code token by token).
- **Accessible PDFs**: `export` writes a tagged PDF, so screen readers
  read it in order with its headings, lists and tables; its bookmarks are
  the slides' headings; and its properties carry the deck's `title`,
  `author` and `lang`, and `date` when it's a calendar date. With
  `--steps`, a heading is bookmarked once, on the first page that shows it.
- **Printing from the browser**: `Ctrl+P` (`⌘P`) lays out every slide as a
  page at its final step, waits for charts, maps and diagrams to draw, then
  opens the print dialog, and the deck stays on screen as it was. The
  presenter view has a **Print** button that prints the deck's slides.
  The browser's own Print menu can't wait: it prints every slide, with
  the charts shown so far. 1.0 printed the one slide on screen.

## [1.0.1] — 2026-09-27

The first release on npm: every fix below is against 1.0.0, which was on
GitHub only.

### Fixed (visible)

- `build --out` never deletes files blitzstrahl didn't write. 1.0 emptied
  whatever folder `--out` named, and `--out .` deleted the deck itself.
  Now:
  - the build refuses the deck's own folder, any folder that contains it,
    and any non-empty folder it didn't make, before writing anything;
  - rebuilding removes only what the last build listed in
    `.blitzstrahl-build.json`.
  A `dist/` from 1.0 is recognised and rebuilt as before.
- `build --standalone --out` and `export --out` never write over the deck.
  A standalone file must end in `.html`, and doesn't replace an `.html`
  that blitzstrahl didn't write. An export must end in `.pdf`.
- Refusals like these are one line and exit with code 2, instead of a stack
  trace.
- `dev` serves only the deck and the files it uses. 1.0 served everything in
  the deck's folder, and with `--host` that was everyone on the network.
- Files referred to from raw HTML (`src`, `srcset`, `poster`, `href`,
  `data`), CSS `url()`s (in `<style>`, `style=`, a slide's `background` or
  `style`) and links to local files ship with every build. In 1.0 they
  worked in `dev` only. Linked files keep their own name.
- Numbers with decimal commas are read as written. A CSV cell `"3,5"`
  became 35 in 1.0, and `"12,25"` became 1225: now a column that can only
  mean decimal commas reads them as decimals. Semicolon-separated CSVs
  (Excel's in much of Europe) are recognised. Sortable tables and map
  markers read numbers the same way.
- `count-up` counts in the numeral's own style. 1.0 counted `4,2 %` up to
  `42 %`, then snapped back to `4,2 %`.
- A bar or line chart whose `x` repeats shows each category's sum, as pie
  already did. 1.0 showed the first row and dropped the rest; `check`
  now mentions it.
- A slide that starts like `key: value` stays a slide: `Agenda:` over a
  list, or `Q:` and `A:` lines. 1.0 read such a block as settings for the
  next slide, and the slide vanished with only an "unknown key" warning. A
  block is slide frontmatter only when it sets a slide key
  (`docs/syntax.md` §2.3). A near-miss like `layuot:` gets "did you mean".
- With `reveal=rows`, rows still to come show nothing, not even their
  rules. 1.0 drew an empty ruled line for each (collapsed tables paint a
  hidden cell's borders).
- An option given to a command it doesn't belong to (`build --steps`) is an
  error, exit code 2. 1.0 ignored it.
- `build` and `dev` check charts, maps, embeds and Mermaid diagrams the way
  `check` always did. A block that would show an error box on its slide
  (an unknown key, a column that isn't in the data) stops the build, and
  `--force` builds anyway. 1.0 built such a deck without a word. A deck that
  built in 1.0 may now stop: that block was broken.
- Horizontal bar charts list categories top to bottom, in the data's order.
  1.0 started at the bottom. `echarts: {yAxis: {inverse: false}}` restores
  that.

### Fixed

- Only the presenter window may drive the deck: the window that opened it,
  or one it opened. In 1.0 any page able to message it could, including an
  embedded page on a standalone deck, which then took the presenter's
  place.
- The command line explains its mistakes in one line: an unknown option or
  command (with "did you mean"), a deck that isn't there or is a folder, a
  port that isn't a number, an option missing its value. 1.0 printed Node's
  stack trace. Usage mistakes exit with code 2.
- `blitzstrahl --version`, and `blitzstrahl <command> --help` for one
  command's options.
- A deck's `author` is the page's `<meta name="author">`. The docs no longer
  promise a notes handout (it comes in 1.1) or that themes show `author` and
  `date`.
- Plugins can't register the deck keys 1.1 will use: `decimal`, `css`,
  `background`, `footer`, `slide-numbers`, `logo`, `duration`, `public`.
- broadsheet's Newsreader covers Latin Extended, upright and italic, so
  Polish, Czech, Hungarian, Romanian, Croatian, Turkish and Baltic letters no
  longer switch to another typeface mid-word.
- Standalone files carry each image once. 1.0 repeated a background image
  on every slide that used it, and again in the runtime's payload: a
  20-slide deck with three backgrounds went from 1.7 MB to 0.95 MB.
- Under `dev`, editing a local theme or plugin, or a file it imports,
  reloads the page with the change. 1.0 kept the first version until
  `dev` was restarted.
- `dev` no longer watches the deck's whole folder, which for a deck saved in
  the home folder meant all of it.

## [1.0.0] — 2026-09-25

First release, on GitHub. It was not published to npm: 1.0.1 is the first
npm release.
