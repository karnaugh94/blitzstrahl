import { slug } from 'github-slugger'
import type { Nodes, Root, RootContent } from 'mdast'
import { attachAttributes } from './attach.js'
import { assetKind, isImageBackground, isLocalRef, normalizeRelative, pageAsset } from './assets.js'
import { cssRefs } from './html-refs.js'
import { Diagnostics } from './diagnostics.js'
import { IR_VERSION, type Deck, type Diagnostic, type Slide, type SlideAttrs, type SourceSpan, type TransitionName } from './ir.js'
import { SLIDE_KEYS, layoutName, mergeTransition, milliseconds, resolveDeckMeta, scalarString, transitionName } from './meta.js'
import { resolveSlide, type DeckContext } from './resolve.js'
import { keyProblem, SLIDE_SCHEMA } from './schema.js'
import { keySpan, splitSlides } from './split.js'
import { parseMarkdown } from './syntax/index.js'
import { EFFECTS, RENDERERS, type Extensions } from './vocab.js'

/** Slide keys that hold plain text: their type is checked with the frontmatter. */
const TEXT_KEYS: readonly string[] = ['id', 'background', 'class', 'style']

export interface ParseOptions {
  /** Path of the markdown file, used in diagnostics and `Deck.source`. */
  file?: string
  /** Renderers, effects and frontmatter keys added by plugins. */
  extensions?: Extensions
}

export interface ParseResult {
  deck: Deck
  diagnostics: Diagnostic[]
  /** Where each deck frontmatter key is written, e.g. `plugins`, for diagnostics about its value. */
  keySpans: Record<string, SourceSpan>
}

