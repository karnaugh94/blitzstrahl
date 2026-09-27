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
