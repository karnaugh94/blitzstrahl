/**
 * The Deck IR — the contract between the parser and everything downstream
 * (renderers, exporters, themes, plugins, presenter view).
 *
 * Consumers must never read raw markdown; they read this. After 1.0 any
 * incompatible change here is a major version bump and an `irVersion` bump.
 *
 * Semantics of every field trace back to `docs/syntax.md`; section numbers
 * below refer to it.
 */
import type { ElementContent } from 'hast'
import type { Thousands } from './numbers.js'

export const IR_VERSION = 1

/** hast content node. Kept as an alias so the IR does not re-export hast wholesale. */
export type HastNode = ElementContent

/** 1-based position in the source markdown (syntax.md §1). */
export interface SourcePoint {
  line: number
  column: number
}

export interface SourceSpan {
  start: SourcePoint
  end: SourcePoint
}

export interface Deck {
  irVersion: typeof IR_VERSION
  /** Path of the markdown file, as given to the parser; used in diagnostics. */
  source: string
  meta: DeckMeta
  slides: Slide[]
  assets: AssetRef[]
}

/** Deck frontmatter (§3.1), resolved with defaults applied. */
export interface DeckMeta {
  title: string
  author?: string
  date?: string
  lang: string
  /** How the deck's data groups thousands, if not plainly (§3.1, 1.1). */
  thousands?: Thousands
  theme: string
  canvas: { width: number; height: number }
  transition: TransitionSpec
  /** `public`: a folder served and copied as it is, deck-relative and normalised (`demos`) (syntax.md §3.5, 1.1). */
  public?: string
  /**
   * `background`: every slide's, or one per layout name (`default` for the
   * rest), as written (syntax.md §3.6, 1.1). Already applied to each slide's
   * `attrs.background` where the slide sets none.
   */
  background?: string | Record<string, string>
  /** `footer`: one line of inline markdown, as HTML (syntax.md §3.6, 1.1). */
  footer?: HastNode[]
  /** `slide-numbers` as a template: `{n}` the slide's number, `{total}` the count. `true` is `{n}` (1.1). */
  slideNumbers?: string
  /** `logo`: an image, as written; a local one is also in `assets` (1.1). */
  logo?: string
  /** `duration`: how long the talk should take, in ms (presenting.md, *Pacing*; 1.1). */
  duration?: number
  /** `pace-margin`, in ms: how far behind the clock the presenter may fall before the pace bar warns. Only with `duration` (1.1). */
  paceMargin?: number
  /** `blitzstrahl`: the version the deck is written for, `major.minor` as written (syntax.md §3.1, 1.1). */
  blitzstrahl?: string
  /** `css`: stylesheets after the theme's, `./paths` as written (docs/themes.md, 1.1). */
  css?: string[]
  /** Plugin module specifiers, as written (docs/plugins.md §1). */
  plugins: string[]
  /** Frontmatter keys that aren't built in, including those plugins register. */
  extra: Record<string, unknown>
}

export interface Slide {
  /** Stable, deck-unique slug (§2.4). Used in URLs and presenter sync. */
  id: string
  /** 0-based position in the deck. */
  index: number
  /** Plain text of the first heading, if any. */
  title?: string
  /** Layout name (§10). */
  layout: string
  /** Transition used to enter this slide, fully resolved (§9). */
  transition: TransitionSpec
  attrs: SlideAttrs
  /**
   * Highest step on this slide, N (§6.1). States run 0…N; 0 means no build
   * steps.
   */
  steps: number
  /** Presenter notes (§7). Never rendered to the audience. */
  notes: HastNode[]
  /**
   * Audience-facing content, as layout slots (§10): every top-level node is a
   * `<div class="blitz-slot" data-slot="…">`. The `main` slot comes first
   * (omitted when empty), then named slots in document order.
   * Stepped elements carry `data-blitz-step-in` and
   * optionally `data-blitz-step-out` (last visible step, inclusive), plus
   * `data-blitz-anim` referencing `Slide.anims`. Render blocks appear as
   * `<div data-blitz-block="<RenderBlock.id>">` placeholders, which the
   * renderer fills, except blocks that enhance authored HTML (a sortable
   * `<table>`): that element carries `data-blitz-enhance="<RenderBlock.id>"`.
   */
  content: HastNode[]
  /** Animation specs referenced from `content` by index. */
  anims: AnimSpec[]
  /** Blocks to hydrate with a renderer (§8). */
  blocks: RenderBlock[]
  span: SourceSpan
}

/** Slide-level settings from frontmatter or first-heading shorthand (§3.2). */
export interface SlideAttrs {
  background?: string
  /** `chrome: false`: no footer, number or logo on this slide (syntax.md §3.6, 1.1). */
  chrome?: false
  class: string[]
  style?: string
  /** Unknown frontmatter keys, kept for plugins. */
  extra: Record<string, unknown>
}

export interface TransitionSpec {
  name: TransitionName
  /** Milliseconds; absent means theme default. */
  dur?: number
}

export type Direction = 'left' | 'right' | 'up' | 'down'

export type TransitionName =
  | 'none'
  | 'fade'
  | 'zoom'
  | `push-${Direction}`
  | `cover-${Direction}`
  | `uncover-${Direction}`
  | 'auto-animate'

/** When an element is visible / its effect applies (§6.2), resolved to numbers. */
export interface StepRange {
  /** Step at which the element enters (or its emphasis applies). 0 = on entry. */
  in: number
  /** Last step it remains; absent means until the slide is left. */
  out?: number
}

export type EffectKind = 'entrance' | 'emphasis'

/** §6.3. Built-in effect names are listed in syntax.md; plugins may add more. */
export interface AnimSpec {
  effect: string
  kind: EffectKind
  dur?: number
  delay?: number
  /** Named easing or a CSS easing function string. */
  ease?: string
  /** Play in reverse when stepping backwards instead of snapping. */
  reverse?: boolean
  /** Effect-specific options (`from`, `cps`, …), unparsed. */
  options: Record<string, string>
}

export interface RenderBlock {
  /** Deck-unique id, matching the `data-blitz-block` placeholder. */
  id: string
  /** Renderer name: 'chart' | 'map' | 'embed' | 'table' | 'mermaid' | plugin names. (Math is typeset at build time, not a block.) */
  renderer: string
  /** Fence body exactly as written; empty for blocks that enhance authored HTML. */
  source: string
  /**
   * Parsed body. For YAML-bodied renderers this is the parsed value with
   * asset paths rewritten; for text-bodied renderers it equals `source`.
   * Renderer-owned: opaque to core.
   */
  spec: unknown
  step?: StepRange
  anim?: AnimSpec
  span: SourceSpan
}

/** `media`: video and audio (1.1). */
export type AssetKind = 'image' | 'media' | 'data' | 'font' | 'other'

export interface AssetRef {
  /** Path exactly as written in the markdown. */
  ref: string
  /** Resolved path, relative to the deck file's directory. */
  path: string
  kind: AssetKind
  /** Where it was referenced, for diagnostics like "missing image". */
  span: SourceSpan
}

export type Severity = 'error' | 'warning' | 'info'

/**
 * Parser output is `{ deck, diagnostics }`; diagnostics are not part of the
 * IR itself. Rendered as `file:line:column` (§1).
 */
export interface Diagnostic {
  severity: Severity
  /** Stable machine-readable code, e.g. 'attr/unknown-token'. */
  code: string
  message: string
  file: string
  span: SourceSpan
}
