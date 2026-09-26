# blitzstrahl syntax

**Status:** stable from 1.0. Changes follow semver: anything that would
change what an existing deck means is a major version.

This is the public contract between a deck author and blitzstrahl. Anything not
described here is unspecified and may change. Once 1.0 ships, changes to this
document follow semver.

---

## 1. Base language

A deck is a UTF-8 [CommonMark](https://spec.commonmark.org/) document with
[GitHub Flavored Markdown](https://github.github.com/gfm/) extensions (tables,
strikethrough, task lists, autolinks, footnotes), parsed by remark.

blitzstrahl makes these changes to that base:

| Change | Why |
|---|---|
| **Setext headings are disabled.** `Title` followed by `---` on the next line is a paragraph and then a slide separator, not an H2. | `---` is the slide separator. In CommonMark it would silently turn the line above into a heading, which is the classic markdown-deck trap. Use `#`-style (ATX) headings. |
| **`{...}` attribute blocks** (§4). | Styling, IDs, build steps and animation. |
| **`:::` containers** (§5). | Grouping, presenter notes and layout slots. |
| **Renderer fences** (§8). | Charts, maps, embeds. |

Raw HTML is passed through unchanged, except that the local files it refers
to ship with every build, as Markdown images do. Those are the files in
`src`, `srcset`, `poster`, `href` and `data` attributes, and in CSS `url()`s
in `style` attributes and `<style>` elements. So are the targets of
Markdown links to local files (`[report](./report.pdf)`). Decks are written
by their authors and are not treated as untrusted input. HTML comments (`<!-- -->`) are dropped from the
output. They are **not** presenter notes (see §7).

Line endings are normalised to `\n` before parsing. Diagnostics report
`file:line:column`, with lines and columns starting at 1.

---

## 2. Slides

### 2.1 Separators

A line containing only `---` (three or more hyphens, at most three spaces of
indentation) at the top level of the document starts a new slide.

```markdown
# First slide

---

# Second slide
```

- `***` and `___` stay ordinary horizontal rules (`<hr>`) inside a slide.
- A `---` inside a fence, container, list or blockquote is not a separator.
- Blank lines around a separator are optional, because setext headings are
  disabled (§1).
- Leading and trailing empty slides are dropped. An empty slide between two
  others is kept (it's useful as a deliberate pause) and reported as info.

### 2.2 Deck frontmatter

A YAML block at the very start of the file, opened and closed by `---`, holds
deck-level settings (§3.1).

### 2.3 Slide frontmatter

A separator **immediately** followed on the next line (no blank line) by a YAML
mapping closed by another `---` holds slide settings (§3.2) for the slide that
follows:

```markdown
---
layout: two-col
background: ./hero.jpg
---

# Slide title
```

The rule is exact so it can't be misread:

1. The YAML block starts on the line directly after a separator, and that
   line looks like a mapping key (`name:` at the start of the line). Any other
   first line is ordinary slide content.
2. It runs up to the next separator.
3. It must parse as a YAML **mapping** that sets at least one slide key
   (§3.2). Otherwise the block is ordinary slide content. So a slide that
   starts `Agenda:` over a list, or `Q:` and `A:`, is a slide, not settings.
   A warning is emitted only where settings were probably meant: invalid
   YAML whose first key is a slide key, or a lower-case key a letter or two
   off one (`layuot`).
4. The `---` that closes a slide frontmatter block starts that slide's
   content. It never starts another frontmatter block.

The closing `---` of the deck frontmatter counts as a separator. So the first
slide takes frontmatter by the same rule, with a second YAML block immediately
after the deck block:

```markdown
---
title: Quarterly review
theme: aurora
---
layout: title
background: ./cover.jpg
---

# Quarterly review
```

To start a slide with literal text that looks like a slide setting
(`layout: …`), leave a blank line after the separator.

### 2.4 Slide identity

Every slide has a stable `id`. It's used in URLs (`#/intro/2`) and presenter
sync. The first rule that matches picks it:

1. `id` in slide frontmatter.
2. An explicit `#id` on the slide's first heading.
3. A slug of the first heading's text (GitHub slugger rules).
4. `slide-<n>`, where `<n>` is the slide's number, starting at 1.

Duplicates get `-2`, `-3`, … appended. That's silent for ids taken from
heading text, since repeating a heading is normal (it's how `auto-animate`,
§9, carries a title from slide to slide), and a warning for an `id` or `#id`
the author wrote. The slide **title** used
in the overview and presenter view is the plain text of the first heading, of
any level.

### 2.5 The first slide is a title slide

> **Slide 1 uses the `title` layout unless it sets its own `layout:`.**
> Every other slide uses `default`. This is the only layout blitzstrahl picks
> for you. To make slide 1 an ordinary slide, give it `layout: default` in its
> frontmatter (§2.3).


### 2.6 No vertical stacks

Vertical (2D) slide stacks are deliberately unsupported. Slides are a flat
sequence.

---

## 3. Frontmatter keys

Unknown keys are warnings, not errors. Plugins may register their own deck
keys, which are then known (docs/plugins.md §2.4).

### 3.1 Deck

| Key | Type | Default | Meaning |
|---|---|---|---|
| `title` | string | first slide's title | Document title, `<title>` |
| `author` | string | — | Shown by themes that display it |
| `date` | string | — | Free-form, displayed as written |
| `lang` | string | `en` | BCP 47 tag, `<html lang>` |
| `theme` | string | `aurora` | A built-in theme (`aurora`, `broadsheet`), a package (`theme: acme` finds `blitzstrahl-theme-acme`), or a `./path` (docs/plugins.md §1) |
| `plugins` | list | — | Plugin packages or `./paths`, loaded in order (docs/plugins.md) |
| `canvas` | `WxH` string | `1280x720` | Logical canvas size in CSS pixels |
| `transition` | transition | `fade` | Default slide transition (§9) |
| `transition-dur` | ms | theme-defined | Default transition duration |

### 3.2 Slide

| Key | Type | Meaning |
|---|---|---|
| `id` | slug | Overrides the derived slide id (§2.4) |
| `layout` | layout name | Named layout (§10). Default `default`. **Slide 1 defaults to `title`** (§2.5) |
| `transition` | transition | Transition used to *enter* this slide (§9) |
| `transition-dur` | ms | Duration for that transition |
| `background` | string | Image path/URL (covers the canvas), or any CSS `background` value |
| `class` | string | Space-separated classes on the slide root |
| `style` | string | Inline CSS on the slide root |

**Heading shorthand:** the slide keys `transition`, `transition-dur`, `layout` and
`background` may also be written on the slide's **first heading** and are
hoisted to the slide:

```markdown
# Slide title {transition=push-left}
```

On any other element these keys are an error. Classes and `#id` on the first
heading stay on the heading. If a key is set both in frontmatter and on the
heading, frontmatter wins and a warning is emitted.

---

## 4. Attribute blocks `{...}`

This extends the Pandoc attribute convention with one new token: `@`, for
build steps.

### 4.1 Grammar

```
attrs   = "{" ws? token (ws token)* ws? "}"
token   = class | id | step | pair
class   = "." name                      .callout
id      = "#" name                      #revenue
step    = "@" ( "+" | "=" | int ( "-" int )? )  @+  @=  @2  @2-4  @0
pair    = key "=" value                 dur=400  style="color: red"
name    = [A-Za-z_][A-Za-z0-9_-]*
key     = [A-Za-z][A-Za-z0-9_-]*
value   = bare | '"' … '"' | "'" … "'"  (backslash escapes the quote)
bare    = one or more chars other than whitespace, quotes and "}"
```

Rules:

- At most one `#id` and one `@step` per block. A second one is an error.
- A repeated `key=` is a warning, and the last value wins.
- An attribute block sits on one line.
- A `{...}` whose contents contain **no** valid token is literal text. So
  `{foo}` and `{}` in prose are left alone. A mistyped step such as `{@4-2}`
  still counts as an attribute block and is reported as an error, not printed.
- A `{...}` with **some** valid tokens and some invalid ones is an error
  pointing at the bad token, e.g. `{fade @1}` → "unknown token `fade`: did you
  mean `.fade`?". This catches typos instead of printing them on a slide.
- `\{` never starts an attribute block.

### 4.2 Placement: adjacency decides the target

**Directly attached (no whitespace)** → the preceding **inline** element:

```markdown
Revenue grew [42%]{.pop @+} this year.   span
[the docs](https://example.com){.muted}  link
![chart](./q3.png){width=60%}            image
`npm i`{.big}                            inline code
```

Directly attached to anything else, such as plain text or `*emphasis*`, it is
an error. Wrap the text in a span: `[*this*]{.accent}`.

`[text]{...}` creates a span. The text may contain other inline markup:
`[**42%**]{.pop}`. A `[text]` that matches a link reference definition is a
link, not a span.

**Trailing after whitespace at the end of a block's last line** → that
**block**:

```markdown
# Heading {.accent}

Revenue grew year over year. {.fade-up @1}
```

**Standalone** (a paragraph containing only `{...}`, separated by a blank line)
→ the **preceding** sibling block. This is how lists, tables and blockquotes
get attributes, since they have no line of their own to put them on:

```markdown
| Quarter | Revenue |
|---|---|
| Q1 | 1.2M |
| Q2 | 1.9M |

{.sortable .zebra @1 reveal=rows}
```

The blank line is required. Without it, CommonMark folds the line into the
list item's text, and GFM makes it a table row.

A trailing block on the first paragraph of a list item applies to the **list
item**, so `- Point {@+}` reveals the whole `<li>`.

A standalone block with no preceding sibling (at the start of a slide or
container) is an error.

### 4.3 Keys

Keys fall into four groups:

| Kind | Keys | Behaviour |
|---|---|---|
| Animation | `dur`, `delay`, `ease`, `reverse`, plus effect options (§6.3) | Consumed, drives the animation |
| Structure | `reveal`, `key`, `lines` | Consumed (§6.4, §8.1, §9.1) |
| Slide shorthand | `transition`, `transition-dur`, `layout`, `background` | First heading only (§3.2) |
| HTML pass-through | `style`, `title`, `lang`, `dir`, `width`, `height`, `alt`, `data-*`, `aria-*` | Emitted as HTML attributes |

**Any other key is an error.** Unrecognised keys are *not* silently passed
through. That leaves every un-prefixed key free for blitzstrahl to give meaning
later without changing decks that already exist. For custom data, use `data-*`.

---

## 5. Containers `:::`

Pandoc-style fenced divs:

```markdown
::: callout {@2}
Anything, including **markdown**, lists, fences.
:::
```

```
open  = ":::" ":"* ws? name? ws? attrs? ws? (":::" ":"*)? ws?
close = ":::" ":"* ws?
```

The rules for opening and closing are Pandoc's
([`fenced_divs`](https://pandoc.org/MANUAL.html#extension-fenced_divs)):

- An opening fence **must** have a name or an attribute block. A fence with
  neither is always a closing fence.
- A closing fence closes the **innermost** open container. Its colon count
  doesn't have to match the opening fence's.
- `name` is optional. `::: {.a .b}` is a plain `<div>`. `::: callout` adds
  `class="callout"`, like Pandoc's `::: callout` shorthand. blitzstrahl also
  accepts a name *and* an attribute block together: `::: callout {@2}`.
- Spaces are optional: `:::callout{@2}` and `::: callout {@2}` are equivalent.
- An opening fence may end in more colons, as in Pandoc: `::: Warning ::::::`.
- Containers nest. Using longer fences for outer containers is optional, but
  easier to read:

  ```markdown
  :::: columns
  ::: col
  Left
  :::
  ::: col
  Right
  :::
  ::::
  ```

- Fences inside a fenced code block are code, not containers.
- An unclosed container runs to the end of its slide and gets a warning. A
  container never spans a slide separator.
- A bare `:::` that closes nothing is left as text, with a warning.

**Reserved names** carry meaning rather than just becoming a class:

| Name | Meaning |
|---|---|
| `notes` | Presenter notes (§7) |
| *layout slot names* | Fill a named slot of the slide's layout (§10) |

---

## 6. Build steps and animation

### 6.1 The step model

A slide with *N* build steps has states `0 … N`:

- **State 0** is how the slide looks when you arrive at it.
- Each *advance* moves to the next state. Advancing from state *N* goes to the
  next slide.
- *Retreat* moves back one state. Retreating from state 0 goes to the previous
  slide, at its final state.

*N* is the highest step any element on the slide refers to (§6.2), counting an
exit at `@a-b` as step `b + 1`.

### 6.2 The `@` sigil

| Syntax | Meaning |
|---|---|
| *(omitted)* | Present from slide entry (state 0) |
| `@0` | Explicitly present from entry |
| `@2` | Enters at step 2 |
| `@2-4` | Enters at step 2, exits when step 5 is reached (visible for 2, 3, 4) |
| `@0-3` | Present from entry, exits at step 4 |
| `@+` | One step after the **previous annotated element** in document order |
| `@=` | Same step as the **previous annotated element**: they enter together |

`@+` and `@=` both count from the **entry step of the most recent element**,
earlier in the same slide, that has any `@`. That element is called the
*previous annotated element*.

- `@+` is its entry step plus one. With no previous annotated element, `@+`
  means `@1`. So a list of `@+` items reveals one item per step, and `@+` after
  `@2-4` means `@3`.
- `@=` is its entry step. Only the entry step is copied: `@=` after `@2-4`
  means `@2`, and the new element does not exit at 5. With no previous
  annotated element, `@=` is a warning and means `@0`.
- An element that expands into several steps (`reveal=`, §6.4) counts as its
  **last** entry step.
- `@+` and `@=` can be mixed freely. Each one counts from the element just
  before it:

```markdown
Revenue {@1}

[up 42%]{.pop @=}

Costs {@+}

[down 8%]{.pop @=}
```

→ "Revenue" and "up 42%" enter at step 1. "Costs" and "down 8%" enter at step 2.

Steps are per slide and don't carry over between slides.

**Gaps** (`@1` and `@3`, but nothing at `@2`) are allowed. Step 2 is then a
press that changes nothing, and `check` warns about it.

**Nesting:** an element is visible only while its ancestors are. A child whose
steps fall outside its parent's gets a warning, because the author almost
certainly didn't mean it.

Build steps on an element inside a `notes` container are ignored, with a
warning.

### 6.3 Effects

An effect is named as a **class** on the same attribute block:

```markdown
Revenue grew [42%]{.pop @+ dur=400 ease=out-expo} year over year {.fade-up @1}
```

A class that matches a registered effect name is taken as the effect, and is
**not** emitted as an HTML class. There's at most one effect per element. To
combine effects, nest spans.

There are two kinds of effect, and `@` means something slightly different for
each:

| Kind | Effects | Before its step | At its step | After its out-step |
|---|---|---|---|---|
| **Entrance** | `fade`, `fade-up`, `fade-down`, `fade-left`, `fade-right`, `pop`, `zoom`, `blur-in`, `slide-in-up`, `slide-in-down`, `slide-in-left`, `slide-in-right`, `draw`, `count-up`, `typewriter` | hidden | animates in | hidden |
| **Emphasis** | `highlight`, `strike`, `dim-others` | visible, plain | effect applied | effect removed |

- Directional names give the direction of motion: `fade-up` rises into
  place, `slide-in-left` travels leftwards from the right.
- An element with `@n` and **no** effect uses `fade`.
- An entrance effect with **no** `@` plays on slide entry.
- An emphasis effect with no `@` is applied from state 0.
- `dim-others` dims the element's siblings, not the element itself.
- Under `prefers-reduced-motion: reduce`, every effect is instant. Steps still
  apply, so things still appear and disappear on cue.

Options:

| Key | Applies to | Value |
|---|---|---|
| `dur` | all | milliseconds |
| `delay` | all | milliseconds, after the step is triggered |
| `ease` | all | `linear`, `in`, `out`, `in-out`, `out-expo`, `in-out-expo`, `out-back`, or a quoted CSS easing, e.g. `ease="cubic-bezier(.2,0,0,1)"` |
| `reverse` | all | `true`: stepping *backwards* plays the effect in reverse instead of snapping (the default) |
| `from` | `count-up` | starting number, default `0`. The target is the element's own numeral text, and it counts in that numeral's style: `4,2 %` counts through `2,1 %`, and `1.234.567` keeps its dots |
| `cps` | `typewriter` | characters per second |

Custom entrance effects can be defined in CSS, in the theme or a `<style>`
in the deck: `@keyframes blitz-<name>` makes `.<name>` an effect, with the
same `dur`, `delay`, `ease` and `reverse` as the built-ins. Plugins can add
entrance and emphasis effects too (docs/plugins.md §2.3). Using an unknown effect-looking class is not an error, since it
could be an ordinary CSS class, but `check` lists classes (written as `.name`
in an attribute block) that are neither a known effect nor styled by the theme
or a `<style>` in the deck, and suggests the effect you probably meant.
Container names (`::: stat`) aren't listed: they often group without styling.

### 6.4 `reveal`: one step per child

`reveal` on a list or table gives each child its own successive step:

| Value | Target | Children |
|---|---|---|
| `reveal=items` | list | each top-level `<li>` |
| `reveal=rows` | table | each body row. The header row appears with the table |

The first child takes the block's own step (or `@+` if it has none). Each
following child takes the next step. Effect and options apply to every child:

```markdown
- Collect
- Clean
- Chart

{reveal=items .fade-left @2}
```

→ items enter at steps 2, 3 and 4. A `@+` after this list means `@5`, and a
`@=` means `@4`.

---

## 7. Presenter notes

```markdown
::: notes
Remember to mention the Q3 dip. **Don't** read the chart aloud.
:::
```

- Full markdown, rendered in the presenter view and the `--notes` handout.
  Never rendered to the audience.
- A slide may have several `notes` containers. They are concatenated in order.
- Allowed anywhere in a slide, including inside other containers.
- Notes travel inside the built page (in an inert `<template>`, so they're
  never rendered to the audience). Anyone with the file or the URL can read
  them in the page source, so keep secrets out of them.

---

## 8. Renderer fences

A fenced code block whose language is a **registered renderer name** is a
render block, not code:

````markdown
```chart {@2 dur=600}
type: bar
data: ./sales.csv
x: quarter
y: revenue
stack: region
```
````

- The info string is `<renderer> <attrs>?`. The attribute block follows the
  rules in §4 and takes a step and effect like any block.
- Each renderer declares how its body is read: **YAML** (chart, map, embed;
  JSON is valid YAML, so JSON works too) or **plain text** (mermaid, math).
  The body's schema belongs to the renderer and is documented with it.
- Paths starting `./` or `../` are resolved relative to the markdown file.
  They're watched in dev and inlined in standalone builds. Which fields hold
  paths is up to the renderer.
- Renderer names take priority over code languages. To show a renderer's
  source *as code*, fence it under a different language (e.g. `yaml`).

Each renderer's body schema is documented in `docs/renderers/`.

| Renderer | Body |
|---|---|
| `chart` | YAML: bar, line, pie and scatter charts (`docs/renderers/chart.md`) |
| `map` | YAML: `center`, `zoom`, `markers`, `regions`, `tiles`, … (`docs/renderers/map.md`) |
| `embed` | YAML: `src`, optional `fallback` image, `zoom`, `title` (`docs/renderers/embed.md`) |
| `mermaid` | text: a Mermaid diagram (`docs/renderers/mermaid.md`) |
| `math` | text (TeX, display mode). Same as `$$…$$`; typeset when the deck is built (§12) |

Plugins add renderers of their own (`docs/plugins.md`).

Any other fence language is a **code block**, syntax-highlighted. Its info
string may carry an attribute block too: ```` ```js {.big @2} ````.

- Highlighting happens when the deck is built, with
  [shiki](https://shiki.style) and the same grammars as VS Code, so the page
  ships coloured text and no highlighter.
- The language is the fence's first word (`ts`, `python`, `sh`, …; the usual
  aliases work). `text`, or no language at all, means plain code. A language
  shiki doesn't know is a warning, and the block is shown as plain code.
- Colours come from the theme's `code-*` tokens, so code
  matches the deck.

GFM tables take `.sortable`, `.zebra` and `reveal=rows` through a standalone
attribute block (§4.2). A `.sortable` table is enhanced in place by the
`table` renderer, but it stays an ordinary table in the page. See
`docs/renderers/table.md`.

### 8.1 `lines`: walking through code

`lines=` puts some lines of a code block in focus and dims the rest. Groups
separated by `|` are successive steps:

````markdown
```js {lines="1|2-3|5,7|all"}
…
```
````

- A group is line numbers (from 1) and ranges, separated by commas. `all`
  (or `*`) means no line is dimmed.
- The first group shows with the block (from slide entry, or from the
  block's own `@`). Each later group is one more step, counted like
  `reveal=` (§6.4): from the block's `@` if it has one, else from the
  previous annotated element. For `@+` and `@=` after it, the block counts
  as its last group's step.
- The focus moves smoothly going forwards and snaps going backwards, like
  emphasis effects (§6.3). PDFs print each page's group.
- `lines=` on anything but a code block is an error; a line number past the
  end of the block is a warning.

---

## 9. Slide transitions

| Name | Motion |
|---|---|
| `none` | Instant cut |
| `fade` | Cross-fade |
| `zoom` | New slide scales up from the centre over the old |
| `push-left` / `-right` / `-up` / `-down` | Both slides move together in that direction |
| `cover-left` / `-right` / `-up` / `-down` | New slide slides in over the stationary old one |
| `uncover-left` / `-right` / `-up` / `-down` | Old slide slides away, uncovering the new one beneath |
| `auto-animate` | Elements shared by both slides move from their old place to their new one; the rest cross-fades (below) |

- A slide's `transition` controls how that slide is **entered**. Going backwards
  from slide *n* to slide *n − 1* plays slide *n*'s transition mirrored, so
  forwards and backwards feel like the same motion.
- Jumps follow the same rule: jumping forward (`End`, the overview, `G`)
  plays the destination slide's transition, and jumping back plays the
  departed slide's, mirrored.
- Without `transition-dur`, the theme's duration applies (its
  `transition-dur` token; aurora uses 550 ms).
- Resolution order: slide frontmatter → first-heading shorthand → deck
  `transition` → `fade`.
- Under reduced motion, every transition is `none`.

### 9.1 `auto-animate`

An `auto-animate` slide is entered by moving each element it shares with the
previous slide from where it was to where it is now, resizing it on the way,
while everything else cross-fades. It's how a title shrinks into a heading, a
card slides across, or a list grows by one item without the others jumping.

```markdown
# The plan

---
transition: auto-animate
---

## The plan

- Collect
- Clean
```

Elements are paired in this order:

1. **By `key=`.** `{key=logo}` on both slides makes them the same element,
   whatever they contain: `![](./logo.png){key=logo}`, `::: card {key=card}`,
   `[42%]{key=figure}`, or a render block (```` ```chart {key=sales} ````).
   A key is per slide; using one twice on a slide is a warning, and only the
   first pairs. A keyed element pairs only by its key.
2. **By content.** Headings with the same text pair (at any level, so `#`
   can become `##`); so do paragraphs, list items, block quotes and tables
   with the same tag and text, code blocks in the same language (see magic
   move, below), and images with the same source.
   When a slide has several identical ones, they pair in order.

- Only elements the slides show pair: on the new slide, that's what's
  visible at the step you arrive at (step 0 going forwards, the last step
  going backwards, §6.1).
- Pairs don't nest. Once an element pairs, its contents move with it and
  don't pair on their own.
- Text is lined up by its glyphs and scaled by its font size; images and
  render blocks by their box. A box that only moves keeps its text size.
- Going backwards morphs the same way, from the slide you're on to the one
  you arrive at. `transition-dur` sets the duration, as for any transition.
- HTML `id`s can't pair elements, because every slide lives in one document
  and ids must be unique across the deck; that's what `key=` is for.

**Magic move.** Code blocks pair by language (the first `ts` block with the
first `ts` block, and so on), or by `key=`. When two paired blocks differ,
their tokens morph: code that stayed moves to its new place, code that went
away fades out where it was, and new code fades in. Step through a program
by writing each version on its own `auto-animate` slide:

````markdown
```ts
function add(a, b) {
```

---
transition: auto-animate
---

```ts
function add(a: number, b: number): number {
```
````

The moving code stays at full strength while the rest of the slide
cross-fades. A longer `transition-dur` (800 ms or so) suits bigger changes.

---

## 10. Layouts

Set with `layout:` in slide frontmatter, or `{layout=…}` on the slide's first
heading (§3.2). Without it, a slide uses `default`, except **slide 1, which
uses `title`** (§2.5). An unknown layout name is a warning, and the slide uses
`default`.

A layout declares **named slots**. A **top-level** container whose name
matches a slot fills that slot. Everything else goes to the layout's **main**
slot:

```markdown
---
layout: two-col
---

# Two ways to read it

::: left
The argument.
:::

::: right
```chart
…
```
:::
```

Here the heading goes to the main slot, which `two-col` places above the two
columns.

| Layout | Named slots | Main slot holds |
|---|---|---|
| `title` | — | Title, subtitle, byline; centred |
| `section` | — | A section divider heading; centred |
| `default` | — | Everything, top to bottom |
| `two-col` | `left`, `right` | A heading spanning both columns |
| `three-col` | `left`, `middle`, `right` | A heading spanning all three |
| `quote` | — | A blockquote, set large; a paragraph after it is the attribution |
| `stat-grid` | — | A heading, then each container (`::: stat`, say) becomes one stat: its first paragraph is the figure, the rest the caption |
| `full-bleed` | — | The first image or render block covers the whole canvas; the rest is overlaid |
| `image-left`, `image-right` | `image` | The text beside the image. The `image` slot fills its half edge to edge |
| `code` | — | A heading and a code block that fills the slide |
| `end` | — | Closing words; centred |

- Slot containers take attributes like any container: `::: right {@2}`
  brings the whole column in at step 2. Their name doesn't become a class.
- Only top-level containers fill slots. A nested `::: left` (inside
  `::: columns`, say) is an ordinary `<div class="left">`, with no warning.
- A top-level container using a slot name the slide's layout doesn't have is a
  warning, and the container stays an ordinary `<div>`. So is filling the
  same slot twice: the second container stays a `<div>`.
- Build steps number in document order, regardless of where a slot puts the
  content.
- Themes style the layouts. In the page, each slot is a
  `<div class="blitz-slot" data-slot="…">`, and the main slot's name is
  `main`; the slide carries `data-layout="…"`.

---

## 11. IDs

- Explicit `#id`s must be unique across the **deck**, not just the slide,
  since the whole deck is one HTML document. Duplicates are an error.
- Headings get no automatic `id`. Only explicit ones are emitted. (Slide ids
  come from heading text, §2.4, but aren't set as heading `id`s.)

---

## 12. Math

Math is written in TeX between dollar signs and rendered with KaTeX. The rules
are **Pandoc's `tex_math_dollars` extension**, adopted unchanged: they are the
most widely used convention for dollar-sign math in Markdown, so decks written
for Pandoc work here as they are. Credit: [Pandoc User's Guide, "Math"
extension `tex_math_dollars`](https://pandoc.org/MANUAL.html#extension-tex_math_dollars).

**Inline math:** `$…$`

- The opening `$` must have a non-space character immediately to its right.
- The closing `$` must have a non-space character immediately to its left, and
  must **not** be followed immediately by a digit.
- So prices in prose are left alone: in `from $20,000 to $30,000`, neither `$`
  pair qualifies, and the text stays as written.
- `\$` is always a literal dollar sign.

**Display math:** `$$…$$`, which may span lines. Equivalent to a ```` ```math ````
fence (§8). Use the fence when you want attributes such as a build step.

Math spans take attributes like any other inline element: `$E=mc^2${.pop @2}`.

Math is typeset when the deck is built, so the page carries the finished
formulas (with MathML alongside, for screen readers), KaTeX's stylesheet
and its fonts, but no TeX engine:

- A static build copies KaTeX's fonts into `assets/katex/`; the browser
  loads only the ones a slide needs.
- A standalone file inlines only the font families its formulas use
  (roughly 150–250 kB for typical math).
- TeX that KaTeX can't read is a warning at its line, and the slide shows
  the source in red instead of a formula.
- KaTeX supports most of LaTeX's math mode; see its [list of supported
  functions](https://katex.org/docs/supported).

A literal dollar where these rules would see math is written `\$`.

---

## Acknowledgements

blitzstrahl's syntax borrows deliberately from existing conventions so authors
don't have to learn a new dialect:

- **[Pandoc](https://pandoc.org/MANUAL.html)**: the `{#id .class key=val}`
  attribute syntax (§4), bracketed spans `[text]{...}`, fenced divs `:::` (§5),
  `::: notes` for presenter notes (§7), and the `tex_math_dollars` rules for
  math (§12). blitzstrahl's additions are the `@` build-step token and the
  rules in §4.2 that decide which element a `{...}` attaches to.
- **[CommonMark](https://spec.commonmark.org/)** and **[GitHub Flavored
  Markdown](https://github.github.com/gfm/)**: the base language (§1).
- **[remark / unified](https://unifiedjs.com/)**: the parser.
