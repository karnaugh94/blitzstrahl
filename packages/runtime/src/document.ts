/**
 * Document mode (`?mode=doc`, PLAN §8, M11.4): every slide in one page that
 * scrolls, each at its final step, as its own HTML, scaled to the width.
 * For reading at one's own pace, screen readers and find-in-page, and,
 * printed, the handout (`&notes`, `export --notes`): two slides to a sheet,
 * each with its notes (decisions.md, "Handout: two slides per sheet").
 *
 * The deck isn't started: the page's slides are moved out of the stage and
 * shown as they are, so nothing in the page is there twice.
 */
import type { DeckPayload, PayloadSlide } from '@blitzstrahl/core'
import { fill, strings } from '@blitzstrahl/core/i18n'
import { Blocks } from './blocks.js'
import { MEDIA } from './media.js'
import { bindPrinting, mountReady, settle, showStep, type PrintResult } from './print.js'
import type { RenderInstance, RendererLoader } from './renderer.js'
import { formatHash, parseHash } from './steps.js'
import { uiWords } from './ui.js'

/** How a printed document's sheets are laid out. */
export interface HandoutLayout {
  paper: 'A4' | 'letter'
  /** Landscape: two slides side by side, notes under each. Portrait: two rows, notes beside. */
  orientation: 'portrait' | 'landscape'
}

export const DEFAULT_HANDOUT: HandoutLayout = { paper: 'A4', orientation: 'landscape' }

export interface DocumentOptions {
  /** Show each slide's presenter notes under it (`&notes`). */
  notes?: boolean
  handout?: Partial<HandoutLayout>
}

/** Paper sizes in millimetres, portrait. */
const PAPER = { A4: [210, 297], letter: [215.9, 279.4] } as const
const MARGIN_MM = 12
/** Between the two slides of a sheet, and between a slide and its notes. */
const GAP_MM = 10
const NOTES_GAP_MM = 4
/** The slide's share of the line when its notes are beside it. */
const BESIDE = 0.58
const NOTES_FONT = '9.5pt'
const NOTES_LEADING = 1.4
const PX_PER_MM = 96 / 25.4

interface Box {
  /** The slide's width, and its notes' box, in mm. */
  slide: number
  notesWidth: number
  notesHeight: number
}

/** Where things go on a sheet: two slides (`pair`), or one with long notes (`solo`, notes flow on). */
export function sheetGeometry(layout: HandoutLayout, canvas: { width: number; height: number }) {
  const landscape = layout.orientation === 'landscape'
  const [short, long] = PAPER[layout.paper]
  const page = landscape ? { width: long, height: short } : { width: short, height: long }
  const width = page.width - 2 * MARGIN_MM
  const height = page.height - 2 * MARGIN_MM
  const tall = (w: number) => (w * canvas.height) / canvas.width
  let pair: Box
  let solo: Box
  if (landscape) {
    const cell = (width - GAP_MM) / 2
    pair = { slide: cell, notesWidth: cell, notesHeight: height - tall(cell) - NOTES_GAP_MM }
    const beside = width * BESIDE
    solo = { slide: beside, notesWidth: width - beside - NOTES_GAP_MM, notesHeight: height }
  } else {
    const row = (height - GAP_MM) / 2
    const beside = Math.min(width * BESIDE, (row * canvas.width) / canvas.height)
    pair = { slide: beside, notesWidth: width - beside - NOTES_GAP_MM, notesHeight: row }
    solo = { slide: width, notesWidth: width, notesHeight: height - tall(width) - NOTES_GAP_MM }
  }
  return { page, width, height, pair, solo, landscape }
}

interface Page {
  article: HTMLElement
  frame: HTMLElement
  section: HTMLElement
  data: PayloadSlide
  index: number
}

export class DocumentView {
  private payload: DeckPayload
  private readonly win: Window
  private readonly blocks: Blocks
  private readonly root: HTMLElement
  private readonly style: HTMLStyleElement
  private pages: Page[] = []
  private readonly instances: RenderInstance[] = []
  /** Blocks mounted or mounting, by element, with what their mounting will say. */
  private readonly mounted = new Map<HTMLElement, Promise<string | undefined>>()
  private readonly observer: IntersectionObserver
  private readonly resize: ResizeObserver
  private readonly layout: HandoutLayout
  private readonly present: HTMLAnchorElement
  /** While printing: the pages, two to a sheet. */
  private sheets: HTMLElement[] = []
  private longNotes: string[] = []

