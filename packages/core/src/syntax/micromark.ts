/**
 * micromark extensions for blitzstrahl's additions to CommonMark (syntax.md §4, §5):
 *
 * - `{...}` attribute blocks (text construct)
 * - `[text]{...}` bracketed spans (text construct)
 * - `:::` fenced containers (flow construct)
 *
 * The span label factory and the container's nested-document handling are
 * adapted from micromark-extension-directive (MIT, © Titus Wormer). We don't use
 * that extension itself: see docs/decisions.md, "Attribute grammar is our own
 * micromark extension".
 */
import { factorySpace } from 'micromark-factory-space'
import { markdownLineEnding } from 'micromark-util-character'
import { normalizeIdentifier } from 'micromark-util-normalize-identifier'
import type {
  Code,
  Construct,
  Effects,
  Extension,
  State,
  Token,
  TokenizeContext,
  Tokenizer,
} from 'micromark-util-types'
import { parseAttrs } from '../attrs.js'

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    blitzAttrs: 'blitzAttrs'
    blitzSpan: 'blitzSpan'
    blitzSpanLabel: 'blitzSpanLabel'
    blitzSpanLabelMarker: 'blitzSpanLabelMarker'
    blitzSpanLabelString: 'blitzSpanLabelString'
    blitzSpanAttrs: 'blitzSpanAttrs'
    blitzContainer: 'blitzContainer'
    blitzContainerFence: 'blitzContainerFence'
    blitzContainerSequence: 'blitzContainerSequence'
    blitzContainerInfo: 'blitzContainerInfo'
    blitzContainerContent: 'blitzContainerContent'
    blitzContainerClose: 'blitzContainerClose'
  }
}

const COLON = 58
const LEFT_BRACKET = 91
const RIGHT_BRACKET = 93
const LEFT_BRACE = 123
const RIGHT_BRACE = 125
const BACKSLASH = 92
const QUOTE = 34
const APOSTROPHE = 39

/**
 * Container info after the colons: `name? attrs?`, at least one of them,
 * optionally followed by more colons (Pandoc's `::: Warning ::::::`).
 */
export const CONTAINER_INFO = /^[ \t]*([A-Za-z_][A-Za-z0-9_-]*)?[ \t]*(\{.*\})?[ \t]*(?::{3,}[ \t]*)?$/

/** An opening fence line: colons, then a valid `CONTAINER_INFO` with a name or attrs. */
function isOpeningFence(line: string): boolean {
  const m = /^ {0,3}:{3,}(.*)$/.exec(line)
  if (!m) return false
  const info = CONTAINER_INFO.exec(m[1]!)
  if (!info || (!info[1] && !info[2])) return false
  return !info[2] || parseAttrs(info[2].slice(1, -1)).valid > 0
}

const BARE_FENCE = /^ {0,3}:{3,}[ \t]*$/
const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/

export function blitzSyntax(): Extension {
  return {
    text: {
      [LEFT_BRACE]: { name: 'blitzAttrs', tokenize: tokenizeAttrs('blitzAttrs') },
      [LEFT_BRACKET]: { name: 'blitzSpan', tokenize: tokenizeSpan },
    },
    flow: {
      [COLON]: { name: 'blitzContainer', tokenize: tokenizeContainer, concrete: true },
    },
    // syntax.md §1: `Text\n---` must stay a paragraph and a separator.
    disable: { null: ['setextUnderline'] },
  }
}

function codeToString(code: number): string {
  if (code === -2) return '\t'
  if (code === -1) return ' '
  return String.fromCodePoint(code)
}

/**
 * `{...}` on one line, quotes respected, accepted only if it contains at
 * least one valid attribute token (§4.1).
 */
function tokenizeAttrs(type: 'blitzAttrs' | 'blitzSpanAttrs'): Tokenizer {
  return function (effects, ok, nok) {
    let inner = ''
    let quote: number | undefined
    return start

    function start(code: Code): State | undefined {
      effects.enter(type)
      effects.consume(code)
      return body
    }

    function body(code: Code): State | undefined {
      if (code === null || markdownLineEnding(code)) return nok(code)
      if (quote === undefined && code === RIGHT_BRACE) {
        effects.consume(code)
        effects.exit(type)
        return parseAttrs(inner).valid > 0 ? ok : nok
      }
      if (quote !== undefined) {
        if (code === quote) quote = undefined
        else if (code === BACKSLASH) {
          inner += '\\'
          effects.consume(code)
          return escaped
        }
      } else if (code === QUOTE || code === APOSTROPHE) {
        quote = code
      }
      inner += codeToString(code)
      effects.consume(code)
      return body
    }

    function escaped(code: Code): State | undefined {
      if (code === null || markdownLineEnding(code)) return nok(code)
      inner += codeToString(code)
      effects.consume(code)
      return body
    }
  }
}

