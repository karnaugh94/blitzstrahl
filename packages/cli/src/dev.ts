/**
 * `blitzstrahl dev`: Vite dev server. Saving the markdown (or a data file it
 * uses) pushes the rebuilt deck over HMR, and the runtime swaps it in while
 * keeping the current slide and step (PLAN §7).
 */
import { createReadStream } from 'node:fs'
import { dirname, extname, relative, resolve } from 'node:path'
import { createServer, type Plugin, type ViteDevServer } from 'vite'
import { toPayload } from '@blitzstrahl/core'
import type { Overflow } from '@blitzstrahl/runtime/overflow-report'
import { fontCss } from './extend.js'
import { renderNotes, renderPage, renderStage } from './html.js'
import { loadDeck, type LoadedDeck } from './load.js'
import { overflowDiagnostics } from './overflow.js'
import { printDiagnostics, summary } from './report.js'
import { mathCss, mathFont } from './math.js'
import { allRenderers } from './standalone.js'
import { ENTRY, cacheDir, servedDirs } from './vite.js'

export interface DevOptions {
  port?: number
  host?: string | boolean
  open?: boolean
}

const ASSET_PREFIX = '/_blitz/asset/'
const RENDERERS_ID = 'virtual:blitzstrahl-renderers'
const fsUrl = (file: string) => '/@fs/' + file.replace(/^\//, '')
const assetUrl = (path: string) => ASSET_PREFIX + encodeURIComponent(path)

const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.csv': 'text/csv; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.json': 'application/json',
}

export async function dev(deckPath: string, options: DevOptions = {}): Promise<ViteDevServer> {
  const abs = resolve(deckPath)
  const display = relative(process.cwd(), abs) || abs
  const load = async () => {
    const l = await loadDeck(abs, display)
    printDiagnostics(l.diagnostics)
    return l
  }
  let loaded: LoadedDeck = await load()

  /** Loaders for every renderer the deck could use: a save can add any. */
  const renderersModule = () => {
    const map = Object.entries(allRenderers(loaded.extras.renderers)).map(([r, file]) => `${JSON.stringify(r)}: () => import(${JSON.stringify(file)})`)
    return `export default { ${map.join(', ')} }\n`
  }
  const allowed = () => [dirname(abs), ...servedDirs(), cacheDir(dirname(abs)), ...loaded.extras.dirs]

  const plugin: Plugin = {
    name: 'blitzstrahl:dev',
    resolveId: (id) => (id === RENDERERS_ID ? `\0${RENDERERS_ID}` : undefined),
    load: (id) => (id === `\0${RENDERERS_ID}` ? renderersModule() : undefined),
    configureServer(server) {
      const watched = () => new Set([abs, ...loaded.files.values()])
      server.watcher.add([...watched()])

      let timer: NodeJS.Timeout | undefined
      const reload = () => {
        clearTimeout(timer)
        timer = setTimeout(async () => {
          const before = loaded
          try {
            loaded = await load()
          } catch (err) {
            server.config.logger.error(`[blitzstrahl] ${(err as Error).message}`)
            return
          }
          server.watcher.add([...watched()])
          server.config.logger.info(`[blitzstrahl] ${display} rebuilt: ${summary(loaded.diagnostics)}`, { timestamp: true })
          const m = loaded.deck.meta
          const b = before.deck.meta
          if (m.theme !== b.theme || m.lang !== b.lang || String(m.plugins) !== String(b.plugins) || loaded.css !== before.css) {
            // New plugins: new renderer modules, and folders to serve them from.
            for (const dir of loaded.extras.dirs) if (!server.config.server.fs.allow.includes(dir)) server.config.server.fs.allow.push(dir)
            const mod = server.moduleGraph.getModuleById(`\0${RENDERERS_ID}`)
            if (mod) server.moduleGraph.invalidateModule(mod)
            server.ws.send({ type: 'full-reload' })
            return
          }
          server.ws.send({
            type: 'custom',
            event: 'blitz:update',
            data: {
              payload: toPayload(loaded.deck, loaded.inline, assetUrl, loaded.plugins),
              stage: renderStage(loaded.deck, assetUrl),
              notes: renderNotes(loaded.deck, assetUrl),
              diagnostics: loaded.diagnostics,
            },
          })
        }, 30)
      }
      const onFile = (file: string) => {
        if (watched().has(resolve(file))) reload()
      }
      server.watcher.on('change', onFile)
      server.watcher.on('add', onFile)

      // The browser measures overflow (it's the only place with layout) and
      // reports back; print it here, at file:line:col, when it changes.
      let lastOverflow = ''
      server.ws.on('blitz:overflow', (found: Overflow[]) => {
        const diags = overflowDiagnostics(loaded.deck, found, loaded.source)
        const key = JSON.stringify(diags)
        if (key === lastOverflow) return
        lastOverflow = key
        if (diags.length) printDiagnostics(diags)
        else server.config.logger.info('[blitzstrahl] no slide overflows', { timestamp: true })
      })

      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? '/').split('?')[0]!
        if (url === '/' || url === '/index.html') {
          const page = renderPage({
            deck: loaded.deck,
            inline: loaded.inline,
            theme: loaded.extras.theme,
            assetUrl,
            entry: { src: fsUrl(ENTRY) },
            diagnostics: loaded.diagnostics,
            plugins: loaded.plugins,
            css: [
              await fontCss(loaded.extras.fonts, fsUrl),
              loaded.css,
              // Always: math can appear on any save, and the fonts only load when used.
              await mathCss((file) => fsUrl(mathFont(file))),
            ].join('\n'),
          })
          res.setHeader('content-type', 'text/html; charset=utf-8')
          res.end(await server.transformIndexHtml(url, page))
          return
        }
        if (url.startsWith(ASSET_PREFIX)) {
          const file = loaded.files.get(decodeURIComponent(url.slice(ASSET_PREFIX.length)))
          if (!file) {
            res.statusCode = 404
            res.end()
            return
          }
          const stream = createReadStream(file)
          stream.on('error', () => {
            res.statusCode = 404
            res.end()
          })
          res.setHeader('content-type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream')
          stream.pipe(res)
          return
        }
        next()
      })
    },
  }

  const server = await createServer({
    configFile: false,
    root: dirname(abs),
    cacheDir: cacheDir(dirname(abs)),
    publicDir: false,
    appType: 'custom',
    plugins: [plugin],
    optimizeDeps: { entries: [ENTRY] },
    server: {
      ...(options.port !== undefined ? { port: options.port } : {}),
      ...(options.host !== undefined ? { host: options.host } : {}),
      open: options.open ?? false,
      fs: { allow: allowed() },
    },
  })
  await server.listen()
  return server
}
