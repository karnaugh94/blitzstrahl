/**
 * The deck controller: one navigator surface (`advance`, `retreat`, `goto`)
 * fed by every input source, applying step state to the DOM and driving
 * renderers (PLAN §3).
 */
import type { AnimSpec, DeckPayload, EffectKind, PayloadSlide, StepRange } from '@blitzstrahl/core'
import { fill, strings } from '@blitzstrahl/core/i18n'
import { needsBox, playEntrance, playExit, registerEffects, type CustomEffect, type Played } from './effects.js'
import { bindKeyboard, bindPointer, type NavTarget } from './input.js'
import type { BlockData, RenderInstance, RendererLoader } from './renderer.js'
import { Blocks } from './blocks.js'
import { bindPrinting, buildPrint, buildStaticPrint, type PrintOptions, type PrintResult } from './print.js'
import { Drawings } from './drawings.js'
import { bindInk, draws, inkKey, InkLayer, penFor, type InkEvent, type Tool } from './ink.js'
import { focusLines } from './lines.js'
import { MEDIA, rewind, showMedia, wireMedia } from './media.js'
import { flipFrames, isCode, pairSlides, place, textPair, type MorphPair } from './morph.js'
import { CodeMorph } from './code-morph.js'
import { clamp, documentUrl, formatHash, motion, next, parseHash, phaseAt, prev, type Motion, type Phase, type Position } from './steps.js'
import { ViewTransitionEngine, WaapiEngine, slideMotion, type SlideMotion, type TransitionEngine } from './transitions.js'
import { LayerHost, embedCard, gotoPrompt, help, overview, presenterBlocked, uiWords } from './ui.js'
import { DeckBridge } from './presenter/bridge.js'
import { measureOverflow } from './overflow.js'
import { describeOverflow, type Overflow } from './overflow-report.js'
import { PROTOCOL, isEnvelope, pageMode, type PageMode } from './presenter/protocol.js'

export interface StartOptions {
  /** Lazy loaders per renderer name. The entry module wires these up. */
  renderers?: Record<string, RendererLoader>
  document?: Document
  /**
   * `audience` (default) is the deck itself. The mirrors are the presenter
   * view's live previews: no input, no URL, driven by their parent window;
   * `mirror-still` also shows every state without motion.
   */
  mode?: Exclude<PageMode, 'presenter'>
  /**
   * Dev server: check every slide for overflow on load and after each
   * update, badge the current slide if it overflows, and outline the culprits.
   */
  dev?: boolean
  /** Called with each dev overflow check's result (the dev server prints it). */
  onOverflow?: (found: Overflow[]) => void
}

interface Stepped {
  el: HTMLElement
  range: StepRange
  kind: EffectKind
  anim: AnimSpec | undefined
  phase?: Phase
  running?: Played
}

interface BlockView {
  el: HTMLElement
  data: BlockData
  /** The element is authored HTML the renderer enhances, not a placeholder to fill. */
  enhance: boolean
  instance?: RenderInstance
  loading?: boolean
  /** The last mount's error message, if it failed. */
  error?: HTMLElement
}

interface SlideView {
  el: HTMLElement
  data: PayloadSlide
  stepped: Stepped[]
  blocks: BlockView[]
  /** Video and audio (syntax.md §13). */
  media: HTMLMediaElement[]
}

/** Called after every change of position or blackout. */
export type ChangeListener = (pos: Position, deck: Deck) => void
/** Called with every ink event the deck applies. */
export type InkListener = (e: InkEvent) => void

export class Deck implements NavTarget {
  pos: Position | undefined
  private views: SlideView[] = []
  private payload!: DeckPayload
  private readonly doc: Document
  private readonly win: Window
  private readonly viewport: HTMLElement
  private readonly stage: HTMLElement
  private readonly live: HTMLElement | null
  private readonly blocks: Blocks
  private readonly listeners = new Set<ChangeListener>()
  private readonly inkListeners = new Set<InkListener>()
  private readonly cleanups: Array<() => void> = []
  private readonly reduced: MediaQueryList
  /** Bumped whenever block instances are torn down, to drop stale async mounts. */
  private generation = 0
  /** Elements the running auto-animate moves into place: they don't play entrances too. */
  private morphing = new Set<HTMLElement>()
  /** Stack members swapping at this step (syntax.md §9.1): they morph, not fade. */
  private swapping = new Set<HTMLElement>()
  private settleSwaps: (() => void) | undefined
  readonly transitions: TransitionEngine
  readonly layers: LayerHost
  /** The audience sees black (`B`); navigation still works underneath. */
  blackout = false
  private readonly blackoutEl: HTMLElement
  /** Drawing and the laser, over the slides (ink.ts). */
  readonly ink: InkLayer
  /** The tool in this window's hands (`L`, `D`, `H`), and the pen's colour (`1`–`3`, as 0–2). */
  tool: Tool = 'none'
  color = 0
  readonly mode: NonNullable<StartOptions['mode']>
  /** The presenter link (audience mode only). */
  readonly presenter: DeckBridge | undefined