  constructor(
    private readonly doc: Document,
    payload: DeckPayload,
    renderers: Record<string, RendererLoader> = {},
    private readonly options: DocumentOptions = {},
  ) {
    this.payload = payload
    this.win = doc.defaultView!
    this.blocks = new Blocks(doc, () => this.payload, renderers)
    this.layout = { ...DEFAULT_HANDOUT, ...options.handout }
    const words = uiWords(doc).document
    doc.documentElement.dataset.blitzMode = 'doc'

    this.style = doc.createElement('style')
    doc.head.append(this.style)
    this.root = doc.createElement('div')
    this.root.className = 'blitz-doc'
    this.present = doc.createElement('a')
    this.present.className = 'blitz-doc-present'
    this.present.textContent = words.present
    this.present.title = words.presentTitle
    // Kept current as the reader scrolls, so it's a real link (and opens in a new tab).
    this.present.addEventListener('click', () => (this.present.href = this.deckUrl()))
    this.win.addEventListener('scroll', () => (this.present.href = this.deckUrl()), { passive: true })
    const print = doc.createElement('button')
    print.type = 'button'
    print.textContent = words.print
    print.title = words.printTitle
    const bar = doc.createElement('nav')
    bar.className = 'blitz-doc-bar'
    bar.setAttribute('aria-label', words.label)
    bar.append(this.present, print)
    this.root.append(bar)
    doc.body.prepend(this.root)

    // Blocks are drawn as they come near; once drawn, they stay.
    this.observer = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) this.mountIn(e.target as HTMLElement)
    }, { rootMargin: '100% 0px' })
    this.resize = new ResizeObserver(() => this.rescale())

    this.render()
    const printer = bindPrinting(this.win, {
      prepare: async () => {
        await this.print()
        return { remove: () => this.unsheet() }
      },
      // The browser's menu prints what's drawn so far.
      fallback: () => {
        this.sheet()
        return { remove: () => this.unsheet() }
      },
    })
    print.addEventListener('click', () => printer.print())
    const onHash = () => this.scrollToHash()
    this.win.addEventListener('hashchange', onHash)
    this.scrollToHash()
    this.present.href = this.deckUrl()
  }

  /**
   * Draw every block that isn't yet, and wait for all of them and
   * everything else on the pages (`export --notes`, printing).
   */
  async print(): Promise<PrintResult> {
    for (const p of this.pages) this.mountIn(p.article)
    const warnings = await settle(this.root, [...this.mounted.values()])
    this.sheet()
    return { pages: this.sheets.length, warnings: [...warnings, ...this.longNotes] }
  }

  /** Dev HMR: a rebuilt deck. */
  update(payload: DeckPayload, stageHtml: string, notesHtml?: string): void {
    this.unsheet()
    this.payload = payload
    const stage = this.doc.querySelector<HTMLElement>('.blitz-stage')
    if (stage) stage.innerHTML = stageHtml
    const notes = this.doc.getElementById('blitz-notes')
    if (notes instanceof HTMLTemplateElement && notesHtml !== undefined) notes.innerHTML = notesHtml
    this.render()
  }

  // --- internals ---------------------------------------------------------

  /**
   * Group the pages two to a sheet for printing. A page whose notes don't
   * fit half a sheet gets a sheet to itself, and says so (`longNotes`).
   */
  private sheet() {
    if (this.sheets.length) return
    const geometry = sheetGeometry(this.layout, this.payload.canvas)
    const measure = this.doc.createElement('div')
    measure.className = 'blitz-doc-notes blitz-doc-measure'
    measure.style.width = `${geometry.pair.notesWidth}mm`
    this.root.append(measure)
    const room = geometry.pair.notesHeight * PX_PER_MM
    const deckWords = strings(this.payload.lang).deck
    this.longNotes = []
    let open: HTMLElement | undefined
    for (const p of this.pages) {
      const notes = p.article.querySelector('.blitz-doc-notes')
      let solo = false
      if (notes) {
        measure.replaceChildren(...[...notes.childNodes].map((n) => n.cloneNode(true)))
        const needed = measure.scrollHeight
        if (needed > room) {
          solo = true
          const over = Math.round((notes.textContent?.length ?? 0) * (1 - room / needed))
          const name = p.data.title ?? fill(deckWords.slide, { n: p.index + 1 })
          this.longNotes.push(`slide ${p.index + 1} (${name}): its notes are about ${over} characters too long for half a sheet; it gets a sheet to itself in the handout`)
        }
      }
      if (solo || !open || open.childElementCount === 2) {
        open = this.doc.createElement('div')
        open.className = solo ? 'blitz-doc-sheet blitz-doc-solo' : 'blitz-doc-sheet'
        this.sheets.push(open)
        p.article.before(open)
      }
      open.append(p.article)
      if (solo) open = undefined
    }
    measure.remove()
  }

  private unsheet() {
    for (const sheet of this.sheets) sheet.replaceWith(...sheet.childNodes)
    this.sheets = []
  }

  private render() {
    const { doc, payload } = this
    this.instances.splice(0).forEach((i) => i.destroy())
    this.mounted.clear()
    this.observer.disconnect()
    this.resize.disconnect()
    const stage = doc.querySelector<HTMLElement>('.blitz-stage')
    const fresh = stage ? [...stage.querySelectorAll<HTMLElement>(':scope > .blitz-slide')] : []
    // A rebuilt deck's slides are in the stage; otherwise they're on the pages already.
    const sections = fresh.length ? fresh : this.pages.map((p) => p.section)
    for (const p of this.pages) p.article.remove()
    const { width, height } = payload.canvas
    this.root.style.setProperty('--blitz-canvas-w', `${width}px`)
    this.root.style.setProperty('--blitz-canvas-h', `${height}px`)
    this.style.textContent = documentCss(payload.canvas, this.layout)
    const notes = doc.getElementById('blitz-notes')
    const deckWords = strings(payload.lang).deck

    this.pages = payload.slides.map((data, index) => {
      const section = sections[index]!
      showStep(section, data, data.steps)
      for (const m of section.querySelectorAll<HTMLMediaElement>(MEDIA)) {
        // A reader starts a clip; nothing plays by itself.
        m.controls = true
        m.preload = 'metadata'
      }
      const frame = doc.createElement('div')
      frame.className = 'blitz-doc-frame'
      frame.append(section)
      const article = doc.createElement('article')
      article.className = 'blitz-doc-page'
      article.dataset.blitzSlide = data.id
      article.setAttribute('aria-label', data.title ?? fill(deckWords.slide, { n: index + 1 }))
      article.append(frame)
      const body = this.options.notes && notes instanceof HTMLTemplateElement ? notes.content.querySelector(`[data-for="${CSS.escape(data.id)}"]`) : null
      if (body) {
        const aside = doc.createElement('aside')
        aside.className = 'blitz-doc-notes'
        aside.setAttribute('aria-label', deckWords.notes)
        aside.append(...body.cloneNode(true).childNodes)
        article.append(aside)
      }
      this.root.append(article)
      this.observer.observe(article)
      return { article, frame, section, data, index }
    })
    // The deck's own box is empty now; it's only in the way.
    doc.querySelector('.blitz-viewport')?.setAttribute('hidden', '')
    if (this.pages[0]) this.resize.observe(this.pages[0].frame)
    this.rescale()
  }

  private rescale() {
    const w = this.pages[0]?.frame.clientWidth
    if (!w) return
    // The screen's scale; printed, the paper sets its own (documentCss).
    this.root.style.setProperty('--blitz-doc-fit', String(w / this.payload.canvas.width))
    for (const i of this.instances) i.resize()
  }

  private mountIn(article: HTMLElement) {
    const page = this.pages.find((p) => p.article === article)
    if (!page) return
    for (const block of page.data.blocks) {
      const el = page.section.querySelector<HTMLElement>(`[data-blitz-block="${CSS.escape(block.id)}"]`)
      if (!el || this.mounted.has(el) || el.closest('[data-blitz-hidden]')) continue
      this.mounted.set(el, mountReady(el, block, page.index, () => this.blocks.mountStill(el, block, page.data.steps), this.instances))
    }
  }

  private scrollToHash() {
    const pos = parseHash(this.win.location.hash, this.payload.slides.map((s) => s.id))
    if (pos) this.pages[pos.slide]?.article.scrollIntoView()
  }

  /** The deck, at the slide the reader is on (the first whose top is on screen). */
  private deckUrl(): string {
    const url = new URL(this.win.location.href)
    url.searchParams.delete('mode')
    url.searchParams.delete('notes')
    const at = this.pages.find((p) => p.article.getBoundingClientRect().bottom > this.win.innerHeight * 0.25) ?? this.pages[0]
    url.hash = at ? formatHash({ slide: at.index, step: 0 }, this.payload.slides.map((s) => s.id)) : ''
    return url.href
  }
}

