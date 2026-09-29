/**
 * The print layout behind PDF export (PLAN §6): every slide as a page at its
 * final step, or, with `steps`, one page per step (handouts).
 *
 * Pages are clones of the slides with a step state applied statically, and
 * renderers mounted without motion. `buildPrint` resolves once everything on
 * every page has arrived (fonts, images, chart renders, map tiles, frames),
 * so the caller can print straight away.
 */
import type { PayloadSlide, StepRange } from '@blitzstrahl/core'
import type { BlockData, RenderInstance } from './renderer.js'
import { focusLines } from './lines.js'
import { mediaFrame } from './media.js'
import { phaseAt } from './steps.js'

export interface PrintOptions {
  /** One page per build step, instead of one per slide at its final step. */
  steps?: boolean
  /**
   * Printing from the browser (Ctrl+P): the pages are laid out out of
   * sight, and the deck stays on screen as it was.
   */
  quiet?: boolean
}

export interface PrintResult {
  pages: number
  /** Things that didn't finish in time (a map's tiles, a slow frame). */
  warnings: string[]
}

export interface PrintHost {
  doc: Document
  sections: HTMLElement[]
  slides: PayloadSlide[]
  canvas: { width: number; height: number }
  /** Mount a renderer into `el`, without motion. */
  mount(el: HTMLElement, block: BlockData, step: number): Promise<RenderInstance>
}

/** How long one block may take to be ready before printing goes ahead without it. */
export const READY_TIMEOUT = 15_000

/** Attributes that belong to the live deck's current state, not the slide. */
const LIVE_STATE = ['data-blitz-hidden', 'data-blitz-active', 'data-blitz-dim', 'data-blitz-focus', 'data-blitz-lines-on', 'data-blitz-current', 'data-blitz-outgoing', 'data-blitz-overflow', 'aria-hidden']

export async function buildPrint(host: PrintHost, options: PrintOptions = {}): Promise<{ result: PrintResult; remove(): void }> {
  const { doc } = host
  const root = printRoot(doc, host.canvas, options.quiet ?? false)

  const instances: RenderInstance[] = []
  const waits: Array<Promise<string | undefined>> = []
  host.slides.forEach((data, i) => {
    const states = options.steps ? Array.from({ length: data.steps + 1 }, (_, s) => s) : [data.steps]
    const outlined = new Set<number>()
    for (const step of states) {
      const copy = pageOf(host.sections[i]!, data, step)
      bookmarkOnce(copy, outlined)
      root.append(copy)
      for (const block of data.blocks) {
        const el = copy.querySelector<HTMLElement>(`[data-blitz-block="${CSS.escape(block.id)}"]`)
        // Enhanced blocks (sortable tables) are already complete as HTML.
        if (!el || el.closest('[data-blitz-hidden]')) continue
        el.replaceChildren()
        waits.push(mountReady(el, block, i, () => host.mount(el, block, step), instances))
      }
    }
  })

  const warnings = await settle(root, waits)

  return {
    result: { pages: root.querySelectorAll(':scope > .blitz-slide').length, warnings },
    remove() {
      instances.forEach((i) => i.destroy())
      removeRoot(root)
    },
  }
}

/**
 * Mount one block and wait until it's ready, within reason. Resolves to a
 * warning when it wasn't (or failed, when it shows its error instead).
 */
export function mountReady(el: HTMLElement, block: BlockData, slide: number, mount: () => Promise<RenderInstance>, instances: RenderInstance[]): Promise<string | undefined> {
  return mount().then(
    async (instance) => {
      instances.push(instance)
      const late = await timeout(instance.ready ?? Promise.resolve(), READY_TIMEOUT)
      return late ? `slide ${slide + 1}: the ${block.renderer} wasn't ready after ${READY_TIMEOUT / 1000}s; printed as it was` : undefined
    },
    (err: unknown) => {
      const box = el.ownerDocument.createElement('div')
      box.className = 'blitz-block-error'
      box.textContent = `${block.renderer}: ${err instanceof Error ? err.message : String(err)}`
      el.replaceChildren(box)
      return `slide ${slide + 1}: ${box.textContent}`
    },
  )
}

