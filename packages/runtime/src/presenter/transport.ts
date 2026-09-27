/**
 * Presenter transports (PLAN §4). `WindowTransport` is the v1 default:
 * `postMessage` over a window handle. It works over HTTP and on `file://`,
 * where the opaque origin rules out `BroadcastChannel` between windows.
 */
import { PROTOCOL, isEnvelope, type PresenterMsg } from './protocol.js'

export interface PresenterTransport {
  send(msg: PresenterMsg): void
  onMessage(cb: (m: PresenterMsg) => void): () => void
  close(): void
}

/**
 * Talks to one peer window. Whoever spawned the other holds its handle; the
 * spawned side uses `window.opener`. A message from another window adopts it
 * as the peer, which is how either side reconnects after a reload (a
 * reloaded page has lost the handle it held, but its peer still has one).
 * Any message, not just `hello`: the first key pressed in the presenter
 * after the deck reloads must not be lost waiting for a heartbeat.
 *
 * Only a window related to this one by opening may talk to it (PLAN §15,
 * M6.14): its opener, or a window it opened (whose opener it is, even after
 * this page reloads and loses the handle). So never a
 * frame inside the deck, such as an embedded page, which could otherwise
 * drive the talk and take the presenter's place. The origin check can't
 * stop that on `file://`, nor for a same-origin frame.
 */
export class WindowTransport implements PresenterTransport {
  private peer: Window | null
  private readonly listeners = new Set<(m: PresenterMsg) => void>()
  private readonly onEvent = (e: MessageEvent) => this.receive(e)

  constructor(
    private readonly win: Window,
    peer: Window | null = null,
  ) {
    this.peer = peer
    win.addEventListener('message', this.onEvent)
  }

  /** The peer window, while it's open. */
  get connected(): Window | null {
    if (this.peer?.closed) this.peer = null
    return this.peer
  }

  setPeer(peer: Window | null): void {
    this.peer = peer
  }

  send(msg: PresenterMsg): void {
    const peer = this.connected
    if (!peer) return
    try {
      peer.postMessage({ ...msg, blitz: PROTOCOL }, this.targetOrigin())
    } catch {
      // The peer navigated away mid-send.
    }
  }

  onMessage(cb: (m: PresenterMsg) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  close(): void {
    this.win.removeEventListener('message', this.onEvent)
    this.listeners.clear()
    this.peer = null
  }

  /** This window's opener, or a window whose opener it is (`opener` is readable across origins). */
  private related(source: Window): boolean {
    if (source === this.win.opener) return true
    try {
      return source.opener === this.win
    } catch {
      return false
    }
  }

  private targetOrigin(): string {
    // file:// pages have an opaque origin ("null"), which can't be targeted.
    return this.win.location.protocol === 'file:' ? '*' : this.win.location.origin
  }

  private receive(e: MessageEvent) {
    if (!isEnvelope(e.data)) return
    if (this.win.location.protocol !== 'file:' && e.origin !== this.win.location.origin) return
    const source = e.source as Window | null
    if (!source || source === this.win || !this.related(source)) return
    // Mirrors only ever talk to the presenter view that embeds them.
    if (e.data.type === 'hello' && e.data.role === 'mirror') return
    if (source !== this.peer) this.peer = source
    const { blitz: _tag, ...msg } = e.data
    for (const cb of this.listeners) cb(msg as PresenterMsg)
  }
}
