/**
 * The `{...}` attribute grammar (syntax.md §4.1).
 *
 * Pure string → tokens. Used by the micromark tokenizer (to decide whether a
 * `{...}` is an attribute block at all) and by the transforms (to read it).
 */

export type StepSpec =
  | { kind: 'abs'; in: number; out?: number }
  | { kind: 'next' }
  | { kind: 'same' }

export interface AttrPair {
  key: string
  value: string
  /** Offset of the key within the block's inner text. */
  offset: number
}

export interface AttrError {
  code: string
  message: string
  /** Offset within the block's inner text. */
  offset: number
}

export interface Attrs {
  classes: string[]
  id?: string
  step?: StepSpec
  pairs: AttrPair[]
}

export interface AttrParse {
  attrs: Attrs
  /**
   * Number of recognisable tokens (well-formed, or a mistyped `@step`). Zero
   * means "not an attribute block".
   */
  valid: number
  errors: AttrError[]
}

const NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/
const STEP = /^@(?:(\+)|(=)|(\d+)(?:-(\d+))?)$/

/**
 * Parse the text *between* the braces of an attribute block.
 *
 * Never throws. `valid === 0` means the braces are literal text (§4.1: "a
 * `{...}` whose contents contain no valid token is literal text").
 */
export function parseAttrs(inner: string): AttrParse {
  const attrs: Attrs = { classes: [], pairs: [] }
  const errors: AttrError[] = []
  let valid = 0
  let i = 0

  while (i < inner.length) {
    while (i < inner.length && isSpace(inner[i]!)) i++
    if (i >= inner.length) break
    const start = i

    // key=value, where value may be quoted and contain spaces.
    const eq = /^([A-Za-z][A-Za-z0-9_-]*)=/.exec(inner.slice(i))
    if (eq) {
      i += eq[0].length
      const q = inner[i]
      let value: string
      if (q === '"' || q === "'") {
        const r = readQuoted(inner, i)
        if (!r) {
          errors.push({ code: 'attr/unterminated-quote', message: `unterminated ${q} in value of \`${eq[1]}\``, offset: i })
          break
        }
        value = r.value
        i = r.end
        if (i < inner.length && !isSpace(inner[i]!)) {
          const end = skipToken(inner, i)
          errors.push({ code: 'attr/bad-token', message: `unexpected \`${inner.slice(i, end)}\` after quoted value`, offset: i })
          i = end
          continue
        }
      } else {
        const end = skipToken(inner, i)
        value = inner.slice(i, end)
        i = end
        if (value === '') {
          errors.push({ code: 'attr/empty-value', message: `\`${eq[1]}=\` has no value`, offset: start })
          continue
        }
      }
      attrs.pairs.push({ key: eq[1]!, value, offset: start })
      valid++
      continue
    }

    const end = skipToken(inner, i)
    const tok = inner.slice(start, end)
    i = end

    if (tok[0] === '.' && NAME.test(tok.slice(1))) {
      attrs.classes.push(tok.slice(1))
      valid++
    } else if (tok[0] === '#' && NAME.test(tok.slice(1))) {
      valid++
      if (attrs.id !== undefined) {
        errors.push({ code: 'attr/duplicate-id', message: `second id \`${tok}\`: an element has at most one`, offset: start })
      } else {
        attrs.id = tok.slice(1)
      }
    } else if (tok[0] === '@') {
      const step = parseStep(tok)
      if (typeof step === 'string') {
        errors.push({ code: 'attr/bad-step', message: step, offset: start })
        // `{@4-2}` is a typo, not prose: report it rather than print it.
        if (/^@[\d+=]/.test(tok)) valid++
        continue
      }
      valid++
      if (attrs.step !== undefined) {
        errors.push({ code: 'attr/duplicate-step', message: `second step \`${tok}\`: an element has at most one`, offset: start })
      } else {
        attrs.step = step
      }
    } else {
      errors.push({ code: 'attr/unknown-token', message: unknownTokenMessage(tok), offset: start })
    }
  }

  return { attrs, valid, errors }
}

function parseStep(tok: string): StepSpec | string {
  const m = STEP.exec(tok)
  if (!m) return `invalid step \`${tok}\`: expected @n, @n-m, @+ or @=`
  if (m[1]) return { kind: 'next' }
  if (m[2]) return { kind: 'same' }
  const from = Number(m[3])
  if (m[4] === undefined) return { kind: 'abs', in: from }
  const to = Number(m[4])
  if (to < from) return `invalid step range \`${tok}\`: ends before it starts`
  return { kind: 'abs', in: from, out: to }
}

function unknownTokenMessage(tok: string): string {
  if (NAME.test(tok)) return `unknown token \`${tok}\`: did you mean \`.${tok}\`?`
  return `unknown token \`${tok}\``
}

function readQuoted(s: string, at: number): { value: string; end: number } | undefined {
  const q = s[at]
  let out = ''
  for (let i = at + 1; i < s.length; i++) {
    const c = s[i]!
    if (c === '\\' && (s[i + 1] === q || s[i + 1] === '\\')) {
      out += s[i + 1]
      i++
    } else if (c === q) {
      return { value: out, end: i + 1 }
    } else {
      out += c
    }
  }
  return undefined
}

function skipToken(s: string, at: number): number {
  let i = at
  while (i < s.length && !isSpace(s[i]!)) {
    const c = s[i]!
    if (c === '"' || c === "'") {
      const r = readQuoted(s, i)
      i = r ? r.end : s.length
    } else {
      i++
    }
  }
  return i
}

function isSpace(c: string): boolean {
  return c === ' ' || c === '\t'
}

/**
 * Given a string starting at `{`, return the index just past the matching `}`
 * (quotes respected), or -1. Line endings end the search: attribute blocks
 * are single-line.
 */
export function scanAttrBlock(s: string, at = 0): number {
  if (s[at] !== '{') return -1
  let quote: string | undefined
  for (let i = at + 1; i < s.length; i++) {
    const c = s[i]!
    if (c === '\n' || c === '\r') return -1
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = undefined
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === '}') {
      return i + 1
    }
  }
  return -1
}
