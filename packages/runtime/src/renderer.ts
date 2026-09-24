/**
 * The renderer contract (PLAN §3). Renderers are lazy-loaded: the runtime
 * only ever sees a loader per renderer name, so no renderer — including the
 * built-in chart — is in the main bundle.
 */
import type { PayloadSlide } from '@blitzstrahl/core'

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
}

export interface RenderInstance {
  /** Called on every state change of the owning slide. */
  update(step: number): void
  /** The canvas scale changed. */
  resize(): void
  destroy(): void
}

export interface Renderer {
  mount(el: HTMLElement, spec: unknown, ctx: RenderCtx): RenderInstance | Promise<RenderInstance>
}

export type RendererLoader = () => Promise<Renderer | { default: Renderer }>
