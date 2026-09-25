/**
 * Syntax highlighting for code blocks (syntax.md §8), with shiki, at build
 * time: the page ships coloured spans and no highlighter.
 *
 * Colours are CSS variables (`--blitz-code-token-keyword`, …) that the theme
 * defines, so code always matches the deck. A theme without them shows plain
 * code, not broken code.
 *
 * Every block is split into `<span class="line">`s, plain code too, and
 * shiki's tokens are split further into words and punctuation, whitespace
 * left bare: `lines=` dims lines, and magic move (auto-animate) matches
 * tokens, so both need them fine-grained.
 *
 * Only the `<code>`'s children are replaced. The `<pre>` keeps its own
 * attributes (build steps, classes), and never gets shiki's `tabindex`,
 * which would make every code block swallow gutter clicks.
 */
import type { Element, ElementContent } from 'hast'
import { bundledLanguages, bundledLanguagesAlias, createCssVariablesTheme, createHighlighter, type BundledLanguage } from 'shiki'
import type { Deck, Diagnostic, HastNode } from '@blitzstrahl/core'

const THEME_NAME = 'blitzstrahl'
const THEME = createCssVariablesTheme({ name: THEME_NAME, variablePrefix: '--blitz-code-', fontStyle: true })

/** Languages that mean "no highlighting", not "unknown". */
const PLAIN = new Set(['text', 'txt', 'plain', 'plaintext'])

let highlighter: ReturnType<typeof createHighlighter> | undefined

/** One highlighter per process (dev rebuilds reuse it), loading languages as decks need them. */
async function load(langs: BundledLanguage[]) {
  const h = await (highlighter ??= createHighlighter({ themes: [THEME], langs: [] }))
  const missing = langs.filter((l) => !h.getLoadedLanguages().includes(l))
  if (missing.length) await h.loadLanguage(...missing)
  return h
}

function known(lang: string): lang is BundledLanguage {
  return lang in bundledLanguages || lang in bundledLanguagesAlias
}

interface CodeBlock {
  code: Element
  lang: string
}

function codeBlocks(nodes: HastNode[], out: CodeBlock[] = []): CodeBlock[] {
  for (const n of nodes) {
    if (n.type !== 'element') continue
    if (n.tagName === 'pre') {
      const code = n.children.find((c): c is Element => c.type === 'element' && c.tagName === 'code')
      const cls = code?.properties.className
      const lang = Array.isArray(cls) ? cls.map(String).find((c) => c.startsWith('language-'))?.slice(9) : undefined
      if (code) out.push({ code, lang: (lang ?? 'text').toLowerCase() })
      continue
    }
    codeBlocks(n.children, out)
  }
  return out
}

/**
 * Highlight every fenced code block in the deck's slides and notes, in
 * place. Returns a warning for each language shiki doesn't know, at its
 * first fence in `source`.
 */
export async function highlightDeck(deck: Deck, source: string): Promise<Diagnostic[]> {
  const blocks = deck.slides.flatMap((s) => [...codeBlocks(s.content), ...codeBlocks(s.notes)])
  const langs = new Set(blocks.map((b) => b.lang).filter((l) => !PLAIN.has(l)))
  const usable = [...langs].filter(known)
  const diagnostics = [...langs].filter((l) => !known(l)).map((l) => unknownLanguage(deck, source, l))
  if (!blocks.length) return diagnostics

  const h = await load(usable)
  for (const { code, lang } of blocks) {
    const text = textOf(code).replace(/\n$/, '')
    const root = h.codeToHast(text, { lang: known(lang) ? lang : 'text', theme: THEME_NAME })
    const pre = root.children[0] as Element
    const inner = pre.children[0] as Element
    code.children = inner.children.map((line) => (line.type === 'element' ? { ...line, children: line.children.flatMap(splitToken) } : line)) as ElementContent[]
  }
  return diagnostics
}

/** Words, numbers, and single punctuation marks; whitespace between them stays bare text. */
const PIECE = /\s+|[\p{L}\p{N}_$]+|[^\s\p{L}\p{N}_$]/gu

function splitToken(token: ElementContent): ElementContent[] {
  if (token.type !== 'element') return [token]
  const text = textOf(token)
  return (text.match(PIECE) ?? []).map((piece) =>
    /^\s/.test(piece) ? { type: 'text', value: piece } : { ...token, children: [{ type: 'text', value: piece }] },
  )
}

function textOf(node: ElementContent): string {
  if (node.type === 'text') return node.value
  if (node.type === 'element') return node.children.map(textOf).join('')
  return ''
}

function unknownLanguage(deck: Deck, source: string, lang: string): Diagnostic {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const fence = new RegExp(`^ {0,3}(\`{3,}|~{3,})\\s*${lang.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|\\{|$)`, 'i')
  const k = lines.findIndex((l) => fence.test(l))
  const point = { line: k + 1 || 1, column: 1 }
  return {
    severity: 'warning',
    code: 'code/unknown-language',
    message: `no syntax highlighting for \`${lang}\`; the block is shown as plain code`,
    file: deck.source,
    span: { start: point, end: point },
  }
}
