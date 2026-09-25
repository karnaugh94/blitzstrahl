/**
 * auto-animate (syntax.md §9): which elements of two slides are "the same
 * element", so the transition can move each one from where it was to where
 * it is instead of cross-fading it.
 *
 * Elements pair by `key=` first; the rest pair by what they say: headings by
 * their text, paragraphs, list items, quotes, tables and code by tag and
 * text, images by source. Identical candidates pair in document order.
 * Pairs never nest, so every paired element moves exactly once (a moved
 * ancestor would carry its paired descendants a second time).
 */

export interface Candidate<T> {
  el: T
  /** `key=`, if the author gave one. */
  key?: string
  /** Content signature for pairing without keys. */
  sig?: string
}

export interface MorphPair<T = HTMLElement> {
  from: T
  to: T
}

/** Pair two slides' candidates (each list in document order). */
export function pairCandidates<T>(from: Candidate<T>[], to: Candidate<T>[], contains: (a: T, b: T) => boolean): MorphPair<T>[] {
  const pairs: MorphPair<T>[] = []
  const usedFrom: T[] = []
  const usedTo: T[] = []
  const free = (el: T, used: T[]) => !used.some((u) => u === el || contains(u, el) || contains(el, u))
  const add = (a: T, b: T) => {
    pairs.push({ from: a, to: b })
    usedFrom.push(a)
    usedTo.push(b)
  }

  const byKey = new Map<string, T>()
  for (const c of to) if (c.key !== undefined && !byKey.has(c.key)) byKey.set(c.key, c.el)
  const seenKeys = new Set<string>()
  for (const c of from) {
    if (c.key === undefined || seenKeys.has(c.key)) continue
    seenKeys.add(c.key)
    const match = byKey.get(c.key)
    if (match !== undefined && free(c.el, usedFrom) && free(match, usedTo)) add(c.el, match)
  }

  for (const c of from) {
    if (c.sig === undefined || !free(c.el, usedFrom)) continue
    const match = to.find((d) => d.sig === c.sig && free(d.el, usedTo))
    if (match) add(c.el, match.el)
  }
  return pairs
}

const AUTO = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, table, pre, img'

/** The pairing signature of an element, or undefined if it doesn't pair by content. */
function signature(el: HTMLElement): string | undefined {
  const tag = el.localName
  if (tag === 'img') {
    const src = el.getAttribute('src')
    return src ? `img ${src}` : undefined
  }
  // Code blocks in the same language pair whatever they say: their tokens morph (code-morph.ts).
  if (tag === 'pre') {
    const lang = [...(el.querySelector('code')?.classList ?? [])].find((c) => c.startsWith('language-'))
    return `pre ${lang ?? ''}`
  }
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return undefined
  // Headings pair across levels: a title shrinking into a slide heading is the classic move.
  return `${/^h[1-6]$/.test(tag) ? 'h' : tag} ${text}`
}

/** A pair of code blocks: its tokens morph, rather than the block as a whole. */
export function isCode(p: MorphPair): boolean {
  return p.from.localName === 'pre' && p.to.localName === 'pre'
}

/** A slide's pairing candidates: keyed elements, then content matches, as the slide shows them. */
export function candidates(slide: HTMLElement, visible: (el: HTMLElement) => boolean): Candidate<HTMLElement>[] {
  const out: Candidate<HTMLElement>[] = []
  for (const el of slide.querySelectorAll<HTMLElement>(`[data-blitz-key], ${AUTO}`)) {
    // Inside a render block is the renderer's DOM, not the author's.
    if (el.parentElement?.closest('[data-blitz-block]') || !visible(el)) continue
    const c: Candidate<HTMLElement> = { el }
    if (el.dataset.blitzKey !== undefined) c.key = el.dataset.blitzKey
    else if (el.matches(AUTO)) {
      const sig = signature(el)
      if (sig === undefined) continue
      c.sig = sig
    }
    out.push(c)
  }
  return out
}

export function pairSlides(from: HTMLElement, to: HTMLElement, visibleTo: (el: HTMLElement) => boolean): MorphPair[] {
  const shown = (el: HTMLElement) => el.closest('[data-blitz-hidden]') === null
  return pairCandidates(candidates(from, shown), candidates(to, visibleTo), (a, b) => a.contains(b))
}

/** Where an element sits, for moving it onto another's place. Viewport pixels. */
export interface Placement {
  /** Border box. */
  box: Rect
  /** What should line up: the text itself for text, else the box. */
  anchor: Rect
  /** What should match in size: the width for media, else the font size. */
  size: number
  /** Viewport pixels per local pixel (the stage's scale). */
  k: number
}

export interface Rect {
  left: number
  top: number
  width: number
}

/** Text lines up by its glyphs, whatever its box does (a `fit-content` title vs a full-width heading). */
const TEXT = 'h1, h2, h3, h4, h5, h6, p, li:not(:has(> p, > ul, > ol))'
/**
 * Media scales with its box. Anything else scales with its font size: a
 * card that only moves (or changes width) keeps its text the same size.
 */
const MEDIA = 'img, svg, video, canvas, iframe, [data-blitz-block]'

export function place(el: HTMLElement, text = el.matches(TEXT)): Placement {
  const box = el.getBoundingClientRect()
  const k = box.width / (el.offsetWidth || box.width) || 1
  const fontSize = parseFloat(el.ownerDocument.defaultView!.getComputedStyle(el).fontSize) * k
  const size = el.matches(MEDIA) || !fontSize ? box.width : fontSize
  if (text) {
    const range = el.ownerDocument.createRange()
    range.selectNodeContents(el)
    const anchor = range.getBoundingClientRect()
    if (anchor.width) return { box, anchor, size, k }
  }
  return { box, anchor: box, size, k }
}

/** Both sides of a pair are placed the same way: as text only if both are text. */
export function textPair(p: MorphPair): boolean {
  return p.from.matches(TEXT) && p.to.matches(TEXT)
}

/**
 * FLIP keyframes that carry an element from its own place (`self`) onto
 * `other`'s (`'to'`), or from `other`'s place back into its own (`'from'`).
 * Uniform scale, about the anchor's corner, in the element's local pixels.
 */
export function flipFrames(self: Placement, other: Placement, dir: 'to' | 'from'): Keyframe[] {
  const ox = (self.anchor.left - self.box.left) / self.k
  const oy = (self.anchor.top - self.box.top) / self.k
  const tx = (other.anchor.left - self.anchor.left) / self.k
  const ty = (other.anchor.top - self.anchor.top) / self.k
  const s = other.size / self.size
  const transformOrigin = `${round(ox)}px ${round(oy)}px`
  const home = { transformOrigin, transform: 'none' }
  const away = { transformOrigin, transform: `translate(${round(tx)}px, ${round(ty)}px) scale(${round(s, 4)})` }
  return dir === 'to' ? [home, away] : [away, home]
}

function round(n: number, places = 2): number {
  const f = 10 ** places
  return Math.round(n * f) / f
}
