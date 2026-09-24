/**
 * The presenter view (PLAN §4): the deck page opened with `#presenter`.
 *
 * Current and next are live mirrors of the deck (the same page in iframes,
 * `#mirror` / `#mirror-still`), so animations and charts preview truthfully.
 * The view only ever sends intents; everything it shows comes from the
 * deck's `state` messages.
 */
import type { DeckPayload } from '@blitzstrahl/core'
import { bindKeyboard, type NavTarget } from '../input.js'
import { next, type Position } from '../steps.js'
import { LayerHost, gotoPrompt, help, overview, slideLabel } from '../ui.js'
import { PROTOCOL, elapsed, formatElapsed, isEnvelope, type PresenterMsg } from './protocol.js'
import { WindowTransport } from './transport.js'
import { presenterCss } from './view-css.js'

type DeckState = Extract<PresenterMsg, { type: 'state' }>

/** How long without a word from the deck before it counts as gone. */
const SILENCE_MS = 4000
const HEARTBEAT_MS = 1500
const NOTES_SIZE_KEY = 'blitzstrahl:notes-size'

export type ConnectionStatus = 'connected' | 'waiting' | 'none'

interface Mirror {
  frame: HTMLIFrameElement
  ready: boolean
  /** Last position sent, to skip repeats. */
  sent?: string
}

export class PresenterView implements NavTarget {
  state: DeckState | undefined
  private payload: DeckPayload
  private readonly win: Window
  private readonly transport: WindowTransport
  private readonly layers: LayerHost
  private readonly el: Record<string, HTMLElement> = {}
  private readonly current: Mirror
  private readonly upcoming: Mirror
  private lastHeard = 0
  private notesSize: number
  private readonly timers: number[] = []

  constructor(
    private readonly doc: Document,
    payload: DeckPayload,
  ) {
    this.payload = payload
    this.win = doc.defaultView!
    this.layers = new LayerHost(doc)
    this.notesSize = readNumber(this.win, NOTES_SIZE_KEY) ?? 24
    doc.title = `Presenter · ${payload.title}`

    const style = doc.createElement('style')
    style.textContent = presenterCss
    doc.head.append(style)
    doc.body.classList.add('blitz-presenter-mode')

    const root = this.build()
    doc.body.append(root)
    this.current = this.mirror('mirror', this.el.currentFrame as HTMLIFrameElement)
    this.upcoming = this.mirror('mirror-still', this.el.nextFrame as HTMLIFrameElement)

    this.transport = new WindowTransport(this.win, this.win.opener as Window | null)
    this.transport.onMessage((m) => this.receive(m))
    this.win.addEventListener('message', (e) => this.fromMirror(e))
    bindKeyboard(this.win, this, (e) => this.onKey(e))

    const beat = () => this.transport.send({ type: 'hello', role: 'presenter' })
    beat()
    this.timers.push(
      this.win.setInterval(beat, HEARTBEAT_MS),
      this.win.setInterval(() => this.tick(), 500),
    )
    this.render()
  }

  get status(): ConnectionStatus {
    if (!this.transport.connected) return 'none'
    return this.state && Date.now() - this.lastHeard < SILENCE_MS ? 'connected' : 'waiting'
  }

  // --- intents (NavTarget, so the shared keyboard handler drives them) ---

  advance(): void {
    this.transport.send({ type: 'advance' })
  }

  retreat(): void {
    this.transport.send({ type: 'retreat' })
  }

  first(): void {
    this.transport.send({ type: 'goto', slide: 0, step: 0 })
  }

  last(): void {
    this.transport.send({ type: 'goto', slide: this.payload.slides.length - 1, step: 0 })
  }

  goto(slide: number): void {
    this.transport.send({ type: 'goto', slide, step: 0 })
  }

  toggleBlackout(): void {
    this.transport.send({ type: 'blackout', on: !this.state?.blackout })
  }

  /** Dev HMR: a rebuilt deck. The mirrors update themselves. */
  update(payload: DeckPayload, stageHtml: string, notesHtml?: string): void {
    this.payload = payload
    const stage = this.doc.querySelector<HTMLElement>('.blitz-stage')
    if (stage) stage.innerHTML = stageHtml
    const notes = this.doc.getElementById('blitz-notes')
    if (notes instanceof HTMLTemplateElement && notesHtml !== undefined) notes.innerHTML = notesHtml
    this.render()
  }

