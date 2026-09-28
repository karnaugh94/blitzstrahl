/**
 * `blitzstrahl dev`: Vite dev server. Saving the markdown (or a data file it
 * uses) pushes the rebuilt deck over HMR, and the runtime swaps it in while
 * keeping the current slide and step (PLAN §7).
 */
import { createReadStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { createServer, type Plugin, type ViteDevServer } from 'vite'
import { toPayload } from '@blitzstrahl/core'
import type { Overflow } from '@blitzstrahl/runtime/overflow-report'
import { fontCss } from './extend.js'
import { renderNotes, renderPage, renderStage } from './html.js'
import { loadDeck, type LoadedDeck } from './load.js'
import { overflowDiagnostics } from './overflow.js'
import { printDiagnostics, summary } from './report.js'
import { inPublic, publicFile } from './public.js'
import { mathCss, mathFont } from './math.js'
import { mimeType } from './mime.js'
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

export async function dev(deckPath: string, options: DevOptions = {}): Promise<ViteDevServer> {
  const abs = resolve(deckPath)
  const display = relative(process.cwd(), abs) || abs
  // Local themes and plugins are imported through Vite's SSR loader, which
  // tracks their imports and drops them when they change. Node's own import
  // cache never forgets a module, so in 1.0 an edit needed a restart. That's
  // why the deck loads only once the server exists.
  let server: ViteDevServer
  let loaded: LoadedDeck
  /** Files in the `public` folder keep their path; the rest go through /_blitz/asset/. */
  const assetUrl = (path: string) => (inPublic(loaded.publicDir && loaded.deck.meta.public, path) ? path : ASSET_PREFIX + encodeURIComponent(path))
  const load = async () => {
    const l = await loadDeck(abs, display, { importModule: (file) => server.ssrLoadModule(file) })
    printDiagnostics(l.diagnostics)
    return l
  }

  /** Loaders for every renderer the deck could use: a save can add any. */
  const renderersModule = () => {
    const map = Object.entries(allRenderers(loaded.extras.renderers)).map(([r, file]) => `${JSON.stringify(r)}: () => import(${JSON.stringify(file)})`)
    return `export default { ${map.join(', ')} }\n`
  }
  // The deck's files are reachable only through /_blitz/asset/, and only
  // those the deck uses (PLAN §15, M6.2): its folder isn't in `fs.allow`,
  // which Vite's static serving obeys too. Vite's root is an empty folder of
  // our own, so Vite doesn't watch the deck's folder recursively either (a
  // deck at ~/talk.md would have it watching the whole home directory).
  const root = join(cacheDir(dirname(abs)), 'root')
  await mkdir(root, { recursive: true })

  const plugin: Plugin = {
    name: 'blitzstrahl:dev',
    resolveId: (id) => (id === RENDERERS_ID ? `\0${RENDERERS_ID}` : undefined),
    load: (id) => (id === `\0${RENDERERS_ID}` ? renderersModule() : undefined),
    configureServer(s) {
      s.middlewares.use(async (req, res, next) => {
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
          res.end(await s.transformIndexHtml(url, page))
          return
        }
        const pub = loaded.publicDir && loaded.deck.meta.public
        if (pub && url.startsWith(`/${pub}/`)) {
          let rel: string
          try {
            rel = decodeURIComponent(url.slice(pub.length + 2))
          } catch {
            rel = ''
          }
          const file = publicFile(loaded.publicDir!, rel)
          if (!file) {
            res.statusCode = 404
            res.end()
            return
          }
          res.setHeader('content-type', mimeType(file))
          createReadStream(file).pipe(res)
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
          res.setHeader('content-type', mimeType(file))
          stream.pipe(res)
          return
        }
        next()
      })
    },
  }

  server = await createServer({
    configFile: false,
    root,
    cacheDir: cacheDir(dirname(abs)),
    publicDir: false,
    appType: 'custom',
    plugins: [plugin],
    optimizeDeps: { entries: [ENTRY] },
    server: {
      ...(options.port !== undefined ? { port: options.port } : {}),
      ...(options.host !== undefined ? { host: options.host } : {}),
      open: options.open ?? false,
      fs: { allow: [...servedDirs(), cacheDir(dirname(abs))] },
    },
  })
  loaded = await load()

  /** Plugins' browser modules and theme fonts, once the deck says which. */
  const allowServed = () => {
    const allow = server.config.server.fs.allow
    for (const file of loaded.extras.served) if (!allow.includes(file)) allow.push(file)
  }
  allowServed()
  const watched = () => new Set([abs, ...loaded.files.values()])
  server.watcher.add([...watched()])
  /** The local themes and plugins (and what they import) the SSR loader holds. */
  const ssr = server.environments.ssr.moduleGraph
  const isModule = (file: string) => (ssr.getModulesByFile(file)?.size ?? 0) > 0

  let timer: NodeJS.Timeout | undefined
  let modulesChanged = false
  const reload = () => {
    clearTimeout(timer)
    timer = setTimeout(async () => {
      const before = loaded
      const forceFull = modulesChanged
      modulesChanged = false
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
      if (forceFull || m.theme !== b.theme || m.lang !== b.lang || String(m.plugins) !== String(b.plugins) || loaded.css !== before.css) {
        // A theme or plugin changed: new CSS, fonts or renderer modules, and files to serve them from.
        allowServed()
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
  const onFile = (changed: string) => {
    const file = resolve(changed)
    if (isModule(file)) {
      // Vite's own watcher has already dropped the module and what imports it,
      // so the reload (30 ms on) reads the edit.
      modulesChanged = true
      reload()
    } else if (watched().has(file)) reload()
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

  await server.listen()
  return server
}
