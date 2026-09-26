/**
 * What the built page hands the browser runtime. Slide *content* travels as
 * pre-rendered HTML in the page itself; this carries everything the runtime
 * needs to drive it. Derived from the IR, never from markdown.
 */
import type { AnimSpec, Deck, RenderBlock, TransitionSpec } from './ir.js'

export interface PayloadSlide {
  id: string
  title?: string
  steps: number
  transition: TransitionSpec
  anims: AnimSpec[]
  blocks: Array<Omit<RenderBlock, 'source' | 'span'>>
}

export interface DeckPayload {
  title: string
  lang: string
  canvas: { width: number; height: number }
  slides: PayloadSlide[]
  /**
   * Text of data assets, keyed by deck-relative path, when the build inlines
   * them. The runtime fetches anything missing from here.
   */
  inline: Record<string, string>
  /**
   * Page URL of each local file a render block's spec names (an embed's
   * fallback image, say), keyed by deck-relative path: what
   * `RenderCtx.assetUrl` hands renderers. Files only the page uses aren't
   * here: a standalone file would carry each of them twice.
   */
  urls: Record<string, string>
  /** Plugin entrance effects by name: WAAPI keyframes (docs/plugins.md §2.3). */
  effects?: Record<string, { keyframes: Array<Record<string, string | number | null>>; box?: boolean }>
  /** Values of the frontmatter keys plugins register (`RenderCtx.meta`). */
  meta?: Record<string, unknown>
}

/** What plugins add to the payload. */
export type PayloadPlugins = Pick<DeckPayload, 'effects' | 'meta'>

export function toPayload(deck: Deck, inline: Record<string, string> = {}, assetUrl: (path: string) => string = (p) => p, plugins: PayloadPlugins = {}): DeckPayload {
  const named = specStrings(deck)
  // Data files reach renderers as text (`inline`, `loadAsset`), never as URLs.
  const data = new Set(deck.assets.filter((a) => a.kind === 'data').map((a) => a.path))
  return {
    ...plugins,
    title: deck.meta.title,
    lang: deck.meta.lang,
    canvas: deck.meta.canvas,
    slides: deck.slides.map((s) => {
      const slide: PayloadSlide = {
        id: s.id,
        steps: s.steps,
        transition: s.transition,
        anims: s.anims,
        blocks: s.blocks.map(({ source: _s, span: _p, ...b }) => b),
      }
      if (s.title !== undefined) slide.title = s.title
      return slide
    }),
    inline,
    urls: Object.fromEntries(deck.assets.filter((a) => named.has(a.path) && !data.has(a.path)).map((a) => [a.path, assetUrl(a.path)])),
  }
}

/** Every string in the deck's block specs: the (rewritten) paths renderers may ask for. */
function specStrings(deck: Deck): Set<string> {
  const out = new Set<string>()
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.add(v)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  for (const s of deck.slides) for (const b of s.blocks) walk(b.spec)
  return out
}
