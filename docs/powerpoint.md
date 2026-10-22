# PowerPoint presentations *(1.2)*

Every command that takes a deck takes a PowerPoint presentation too:

```sh
npx blitzstrahl dev quarterly.pptx        # shows it; saving it in PowerPoint updates the page
npx blitzstrahl build quarterly.pptx --standalone   # quarterly.html, one file
npx blitzstrahl export quarterly.pptx     # quarterly.pdf
npx blitzstrahl present quarterly.pptx    # with a phone as the remote
```

The slides look as they do in PowerPoint, without the animations: each
one shows as it is once all its animations have played. Speaker notes are
the presenter view's notes, and the presenter view, the laser and pen,
PDF export and standalone files all work as they do for a Markdown deck.

blitzstrahl doesn't change the file, and writes nothing beside it but what
`build` and `export` are asked for.

## What it reads

| Files | How |
|---|---|
| `.pptx`, `.pptm`, `.ppsx`, `.ppsm`, `.potx`, `.potm` | Directly |
| `.ppt`, `.pps`, `.pot` (PowerPoint 97–2003), `.odp`, `.otp` (LibreOffice Impress) | Converted to `.pptx` by [LibreOffice](https://www.libreoffice.org) first, so it must be installed. blitzstrahl looks for `soffice` on the `PATH` and where the installers put it; set `BLITZSTRAHL_SOFFICE` to its path if it's elsewhere. Converting takes a few seconds, each time the deck is loaded |

## What it shows

- **Slides as PowerPoint lays them out**: what the master and layout draw
  (unless the slide or layout hides their graphics), placeholders in the
  places and styles the layout and master give them, the slide size
  (`canvas:` follows it, so a 4:3 deck is 1280×960), and backgrounds:
  colours, gradients and pictures.
- **Text**: fonts, sizes, colours, bold, italic, underline, strikethrough,
  superscript, capitals, letter spacing, highlight; alignment, indents,
  line and paragraph spacing; bullets and numbering, on every level;
  shrink-to-fit; vertical text; links to web pages and email addresses.
- **Shapes**: the common preset shapes (rectangles, rounded and snipped,
  ellipses, triangles, arrows, chevrons, stars, flowchart shapes…) and
  freeforms, with solid, gradient and picture fills, outlines, dashes and
  arrowheads, rotated and flipped; the theme's shape styles; groups.
- **Pictures**, cropped as in PowerPoint; an SVG where PowerPoint keeps one.
- **Tables**, with their table style (PowerPoint's default, *Medium Style 2*,
  even when the file doesn't define it), merged cells, fills and borders.
- **Charts**: bar and column, line, area, pie and doughnut, scatter and
  bubble, drawn by the [chart renderer](renderers/chart.md) from the values
  PowerPoint saves with the chart, in its colours. They're interactive, as
  any chart in a deck is.
- **SmartArt**, as the drawing PowerPoint saves with it.
- **Speaker notes**, as `::: notes`.

Hidden slides are left out, as in a slide show.

## What it doesn't

Each of these is reported once, as an `info` (`pptx/not-shown`), by `dev`,
`build` and `check`:

- Animations and slide transitions. Every slide fades in.
- Video and sound: their poster frame shows.
- Shadows, glows, reflections, 3-D and other effects; pattern fills, which
  show as a plain colour; WordArt's text effects.
- Shapes of the rarer preset kinds (a cloud, a callout's pointer), drawn as
  rectangles; charts of other kinds (radar, stock, surface), shown as a
  frame with their title; combination charts show their first kind.
- Embedded objects, ink, and pictures in formats browsers can't show
  (`.emf`, `.wmf`, `.tiff`).

**Fonts** are named, not shipped: the machine showing the deck supplies
them, or a fallback (the same rule as for themes, docs/themes.md). A font
that isn't there can make text wrap differently. Fonts embedded in the
file are licensed for that file and aren't extracted.

To change a slide, change the presentation. To make it a Markdown deck you
edit, start from `blitzstrahl theme import` (docs/cli.md), which turns its
template into a theme.
