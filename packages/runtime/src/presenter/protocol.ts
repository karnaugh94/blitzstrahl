/**
 * The presenter protocol (PLAN §4). The deck is authoritative: the presenter
 * sends *intents* and the deck broadcasts *state*, so two windows taking
 * input can never disagree about where the talk is.
 */

import type { InkEvent } from '../ink.js'

/** The talk timer. Held by the deck so it survives the presenter reloading. */
export interface TimerState {
  running: boolean
  /** Milliseconds accumulated before the current run. */
  elapsed: number
  /** `Date.now()` when the current run started (both windows share a clock). */
  since?: number
}

export type PresenterMsg =
  /**
   * "I'm here": sent on start and as a heartbeat. The deck answers with
   * `state`, and with the drawing so far (an `ink` sync) if `sync` asks.
   */
  | { type: 'hello'; role: 'deck' | 'presenter' | 'mirror' | 'remote'; sync?: boolean }
  | { type: 'state'; slide: number; step: number; blackout: boolean; timer: TimerState }
  | { type: 'goto'; slide: number; step: number }
  | { type: 'advance' }
  | { type: 'retreat' }
  | { type: 'timer'; action: 'start' | 'pause' | 'reset' }
  | { type: 'blackout'; on: boolean }
  /**
   * Drawing and the laser. From the presenter, an intent; from the deck, what
   * it applied (whoever drew it), which the presenter shows on its preview.
   */
  | { type: 'ink'; event: InkEvent }
  /** The sender is going away (unload). */
  | { type: 'bye' }

/**
 * What a phone remote may ask of the deck (presenting.md, *A phone as the
 * remote*): turn slides and start or pause the timer. `present`'s server
 * and the deck both hold it to this.
 */
export function remoteMayAsk(m: PresenterMsg): boolean {
  return m.type === 'hello' || m.type === 'advance' || m.type === 'retreat' || (m.type === 'timer' && m.action !== 'reset')
}

/** Envelope tag: ignore every message without it. Bump on incompatible change. */
export const PROTOCOL = 'blitzstrahl/presenter@1'

export type Envelope = PresenterMsg & { blitz: typeof PROTOCOL }

export function isEnvelope(data: unknown): data is Envelope {
  return typeof data === 'object' && data !== null && (data as { blitz?: unknown }).blitz === PROTOCOL && typeof (data as { type?: unknown }).type === 'string'
}

export function elapsed(t: TimerState, now = Date.now()): number {
  return t.elapsed + (t.running && t.since !== undefined ? now - t.since : 0)
}

export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  const hh = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return hh ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`
}

/**
 * How the page was opened. `#presenter` is public (PLAN §4); the mirrors are
 * the presenter's live previews of the deck.
 */
export type PageMode = 'audience' | 'presenter' | 'mirror' | 'mirror-still'

export function pageMode(hash: string): PageMode {
  if (hash === '#presenter') return 'presenter'
  if (hash === '#mirror') return 'mirror'
  if (hash === '#mirror-still') return 'mirror-still'
  return 'audience'
}
