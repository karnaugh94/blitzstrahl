/** Vite settings shared by `build` and `dev`. */
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The browser entry shipped with this package. */
export const ENTRY = fileURLToPath(new URL('../client/entry.js', import.meta.url))

/** Root directory of package `name`, as resolved from `fromFile`. */
export function packageDir(fromFile: string, name: string): string {
  let dir = dirname(createRequire(fromFile).resolve(name))
  for (;;) {
    try {
      if ((JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: string }).name === name) {
        return realpathSync(dir)
      }
    } catch {
      // no package.json at this level
    }
    const up = dirname(dir)
    if (up === dir) throw new Error(`cannot locate package ${name}`)
    dir = up
  }
}

/**
 * Directories the dev server may serve from besides the deck's own: this
 * package's client entry, the runtime and renderer packages, and their deps.
 */
export function servedDirs(): string[] {
  const here = fileURLToPath(import.meta.url)
  const renderers = packageDir(here, '@blitzstrahl/renderers')
  return [
    realpathSync(dirname(ENTRY)),
    packageDir(here, '@blitzstrahl/runtime'),
    renderers,
    packageDir(here, '@blitzstrahl/core'),
    packageDir(join(renderers, 'package.json'), 'echarts'),
    // KaTeX's fonts (math.ts).
    packageDir(here, 'katex'),
  ]
}

/** Per-deck Vite cache outside the deck's directory (never litter the user's folder). */
export function cacheDir(deckDir: string): string {
  const key = createHash('sha1').update(deckDir).digest('hex').slice(0, 12)
  return join(tmpdir(), 'blitzstrahl', `vite-${key}`)
}
