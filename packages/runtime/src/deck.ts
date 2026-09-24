/**
 * The deck controller: one navigator surface (`advance`, `retreat`, `goto`)
 * fed by every input source, applying step state to the DOM and driving
 * renderers (PLAN §3).
 */
import type { AnimSpec, DeckPayload, EffectKind, PayloadSlide, StepRange } from '@blitzstrahl/core'
import { needsBox, playEntrance, playExit, type Played } from './effects.js'
import { bindKeyboard, bindPointer, type NavTarget } from './input.js'
import type { BlockData, RenderInstance, RendererLoader } from './renderer.js'
import { clamp, formatHash, motion, next, parseHash, phaseAt, prev, type Motion, type Phase, type Position } from './steps.js'

export interface StartOptions {
  /** Lazy loaders per renderer name. The entry module wires these up. */
  renderers?: Record<string, RendererLoader>
  document?: Document
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
  instance?: RenderInstance
  loading?: boolean
}

interface SlideView {
  el: HTMLElement
  data: PayloadSlide
  stepped: Stepped[]
  blocks: BlockView[]
}

export type ChangeListener = (pos: Position, deck: Deck) => void

export class Deck implements NavTarget {
  pos: Position | undefined
  private views: SlideView[] = []
  private payload!: DeckPayload
  private readonly doc: Document
  private readonly win: Window
  private readonly viewport: HTMLElement
  private readonly stage: HTMLElement
  private readonly live: HTMLElement | null
  private readonly renderers: Record<string, RendererLoader>
  private readonly listeners = new Set<ChangeListener>()
  private readonly cleanups: Array<() => void> = []
  private readonly reduced: MediaQueryList
  /** Bumped whenever block instances are torn down, to drop stale async mounts. */
  private generation = 0

  constructor(payload: DeckPayload, options: StartOptions = {}) {
    this.doc = options.document ?? document
    this.win = this.doc.defaultView!
    this.renderers = options.renderers ?? {}
    this.viewport = this.doc.querySelector<HTMLElement>('.blitz-viewport')!
    this.stage = this.doc.querySelector<HTMLElement>('.blitz-stage')!
    this.live = this.doc.querySelector<HTMLElement>('.blitz-sr')
    this.reduced = this.win.matchMedia('(prefers-reduced-motion: reduce)')
    this.load(payload)

    this.cleanups.push(
      bindKeyboard(this.win, this, (e) => {
        if (e.key === 'f' || e.key === 'F') {
          void this.toggleFullscreen()
          return true
        }
        return false
      }),
      bindPointer(this.viewport, this),
    )

    const ro = new ResizeObserver(() => this.rescale())
    ro.observe(this.viewport)
    this.cleanups.push(() => ro.disconnect())

    const onHash = () => {
      const p = parseHash(this.win.location.hash, this.ids)
      if (p) this.goto(p.slide, p.step, { history: 'none' })
    }
    this.win.addEventListener('hashchange', onHash)
    this.cleanups.push(() => this.win.removeEventListener('hashchange', onHash))

    const initial = parseHash(this.win.location.hash, this.ids) ?? { slide: 0, step: 0 }
    this.goto(initial.slide, initial.step, { history: 'replace' })
  }

  get ids(): string[] {
    return this.payload.slides.map((s) => s.id)
  }

  get steps(): number[] {
    return this.payload.slides.map((s) => s.steps)
  }

  get slideCount(): number {
    return this.views.length
  }

  onChange(cb: ChangeListener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
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

    if (from && from.slide !== to.slide) this.leave(this.views[from.slide]!)
    const view = this.views[to.slide]!
    if (!from || from.slide !== to.slide) this.enter(view)
    this.pos = to
    this.apply(view, to.step, m)
    this.syncBlocks(view, to.step)

    const history = opts.history ?? (from && from.slide === to.slide ? 'replace' : 'push')
    if (history !== 'none') {
      const url = formatHash(to, this.ids)
      if (this.win.location.hash !== url) {
        if (history === 'push') this.win.history.pushState(null, '', url)
        else this.win.history.replaceState(null, '', url)
      }
    }
    for (const cb of this.listeners) cb(to, this)
  }

  /** Swap in a rebuilt deck (dev HMR), keeping the current slide and step. */
  update(payload: DeckPayload, stageHtml: string): void {
    const at = this.pos
    const id = at ? this.ids[at.slide] : undefined
    if (at) this.leave(this.views[at.slide]!)
    this.stage.innerHTML = stageHtml
    this.load(payload)
    this.pos = undefined
    const idx = id ? this.ids.indexOf(id) : -1
    const slide = idx >= 0 ? idx : Math.min(at?.slide ?? 0, this.views.length - 1)
    this.goto(slide, at?.step ?? 0, { history: 'replace' })
    // Don't replay entrance effects on every save: settle immediately.
    this.current()?.stepped.forEach((s) => s.running?.finish())
  }

