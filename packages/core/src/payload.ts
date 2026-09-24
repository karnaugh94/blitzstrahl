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
}

export function toPayload(deck: Deck, inline: Record<string, string> = {}): DeckPayload {
  return {
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
  }
}