/** Wait for `blocks`, then for everything else under `root` to arrive and paint. */
export async function settle(root: HTMLElement, blocks: Array<Promise<string | undefined>>): Promise<string[]> {
  await root.ownerDocument.fonts?.ready
  const images = [...root.querySelectorAll('img')].map((img) => img.decode().catch(() => {}))
  // Video prints its poster, or its frame at `start` (syntax.md §13).
  const frames = [...root.querySelectorAll<HTMLMediaElement>('video, audio')].map((m) => mediaFrame(m, READY_TIMEOUT))
  const warnings = (await Promise.all(blocks)).filter((w): w is string => w !== undefined)
  // Images a renderer added (map tiles) are only there now.
  await Promise.all([...images, ...frames, ...[...root.querySelectorAll('img')].map((img) => img.decode().catch(() => {}))])
  // One more frame, so the last renders are painted.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  return warnings
}

/** The pages' container, at the end of `<body>`, and `<html>` in print state. */
function printRoot(doc: Document, canvas: { width: number; height: number }, quiet: boolean): HTMLElement {
  const root = doc.createElement('div')
  root.className = 'blitz-print'
  root.style.setProperty('--blitz-canvas-w', `${canvas.width}px`)
  root.style.setProperty('--blitz-canvas-h', `${canvas.height}px`)
  const page = doc.createElement('style')
  page.textContent = `@page { size: ${canvas.width}px ${canvas.height}px; margin: 0; }`
  root.append(page)
  doc.documentElement.dataset.blitzPrinting = quiet ? 'quiet' : ''
  doc.body.append(root)
  return root
}

function removeRoot(root: HTMLElement) {
  root.remove()
  delete root.ownerDocument.documentElement.dataset.blitzPrinting
}

export interface StaticPrintHost {
  doc: Document
  sections: HTMLElement[]
  slides: PayloadSlide[]
  canvas: { width: number; height: number }
  /** What each block (by id) last drew, from `snapshot`. */
  drawings: ReadonlyMap<string, HTMLElement>
}

/**
 * The print layout at once, for printing from the browser's menu, which
 * can't wait for renderers: every slide at its final step, each block as it
 * last drew (`snapshot`), or an empty frame, named by its alt text, if its
 * slide hasn't been shown.
 */
export function buildStaticPrint(host: StaticPrintHost): { remove(): void } {
  const { doc } = host
  const root = printRoot(doc, host.canvas, true)
  host.slides.forEach((data, i) => {
    const copy = pageOf(host.sections[i]!, data, data.steps)
    for (const block of data.blocks) {
      const el = copy.querySelector<HTMLElement>(`[data-blitz-block="${CSS.escape(block.id)}"]`)
      if (!el) continue
      const drawn = host.drawings.get(block.id)
      if (drawn) {
        el.replaceChildren(...drawn.cloneNode(true).childNodes)
      } else {
        const missing = doc.createElement('div')
        missing.className = 'blitz-print-missing'
        missing.textContent = el.getAttribute('aria-label') ?? ''
        el.replaceChildren(missing)
      }
    }
    root.append(copy)
  })
  return { remove: () => removeRoot(root) }
}

/**
 * A copy of what a block has drawn, to print later. Canvases become images
 * (a clone has no pixels), and embedded pages are left out: a browser
 * prints them blank.
 */
export function snapshot(el: HTMLElement): HTMLElement {
  const copy = el.cloneNode(true) as HTMLElement
  const canvases = el.querySelectorAll('canvas')
  copy.querySelectorAll('canvas').forEach((c, k) => {
    try {
      const img = el.ownerDocument.createElement('img')
      img.src = canvases[k]!.toDataURL()
      img.alt = ''
      img.style.cssText = c.style.cssText
      c.replaceWith(img)
    } catch {
      c.remove() // tainted by another origin's image
    }
  })
  copy.querySelectorAll('iframe').forEach((f) => f.remove())
  return copy
}

