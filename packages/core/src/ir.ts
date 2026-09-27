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

export type AssetKind = 'image' | 'data' | 'font' | 'other'

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
