/**
 * Per-slide resolution: notes, first-heading shorthand, layout slots (§10),
 * attribute keys, effects and build steps (syntax.md §3.2, §4.3, §6), render
 * blocks (§8), assets, and finally mdast → hast.
 */
import type { Element, ElementContent, Root as HastRoot, RootContent as HastRootContent } from 'hast'
import type { BlockContent, Code, DefinitionContent, Heading, Nodes, Parent, Root, RootContent } from 'mdast'
import { toHast } from 'mdast-util-to-hast'
import { toString } from 'mdast-util-to-string'
import { parseDocument } from 'yaml'
import type { Attached } from './attach.js'
import { mathData, type BlitzMath } from './syntax/mdast.js'
import type { StepSpec } from './attrs.js'
import { assetKind, isExplicitRelative, isLocalRef, mediaKind, normalizeRelative, pageAsset } from './assets.js'
import { cssRefs, htmlRefs } from './html-refs.js'
import { pointSpan, spanOf, type Diagnostics } from './diagnostics.js'
import type { AnimSpec, AssetRef, EffectKind, HastNode, RenderBlock, SourceSpan, StepRange } from './ir.js'
import { milliseconds, notYet } from './meta.js'
import { ANIM_KEYS, COMPONENTS, LAYOUTS, MEDIA_KEYS, NAMED_EASINGS, PASSTHROUGH_KEYS, RESERVED_KEYS, SLIDE_SHORTHAND_KEYS, SLOT_NAMES, type RendererBody } from './vocab.js'
import { fill, strings } from './i18n.js'
import { parseMarkdown } from './syntax/index.js'
import { distance } from './split.js'

/** A container's `width=`/`height=` as CSS (§5.2): a length or percentage; a bare number is pixels. */
function cssSize(value: string): string | undefined {
  const m = /^(\d+(?:\.\d+)?|\.\d+)(px|%|em|rem|vw|vh|cm|mm|in|pt)?$/.exec(value.trim())
  return m ? `${m[1]}${m[2] ?? 'px'}` : undefined
}

type BlitzContainerNode = Extract<Nodes, { type: 'blitzContainer' }>

/** Runs of two or more consecutive siblings with the same `key=` (§9.1). */
function keyRuns(kids: RootContent[], keyOf: (n: Nodes) => string | undefined): Nodes[][] {
  const runs: Nodes[][] = []
  let run: Nodes[] = []
  const close = () => {
    if (run.length > 1) runs.push(run)
    run = []
  }
  for (const n of kids as Nodes[]) {
    const key = keyOf(n)
    if (key === undefined) {
      // Blank raw HTML between blocks doesn't break a run; anything else does.
      if (!(n.type === 'html' && !n.value.trim())) close()
      continue
    }
    if (run.length && keyOf(run[0]!) !== key) close()
    run.push(n)
  }
  close()
  return runs
}

/** A container's children that are blocks on the page: not raw HTML, definitions or notes. */
function blockChildren(node: BlitzContainerNode): Nodes[] {
  return (node.children as Nodes[]).filter(
    (c) => c.type !== 'html' && c.type !== 'definition' && c.type !== 'footnoteDefinition' && !(c.type === 'blitzContainer' && c.name === 'notes'),
  )
}

/** Deck-wide state threaded through every slide. */
export interface DeckContext {
  diags: Diagnostics
  ids: Set<string>
  assets: AssetRef[]
  blockCount: number
  /** Built-in renderers plus plugins' (`since` absent: always supported). */
  renderers: Readonly<Record<string, { body: RendererBody; since?: string }>>
  effects: Readonly<Record<string, EffectKind>>
  /** The deck's `lang`: the footnotes' labels are written in it (§3.3). */
  lang: string
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
    /** Layout slot this top-level container fills (§10). */
    blitzSlot?: string
  }
}

export type Shorthand = Record<string, { value: string; span: SourceSpan }>

