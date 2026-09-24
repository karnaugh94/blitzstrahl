/** `blitzstrahl build`: static output (PLAN §6, `--static`). */
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { build as viteBuild, type Rolldown } from 'vite'
import type { Deck, Diagnostic } from '@blitzstrahl/core'
import { renderPage, resolveTheme } from './html.js'
import { loadDeck, type LoadedDeck } from './load.js'
import { checkBuiltOverflow } from './overflow.js'
import { hasErrors, printDiagnostics } from './report.js'
import { bundleStandalone, dataUri, inlineSafe, usedRenderers } from './standalone.js'
import { ENTRY, cacheDir } from './vite.js'

export interface BuildOptions {
  /** Static build: the folder to write. Default `dist/` next to the deck. */
  outDir?: string
  /** Write one self-contained `.html` that runs from `file://` (PLAN §6). */
  standalone?: boolean
  /** Standalone: the file to write. Default: the deck's name with `.html`, next to it. */
  outFile?: string
  /** Build even when the deck has errors. */
  force?: boolean
  quiet?: boolean
  /** Print the deck's diagnostics (default true). `check` reports them itself. */
  report?: boolean
  /** Fail when a slide overflows, or when overflow can't be checked. */
  strict?: boolean
  /**
   * Measure the built slides for overflow in a headless browser. Default:
   * on, unless `BLITZSTRAHL_SKIP_OVERFLOW_CHECK` is set. `strict` always checks.
   */
  overflowCheck?: boolean
}

/** Env var that turns the build-time overflow check off. */
export const SKIP_OVERFLOW_ENV = 'BLITZSTRAHL_SKIP_OVERFLOW_CHECK'

function envSkipsCheck(): boolean {
  const v = process.env[SKIP_OVERFLOW_ENV]?.trim().toLowerCase()
  return !!v && !['0', 'false', 'no', 'off'].includes(v)
}

export interface BuildResult {
  ok: boolean
  /** The deck's diagnostics (printed unless `report: false`), not counting overflow. */
  diagnostics: Diagnostic[]
  outDir: string
  index?: string
  /** Overflow warnings found in the built slides. */
  overflow: Diagnostic[]
  /** Set when the overflow check couldn't run. */
  overflowSkipped?: string
}

