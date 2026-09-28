/**
 * The fixed vocabulary of the syntax: effect names, attribute keys, renderer
 * names, transitions, layouts. One place, so the spec and the parser can't
 * drift apart silently.
 */
import type { EffectKind, TransitionName } from './ir.js'

/** syntax.md §6.3 */
export const EFFECTS: Readonly<Record<string, EffectKind>> = {
  fade: 'entrance',
  'fade-up': 'entrance',
  'fade-down': 'entrance',
  'fade-left': 'entrance',
  'fade-right': 'entrance',
  pop: 'entrance',
  zoom: 'entrance',
  'blur-in': 'entrance',
  'slide-in-up': 'entrance',
  'slide-in-down': 'entrance',
  'slide-in-left': 'entrance',
  'slide-in-right': 'entrance',
  draw: 'entrance',
  'count-up': 'entrance',
  typewriter: 'entrance',
  highlight: 'emphasis',
  strike: 'emphasis',
  'dim-others': 'emphasis',
}

/** syntax.md §3.2: what slide frontmatter can set. A block needs one of these to be frontmatter (§2.3). */
export const SLIDE_KEY_NAMES = ['id', 'layout', 'transition', 'transition-dur', 'background', 'class', 'style', 'chrome'] as const
export type SlideKey = (typeof SLIDE_KEY_NAMES)[number]
export const SLIDE_KEYS: ReadonlySet<string> = new Set(SLIDE_KEY_NAMES)

/**
 * Deck keys blitzstrahl 1.1 will give meaning to (PLAN §16). Reserved from
 * 1.0.1, so no plugin registers one first and breaks when it arrives. Each
 * leaves this list for `DECK_KEYS` when it's built.
 */
export const RESERVED_DECK_KEYS: ReadonlySet<string> = new Set(['duration'])

/** What `as=` can go on (syntax.md §5.1). */
export type ComponentTarget = 'list' | 'table' | 'container'

/** syntax.md §5.1: built-in components, and the blocks each can be made from. */
export const COMPONENTS: Readonly<Record<string, readonly ComponentTarget[]>> = {
  steps: ['list'],
  timeline: ['list'],
  chevrons: ['list'],
  flow: ['list', 'container'],
  cards: ['list', 'container'],
  compare: ['table', 'container'],
  stats: ['container'],
}

/** syntax.md §4.3 */
export const ANIM_KEYS = new Set(['dur', 'delay', 'ease', 'reverse', 'from', 'cps'])
export const SLIDE_SHORTHAND_KEYS = new Set(['transition', 'transition-dur', 'layout', 'background'])
export const PASSTHROUGH_KEYS = new Set(['style', 'title', 'lang', 'dir', 'width', 'height', 'alt'])
/** Reserved for a later milestone: accepted with a "not yet supported" warning. */
export const RESERVED_KEYS: Readonly<Record<string, string>> = {}

export const NAMED_EASINGS = new Set(['linear', 'in', 'out', 'in-out', 'out-expo', 'in-out-expo', 'out-back'])

export type RendererBody = 'yaml' | 'text'

/** syntax.md §8. `since` is the milestone the renderer lands in. */
export const RENDERERS: Readonly<Record<string, { body: RendererBody; since: string }>> = {
  chart: { body: 'yaml', since: 'M1' },
  map: { body: 'yaml', since: 'M3' },
  embed: { body: 'yaml', since: 'M3' },
  mermaid: { body: 'text', since: 'M4' },
  math: { body: 'text', since: 'M4' },
}

/**
 * What plugins add to the vocabulary (docs/plugins.md). Names that clash
 * with built-ins are rejected before they get here.
 */
export interface Extensions {
  renderers?: Readonly<Record<string, { body: RendererBody }>>
  effects?: Readonly<Record<string, EffectKind>>
  /** Deck frontmatter keys: no longer "unknown". */
  keys?: readonly string[]
}

/** Milestones implemented by this build. */
export const SUPPORTED_MILESTONES = new Set(['M1', 'M2', 'M3', 'M4'])

const DIRECTIONS = ['left', 'right', 'up', 'down'] as const

/** syntax.md §9 */
export const TRANSITIONS: ReadonlySet<TransitionName> = new Set<TransitionName>([
  'none',
  'fade',
  'zoom',
  'auto-animate',
  ...DIRECTIONS.flatMap((d) => [`push-${d}`, `cover-${d}`, `uncover-${d}`] as const),
])

/**
 * syntax.md §10: built-in layouts and their named slots. Content outside a
 * named slot goes to the layout's main slot, which every layout has.
 */
export const LAYOUTS: Readonly<Record<string, readonly string[]>> = {
  title: [],
  section: [],
  default: [],
  'two-col': ['left', 'right'],
  'three-col': ['left', 'middle', 'right'],
  quote: [],
  'stat-grid': [],
  'full-bleed': [],
  'image-left': ['image'],
  'image-right': ['image'],
  code: [],
  end: [],
}

/** Every slot name of any layout: a top-level container with one of these names is a slot fill. */
export const SLOT_NAMES: ReadonlySet<string> = new Set(Object.values(LAYOUTS).flat())
