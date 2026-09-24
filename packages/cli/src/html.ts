/**
 * Deck IR → the HTML page. Slide content is rendered here, at build time; the
 * runtime only hydrates it.
 */
import type { Element, ElementContent, Root } from 'hast'
import { toHtml } from 'hast-util-to-html'
import { isImageBackground, toPayload, type Deck, type Diagnostic, type HastNode } from '@blitzstrahl/core'
import { runtimeCss } from '@blitzstrahl/runtime/css'
import { themes, type Theme } from '@blitzstrahl/themes'

/** Maps a deck-relative asset path to the URL the page should use. */
export type AssetUrl = (path: string) => string

export function resolveTheme(name: string): { theme: Theme; warning?: string } {
  const theme = themes[name]
  if (theme) return { theme }
  return { theme: themes.aurora!, warning: `unknown theme \`${name}\`; using aurora (third-party themes arrive in M5)` }
}

/** Rewrites local image `src`s to the URLs the page serves them from. */
function imageRewriter(deck: Deck, assetUrl: AssetUrl) {
  const byRef = new Map(deck.assets.map((a) => [a.ref, a.path]))
  const rewrite = (nodes: HastNode[]): ElementContent[] =>
    nodes.map((n) => {
      if (n.type !== 'element') return n
      const el: Element = { ...n, children: rewrite(n.children) }
      const src = el.properties.src
      if (el.tagName === 'img' && typeof src === 'string' && byRef.has(src)) {
        el.properties = { ...el.properties, src: assetUrl(byRef.get(src)!) }
      }
      return el
    })
  return { byRef, rewrite }
}

/** The `<section>`s, as HTML. Also what dev HMR swaps in. */
export function renderStage(deck: Deck, assetUrl: AssetUrl): string {
  const { byRef, rewrite } = imageRewriter(deck, assetUrl)

  const sections: Element[] = deck.slides.map((slide) => {
    const style: string[] = []
    const bg = slide.attrs.background
    if (bg !== undefined) {
      if (byRef.has(bg)) style.push(`background-image: url("${assetUrl(byRef.get(bg)!)}")`)
      else if (isImageBackground(bg)) style.push(`background-image: url("${bg}")`)
      else style.push(`background: ${bg}`)
    }
    if (slide.attrs.style) style.push(slide.attrs.style)
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
      children: rewrite(slide.content),
    }
  })
  return toHtml({ type: 'root', children: sections } as Root, { allowDangerousHtml: true })
}

/**
 * Presenter notes (syntax.md §7), one `<div data-for="<slide id>">` per slide
 * that has any: the inner HTML of the page's `<template id="blitz-notes">`.
 * A template's content is inert, so the audience never sees it rendered.
 */
export function renderNotes(deck: Deck, assetUrl: AssetUrl): string {
  const { rewrite } = imageRewriter(deck, assetUrl)
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
}

/** A deck with external chunks can't run from a file (module scripts need HTTP); say so. */
const FILE_WARNING = `<script>
if (location.protocol === 'file:') document.addEventListener('DOMContentLoaded', function () {
  var p = document.createElement('p')
  p.style.cssText = 'position:fixed;inset:auto 16px 16px;margin:0;padding:12px 16px;font:15px/1.4 system-ui,sans-serif;background:#fff;color:#111;border-radius:8px;z-index:9'
  p.textContent = 'This deck was built for a web server and can\\u2019t run from a file. Serve the folder over HTTP (for example: npx serve dist), build it with --standalone, or use blitzstrahl dev.'
  document.body.appendChild(p)
})
</script>
`

export function renderPage(o: PageOptions): string {
  const payload = toPayload(o.deck, o.inline, o.assetUrl)
  const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c')
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  return `<!doctype html>
<html lang="${esc(o.deck.meta.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="blitzstrahl">
<title>${esc(o.deck.meta.title)}</title>
<style>
${runtimeCss}
${o.theme.stylesheet}
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
${'src' in o.entry ? FILE_WARNING : ''}<script type="application/json" id="blitz-payload">${json(payload)}</script>
${o.diagnostics ? `<script type="application/json" id="blitz-diagnostics">${json(o.diagnostics)}</script>\n` : ''}${
    'src' in o.entry ? `<script type="module" src="${esc(o.entry.src)}"></script>` : `<script type="module">\n${o.entry.code}\n</script>`
  }
</body>
</html>
`
}
