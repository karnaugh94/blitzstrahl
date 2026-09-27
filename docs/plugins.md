# blitzstrahl plugin API

> From 1.0, everything this document describes follows semver: removing or
> changing it is a major version (§4).

A deck can be extended in four ways, and only these four:

| Extension | What it adds | Declared with |
|---|---|---|
| **Renderers** | A new fence language: ```` ```poll ```` | `definePlugin({ renderers })` |
| **Effects** | New build-step effect classes: `{.wobble @2}` | `definePlugin({ effects })`, or plain CSS |
| **Frontmatter keys** | Deck keys a plugin reads | `definePlugin({ frontmatter })` |
| **Themes** | Tokens, CSS and fonts | `defineTheme()` |

Deliberately **not** extensible in 1.0: markdown syntax (no remark plugins:
the syntax is the contract, and a plugin that changes it makes decks
unreadable elsewhere), transitions, layouts, and the presenter view. Each
could be added later in a minor version, since adding one breaks nothing.

---

## 1. Using plugins and themes

```yaml
---
title: Launch review
theme: broadsheet
plugins:
  - blitzstrahl-plugin-poll
  - ./plugins/sparkline.js
---
```

- **`plugins`**: a list of module specifiers. A bare name
  (`blitzstrahl-plugin-poll`) is resolved the way Node resolves an import
  written in the deck's folder, so it comes from the deck's own
  `node_modules`. A path starting `./` or `../` is relative to the markdown
  file.
- **`theme`**: a built-in name (`aurora`, `broadsheet`), a package, or a path.
  A bare name that isn't built in is tried as `blitzstrahl-theme-<name>`,
  then as `<name>`. So `theme: acme` finds `blitzstrahl-theme-acme`.
- A plugin or theme that can't be found, loaded or validated is an
  **error**, reported at its frontmatter key (`deck.md:3:1`). `build`
  refuses the deck. `dev` still serves it, with aurora in place of a broken
  theme and without the broken plugin.
- Plugins load in the order listed. Two plugins that register the same name
  are an error, and so is a plugin name that shadows a built-in.

**Trust.** A plugin is code. Its Node half runs with full permissions
whenever the deck is built, checked or served, and its browser half runs in
the page. Treat installing one like installing any other npm dependency.

---

## 2. Writing a plugin

A plugin is an ES module whose default export is `definePlugin(...)`:

```js
// blitzstrahl-plugin-poll/index.js
import { definePlugin } from 'blitzstrahl/plugin'

export default definePlugin({
  name: 'poll',
  renderers: {
    poll: {
      body: 'yaml',
      browser: new URL('./poll.browser.js', import.meta.url),
      check: (spec) => (Array.isArray(spec?.options) ? undefined : '`options` must be a list'),
    },
  },
  effects: {
    wobble: {
      kind: 'entrance',
      keyframes: [
        { opacity: 0, transform: 'rotate(-8deg)' },
        { opacity: 1, transform: 'rotate(4deg)', offset: 0.6 },
        { opacity: 1, transform: 'none' },
      ],
      box: true,
    },
  },
  frontmatter: {
    'poll-endpoint': { check: (v) => (typeof v === 'string' ? undefined : 'must be a URL') },
  },
})
```

`definePlugin` only adds types. The CLI checks whatever a plugin exports, so
a local `./plugin.js` next to a deck can export a plain object and doesn't
need `blitzstrahl` installed where it lives.

Plugins are ES modules. Name a local one `.mjs`, or put it in a folder whose
`package.json` says `"type": "module"`: otherwise Node warns that it had to
guess the module format.

Every plugin has two halves:

- The **Node half** is the module above. The CLI imports it to parse, check
  and build the deck. It may use Node APIs, and it never reaches the page.
- The **browser half** is each renderer's `browser` module. It's bundled
  into the deck (its own lazy chunk in a static build, inlined in a
  standalone one), and only when the deck uses that renderer. It must not
  use Node APIs.

### 2.1 `definePlugin(options)` *(stable)*

| Field | Type | |
|---|---|---|
| `name` | string | Required. Shown in diagnostics. |
| `renderers` | `Record<string, RendererDef>` | Optional |
| `effects` | `Record<string, EffectDef>` | Optional |
| `frontmatter` | `Record<string, KeyDef>` | Optional |

Renderer, effect and key names are lowercase kebab-case
(`/^[a-z][a-z0-9-]*$/`). Unknown fields are an error, so a typo doesn't
silently do nothing.

### 2.2 Renderers

```ts
interface RendererDef {
  /** How the fence body is read (syntax.md §8). */
  body: 'yaml' | 'text'
  /** The browser module: its default export is a `Renderer`. */
  browser: URL | string
  /**
   * Called whenever the deck is loaded (build, check, dev). Return a
   * message to report an error at the fence, or nothing. May be async.
   */
  check?(spec: unknown, ctx: CheckCtx): string | undefined | Promise<string | undefined>
}

