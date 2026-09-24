/**
 * Per-slide resolution: notes, first-heading shorthand, attribute keys,
 * effects and build steps (syntax.md §3.2, §4.3, §6), render blocks (§8),
 * assets, and finally mdast → hast.
 */
import type { Element, ElementContent, Root as HastRoot, RootContent as HastRootContent } from 'hast'
import type { Code, Heading, Nodes, Parent, Root, RootContent } from 'mdast'
import { toHast } from 'mdast-util-to-hast'
import { toString } from 'mdast-util-to-string'
import { parseDocument } from 'yaml'
import type { Attached } from './attach.js'
import type { StepSpec } from './attrs.js'
import { assetKind, isExplicitRelative, isLocalRef, normalizeRelative } from './assets.js'
import { pointSpan, spanOf, type Diagnostics } from './diagnostics.js'
import type { AnimSpec, AssetRef, HastNode, RenderBlock, SourceSpan, StepRange } from './ir.js'
import { milliseconds, notYet } from './meta.js'
import { ANIM_KEYS, EFFECTS, NAMED_EASINGS, PASSTHROUGH_KEYS, RENDERERS, RESERVED_KEYS, SLIDE_SHORTHAND_KEYS } from './vocab.js'

/** Deck-wide state threaded through every slide. */
export interface DeckContext {
  diags: Diagnostics
  ids: Set<string>
  assets: AssetRef[]
  blockCount: number
}

/** A placeholder left where a render fence was. */
interface BlitzBlock extends Parent {
  type: 'blitzBlock'
  children: []
}

declare module 'mdast' {
  interface RootContentMap {
    blitzBlock: BlitzBlock
  }
  interface BlockContentMap {
    blitzBlock: BlitzBlock
  }
  interface Data {
    /** Step assigned by a parent's `reveal=` (§6.4). */
    blitzReveal?: { range: StepRange; anim?: number }
  }
}

export interface ResolvedSlide {
  title?: string
  /** `#id` on the first heading, a slide-id candidate (§2.4). */
  headingId?: string
  /** Slide keys written on the first heading (§3.2). */
  shorthand: Record<string, { value: string; span: SourceSpan }>
  steps: number
  notes: HastNode[]
  content: HastNode[]
  anims: AnimSpec[]
  blocks: RenderBlock[]
}

