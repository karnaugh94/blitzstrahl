import type { DeckPayload } from '@blitzstrahl/core'
import { Deck, type StartOptions } from './deck.js'
import { pageMode } from './presenter/protocol.js'
import { isDocumentMode } from './steps.js'

export { Deck, type StartOptions, type ChangeListener } from './deck.js'
export type { Renderer, RenderCtx, RenderInstance, RendererLoader, BlockData } from './renderer.js'
export type { PresenterMsg, TimerState, PageMode } from './presenter/protocol.js'
export type { PresenterTransport } from './presenter/transport.js'
export { describeOverflow, type Overflow } from './overflow-report.js'
export type { PrintOptions, PrintResult } from './print.js'
export * from './steps.js'

/** What `start()` returns, in every mode: dev HMR swaps a rebuilt deck in through it. */
export interface Started {
  /** `notes` is the `#blitz-notes` template's new inner HTML. */
  update(payload: DeckPayload, stageHtml: string, notesHtml?: string): void
}

declare global {
  interface Window {
    /** The running deck (or presenter view), for debugging and tests. */
    blitz?: Deck
  }
}

function readPayload(doc: Document): DeckPayload {
  const script = doc.getElementById('blitz-payload')
  if (!script?.textContent) throw new Error('blitzstrahl: no #blitz-payload in the page')
  return JSON.parse(script.textContent) as DeckPayload
}

/**
 * Boot the page from its embedded payload. `?mode=doc` is document mode;
 * otherwise the hash picks the mode:
 * `#presenter` is the presenter view (loaded on demand), `#mirror` and
 * `#mirror-still` are its previews, anything else is the deck.
 */
export function start(options: StartOptions = {}): Started {
  const doc = options.document ?? document
  const payload = readPayload(doc)
  if (isDocumentMode(doc.defaultView!)) return startDocument(doc, payload, options.renderers)
  const mode = pageMode(doc.defaultView!.location.hash)
  if (mode === 'presenter') return startPresenter(doc, payload, options.renderers)
  const deck = new Deck(payload, { ...options, mode })
  doc.defaultView!.blitz = deck
  return deck
}

/** Document mode (`?mode=doc`): loaded on demand, like the presenter view. */
function startDocument(doc: Document, payload: DeckPayload, renderers: StartOptions['renderers']): Started {
  let pending: Parameters<Started['update']> | undefined
  let view: Started | undefined
  void import('./document.js').then(({ DocumentView }) => {
    const query = new URLSearchParams(doc.defaultView!.location.search)
    // Printed: two slides side by side on landscape sheets, or `&orientation=portrait`.
    const orientation = query.get('orientation') === 'portrait' ? 'portrait' : 'landscape'
    view = new DocumentView(doc, payload, renderers, { notes: query.has('notes'), handout: { orientation } })
    ;(doc.defaultView as unknown as { blitzDocument: unknown }).blitzDocument = view
    if (pending) view.update(...pending)
  })
  return {
    update(...args) {
      if (view) view.update(...args)
      else pending = args
    },
  }
}

function startPresenter(doc: Document, payload: DeckPayload, renderers: StartOptions['renderers']): Started {
  let pending: Parameters<Started['update']> | undefined
  let view: Started | undefined
  void import('./presenter/view.js').then(({ PresenterView }) => {
    view = new PresenterView(doc, payload, renderers)
    ;(doc.defaultView as unknown as { blitzPresenter: unknown }).blitzPresenter = view
    if (pending) view.update(...pending)
  })
  return {
    update(...args) {
      if (view) view.update(...args)
      else pending = args
    },
  }
}