export interface ResolvedSlide {
  title?: string
  /** Resolved layout name (§10). */
  layout: string
  /** `#id` on the first heading, a slide-id candidate (§2.4). */
  headingId?: string
  /** Slide keys written on the first heading (§3.2). */
  shorthand: Shorthand
  steps: number
  notes: HastNode[]
  content: HastNode[]
  anims: AnimSpec[]
  blocks: RenderBlock[]
}

/**
 * `pickLayout` resolves the slide's layout once the first-heading shorthand
 * is known, since `layout=` may be written there (§3.2).
 */
export function resolveSlide(
  nodes: RootContent[],
  index: number,
  ctx: DeckContext,
  pickLayout: (shorthand: Shorthand) => string,
): ResolvedSlide {
  const { diags } = ctx
  const notesNodes = extractNotes(nodes, diags)

  const heading = findFirst(nodes, (n): n is Heading => n.type === 'heading')
  const shorthand: Shorthand = {}
  if (heading?.data?.blitz) {
    const { attrs, at } = heading.data.blitz
    attrs.pairs = attrs.pairs.filter((p) => {
      if (!SLIDE_SHORTHAND_KEYS.has(p.key)) return true
      shorthand[p.key] = { value: p.value, span: pointSpan({ line: at.line, column: at.column + 1 + p.offset }) }
      return false
    })
  }
  const layout = pickLayout(shorthand)
  assignSlots(nodes, layout, diags)

  const anims: AnimSpec[] = []
  const blocks: RenderBlock[] = []
  const propTable: Array<Record<string, unknown>> = []
  let prevEntry: number | undefined
  const keys = new Set<string>()
  let maxStep = 0
  /** Visible ranges of stepped (entrance) ancestors, for the nesting check. */
  const ancestors: StepRange[] = []

  const addPageAssets = (urls: string[], span: SourceSpan) => {
    for (const url of urls) {
      const a = pageAsset(url, span)
      if (a) ctx.assets.push(a)
    }
  }

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
    const slot = node.data?.blitzSlot
    const ownClasses = slot ? ['blitz-slot'] : node.type === 'blitzContainer' && node.name ? [node.name] : []
    if (!blitz && !reveal) {
      setProps(node, slot ? { className: ownClasses, dataSlot: slot } : ownClasses.length ? { className: ownClasses } : {})
      return undefined
    }

    const props: Record<string, unknown> = slot ? { dataSlot: slot } : {}
    const classes: string[] = [...ownClasses]
    let effect: string | undefined
    let range: StepRange | undefined
    let animIndex: number | undefined
    const anim: AnimSpec = { effect: 'fade', kind: 'entrance', options: {} }
    let revealMode: string | undefined
    let as: { value: string; span: SourceSpan } | undefined
    let lineGroups: LineGroup[] | undefined

    if (blitz) {
      const { attrs, at } = blitz
      const here = (offset: number) => pointSpan({ line: at.line, column: at.column + 1 + offset })

      for (const cls of attrs.classes) {
        if (!Object.hasOwn(ctx.effects, cls)) classes.push(cls)
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
      const sizes: string[] = []
      for (const { key, value, offset } of attrs.pairs) {
        const span = here(offset)
        if (seen.has(key)) diags.warn('attr/repeated-key', `\`${key}\` given twice; the last value wins`, span)
        seen.add(key)
        if (ANIM_KEYS.has(key)) {
          animOption(anim, key, value, diags, span)
        } else if (key === 'reveal') {
          revealMode = value
        } else if (key === 'as') {
          as = { value, span }
        } else if (MEDIA_KEYS.has(key)) {
          if (node.type === 'image' && mediaKind(node.url)) mediaOption(props, key, value, span)
          else diags.error('attr/media-only', `\`${key}=\` applies to video and audio only (\`![](./clip.mp4)\`)`, span)
        } else if (key === 'lines') {
          lineGroups = linesOption(node, value, diags, span)
        } else if (key === 'key') {
          // auto-animate pairs elements by key (§9); one slide can't use a key twice.
          if (keys.has(value) && !stacked.has(node)) diags.warn('key/duplicate', `key \`${value}\` is already used on this slide; auto-animate pairs only the first`, span)
          keys.add(value)
          keySpans.set(node, span)
          props.dataBlitzKey = value
        } else if (key in RESERVED_KEYS) {
          notYet(`\`${key}=\``, RESERVED_KEYS[key]!, diags, span)
        } else if (SLIDE_SHORTHAND_KEYS.has(key)) {
          diags.error('attr/slide-key', `\`${key}\` is a slide setting: put it in slide frontmatter or on the slide's first heading`, span)
        } else if ((key === 'width' || key === 'height') && node.type === 'blitzContainer') {
          // On a container, a size (§5.2); `flex: none` so a `.column` keeps it beside `flex: 1` ones.
          const size = cssSize(value)
          if (size) sizes.push(`${key}: ${size}`)
          else diags.error('attr/size', `\`${key}=${value}\` isn't a size: use a length or percentage (\`440px\`, \`40%\`)`, span)
        } else if (key === 'alt' && (node.type === 'blitzBlock' || node.type === 'blitzMath')) {
          // A chart, map, diagram or formula is one picture to a screen reader, named by `alt` (§8.2).
          // An embed's frame is named instead (by its renderer): the page inside stays readable.
          if (String(node.data?.hProperties?.dataBlitzBlock).startsWith('embed-')) props.dataBlitzAlt = value
          else {
            props.role = 'img'
            props.ariaLabel = value
          }
        } else if (PASSTHROUGH_KEYS.has(key) || key.startsWith('data-') || key.startsWith('aria-')) {
          props[key] = value
          if (key === 'style') addPageAssets(cssRefs(value), span)
        } else {
          diags.error('attr/unknown-key', `unknown attribute \`${key}\`; use \`data-${key}\` for custom data`, span)
        }
      }

      if (sizes.length) {
        // The author's own `style` comes after, so it still wins.
        const own = typeof props.style === 'string' ? ` ${props.style}` : ''
        props.style = `${sizes.join('; ')}; flex: none;${own}`
      }

      if (as && componentOk(node, as.value, as.span)) props.dataAs = as.value
      if (typeof props.dataBlitzStart === 'number' && typeof props.dataBlitzEnd === 'number' && props.dataBlitzEnd <= props.dataBlitzStart) {
        diags.error('attr/media-value', '`end` must come after `start`', pointSpan(at))
        delete props.dataBlitzEnd
      }

      if (attrs.step) range = resolveStep(attrs.step, pointSpan(at))

      if (revealMode !== undefined) {
        const ok =
          (revealMode === 'items' && (node.type === 'list' || node.type === 'blitzContainer')) ||
          (revealMode === 'rows' && node.type === 'table')
        if (!ok) {
          diags.error(
            'reveal/target',
            revealMode === 'items' || revealMode === 'rows'
              ? `\`reveal=${revealMode}\` applies to a ${revealMode === 'items' ? 'list or a container' : 'table'}` +
                  (blitz.ownLine ? `; for the ${revealMode === 'items' ? 'list' : 'table'} above, leave a blank line before this \`{…}\`` : '')
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
      anim.kind = ctx.effects[effect]!
      range ??= { in: 0 }
    }

    const annotated = blitz?.attrs.step !== undefined || revealMode !== undefined || (lineGroups?.length ?? 0) > 1
    const animates = effect !== undefined || (range !== undefined && (range.in > 0 || range.out !== undefined))
    if (range && animIndex === undefined && animates) {
      animIndex = anims.length
      anims.push(anim)
    }

    // reveal: the block enters with its first child; each later child is one step on.
    let lastEntry = range?.in
    // lines: the first group shows with the block; each later one is one press on.
    if (lineGroups) {
      const first = range?.in ?? 0
      const next = blitz?.attrs.step ? first + 1 : (prevEntry ?? 0) + 1
      const steps = lineGroups.map((g, k) => ({ in: k === 0 ? first : next + k - 1, lines: g }))
      props.dataBlitzLines = JSON.stringify(steps)
      if (steps.length > 1) {
        lastEntry = steps[steps.length - 1]!.in
        range ??= { in: 0 }
      }
    }
    if (revealMode && range) {
      const children: Nodes[] =
        node.type === 'list' ? node.children
        : node.type === 'table' ? node.children.slice(1)
        : node.type === 'blitzContainer' ? blockChildren(node)
        : []
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

    // A sortable table stays authored HTML; the `table` renderer enhances it (§8).
    if (node.type === 'table' && classes.includes('sortable')) {
      const block: RenderBlock = { id: `table-${++ctx.blockCount}`, renderer: 'table', source: '', spec: { sortable: true }, span: spanOf(node.position) }
      if (range) block.step = range
      if (animIndex !== undefined) block.anim = anims[animIndex]!
      blocks.push(block)
      props.dataBlitzEnhance = block.id
    }

    if (classes.length) props.className = classes
    setProps(node, props)
    return range && anims[animIndex ?? -1]?.kind !== 'emphasis' ? range : undefined
  }

  /** A media key (§13) onto `props`, or an error for a value it doesn't take. */
  const mediaOption = (props: Record<string, unknown>, key: string, value: string, span: SourceSpan) => {
    const bad = (want: string) => diags.error('attr/media-value', `\`${key}=${value}\`: ${want}`, span)
    if (key === 'poster') {
      props.poster = value
      if (isLocalRef(value)) ctx.assets.push({ ref: value, path: normalizeRelative(value), kind: assetKind(value), span })
    } else if (key === 'start' || key === 'end') {
      const t = /^(?:(\d+):([0-5]\d)(\.\d+)?|(\d+(?:\.\d+)?|\.\d+))$/.exec(value)
      if (!t) return bad('use seconds (`12.5`) or minutes and seconds (`1:05`)')
      props[key === 'start' ? 'dataBlitzStart' : 'dataBlitzEnd'] = t[4] !== undefined ? Number(t[4]) : Number(t[1]) * 60 + Number(t[2]) + Number(t[3] ?? 0)
    } else if (value !== 'true' && value !== 'false') {
      bad('write `true` or `false`')
    } else if (key === 'autoplay') {
      if (value === 'false') props.dataBlitzAutoplay = 'false'
    } else if (key === 'loop') {
      if (value === 'true') props.dataBlitzLoop = 'true'
    } else {
      // muted, controls: HTML's own attributes.
      props[key] = value === 'true'
    }
  }

  /** `as=value` fits this node (§5.1); reports why not. */
  const componentOk = (node: Nodes, value: string, span: SourceSpan): boolean => {
    const targets = COMPONENTS[value]
    if (!targets) {
      const near = Object.keys(COMPONENTS).find((c) => distance(value, c) <= 2)
      diags.error('as/unknown', `unknown component \`as=${value}\`${near ? `: did you mean \`${near}\`?` : ` (${Object.keys(COMPONENTS).join(', ')})`}`, span)
      return false
    }
    const kind = node.type === 'list' ? 'list' : node.type === 'table' ? 'table' : node.type === 'blitzContainer' ? 'container' : undefined
    if (!kind || !targets.includes(kind)) {
      const on = targets.map((t) => (t === 'table' && value === 'compare' ? 'a two-column table' : `a ${t}`)).join(' or ')
      diags.error('as/target', `\`as=${value}\` goes on ${on}`, span)
      return false
    }
    if (value === 'compare') {
      const n = node.type === 'table' ? (node.children[0]?.children.length ?? 0) : blockChildren(node as BlitzContainerNode).length
      if (n !== 2) {
        diags.error('as/compare', `\`as=compare\` needs two sides: this ${kind} has ${n} ${kind === 'table' ? (n === 1 ? 'column' : 'columns') : n === 1 ? 'child' : 'children'}`, span)
        return false
      }
    }
    return true
  }

  /** Later members of a stack (§9.1): consecutive siblings sharing a `key=`. Not duplicates. */
  const stacked = new WeakSet<Nodes>()
  const keySpans = new WeakMap<Nodes, SourceSpan>()
  const keyOf = (n: Nodes) => n.data?.blitz?.attrs.pairs.findLast((p) => p.key === 'key')?.value

  const walk = (parent: { children: RootContent[] }) => {
    const kids = parent.children
    for (const run of keyRuns(kids, keyOf)) for (const n of run.slice(1)) stacked.add(n)
    for (let k = 0; k < kids.length; k++) {
      let node = kids[k]!
      // A math fence is display math (§12), rendered at build time like `$$…$$`, not a render block.
      if (node.type === 'code' && node.lang === 'math') {
        const math: BlitzMath = { type: 'blitzMath', value: node.value, display: true, data: { ...node.data, ...mathData(node.value, true, 'div') } }
        if (node.position) math.position = node.position
        kids[k] = math
        node = math
      } else if (node.type === 'code' && node.lang && Object.hasOwn(ctx.renderers, node.lang)) {
        const placeholder = renderBlock(node, ctx, blocks)
        kids[k] = placeholder
        node = placeholder
      }
      if (node.type === 'image' && mediaKind(node.url)) {
        // Video and audio from an image (§13): the runtime plays it, so no `autoplay`.
        const kind = mediaKind(node.url)!
        node.data = {
          ...node.data,
          hName: kind,
          hProperties: {
            ...node.data?.hProperties,
            alt: undefined,
            ariaLabel: node.alt || undefined,
            dataBlitzMedia: '',
            preload: 'metadata',
            ...(kind === 'video' ? { playsInline: true } : { controls: true }),
          },
          hChildren: node.alt ? [{ type: 'text', value: node.alt }] : [],
        }
      }
      if (node.type === 'image' && isLocalRef(node.url)) {
        ctx.assets.push({ ref: node.url, path: normalizeRelative(node.url), kind: assetKind(node.url), span: spanOf(node.position) })
      } else if (node.type === 'link' || node.type === 'definition') {
        addPageAssets([node.url], spanOf(node.position))
      } else if (node.type === 'html') {
        // Raw HTML's src, srcset, poster, href and CSS url()s (syntax.md §1).
        addPageAssets(
          htmlRefs(node.value).map((r) => r.url),
          spanOf(node.position),
        )
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
    // Again: render fences have become placeholders (which keep their attributes).
    for (const run of keyRuns(kids, keyOf)) stack(kids, run)
  }

  /**
   * Magic move within a slide (§9.1): each member of a run leaves as the next
   * arrives, and the run shares one box (`data-blitz-stack`, a one-cell grid).
   */
  const stack = (kids: RootContent[], run: Nodes[]) => {
    const props = run.map((n) => propTable[n.data?.hProperties?.dataBlitzProps as number]!)
    const ins = props.map((p) => p.dataBlitzStepIn)
    // Only a run whose every block comes at a later step is a stack; otherwise it's 1.0's duplicate key.
    if (!ins.every((v, i) => i === 0 || (typeof v === 'number' && v > Number(ins[i - 1] ?? 0)))) {
      for (const n of run.slice(1)) {
        diags.warn('key/duplicate', `key \`${keyOf(n)}\` is already used on this slide; auto-animate pairs only the first (to replace the block before it, give this one a later step)`, keySpans.get(n) ?? n)
      }
      return
    }
    for (let i = 0; i < run.length - 1; i++) {
      props[i]!.dataBlitzStepIn = Number(ins[i] ?? 0)
      props[i]!.dataBlitzStepOut = (ins[i + 1] as number) - 1
    }
    const first = kids.indexOf(run[0] as RootContent)
    const wrapper = { type: 'blitzContainer', children: run, data: { hName: 'div', hProperties: { dataBlitzStack: '' } } } as unknown as RootContent
    kids.splice(first, run.length, wrapper)
  }
  walk({ children: nodes })

  const title = heading ? toString(heading).trim() : undefined
  const out: ResolvedSlide = {
    layout,
    shorthand,
    steps: maxStep,
    notes: toHastContent(notesNodes, `s${index}-notes-`, [], ctx.lang),
    content: dimText(toHastContent(slotted(nodes), `s${index}-`, propTable, ctx.lang), anims),
    anims,
    blocks,
  }
  if (title) out.title = title
  const headingId = heading?.data?.blitz?.attrs.id
  if (headingId) out.headingId = headingId
  return out
}

/**
 * Mark top-level containers that fill a slot of `layout` (§10). A slot name
 * the layout doesn't have, or a slot filled twice, leaves an ordinary `<div>`.
 * A name close to a slot the slide leaves empty (`::: lft`) is probably that
 * slot misspelt, and is warned about.
 */
function assignSlots(nodes: RootContent[], layout: string, diags: Diagnostics) {
  const slots = LAYOUTS[layout] ?? []
  const named = new Set(nodes.flatMap((n) => (n.type === 'blitzContainer' && n.name ? [n.name] : [])))
  const filled = new Set<string>()
  for (const n of nodes) {
    if (n.type !== 'blitzContainer' || !n.name) continue
    const at = { start: n.position!.start, end: n.position!.start }
    if (!SLOT_NAMES.has(n.name)) {
      const near = slots.find((x) => !named.has(x) && distance(n.name!, x) <= Math.floor((x.length + 1) / 3))
      if (near) diags.warn('layout/near-slot', `layout \`${layout}\` has no \`${n.name}\` slot, so this is an ordinary container: did you mean \`${near}\`?`, at)
      continue
    }
    if (!slots.includes(n.name)) {
      const has = slots.length ? `its slots are ${slots.map((x) => `\`${x}\``).join(', ')}` : 'it has no named slots'
      diags.warn('layout/unknown-slot', `layout \`${layout}\` has no \`${n.name}\` slot (${has}); this is an ordinary container`, at)
    } else if (filled.has(n.name)) {
      diags.warn('layout/slot-twice', `slot \`${n.name}\` is already filled on this slide; this is an ordinary container`, at)
    } else {
      filled.add(n.name)
      n.data = { ...n.data, blitzSlot: n.name }
    }
  }
}

/**
 * Top-level content as slot elements: the main slot (everything not in a
 * named slot) first, when non-empty, then named slots in document order.
 */
function slotted(nodes: RootContent[]): RootContent[] {
  const main = nodes.filter((n) => !n.data?.blitzSlot)
  const named = nodes.filter((n) => n.data?.blitzSlot)
  if (!main.length) return named
  const wrapper: RootContent = {
    type: 'blitzContainer',
    closed: true,
    children: main as Array<BlockContent | DefinitionContent>,
    data: { hName: 'div', hProperties: { className: ['blitz-slot'], dataSlot: 'main' } },
  }
  return [wrapper, ...named]
}

/** One `|`-separated group of `lines=`: inclusive line ranges, or `null` for all lines. */
type LineGroup = Array<[number, number]> | null

/** `lines="1|2-3,5|all"` on a code block (§8.1). */
function linesOption(node: Nodes, value: string, diags: Diagnostics, span: SourceSpan): LineGroup[] | undefined {
  if (node.type !== 'code') {
    diags.error('lines/target', '`lines=` applies to a code block', span)
    return undefined
  }
  const count = node.value.split('\n').length
  const groups: LineGroup[] = []
  for (const group of value.split('|')) {
    const g = group.trim()
    if (g === 'all' || g === '*') {
      groups.push(null)
      continue
    }
    const ranges: Array<[number, number]> = []
    for (const part of g.split(',')) {
      const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part)
      const a = m ? Number(m[1]) : NaN
      const b = m?.[2] !== undefined ? Number(m[2]) : a
      if (!m || a < 1 || b < a) {
        diags.error('lines/syntax', `bad \`lines=\` group \`${g}\`: use line numbers and ranges, e.g. \`lines="1|2-4,6|all"\``, span)
        return undefined
      }
      if (b > count) diags.warn('lines/out-of-range', `\`lines=\` names line ${b}, but the block has ${count}`, span)
      ranges.push([a, b])
    }
    groups.push(ranges)
  }
  return groups
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
  const def = ctx.renderers[renderer]!
  const span = spanOf(code.position)
  if (def.since) notYet(`the \`${renderer}\` renderer is`, def.since, ctx.diags, span)
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

/**
 * One line of inline markdown from frontmatter (`footer`, syntax.md §3.6), as
 * HTML. Anything more than a paragraph is shown as the text it is, with a
 * warning. Local links and images in it are files the page uses.
 */
export function inlineMarkdown(text: string, key: string, span: SourceSpan, ctx: DeckContext): HastNode[] {
  const [first, ...rest] = parseMarkdown(text).children
  if (first?.type !== 'paragraph' || rest.length) {
    ctx.diags.warn('frontmatter/type', `\`${key}\` should be one line of inline markdown; it's shown as plain text`, span)
    return [{ type: 'text', value: text }]
  }
  // The paragraph's contents: converted alone, toHast would put line breaks between them.
  const [p] = toHastContent([first], `${key}-`, [], ctx.lang)
  const nodes = p?.type === 'element' ? p.children : []
  const walk = (list: HastNode[]) => {
    for (const n of list) {
      if (n.type !== 'element') continue
      for (const url of [n.properties.href, n.properties.src]) {
        const a = typeof url === 'string' ? pageAsset(url, span) : undefined
        if (a) ctx.assets.push(a)
      }
      walk(n.children)
    }
  }
  walk(nodes)
  return nodes
}

function toHastContent(nodes: RootContent[], clobberPrefix: string, propTable: Array<Record<string, unknown>>, lang: string): HastNode[] {
  const words = strings(lang).deck
  const tree = toHast({ type: 'root', children: nodes } as Root, {
    allowDangerousHtml: true,
    clobberPrefix,
    // Screen readers read these out, so they're in the deck's language.
    footnoteLabel: words.footnotes,
    footnoteBackLabel: (ref, again) => fill(words.backToReference, { ref: `${ref + 1}${again > 1 ? `-${again}` : ''}` }),
  }) as HastRoot
  applyProps(tree, undefined, propTable)
  return clean(tree.children).filter((n): n is ElementContent => n.type !== 'doctype')
}

/**
 * `dim-others` dims its siblings (§6.3), which CSS can only do to elements:
 * bare text beside it (`The [point]{.dim-others @1} of it`) is wrapped in a
 * plain `<span>` so it dims too.
 */
function dimText(nodes: HastNode[], anims: AnimSpec[]): HastNode[] {
  const visit = (list: HastNode[]) => {
    const dims = list.some((n) => n.type === 'element' && anims[Number(n.properties.dataBlitzAnim ?? -1)]?.effect === 'dim-others')
    list.forEach((n, i) => {
      if (dims && n.type === 'text' && n.value.trim()) list[i] = { type: 'element', tagName: 'span', properties: {}, children: [n] }
      else if (n.type === 'element') visit(n.children)
    })
  }
  visit(nodes)
  return nodes
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
