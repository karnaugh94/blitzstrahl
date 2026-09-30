/**
 * Which blitzstrahl to run, and with which Node (README, *Settings*): the
 * project's own, never one of ours. Node, but no VS Code.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export interface Cli {
  /** The package's `bin.js`. */
  bin: string
  version: string
  /** The package's folder: its `schema/` is there. */
  root: string
}

/** The oldest blitzstrahl the extension works with: `check --stdin`, `/_blitz/slides`, `blitzstrahl:`. */
export const OLDEST = '1.1.0'

/**
 * blitzstrahl as installed for the deck in `dir`: `node_modules/blitzstrahl`
 * in it or a folder above, or `cliPath` (a `bin.js`) when set.
 */
export function findCli(dir: string, cliPath?: string): Cli | undefined {
  if (cliPath) {
    const bin = resolve(dir, cliPath)
    if (!existsSync(bin)) return undefined
    // bin.js sits in dist/, next to the package.json.
    for (let root = dirname(bin); root !== dirname(root); root = dirname(root)) {
      const pkg = join(root, 'package.json')
      if (existsSync(pkg)) return { bin, root, version: readPackage(pkg).version ?? '0.0.0' }
    }
    return { bin, root: dirname(bin), version: '0.0.0' }
  }
  for (let at = resolve(dir); ; at = dirname(at)) {
    const root = join(at, 'node_modules', 'blitzstrahl')
    const pkg = join(root, 'package.json')
    if (existsSync(pkg)) {
      const p = readPackage(pkg)
      const bin = typeof p.bin === 'string' ? p.bin : p.bin?.blitzstrahl
      if (bin) return { bin: join(root, bin), root, version: p.version ?? '0.0.0' }
    }
    if (at === dirname(at)) return undefined
  }
}

function readPackage(file: string): { version?: string; bin?: string | Record<string, string> } {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

/** Whether `version` is at least `oldest`; a pre-release counts as its release (`1.1.0-rc.1` is 1.1.0). */
export function atLeast(version: string, oldest = OLDEST): boolean {
  const parts = (v: string) => v.split('-')[0]!.split('.').map((n) => Number(n) || 0)
  const [a, b] = [parts(version), parts(oldest)]
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return true
}

/**
 * The Node to run blitzstrahl with: `nodePath`, or the one inside VS Code
 * (its own executable, run as Node), which needs no `PATH`.
 */
export function nodeCommand(nodePath: string | undefined, env: NodeJS.ProcessEnv = process.env): { command: string; env: NodeJS.ProcessEnv } {
  if (nodePath) return { command: nodePath, env: { ...env } }
  return { command: process.execPath, env: { ...env, ELECTRON_RUN_AS_NODE: '1' } }
}
