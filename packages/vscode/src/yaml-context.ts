/**
 * Where a deck holds YAML (syntax.md §2.2–2.3, §8): the deck frontmatter,
 * slide frontmatter, and the bodies of `chart`, `map` and `embed` blocks.
 * Read line by line, as far as completion needs, never as the parser does.
 * Pure: no VS Code.
 */
import { frontmatterLines } from './decks.js'

export type YamlKind = 'deck' | 'slide' | 'chart' | 'map' | 'embed'

export interface YamlBlock {
  kind: YamlKind
  /** 0-based lines, `[start, end)`. */
  start: number
  end: number
}

const SEPARATOR = /^ {0,3}-{3,}[ \t]*$/
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s{`]*)/
const CONTAINER_OPEN = /^ {0,3}:{3,}[ \t]*[^\s:]/
const CONTAINER_CLOSE = /^ {0,3}:{3,}[ \t]*$/
const KEY_LINE = /^[A-Za-z_][\w-]*[ \t]*:/
/** A line a YAML mapping may hold: a top-level key, something indented, a comment, or nothing. */
const YAMLISH = /^([A-Za-z_][\w-]*[ \t]*:|[ \t]|#|$)/
const RENDERERS: ReadonlySet<string> = new Set(['chart', 'map', 'embed'])
/** syntax.md §3.2, as core's vocab.ts has them (a test keeps the two equal). */
export const SLIDE_KEYS: readonly string[] = ['id', 'layout', 'transition', 'transition-dur', 'background', 'class', 'style', 'chrome']

/** Every YAML block in the deck, in order. */
export function yamlBlocks(lines: readonly string[]): YamlBlock[] {
  const blocks: YamlBlock[] = []
  let i = 0
  const fm = frontmatterLines(lines)
  if (fm) {
    blocks.push({ kind: 'deck', start: fm[0], end: fm[1] })
    // Its closing `---` is a separator (§2.3), already dealt with here.
    i = slideFrontmatter(lines, fm[1], blocks) + 1
  }
  let depth = 0
  for (; i < lines.length; i++) {
    const line = lines[i]!
    const fence = FENCE.exec(line)
    if (fence) {
      const [, mark] = fence
      const close = new RegExp(`^ {0,3}${mark![0] === '`' ? '`' : '~'}{${mark!.length},}[ \\t]*$`)
      let j = i + 1
      while (j < lines.length && !close.test(lines[j]!)) j++
      const lang = fence[2]!.toLowerCase()
      if (RENDERERS.has(lang)) blocks.push({ kind: lang as YamlKind, start: i + 1, end: j })
      i = j
      continue
    }
    if (CONTAINER_OPEN.test(line)) depth++
    else if (CONTAINER_CLOSE.test(line)) depth = Math.max(0, depth - 1)
    else if (depth === 0 && SEPARATOR.test(line)) i = slideFrontmatter(lines, i, blocks)
  }
  return blocks
}

/**
 * After the separator at `sep`: a slide frontmatter block, if the next line
 * is a key, every line up to the next separator could be YAML, and one of
 * them sets a slide key (§2.3 rule 3). Returns the line to go on from (the
 * closing separator starts content, rule 4).
 */
function slideFrontmatter(lines: readonly string[], sep: number, blocks: YamlBlock[]): number {
  if (!KEY_LINE.test(lines[sep + 1] ?? '')) return sep
  let j = sep + 1
  while (j < lines.length && !SEPARATOR.test(lines[j]!)) {
    if (!YAMLISH.test(lines[j]!)) return sep
    j++
  }
  if (j >= lines.length) return sep
  if (!lines.slice(sep + 1, j).some((l) => SLIDE_KEYS.includes(KEY_LINE.exec(l)?.[0].replace(/[ \t]*:$/, '') ?? ''))) return sep
  blocks.push({ kind: 'slide', start: sep + 1, end: j })
  return j
}

export type Completing =
  | { kind: YamlKind; want: 'key'; prefix: string; present: string[] }
  | { kind: YamlKind; want: 'value'; key: string; prefix: string }

/**
 * What the cursor at (`line`, `character`) is writing, if it's a top-level
 * key or its value in one of the deck's YAML blocks.
 */
export function completing(lines: readonly string[], line: number, character: number): Completing | undefined {
  const before = (lines[line] ?? '').slice(0, character)
  let block = yamlBlocks(lines).find((b) => line >= b.start && line < b.end)
  // A key being typed on the line after a separator: slide frontmatter to be.
  if (!block && line > 0 && SEPARATOR.test(lines[line - 1]!) && /^[a-z-]*$/.test(before) && !inFence(lines, line)) {
    block = { kind: 'slide', start: line, end: line + 1 }
  }
  if (!block) return undefined
  const value = /^([A-Za-z_][\w-]*)[ \t]*:[ \t]*([^\s#]*)$/.exec(before)
  if (value) return { kind: block.kind, want: 'value', key: value[1]!, prefix: value[2]! }
  if (/^[\w-]*$/.test(before)) {
    const present = lines.slice(block.start, block.end).filter((_, n) => block.start + n !== line).map((l) => KEY_LINE.exec(l)?.[0].replace(/[ \t]*:$/, '')).filter((k): k is string => !!k)
    return { kind: block.kind, want: 'key', prefix: before, present }
  }
  return undefined
}

/** The top-level key written at the start of `line`, if the line is in a YAML block. */
export function keyAt(lines: readonly string[], line: number, character: number): { kind: YamlKind; key: string } | undefined {
  const block = yamlBlocks(lines).find((b) => line >= b.start && line < b.end)
  const m = block && /^([A-Za-z_][\w-]*)[ \t]*:/.exec(lines[line]!)
  return m && character <= m[1]!.length ? { kind: block.kind, key: m[1]! } : undefined
}

function inFence(lines: readonly string[], line: number): boolean {
  let open: RegExp | undefined
  for (let i = 0; i < line; i++) {
    if (open) {
      if (open.test(lines[i]!)) open = undefined
      continue
    }
    const f = FENCE.exec(lines[i]!)
    if (f) open = new RegExp(`^ {0,3}${f[1]![0] === '`' ? '`' : '~'}{${f[1]!.length},}[ \\t]*$`)
  }
  return !!open
}
