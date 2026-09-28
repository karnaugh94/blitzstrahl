# The command line

```
blitzstrahl new [talk.md] [--theme aurora]
blitzstrahl dev <deck.md> [--port 5173] [--host] [--open]
blitzstrahl build <deck.md> [--out dist] [--standalone] [--force] [--strict] [--format text]
blitzstrahl export <deck.md> [--out deck.pdf] [--steps] [--force]
blitzstrahl check <deck.md> [--offline] [--strict] [--format text]
blitzstrahl --version
```

`blitzstrahl <command> --help` shows one command's options. Each option
belongs to the commands above that list it, and giving one to another
command (`build --steps`) is an error, not something quietly ignored.

**Exit codes:** `0` all is well; `1` the deck has problems (errors, or with
`--strict`, overflow or warnings); `2` the command line asked for something
blitzstrahl won't do (an unknown option, a deck that isn't there, an output
path that would overwrite something), said in one line.

## `new`

Starts a deck: `blitzstrahl new` writes `talk.md` in the current folder, and
`blitzstrahl new q3/review.md` writes `review.md` in `q3/`, making the
folder if it isn't there. The deck is a short tour to edit or delete: a
title slide, bullets that appear one at a time, a chart with its data file,
two columns, and presenter notes. It prints the command that previews it.

- `--theme` sets the deck's `theme:` (default `aurora`), written as you
  give it: `broadsheet`, a package, or a `./path`.
- It never overwrites anything. If the deck or its data file
  (`<name>-data.csv`, beside it) is already there, it writes neither and
  says why.

## `dev`

A live preview. Saving the markdown (or a data file it uses) updates the open
deck in place, on the same slide and step. Saving a local theme or plugin
(`theme: ./brand.js`), or a file it imports, reloads the page with the change. Diagnostics print in the terminal
and in the browser console.

It serves the deck and the files the deck uses, and nothing else in the
deck's folder, so `--host` shares only the talk with the network.

Slides that overflow get a red badge, and the elements responsible get a
dashed outline. The same overflow warnings print in the terminal at
`deck.md:line:col`.

## `build`

Writes a static site to `dist/` next to the deck (or `--out`). Serve it over
HTTP: module scripts don't run from `file://`. For a file you can simply
open, use `--standalone` (below).

Every local file the deck refers to is copied in: images, videos, fonts, and
the targets of links. Images are renamed with a content hash (`logo-1a2b3c4d.svg`).
Other files keep their own name in a hashed folder (`1a2b3c4d/report.pdf`),
so a download is saved under its real name.

The output folder is blitzstrahl's alone, and nothing else in it is ever
deleted:

- `--out` can't be the deck's own folder, or a folder that contains it.
- A folder that already has files in it is used only if blitzstrahl made it.
  Otherwise the build stops before writing anything, and says why.
- Each build lists what it wrote in `.blitzstrahl-build.json`, in the output
  folder. The next build removes exactly those files before writing new
  ones. Files you add yourself, such as `CNAME`, `.nojekyll` or a `.git`
  folder, stay where they are.

- A deck with **errors** isn't built unless you pass `--force`: an error
  means blitzstrahl couldn't do what the deck says. That includes a chart,
  map, embed or Mermaid diagram that would fail: an unknown key, a column
  that isn't in the data, a map's latitude and longitude swapped.
- After building, every slide is measured in a headless browser, and each
  one whose content runs off the canvas, or is cut off inside a box (a
  wide code block, say), is listed as a warning.
- `--strict` turns those warnings into a failed build (exit code 1), for CI.
  The files are still written.
- `--format json` or `--format github` writes the diagnostics for a
  machine instead of a person (see *Machine-readable diagnostics*).

The overflow check needs a Chromium-based browser: an installed Chrome or
Edge, or Playwright's Chromium. When it finds none, blitzstrahl prints the
command that installs the right Chromium (`npx playwright@<version> install
chromium`, with the version it uses). Without
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
another path. It must end in `.html`. It never replaces the deck, or an
existing `.html` file that blitzstrahl didn't write.

- Everything is inside: the runtime, the theme, every local file the deck
  refers to (images, videos, fonts, linked files, as data URIs, each one
  once), your data files, the presenter view, and the code for only those
  renderers the deck uses. A link to a local file downloads it. A deck without charts or maps is about 70 kB.
  One with a chart is about 650 kB, most of it the charting library.
- The presenter view works from the file too (`P`, or open it with
  `#presenter` on the end).
- `build` prints the file's size, and warns when it's over 8 MB, naming the
  largest files inside it.

What still needs the network, and so won't work offline, even from a
standalone file:

- A map's street tiles. Your markers and regions are in the file and always
  draw; `tiles: none` gives a map that needs nothing
  (`docs/renderers/map.md`).
