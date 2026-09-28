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
const READY_TIMEOUT = 15_000

/** Attributes that belong to the live deck's current state, not the slide. */
const LIVE_STATE = ['data-blitz-hidden', 'data-blitz-active', 'data-blitz-dim', 'data-blitz-focus', 'data-blitz-lines-on', 'data-blitz-current', 'data-blitz-outgoing', 'data-blitz-overflow', 'aria-hidden']

export async function buildPrint(host: PrintHost, options: PrintOptions = {}): Promise<{ result: PrintResult; remove(): void }> {
  const { doc, canvas } = host
  const root = doc.createElement('div')
  root.className = 'blitz-print'
  root.style.setProperty('--blitz-canvas-w', `${canvas.width}px`)
  root.style.setProperty('--blitz-canvas-h', `${canvas.height}px`)
  const page = doc.createElement('style')
  page.textContent = `@page { size: ${canvas.width}px ${canvas.height}px; margin: 0; }`
  root.append(page)
  doc.documentElement.dataset.blitzPrinting = ''
  doc.body.append(root)

  const instances: RenderInstance[] = []
  const waits: Array<Promise<string | undefined>> = []
  host.slides.forEach((data, i) => {
    const states = options.steps ? Array.from({ length: data.steps + 1 }, (_, s) => s) : [data.steps]
    for (const step of states) {
      const copy = pageOf(host.sections[i]!, data, step)
      root.append(copy)
      for (const block of data.blocks) {
        const el = copy.querySelector<HTMLElement>(`[data-blitz-block="${CSS.escape(block.id)}"]`)
        // Enhanced blocks (sortable tables) are already complete as HTML.
        if (!el || el.closest('[data-blitz-hidden]')) continue
        el.replaceChildren()
        waits.push(
          host.mount(el, block, step).then(
            async (instance) => {
              instances.push(instance)
              const late = await timeout(instance.ready ?? Promise.resolve(), READY_TIMEOUT)
              return late ? `slide ${i + 1}: the ${block.renderer} wasn't ready after ${READY_TIMEOUT / 1000}s; printed as it was` : undefined
            },
            (err: unknown) => {
              const box = doc.createElement('div')
              box.className = 'blitz-block-error'
              box.textContent = `${block.renderer}: ${err instanceof Error ? err.message : String(err)}`
              el.replaceChildren(box)
              return `slide ${i + 1}: ${box.textContent}`
            },
          ),
        )
      }
    }
  })

  await doc.fonts?.ready
  const images = [...root.querySelectorAll('img')].map((img) => img.decode().catch(() => {}))
  // Video prints its poster, or its frame at `start` (syntax.md §13).
  const frames = [...root.querySelectorAll<HTMLMediaElement>('video, audio')].map((m) => mediaFrame(m, READY_TIMEOUT))
  const warnings = (await Promise.all(waits)).filter((w): w is string => w !== undefined)
  await Promise.all([...images, ...frames])
  // One more frame, so the last renders are painted.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

  return {
    result: { pages: root.querySelectorAll(':scope > .blitz-slide').length, warnings },
    remove() {
      instances.forEach((i) => i.destroy())
      root.remove()
      delete doc.documentElement.dataset.blitzPrinting
    },
  }
}

/** A clone of a slide showing `step`, as a static page. */
function pageOf(section: HTMLElement, data: PayloadSlide, step: number): HTMLElement {
  const copy = section.cloneNode(true) as HTMLElement
  for (const el of [copy, ...copy.querySelectorAll<HTMLElement>('*')]) {
    for (const a of LIVE_STATE) el.removeAttribute(a)
    el.style.removeProperty('z-index')
  }
  copy.dataset.blitzPrintPage = String(step)

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
  return copy
}

/** Resolves true if `p` didn't settle within `ms`. */
function timeout(p: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(true), ms)
    p.then(
      () => (clearTimeout(t), resolve(false)),
      () => (clearTimeout(t), resolve(false)),
    )
  })
}
