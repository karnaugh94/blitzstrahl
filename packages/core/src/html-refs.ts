/**
 * The files raw HTML and CSS refer to (syntax.md §1: raw HTML passes
 * through), so builds can ship them and point the page at them.
 *
 * Pure string work, never a parse into a tree. Raw HTML in a deck is often
 * a fragment (a `<div>` opened in one block and closed in another), and a
 * parser would "repair" it. Only three things are read and rewritten: the
 * URL attributes of start tags, `style` attributes, and the insides of
 * `<style>` elements. Everything else passes through byte for byte.
 */

/** Attributes whose value is a URL, or for `srcset` a list of them. */
const URL_ATTRS = new Set(['src', 'href', 'poster', 'data', 'srcset'])

export interface HtmlRef {
  /** The URL as written, with character references decoded. */
  url: string
  /** Lower-case tag name, or `style` for a `url()` in CSS. */
  tag: string
  /** The attribute, or `url` for a `url()` in CSS. */
  attr: string
}

/** A new URL for one that was written, or undefined to leave it as it is. */
export type MapUrl = (url: string, tag: string, attr: string) => string | undefined

/** Every URL in `html`: start tags' URL attributes, and `url()`s in `style` attributes and `<style>`. */
export function htmlRefs(html: string): HtmlRef[] {
  const refs: HtmlRef[] = []
  rewriteHtml(html, (url, tag, attr) => {
    refs.push({ url, tag, attr })
    return undefined
  })
  return refs
}

/**
 * `html` with each URL `map` returns a value for replaced. An `<a>` or
 * `<area>` whose `href` becomes a `data:` URL gets a `download` attribute,
 * since browsers won't navigate to one.
 */
export function rewriteHtml(html: string, map: MapUrl): string {
  let out = ''
  let i = 0
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt < 0) {
      out += html.slice(i)
      break
    }
    out += html.slice(i, lt)
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      const stop = end < 0 ? html.length : end + 3
      out += html.slice(lt, stop)
      i = stop
      continue
    }
    const name = /^<([A-Za-z][A-Za-z0-9-]*)/.exec(html.slice(lt, lt + 80))
    if (!name) {
      out += '<'
      i = lt + 1
      continue
    }
    const tag = name[1]!.toLowerCase()
    const t = startTag(html, lt + name[0].length, tag, map)
    out += name[0] + t.text
    i = t.end
    // The insides of <style> are CSS; the insides of <script> are left alone.
    if ((tag === 'style' || tag === 'script') && !t.selfClosing) {
      const close = html.toLowerCase().indexOf(`</${tag}`, i)
      const stop = close < 0 ? html.length : close
      const inner = html.slice(i, stop)
      out += tag === 'style' ? rewriteCss(inner, (url) => map(url, 'style', 'url')) : inner
      i = stop
    }
  }
  return out
}

/** A start tag's attributes, from just after its name to just after its `>`. */
function startTag(html: string, from: number, tag: string, map: MapUrl): { text: string; end: number; selfClosing: boolean } {
  let text = ''
  let i = from
  let download = false
  let dataHref = ''
  const space = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f'
  while (i < html.length) {
    const c = html[i]!
    if (c === '>') {
      const selfClosing = /\/\s*$/.test(text)
      if (dataHref && !download) text = text.replace(/(\/?\s*)$/, ` download="${attrEscape(dataHref)}"$1`)
      return { text: text + '>', end: i + 1, selfClosing }
    }
    if (space(c) || c === '/') {
      text += c
      i++
      continue
    }
    // An attribute: a name, then maybe `=` and a value.
    const at = i
    while (i < html.length && !space(html[i]) && html[i] !== '=' && html[i] !== '>' && !(html[i] === '/' && html[i + 1] === '>')) i++
    const attr = html.slice(at, i).toLowerCase()
    let j = i
    while (space(html[j])) j++
    if (html[j] !== '=') {
      if (attr === 'download') download = true
      text += html.slice(at, i)
      continue
    }
    j++
    while (space(html[j])) j++
    const q = html[j]
    let raw: string
    let end: number
    if (q === '"' || q === "'") {
      const close = html.indexOf(q, j + 1)
      end = close < 0 ? html.length : close + 1
      raw = html.slice(j + 1, close < 0 ? html.length : close)
    } else {
      end = j
      while (end < html.length && !space(html[end]) && html[end] !== '>') end++
      raw = html.slice(j, end)
    }
    const original = html.slice(at, end)
    if (attr === 'download') download = true
    const value = decode(raw)
    let next: string | undefined
    if (attr === 'style') {
      const css = rewriteCss(value, (url) => map(url, tag, 'style'))
      next = css === value ? undefined : css
    } else if (attr === 'srcset') {
      const set = rewriteSrcset(value, (url) => map(url, tag, 'srcset'))
      next = set === value ? undefined : set
    } else if (URL_ATTRS.has(attr)) {
      next = map(value, tag, attr)
      if (next !== undefined && attr === 'href' && (tag === 'a' || tag === 'area') && next.startsWith('data:')) dataHref = fileName(value)
    }
    text += next === undefined ? original : `${html.slice(at, i)}="${attrEscape(next)}"`
    i = end
  }
  return { text, end: html.length, selfClosing: false }
}

function rewriteSrcset(value: string, map: (url: string) => string | undefined): string {
  return value
    .split(',')
    .map((candidate) => {
      const m = /^(\s*)(\S+)(.*)$/s.exec(candidate)
      if (!m) return candidate
      const next = map(m[2]!)
      return next === undefined ? candidate : `${m[1]}${next}${m[3]}`
    })
    .join(',')
}

const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s]+))\s*\)/g

/** Every `url()` in a piece of CSS. */
export function cssRefs(css: string): string[] {
  return [...css.matchAll(CSS_URL)].map((m) => m[1] ?? m[2] ?? m[3]!)
}

/** `css` with each `url()` that `map` returns a value for replaced. */
export function rewriteCss(css: string, map: (url: string) => string | undefined): string {
  return css.replace(CSS_URL, (whole, dq: string | undefined, sq: string | undefined, bare: string | undefined) => {
    const next = map(dq ?? sq ?? bare!)
    return next === undefined ? whole : `url("${next.replace(/["\\\n]/g, (c) => (c === '\n' ? '\\a ' : `\\${c}`))}")`
  })
}

/** The last path segment of a URL, for a download's file name. */
function fileName(url: string): string {
  const path = url.replace(/[?#].*$/, '')
  return path.slice(path.lastIndexOf('/') + 1) || 'download'
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** The character references a URL in an attribute is likely to hold. */
function decode(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return NAMED[ref.toLowerCase()] ?? whole
  })
}

function attrEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}
