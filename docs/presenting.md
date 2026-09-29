# Presenting

How to give a talk with a blitzstrahl deck: the keys, the presenter view,
and what to expect on the day.

## Keys

| Key | Does |
|---|---|
| `→` `↓` `Space` `PageDown` | Next build step, or the next slide |
| `←` `↑` `Shift+Space` `PageUp` | Previous step, or the previous slide at its last step |
| `Home` / `End` | First / last slide |
| `Esc` or `O` | Overview of every slide; arrows and `Enter` (or a click) jump |
| `G` | Go to a slide: type its number, its id, or part of its title |
| `B` or `.` | Black out the screen (again to bring it back) |
| `F` | Fullscreen |
| `P` | Open the presenter view |
| `L` | Laser pointer (again to put it away) |
| `D` | Draw on the slide (again to put the pen down) |
| `C` | Clear the drawing on this slide |
| `?` | Show the keys |
| `R` | Read the deck as a document: every slide in one scrolling page (*Reading and printing*) *(1.1)* |
| `Ctrl+P` (`⌘P`) | Print every slide, or save them as a PDF (*Reading and printing*) *(1.1)* |

Clickers send `PageUp`/`PageDown` (and often `B` or `.` for their "blank"
button), so they work out of the box. You can also click the left or right
tenth of the screen, or swipe on a touch screen. Clicks on links, charts and
other interactive content never turn the slide.

With the laser or the pen out, `Esc` puts it away first; press it again
for the overview.

Browsers use `Esc` to leave fullscreen, so while fullscreen, `O` is the
reliable way to open the overview.

While the screen is black you can still move through the deck: the audience
sees the new position when you bring the screen back. Slides change without
their transition while it's black.

## Languages

The overview, the go-to box, the key help and the presenter view are in the
browser's language, when it's one blitzstrahl knows (English, German,
French, Spanish, Italian, Polish, Swedish), and in English otherwise. The
little the audience hears or reads from blitzstrahl itself follows the
deck's `lang` instead (syntax.md §3.3).

Translations are JSON files in `packages/core/src/i18n/`, one per
language, with English as the fallback for anything missing. To add a
language, copy `en.json`, translate the values (keep each `{placeholder}`),
and open a pull request.

## Laser pointer and drawing

`L` turns the pointer into a glowing red dot with a short trail, for the
room to follow. Clicks still turn the slide.

`D` hands you a pen: drag (or draw with a finger or stylus) to mark up the
slide, in the theme's accent colour (a theme can set `--blitz-ink`; the
laser's colour is `--blitz-laser`). While the pen is out, clicking and
swiping draw instead of turning the slide; the keys still navigate. Each
slide keeps its own drawing while the deck is open: go away and come back
and it's still there. `C` clears the current slide. Drawings aren't saved,
and they don't appear in PDFs.

## Presenter view

Press `P` in the deck. A second window opens with:

- the **current** slide, live, exactly as the audience sees it (charts and
  animations included);
