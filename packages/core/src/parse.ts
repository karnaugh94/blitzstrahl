import { slug } from 'github-slugger'
import type { Nodes, Root, RootContent } from 'mdast'
import { attachAttributes } from './attach.js'
import { assetKind, isImageBackground, isLocalRef, normalizeRelative } from './assets.js'
import { Diagnostics } from './diagnostics.js'
import { IR_VERSION, type Deck, type Diagnostic, type Slide, type SlideAttrs, type SourceSpan, type TransitionName } from './ir.js'
import { SLIDE_KEYS, layoutName, mergeTransition, milliseconds, resolveDeckMeta, scalarString, transitionName } from './meta.js'
import { resolveSlide, type DeckContext } from './resolve.js'
import { keySpan, splitSlides } from './split.js'
import { parseMarkdown } from './syntax/index.js'

export interface ParseOptions {
  /** Path of the markdown file, used in diagnostics and `Deck.source`. */
  file?: string
}

export interface ParseResult {
  deck: Deck
  diagnostics: Diagnostic[]
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
  const meta = resolveDeckMeta(split.deckFrontmatter, diags)
  const ctx: DeckContext = { diags, ids: new Set(), assets: [], blockCount: 0 }
  const slideIds = new Set<string>()

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
      const value = String(bg.value)
      attrs.background = value
      if (isImageBackground(value) && isLocalRef(value)) {
        ctx.assets.push({ ref: value, path: normalizeRelative(value), kind: assetKind(value), span: bg.span })
      }
    }
    if (fm.class !== undefined) attrs.class = String(fm.class).split(/\s+/).filter(Boolean)
    if (fm.style !== undefined) attrs.style = String(fm.style)

    let id = scalarString(fm.id) || r.headingId || (r.title && slug(r.title)) || `slide-${index + 1}`
    if (slideIds.has(id)) {
      let n = 2
      while (slideIds.has(`${id}-${n}`)) n++
      diags.warn('slide/duplicate-id', `slide id \`${id}\` is already used; this slide gets \`${id}-${n}\``, raw.span)
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
  return { deck, diagnostics: diags.list }
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
