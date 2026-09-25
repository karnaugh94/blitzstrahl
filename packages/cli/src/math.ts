/**
 * Math (syntax.md §12), rendered with KaTeX at build time, like code
 * highlighting: the page ships KaTeX's HTML (with MathML for screen
 * readers), its stylesheet and the fonts, and no TeX engine.
 *
 * The parser leaves each formula as `.math.math-inline` / `.math-display`
 * holding the TeX as text; this replaces that text with KaTeX's output.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Element, ElementContent } from 'hast'
import katex from 'katex'
import type { Deck, Diagnostic, HastNode } from '@blitzstrahl/core'
import { packageDir } from './vite.js'

function mathElements(nodes: HastNode[], out: Element[] = []): Element[] {
  for (const n of nodes) {
    if (n.type !== 'element') continue
    const cls = n.properties.className
    if (Array.isArray(cls) && cls.includes('math')) out.push(n)
    else mathElements(n.children, out)
  }
  return out
}

export function hasMath(deck: Deck): boolean {
  return deck.slides.some((s) => mathElements(s.content).length > 0 || mathElements(s.notes).length > 0)
}

/**
 * Render every formula in the deck's slides and notes, in place. TeX that
 * KaTeX can't parse is shown as KaTeX shows it (the source, in red) and
 * reported, at its first occurrence in `source`.
 */
export function renderMath(deck: Deck, source: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  for (const el of deck.slides.flatMap((s) => [...mathElements(s.content), ...mathElements(s.notes)])) {
    const tex = el.children.map((c) => (c.type === 'text' ? c.value : '')).join('')
    const displayMode = (el.properties.className as string[]).includes('math-display')
    let html: string
    try {
      html = katex.renderToString(tex, { displayMode, throwOnError: true })
    } catch (err) {
      const message = err instanceof Error ? err.message.replace(/^KaTeX parse error: /, '') : String(err)
      diagnostics.push(problem(deck, source, tex, message))
      html = katex.renderToString(tex, { displayMode, throwOnError: false })
    }
    el.children = [{ type: 'raw', value: html } as unknown as ElementContent]
  }
  return diagnostics
}

function problem(deck: Deck, source: string, tex: string, message: string): Diagnostic {
  const at = source.indexOf(tex)
  const before = at < 0 ? '' : source.slice(0, at)
  const line = before.split('\n').length
  const point = { line, column: at < 0 ? 1 : at - before.lastIndexOf('\n') }
  return { severity: 'warning', code: 'math/tex', message: `math can't be rendered: ${message}`, file: deck.source, span: { start: point, end: point } }
}

/**
 * KaTeX's stylesheet, with only the woff2 fonts (every browser that runs a
 * deck reads woff2), at the URLs `fontUrl` gives. With `deck`, only the font
 * families its math uses are kept: what a standalone file inlines.
 */
export async function mathCss(fontUrl: (file: string) => string | Promise<string>, deck?: Deck): Promise<string> {
  let css = await readFile(join(katexDir(), 'dist', 'katex.min.css'), 'utf8')
  if (deck) {
    const used = usedFamilies(css, mathClasses(deck))
    css = css.replace(/@font-face\{[^}]*font-family:KaTeX_(\w+)[^}]*\}/g, (face, family: string) => (used.has(family) ? face : ''))
  }
  const fonts = new Map<string, string>()
  for (const file of new Set(css.match(/KaTeX_[\w-]+\.woff2/g))) fonts.set(file, await fontUrl(file))
  return css.replace(/src:url\(fonts\/(KaTeX_[\w-]+\.woff2)\) format\("woff2"\)[^;}]*/g, (_, file: string) => `src:url(${fonts.get(file)}) format("woff2")`)
}

/** Class names in the deck's rendered math. */
function mathClasses(deck: Deck): Set<string> {
  const classes = new Set<string>()
  for (const el of deck.slides.flatMap((s) => [...mathElements(s.content), ...mathElements(s.notes)])) {
    for (const c of el.children) {
      const html = (c as { value?: string }).value ?? ''
      for (const m of html.matchAll(/class="([^"]*)"/g)) for (const name of m[1]!.split(/\s+/)) classes.add(name)
    }
  }
  return classes
}

/**
 * The KaTeX font families that `classes` call for, read off KaTeX's own
 * rules: a rule's family is used when every class in one of its selectors
 * is (`.katex` itself always is).
 */
export function usedFamilies(css: string, classes: ReadonlySet<string>): Set<string> {
  const used = new Set<string>()
  const rules = css.replace(/@font-face\{[^}]*\}/g, '')
  for (const [, selectors, body] of rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const family = /font(?:-family)?:[^;}]*?KaTeX_(\w+)/.exec(body!)?.[1]
    if (!family || used.has(family)) continue
    const hit = selectors!.split(',').some((sel) => (sel.match(/\.[\w-]+/g) ?? []).every((c) => c === '.katex' || classes.has(c.slice(1))))
    if (hit) used.add(family)
  }
  return used
}

/** Absolute path of one of KaTeX's font files. */
export function mathFont(file: string): string {
  return join(katexDir(), 'dist', 'fonts', file)
}

function katexDir(): string {
  return packageDir(fileURLToPath(import.meta.url), 'katex')
}
