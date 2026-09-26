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
- `build` and `dev` check charts, maps, embeds and Mermaid diagrams the way
  `check` always did. A block that would show an error box on its slide
  (an unknown key, a column that isn't in the data) stops the build, and
  `--force` builds anyway. 1.0 built such a deck without a word. A deck that
  built in 1.0 may now stop: that block was broken.
- Horizontal bar charts list categories top to bottom, in the data's order.
  1.0 started at the bottom. `echarts: {yAxis: {inverse: false}}` restores
  that.

### Fixed

- Standalone files carry each image once. 1.0 repeated a background image
  on every slide that used it, and again in the runtime's payload: a
  20-slide deck with three backgrounds went from 1.7 MB to 0.95 MB.
- `dev` no longer watches the deck's whole folder, which for a deck saved in
  the home folder meant all of it.

## [1.0.0] — 2026-09-25

First release, on GitHub. It was not published to npm: 1.0.1 is the first
npm release.