  /** Open the audience window from here (PLAN §4: either window may spawn the other). */
  openAudience(): void {
    const url = new URL(this.win.location.href)
    url.hash = this.state ? `/${encodeURIComponent(this.payload.slides[this.state.slide]?.id ?? '')}` : ''
    const w = this.win.open(url.href, `blitz-audience:${url.pathname}`)
    if (w) {
      this.transport.setPeer(w)
      this.render()
    }
  }

  // --- internals ---------------------------------------------------------

  private receive(m: PresenterMsg) {
    this.lastHeard = Date.now()
    if (m.type === 'state') {
      this.state = m
      this.render()
    } else if (m.type === 'bye') {
      this.lastHeard = 0
      this.render()
    }
  }

  private fromMirror(e: MessageEvent) {
    if (!isEnvelope(e.data) || e.data.type !== 'hello' || e.data.role !== 'mirror') return
    for (const m of [this.current, this.upcoming]) {
      if (e.source === m.frame.contentWindow) {
        m.ready = true
        delete m.sent
      }
    }
    this.render()
  }

  private tick() {
    const before = this.el.status!.dataset.status
    if (before !== this.status) this.render()
    this.el.clock!.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    this.el.elapsed!.textContent = formatElapsed(this.state ? elapsed(this.state.timer) : 0)
  }

  private onKey(e: KeyboardEvent): boolean {
    if (this.layers.key(e)) return true
    switch (e.key) {
      case 'Escape':
      case 'o':
      case 'O':
        this.showGrid()
        return true
      case 'b':
      case 'B':
      case '.':
        this.toggleBlackout()
        return true
      case 'g':
      case 'G':
        this.layers.open(gotoPrompt(this.doc, { slides: this.payload.slides, go: (i) => this.goto(i), host: this.layers }))
        return true
      case '?':
        this.layers.open(help(this.doc, this.layers))
        return true
    }
    return false
  }

  private showGrid() {
    const stage = this.doc.querySelector<HTMLElement>('.blitz-stage')
    if (!stage) return
    this.layers.open(
      overview(this.doc, {
        stage,
        slides: this.payload.slides,
        canvas: this.payload.canvas,
        current: this.state?.slide ?? 0,
        pick: (i) => this.goto(i),
        host: this.layers,
      }),
    )
  }

  private mirror(mode: 'mirror' | 'mirror-still', frame: HTMLIFrameElement): Mirror {
    const url = new URL(this.win.location.href)
    url.hash = mode
    frame.src = url.href
    return { frame, ready: false }
  }

  private show(m: Mirror, pos: Position) {
    const key = `${pos.slide}/${pos.step}`
    if (!m.ready || m.sent === key) return
    m.sent = key
    m.frame.contentWindow?.postMessage({ blitz: PROTOCOL, type: 'state', slide: pos.slide, step: pos.step, blackout: false, timer: { running: false, elapsed: 0 } }, this.win.location.protocol === 'file:' ? '*' : this.win.location.origin)
  }

  private render() {
    const status = this.status
    const s = this.state
    const slides = this.payload.slides
    this.el.status!.dataset.status = status
    this.el.status!.textContent = status === 'connected' ? 'Connected' : status === 'waiting' ? 'Waiting for the audience window…' : 'No audience window'
    this.el.connect!.hidden = status !== 'none'
    this.el.root!.dataset.status = status

    if (!s) {
      this.el.position!.textContent = `${slides.length} slides`
      this.el.notes!.replaceChildren(note(this.doc, status === 'none' ? 'Open the audience window to start.' : 'Connecting…'))
      this.tick()
      return
    }
    const slide = slides[s.slide]
    const steps = slide?.steps ?? 0
    this.el.position!.textContent = `Slide ${s.slide + 1} of ${slides.length}${steps ? ` · Step ${s.step} of ${steps}` : ''}`
    this.el.title!.textContent = slide ? slideLabel(slide, s.slide) : ''
    this.el.blackout!.setAttribute('aria-pressed', String(s.blackout))
    this.el.root!.toggleAttribute('data-blackout', s.blackout)
    this.el.timerToggle!.textContent = s.timer.running ? 'Pause' : 'Start'

    this.show(this.current, s)
    const n = next(s, slides.map((x) => x.steps))
    this.el.nextLabel!.textContent = !n ? 'End of deck' : n.slide === s.slide ? `Next: step ${n.step} of ${steps}` : `Next: ${slideLabel(slides[n.slide]!, n.slide)}`
    this.el.root!.toggleAttribute('data-at-end', !n)
    if (n) this.show(this.upcoming, n)

    const tpl = this.doc.getElementById('blitz-notes')
    const body = tpl instanceof HTMLTemplateElement && slide ? tpl.content.querySelector(`[data-for="${CSS.escape(slide.id)}"]`) : null
    this.el.notes!.replaceChildren(...(body ? [...body.cloneNode(true).childNodes] : [note(this.doc, 'No notes for this slide.')]))
    this.tick()
  }

