/**
 * `blitzstrahl/plugin`: the plugin contract (docs/plugins.md). Stable from
 * 1.0. `definePlugin` only checks types: the CLI validates what a plugin
 * exports whether or not it was made with it, so a plugin that can't import
 * `blitzstrahl` (a local `./plugin.js` next to a deck) works the same.
 */

export interface PluginDefinition {
  /** Shown in diagnostics. */
  name: string
  /** Fence languages this plugin renders (docs/plugins.md §2.2). */
  renderers?: Record<string, RendererDef>
  /** Build-step effects (§2.3). */
  effects?: Record<string, EffectDef>
  /** Deck frontmatter keys this plugin reads (§2.4). */
  frontmatter?: Record<string, KeyDef>
}

export interface RendererDef {
  /** How the fence body is read (syntax.md §8). */
  body: 'yaml' | 'text'
  /** The browser module, whose default export is a `Renderer`: a `file:` URL, or a path relative to the plugin module. */
  browser: string | URL
  /** Report a problem with a block, at its fence: return a message, or nothing. Run by `check` and `build`. */
  check?(spec: unknown, ctx: CheckCtx): string | undefined | Promise<string | undefined>
}

export interface CheckCtx {
  /** Text of a deck-relative data file, or undefined if it's missing. */
  readData(path: string): string | undefined
}

export type EffectDef = EntranceEffect | EmphasisEffect

export interface EntranceEffect {
  kind: 'entrance'
  /** WAAPI keyframes, ending in the element's resting state. */
  keyframes: Keyframe[]
  /** The keyframes transform the element: inline elements become `inline-block`. */
  box?: boolean
}

export interface EmphasisEffect {
  kind: 'emphasis'
  /** CSS declarations while the effect is active, e.g. `color: var(--blitz-accent)`. */
  active: string
  /** CSS declarations always applied to the element, e.g. a resting `background`. */
  base?: string
}

/** A WAAPI keyframe: CSS properties in camelCase, plus `offset` and `easing`. */
export type Keyframe = Record<string, string | number | null | undefined>

export interface KeyDef {
  /** Report a problem with the value, at its key: return a message, or nothing. */
  check?(value: unknown): string | undefined
}

export function definePlugin<T extends PluginDefinition>(plugin: T): T {
  return plugin
}
