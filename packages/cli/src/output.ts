/**
 * Where `build` and `export` may write (PLAN §15, M6.1). blitzstrahl never
 * deletes or overwrites what it didn't make: a static build removes only
 * the files its previous build listed in the folder's manifest, and refuses
 * any other folder that isn't empty. Checking and cleaning are separate, so
 * a build that stops early (the deck has errors) has touched nothing.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { readdir, rm, rmdir, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { CliError } from './errors.js'

/** The list of files a static build wrote, kept in its output folder. */
export const MANIFEST = '.blitzstrahl-build.json'

interface Manifest {
  generator: 'blitzstrahl'
  files: string[]
}

/** What a 1.0 build's `index.html` says about itself (1.0 wrote no manifest). */
const GENERATOR = '<meta name="generator" content="blitzstrahl">'

const show = (path: string) => relative(process.cwd(), path) || '.'

/** `outer` is `inner`, or one of its ancestors. */
function holds(outer: string, inner: string): boolean {
  const rel = relative(resolve(outer), resolve(inner))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Dotfiles (`.git`, `.nojekyll`) belong to whoever put them there, and are never touched. */
const ownEntries = (dir: string) => readdirSync(dir).filter((name) => !name.startsWith('.'))

function readManifest(dir: string): Manifest | undefined {
  try {
    const m = JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8')) as Partial<Manifest>
    return m.generator === 'blitzstrahl' && Array.isArray(m.files) && m.files.every((f) => typeof f === 'string') ? (m as Manifest) : undefined
  } catch {
    return undefined
  }
}

/** A folder a 1.0 build wrote: its own `index.html` and `assets/`, nothing else (dotfiles aside). */
function isOldBuild(dir: string): boolean {
  const names = ownEntries(dir)
  if (!names.includes('index.html') || !names.every((n) => n === 'index.html' || n === 'assets')) return false
  if (names.includes('assets') && !statSync(join(dir, 'assets')).isDirectory()) return false
  return madeByUs(join(dir, 'index.html'))
}

/** An HTML page blitzstrahl wrote. */
function madeByUs(file: string): boolean {
  try {
    return readFileSync(file, 'utf8').slice(0, 4096).includes(GENERATOR)
  } catch {
    return false
  }
}

/**
 * Throws unless a static build may write to `outDir`: not the deck's own
 * folder or one that contains it, and either missing, empty, or made by
 * blitzstrahl. Touches nothing.
 */
export function checkOutDir(outDir: string, deck: string): void {
  if (holds(outDir, dirname(deck))) {
    throw new CliError(`won't build into ${show(outDir)}: it holds the deck itself. Build into a folder of its own, such as the default dist/`)
  }
  if (!existsSync(outDir)) return
  if (!statSync(outDir).isDirectory()) throw new CliError(`can't build into ${show(outDir)}: it's a file, not a folder`)
  if (!ownEntries(outDir).length || readManifest(outDir) || isOldBuild(outDir)) return
  throw new CliError(`won't build into ${show(outDir)}: it isn't empty and blitzstrahl didn't make it, so nothing was changed. Build into a new or empty folder`)
}

/**
 * Remove what the previous build in `outDir` wrote, and nothing else. Call
 * only after `checkOutDir`, once the build is going ahead.
 */
export async function cleanOutDir(outDir: string): Promise<void> {
  if (!existsSync(outDir)) return
  const previous = readManifest(outDir)
  if (previous) {
    const dirs = new Set<string>()
    for (const f of previous.files) {
      const file = resolve(outDir, f)
      // A manifest names files inside its own folder; anything else isn't ours to delete.
      if (!holds(outDir, file) || file === resolve(outDir)) continue
      await rm(file, { force: true })
      for (let d = dirname(file); d !== resolve(outDir) && holds(outDir, d); d = dirname(d)) dirs.add(d)
    }
    // Folders the build made, deepest first, if they're empty now.
    for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
      if (existsSync(d) && (await readdir(d)).length === 0) await rmdir(d)
    }
    await rm(join(outDir, MANIFEST), { force: true })
  } else if (isOldBuild(outDir)) {
    await rm(join(outDir, 'index.html'), { force: true })
    await rm(join(outDir, 'assets'), { recursive: true, force: true })
  }
}

/** Record what a static build wrote (paths relative to `outDir`), so the next one can remove exactly that. */
export async function writeManifest(outDir: string, files: Iterable<string>): Promise<void> {
  const manifest: Manifest = { generator: 'blitzstrahl', files: [...new Set(files)].sort() }
  await writeFile(join(outDir, MANIFEST), JSON.stringify(manifest, null, 2) + '\n')
}

/**
 * Throws unless a single-file output may be written at `file`: never the
 * deck, always the right extension, and an existing `.html` only if
 * blitzstrahl wrote it. An existing PDF is replaced, as exporters do.
 */
export function checkOutFile(file: string, deck: string, kind: 'html' | 'pdf'): void {
  if (resolve(file) === resolve(deck)) throw new CliError(`won't write over the deck itself (${show(file)})`)
  const ext = extname(file).toLowerCase()
  if (kind === 'html' && ext !== '.html' && ext !== '.htm') {
    throw new CliError(`a standalone deck is an .html file, not ${show(file)}: use --out ${show(file.slice(0, file.length - ext.length))}.html`)
  }
  if (kind === 'pdf' && ext !== '.pdf') throw new CliError(`export writes a .pdf, not ${show(file)}`)
  if (!existsSync(file)) return
  if (statSync(file).isDirectory()) throw new CliError(`can't write ${show(file)}: it's a folder`)
  if (kind === 'html' && !madeByUs(file)) {
    throw new CliError(`won't overwrite ${show(file)}: blitzstrahl didn't make it. Delete it first, or choose another name with --out`)
  }
}
