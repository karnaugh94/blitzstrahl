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

### Fixed

- Standalone files carry each image once. 1.0 repeated a background image
  on every slide that used it, and again in the runtime's payload: a
  20-slide deck with three backgrounds went from 1.7 MB to 0.95 MB.
- `dev` no longer watches the deck's whole folder, which for a deck saved in
  the home folder meant all of it.

## [1.0.0] — 2026-09-25

First release, on GitHub. It was not published to npm: 1.0.1 is the first
npm release.
