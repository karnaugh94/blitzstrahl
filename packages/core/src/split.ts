/**
 * Top-level structure: deck frontmatter, slide separators, slide frontmatter
 * (syntax.md §2), and cutting unclosed containers at the slide boundary (§5).
 */
import type { Root, RootContent } from 'mdast'
import { parseDocument, isMap } from 'yaml'
import type { SourcePoint, SourceSpan } from './ir.js'
import type { Diagnostics } from './diagnostics.js'
import type { BlitzContainer } from './syntax/index.js'
import { SLIDE_KEYS } from './vocab.js'

const SEPARATOR_LINE = /^ {0,3}-{3,}[ \t]*$/
/** A slide frontmatter candidate must start like a YAML mapping key. */
const FRONTMATTER_START = /^[A-Za-z_][A-Za-z0-9_-]*[ \t]*:([ \t]|$)/

export interface Frontmatter {
  data: Record<string, unknown>
  span: SourceSpan
  /** Where each top-level key is written, for diagnostics. */
  keys: Record<string, SourceSpan>
}

/** Span of a frontmatter key, falling back to the whole block. */
export function keySpan(fm: Frontmatter | undefined, key: string, fallback: SourceSpan): SourceSpan {
  return fm?.keys[key] ?? fm?.span ?? fallback
}

export interface RawSlide {
  nodes: RootContent[]
  frontmatter?: Frontmatter
  span: SourceSpan
}

export interface SplitResult {
  deckFrontmatter?: Frontmatter
  slides: RawSlide[]
}

export function splitSlides(root: Root, lines: string[], diags: Diagnostics): SplitResult {
  const isSeparator = (n: RootContent): boolean =>
    n.type === 'thematicBreak' && SEPARATOR_LINE.test(lines[n.position!.start.line - 1] ?? '')

  const children = root.children
  cutUnclosedContainers(children, isSeparator)

  let i = 0
  let boundary = 0
  let deckFrontmatter: Frontmatter | undefined
  const first = children[0]
  if (first?.type === 'yaml') {
    const start = first.position!.start.line + 1
    const parsed = parseYamlMapping(first.value, start, diags, 'deck')
    deckFrontmatter = {
      data: parsed?.data ?? {},
      keys: parsed?.keys ?? {},
      span: lineSpan(lines, start, first.position!.end.line - 1),
    }
    boundary = first.position!.end.line
    i = 1
  }

  const slides: RawSlide[] = []
  let pending: Frontmatter | undefined
  for (;;) {
    let j = i
    while (j < children.length && !isSeparator(children[j]!)) j++
    const group = children.slice(i, j)
    const terminated = j < children.length
    const nextSep = terminated ? children[j]!.position!.start.line : lines.length + 1

    if (
      !pending &&
      boundary > 0 &&
      terminated &&
      group[0]?.position!.start.line === boundary + 1 &&
      FRONTMATTER_START.test(lines[boundary] ?? '')
    ) {
      const text = lines.slice(boundary, nextSep - 1).join('\n')
      const read = readYamlMapping(text, boundary + 1)
      // Frontmatter sets something (§2.3): `Agenda:` over a list is a slide, not settings.
      if (read.ok && Object.keys(read.data).some((k) => SLIDE_KEYS.has(k))) {
        pending = { data: read.data, keys: read.keys, span: lineSpan(lines, boundary + 1, nextSep - 1) }
        boundary = nextSep
        i = j + 1
        continue
      }
      // It's the slide's content. Say so only where settings were probably meant.
      if (!read.ok) {
        const first = FRONTMATTER_START.exec(lines[boundary] ?? '')![0].replace(/[ \t]*:.*$/, '')
        if (SLIDE_KEYS.has(first) || nearSlideKey(first)) {
          diags.warn('frontmatter/yaml', `slide frontmatter is not valid YAML: ${read.message}; the block is shown as slide content`, { start: read.at, end: read.at })
        }
      } else {
        for (const [key, span] of Object.entries(read.keys)) {
          const near = nearSlideKey(key)
          if (near) diags.warn('frontmatter/near-key', `\`${key}\` isn't a slide setting, so this block is slide content: did you mean \`${near}\`?`, span)
        }
      }
    }

    const firstLine = boundary + 1
    const slide: RawSlide = { nodes: group, span: lineSpan(lines, firstLine, Math.max(firstLine, nextSep - 1)) }
    if (pending) slide.frontmatter = pending
    slides.push(slide)
    pending = undefined
    if (!terminated) break
    boundary = nextSep
    i = j + 1
  }

  // §2.1: drop leading and trailing empty slides; keep inner ones, with a note.
  const empty = (s: RawSlide) => s.nodes.length === 0 && !s.frontmatter
  while (slides.length && empty(slides[0]!)) slides.shift()
  while (slides.length && empty(slides[slides.length - 1]!)) slides.pop()
  for (const s of slides) {
    if (empty(s)) diags.info('slide/empty', 'empty slide', s.span)
  }

  const result: SplitResult = { slides }
  if (deckFrontmatter) result.deckFrontmatter = deckFrontmatter
  return result
}

