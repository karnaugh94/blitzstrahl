/**
 * Read a deck from disk: load its theme and plugins, parse, check assets
 * exist, inline data files, highlight code, render math.
 * The only place the CLI touches the deck's files.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { EFFECTS, parseDeck, type Deck, type Diagnostic, type Extensions, type PayloadPlugins } from '@blitzstrahl/core'
import { loadExtras, pluginCss, pluginPayload, toExtensions, type Extras } from './extend.js'
import { highlightDeck } from './highlight.js'
import { renderMath } from './math.js'

export interface LoadedDeck {
  path: string
  dir: string
  deck: Deck
  /** The markdown, as read. */
  source: string
  diagnostics: Diagnostic[]
  /** Data asset text by deck-relative path (payload `inline`). */
  inline: Record<string, string>
  /** Absolute paths of every local asset, for watching and copying. */
  files: Map<string, string>
  /** The theme and what the deck's plugins add. */
  extras: Extras
  /** What plugins put in the page's payload. */
  plugins: PayloadPlugins
  /** CSS for plugin effects, after the theme's. */
  css: string
}

export async function loadDeck(path: string, displayName = path): Promise<LoadedDeck> {
  const abs = resolve(path)
  const dir = dirname(abs)
  const source = await readFile(abs, 'utf8')
  // Parse once to find the theme and plugins, then again knowing what they add.
  const first = parseDeck(source, { file: displayName })
  const extras = await loadExtras(first.deck, dir, first.keySpans)
  const extensions = toExtensions(extras)
  const css = cssEffects(extras.theme.stylesheet + '\n' + deckStyles(source))
  if (css.length) extensions.effects = { ...Object.fromEntries(css.map((n) => [n, 'entrance' as const])), ...extensions.effects }
  const { deck, diagnostics, keySpans } = hasAny(extensions) ? parseDeck(source, { file: displayName, extensions }) : first
  diagnostics.push(...extras.diagnostics)
  const plugins = pluginPayload(extras, deck, keySpans)
  diagnostics.push(...plugins.diagnostics)
  const inline: Record<string, string> = {}
  const files = new Map<string, string>()
  const reported = new Set<string>()

  for (const asset of deck.assets) {
    const file = resolve(dir, asset.path)
    files.set(asset.path, file)
    if (!existsSync(file)) {
      if (reported.has(asset.path)) continue
      reported.add(asset.path)
      diagnostics.push({
        severity: asset.kind === 'data' ? 'error' : 'warning',
        code: 'asset/missing',
        message: `\`${asset.ref}\` not found (looked for ${file})`,
        file: displayName,
        span: asset.span,
      })
      continue
    }
    if (asset.kind === 'data' && !(asset.path in inline)) inline[asset.path] = await readFile(file, 'utf8')
  }
  for (const block of deck.slides.flatMap((s) => s.blocks)) {
    const r = extras.renderers[block.renderer]
    if (!r?.check) continue
    let problem: string | undefined
    try {
      problem = await r.check(block.spec, { readData: (p) => inline[p] })
    } catch (err) {
      problem = `check failed: ${(err as Error).message}`
    }
    if (problem) diagnostics.push({ severity: 'error', code: `renderer/${block.renderer}`, message: `\`${block.renderer}\` block: ${problem}`, file: displayName, span: block.span })
  }
  diagnostics.push(...(await highlightDeck(deck, source)))
  diagnostics.push(...renderMath(deck, source))
  diagnostics.sort((a, b) => a.span.start.line - b.span.start.line || a.span.start.column - b.span.start.column)
  return { path: abs, dir, deck, source, diagnostics, inline, files, extras, plugins: plugins.payload, css: pluginCss(extras) }
}

/** The CSS of the deck's own `<style>` elements. */
export function deckStyles(source: string): string {
  return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n')
}

/** Custom entrance effects defined in CSS as `@keyframes blitz-<name>` (syntax.md §6.3). */
export function cssEffects(css: string): string[] {
  const names = [...css.matchAll(/@keyframes\s+blitz-([a-z][a-z0-9-]*)/g)].map((m) => m[1]!)
  return [...new Set(names)].filter((n) => !Object.hasOwn(EFFECTS, n))
}

function hasAny(e: Extensions): boolean {
  return !!(Object.keys(e.renderers ?? {}).length || Object.keys(e.effects ?? {}).length || e.keys?.length)
}