- the **next** state: the next build step, or the next slide, fully built;
- your **notes** (`::: notes`, see [syntax.md §7](syntax.md#7-presenter-notes)),
  with `A−`/`A+` to resize them;
- the **timer**, which starts when you first move, plus Start/Pause and
  Reset, and the time of day;
- **Slides** (the overview, `Esc`), **Black out** (`B`) and go-to (`G`);
- **Laser** (`L`), **Pen** (`D`) and **Clear** (`C`): point and draw on
  the current slide in the presenter window, and the audience sees it on
  the screen, where you pointed. What's drawn in either window shows in
  both.

Drag the presenter window to your laptop screen and the deck to the
projector, then make the deck fullscreen (`F`). All the keys work in either
window. Whichever window you use, the deck decides where the talk is, so the
two never disagree.

You can also open the presenter view first: add `#presenter` to the deck's
address (`…/index.html#presenter`, or `talk.html#presenter` for a standalone
file) and use **Open audience window**. Adding it to a deck that's already
open turns that tab into the presenter view.

Reloading either window reconnects it. The timer and the drawings live in
the deck, so they survive the presenter window reloading (and a reloaded
deck starts with clean slides).

### Limits

- Both windows must be in the same browser, on the same computer: they talk
  through the window that opened the other. Nothing else can drive the deck,
  not another tab and not a page embedded in a slide. Controlling a deck from a phone
  or another machine isn't supported yet.
- Some browsers block the window `P` opens (Firefox doesn't count a key
  press as permission for a pop-up). The deck then shows an **Open the
  presenter view** link, which works, and the presenter it opens drives the
  deck as usual. To make `P` work directly, allow pop-ups for the deck.
- Notes are in the page source (syntax.md §7).

## Reading and printing *(1.1)*

A deck is also a document: something to send round afterwards, print, or
read with a screen reader.

### Document mode

Add `?mode=doc` to the deck's address (`…/index.html?mode=doc`, or
`talk.html?mode=doc` for a standalone file; it works from `file://`), or
press `R` in the deck, or **Document** in the presenter view (which opens
it in a new tab, so the talk carries on). Every slide is shown in one page
that scrolls, one under another:

- each slide at its **final step**, as a PDF page would be, scaled to the
  window's width (never beyond the canvas size);
- as the slide's own HTML, headings and all, so a screen reader, the
  browser's find (`Ctrl+F`) and its reader mode all work on it;
- charts, maps, diagrams and embedded pages are drawn as they scroll into
  view, without their entrance animations, and stay live (hover a chart);
- video and audio don't play by themselves: they have their controls;
- `?mode=doc&notes` shows each slide's presenter notes under it.

A bar at the top has **Present** (back to the deck, at the slide you were
reading) and **Print**. A slide's address works here too:
`?mode=doc#/results` opens the document at that slide. The deck's keys
don't apply: it's an ordinary page.

### Printing from the browser

`Ctrl+P` (`⌘P`) in the deck, and **Print** in the presenter view, lay out
every slide as a page at its final step, wait for charts, maps and
diagrams to draw, then open the browser's print dialog; choose *Save as
PDF* there for a file. Pages are the canvas's shape (16:9, unless the deck
sets `canvas`); set the margins to *None* if the browser asks. Embedded
pages print blank from a browser (it won't print another site inside a
frame); `export` prints them as pictures.

Printing from the browser's own menu (*File → Print*) can't wait for
anything: the browser prints at once. The slides are all there, but a
chart, map or diagram prints only if its slide has been shown since the
deck was opened, and an empty frame with its alt text otherwise. Use
`Ctrl+P` instead.

In document mode, printing gives the **handout**: two slides to an A4
sheet, side by side on landscape paper, each with its notes under it when
they're shown (`&notes`). `&orientation=portrait` prints two rows to a
portrait sheet instead, notes beside each slide. That's the handout
`export --notes` writes.

Notes that don't fit their half of the sheet aren't cut: that slide gets a
sheet of its own, and its notes carry on over the next page if they must
(`export --notes` names the slide). As a rule of thumb, about 1,300
characters of notes fit under a slide (1,000 beside one, in portrait):
the prompts a speaker glances at, not a script.

Nothing on the audience's screen hints at any of this: the deck shows
only its slides. The key help (`?`) lists `R` and `Ctrl+P`.

Browsers differ in what they print: Chromium-based browsers (Chrome,
Edge) give one page per slide at the canvas's shape. Firefox and Safari
use the paper size you choose and fit a slide to it. For a PDF that's the
same everywhere, with bookmarks and the deck's metadata, use `blitzstrahl export`
(cli.md).

## Accessibility *(1.1)*

- Each slide is announced as it's shown, by its title (or its number, in
  the deck's language).
- Everything works without a mouse. The overview, the go-to box and the
  key help are dialogs: they open with the focus inside, `Tab` stays in
  them, and closing one gives the keys back to the deck. The presenter
  view's buttons are all within reach of `Tab`, and show where the focus
  is.
- `prefers-reduced-motion` turns every effect and transition into an
  instant change; steps still work.
- Charts, maps and diagrams take a description: `alt="…"` on the fence
  (syntax.md §8.2). A chart without one is described from its data.
- Document mode (above) is the whole deck as one page, for screen readers
  and for reading at your own pace.
- The PDF `export` writes is tagged (cli.md).

Every example deck is tested with [axe](https://github.com/dequelabs/axe-core)
in both built-in themes, in the deck, its overlays, the presenter view and
document mode. A theme you write is yours to check: colour contrast is
the usual finding.
