/**
 * What each render block last drew, by block id (M11.3's snapshots):
 * printing from the browser's menu uses them, and so do the overview's
 * thumbnails (M12.5). A block the overview needs that was never shown is
 * drawn once, off screen and without motion, then kept like the rest.
 */
import type { PayloadSlide } from '@blitzstrahl/core'
import type { BlockData, RenderInstance } from './renderer.js'
import { mountReady, settle, showStep, snapshot } from './print.js'

export interface DrawingHost {
  canvas(): { width: number; height: number }
  /** The deck's slide `i`, as it's in the stage. */
  section(i: number): HTMLElement | undefined
  slide(i: number): PayloadSlide | undefined
  /** Mount a renderer into `el`, without motion. */
  mount(el: HTMLElement, block: BlockData, step: number): Promise<RenderInstance>
}

/** Embedded pages are never drawn in the background: the overview shows a card. */
const drawable = (b: BlockData) => b.renderer !== 'embed'

export class Drawings extends Map<string, HTMLElement> {
  /** One slide at a time, so opening the overview never starts every renderer at once. */
  private queue: Promise<void> = Promise.resolve()
  private readonly asked = new Set<number>()

  constructor(private readonly host: DrawingHost) {
    super()
  }

  /** Keep what `el` shows now as block `id`'s drawing. */
  keep(id: string, el: HTMLElement): void {
    this.set(id, snapshot(el))
  }

  /** Draw slide `i`'s blocks that have no drawing yet, once. Resolves when they're in. */
  draw(i: number): Promise<void> {
    if (!this.asked.has(i)) {
      this.asked.add(i)
      this.queue = this.queue.then(() => this.drawNow(i)).catch(() => {})
    }
    return this.queue
  }

  override clear(): void {
    super.clear()
    this.asked.clear()
  }

  private async drawNow(i: number) {
    const data = this.host.slide(i)
    const section = this.host.section(i)
    const todo = data?.blocks.filter((b) => drawable(b) && !this.has(b.id)) ?? []
    if (!data || !section || !todo.length) return
    const doc = section.ownerDocument
    const canvas = this.host.canvas()

    // Laid out as a thumbnail is (its display rules), at full size, out of sight.
    const box = doc.createElement('div')
    box.className = 'blitz-thumb-canvas'
    box.setAttribute('aria-hidden', 'true')
    box.inert = true
    box.style.cssText = `position: fixed; left: -${canvas.width * 2}px; top: 0; width: ${canvas.width}px; height: ${canvas.height}px; --blitz-thumb-scale: 1`
    const copy = section.cloneNode(true) as HTMLElement
    showStep(copy, data, data.steps)
    for (const el of [copy, ...copy.querySelectorAll('[id]')]) el.removeAttribute('id')
    box.append(copy)
    doc.body.append(box)

    const instances: RenderInstance[] = []
    const drawn: Array<[string, HTMLElement]> = []
    const waits = todo.flatMap((block) => {
      const el = copy.querySelector<HTMLElement>(`[data-blitz-block="${CSS.escape(block.id)}"]`)
      if (!el || el.closest('[data-blitz-hidden]')) return []
      el.replaceChildren()
      drawn.push([block.id, el])
      return [mountReady(el, block, i, () => this.host.mount(el, block, data.steps), instances)]
    })
    try {
      await settle(box, waits)
      // A block that failed shows its error in the deck; the thumbnail keeps its placeholder.
      for (const [id, el] of drawn) if (!this.has(id) && !el.querySelector('.blitz-block-error')) this.keep(id, el)
    } finally {
      instances.forEach((x) => x.destroy())
      box.remove()
    }
  }
}
