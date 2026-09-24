/** `blitzstrahl build`: static output (PLAN §6, `--static`). */
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative, resolve } from 'node:path'
import { build as viteBuild, type Rolldown } from 'vite'
import type { Diagnostic } from '@blitzstrahl/core'
import { renderPage, resolveTheme } from './html.js'
import { loadDeck } from './load.js'
import { checkBuiltOverflow } from './overflow.js'
import { hasErrors, printDiagnostics } from './report.js'
import { ENTRY, cacheDir } from './vite.js'

export interface BuildOptions {
  outDir?: string
  /** Build even when the deck has errors. */
  force?: boolean
  quiet?: boolean
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
  printDiagnostics(loaded.diagnostics)
  const outDir = resolve(options.outDir ?? join(loaded.dir, 'dist'))
  if (hasErrors(loaded.diagnostics) && !options.force) {
    return { ok: false, outDir, overflow: [] }
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
    entry: `./${entry.fileName}`,
    assetUrl: (p) => urls.get(p) ?? p,
  })
  const index = join(outDir, 'index.html')
  await writeFile(index, html)

  const wanted = options.strict || (options.overflowCheck ?? !envSkipsCheck())
  if (!wanted) return { ok: true, outDir, index, overflow: [] }
  if (options.strict && options.overflowCheck !== true && envSkipsCheck()) {
    process.stderr.write(`blitzstrahl: --strict checks overflow even though ${SKIP_OVERFLOW_ENV} is set\n`)
  }
  const check = await checkBuiltOverflow(outDir, loaded.deck, loaded.source)
  printDiagnostics(check.diagnostics)
  if (check.skipped) process.stderr.write(`blitzstrahl: overflow not checked: ${check.skipped}\n`)
  const failed = !!options.strict && (check.diagnostics.length > 0 || check.skipped !== undefined)
  const out: BuildResult = { ok: !failed, outDir, index, overflow: check.diagnostics }
  if (check.skipped) out.overflowSkipped = check.skipped
  return out
}
