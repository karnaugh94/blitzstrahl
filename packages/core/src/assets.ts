import type { AssetKind, AssetRef, SourceSpan } from './ir.js'

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/

/** A URL that points at a local file next to the deck (images, backgrounds). */
export function isLocalRef(url: string): boolean {
  return url !== '' && !SCHEME.test(url) && !url.startsWith('/') && !url.startsWith('#')
}

/** Renderer spec strings are paths only when explicitly relative (syntax.md §8). */
export function isExplicitRelative(s: string): boolean {
  return s.startsWith('./') || s.startsWith('../')
}

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'bmp', 'ico'])
const DATA = new Set(['csv', 'tsv', 'json', 'geojson', 'topojson', 'yaml', 'yml', 'txt'])
const FONT = new Set(['woff', 'woff2', 'ttf', 'otf'])

export function assetKind(path: string): AssetKind {
  const ext = /\.([A-Za-z0-9]+)(?:[?#].*)?$/.exec(path)?.[1]?.toLowerCase() ?? ''
  if (IMAGE.has(ext)) return 'image'
  if (DATA.has(ext)) return 'data'
  if (FONT.has(ext)) return 'font'
  return 'other'
}

/** POSIX-normalise a relative path: `./a/../b.png` → `b.png`, `../x` stays. */
export function normalizeRelative(path: string): string {
  const clean = path.replace(/[?#].*$/, '')
  const out: string[] = []
  for (const seg of clean.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..' && out.length && out[out.length - 1] !== '..') out.pop()
    else out.push(seg)
  }
  return out.join('/') || '.'
}

/**
 * A file the page itself loads or links to (an image, a link's target, a
 * video, a font in a `url()`), or undefined if `url` isn't local. Its kind
 * is never `data`: data kind means "inlined for a renderer", and a CSV the
 * page links to has to ship as a file.
 */
export function pageAsset(url: string, span: SourceSpan): AssetRef | undefined {
  if (!isLocalRef(url)) return undefined
  const kind = assetKind(url)
  return { ref: url, path: normalizeRelative(url), kind: kind === 'data' ? 'other' : kind, span }
}

/** Whether a slide `background` value names an image rather than a CSS value (§3.2). */
export function isImageBackground(value: string): boolean {
  const v = value.trim()
  if (/\s/.test(v) || v.includes('(')) return false
  return isExplicitRelative(v) || /^https?:\/\//.test(v) || assetKind(v) === 'image'
}
