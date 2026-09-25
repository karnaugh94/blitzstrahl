/**
 * Read a deck from disk: parse, check assets exist, inline data files,
 * highlight code, render math.
 * The only place the CLI touches the deck's files.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parseDeck, type Deck, type Diagnostic } from '@blitzstrahl/core'
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
}

export async function loadDeck(path: string, displayName = path): Promise<LoadedDeck> {
  const abs = resolve(path)
  const dir = dirname(abs)
  const source = await readFile(abs, 'utf8')
  const { deck, diagnostics } = parseDeck(source, { file: displayName })
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
  diagnostics.push(...(await highlightDeck(deck, source)))
  diagnostics.push(...renderMath(deck, source))
  diagnostics.sort((a, b) => a.span.start.line - b.span.start.line || a.span.start.column - b.span.start.column)
  return { path: abs, dir, deck, source, diagnostics, inline, files }
}
