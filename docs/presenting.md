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
| `?` | Show the keys |

Clickers send `PageUp`/`PageDown` (and often `B` or `.` for their "blank"
button), so they work out of the box. You can also click the left or right
tenth of the screen, or swipe on a touch screen. Clicks on links, charts and
other interactive content never turn the slide.

Browsers use `Esc` to leave fullscreen, so while fullscreen, `O` is the
reliable way to open the overview.

While the screen is black you can still move through the deck: the audience
sees the new position when you bring the screen back.

## Presenter view

Press `P` in the deck. A second window opens with:

- the **current** slide, live, exactly as the audience sees it (charts and
  animations included);
- the **next** state: the next build step, or the next slide, fully built;
- your **notes** (`::: notes`, see [syntax.md §7](syntax.md#7-presenter-notes)),
  with `A−`/`A+` to resize them;
- the **timer**, which starts when you first move, plus Start/Pause and
  Reset, and the time of day;
- **Slides** (the overview, `Esc`), **Black out** (`B`) and go-to (`G`).

Drag the presenter window to your laptop screen and the deck to the
projector, then make the deck fullscreen (`F`). All the keys work in either
window. Whichever window you use, the deck decides where the talk is, so the
two never disagree.

You can also open the presenter view first: add `#presenter` to the deck's
address (`…/index.html#presenter`) and use **Open audience window**.

Reloading either window reconnects it. The timer lives in the deck, so it
survives the presenter window reloading.

### Limits

- Both windows must be in the same browser, on the same computer: they talk
  through the window that opened the other. Controlling a deck from a phone
  or another machine isn't supported yet.
- Pop-up blockers may stop `P` the first time. Allow pop-ups for the deck.
- Notes are in the page source (syntax.md §7).