- Embedded pages. `fallback:` shows an image instead when you're offline
  (`docs/renderers/embed.md`).

`build` notes both when the deck has them.

## `export`

Writes the deck as a **PDF**: `talk.md` → `talk.pdf` next to it, or
`--out` to choose. The path must end in `.pdf`, and a PDF that's already
there is replaced.

- One page per slide, showing the slide at its **final step**, with
  everything revealed.
- `--steps` gives a page for **every step** instead: the slide as it looks
  on arrival, then after each press. Good for handouts, or for sharing a
  talk that builds up an argument.
- Pages are the canvas size (1280×720 unless the deck sets `canvas`), text
  stays selectable text, and charts are vector graphics.
- Charts, maps and embeds are drawn in full before the page is printed,
  without their entrance animations. A map's street tiles and embedded pages
  come from the network at export time. If one isn't ready within 15
  seconds, it's printed as it is and `export` says which.
- Embedded pages appear as pictures of themselves: a browser won't print
  another site's page inside a frame.
- Presenter notes aren't included.
- Like `build`, a deck with errors isn't exported unless you pass `--force`.

`export` needs a Chromium-based browser, just like the overflow check.

## `check`

Finds what would go wrong **before** you're in front of a room, and points
at each problem as `deck.md:line:col`:

| Finds | Level |
|---|---|
| Everything `build` reports: syntax errors, unknown keys, missing images and data files, and charts, maps, embeds and diagrams that would fail | as in `build` |
| Step gaps: a press that changes nothing (`@1`, `@3`, but no `@2`) | warning |
| A class that's close to an effect name but isn't one (`.fade-in`: did you mean `.fade`?) | warning |
| A class that nothing styles, so it does nothing | info |
| Slides that overflow the canvas, or clip inside a box | warning |
| Embedded sites that refuse to be framed (`X-Frame-Options`, CSP `frame-ancestors`), are missing, or don't answer | warning |
| Map data from a URL that doesn't answer, or that the browser won't be allowed to read (no CORS header) | warning |
| Map data from a URL that isn't what the map expects | error |
| A map with a tile provider but no `attribution` | warning |
| A map with no street map (no `tiles`) | info |
| A bar or line chart that sums repeated categories, without `aggregate` or `series` | info |
| The theme's text font isn't shipped with it, so the deck looks different on each computer | info |
| Text that no font the theme ships can show (Arabic in aurora, say): it's set in whatever the presenting machine has | warning |
| Classes from plugins' effects and a theme's CSS count as styled; plugin renderers run their own checks | — |

- The exit code is 1 when there are errors. With `--strict`, warnings
  count too, which suits CI.
- Embedded sites are asked over the network, once each (a `HEAD`
  request), and map data URLs are fetched once each. `--offline` skips
  both.
- The overflow part needs a Chromium-based browser, like `build`'s. Without
  one, `check` says it was skipped.
- `--format json` or `--format github` writes the findings for a machine
  (below).

## Machine-readable diagnostics

`check` and `build` take `--format`:

| `--format` | Writes |
|---|---|
| `text` | The default: one line per finding on stderr, `deck.md:42:7: warning: … [code]` |
| `json` | One JSON document on stdout, and nothing else there |
| `github` | GitHub Actions annotations on stdout, so findings show on the pull request's lines |

The exit code is the same in every format.

**JSON:**

```json
{
  "version": 1,
  "deck": "slides/talk.md",
  "diagnostics": [
    {
      "severity": "warning",
      "code": "step/gap",
      "message": "slide `results`: step 2 changes nothing, so that press does nothing",
      "file": "slides/talk.md",
      "line": 42, "column": 1, "endLine": 42, "endColumn": 1
    }
  ],
  "skipped": ["embedded sites (--offline)"],
  "summary": { "errors": 0, "warnings": 1, "infos": 0 }
}
```

- `file` is relative to the folder the command ran in, as in text output.
  Lines and columns count from 1.
- `code` names the kind of finding and is stable; the `message` is for
  people and may be reworded.
- `skipped` lists what couldn't be checked, and why.
- `build` adds `"output"`: what it wrote (`"dist/index.html"`, or the
  `.html` file), or `null` when it stopped because of errors.
- `version` changes only if a field changes meaning or goes away. New
  fields can appear without it changing.

**GitHub** writes one workflow command per finding, errors as `::error`,
warnings as `::warning` and infos as `::notice`:

```
::warning file=slides/talk.md,line=42,col=1,endLine=42,endColumn=1,title=blitzstrahl step/gap::slide `results`: step 2 changes nothing, so that press does nothing
```

GitHub reads file paths from the repository's root, so run the command
there (the usual working directory of a workflow step):

```yaml
- run: npx blitzstrahl check slides/talk.md --offline --strict --format github
```