export function resolveSlide(nodes: RootContent[], index: number, ctx: DeckContext): ResolvedSlide {
  const { diags } = ctx
  const notesNodes = extractNotes(nodes, diags)

  const heading = findFirst(nodes, (n): n is Heading => n.type === 'heading')
  const shorthand: ResolvedSlide['shorthand'] = {}
  if (heading?.data?.blitz) {
    const { attrs, at } = heading.data.blitz
    attrs.pairs = attrs.pairs.filter((p) => {
      if (!SLIDE_SHORTHAND_KEYS.has(p.key)) return true
      shorthand[p.key] = { value: p.value, span: pointSpan({ line: at.line, column: at.column + 1 + p.offset }) }
      return false
    })
  }

  const anims: AnimSpec[] = []
  const blocks: RenderBlock[] = []
  const propTable: Array<Record<string, unknown>> = []
  let prevEntry: number | undefined
  let maxStep = 0
  /** Visible ranges of stepped (entrance) ancestors, for the nesting check. */
  const ancestors: StepRange[] = []

  const setProps = (node: Nodes, props: Record<string, unknown>) => {
    if (Object.keys(props).length === 0) return
    const data = (node.data ??= {})
    data.hProperties = { ...data.hProperties, dataBlitzProps: propTable.length }
    propTable.push(props)
  }

  const resolveStep = (spec: StepSpec, at: SourceSpan): StepRange => {
    if (spec.kind === 'abs') return spec.out === undefined ? { in: spec.in } : { in: spec.in, out: spec.out }
    if (spec.kind === 'next') return { in: (prevEntry ?? 0) + 1 }
    if (prevEntry === undefined) {
      diags.warn('step/same-without-previous', '`@=` with no earlier annotated element on this slide means `@0`', at)
      return { in: 0 }
    }
    return { in: prevEntry }
  }

  /** Returns the range the node is visible over, if it is stepped. */
  const resolveNode = (node: Nodes): StepRange | undefined => {
    const blitz: Attached | undefined = node.data?.blitz
    const reveal = node.data?.blitzReveal
    if (!blitz && !reveal) {
      if (node.type === 'blitzContainer' && node.name) setProps(node, { className: [node.name] })
      return undefined
    }

    const props: Record<string, unknown> = {}
    const classes: string[] = node.type === 'blitzContainer' && node.name ? [node.name] : []
    let effect: string | undefined
    let range: StepRange | undefined
    let animIndex: number | undefined
    const anim: AnimSpec = { effect: 'fade', kind: 'entrance', options: {} }
    let revealMode: string | undefined

    if (blitz) {
      const { attrs, at } = blitz
      const here = (offset: number) => pointSpan({ line: at.line, column: at.column + 1 + offset })

      for (const cls of attrs.classes) {
        if (!(cls in EFFECTS)) classes.push(cls)
        else if (effect) diags.error('effect/multiple', `second effect \`.${cls}\`: at most one effect per element; nest spans to combine`, pointSpan(at))
        else effect = cls
      }

      if (attrs.id !== undefined) {
        if (ctx.ids.has(attrs.id)) diags.error('id/duplicate', `duplicate id \`#${attrs.id}\`: ids must be unique across the deck`, pointSpan(at))
        else {
          ctx.ids.add(attrs.id)
          props.id = attrs.id
        }
      }

      const seen = new Set<string>()
      for (const { key, value, offset } of attrs.pairs) {
        const span = here(offset)
        if (seen.has(key)) diags.warn('attr/repeated-key', `\`${key}\` given twice; the last value wins`, span)
        seen.add(key)
        if (ANIM_KEYS.has(key)) {
          animOption(anim, key, value, diags, span)
        } else if (key === 'reveal') {
          revealMode = value
        } else if (key in RESERVED_KEYS) {
          notYet(`\`${key}=\``, RESERVED_KEYS[key]!, diags, span)
        } else if (SLIDE_SHORTHAND_KEYS.has(key)) {
          diags.error('attr/slide-key', `\`${key}\` is a slide setting: put it in slide frontmatter or on the slide's first heading`, span)
        } else if (PASSTHROUGH_KEYS.has(key) || key.startsWith('data-') || key.startsWith('aria-')) {
          props[key] = value
        } else {
          diags.error('attr/unknown-key', `unknown attribute \`${key}\`; use \`data-${key}\` for custom data`, span)
        }
      }

      if (attrs.step) range = resolveStep(attrs.step, pointSpan(at))

      if (revealMode !== undefined) {
        const ok =
          (revealMode === 'items' && node.type === 'list') || (revealMode === 'rows' && node.type === 'table')
        if (!ok) {
          diags.error(
            'reveal/target',
            revealMode === 'items' || revealMode === 'rows'
              ? `\`reveal=${revealMode}\` applies to a ${revealMode === 'items' ? 'list' : 'table'}`
              : `unknown \`reveal=${revealMode}\`: use \`items\` (lists) or \`rows\` (tables)`,
            pointSpan(at),
          )
          revealMode = undefined
        } else {
          range ??= { in: (prevEntry ?? 0) + 1 }
        }
      }
    }

    if (reveal) {
      if (range) diags.warn('reveal/child-step', 'this element has its own step inside a `reveal=` block; its own step wins', blitz ? pointSpan(blitz.at) : node)
      else {
        range = reveal.range
        animIndex = reveal.anim
      }
    }

    if (effect) {
      anim.effect = effect
      anim.kind = EFFECTS[effect]!
      range ??= { in: 0 }
    }

    const annotated = blitz?.attrs.step !== undefined || revealMode !== undefined
    const animates = effect !== undefined || (range !== undefined && (range.in > 0 || range.out !== undefined))
    if (range && animIndex === undefined && animates) {
      animIndex = anims.length
      anims.push(anim)
    }

    // reveal: the block enters with its first child; each later child is one step on.
    let lastEntry = range?.in
    if (revealMode && range) {
      const children =
        node.type === 'list' ? node.children : node.type === 'table' ? node.children.slice(1) : []
      children.forEach((child, k) => {
        if (k === 0) return
        const data = (child.data ??= {})
        data.blitzReveal = animIndex === undefined ? { range: { in: range.in + k } } : { range: { in: range.in + k }, anim: animIndex }
      })
      lastEntry = range.in + Math.max(0, children.length - 1)
    }

    if (range) {
      if (annotated && lastEntry !== undefined) prevEntry = lastEntry
      maxStep = Math.max(maxStep, lastEntry ?? 0, range.out !== undefined ? range.out + 1 : 0)
      if (anims[animIndex ?? -1]?.kind !== 'emphasis') {
        const parent = ancestors[ancestors.length - 1]
        if (parent && (range.in < parent.in || (parent.out !== undefined && (range.in > parent.out || (range.out ?? Infinity) > parent.out)))) {
          diags.warn('step/outside-parent', `steps @${fmtRange(range)} fall outside the enclosing element's @${fmtRange(parent)}`, blitz ? pointSpan(blitz.at) : node)
        }
      }
      if (animIndex !== undefined || range.in > 0 || range.out !== undefined) {
        props.dataBlitzStepIn = range.in
        if (range.out !== undefined) props.dataBlitzStepOut = range.out
        if (animIndex !== undefined) props.dataBlitzAnim = animIndex
      }
    }

    if (classes.length) props.className = classes
    setProps(node, props)
    return range && anims[animIndex ?? -1]?.kind !== 'emphasis' ? range : undefined
  }

  const walk = (parent: { children: RootContent[] }) => {
    const kids = parent.children
    for (let k = 0; k < kids.length; k++) {
      let node = kids[k]!
      if (node.type === 'code' && node.lang && node.lang in RENDERERS) {
        const placeholder = renderBlock(node, ctx, blocks)
        kids[k] = placeholder
        node = placeholder
      }
      if (node.type === 'image' && isLocalRef(node.url)) {
        ctx.assets.push({ ref: node.url, path: normalizeRelative(node.url), kind: assetKind(node.url), span: spanOf(node.position) })
      }
      if (node.type === 'blitzContainer') {
        node.data = { ...node.data, hName: 'div' }
      } else if (node.type === 'blitzSpan') {
        node.data = { ...node.data, hName: 'span' }
      }
      const range = resolveNode(node)
      if (node.type === 'blitzBlock') {
        const block = blocks[blocks.length - 1]!
        if (range) block.step = range
        const idx = node.data?.hProperties?.dataBlitzProps
        const animIdx = typeof idx === 'number' ? propTable[idx]?.dataBlitzAnim : undefined
        if (typeof animIdx === 'number') block.anim = anims[animIdx]!
      }
      if ('children' in node) {
        if (range) ancestors.push(range)
        walk(node as { children: RootContent[] })
        if (range) ancestors.pop()
      }
    }
  }
  walk({ children: nodes })

  const title = heading ? toString(heading).trim() : undefined
  const out: ResolvedSlide = {
    shorthand,
    steps: maxStep,
    notes: toHastContent(notesNodes, `s${index}-notes-`, []),
    content: toHastContent(nodes, `s${index}-`, propTable),
    anims,
    blocks,
  }
  if (title) out.title = title
  const headingId = heading?.data?.blitz?.attrs.id
  if (headingId) out.headingId = headingId
  return out
}

