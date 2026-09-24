/** `blitzstrahl build`: static output (PLAN §6, `--static`). */
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative, resolve } from 'node:path'
import { build as viteBuild, type Rolldown } from 'vite'
import { renderPage, resolveTheme } from './html.js'
import { loadDeck } from './load.js'
import { hasErrors, printDiagnostics } from './report.js'
import { ENTRY, cacheDir } from './vite.js'

export interface BuildOptions {
  outDir?: string
  /** Build even when the deck has errors. */
  force?: boolean
  quiet?: boolean
}

export interface BuildResult {
  ok: boolean
  outDir: string
  index?: string
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
    return { ok: false, outDir }
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
  return { ok: true, outDir, index }
}