export interface Printing {
  /** Lay every page out, awaiting renders (Ctrl+P). */
  prepare(): Promise<{ remove(): void }>
  /** Lay the pages out at once (the browser's own Print menu). */
  fallback(): { remove(): void }
}

/**
 * Printing from the browser (M11.3). `Ctrl+P` (`⌘P`) is taken over, so the
 * pages are complete before the dialog opens; the menu's Print can't be
 * delayed, so `beforeprint` lays out what it can, synchronously.
 */
export function bindPrinting(win: Window, printing: Printing): { print(): void; unbind(): void } {
  let laidOut: { remove(): void } | undefined
  let preparing = false
  const done = () => {
    laidOut?.remove()
    laidOut = undefined
  }
  const print = () => {
    if (preparing) return
    preparing = true
    printing
      .prepare()
      .then((built) => {
        done()
        laidOut = built
        win.print()
      })
      .catch((err: unknown) => console.error('[blitzstrahl] printing:', err))
      .finally(() => (preparing = false))
  }
  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'p') return
    e.preventDefault()
    print()
  }
  const before = () => {
    // Pages already laid out (by us, or by `export`) print as they are.
    if (laidOut || preparing || win.document.documentElement.dataset.blitzPrinting !== undefined) return
    laidOut = printing.fallback()
  }
  win.addEventListener('keydown', onKey)
  win.addEventListener('beforeprint', before)
  win.addEventListener('afterprint', done)
  return {
    print,
    unbind() {
      win.removeEventListener('keydown', onKey)
      win.removeEventListener('beforeprint', before)
      win.removeEventListener('afterprint', done)
      done()
    },
  }
}

/** A clone of a slide showing `step`, as a static page. */
function pageOf(section: HTMLElement, data: PayloadSlide, step: number): HTMLElement {
  const copy = section.cloneNode(true) as HTMLElement
  showStep(copy, data, step)
  copy.dataset.blitzPrintPage = String(step)
  return copy
}

/** Make a slide show `step`, statically: the live deck's state goes. */
export function showStep(copy: HTMLElement, data: PayloadSlide, step: number): void {
  for (const el of [copy, ...copy.querySelectorAll<HTMLElement>('*')]) {
    for (const a of LIVE_STATE) el.removeAttribute(a)
    el.style.removeProperty('z-index')
  }

  const dimmed = new Set<HTMLElement>()
  for (const el of copy.querySelectorAll<HTMLElement>('[data-blitz-step-in]')) {
    const range: StepRange = { in: Number(el.dataset.blitzStepIn) }
    if (el.dataset.blitzStepOut !== undefined) range.out = Number(el.dataset.blitzStepOut)
    const anim = el.dataset.blitzAnim === undefined ? undefined : data.anims[Number(el.dataset.blitzAnim)]
    const phase = phaseAt(anim?.kind ?? 'entrance', range, step)
    if (anim?.kind === 'emphasis') {
      el.dataset.blitzFx = anim.effect
      if (phase === 'active') {
        el.dataset.blitzActive = ''
        if (anim.effect === 'dim-others' && el.parentElement) dimmed.add(el.parentElement)
      }
    } else if (phase === 'hidden') {
      el.dataset.blitzHidden = ''
    }
  }
  for (const p of dimmed) p.dataset.blitzDim = ''
  for (const pre of copy.querySelectorAll<HTMLElement>('pre[data-blitz-lines]')) focusLines(pre, step)
}

/**
 * A PDF's outline is its headings (Chromium's `outline`), so a heading
 * repeated on every step's page would be bookmarked once per page. It stays
 * a heading only on the first page that shows it; on the others it's text.
 */
function bookmarkOnce(copy: HTMLElement, outlined: Set<number>) {
  copy.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6').forEach((h, k) => {
    if (!outlined.has(k) && !h.closest('[data-blitz-hidden]')) outlined.add(k)
    else h.setAttribute('role', 'none')
  })
}

/** Resolves true if `p` didn't settle within `ms`. */
export function timeout(p: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(true), ms)
    p.then(
      () => (clearTimeout(t), resolve(false)),
      () => (clearTimeout(t), resolve(false)),
    )
  })
}
