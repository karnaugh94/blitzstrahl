/**
 * Read a deck from disk: load its theme and plugins, parse, check assets
 * exist, inline data files, highlight code, render math.
 * The only place the CLI touches the deck's files.
 */
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { EFFECTS, parseDeck, type Deck, type Diagnostic, type Extensions, type PayloadPlugins, type SourceSpan } from '@blitzstrahl/core'
import { mermaidProblem, specNotes, specProblem } from '@blitzstrahl/renderers/specs'
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
  /** The `public:` folder, absolute, when the deck names one that's there (syntax.md §3.5). */
  publicDir?: string
  /** Where each deck frontmatter key was written. */
  keySpans: Record<string, SourceSpan>
}

export interface LoadOptions {
  /**
   * Imports a local theme or plugin module by its file path. Default: Node's
   * `import()`. `dev` passes Vite's SSR loader, which picks up edits.
   */
  importModule?: (file: string) => Promise<unknown>
}

export async function loadDeck(path: string, displayName = path, options: LoadOptions = {}): Promise<LoadedDeck> {
  const abs = resolve(path)
  const dir = dirname(abs)
  const source = await readFile(abs, 'utf8')
  // Parse once to find the theme and plugins, then again knowing what they add.
  const first = parseDeck(source, { file: displayName })
  const extras = await loadExtras(first.deck, dir, first.keySpans, options.importModule)
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
  // Every render block is checked the way its renderer would read it, built-in
  // or plugin, so `dev` lists a broken chart and `build` stops for it
  // (1.0 left built-in blocks to `check`, and shipped the error box).
  const read = (p: string) => inline[p]
  for (const block of deck.slides.flatMap((s) => s.blocks)) {
    const at = (severity: Diagnostic['severity'], code: string, message: string) =>
      diagnostics.push({ severity, code, message: `\`${block.renderer}\` block: ${message}`, file: displayName, span: block.span })
    const r = extras.renderers[block.renderer]
    if (r) {
      if (!r.check) continue
      let problem: string | undefined
      try {
        problem = await r.check(block.spec, { readData: read })
      } catch (err) {
        problem = `check failed: ${(err as Error).message}`
      }
      if (problem) at('error', `renderer/${block.renderer}`, problem)
      continue
    }
    const problem = block.renderer === 'mermaid' ? await mermaidProblem(block.spec) : specProblem(block.renderer, block.spec, read, deck.meta)
    if (problem) at('error', `renderer/${block.renderer}`, problem)
    else for (const note of specNotes(block.renderer, block.spec, read, deck.meta)) at('info', `renderer/${block.renderer}-note`, note)
  }
  let publicDir: string | undefined
  if (deck.meta.public !== undefined) {
    const folder = resolve(dir, deck.meta.public)
    if (existsSync(folder) && statSync(folder).isDirectory()) publicDir = folder
    else diagnostics.push({ severity: 'error', code: 'public/missing', message: `the \`public\` folder isn't there (looked for ${folder})`, file: displayName, span: keySpans.public ?? spanOfDeck })
  }
  diagnostics.push(...(await highlightDeck(deck, source)))
  diagnostics.push(...renderMath(deck, source))
  diagnostics.sort((a, b) => a.span.start.line - b.span.start.line || a.span.start.column - b.span.start.column)
  const out: LoadedDeck = { path: abs, dir, deck, source, diagnostics, inline, files, extras, plugins: plugins.payload, css: pluginCss(extras), keySpans }
  if (publicDir) out.publicDir = publicDir
  return out
}

const spanOfDeck: SourceSpan = { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } }

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