  destroy(): void {
    if (this.pos) this.leave(this.views[this.pos.slide]!)
    this.cleanups.forEach((c) => c())
  }

  // --- internals ---------------------------------------------------------

  private current(): SlideView | undefined {
    return this.pos && this.views[this.pos.slide]
  }

  private load(payload: DeckPayload) {
    this.payload = payload
    const { width, height } = payload.canvas
    this.stage.style.setProperty('--blitz-canvas-w', `${width}px`)
    this.stage.style.setProperty('--blitz-canvas-h', `${height}px`)
    const sections = [...this.stage.querySelectorAll<HTMLElement>(':scope > .blitz-slide')]
    this.views = payload.slides.map((data, i) => this.buildView(sections[i]!, data))
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
        } else if (needsBox(anim.effect) && this.win.getComputedStyle(node).display === 'inline') {
          node.dataset.blitzBox = ''
        }
      }
      stepped.push({ el: node, range, kind, anim })
    }
    const blocks: BlockView[] = []
    for (const b of data.blocks) {
      const node = el.querySelector<HTMLElement>(`[data-blitz-block="${CSS.escape(b.id)}"]`)
      if (!node) continue
      node.dataset.blitzInteractive = ''
      for (const dim of ['width', 'height'] as const) {
        const v = node.getAttribute(dim)
        if (v) node.style[dim] = /^\d+$/.test(v) ? `${v}px` : v
      }
      blocks.push({ el: node, data: b })
    }
    return { el, data, stepped, blocks }
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
    view.el.dataset.blitzCurrent = ''
    view.el.removeAttribute('aria-hidden')
    for (const s of view.stepped) delete s.phase
    if (this.live) {
      const i = this.views.indexOf(view)
      this.live.textContent = `${view.data.title ?? `Slide ${i + 1}`} (${i + 1} of ${this.views.length})`
    }
  }

  private leave(view: SlideView) {
    delete view.el.dataset.blitzCurrent
    view.el.setAttribute('aria-hidden', 'true')
    for (const s of view.stepped) s.running?.finish()
    this.generation++
    for (const b of view.blocks) {
      b.instance?.destroy()
      delete b.instance
      b.loading = false
    }
  }

  private apply(view: SlideView, step: number, m: Motion) {
    const animate = !this.reduced.matches
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
        if (animate && entrance && was !== 'shown') s.running = playEntrance(s.el, anim)
      } else if (animate && m === 'step-forward' && was === 'shown') {
        const run = playExit(s.el, anim)
        s.running = run
        void run.finished.then(() => {
          if (s.phase === 'hidden') toggle(s.el, 'blitzHidden', true)
        })
      } else if (animate && m === 'step-back' && was === 'shown' && s.anim?.reverse) {
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
  }

  private syncBlocks(view: SlideView, step: number) {
    for (const b of view.blocks) {
      const visible = b.el.closest('[data-blitz-hidden]') === null && !this.pendingExit(view, b.el)
      if (b.instance) b.instance.update(step)
      else if (visible && !b.loading) void this.mount(b, step)
    }
  }

  private pendingExit(view: SlideView, el: HTMLElement): boolean {
    return view.stepped.some((s) => s.phase === 'hidden' && s.el.contains(el))
  }

  private async mount(b: BlockView, step: number) {
    const gen = this.generation
    b.loading = true
    const loader = this.renderers[b.data.renderer]
    try {
      if (!loader) throw new Error(`No \`${b.data.renderer}\` renderer in this build.`)
      const mod = await loader()
      const renderer = 'default' in mod ? mod.default : mod
      if (gen !== this.generation) return
      b.el.replaceChildren()
      const instance = await renderer.mount(b.el, b.data.spec, {
        block: b.data,
        token: (name) => this.win.getComputedStyle(b.el).getPropertyValue(name).trim(),
        reducedMotion: this.reduced.matches,
        loadAsset: (path) => this.loadAsset(path),
      })
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
      b.el.replaceChildren(box)
      console.error(`[blitzstrahl] ${b.data.id}:`, err)
    } finally {
      b.loading = false
    }
  }

  private async loadAsset(path: string): Promise<string> {
    const inline = this.payload.inline[path]
    if (inline !== undefined) return inline
    const res = await fetch(new URL(path, this.doc.baseURI))
    if (!res.ok) throw new Error(`could not load \`${path}\` (${res.status})`)
    return res.text()
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

function toggle(el: HTMLElement, key: string, on: boolean) {
  if (on) el.dataset[key] = ''
  else delete el.dataset[key]
}

/** Apply the next class change without CSS transitions. */
function snap(el: HTMLElement) {
  el.classList.add('blitz-snap')
  void el.offsetWidth
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('blitz-snap')))
}