/**
 * On screen, slides one under another, scaled to the width (never beyond
 * the canvas). Printed, the handout: sheets of two slides with their notes
 * (`sheetGeometry`), zoomed to the paper. (Comments stay out of the string:
 * it ships in every page.)
 *
 * - `.blitz-doc-measure` is where `sheet()` measures notes at their printed size.
 * - Printed, a frame's edge is drawn inside it (`::after`): a shadow or an
 *   outline paints outside it, and Chrome repeats that at the foot of the page.
 * - Printed, slides are zoomed, not transformed: a transformed slide's
 *   far-reaching content (a map's paths) widens Chrome's print layout, which
 *   then shrinks every page to fit.
 */
export function documentCss(canvas: { width: number; height: number }, layout: HandoutLayout): string {
  const g = sheetGeometry(layout, canvas)
  const zoom = (mm: number) => (mm * PX_PER_MM) / canvas.width
  const notes = `font-size: ${NOTES_FONT}; line-height: ${NOTES_LEADING};`
  return /* css */ `
html[data-blitz-mode="doc"], html[data-blitz-mode="doc"] body { height: auto; overflow: visible; }
html[data-blitz-mode="doc"] body { background: var(--blitz-bg); color: var(--blitz-fg); font: 400 17px/1.55 var(--blitz-font-sans, system-ui, sans-serif); }
.blitz-doc { --blitz-doc-scale: var(--blitz-doc-fit, 1); max-width: calc(var(--blitz-canvas-w) + 32px); margin: 0 auto; padding: 0 16px 48px; box-sizing: border-box; }
.blitz-doc-bar {
  position: sticky; top: 0; z-index: 2; display: flex; justify-content: flex-end; gap: 8px; padding: 10px 0;
  background: var(--blitz-bg);
}
.blitz-doc-bar > * {
  font: inherit; font-size: 15px; color: inherit; background: none; cursor: pointer; text-decoration: none;
  border: 1px solid var(--blitz-rule, currentColor); border-radius: 6px; padding: 5px 14px;
}
.blitz-doc-bar > :focus-visible { outline: 3px solid var(--blitz-accent); outline-offset: 2px; }
.blitz-doc-page { margin: 0 0 40px; scroll-margin-top: 60px; }
.blitz-doc-frame {
  position: relative; overflow: hidden; width: 100%;
  aspect-ratio: ${canvas.width} / ${canvas.height};
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--blitz-fg) 18%, transparent);
}
.blitz-doc-frame > .blitz-slide {
  position: absolute; inset: 0 auto auto 0;
  width: var(--blitz-canvas-w); height: var(--blitz-canvas-h);
  transform-origin: 0 0; transform: scale(var(--blitz-doc-scale, 1));
}
.blitz-doc-notes { max-width: 46em; margin: 16px 0 0; }
.blitz-doc-notes > :first-child { margin-top: 0; }
.blitz-doc-notes > :last-child { margin-bottom: 0; }
.blitz-doc-measure { position: absolute; left: -100000px; top: 0; visibility: hidden; max-width: none; margin: 0; ${notes} }

@page { size: ${g.page.width}mm ${g.page.height}mm; margin: ${MARGIN_MM}mm; @bottom-right { content: counter(page) " / " counter(pages); font: 8pt sans-serif; color: #666; } }
@media print {
  html[data-blitz-mode="doc"] body { background: #fff; color: #111; }
  .blitz-doc { max-width: none; padding: 0; }
  .blitz-doc-bar { display: none; }
  .blitz-doc-sheet {
    display: flex; flex-direction: ${g.landscape ? 'row' : 'column'}; gap: ${GAP_MM}mm;
    height: ${g.height - 1}mm; overflow: hidden; break-after: page;
    --blitz-doc-scale: ${zoom(g.pair.slide)}; --blitz-doc-frame: ${g.pair.slide}mm;
  }
  .blitz-doc-sheet:last-of-type { break-after: auto; }
  .blitz-doc-page {
    margin: 0; flex: 0 0 auto; display: flex; gap: ${NOTES_GAP_MM}mm; min-width: 0; align-items: flex-start;
    flex-direction: ${g.landscape ? 'column' : 'row'}; ${g.landscape ? `width: ${g.pair.slide}mm;` : `height: ${g.pair.notesHeight}mm;`}
  }
  .blitz-doc-solo {
    height: auto; overflow: visible; display: block;
    --blitz-doc-scale: ${zoom(g.solo.slide)}; --blitz-doc-frame: ${g.solo.slide}mm;
  }
  .blitz-doc-solo > .blitz-doc-page { width: auto; height: auto; flex-direction: ${g.landscape ? 'row' : 'column'}; align-items: flex-start; }
  .blitz-doc-frame {
    width: var(--blitz-doc-frame); flex: none; box-shadow: none; break-inside: avoid;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .blitz-doc-frame::after { content: ''; position: absolute; inset: 0; border: 0.5pt solid #bbb; pointer-events: none; }
  .blitz-doc-frame > .blitz-slide { transform: none; zoom: var(--blitz-doc-scale); }
  .blitz-doc-notes { max-width: none; margin: 0; min-width: 0; flex: 1 1 0; ${notes} }
}
`
}