  private setNotesSize(size: number) {
    this.notesSize = Math.max(12, Math.min(64, size))
    this.el.notes!.style.fontSize = `${this.notesSize}px`
    try {
      this.win.localStorage.setItem(NOTES_SIZE_KEY, String(this.notesSize))
    } catch {
      // storage unavailable (private mode, file://): the size just isn't remembered
    }
  }

  private build(): HTMLElement {
    const d = this.doc
    const button = (label: string, title: string, onClick: () => void, name?: string) => {
      const b = d.createElement('button')
      b.type = 'button'
      b.textContent = label
      b.title = title
      b.setAttribute('aria-label', title)
      b.addEventListener('click', onClick)
      if (name) this.el[name] = b
      return b
    }
    const el = (tag: string, cls: string, name?: string, ...kids: Array<Node | string>) => {
      const e = d.createElement(tag)
      e.className = cls
      e.append(...kids)
      if (name) this.el[name] = e
      return e
    }
    const frame = (name: string, title: string) => {
      const f = d.createElement('iframe')
      f.title = title
      f.tabIndex = -1
      this.el[name] = f
      return f
    }

    const bar = el(
      'header',
      'bp-bar',
      undefined,
      button('←', 'Previous', () => this.retreat()),
      button('→', 'Next', () => this.advance()),
      el('div', 'bp-where', undefined, el('span', 'bp-position', 'position'), el('span', 'bp-title', 'title')),
      el('div', 'bp-spacer'),
      el('span', 'bp-elapsed', 'elapsed', '00:00'),
      button('Start', 'Start or pause the timer', () => this.transport.send({ type: 'timer', action: this.state?.timer.running ? 'pause' : 'start' }), 'timerToggle'),
      button('Reset', 'Reset the timer', () => this.transport.send({ type: 'timer', action: 'reset' })),
      el('span', 'bp-clock', 'clock'),
      button('Slides', 'All slides (Esc)', () => this.showGrid()),
      button('Black out', 'Black out the audience screen (B)', () => this.toggleBlackout(), 'blackout'),
      el('span', 'bp-status', 'status'),
    )
    const connect = el(
      'div',
      'bp-connect',
      'connect',
      el('p', '', undefined, 'This presenter view isn’t connected to an audience window. Open the deck from here, or press P in the deck.'),
      button('Open audience window', 'Open audience window', () => this.openAudience()),
    )
    const current = el('section', 'bp-current', undefined, el('div', 'bp-frame', undefined, frame('currentFrame', 'Current slide'), el('div', 'bp-black', undefined, 'Audience sees black')), connect)
    const notesTools = el(
      'div',
      'bp-notes-tools',
      undefined,
      el('h2', '', undefined, 'Notes'),
      button('A−', 'Smaller notes', () => this.setNotesSize(this.notesSize - 2)),
      button('A+', 'Larger notes', () => this.setNotesSize(this.notesSize + 2)),
    )
    const notes = el('div', 'bp-notes', 'notes')
    notes.style.fontSize = `${this.notesSize}px`
    const side = el(
      'aside',
      'bp-side',
      undefined,
      el('section', 'bp-next', undefined, el('h2', '', 'nextLabel', 'Next'), el('div', 'bp-frame', undefined, frame('nextFrame', 'Next slide'), el('div', 'bp-end', undefined, 'End of deck'))),
      el('section', 'bp-notes-pane', undefined, notesTools, notes),
    )
    const root = el('div', 'bp', 'root', bar, current, side)
    root.setAttribute('role', 'application')
    root.setAttribute('aria-label', 'Presenter view')
    for (const f of root.querySelectorAll<HTMLElement>('.bp-frame')) f.style.aspectRatio = `${this.payload.canvas.width} / ${this.payload.canvas.height}`
    return root
  }
}

function note(doc: Document, text: string): HTMLElement {
  const p = doc.createElement('p')
  p.className = 'bp-muted'
  p.textContent = text
  return p
}

function readNumber(win: Window, key: string): number | undefined {
  try {
    const n = Number(win.localStorage.getItem(key))
    return n > 0 ? n : undefined
  } catch {
    return undefined
  }
}
