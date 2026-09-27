/**
 * Overlays on top of the deck (PLAN §8 keyboard map): the slide overview,
 * the go-to prompt and the key help. Each is a modal layer that owns the
 * keyboard while open. They live outside `.blitz-viewport`, so their clicks
 * never reach the edge gutters.
 *
 * The overview is also the presenter's slide grid, so it takes callbacks
 * rather than a deck.
 */
import { fill, strings, uiLanguage, type Strings } from '@blitzstrahl/core/i18n'

/** A modal layer. `onKey` returns true when it handled the key. */
export interface Layer {
  el: HTMLElement
  /** Element to focus when the layer opens. */
  focus?: HTMLElement
  onKey?(e: KeyboardEvent): boolean
  /** Called when the layer closes, however it closes. */
  onClose?(): void
}

/** At most one layer open at a time; Escape closes it. */
export class LayerHost {
  private open_: Layer | undefined
  private returnFocus: Element | null = null

  constructor(private readonly doc: Document) {}

  get current(): Layer | undefined {
    return this.open_
  }

  open(layer: Layer): void {
    this.close()
    this.returnFocus = this.doc.activeElement
    this.open_ = layer
    this.doc.body.append(layer.el)
    ;(layer.focus ?? layer.el).focus()
  }

  close(): void {
    const layer = this.open_
    if (!layer) return
    this.open_ = undefined
    layer.el.remove()
    layer.onClose?.()
    if (this.returnFocus instanceof HTMLElement) this.returnFocus.focus()
    this.returnFocus = null
  }

  /** Route a key to the open layer. Everything is swallowed while one is open. */
  key(e: KeyboardEvent): boolean {
    const layer = this.open_
    if (!layer) return false
    if (layer.onKey?.(e)) return true
    if (e.key === 'Escape') this.close()
    return true
  }
}

function h<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  props: Partial<Record<string, string>> = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag)
  for (const [k, v] of Object.entries(props)) if (v !== undefined) el.setAttribute(k, v)
  el.append(...children)
  return el
}

export interface SlideInfo {
  id: string
  title?: string
}

/** Label for a slide in lists: its title, or its number. */
/** The words of the overlays: for whoever presents, so in the browser's language (docs/presenting.md). */
export const uiWords = (doc: Document) => strings(uiLanguage(doc.defaultView?.navigator.languages)).ui

/** A slide's title, or "Slide 3" in `words`' language. */
export const slideLabel = (s: SlideInfo, i: number, words: { slide: string }) => s.title ?? fill(words.slide, { n: i + 1 })

export interface OverviewOptions {
  /** The deck's `.blitz-stage`, whose sections are cloned as thumbnails. */
  stage: HTMLElement
  slides: SlideInfo[]
  canvas: { width: number; height: number }
  current: number
  pick(index: number): void
  /** Close after picking (the deck); the presenter keeps its grid. */
  closeOnPick?: boolean
  host?: LayerHost
}

/**
 * Thumbnails of every slide with all its steps shown. Arrows move, Enter or
 * a click picks. Render blocks show as labelled placeholders.
 */