  constructor(payload: DeckPayload, options: StartOptions = {}) {
    this.doc = options.document ?? document
    this.win = this.doc.defaultView!
    this.blocks = new Blocks(this.doc, () => this.payload, options.renderers)
    this.viewport = this.doc.querySelector<HTMLElement>('.blitz-viewport')!
    this.stage = this.doc.querySelector<HTMLElement>('.blitz-stage')!
    this.live = this.doc.querySelector<HTMLElement>('.blitz-sr')
    this.reduced = this.win.matchMedia('(prefers-reduced-motion: reduce)')
    this.mode = options.mode ?? 'audience'
    this.transitions = ViewTransitionEngine.supported(this.doc) ? new ViewTransitionEngine(this.doc) : new WaapiEngine()
    this.layers = new LayerHost(this.doc)
    this.blackoutEl = this.doc.createElement('div')
    this.blackoutEl.className = 'blitz-blackout'
    this.doc.body.append(this.blackoutEl)
    this.ink = new InkLayer(this.doc, payload.canvas)
    this.cleanups.push(() => this.ink.destroy())
    this.load(payload)

    const ro = new ResizeObserver(() => this.rescale())
    ro.observe(this.viewport)
    this.cleanups.push(() => ro.disconnect(), () => this.layers.close(), () => this.blackoutEl.remove())

    if (this.mode !== 'audience') {
      this.presenter = undefined
      this.mirror()
      return
    }

    this.cleanups.push(
      bindPrinting(this.win, this.printing()).unbind,
      bindKeyboard(this.win, this, (e) => this.onKey(e)),
      bindPointer(this.viewport, this, () => draws(this.tool)),
      bindInk(
        this.viewport,
        {
          tool: () => this.tool,
          slide: () => this.pos?.slide,
          stage: this.stage,
          canvas: this.payload.canvas,
          pen: () => this.pen(),
          emit: (e) => this.applyInk(e),
        },
        'a',
      ),
    )
    const onHash = () => {
      // The page's mode is chosen when it loads, so typing `#presenter` onto
      // an open deck has to reload it to take effect.
      if (pageMode(this.win.location.hash) !== 'audience') return this.win.location.reload()
      const p = parseHash(this.win.location.hash, this.ids)
      if (p) this.goto(p.slide, p.step, { history: 'none' })
    }
    this.win.addEventListener('hashchange', onHash)
    this.cleanups.push(() => this.win.removeEventListener('hashchange', onHash))

    const initial = parseHash(this.win.location.hash, this.ids) ?? { slide: 0, step: 0 }
    this.goto(initial.slide, initial.step, { history: 'replace' })
    this.presenter = new DeckBridge(this.win, this)
    this.cleanups.push(() => this.presenter?.destroy())

    if (options.dev) {
      this.badge = this.doc.createElement('div')
      this.badge.className = 'blitz-overflow-badge'
      this.badge.setAttribute('role', 'status')
      this.badge.hidden = true
      this.doc.body.append(this.badge)
      const badge = this.badge
      this.cleanups.push(() => badge.remove())
      this.onOverflow = options.onOverflow
      void this.checkOverflow()
    }
  }

  /** Slides that overflow the canvas, from the last check. */
  overflows: Overflow[] = []
  private badge: HTMLElement | undefined
  private onOverflow: ((found: Overflow[]) => void) | undefined

  /**
   * Measure every slide for content off the canvas or clipped inside it
   * (PLAN §7). `blitzstrahl build` runs this in a headless browser.
   */
  async checkOverflow(): Promise<Overflow[]> {
    this.overflows = await measureOverflow(this.stage, this.payload.slides, this.payload.canvas, this.badge !== undefined)
    this.showBadge()
    this.onOverflow?.(this.overflows)
    return this.overflows
  }