const spanAttrs: Construct = { tokenize: tokenizeAttrs('blitzSpanAttrs'), partial: true }

/**
 * `[text]{...}`: a Pandoc bracketed span. Fails (and falls back to an
 * ordinary `[`) unless an attribute block follows the `]` immediately, or if
 * the label matches a link reference definition (§4.2).
 */
function tokenizeSpan(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  const self = this
  let balance = 0
  let size = 0
  let raw = ''
  let previous: Token | undefined
  return start

  function start(code: Code): State | undefined {
    effects.enter('blitzSpan')
    effects.enter('blitzSpanLabel')
    effects.enter('blitzSpanLabelMarker')
    effects.consume(code)
    effects.exit('blitzSpanLabelMarker')
    return afterStart
  }

  function afterStart(code: Code): State | undefined {
    if (code === RIGHT_BRACKET) return closing(code)
    effects.enter('blitzSpanLabelString')
    return lineStart(code)
  }

  function lineStart(code: Code): State | undefined {
    if (code === RIGHT_BRACKET && !balance) return closingString(code)
    const token = effects.enter('chunkText', {
      _contentTypeTextTrailing: true,
      contentType: 'text',
      previous,
    })
    if (previous) previous.next = token
    previous = token
    return data(code)
  }

  function data(code: Code): State | undefined {
    if (code === null || size > 999) return nok(code)
    if (code === LEFT_BRACKET && ++balance > 32) return nok(code)
    if (code === RIGHT_BRACKET && !balance--) {
      effects.exit('chunkText')
      return closingString(code)
    }
    if (markdownLineEnding(code)) {
      raw += '\n'
      effects.consume(code)
      effects.exit('chunkText')
      return lineStart
    }
    raw += codeToString(code)
    size++
    effects.consume(code)
    return code === BACKSLASH ? dataEscape : data
  }

  function dataEscape(code: Code): State | undefined {
    if (code === LEFT_BRACKET || code === BACKSLASH || code === RIGHT_BRACKET) {
      raw += codeToString(code)
      size++
      effects.consume(code)
      return data
    }
    return data(code)
  }

  function closingString(code: Code): State | undefined {
    effects.exit('blitzSpanLabelString')
    return closing(code)
  }

  function closing(code: Code): State | undefined {
    effects.enter('blitzSpanLabelMarker')
    effects.consume(code)
    effects.exit('blitzSpanLabelMarker')
    effects.exit('blitzSpanLabel')
    return afterLabel
  }

  function afterLabel(code: Code): State | undefined {
    if (code !== LEFT_BRACE) return nok(code)
    if (raw && self.parser.defined.includes(normalizeIdentifier(raw))) return nok(code)
    return effects.attempt(spanAttrs, after, nok)(code)
  }

  function after(code: Code): State | undefined {
    effects.exit('blitzSpan')
    return ok(code)
  }
}

const nonLazyLine: Construct = { tokenize: tokenizeNonLazyLine, partial: true }

function tokenizeNonLazyLine(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  const self = this
  return start

  function start(code: Code): State | undefined {
    effects.enter('lineEnding')
    effects.consume(code)
    effects.exit('lineEnding')
    return lineStart
  }

  function lineStart(code: Code): State | undefined {
    return self.parser.lazy[self.now().line] ? nok(code) : ok(code)
  }
}

/**
 * `:::+ name? {attrs}?` … `:::+`. The body is a nested document, so it may
 * hold any block content.
 *
 * Closing follows Pandoc (§5): a bare fence always closes the *innermost*
 * open container, whatever its colon count. The body is only parsed after
 * this container ends, so to know which bare fence is ours we track, line by
 * line, the openers of nested containers and fenced code blocks (whose
 * contents never open or close anything).
 *
 * Unclosed containers run to the end of their parent here; the slide
 * splitter cuts them at the next separator.
 */