function fmtRange(r: StepRange): string {
  return r.out === undefined ? String(r.in) : `${r.in}-${r.out}`
}

function animOption(anim: AnimSpec, key: string, value: string, diags: Diagnostics, span: SourceSpan) {
  switch (key) {
    case 'dur':
    case 'delay': {
      const ms = milliseconds(value, key, diags, span)
      if (ms !== undefined) anim[key] = ms
      return
    }
    case 'ease':
      if (!NAMED_EASINGS.has(value) && !/^[a-z-]+\(.*\)$/.test(value)) {
        diags.error('attr/bad-value', `unknown easing \`${value}\`; use one of ${[...NAMED_EASINGS].join(', ')} or a CSS easing function`, span)
      } else anim.ease = value
      return
    case 'reverse':
      if (value !== 'true' && value !== 'false') diags.error('attr/bad-value', '`reverse` must be `true` or `false`', span)
      else anim.reverse = value === 'true'
      return
    case 'from':
      if (!Number.isFinite(Number(value))) diags.error('attr/bad-value', '`from` must be a number', span)
      anim.options[key] = value
      return
    case 'cps':
      if (!(Number(value) > 0)) diags.error('attr/bad-value', '`cps` must be a positive number', span)
      anim.options[key] = value
      return
  }
}

/** Pull every `::: notes` out of the tree (§7), in document order. */
function extractNotes(nodes: RootContent[], diags: Diagnostics): RootContent[] {
  const notes: RootContent[] = []
  const walk = (kids: RootContent[]) => {
    for (let k = 0; k < kids.length; k++) {
      const n = kids[k]!
      if (n.type === 'blitzContainer' && n.name === 'notes') {
        kids.splice(k, 1)
        k--
        stripSteps(n, diags)
        notes.push(...(n.children as RootContent[]))
      } else if ('children' in n) {
        walk(n.children as RootContent[])
      }
    }
  }
  walk(nodes)
  return notes
}

