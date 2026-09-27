/**
 * The renderer contract (PLAN §3). Renderers are lazy-loaded: the runtime
 * only ever sees a loader per renderer name, so no renderer — including the
 * built-in chart — is in the main bundle.
 */
import type { PayloadSlide } from '@blitzstrahl/core'
import type { Thousands } from '@blitzstrahl/core/numbers'

export type BlockData = PayloadSlide['blocks'][number]

export interface RenderCtx {
  block: BlockData
  /** Read a theme token, e.g. `token('--blitz-chart-1')`. */
  token(name: string): string
  /** True under `prefers-reduced-motion: reduce`: render without animating. */
  reducedMotion: boolean
  /** Text of a deck-relative asset (inlined by the build, else fetched). */
  loadAsset(path: string): Promise<string>
  /** The URL the page serves a deck-relative asset (an image) from. */
  assetUrl(path: string): string
  /** Values of the deck frontmatter keys plugins register, by name (docs/plugins.md §2.4). */
  meta: Readonly<Record<string, unknown>>
  /** The deck's `lang` (default `en`): write numbers and dates for it. */
  lang: string
  /**
   * A number from data, read as the built-in renderers read it: plain
   * (`3.5`), or as `thousands` (default: the deck's) says. Undefined if
   * `text` isn't one written that way.
   */
  number(text: string, thousands?: Thousands): number | undefined
}

export interface RenderInstance {
  /** Called on every state change of the owning slide. */
  update(step: number): void
  /** The canvas scale changed. */
  resize(): void
  destroy(): void
  /**
   * Resolves when the output is complete, e.g. a map's tiles have loaded.
   * PDF export waits for it. Absent means complete once mounted.
   */
  readonly ready?: Promise<void>
}

export interface Renderer {
  mount(el: HTMLElement, spec: unknown, ctx: RenderCtx): RenderInstance | Promise<RenderInstance>
}

export type RendererLoader = () => Promise<Renderer | { default: Renderer }>
