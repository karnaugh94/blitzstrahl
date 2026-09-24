import type { DeckPayload } from '@blitzstrahl/core'
import { Deck, type StartOptions } from './deck.js'

export { Deck, type StartOptions, type ChangeListener } from './deck.js'
export type { Renderer, RenderCtx, RenderInstance, RendererLoader, BlockData } from './renderer.js'
export * from './steps.js'

declare global {
  interface Window {
    /** The running deck, for debugging and tests. */
    blitz?: Deck
  }
}

/** Boot the deck from the page's embedded payload. */
export function start(options: StartOptions = {}): Deck {
  const doc = options.document ?? document
  const script = doc.getElementById('blitz-payload')
  if (!script?.textContent) throw new Error('blitzstrahl: no #blitz-payload in the page')
  const payload = JSON.parse(script.textContent) as DeckPayload
  const deck = new Deck(payload, options)
  doc.defaultView!.blitz = deck
  return deck
}