export function overview(doc: Document, o: OverviewOptions): Layer {
  const words = uiWords(doc)
  const grid = h(doc, 'div', { class: 'blitz-overview-grid', role: 'listbox', 'aria-label': words.slides })
  const el = h(doc, 'div', { class: 'blitz-layer blitz-overview', role: 'dialog', 'aria-modal': 'true', 'aria-label': words.allSlides }, grid)
  const sections = [...o.stage.querySelectorAll<HTMLElement>(':scope > .blitz-slide')]
  const thumbs = o.slides.map((s, i) => {
    const btn = h(doc, 'button', { class: 'blitz-thumb', type: 'button', role: 'option', 'data-index': String(i), 'aria-label': `${i + 1}. ${slideLabel(s, i, words)}` })
    const frame = h(doc, 'div', { class: 'blitz-thumb-frame' })
    frame.style.aspectRatio = `${o.canvas.width} / ${o.canvas.height}`
    const canvas = h(doc, 'div', { class: 'blitz-thumb-canvas' })
    canvas.style.width = `${o.canvas.width}px`
    canvas.style.height = `${o.canvas.height}px`
    const section = sections[i]
    if (section) canvas.append(thumbnail(section))
    frame.append(canvas)
    btn.append(frame, h(doc, 'span', { class: 'blitz-thumb-label' }, h(doc, 'b', {}, String(i + 1)), ' ', slideLabel(s, i, words)))
    btn.addEventListener('click', () => choose(i))
    grid.append(btn)
    return btn
  })

  let selected = o.current
  const select = (i: number) => {
    selected = Math.max(0, Math.min(thumbs.length - 1, i))
    thumbs.forEach((t, k) => t.setAttribute('aria-selected', String(k === selected)))
    thumbs[selected]?.focus()
    thumbs[selected]?.scrollIntoView({ block: 'nearest' })
  }
  const choose = (i: number) => {
    o.pick(i)
    if (o.closeOnPick !== false) o.host?.close()
    else select(i)
  }
  thumbs[o.current]?.setAttribute('aria-current', 'true')

  const ro = new ResizeObserver(() => {
    const w = thumbs[0]?.querySelector<HTMLElement>('.blitz-thumb-frame')?.clientWidth ?? 0
    grid.style.setProperty('--blitz-thumb-scale', String(w / o.canvas.width))
  })
  ro.observe(grid)

  const columns = () => getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 1
  const layer: Layer = {
    el,
    onKey(e) {
      switch (e.key) {
        case 'ArrowRight':
          select(selected + 1)
          return true
        case 'ArrowLeft':
          select(selected - 1)
          return true
        case 'ArrowDown':
          select(selected + columns())
          return true
        case 'ArrowUp':
          select(selected - columns())
          return true
        case 'Home':
          select(0)
          return true
        case 'End':
          select(thumbs.length - 1)
          return true
        case 'Enter':
        case ' ':
          choose(selected)
          return true
        case 'o':
        case 'O':
          o.host?.close()
          return true
      }
      return false
    },
    onClose: () => ro.disconnect(),
  }
  const first = thumbs[o.current]
  if (first) layer.focus = first
  queueMicrotask(() => select(o.current))
  return layer
}

/** A static copy of a slide with every step shown and no live renderers. */
function thumbnail(section: HTMLElement): HTMLElement {
  const copy = section.cloneNode(true) as HTMLElement
  for (const el of [copy, ...copy.querySelectorAll<HTMLElement>('*')]) {
    el.removeAttribute('id')
    el.removeAttribute('aria-hidden')
    delete el.dataset.blitzHidden
    delete el.dataset.blitzCurrent
    delete el.dataset.blitzOutgoing
    el.style.removeProperty('z-index')
  }
  for (const block of copy.querySelectorAll<HTMLElement>('[data-blitz-block]')) {
    block.replaceChildren()
    block.dataset.blitzPlaceholder = (block.dataset.blitzBlock ?? '').replace(/-\d+$/, '')
  }
  copy.setAttribute('inert', '')
  return copy
}

export interface GotoOptions {
  slides: SlideInfo[]
  go(index: number): void
  host: LayerHost
}