export async function build(deckPath: string, options: BuildOptions = {}): Promise<BuildResult> {
  const loaded = await loadDeck(deckPath, relative(process.cwd(), resolve(deckPath)) || deckPath)
  const { theme, warning } = resolveTheme(loaded.deck.meta.theme)
  if (warning) {
    loaded.diagnostics.push({ severity: 'warning', code: 'theme/unknown', message: warning, file: loaded.deck.source, span: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } } })
  }
  if (options.standalone) loaded.diagnostics.push(...networkNotes(loaded.deck))
  if (options.report !== false) printDiagnostics(loaded.diagnostics)
  const outFile = options.standalone ? resolve(options.outFile ?? join(loaded.dir, `${basename(loaded.path, extname(loaded.path))}.html`)) : undefined
  const outDir = outFile ? dirname(outFile) : resolve(options.outDir ?? join(loaded.dir, 'dist'))
  if (hasErrors(loaded.diagnostics) && !options.force) {
    return { ok: false, outDir, overflow: [], diagnostics: loaded.diagnostics }
  }

  if (outFile) {
    const code = await bundleStandalone(loaded.dir, cacheDir(loaded.dir), usedRenderers(loaded.deck), options.quiet)
    const uris = new Map<string, string>()
    for (const asset of loaded.deck.assets) {
      const file = loaded.files.get(asset.path)
      if (asset.kind === 'data' || uris.has(asset.path) || !file) continue
      const uri = await dataUri(file)
      if (uri) uris.set(asset.path, uri)
    }
    const html = renderPage({ deck: loaded.deck, inline: loaded.inline, theme, entry: { code: inlineSafe(code) }, assetUrl: (p) => uris.get(p) ?? p })
    await mkdir(outDir, { recursive: true })
    await writeFile(outFile, html)
    const size = Buffer.byteLength(html)
    if (!options.quiet) process.stdout.write(`${relative(process.cwd(), outFile) || outFile}: ${formatSize(size)}\n`)
    if (size > STANDALONE_WARN_BYTES) {
      process.stderr.write(`blitzstrahl: ${basename(outFile)} is ${formatSize(size)}; large images are the usual cause (they're inlined as data)\n`)
    }
    return checkOverflow({ outDir, index: outFile, page: basename(outFile) }, loaded, options)
  }

  const result = await viteBuild({
    configFile: false,
    root: loaded.dir,
    cacheDir: cacheDir(loaded.dir),
    publicDir: false,
    logLevel: options.quiet ? 'silent' : 'warn',
    build: {
      outDir,
      emptyOutDir: true,
      assetsDir: 'assets',
      target: 'es2022',
      // ECharts is one lazy chunk by design; don't warn about it.
      chunkSizeWarningLimit: 1024,
      modulePreload: { polyfill: false },
      rolldownOptions: { input: { deck: ENTRY } },
    },
  })
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[]
  const entry = outputs.flatMap((o) => o.output).find((c) => c.type === 'chunk' && c.isEntry)
  if (!entry) throw new Error('vite produced no entry chunk')

  // Copy local images next to the chunks, content-hashed like them.
  const urls = new Map<string, string>()
  await mkdir(join(outDir, 'assets'), { recursive: true })
  for (const asset of loaded.deck.assets) {
    if (asset.kind === 'data' || urls.has(asset.path)) continue
    const src = loaded.files.get(asset.path)
    if (!src) continue
    let bytes: Buffer
    try {
      bytes = await readFile(src)
    } catch {
      continue // reported as asset/missing
    }
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8)
    const ext = extname(src)
    const name = `assets/${basename(src, ext)}-${hash}${ext}`
    await copyFile(src, join(outDir, name))
    urls.set(asset.path, name)
  }

  const html = renderPage({
    deck: loaded.deck,
    inline: loaded.inline,
    theme,
    entry: { src: `./${entry.fileName}` },
    assetUrl: (p) => urls.get(p) ?? p,
  })
  const index = join(outDir, 'index.html')
  await writeFile(index, html)
  return checkOverflow({ outDir, index, page: '' }, loaded, options)
}

/** A standalone file that's bigger than this gets a warning. */
export const STANDALONE_WARN_BYTES = 8 * 1024 * 1024

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} kB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** A standalone file still needs the network for tiles and embeds: say where. */
function networkNotes(deck: Deck): Diagnostic[] {
  const blocks = deck.slides.flatMap((s) => s.blocks)
  const notes: Diagnostic[] = []
  const tiled = blocks.find((b) => b.renderer === 'map' && (b.spec as { tiles?: unknown } | null)?.tiles !== 'none')
  if (tiled) notes.push(info('standalone/network', "this map's street tiles load from the network, even in a standalone file (`tiles: none` draws without them)", tiled.span))
  const embed = blocks.find((b) => b.renderer === 'embed')
  if (embed) notes.push(info('standalone/network', 'embedded pages load from the network, even in a standalone file (`fallback:` covers being offline)', embed.span))
  return notes

  function info(code: string, message: string, span: Diagnostic['span']): Diagnostic {
    return { severity: 'info', code, message, file: deck.source, span }
  }
}

async function checkOverflow(
  built: { outDir: string; index: string; page: string },
  loaded: LoadedDeck,
  options: BuildOptions,
): Promise<BuildResult> {
  const { outDir, index } = built
  const wanted = options.strict || (options.overflowCheck ?? !envSkipsCheck())
  if (!wanted) return { ok: true, outDir, index, overflow: [], diagnostics: loaded.diagnostics }
  if (options.strict && options.overflowCheck !== true && envSkipsCheck()) {
    process.stderr.write(`blitzstrahl: --strict checks overflow even though ${SKIP_OVERFLOW_ENV} is set\n`)
  }
  const check = await checkBuiltOverflow(outDir, loaded.deck, loaded.source, built.page)
  printDiagnostics(check.diagnostics)
  if (check.skipped) process.stderr.write(`blitzstrahl: overflow not checked: ${check.skipped}\n`)
  const failed = !!options.strict && (check.diagnostics.length > 0 || check.skipped !== undefined)
  const out: BuildResult = { ok: !failed, outDir, index, overflow: check.diagnostics, diagnostics: loaded.diagnostics }
  if (check.skipped) out.overflowSkipped = check.skipped
  return out
}
