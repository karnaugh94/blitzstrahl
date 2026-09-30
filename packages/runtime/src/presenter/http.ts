/**
 * The presenter protocol over HTTP (PLAN §4's "SocketTransport, later";
 * M12.6): what `blitzstrahl present` relays between the deck and a phone.
 * Messages come in as server-sent events and go out as POSTs. A custom
 * header on every POST means another site's page can't send one (it would
 * need a preflight, which the server never grants). No cookies: the phone's
 * pairing travels as a header, and in the event stream's query.
 */
import { PROTOCOL, isEnvelope, type PresenterMsg } from './protocol.js'
import type { PresenterTransport } from './transport.js'

export class HttpTransport implements PresenterTransport {
  private readonly source: EventSource
  private readonly listeners = new Set<(m: PresenterMsg) => void>()
  /** When the stream last delivered a message (0: never). */
  lastHeard = 0

  /**
   * `base` is the relay's path (`/_blitz/remote/deck` for the deck,
   * `/_blitz/remote` for the phone); `session`, the phone's pairing.
   */
  constructor(
    private readonly base: string,
    private readonly session?: string,
    onStatus?: (open: boolean) => void,
  ) {
    this.source = new EventSource(`${base}/events${session ? `?s=${encodeURIComponent(session)}` : ''}`)
    this.source.onopen = () => onStatus?.(true)
    this.source.onerror = () => onStatus?.(false)
    this.source.onmessage = (e) => {
      let data: unknown
      try {
        data = JSON.parse(e.data as string)
      } catch {
        return
      }
      if (!isEnvelope(data)) return
      this.lastHeard = Date.now()
      const { blitz: _tag, ...msg } = data
      for (const cb of this.listeners) cb(msg as PresenterMsg)
    }
  }

  send(msg: PresenterMsg): void {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-blitz': '1' }
    if (this.session) headers['x-blitz-session'] = this.session
    void fetch(`${this.base}/send`, { method: 'POST', headers, body: JSON.stringify({ ...msg, blitz: PROTOCOL }), keepalive: true }).catch(() => {})
  }

  onMessage(cb: (m: PresenterMsg) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  close(): void {
    this.source.close()
    this.listeners.clear()
  }
}
