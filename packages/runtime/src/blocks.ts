/**
 * Loading renderers and giving them their context, for every page that
 * draws render blocks: the deck, the presenter view (printing) and
 * document mode.
 */
import type { DeckPayload } from '@blitzstrahl/core'
import { dataNumerals, readNumber } from '@blitzstrahl/core/numbers'
import type { BlockData, RenderCtx, RenderInstance, Renderer, RendererLoader } from './renderer.js'

export class Blocks {
  constructor(
    private readonly doc: Document,
    private readonly payload: () => DeckPayload,
    private readonly loaders: Record<string, RendererLoader> = {},
  ) {}

  async renderer(name: string): Promise<Renderer> {
    const loader = this.loaders[name]
    if (!loader) throw new Error(`No \`${name}\` renderer in this build.`)
    const mod = await loader()
    return 'default' in mod ? mod.default : mod
  }

  ctx(el: HTMLElement, block: BlockData, still: boolean): RenderCtx {
    const payload = this.payload()
    const win = this.doc.defaultView!
    return {
      block,
      token: (name) => win.getComputedStyle(el).getPropertyValue(name).trim(),
      reducedMotion: still,
      loadAsset: (path) => this.loadAsset(path),
      assetUrl: (path) => new URL(payload.urls[path] ?? path, this.doc.baseURI).href,
      meta: payload.meta ?? {},
      lang: payload.lang,
      number: (text, thousands) => readNumber(text, dataNumerals(thousands ?? payload.thousands)),
    }
  }

  /** Mount a block without motion, showing `step` (print, document mode). */
  async mountStill(el: HTMLElement, block: BlockData, step: number): Promise<RenderInstance> {
    const instance = await (await this.renderer(block.renderer)).mount(el, block.spec, this.ctx(el, block, true))
    instance.update(step)
    return instance
  }

  async loadAsset(path: string): Promise<string> {
    const inline = this.payload().inline[path]
    if (inline !== undefined) return inline
    const res = await fetch(new URL(path, this.doc.baseURI))
    if (!res.ok) throw new Error(`could not load \`${path}\` (${res.status})`)
    return res.text()
  }
}