/** Markdown → Deck IR. Pure: no I/O, never throws on bad input. */
export function parseDeck(source: string, options: ParseOptions = {}): ParseResult {
  const file = options.file ?? 'deck.md'
  const text = source.replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  const diags = new Diagnostics(file)

  const root = parseMarkdown(text)
  dropComments(root)
  checkContainers(root, lines, diags)

  const split = splitSlides(root, lines, diags)
  const ext = options.extensions ?? {}
  const meta = resolveDeckMeta(split.deckFrontmatter, diags, ext.keys)
  const ctx: DeckContext = {
    diags,
    ids: new Set(),
    assets: [],
    blockCount: 0,
    renderers: { ...RENDERERS, ...ext.renderers },
    effects: { ...EFFECTS, ...ext.effects },
    lang: meta.lang,
  }
  const slideIds = new Set<string>()

  // A background names an image, or is CSS whose url()s are files the page loads.
  const backgroundAssets = (value: string, span: SourceSpan) => {
    if (isImageBackground(value) && isLocalRef(value)) {
      ctx.assets.push({ ref: value, path: normalizeRelative(value), kind: assetKind(value), span })
      return
    }
    for (const url of cssRefs(value)) {
      const a = pageAsset(url, span)
      if (a) ctx.assets.push(a)
    }
  }
  // The deck's (syntax.md §3.6): each value once, however many slides show it.
  const deckBg = meta.background
  if (deckBg !== undefined) {
    const span = keySpan(split.deckFrontmatter, 'background', { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } })
    for (const value of new Set(typeof deckBg === 'string' ? [deckBg] : Object.values(deckBg))) backgroundAssets(value, span)
  }
  const deckBackground = (layout: string): string | undefined =>
    typeof deckBg === 'string' || deckBg === undefined ? deckBg : (deckBg[layout] ?? deckBg.default)

  const slides = split.slides.map((raw, index): Slide => {
    attachAttributes(raw.nodes, lines, diags)
    const fm = raw.frontmatter?.data ?? {}
    const fmSpan = (key: string) => keySpan(raw.frontmatter, key, raw.span)
    const r = resolveSlide(raw.nodes, index, ctx, (shorthand) => {
      const layout = 'layout' in fm ? { value: fm.layout, span: fmSpan('layout') } : shorthand.layout
      return layout ? layoutName(layout.value, diags, layout.span) : index === 0 ? 'title' : 'default'
    })

    const attrs: SlideAttrs = { class: [], extra: {} }
    for (const [key, value] of Object.entries(fm)) {
      if (!SLIDE_KEYS.has(key)) {
        diags.warn('frontmatter/unknown-key', `unknown slide frontmatter key \`${key}\``, fmSpan(key))
        attrs.extra[key] = value
      } else if (TEXT_KEYS.includes(key)) {
        // Layouts, transitions and durations are checked where they're read.
        const problem = keyProblem(SLIDE_SCHEMA, key, value)
        if (problem) diags.warn('frontmatter/type', problem, fmSpan(key))
      }
    }
    for (const [key, { span }] of Object.entries(r.shorthand)) {
      if (key in fm) diags.warn('slide/key-twice', `\`${key}\` is set in frontmatter and on the heading; frontmatter wins`, span)
    }
    const setting = (key: string): { value: unknown; span: SourceSpan } | undefined =>
      key in fm ? { value: fm[key], span: fmSpan(key) } : r.shorthand[key]

    const tName = setting('transition')
    const tDur = setting('transition-dur')
    const bg = setting('background')

    let name: TransitionName | undefined
    if (tName) name = transitionName(tName.value, diags, tName.span)
    const dur = tDur ? milliseconds(tDur.value, 'transition-dur', diags, tDur.span) : undefined

    if (bg) {
      attrs.background = String(bg.value)
      backgroundAssets(attrs.background, bg.span)
    } else {
      const inherited = deckBackground(r.layout)
      if (inherited !== undefined) attrs.background = inherited
    }
    if (fm.class !== undefined) attrs.class = String(fm.class).split(/\s+/).filter(Boolean)
    if (fm.style !== undefined) {
      attrs.style = String(fm.style)
      for (const url of cssRefs(attrs.style)) {
        const a = pageAsset(url, fmSpan('style'))
        if (a) ctx.assets.push(a)
      }
    }

    const explicit = scalarString(fm.id) || r.headingId
    let id = explicit || (r.title && slug(r.title)) || `slide-${index + 1}`
    if (slideIds.has(id)) {
      let n = 2
      while (slideIds.has(`${id}-${n}`)) n++
      // Repeating a heading is normal (auto-animate lives on it); only an id the author chose is worth a warning.
      if (explicit) diags.warn('slide/duplicate-id', `slide id \`${id}\` is already used; this slide gets \`${id}-${n}\``, raw.span)
      id = `${id}-${n}`
    }
    slideIds.add(id)

    const slide: Slide = {
      id,
      index,
      layout: r.layout,
      transition: mergeTransition(meta.transition, name, dur),
      attrs,
      steps: r.steps,
      notes: r.notes,
      content: r.content,
      anims: r.anims,
      blocks: r.blocks,
      span: raw.span,
    }
    if (r.title) slide.title = r.title
    return slide
  })

  const deck: Deck = {
    irVersion: IR_VERSION,
    source: file,
    meta: { ...meta, title: meta.title ?? slides[0]?.title ?? 'Untitled' },
    slides,
    assets: ctx.assets,
  }
  diags.list.sort((a, b) => a.span.start.line - b.span.start.line || a.span.start.column - b.span.start.column)
  return { deck, diagnostics: diags.list, keySpans: split.deckFrontmatter?.keys ?? {} }
}

/** HTML comments are dropped from the output (syntax.md §1). */
function dropComments(node: Root | Nodes) {
  if (!('children' in node)) return
  const kids = node.children as RootContent[]
  for (let k = kids.length - 1; k >= 0; k--) {
    const c = kids[k]!
    if (c.type === 'html' && /^\s*<!--[\s\S]*-->\s*$/.test(c.value)) kids.splice(k, 1)
    else dropComments(c)
  }
}

function checkContainers(node: Root | Nodes, lines: string[], diags: Diagnostics) {
  if (!('children' in node)) return
  for (const c of node.children as RootContent[]) {
    if (c.type === 'blitzContainer' && !c.closed) {
      diags.warn('container/unclosed', `container${c.name ? ` \`${c.name}\`` : ''} is never closed; it ends at the end of its slide`, {
        start: c.position!.start,
        end: c.position!.start,
      })
    }
    if (c.type === 'paragraph' && /^ {0,3}:{3,}[ \t]*$/.test(lines[c.position!.start.line - 1] ?? '')) {
      diags.warn('container/stray-fence', 'closing `:::` with no open container', c)
    }
    checkContainers(c, lines, diags)
  }
}