function tokenizeContainer(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  const self = this
  const tail = self.events[self.events.length - 1]
  const initialSize =
    tail && tail[1].type === 'linePrefix' ? tail[2].sliceSerialize(tail[1], true).length : 0
  let sizeOpen = 0
  let info = ''
  /** Raw text of the content line being consumed. */
  let line = ''
  /** Nested containers opened in our body and not yet closed. */
  let depth = 0
  /** Open fenced code block in our body, if any. */
  let codeFence: { char: string; size: number } | undefined
  let previous: Token | undefined
  const closingFence: Construct = { tokenize: tokenizeClosingFence, partial: true }
  return start

  function start(code: Code): State | undefined {
    effects.enter('blitzContainer')
    effects.enter('blitzContainerFence')
    effects.enter('blitzContainerSequence')
    return sequenceOpen(code)
  }

  function sequenceOpen(code: Code): State | undefined {
    if (code === COLON) {
      effects.consume(code)
      sizeOpen++
      return sequenceOpen
    }
    if (sizeOpen < 3) return nok(code)
    effects.exit('blitzContainerSequence')
    if (code === null || markdownLineEnding(code)) return nok(code)
    effects.enter('blitzContainerInfo')
    return infoRest(code)
  }

  function infoRest(code: Code): State | undefined {
    if (code === null || markdownLineEnding(code)) {
      effects.exit('blitzContainerInfo')
      const m = CONTAINER_INFO.exec(info)
      // A bare fence is a closer, never an opener (Pandoc rule).
      if (!m || (!m[1] && !m[2])) return nok(code)
      if (m[2] && parseAttrs(m[2].slice(1, -1)).valid === 0) return nok(code)
      return openAfter(code)
    }
    info += codeToString(code)
    effects.consume(code)
    return infoRest
  }

  function openAfter(code: Code): State | undefined {
    effects.exit('blitzContainerFence')
    if (code === null) return after(code)
    if (self.interrupt) return ok(code)
    return effects.attempt(nonLazyLine, contentStart, after)(code)
  }

  function contentStart(code: Code): State | undefined {
    if (code === null) return after(code)
    if (markdownLineEnding(code)) {
      return effects.check(nonLazyLine, emptyContentNonLazyLineAfter, after)(code)
    }
    effects.enter('blitzContainerContent')
    return lineStart(code)
  }

  function lineStart(code: Code): State | undefined {
    const content = initialSize ? factorySpace(effects, chunkStart, 'linePrefix', initialSize + 1) : chunkStart
    if (depth > 0 || codeFence) return content(code)
    return effects.attempt(closingFence, afterContent, content)(code)
  }

  /** Update nesting state with a finished content line. */
  function classify(text: string) {
    if (codeFence) {
      const close = new RegExp(`^ {0,3}\\${codeFence.char}{${codeFence.size},}[ \\t]*$`)
      if (close.test(text)) codeFence = undefined
      return
    }
    const code = CODE_FENCE.exec(text)
    if (code && !(code[1]![0] === '`' && code[2]!.includes('`'))) {
      codeFence = { char: code[1]![0]!, size: code[1]!.length }
    } else if (BARE_FENCE.test(text)) {
      if (depth > 0) depth--
    } else if (isOpeningFence(text)) {
      depth++
    }
  }

  function chunkStart(code: Code): State | undefined {
    if (code === null) return afterContent(code)
    if (markdownLineEnding(code)) {
      return effects.check(nonLazyLine, chunkNonLazyStart, afterContent)(code)
    }
    return chunkNonLazyStart(code)
  }

  function contentContinue(code: Code): State | undefined {
    if (code === null) {
      const t = effects.exit('chunkDocument')
      self.parser.lazy[t.start.line] = false
      return afterContent(code)
    }
    if (markdownLineEnding(code)) {
      classify(line)
      line = ''
      return effects.check(nonLazyLine, nonLazyLineAfter, lineAfter)(code)
    }
    line += codeToString(code)
    effects.consume(code)
    return contentContinue
  }

  function chunkNonLazyStart(code: Code): State | undefined {
    const token = effects.enter('chunkDocument', { contentType: 'document', previous })
    if (previous) previous.next = token
    previous = token
    return contentContinue(code)
  }

  function emptyContentNonLazyLineAfter(code: Code): State | undefined {
    effects.enter('blitzContainerContent')
    return lineStart(code)
  }

  function nonLazyLineAfter(code: Code): State | undefined {
    effects.consume(code)
    const t = effects.exit('chunkDocument')
    self.parser.lazy[t.start.line] = false
    return lineStart
  }

  function lineAfter(code: Code): State | undefined {
    const t = effects.exit('chunkDocument')
    self.parser.lazy[t.start.line] = false
    return afterContent(code)
  }

  function afterContent(code: Code): State | undefined {
    effects.exit('blitzContainerContent')
    return after(code)
  }

  function after(code: Code): State | undefined {
    effects.exit('blitzContainer')
    return ok(code)
  }

  function tokenizeClosingFence(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
    let size = 0
    return factorySpace(effects, prefixAfter, 'linePrefix', 4)

    function prefixAfter(code: Code): State | undefined {
      effects.enter('blitzContainerClose')
      effects.enter('blitzContainerSequence')
      return sequence(code)
    }

    function sequence(code: Code): State | undefined {
      if (code === COLON) {
        effects.consume(code)
        size++
        return sequence
      }
      if (size < 3) return nok(code)
      effects.exit('blitzContainerSequence')
      return factorySpace(effects, end, 'whitespace')(code)
    }

    function end(code: Code): State | undefined {
      if (code === null || markdownLineEnding(code)) {
        effects.exit('blitzContainerClose')
        return ok(code)
      }
      return nok(code)
    }
  }
}
