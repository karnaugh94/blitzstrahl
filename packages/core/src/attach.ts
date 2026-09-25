/**
 * Attach every `{...}` to its target (syntax.md §4.2). After this pass no
 * `blitzAttrs` nodes remain; targets carry `data.blitz`.
 */
import type { Nodes, Parent, PhrasingContent, RootContent } from 'mdast'
import type { Point } from 'unist'
import { parseAttrs, type Attrs } from './attrs.js'
import { pointSpan, type Diagnostics } from './diagnostics.js'

export interface Attached {
  attrs: Attrs
  /** Position of the block's `{`, for pointing at bad tokens. */
  at: Point
}

declare module 'mdast' {
  interface Data {
    blitz?: Attached
  }
}

const BLOCK_PARENTS = new Set(['root', 'blockquote', 'listItem', 'list', 'blitzContainer', 'footnoteDefinition'])
const INLINE_TARGETS = new Set(['link', 'image', 'inlineCode', 'linkReference', 'imageReference', 'blitzMath'])

export function attachAttributes(nodes: RootContent[], lines: string[], diags: Diagnostics): void {
  const attach = (target: Nodes, raw: string, at: Point) => {
    const parsed = parseAttrs(raw)
    for (const e of parsed.errors) {
      diags.error(e.code, e.message, pointSpan({ line: at.line, column: at.column + 1 + e.offset }))
    }
    const data = (target.data ??= {})
    if (!data.blitz) {
      data.blitz = { attrs: parsed.attrs, at }
      return
    }
    diags.warn('attr/multiple', 'element has more than one attribute block; they are merged', pointSpan(at))
    const prev = data.blitz.attrs
    prev.classes.push(...parsed.attrs.classes)
    prev.pairs.push(...parsed.attrs.pairs)
    if (prev.id === undefined && parsed.attrs.id !== undefined) prev.id = parsed.attrs.id
    if (prev.step === undefined && parsed.attrs.step !== undefined) prev.step = parsed.attrs.step
  }

  const walkBlocks = (parent: { type: string; children: RootContent[] }) => {
    const kids = parent.children
    for (let k = 0; k < kids.length; k++) {
      const child = kids[k]!

      if (child.type === 'paragraph' && isStandalone(child.children)) {
        const attrs = child.children.find((c) => c.type === 'blitzAttrs')!
        const target = kids[k - 1]
        if (!target) {
          diags.error(
            'attr/no-preceding-block',
            'a standalone attribute block applies to the block before it, and there is none',
            attrs,
          )
        } else {
          attach(target, attrs.value, attrs.position!.start)
        }
        kids.splice(k, 1)
        k--
        continue
      }

      if (child.type === 'paragraph' || child.type === 'heading') {
        const target = child.type === 'paragraph' && parent.type === 'listItem' && k === 0 ? (parent as Nodes) : child
        takeTrailing(child, target)
        walkPhrasing(child)
      } else if (child.type === 'table') {
        for (const row of child.children) {
          for (const cell of row.children) {
            takeTrailing(cell, cell)
            walkPhrasing(cell)
          }
        }
      } else if (child.type === 'code') {
        codeMeta(child)
      } else if (BLOCK_PARENTS.has(child.type) && 'children' in child) {
        walkBlocks(child as Parent as { type: string; children: RootContent[] })
      }

      if (child.type === 'blitzContainer' && child.attrs !== undefined && child.attrsStart) {
        attach(child, child.attrs, child.attrsStart)
      }
    }
  }

  /** `text {...}` at the end of a block's last line → the block. */
  const takeTrailing = (block: Parent & { children: PhrasingContent[] }, target: Nodes) => {
    const kids = block.children
    const last = kids[kids.length - 1]
    if (last?.type !== 'blitzAttrs') return
    const prev = kids[kids.length - 2]
    if (prev && prev.type !== 'text') return // directly attached inline; walkPhrasing handles it
    if (prev && !/\s$/.test(prev.value)) return // `word{...}`: an error, reported by walkPhrasing
    kids.pop()
    if (prev) {
      prev.value = prev.value.replace(/\s+$/, '')
      if (prev.value === '') kids.pop()
    }
    attach(target, last.value, last.position!.start)
  }

  const walkPhrasing = (parent: { children: PhrasingContent[] }) => {
    const kids = parent.children
    for (let k = 0; k < kids.length; k++) {
      const child = kids[k]!
      if (child.type === 'blitzAttrs') {
        const prev = kids[k - 1]
        if (prev && INLINE_TARGETS.has(prev.type) && prev.position?.end.offset === child.position?.start.offset) {
          attach(prev, child.value, child.position!.start)
        } else {
          diags.error(
            'attr/no-target',
            'an inline attribute block must directly follow a [span], link, image, `code` or $math$; ' +
              'to style a whole block, put a space before it at the end of the line',
            child,
          )
        }
        kids.splice(k, 1)
        k--
        continue
      }
      if (child.type === 'blitzSpan') attach(child, child.attrs, child.attrsStart)
      if ('children' in child) walkPhrasing(child as { children: PhrasingContent[] })
    }
  }

  const codeMeta = (code: Extract<RootContent, { type: 'code' }>) => {
    const meta = code.meta?.trim()
    if (!meta || !meta.startsWith('{') || !meta.endsWith('}')) return
    const inner = meta.slice(1, -1)
    if (parseAttrs(inner).valid === 0) return
    const line = code.position!.start.line
    const col = (lines[line - 1] ?? '').indexOf(meta) + 1
    attach(code, inner, { line, column: col || code.position!.start.column })
    delete code.meta
  }

  walkBlocks({ type: 'root', children: nodes })
}

function isStandalone(children: PhrasingContent[]): boolean {
  let attrs = 0
  for (const c of children) {
    if (c.type === 'blitzAttrs') attrs++
    else if (c.type !== 'text' || c.value.trim() !== '') return false
  }
  return attrs === 1
}