/**
 * An unclosed container runs to the end of the document in micromark. Cut it
 * (and any unclosed containers nested at its end) at the first separator, and
 * hoist what follows back to the top level (§5: "a container never spans a
 * slide separator").
 */
function cutUnclosedContainers(children: RootContent[], isSeparator: (n: RootContent) => boolean) {
  const cut = (c: BlitzContainer): RootContent[] | undefined => {
    const kids = c.children as RootContent[]
    for (let k = 0; k < kids.length; k++) {
      const child = kids[k]!
      let rest: RootContent[] | undefined
      if (isSeparator(child)) rest = kids.splice(k)
      else if (child.type === 'blitzContainer' && !child.closed) rest = cut(child)
      if (rest) {
        const last = kids[kids.length - 1]
        if (last?.position && c.position) c.position.end = { ...last.position.end }
        return rest
      }
    }
    return undefined
  }
  for (let k = 0; k < children.length; k++) {
    const c = children[k]!
    if (c.type === 'blitzContainer' && !c.closed) {
      const rest = cut(c)
      if (rest) children.splice(k + 1, 0, ...rest)
    }
  }
}

type YamlRead =
  | { ok: true; data: Record<string, unknown>; keys: Record<string, SourceSpan> }
  | { ok: false; empty: boolean; message: string; at: SourcePoint }

/** Parse YAML that must be a mapping, without reporting anything. */
function readYamlMapping(text: string, firstLine: number): YamlRead {
  const doc = parseDocument(text, { prettyErrors: false })
  const err = doc.errors[0]
  if (err) {
    const lp = err.linePos?.[0]
    return { ok: false, empty: false, message: err.message.split('\n')[0]!, at: { line: firstLine + (lp ? lp.line - 1 : 0), column: lp?.col ?? 1 } }
  }
  if (!isMap(doc.contents)) {
    return { ok: false, empty: doc.contents === null, message: 'it must be a YAML mapping (key: value)', at: { line: firstLine, column: 1 } }
  }
  const keys: Record<string, SourceSpan> = {}
  for (const pair of doc.contents.items) {
    const key = pair.key as { value?: unknown; range?: [number, number, number] } | null
    if (!key?.range) continue
    const before = text.slice(0, key.range[0]).split('\n')
    const line = firstLine + before.length - 1
    const column = before[before.length - 1]!.length + 1
    keys[String(key.value)] = { start: { line, column }, end: { line, column: column + (key.range[1] - key.range[0]) } }
  }
  return { ok: true, data: doc.toJS() as Record<string, unknown>, keys }
}

/** Parse YAML that must be a mapping. Reports and returns undefined otherwise. */
export function parseYamlMapping(
  text: string,
  firstLine: number,
  diags: Diagnostics,
  what: 'deck' | 'slide',
): { data: Record<string, unknown>; keys: Record<string, SourceSpan> } | undefined {
  const read = readYamlMapping(text, firstLine)
  if (read.ok) return { data: read.data, keys: read.keys }
  if (read.empty && what === 'deck') return { data: {}, keys: {} }
  const code = read.message.startsWith('it must be') ? 'frontmatter/not-mapping' : 'frontmatter/yaml'
  const message = code === 'frontmatter/yaml' ? `${what} frontmatter is not valid YAML: ${read.message}` : `${what} frontmatter must be a YAML mapping (key: value)`
  diags.warn(code, message, { start: read.at, end: read.at })
  return undefined
}

/**
 * The slide key a lower-case key is a typo of (`layuot`, `transtion`), if
 * any. Capitalised words (`Background:`) are prose, not typos.
 */
function nearSlideKey(key: string): string | undefined {
  if (key !== key.toLowerCase() || SLIDE_KEYS.has(key)) return undefined
  return [...SLIDE_KEYS].find((k) => distance(key, k) <= (k.length > 4 ? 2 : 1))
}

function distance(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!
    d[0] = i
    for (let j = 1; j <= b.length; j++) {
      const t = d[j]!
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = t
    }
  }
  return d[b.length]!
}

function lineSpan(lines: string[], from: number, to: number): SourceSpan {
  return {
    start: { line: from, column: 1 },
    end: { line: to, column: (lines[to - 1]?.length ?? 0) + 1 },
  }
}
