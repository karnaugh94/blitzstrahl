/**
 * mdast nodes for the micromark extensions in `./micromark.ts`, and the
 * `mdast-util-from-markdown` extension that builds them.
 *
 * These nodes are internal to core: the transforms consume them and nothing
 * of them survives into the IR except as hast.
 */
import type { Parent, PhrasingContent, BlockContent, DefinitionContent, Literal } from 'mdast'
import type { Point } from 'unist'
import type { CompileContext, Extension, Token } from 'mdast-util-from-markdown'
import { CONTAINER_INFO } from './micromark.js'

/** A `{...}` block not (yet) attached to anything. `value` is the inner text. */
export interface BlitzAttrs extends Literal {
  type: 'blitzAttrs'
}

/** `[text]{...}`. */
export interface BlitzSpan extends Parent {
  type: 'blitzSpan'
  children: PhrasingContent[]
  /** Inner text of the attribute block. */
  attrs: string
  /** Position of the attribute block's `{`. */
  attrsStart: Point
}

/** `::: name {...}` … `:::`. */
export interface BlitzContainer extends Parent {
  type: 'blitzContainer'
  children: Array<BlockContent | DefinitionContent>
  name?: string
  attrs?: string
  attrsStart?: Point
  /** False when no closing fence was found (it ran to the end of its parent). */
  closed: boolean
}

declare module 'mdast' {
  interface PhrasingContentMap {
    blitzAttrs: BlitzAttrs
    blitzSpan: BlitzSpan
  }
  interface BlockContentMap {
    blitzContainer: BlitzContainer
  }
  interface RootContentMap {
    blitzAttrs: BlitzAttrs
    blitzSpan: BlitzSpan
    blitzContainer: BlitzContainer
  }
}

function top<T>(ctx: CompileContext): T {
  return ctx.stack[ctx.stack.length - 1] as T
}

export function blitzFromMarkdown(): Extension {
  return {
    enter: {
      blitzAttrs(this: CompileContext, token: Token) {
        this.enter({ type: 'blitzAttrs', value: '' } as never, token)
      },
      blitzSpan(this: CompileContext, token: Token) {
        this.enter(
          { type: 'blitzSpan', attrs: '', attrsStart: { line: 0, column: 0 }, children: [] } as never,
          token,
        )
      },
      blitzContainer(this: CompileContext, token: Token) {
        this.enter({ type: 'blitzContainer', closed: false, children: [] } as never, token)
      },
    },
    exit: {
      blitzAttrs(this: CompileContext, token: Token) {
        top<BlitzAttrs>(this).value = this.sliceSerialize(token).slice(1, -1)
        this.exit(token)
      },
      blitzSpanAttrs(this: CompileContext, token: Token) {
        const span = top<BlitzSpan>(this)
        span.attrs = this.sliceSerialize(token).slice(1, -1)
        span.attrsStart = { line: token.start.line, column: token.start.column, offset: token.start.offset }
      },
      blitzSpan(this: CompileContext, token: Token) {
        this.exit(token)
      },
      blitzContainerInfo(this: CompileContext, token: Token) {
        const node = top<BlitzContainer>(this)
        const info = this.sliceSerialize(token)
        const m = CONTAINER_INFO.exec(info)
        if (m?.[1]) node.name = m[1]
        if (m?.[2]) {
          node.attrs = m[2].slice(1, -1)
          const at = info.indexOf(m[2], m[1] ? info.indexOf(m[1]) + m[1].length : 0)
          node.attrsStart = {
            line: token.start.line,
            column: token.start.column + at,
            offset: token.start.offset + at,
          }
        }
      },
      blitzContainerClose(this: CompileContext) {
        top<BlitzContainer>(this).closed = true
      },
      blitzContainer(this: CompileContext, token: Token) {
        this.exit(token)
      },
    },
  }
}