  private showBadge() {
    const badge = this.badge
    if (!badge) return
    const found = this.overflows.find((o) => o.slide === this.pos?.slide)
    badge.hidden = !found
    if (!found) return
    const list = this.doc.createElement('ul')
    for (const line of describeOverflow(found)) {
      const li = this.doc.createElement('li')
      li.textContent = line
      list.append(li)
    }
    badge.replaceChildren(uiWords(this.doc).dev.overflows, list)
  }

  /** Mirror mode: follow the parent window's `state` messages, and nothing else. */
  private mirror() {
    const parent = this.win.parent
    const onMessage = (e: MessageEvent) => {
      if (e.source !== parent || !isEnvelope(e.data)) return
      if (e.data.type === 'state') this.goto(e.data.slide, e.data.step, { history: 'none' })
      // Both previews show the talk's ink (the presenter sends the next one no laser).
      else if (e.data.type === 'ink') this.ink.apply(e.data.event)
    }
    this.win.addEventListener('message', onMessage)
    this.cleanups.push(() => this.win.removeEventListener('message', onMessage))
    this.goto(0, 0, { history: 'none' })
    if (parent !== this.win) parent.postMessage({ blitz: PROTOCOL, type: 'hello', role: 'mirror' }, this.win.location.protocol === 'file:' ? '*' : this.win.location.origin)
  }

  /** No motion: reduced-motion users, and the still mirror. */
  private get still(): boolean {
    return this.mode === 'mirror-still' || this.reduced.matches
  }

  get ids(): string[] {
    return this.payload.slides.map((s) => s.id)
  }

  get steps(): number[] {
    return this.payload.slides.map((s) => s.steps)
  }

  /** The logical canvas size (syntax.md §3.1). */
  get canvas(): { width: number; height: number } {
    return this.payload.canvas
  }

  get slideCount(): number {
    return this.views.length
  }

