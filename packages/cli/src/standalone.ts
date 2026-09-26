/**
 * `blitzstrahl build --standalone` (PLAN §6): the whole deck in one `.html`
 * that runs from `file://`. A module script can't fetch chunks from a file
 * URL, so everything the page runs is one inline script: the runtime, the
 * presenter view, and only the renderers this deck uses. Images become data
 * URIs; data files are already inlined in the payload.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build as viteBuild, type Plugin, type Rolldown } from 'vite'
import { BUILTIN_RENDERERS } from '@blitzstrahl/renderers'
import type { Deck } from '@blitzstrahl/core'
import { mimeType } from './mime.js'

const ENTRY_ID = 'virtual:blitzstrahl-standalone'

/** Absolute path of a module, resolved from this package (not the deck's folder). */
const resolve = (spec: string) => fileURLToPath(import.meta.resolve(spec))

/** Renderer name → module, for a plugin renderer: its browser module's absolute path. */
export type RendererModules = Record<string, string>

/** The module of every renderer: built in, plus the deck's plugins'. */
export function allRenderers(plugins: Record<string, { browser: string }> = {}): RendererModules {
  return {
    ...Object.fromEntries(BUILTIN_RENDERERS.map((r) => [r, resolve(`@blitzstrahl/renderers/${r}`)])),
    ...Object.fromEntries(Object.entries(plugins).map(([n, p]) => [n, p.browser])),
  }
}

/** The renderers the deck actually uses, and their modules. */
export function usedRenderers(deck: Deck, plugins: Record<string, { browser: string }> = {}): RendererModules {
  const used = new Set(deck.slides.flatMap((s) => s.blocks.map((b) => b.renderer)))
  return Object.fromEntries(Object.entries(allRenderers(plugins)).filter(([r]) => used.has(r)))
}

/**
 * A static build's entry: `start()` with a lazy loader for each renderer the
 * deck uses, and none for the rest. (The dev server's entry, client/entry.js,
 * names them all, since a save can add any.) Without this, every deck would
 * bundle Mermaid's hundred-odd chunks.
 */
export function staticEntry(renderers: RendererModules): string {
  const map = Object.entries(renderers).map(([r, file]) => `${JSON.stringify(r)}: () => import(${JSON.stringify(file)})`).join(', ')
  return `import { start } from ${JSON.stringify(resolve('@blitzstrahl/runtime'))}\nstart({ renderers: { ${map} } })\n`
}

/** A Vite plugin serving `code` as the module `id`. */
export function virtualEntry(id: string, code: string): Plugin {
  return {
    name: `blitzstrahl:${id}`,
    resolveId: (spec) => (spec === id ? `\0${id}` : undefined),
    load: (spec) => (spec === `\0${id}` ? code : undefined),
  }
}

/** The standalone entry: `start()` with each used renderer imported statically. */
export function standaloneEntry(renderers: RendererModules): string {
  const lines = [`import { start } from ${JSON.stringify(resolve('@blitzstrahl/runtime'))}`]
  const files = Object.values(renderers)
  files.forEach((file, i) => lines.push(`import r${i} from ${JSON.stringify(file)}`))
  const map = Object.keys(renderers).map((r, i) => `${JSON.stringify(r)}: async () => r${i}`).join(', ')
  lines.push(`start({ renderers: { ${map} } })`)
  return lines.join('\n') + '\n'
}

/** Bundle the entry into a single ES module, in memory. */
export async function bundleStandalone(root: string, cacheDir: string, renderers: RendererModules, quiet = false): Promise<string> {
  const plugin = virtualEntry(ENTRY_ID, standaloneEntry(renderers))
  const result = await viteBuild({
    configFile: false,
    root,
    cacheDir,
    publicDir: false,
    logLevel: quiet ? 'silent' : 'warn',
    plugins: [plugin],
    build: {
      write: false,
      target: 'es2022',
      modulePreload: false,
      chunkSizeWarningLimit: 4096,
      rolldownOptions: { input: ENTRY_ID, output: { codeSplitting: false } },
    },
  })
  const chunks = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[]
  const code = chunks.flatMap((o) => o.output).filter((c) => c.type === 'chunk')
  if (code.length !== 1) throw new Error(`standalone bundle came out as ${code.length} chunks, not 1`)
  return (code[0] as Rolldown.OutputChunk).code
}

/**
 * Make script text safe to put between `<script>` tags. `</script` would end
 * the element, and `<!--` changes how the HTML parser reads what follows.
 * `\x3C` is `<` in a JS string, template literal or regex, which is the only
 * place these sequences can occur in module code.
 */
export function inlineSafe(code: string): string {
  return code.replace(/<(\/script|!--)/gi, '\\x3C$1')
}


/** A local file as a `data:` URI, or undefined if it can't be read. */
export async function dataUri(file: string): Promise<string | undefined> {
  try {
    const bytes = await readFile(file)
    return `data:${mimeType(file).replace(/;.*$/, '')};base64,${bytes.toString('base64')}`
  } catch {
    return undefined // reported as asset/missing
  }
}