/** Resolve what was typed into the go-to prompt: a number, an id, or a title. */
export function findSlide(query: string, slides: SlideInfo[]): number | undefined {
  const q = query.trim().replace(/^#\/?/, '')
  if (!q) return undefined
  if (/^\d+$/.test(q)) {
    const n = Number(q)
    return n >= 1 && n <= slides.length ? n - 1 : undefined
  }
  const lower = q.toLowerCase()
  const byId = slides.findIndex((s) => s.id === q)
  if (byId >= 0) return byId
  const starts = slides.findIndex((s) => s.title?.toLowerCase().startsWith(lower))
  if (starts >= 0) return starts
  const has = slides.findIndex((s) => s.title?.toLowerCase().includes(lower))
  return has >= 0 ? has : undefined
}

/** `G`: type a slide number, id or part of a title. */
export function gotoPrompt(doc: Document, o: GotoOptions): Layer {
  const words = uiWords(doc)
  const input = h(doc, 'input', { type: 'text', class: 'blitz-goto-input', 'aria-label': words.gotoLabel, placeholder: fill(words.gotoPlaceholder, { total: o.slides.length }), autocomplete: 'off', spellcheck: 'false' })
  const hint = h(doc, 'p', { class: 'blitz-goto-hint', 'aria-live': 'polite' })
  const el = h(doc, 'div', { class: 'blitz-layer blitz-dialog blitz-goto', role: 'dialog', 'aria-modal': 'true', 'aria-label': words.gotoTitle }, h(doc, 'label', {}, words.gotoTitle), input, hint)
  const preview = () => {
    const i = findSlide(input.value, o.slides)
    hint.textContent = i === undefined ? (input.value.trim() ? words.noSuchSlide : '') : `${i + 1} · ${slideLabel(o.slides[i]!, i, words)}`
  }
  input.addEventListener('input', preview)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const i = findSlide(input.value, o.slides)
      if (i === undefined) {
        hint.textContent = words.noSuchSlide
        return
      }
      o.host.close()
      o.go(i)
    } else if (e.key === 'Escape') {
      o.host.close()
    }
  })
  return { el, focus: input }
}

/** The keys, as shown by `?`, with what each does (`ui.keys`). */
export const KEYS: ReadonlyArray<[string, keyof Strings['ui']['keys']]> = [
  ['→  ↓  Space  PageDown', 'next'],
  ['←  ↑  Shift+Space  PageUp', 'previous'],
  ['Home  End', 'firstLast'],
  ['Esc  O', 'overview'],
  ['G', 'goto'],
  ['B  .', 'blackout'],
  ['F', 'fullscreen'],
  ['P', 'presenter'],
  ['L', 'laser'],
  ['D', 'draw'],
  ['C', 'clear'],
  ['?', 'help'],
]

export function help(doc: Document, host: LayerHost): Layer {
  const words = uiWords(doc)
  const rows = KEYS.map(([k, key]) => [k, words.keys[key]] as const).map(([k, what]) => h(doc, 'tr', {}, h(doc, 'th', {}, ...k.split('  ').flatMap((x, i) => (i ? [' ', h(doc, 'kbd', {}, x)] : [h(doc, 'kbd', {}, x)]))), h(doc, 'td', {}, what)))
  const close = h(doc, 'button', { type: 'button', class: 'blitz-dialog-close', 'aria-label': words.close }, '×')
  close.addEventListener('click', () => host.close())
  const el = h(doc, 'div', { class: 'blitz-layer blitz-dialog blitz-help', role: 'dialog', 'aria-modal': 'true', 'aria-label': words.keyboardShortcuts, tabindex: '-1' }, close, h(doc, 'h2', {}, words.keyboard), h(doc, 'table', {}, ...rows), h(doc, 'p', {}, words.edgeHint))
  return {
    el,
    onKey(e) {
      if (e.key === '?') {
        host.close()
        return true
      }
      return false
    },
  }
}

/**
 * `P` couldn't open a window (a popup blocker: Firefox doesn't count a key
 * press as permission). A link is a click, which every browser allows, and
 * `rel="opener"` lets the presenter find this deck.
 */
export function presenterBlocked(doc: Document, host: LayerHost, href: string): Layer {
  const words = uiWords(doc)
  const close = h(doc, 'button', { type: 'button', class: 'blitz-dialog-close', 'aria-label': words.close }, '×')
  close.addEventListener('click', () => host.close())
  const link = h(doc, 'a', { href, target: '_blank', rel: 'opener', class: 'blitz-presenter-link' }, words.openPresenter)
  link.addEventListener('click', () => queueMicrotask(() => host.close()))
  const el = h(
    doc,
    'div',
    { class: 'blitz-layer blitz-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': words.presenterView, tabindex: '-1' },
    close,
    h(doc, 'h2', {}, words.presenterBlocked),
    h(doc, 'p', {}, link),
    h(doc, 'p', { class: 'blitz-dialog-hint' }, words.allowPopups),
  )
  return { el, focus: link, onKey: () => false }
}

