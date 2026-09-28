/**
 * Deck IR → the HTML page. Slide content is rendered here, at build time; the
 * runtime only hydrates it.
 */
import { readFileSync } from 'node:fs'
import type { Element, ElementContent, Root } from 'hast'
import { toHtml } from 'hast-util-to-html'
import { isImageBackground, rewriteCss, rewriteHtml, toPayload, type Deck, type Diagnostic, type HastNode, type PayloadPlugins } from '@blitzstrahl/core'
import { strings } from '@blitzstrahl/core/i18n'
import { runtimeCss } from '@blitzstrahl/runtime/css'
import type { Theme } from '@blitzstrahl/themes'

const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version

/**
 * Every page carries blitzstrahl's runtime, so it carries the runtime's
 * licence notice (EUPL-1.2, decisions.md). The deck's own content is the
 * author's.
 */
export const LICENCE_NOTICE = `<!--
  Made with blitzstrahl ${VERSION}. The slide runtime in this page is
  (c) the blitzstrahl authors, licensed under the EUPL-1.2
  (https://interoperable-europe.ec.europa.eu/collection/eupl/eupl-text-eupl-12).
  Its source code is in the npm package blitzstrahl@${VERSION}.
  The deck's content belongs to its author.
-->`

/** Maps a deck-relative asset path to the URL the page should use. */
export type AssetUrl = (path: string) => string

