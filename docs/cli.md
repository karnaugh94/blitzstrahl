# The command line

```
blitzstrahl dev <deck.md> [--port 5173] [--host] [--open]
blitzstrahl build <deck.md> [--out dist] [--standalone] [--force] [--strict]
```

## `dev`

A live preview. Saving the markdown (or a data file it uses) updates the open
deck in place, on the same slide and step. Diagnostics print in the terminal
and in the browser console.

Slides that overflow get a red badge, and the elements responsible get a
dashed outline. The same overflow warnings print in the terminal at
`deck.md:line:col`.

## `build`

Writes a static site to `dist/` next to the deck (or `--out`). Serve it over
HTTP: module scripts don't run from `file://`. For a file you can simply
open, use `--standalone` (below).

- A deck with **errors** isn't built unless you pass `--force`: an error
  means blitzstrahl couldn't do what the deck says.
- After building, every slide is measured in a headless browser, and each
  one whose content runs off the canvas, or is cut off inside a box (a
  wide code block, say), is listed as a warning.
- `--strict` turns those warnings into a failed build (exit code 1), for CI.
  The files are still written.

The overflow check needs a Chromium-based browser: Playwright's Chromium
(`npx playwright install chromium`), or an installed Chrome or Edge. Without
one, `build` says the check was skipped, and `--strict` fails, because it
can't vouch for the slides.

To skip the check (no browser available, or you'd rather not), set
`BLITZSTRAHL_SKIP_OVERFLOW_CHECK=1`. `build` then neither measures nor
mentions overflow. `--strict` ignores the variable and checks anyway, since
you asked for it explicitly on the command line. The `dev` badge isn't
affected: it needs no extra browser.

Hidden build steps still take up their space on the slide, so content that
only overflows at a later step is caught too.

## `build --standalone`

Writes the whole deck as **one `.html` file** that opens straight from disk:
double-click it, email it, put it on a USB stick. By default it's the deck's
name with `.html`, next to the deck (`talk.md` → `talk.html`); `--out` picks
another path.

- Everything is inside: the runtime, the theme, your images (as data URIs),
  your data files, the presenter view, and the code for only those
  renderers the deck uses. A deck without charts or maps is about 70 kB.
  One with a chart is about 650 kB, most of it the charting library.
- The presenter view works from the file too (`P`, or open it with
  `#presenter` on the end).
- `build` prints the file's size, and warns when it's over 8 MB. Large
  images are the usual cause.

What still needs the network, and so won't work offline, even from a
standalone file:

- A map's street tiles. Your markers and regions are in the file and always
  draw; `tiles: none` gives a map that needs nothing
  (`docs/renderers/map.md`).
- Embedded pages. `fallback:` shows an image instead when you're offline
  (`docs/renderers/embed.md`).

`build` notes both when the deck has them.