  onChange(cb: ChangeListener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  onInk(cb: InkListener): () => void {
    this.inkListeners.add(cb)
    return () => this.inkListeners.delete(cb)
  }

  /** Apply drawing or laser input, from this window or the presenter, and pass it on. */
  applyInk(e: InkEvent): void {
    // `Z`, from either window: the deck decides which stroke that is, and says so.
    if (e.op === 'undo') {
      const last = this.ink.book.last(e.slide)
      if (last) this.applyInk({ op: 'remove', slide: e.slide, id: last.id })
      return
    }
    this.ink.apply(e)
    for (const cb of this.inkListeners) cb(e)
  }

  /** Pick up a tool, or put it down (`none`). */
  setTool(tool: Tool): void {
    if (this.tool === 'laser' && tool !== 'laser') this.applyInk({ op: 'laser', at: null })
    this.tool = tool
    if (tool === 'none') delete this.viewport.dataset.blitzTool
    else this.viewport.dataset.blitzTool = tool
  }

  setColor(color: number): void {
    this.color = color
  }

  /** `Z`: take back the current slide's last stroke. */
  undoInk(): void {
    if (this.pos) this.applyInk({ op: 'undo', slide: this.pos.slide })
  }

  /** `C`: wipe the current slide's drawing. */
  clearInk(): void {
    if (this.pos) this.applyInk({ op: 'clear', slide: this.pos.slide })
  }

  private pen() {
    const style = this.win.getComputedStyle(this.stage)
    return penFor(this.tool, this.color, (name) => style.getPropertyValue(name).trim())
  }

  advance(): void {
    const to = this.pos && next(this.pos, this.steps)
    if (to) this.goto(to.slide, to.step)
  }

  retreat(): void {
    const to = this.pos && prev(this.pos, this.steps)
    if (to) this.goto(to.slide, to.step)
  }

  first(): void {
    this.goto(0, 0)
  }

  last(): void {
    this.goto(this.views.length - 1, 0)
  }

  goto(slide: number, step = 0, opts: { history?: 'push' | 'replace' | 'none' } = {}): void {
    if (!this.views.length) return
    const to = clamp({ slide, step }, this.steps)
    const from = this.pos
    const m = motion(from, to)
    if (m === 'none') return

    // A transition still running is settled before anything else moves.
    this.transitions.finish()
    this.settleSwaps?.()
    const changing = !from || from.slide !== to.slide
    const view = this.views[to.slide]!
    const old = from && changing ? this.views[from.slide]! : undefined
    let teardown = () => {}
    const commit = () => {
      if (old) teardown = this.leave(old)
      if (changing) this.enter(view)
      const swaps = !changing && from && !this.still ? this.stackSwaps(view, from.step, to.step) : []
      // Code is measured while the old version still shows.
      const code = swaps.filter(isCode).map((p) => new CodeMorph(p.from, p.to))
      this.swapping = new Set(swaps.flatMap((p) => [p.from, p.to]))
      this.apply(view, to.step, m)
      this.swapping.clear()
      this.syncBlocks(view, to.step)
      this.syncMedia(view)
      if (swaps.length) this.morphSwaps(view, swaps, code)
    }
    this.pos = to
    const t = old && from ? this.slideTransition(from.slide, to) : undefined
    this.morphing = new Set([...(t?.morph ?? []), ...(t?.code ?? [])].map((p) => p.to))
    if (t && old) {
      this.transitions.run({ ...t, from: old.el, to: view.el, commit, done: () => teardown() })
    } else {
      commit()
      teardown()
    }

    const history = this.mode !== 'audience' ? 'none' : (opts.history ?? (from && from.slide === to.slide ? 'replace' : 'push'))
    if (history !== 'none') {
      const url = formatHash(to, this.ids)
      if (this.win.location.hash !== url) {
        if (history === 'push') this.win.history.pushState(null, '', url)
        else this.win.history.replaceState(null, '', url)
      }
    }
    this.emit()
  }

  setBlackout(on: boolean): void {
    if (this.blackout === on) return
    this.blackout = on
    toggle(this.blackoutEl, 'blitzOn', on)
    this.emit()
  }

  /** Open the slide overview (`Esc`). */
  showOverview(): void {
    const at = this.pos?.slide ?? 0
    // The slide on screen as it is now.
    if (this.pos) this.keepDrawings(this.views[this.pos.slide]!)
    this.layers.open(
      overview(this.doc, {
        stage: this.stage,
        slides: this.payload.slides,
        canvas: this.payload.canvas,
        current: at,
        pick: (i) => this.goto(i, 0),
        host: this.layers,
        drawings: this.drawings,
      }),
    )
  }

  private printed: { remove(): void } | undefined

  /**
   * Lay the deck out for printing (PDF export, PLAN §6): every slide as a
   * page at its final step, or every step as a page. Resolves when all of
   * it has loaded. The deck stays hidden behind the pages afterwards.
   */
  async print(options: PrintOptions = {}): Promise<PrintResult> {
    this.transitions.finish()
    // Printing from the browser leaves the deck on screen as it was.
    if (!options.quiet) {
      this.layers.close()
      this.setBlackout(false)
    }
    this.printed?.remove()
    const built = await buildPrint(
      {
        doc: this.doc,
        sections: this.views.map((v) => v.el),
        slides: this.payload.slides,
        canvas: this.payload.canvas,
        mount: (el, block, step) => this.blocks.mountStill(el, block, step),
      },
      options,
    )
    this.printed = built
    return built.result
  }

  /** What each block last drew, by id: printing from the browser's menu, and the overview. */
  private readonly drawings = new Drawings({
    canvas: () => this.payload.canvas,
    section: (i) => this.views[i]?.el,
    slide: (i) => this.payload.slides[i],
    mount: (el, block, step) => this.blocks.mountStill(el, block, step),
  })

  private printing(): Parameters<typeof bindPrinting>[1] {
    return {
      prepare: async () => {
        await this.print({ quiet: true })
        return {
          remove: () => {
            this.printed?.remove()
            this.printed = undefined
          },
        }
      },
      fallback: () => {
        if (this.pos) this.keepDrawings(this.views[this.pos.slide]!)
        return buildStaticPrint({ doc: this.doc, sections: this.views.map((v) => v.el), slides: this.payload.slides, canvas: this.payload.canvas, drawings: this.drawings })
      },
    }
  }

  private keepDrawings(view: SlideView) {
    for (const b of view.blocks) if (b.instance && !b.enhance && !b.el.querySelector('.blitz-embed-card')) this.drawings.keep(b.data.id, b.el)
  }

  /** Swap in a rebuilt deck (dev HMR), keeping the current slide and step. */
  update(payload: DeckPayload, stageHtml: string): void {
    this.transitions.finish()
    const at = this.pos
    const id = at ? this.ids[at.slide] : undefined
    if (at) this.leave(this.views[at.slide]!)()
    this.stage.innerHTML = stageHtml
    this.drawings.clear()
    this.load(payload)
    this.pos = undefined
    const idx = id ? this.ids.indexOf(id) : -1
    const slide = idx >= 0 ? idx : Math.min(at?.slide ?? 0, this.views.length - 1)
    this.goto(slide, at?.step ?? 0, { history: 'replace' })
    // Don't replay entrance effects on every save: settle immediately.
    this.current()?.stepped.forEach((s) => s.running?.finish())
    if (this.badge) void this.checkOverflow()
  }

  destroy(): void {
    this.printed?.remove()
    this.transitions.finish()
    if (this.pos) this.leave(this.views[this.pos.slide]!)()
    this.cleanups.forEach((c) => c())
  }

  // --- internals ---------------------------------------------------------

  private emit() {
    if (this.pos) for (const cb of this.listeners) cb(this.pos, this)
  }

  /** The deck's own keys (PLAN §8), ahead of navigation. */
  private onKey(e: KeyboardEvent): boolean {
    if (this.layers.key(e)) return true
    // Esc puts a tool down before it does anything else.
    if (e.key === 'Escape' && this.tool !== 'none') {
      this.setTool('none')
      return true
    }
    if (inkKey(e.key, this)) return true
    switch (e.key) {
      case 'Escape':
      case 'o':
      case 'O':
        this.showOverview()
        return true
      case 'b':
      case 'B':
      case '.':
        this.setBlackout(!this.blackout)
        return true
      case 'g':
      case 'G':
        this.layers.open(gotoPrompt(this.doc, { slides: this.payload.slides, go: (i) => this.goto(i, 0), host: this.layers }))
        return true
      case '?':
        this.layers.open(help(this.doc, this.layers))
        return true
      case 'f':
      case 'F':
        void this.toggleFullscreen()
        return true
      case 'r':
      case 'R':
        this.win.location.assign(documentUrl(this.win.location.href, this.pos ? formatHash({ slide: this.pos.slide, step: 0 }, this.ids) : ''))
        return true
      case 'p':
      case 'P':
        if (this.presenter && !this.presenter.openPresenter()) {
          const url = new URL(this.win.location.href)
          url.hash = 'presenter'
          this.layers.open(presenterBlocked(this.doc, this.layers, url.href))
        }
        return true
    }
    return false
  }

  private current(): SlideView | undefined {
    return this.pos && this.views[this.pos.slide]
  }

  private load(payload: DeckPayload) {
    this.payload = payload
    registerEffects(payload.effects as Record<string, CustomEffect> | undefined)
    const { width, height } = payload.canvas
    this.stage.style.setProperty('--blitz-canvas-w', `${width}px`)
    this.stage.style.setProperty('--blitz-canvas-h', `${height}px`)
    const sections = [...this.stage.querySelectorAll<HTMLElement>(':scope > .blitz-slide')]
    this.views = payload.slides.map((data, i) => this.buildView(sections[i]!, data))
    // Over the slides (a dev update replaces the stage's HTML).
    this.ink.resize(payload.canvas)
    this.stage.append(this.ink.el)
    this.rescale()
  }

  private buildView(el: HTMLElement, data: PayloadSlide): SlideView {
    const stepped: Stepped[] = []
    for (const node of el.querySelectorAll<HTMLElement>('[data-blitz-step-in]')) {
      const range: StepRange = { in: Number(node.dataset.blitzStepIn) }
      if (node.dataset.blitzStepOut !== undefined) range.out = Number(node.dataset.blitzStepOut)
      const idx = node.dataset.blitzAnim
      const anim = idx === undefined ? undefined : data.anims[Number(idx)]
      const kind = anim?.kind ?? 'entrance'
      if (anim) {
        if (kind === 'emphasis') {
          node.dataset.blitzFx = anim.effect
          if (anim.dur !== undefined) node.style.setProperty('--blitz-fx-dur', `${anim.dur}ms`)
          if (anim.delay !== undefined) node.style.setProperty('--blitz-fx-delay', `${anim.delay}ms`)
          if (anim.ease) node.style.setProperty('--blitz-fx-ease', anim.ease)
        } else if (needsBox(anim.effect, this.doc) && this.win.getComputedStyle(node).display === 'inline') {
          node.dataset.blitzBox = ''
        }
      }
      stepped.push({ el: node, range, kind, anim })
    }
    // Inline boxes can't be transformed, and auto-animate moves keyed elements.
    for (const node of el.querySelectorAll<HTMLElement>('[data-blitz-key]')) {
      if (this.win.getComputedStyle(node).display === 'inline') node.dataset.blitzBox = ''
    }
    const blocks: BlockView[] = []
    for (const b of data.blocks) {
      const id = CSS.escape(b.id)
      const node = el.querySelector<HTMLElement>(`[data-blitz-block="${id}"], [data-blitz-enhance="${id}"]`)
      if (!node) continue
      node.dataset.blitzInteractive = ''
      for (const dim of ['width', 'height'] as const) {
        const v = node.getAttribute(dim)
        if (v) node.style[dim] = /^\d+$/.test(v) ? `${v}px` : v
      }
      blocks.push({ el: node, data: b, enhance: node.dataset.blitzEnhance !== undefined })
    }
    const media = [...el.querySelectorAll<HTMLMediaElement>(MEDIA)]
    for (const m of media) wireMedia(m, this.mode === 'audience')
    return { el, data, stepped, blocks, media }
  }

  private rescale() {
    const { width, height } = this.payload.canvas
    const vw = this.viewport.clientWidth
    const vh = this.viewport.clientHeight
    if (!vw || !vh) return
    const scale = Math.min(vw / width, vh / height)
    const s = this.stage.style
    s.setProperty('--blitz-scale', String(scale))
    s.setProperty('--blitz-offset-x', `${(vw - width * scale) / 2}px`)
    s.setProperty('--blitz-offset-y', `${(vh - height * scale) / 2}px`)
    if (this.pos) for (const b of this.views[this.pos.slide]?.blocks ?? []) b.instance?.resize()
  }

  private enter(view: SlideView) {
    queueMicrotask(() => this.showBadge())
    view.el.dataset.blitzCurrent = ''
    view.el.removeAttribute('aria-hidden')
    this.ink.showSlide(this.views.indexOf(view))
    for (const s of view.stepped) delete s.phase
    if (this.live && this.mode === 'audience') {
      const i = this.views.indexOf(view)
      // For the audience, so in the deck's language (syntax.md §3.3).
      const words = strings(this.payload.lang).deck
      this.live.textContent = fill(words.announce, { title: view.data.title ?? fill(words.slide, { n: i + 1 }), n: i + 1, total: this.views.length })
    }
  }

  /**
   * Mark a slide as left. Returns the teardown of its renderers, which a
   * transition may delay until the slide is out of sight.
   */
  private leave(view: SlideView): () => void {
    delete view.el.dataset.blitzCurrent
    view.el.setAttribute('aria-hidden', 'true')
    for (const s of view.stepped) s.running?.finish()
    for (const m of view.media) rewind(m)
    if (this.mode === 'audience') this.keepDrawings(view)
    this.generation++
    const instances = view.blocks.map((b) => {
      const i = b.instance
      delete b.instance
      b.loading = false
      return i
    })
    return () => instances.forEach((i) => i?.destroy())
  }

  /**
   * The transition between two slides (syntax.md §9): forward uses the
   * entered slide's, backward plays the left slide's mirrored.
   */
  private slideTransition(
    from: number,
    to: Position,
  ): { motion: SlideMotion; reverse: boolean; dur: number; easing: string; morph?: MorphPair[]; code?: MorphPair[] } | undefined {
    // Nobody sees a transition under blackout, and a view transition would
    // paint above the black screen (it's drawn in the top layer): cut instead.
    if (this.still || this.blackout) return undefined
    const reverse = to.slide < from
    const spec = this.payload.slides[reverse ? from : to.slide]!.transition
    const m = slideMotion(spec.name)
    if (!m) return undefined
    const t = { motion: m, reverse, dur: spec.dur ?? this.defaultTransitionDur(), easing: TRANSITION_EASE }
    if (spec.name !== 'auto-animate') return t
    // Morphing runs the same way in both directions: from here to there.
    const view = this.views[to.slide]!
    const visible = (el: HTMLElement) =>
      !view.stepped.some((s) => s.kind === 'entrance' && s.el.contains(el) && phaseAt(s.kind, s.range, to.step) === 'hidden')
    const pairs = pairSlides(this.views[from]!.el, view.el, visible)
    return { ...t, reverse: false, morph: pairs.filter((p) => !isCode(p)), code: pairs.filter(isCode) }
  }

  /** In each stack of this slide, the version shown at step `a` and the one at `b`, where they differ. */
  private stackSwaps(view: SlideView, a: number, b: number): MorphPair[] {
    const shownAt = (el: Element, step: number) => {
      const s = view.stepped.find((x) => x.el === el)
      return !s || phaseAt(s.kind, s.range, step) !== 'hidden'
    }
    const pairs: MorphPair[] = []
    for (const stack of view.el.querySelectorAll<HTMLElement>('[data-blitz-stack]')) {
      const members = [...stack.children] as HTMLElement[]
      const from = members.find((el) => shownAt(el, a))
      const to = members.find((el) => shownAt(el, b))
      if (from && to && from !== to) pairs.push({ from, to })
    }
    return pairs
  }

  /** The new version moves from where the old one was; code morphs token by token. */
  private morphSwaps(view: SlideView, swaps: MorphPair[], code: CodeMorph[]) {
    const anims: Animation[] = []
    const options = (to: HTMLElement): KeyframeAnimationOptions => ({
      duration: view.stepped.find((s) => s.el === to)?.anim?.dur ?? view.data.transition.dur ?? this.defaultTransitionDur(),
      easing: TRANSITION_EASE,
    })
    for (const p of swaps.filter((p) => !isCode(p))) {
      const text = textPair(p)
      const a = place(p.from, text)
      const b = place(p.to, text)
      if (a.box.width && b.box.width) anims.push(p.to.animate(flipFrames(b, a, 'from'), options(p.to)))
    }
    code.forEach((c, i) => {
      c.lift()
      anims.push(...c.animate(options(swaps.filter(isCode)[i]!.to)))
    })
    const settle = () => {
      if (this.settleSwaps !== settle) return
      this.settleSwaps = undefined
      for (const a of anims) a.cancel()
      code.forEach((c) => c.restore())
    }
    this.settleSwaps = settle
    void Promise.all(anims.map((a) => a.finished)).then(settle, () => {})
  }

  private defaultTransitionDur(): number {
    const v = this.win.getComputedStyle(this.stage).getPropertyValue('--blitz-transition-dur').trim()
    const n = parseFloat(v)
    if (!Number.isFinite(n)) return DEFAULT_TRANSITION_DUR
    return v.endsWith('ms') ? n : v.endsWith('s') ? n * 1000 : n
  }

  private apply(view: SlideView, step: number, m: Motion) {
    const animate = !this.still
    const dimParents = new Set<HTMLElement>()

    for (const s of view.stepped) {
      const phase = phaseAt(s.kind, s.range, step)
      const was = s.phase
      s.phase = phase
      if (was === phase) {
        if (s.anim?.effect === 'dim-others') dimParents.add(s.el.parentElement!)
        continue
      }
      s.running?.finish()
      delete s.running

      if (s.kind === 'emphasis') {
        // CSS transitions animate emphasis; snap unless moving forward (or `reverse`).
        const smooth = animate && (m === 'step-forward' || (m === 'step-back' && s.anim?.reverse))
        if (!smooth) snap(s.el)
        toggle(s.el, 'blitzActive', phase === 'active')
        if (s.anim?.effect === 'dim-others') dimParents.add(s.el.parentElement!)
        continue
      }

      const anim = s.anim ?? { effect: 'fade', kind: 'entrance', options: {} }
      if (phase === 'shown') {
        toggle(s.el, 'blitzHidden', false)
        const entrance = m === 'step-forward' || (m === 'enter' && s.range.in === 0 && s.anim !== undefined)
        if (animate && entrance && was !== 'shown' && !this.morphing.has(s.el) && !this.swapping.has(s.el)) s.running = playEntrance(s.el, anim)
      } else if (animate && m === 'step-forward' && was === 'shown' && !this.swapping.has(s.el)) {
        const run = playExit(s.el, anim)
        s.running = run
        void run.finished.then(() => {
          if (s.phase === 'hidden') toggle(s.el, 'blitzHidden', true)
        })
      } else if (animate && m === 'step-back' && was === 'shown' && s.anim?.reverse && !this.swapping.has(s.el)) {
        const run = playEntrance(s.el, anim, true)
        s.running = run
        void run.finished.then(() => {
          if (s.phase === 'hidden') toggle(s.el, 'blitzHidden', true)
        })
      } else {
        toggle(s.el, 'blitzHidden', true)
      }
    }

    for (const parent of dimParents) {
      const any = view.stepped.some((s) => s.anim?.effect === 'dim-others' && s.el.parentElement === parent && s.phase === 'active')
      toggle(parent, 'blitzDim', any)
    }

    // `lines=`: like emphasis, the focus moves smoothly only going forwards.
    for (const pre of view.el.querySelectorAll<HTMLElement>('pre[data-blitz-lines]')) {
      if (!animate || m !== 'step-forward') snap(pre)
      focusLines(pre, step)
    }
  }

  private syncBlocks(view: SlideView, step: number) {
    for (const b of view.blocks) {
      const visible = b.el.closest('[data-blitz-hidden]') === null && !this.pendingExit(view, b.el)
      if (b.instance) b.instance.update(step)
      else if (visible && !b.loading) void this.mount(b, step)
    }
  }

  /** Play what's shown, rewind what isn't; only the audience's window plays. */
  private syncMedia(view: SlideView) {
    for (const m of view.media) showMedia(m, m.closest('[data-blitz-hidden]') === null && !this.pendingExit(view, m), this.mode === 'audience')
  }

  private pendingExit(view: SlideView, el: HTMLElement): boolean {
    return view.stepped.some((s) => s.phase === 'hidden' && s.el.contains(el))
  }

  private async mount(b: BlockView, step: number) {
    // The next preview never loads an embedded page: a second copy of a site costs the presenter's load (M12.4).
    if (this.mode === 'mirror-still' && b.data.renderer === 'embed') {
      b.el.replaceChildren(embedCard(this.doc, b.el, b.data.spec))
      b.instance = { update() {}, resize() {}, destroy: () => b.el.replaceChildren() }
      return
    }
    const gen = this.generation
    b.loading = true
    try {
      const renderer = await this.blocks.renderer(b.data.renderer)
      if (gen !== this.generation) return
      b.error?.remove()
      delete b.error
      if (!b.enhance) b.el.replaceChildren()
      // A block auto-animate moves in from the last slide is the same chart, already drawn: no entrance.
      const instance = await renderer.mount(b.el, b.data.spec, this.blocks.ctx(b.el, b.data, this.still || this.morphing.has(b.el)))
      if (gen !== this.generation) {
        instance.destroy()
        return
      }
      b.instance = instance
      instance.update(step)
    } catch (err) {
      if (gen !== this.generation) return
      const box = this.doc.createElement('div')
      box.className = 'blitz-block-error'
      box.textContent = `${b.data.renderer}: ${err instanceof Error ? err.message : String(err)}`
      b.error?.remove()
      b.error = box
      if (b.enhance) b.el.before(box)
      else b.el.replaceChildren(box)
      console.error(`[blitzstrahl] ${b.data.id}:`, err)
    } finally {
      b.loading = false
    }
  }

  private async toggleFullscreen() {
    try {
      if (this.doc.fullscreenElement) await this.doc.exitFullscreen()
      else await this.doc.documentElement.requestFullscreen()
    } catch {
      // Fullscreen refused (iframe, permissions): nothing useful to do.
    }
  }
}

const DEFAULT_TRANSITION_DUR = 500
/** Symmetric, so a mirrored transition feels like the same motion. */
const TRANSITION_EASE = 'cubic-bezier(.65, 0, .35, 1)'

function toggle(el: HTMLElement, key: string, on: boolean) {
  if (on) el.dataset[key] = ''
  else delete el.dataset[key]
}

/** Snaps still pending, per element: only the last one to end may lift `.blitz-snap`. */
const snapping = new WeakMap<HTMLElement, number>()

/** Apply the next class change without CSS transitions. */
function snap(el: HTMLElement) {
  el.classList.add('blitz-snap')
  void el.offsetWidth
  snapping.set(el, (snapping.get(el) ?? 0) + 1)
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const left = (snapping.get(el) ?? 1) - 1
      snapping.set(el, left)
      // Two quick steps back: the first one's snap ending mustn't let the second's change transition.
      if (!left) el.classList.remove('blitz-snap')
    }),
  )
}