/** The last path segment of a URL: a download's file name. */
function fileName(url: string): string {
  const path = url.replace(/[?#].*$/, '')
  return path.slice(path.lastIndexOf('/') + 1) || 'download'
}

/**
 * Rewrites every local URL the deck's HTML uses (images, links, raw HTML,
 * `style` values) to the URL the page serves that file from.
 */
function refRewriter(deck: Deck, assetUrl: AssetUrl) {
  const byRef = new Map(deck.assets.map((a) => [a.ref, a.path]))
  const url = (ref: string): string | undefined => {
    const path = byRef.get(ref)
    return path === undefined ? undefined : assetUrl(path)
  }
  const css = (value: string) => rewriteCss(value, url)
  const rewrite = (nodes: HastNode[]): ElementContent[] =>
    nodes.map((n): ElementContent => {
      // Raw HTML (syntax.md §1) stays raw: only its URLs change.
      const raw = n as unknown as { type: string; value: string }
      if (raw.type === 'raw') return { ...raw, value: rewriteHtml(raw.value, url) } as unknown as ElementContent
      if (n.type !== 'element') return n
      const el: Element = { ...n, children: rewrite(n.children) }
      const p = el.properties
      const next: Element['properties'] = {}
      if (el.tagName === 'img' && typeof p.src === 'string' && url(p.src) !== undefined) next.src = url(p.src)!
      if (el.tagName === 'a' && typeof p.href === 'string') {
        const to = url(p.href)
        if (to !== undefined) {
          next.href = to
          // A standalone file's links are data: URLs, which browsers download but won't open.
          if (to.startsWith('data:') && p.download === undefined) next.download = fileName(p.href)
        }
      }
      if (typeof p.style === 'string' && css(p.style) !== p.style) next.style = css(p.style)
      if (Object.keys(next).length) el.properties = { ...p, ...next }
      return el
    })
  return { byRef, css, rewrite }
}

/** The `<section>`s, as HTML. Also what dev HMR swaps in. */
export function renderStage(deck: Deck, assetUrl: AssetUrl): string {
  const { byRef, css, rewrite } = refRewriter(deck, assetUrl)
  // Each background image is named once, as a custom property, however many
  // slides use it: a standalone file carries it once, not once per slide.
  const backgrounds = new Map<string, string>()
  const background = (path: string) => {
    let name = backgrounds.get(path)
    if (!name) backgrounds.set(path, (name = `--blitz-bg-${backgrounds.size + 1}`))
    return `var(${name})`
  }

  // The deck's chrome (syntax.md §3.6): the same items on every slide, but its number.
  const m = deck.meta
  const item = (name: string, children: ElementContent[]): Element => ({ type: 'element', tagName: 'div', properties: { dataChrome: name }, children })
  const words = (value: string): ElementContent[] => [{ type: 'text', value }]
  const footer = m.footer ? rewrite(m.footer) : undefined
  const logo = m.logo === undefined ? undefined : byRef.has(m.logo) ? assetUrl(byRef.get(m.logo)!) : m.logo
  const chrome = (index: number): Element => {
    const items: Element[] = []
    if (footer) items.push(item('footer', footer))
    if (m.slideNumbers) {
      const n = m.slideNumbers.replaceAll('{n}', String(index + 1)).replaceAll('{total}', String(deck.slides.length))
      items.push(item('number', words(n)))
    }
    if (logo !== undefined) items.push({ type: 'element', tagName: 'img', properties: { dataChrome: 'logo', src: logo, alt: '' }, children: [] })
    // For themes to place; hidden unless one does.
    items.push(item('title', words(m.title)))
    if (m.author) items.push(item('author', words(m.author)))
    if (m.date) items.push(item('date', words(m.date)))
    return { type: 'element', tagName: 'div', properties: { className: ['blitz-chrome'] }, children: items }
  }

  const sections: Element[] = deck.slides.map((slide) => {
    const style: string[] = []
    const bg = slide.attrs.background
    if (bg !== undefined) {
      // `none` clears the deck's and the theme's images, and keeps the `bg` colour.
      if (bg.trim() === 'none') style.push('background-image: none')
      else if (byRef.has(bg)) style.push(`background-image: ${background(byRef.get(bg)!)}`)
      else if (isImageBackground(bg)) style.push(`background-image: url("${bg}")`)
      else style.push(`background: ${css(bg)}`)
    }
    if (slide.attrs.style) style.push(css(slide.attrs.style))
    return {
      type: 'element',
      tagName: 'section',
      properties: {
        className: ['blitz-slide', ...slide.attrs.class],
        dataBlitzSlide: slide.id,
        dataLayout: slide.layout,
        ariaRoledescription: 'slide',
        ariaLabel: slide.title ?? `Slide ${slide.index + 1}`,
        ariaHidden: 'true',
        ...(style.length ? { style: style.join('; ') } : {}),
      },
      children: slide.attrs.chrome === false ? rewrite(slide.content) : [...rewrite(slide.content), chrome(slide.index)],
    }
  })
  const vars = [...backgrounds].map(([path, name]) => `${name}: url("${assetUrl(path)}");`)
  const shared = vars.length ? `<style data-blitz-backgrounds>:root { ${vars.join(' ')} }</style>\n` : ''
  return shared + toHtml({ type: 'root', children: sections } as Root, { allowDangerousHtml: true })
}

/**
 * Presenter notes (syntax.md §7), one `<div data-for="<slide id>">` per slide
 * that has any: the inner HTML of the page's `<template id="blitz-notes">`.
 * A template's content is inert, so the audience never sees it rendered.
 */
export function renderNotes(deck: Deck, assetUrl: AssetUrl): string {
  const { rewrite } = refRewriter(deck, assetUrl)
  const divs: Element[] = deck.slides
    .filter((s) => s.notes.length)
    .map((s) => ({ type: 'element', tagName: 'div', properties: { dataFor: s.id }, children: rewrite(s.notes) }))
  return toHtml({ type: 'root', children: divs } as Root, { allowDangerousHtml: true })
}

export interface PageOptions {
  deck: Deck
  inline: Record<string, string>
  assetUrl: AssetUrl
  theme: Theme
  /** The entry module: a URL (`<script type="module" src>`), or its code, inlined (standalone). */
  entry: { src: string } | { code: string }
  /** Dev only: shown in the browser console. */
  diagnostics?: Diagnostic[]
  /** More CSS after the theme's: theme fonts, plugin effects, KaTeX's when the deck has math. */
  css?: string
  /** What plugins add to the payload. */
  plugins?: PayloadPlugins
}

/** A deck with external chunks can't run from a file (module scripts need HTTP); say so, in the deck's language. */
const fileWarning = (lang: string) => `<script>
if (location.protocol === 'file:') document.addEventListener('DOMContentLoaded', function () {
  var p = document.createElement('p')
  p.style.cssText = 'position:fixed;inset:auto 16px 16px;margin:0;padding:12px 16px;font:15px/1.4 system-ui,sans-serif;background:#fff;color:#111;border-radius:8px;z-index:9'
  p.textContent = ${JSON.stringify(strings(lang).deck.needsServer).replace(/</g, '\\u003c')}
  document.body.appendChild(p)
})
</script>
`

export function renderPage(o: PageOptions): string {
  const payload = toPayload(o.deck, o.inline, o.assetUrl, o.plugins)
  const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c')
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  return `<!doctype html>
${LICENCE_NOTICE}
<html lang="${esc(o.deck.meta.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="blitzstrahl">
${o.deck.meta.author ? `<meta name="author" content="${esc(o.deck.meta.author)}">\n` : ''}<title>${esc(o.deck.meta.title)}</title>
<style>
${runtimeCss}
</style>
<style data-blitz-theme>
${o.theme.stylesheet}
</style>
<style>
${o.css ?? ''}
</style>
</head>
<body>
<div class="blitz-viewport">
<main class="blitz-stage" aria-roledescription="slide deck" aria-label="${esc(o.deck.meta.title)}">
${renderStage(o.deck, o.assetUrl)}
</main>
<div class="blitz-sr" aria-live="polite"></div>
</div>
<template id="blitz-notes">${renderNotes(o.deck, o.assetUrl)}</template>
${'src' in o.entry ? fileWarning(o.deck.meta.lang) : ''}<script type="application/json" id="blitz-payload">${json(payload)}</script>
${o.diagnostics ? `<script type="application/json" id="blitz-diagnostics">${json(o.diagnostics)}</script>\n` : ''}${
    'src' in o.entry ? `<script type="module" src="${esc(o.entry.src)}"></script>` : `<script type="module">\n${o.entry.code}\n</script>`
  }
</body>
</html>
`
}