function stripSteps(node: Nodes, diags: Diagnostics) {
  const blitz = node.data?.blitz
  if (blitz?.attrs.step) {
    diags.warn('notes/step', 'build steps inside presenter notes are ignored', pointSpan(blitz.at))
    delete blitz.attrs.step
  }
  if ('children' in node) for (const c of node.children) stripSteps(c, diags)
}

function findFirst<T extends Nodes>(nodes: RootContent[], test: (n: Nodes) => n is T): T | undefined {
  for (const n of nodes) {
    if (test(n)) return n
    if ('children' in n) {
      const hit = findFirst(n.children as RootContent[], test)
      if (hit) return hit
    }
  }
  return undefined
}

function renderBlock(code: Code, ctx: DeckContext, blocks: RenderBlock[]): BlitzBlock {
  const renderer = code.lang!
  const def = RENDERERS[renderer]!
  const span = spanOf(code.position)
  notYet(`the \`${renderer}\` renderer is`, def.since, ctx.diags, span)
  const id = `${renderer}-${++ctx.blockCount}`

  let spec: unknown = code.value
  if (def.body === 'yaml') {
    const doc = parseDocument(code.value, { prettyErrors: false })
    const err = doc.errors[0]
    if (err) {
      const lp = err.linePos?.[0]
      const at = { line: span.start.line + (lp?.line ?? 1), column: lp?.col ?? 1 }
      ctx.diags.error('renderer/yaml', `\`${renderer}\` block is not valid YAML: ${err.message.split('\n')[0]}`, { start: at, end: at })
      spec = null
    } else {
      spec = rewritePaths(doc.toJS(), (ref) => {
        const path = normalizeRelative(ref)
        ctx.assets.push({ ref, path, kind: assetKind(ref), span })
        return path
      })
    }
  }

  const block: RenderBlock = { id, renderer, source: code.value, spec, span }
  blocks.push(block)
  const placeholder: BlitzBlock = {
    type: 'blitzBlock',
    children: [],
    data: { ...code.data, hName: 'div', hProperties: { dataBlitzBlock: id } },
  }
  if (code.position) placeholder.position = code.position
  return placeholder
}

function rewritePaths(value: unknown, onPath: (ref: string) => string): unknown {
  if (typeof value === 'string') return isExplicitRelative(value) ? onPath(value) : value
  if (Array.isArray(value)) return value.map((v) => rewritePaths(v, onPath))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = rewritePaths(v, onPath)
    return out
  }
  return value
}

function toHastContent(nodes: RootContent[], clobberPrefix: string, propTable: Array<Record<string, unknown>>): HastNode[] {
  const tree = toHast({ type: 'root', children: nodes } as Root, {
    allowDangerousHtml: true,
    clobberPrefix,
  }) as HastRoot
  applyProps(tree, undefined, propTable)
  return clean(tree.children).filter((n): n is ElementContent => n.type !== 'doctype')
}

/** Merge the side table of blitz properties into hast (className appends). */
function applyProps(node: HastRoot | Element, parent: Element | undefined, table: Array<Record<string, unknown>>) {
  if (node.type === 'element') {
    const idx = node.properties.dataBlitzProps
    if (typeof idx === 'number') {
      delete node.properties.dataBlitzProps
      // Attributes on a code fence belong on its <pre>.
      const target = node.tagName === 'code' && parent?.tagName === 'pre' ? parent : node
      for (const [k, v] of Object.entries(table[idx] ?? {})) {
        if (k === 'className') {
          const prev = target.properties.className
          target.properties.className = [...(Array.isArray(prev) ? prev : prev ? [String(prev)] : []), ...(v as string[])]
        } else {
          target.properties[k] = v as string
        }
      }
    }
  }
  for (const child of node.children) {
    if (child.type === 'element') applyProps(child, node.type === 'element' ? node : undefined, table)
  }
}

/** Drop positions and handler data: the IR carries structure, not provenance. */
function clean(nodes: HastRootContent[]): HastRootContent[] {
  return nodes.map((n) => {
    const { position: _p, data: _d, ...rest } = n as HastRootContent & { data?: unknown }
    if ('children' in rest && Array.isArray(rest.children)) {
      ;(rest as { children: HastRootContent[] }).children = clean(rest.children as HastRootContent[])
    }
    return rest as HastRootContent
  })
}
