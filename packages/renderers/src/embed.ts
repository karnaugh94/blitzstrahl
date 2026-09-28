/**
 * The `embed` renderer (syntax.md §8; docs/renderers/embed.md): a live web
 * page in an iframe, or its `fallback` image when there's no network.
 *
 * Many sites refuse to be framed (`X-Frame-Options`, CSP `frame-ancestors`).
 * A browser gives the page no way to tell, so `blitzstrahl check` asks each
 * site before the talk instead (CLAUDE.md: catch it, don't engineer around it).
 */
import { fill, strings } from '@blitzstrahl/core/i18n'
import { keyProblem, type KeyTable, type Schema } from '@blitzstrahl/core/schema'
import type { RenderCtx, RenderInstance, Renderer } from '@blitzstrahl/runtime'

export interface EmbedSpec {
  /** An `http(s)://` URL. */
  src: string
  /** Image shown instead of the page when offline: a `./path` or a URL. */
  fallback?: string
  /** Scale the page: `0.75` shows it at 75%, as if the frame were a third wider. */
  zoom?: number
  /** Accessible name of the frame. Default: the site's host. */
  title?: string
}

const URL_PATTERN = '^https?://[^/\\s]+'

/** Every key an embed takes (docs/renderers/embed.md), and what each may hold (schema.ts). */
export const EMBED_SCHEMA: KeyTable = {
  src: { schema: { type: 'string', pattern: URL_PATTERN }, message: 'must be an http:// or https:// URL' },
  fallback: { schema: { type: 'string' }, message: 'must be an image path or URL' },
  zoom: { schema: { type: 'number', minimum: 0.1, maximum: 4 }, message: 'must be a number between 0.1 and 4' },
  title: { schema: { type: 'string' }, message: 'must be text' },
}

/** What `validate` checks across keys, as JSON Schema. The body may also be just the URL. */
export const EMBED_RULES: Schema = { required: ['src'] }
export const EMBED_SHORT: Schema = { type: 'string', pattern: URL_PATTERN }

export function validate(spec: unknown): EmbedSpec {
  if (typeof spec === 'string') spec = { src: spec }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('the block must be a YAML mapping with `src`')
  const s = spec as Record<string, unknown>
  for (const k of Object.keys(s)) if (!Object.hasOwn(EMBED_SCHEMA, k)) throw new Error(`unknown key \`${k}\``)
  if (s.src === undefined) throw new Error('`src` is required: the page to show, e.g. https://example.com')
  for (const [k, v] of Object.entries(s)) {
    const problem = keyProblem(EMBED_SCHEMA, k, v)
    if (problem) throw new Error(problem)
  }
  return s as unknown as EmbedSpec
}

/** Permissions a presented page commonly needs (video, fullscreen). */
const ALLOW = 'fullscreen; autoplay; encrypted-media; picture-in-picture; clipboard-write'

function fallbackUrl(ref: string, ctx: RenderCtx): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(ref) ? ref : ctx.assetUrl(ref)
}

const embed: Renderer = {
  mount(el: HTMLElement, raw: unknown, ctx: RenderCtx): RenderInstance {
    const spec = validate(raw)
    const doc = el.ownerDocument
    const host = new URL(spec.src).host
    // Notices are for the audience, so in the deck's (or the block's) language.
    const words = strings(el.closest('[lang]')?.getAttribute('lang') || ctx.lang).deck
    const box = doc.createElement('div')
    box.className = 'blitz-embed'
    // PDF export prints this if the page doesn't load.
    if (spec.fallback) box.dataset.fallback = fallbackUrl(spec.fallback, ctx)
    el.append(box)
    const done = (ready: Promise<void>): RenderInstance => ({ update() {}, resize() {}, destroy: () => box.remove(), ready })

    if (doc.defaultView?.navigator.onLine === false) {
      if (spec.fallback) {
        const img = doc.createElement('img')
        img.className = 'blitz-embed-fallback'
        img.src = fallbackUrl(spec.fallback, ctx)
        img.alt = spec.title ?? fill(words.offlineCopy, { host })
        box.append(img)
        return done(img.decode().catch(() => {}))
      }
      const note = doc.createElement('p')
      note.className = 'blitz-embed-offline'
      note.textContent = fill(words.needsNetwork, { host })
      box.append(note)
      return done(Promise.resolve())
    }

    const frame = doc.createElement('iframe')
    frame.src = spec.src
    frame.title = spec.title ?? host
    frame.allow = ALLOW
    frame.referrerPolicy = 'strict-origin-when-cross-origin'
    const zoom = spec.zoom ?? 1
    if (zoom !== 1) {
      frame.style.width = `${100 / zoom}%`
      frame.style.height = `${100 / zoom}%`
      frame.style.transform = `scale(${zoom})`
      frame.style.transformOrigin = '0 0'
    }
    box.dataset.loading = host
    const loaded = new Promise<void>((resolve) =>
      frame.addEventListener(
        'load',
        () => {
          delete box.dataset.loading
          resolve()
        },
        { once: true },
      ),
    )
    box.append(frame)
    return done(loaded)
  },
}

export default embed
