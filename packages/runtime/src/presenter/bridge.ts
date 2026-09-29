/**
 * The audience deck's end of the presenter protocol. Applies the
 * presenter's intents, broadcasts state after every change, and holds the
 * talk timer.
 */
import type { InkEvent, InkLayer } from '../ink.js'
import type { Position } from '../steps.js'
import { elapsed, type PresenterMsg, type TimerState } from './protocol.js'
import { WindowTransport, type PresenterTransport } from './transport.js'

/** Another way in: `present`'s phone remote (M12.6). */
interface Attached {
  transport: PresenterTransport
  /** What this way in may ask for; the rest is ignored. */
  allows(m: PresenterMsg): boolean
  /** Someone is there (a phone that has said hello lately). */
  connected(): boolean
}

/** What the bridge needs from the deck. */
export interface BridgedDeck {
  pos: Position | undefined
  blackout: boolean
  slideCount: number
  goto(slide: number, step: number): void
  advance(): void
  retreat(): void
  setBlackout(on: boolean): void
  onChange(cb: () => void): () => void
  readonly ink: InkLayer
  applyInk(e: InkEvent): void
  onInk(cb: (e: InkEvent) => void): () => void
}

export class DeckBridge {
  readonly transport: WindowTransport
  timer: TimerState = { running: false, elapsed: 0 }
  /** Start the timer at the next move (set until it's paused or started by hand). */
  private armed = true
  private lastPos: string | undefined
  private heardPresenter = false
  private readonly attached: Attached[] = []
  private readonly cleanups: Array<() => void> = []

  constructor(
    private readonly win: Window,
    private readonly deck: BridgedDeck,
  ) {
    // Opened by the presenter window: it's our opener.
    this.transport = new WindowTransport(win, win.opener as Window | null)
    this.lastPos = this.posKey()
    this.cleanups.push(
      this.transport.onMessage((m) => this.receive(m)),
      deck.onChange(() => {
        const at = this.posKey()
        if (at !== this.lastPos) {
          this.lastPos = at
          if (this.armed && (this.transport.connected || this.attached.some((a) => a.connected()))) this.startTimer()
        }
        this.broadcast()
      }),
      // Every stroke and laser move, whoever made it, so the preview shows it too.
      deck.onInk((event) => this.transport.send({ type: 'ink', event })),
    )
    const bye = () => this.transport.send({ type: 'bye' })
    win.addEventListener('pagehide', bye)
    this.cleanups.push(() => win.removeEventListener('pagehide', bye), () => this.transport.close())
    if (this.transport.connected) {
      this.transport.send({ type: 'hello', role: 'deck' })
      this.broadcast()
      this.syncInk()
    }
  }

  /**
   * Take intents from another transport too, as far as `allows` lets them,
   * and send it the deck's state. The deck stays authoritative.
   */
  attach(transport: PresenterTransport, allows: (m: PresenterMsg) => boolean, connected: () => boolean): void {
    const a: Attached = { transport, allows, connected }
    this.attached.push(a)
    this.cleanups.push(
      transport.onMessage((m) => {
        if (allows(m)) this.receive(m, a)
      }),
      () => transport.close(),
    )
    this.broadcast()
  }

  /** `P`: open the presenter window, or bring it forward if it's open. */
  openPresenter(): Window | null {
    const open = this.transport.connected
    if (open) {
      open.focus()
      return open
    }
    const url = new URL(this.win.location.href)
    url.hash = 'presenter'
    const w = this.win.open(url.href, `blitz-presenter:${url.pathname}`, 'popup,width=1280,height=800')
    if (w) this.transport.setPeer(w)
    return w
  }

  destroy(): void {
    this.cleanups.forEach((c) => c())
  }

  private posKey() {
    const p = this.deck.pos
    return p && `${p.slide}/${p.step}`
  }

  private broadcast(only?: Attached) {
    const pos = this.deck.pos
    if (!pos) return
    const state: PresenterMsg = { type: 'state', slide: pos.slide, step: pos.step, blackout: this.deck.blackout, timer: this.timer }
    if (only) return only.transport.send(state)
    this.transport.send(state)
    for (const a of this.attached) a.transport.send(state)
  }

  /** The drawing so far, for a presenter that has just (re)connected. */
  private syncInk() {
    this.transport.send({ type: 'ink', event: this.deck.ink.book.snapshot() })
  }

  private startTimer() {
    this.armed = false
    if (!this.timer.running) this.timer = { running: true, elapsed: this.timer.elapsed, since: Date.now() }
  }

  private receive(m: PresenterMsg, from?: Attached) {
    switch (m.type) {
      case 'hello':
        // An attached way in hears the state; the presenter window's hello is its own business.
        if (from) return this.broadcast(from)
        this.broadcast()
        // A presenter that asks gets the drawing, and so does the first one this
        // page hears from: a reloaded deck has none, and the preview must forget it.
        // (A `bye` sent while a page unloads arrives without a source, so it can't be relied on.)
        if (m.role === 'presenter' && (m.sync || !this.heardPresenter)) this.syncInk()
        if (m.role === 'presenter') this.heardPresenter = true
        return
      case 'ink':
        // A presenter can't replace the whole drawing; it can draw, point and clear.
        if (m.event.op !== 'sync') this.deck.applyInk(m.event)
        return
      case 'goto':
        this.deck.goto(m.slide, m.step)
        return
      case 'advance':
        this.deck.advance()
        return
      case 'retreat':
        this.deck.retreat()
        return
      case 'blackout':
        this.deck.setBlackout(m.on)
        return
      case 'timer':
        if (m.action === 'start') this.startTimer()
        else if (m.action === 'pause') {
          this.armed = false
          this.timer = { running: false, elapsed: elapsed(this.timer) }
        } else {
          this.armed = true
          this.timer = { running: false, elapsed: 0 }
        }
        this.broadcast()
        return
      case 'bye': // a reloading presenter keeps its window; a closed one reads as closed
      case 'state': // the deck is authoritative; it never takes state
        return
    }
  }
}
