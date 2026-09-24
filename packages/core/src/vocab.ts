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

/** syntax.md §4.3 */
export const ANIM_KEYS = new Set(['dur', 'delay', 'ease', 'reverse', 'from', 'cps'])
export const SLIDE_SHORTHAND_KEYS = new Set(['transition', 'transition-dur', 'layout', 'background'])
export const PASSTHROUGH_KEYS = new Set(['style', 'title', 'lang', 'dir', 'width', 'height', 'alt'])
/** Reserved for a later milestone: accepted with a "not yet supported" warning. */
export const RESERVED_KEYS: Readonly<Record<string, string>> = { key: 'M4', lines: 'M4' }

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

/** Milestones implemented by this build. */
export const SUPPORTED_MILESTONES = new Set(['M1', 'M2', 'M3'])

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