interface CheckCtx {
  /** Text of a deck-relative data file, or undefined if it's missing. */
  readData(path: string): string | undefined
}
```

A fence written in the renderer's language becomes a render block, like any
built-in one. It takes steps and effects the same way
(```` ```poll {@2 .fade-up} ````), gets overflow detection, and prints in PDFs.
A `browser` given as a string is resolved relative to the plugin module.

A YAML body's strings starting `./` or `../` are deck-relative paths
(syntax.md §8), whichever field they're in: they're rewritten relative to
the deck, watched in dev, and data files are inlined by builds. Read them
with `ctx.loadAsset(path)` (text) or `ctx.assetUrl(path)` (images).

The browser module implements the same contract as the built-in renderers:

```ts
import type { Renderer } from 'blitzstrahl/renderer'

const poll: Renderer = {
  mount(el, spec, ctx) {
    el.textContent = ctx.meta['poll-endpoint'] as string
    return {
      update(step) {},  // the owning slide's step changed
      resize() {},      // the canvas scale changed
      destroy() {},     // restore `el` to empty
      ready: Promise.resolve(), // optional: PDF export waits for it
    }
  },
}
export default poll
```

`RenderCtx` *(stable)*:

| Member | |
|---|---|
| `block` | The block's `id`, `renderer`, `spec`, `step` and `anim` (IR v1) |
| `token(name)` | A theme token's value, e.g. `token('--blitz-chart-1')`. Use these colours so the output matches the deck. |
| `reducedMotion` | `true` under `prefers-reduced-motion`, and when the block must appear already drawn. Don't animate. |
| `loadAsset(path)` | The text of a deck-relative asset (inlined by builds) |
| `assetUrl(path)` | The URL an asset (an image) is served from |
| `meta` | The values of frontmatter keys registered by plugins, by name |
| `lang` | The deck's `lang` (default `en`). Write numbers and dates for it: `new Intl.NumberFormat(ctx.lang)` *(1.1)* |
| `number(text, thousands?)` | A number from data, read as the built-in renderers read it (`'3.5'` is 3.5; the deck's `thousands`, or the one given), or `undefined` if the text isn't one *(1.1)* |

The rules the built-in renderers follow apply to plugins too. They're
requirements, not suggestions:

1. **Remount on every slide entry.** `mount` runs each time the slide is
   entered and `destroy` each time it's left. Don't animate before `mount`.
2. **`destroy` restores `el`** to how `mount` found it: empty.
3. **Resize in `resize()`.** The canvas is CSS-scaled, so render at canvas
   (logical) pixels. Prefer SVG or DOM to `<canvas>`, which blurs when the
   canvas is scaled up.
4. **Resolve `ready`** once the output is complete, if that happens after
   `mount` returns (e.g. tiles loading). Export waits for it.

### 2.3 Effects

```ts
type EffectDef =
  | { kind: 'entrance'; keyframes: Keyframe[]; box?: boolean }
  | { kind: 'emphasis'; active: string; base?: string }
```

- **Entrance** effects are WAAPI keyframes ending in the element's resting
  state. `dur`, `delay` and `ease` apply as for built-ins, and stepping
  backwards snaps back (or reverses, with `reverse=true`). Set `box: true`
  if the keyframes transform the element: inline elements then become
  `inline-block`, since transforms don't apply to inline boxes.
- **Emphasis** effects are a CSS state: `active` holds the declarations
  applied while the effect is on (`color: var(--blitz-accent)`), and
  `base` any that always apply. The change is a CSS transition timed by
  `dur`, `delay` and `ease`, and it snaps when stepping backwards, like
  `highlight`.

**Without a plugin**, a deck's `<style>` or theme CSS can define
`@keyframes blitz-<name>`, and `.<name>` then works as an entrance effect
(syntax.md §6.3). The plugin API is for effects shared between decks.

Under `prefers-reduced-motion`, every effect, custom ones included, is an
instant reveal.

### 2.4 Frontmatter keys

```ts
interface KeyDef {
  /** Return a message to report a warning at the key, or nothing. */
  check?(value: unknown): string | undefined
}
```

A registered key is no longer an "unknown key" warning. Its value is passed to every renderer as `ctx.meta[name]`, and it's included
in the page. Don't put secrets in frontmatter. Only deck frontmatter can be
extended in 1.0; slide frontmatter can't.

**Reserved names.** blitzstrahl 1.1 gives meaning to these deck keys, so a
plugin can't register them: `css`, `background`, `footer`,
`slide-numbers`, `logo`, `duration` and `public`.

---

## 3. Writing a theme

```js
// blitzstrahl-theme-acme/index.js
import { defineTheme } from 'blitzstrahl/theme'

export default defineTheme({
  name: 'acme',
  tokens: { bg: '#fbfaf7', fg: '#1a1a1a', 'fg-muted': '#6b6b6b', accent: '#c2410c', /* chart-1 … chart-8 */ },
  css: `.blitz-slide h1 { font-family: var(--blitz-font-serif); }`,
  fonts: [
    { family: 'Fraunces', src: new URL('./fonts/fraunces.woff2', import.meta.url), weight: '300 900' },
  ],
})
```

| Field | |
|---|---|
| `name` | Required |
| `tokens` | Become `:root { --blitz-<name>: value }`. The **token names are the contract** (§3.1). A missing required token is an error, and an unknown one is a warning. |
| `css` | Styles for slide content. Scope every rule to `.blitz-slide` or `[data-layout]`: bare `h1` or `table` would also style the overlays and the presenter view. |
| `fonts` | `@font-face`s: `{ family, src, weight?, style? }`. `src` is a file URL or a path relative to the theme module. Files are copied into static builds and inlined into standalone ones. |

Before the theme's `css`, every slide already gets `color: var(--blitz-fg)`,
`background-color: var(--blitz-bg)` and the `text` size in `font-sans`, and
every render block (chart, map, embed) is full width and `block-height`
tall. A theme that's only tokens still looks coherent.

Layout geometry (where the slots of `two-col` go) is shared by every theme
and isn't part of a theme. Themes style the layouts through
`[data-layout="…"]` and the slot elements.

### 3.1 Tokens

The complete list, with defaults and what reads each token, is in
`docs/themes.md`. Required: `bg`, `fg`, `fg-muted`, `accent` and the chart
palette `chart-1` … `chart-8`. Renderers read these from script, so they
need real colours. Every other token has a default. New tokens can be added
in minor versions, always with a default, so an older theme keeps working.

---

## 4. Stability and versioning

Stable from 1.0, changed only in a major version:

- the frontmatter keys `plugins` and `theme`, and how they resolve (§1)
- `definePlugin`, `defineTheme` and every field in the tables above
- `Renderer`, `RenderInstance` and `RenderCtx`
- theme token names
- IR v1 as seen by renderers (`ctx.block`)

Minor versions may add optional fields, new `RenderCtx` members, tokens with
defaults, and new extension points. A plugin written for 1.x works on every
later 1.x.

The public entry points are `blitzstrahl/plugin`, `blitzstrahl/theme` and
`blitzstrahl/renderer` (types). Anything else the package exports is
internal and may change in any release.
