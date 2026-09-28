/**
 * The deck's `public:` folder (syntax.md §3.5; PLAN §15, M8.5): served by
 * `dev` and copied into static builds as it is, at the same path. Only
 * what's really inside it goes: no dotfiles (`.git`, `.env`), and nothing a
 * symbolic link leads to outside it.
 */
import { realpathSync, statSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'

/** `path` (deck-relative, normalised) is in the public folder `pub`. */
export const inPublic = (pub: string | undefined, path: string) => pub !== undefined && (path === pub || path.startsWith(pub + '/'))

/** `inner` is `outer` or inside it. */
export function within(outer: string, inner: string): boolean {
  const rel = relative(outer, inner)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function real(path: string): string | undefined {
  try {
    return realpathSync(path)
  } catch {
    return undefined
  }
}

/** The file `rel` (slash-separated, from a URL) names in `dir`, if it may be served. */
export function publicFile(dir: string, rel: string): string | undefined {
  const parts = rel.split('/')
  if (parts.some((p) => p === '' || p.startsWith('.') || p.includes('\\'))) return undefined
  const root = real(dir)
  const file = real(join(dir, ...parts))
  if (!root || !file || file === root || !within(root, file)) return undefined
  try {
    return statSync(file).isFile() ? file : undefined
  } catch {
    return undefined
  }
}

/** Every file that may be served from `dir`, slash-separated and relative to it. */
export async function publicFiles(dir: string): Promise<string[]> {
  const root = real(dir)
  if (!root) return []
  const out: string[] = []
  // A link back up the tree would otherwise be walked forever.
  const seen = new Set([root])
  const walk = async (rel: string[]) => {
    for (const entry of await readdir(join(dir, ...rel))) {
      if (entry.startsWith('.')) continue
      const path = [...rel, entry]
      const file = real(join(dir, ...path))
      if (!file || !within(root, file)) continue
      const stat = statSync(file)
      if (stat.isDirectory()) {
        if (seen.has(file)) continue
        seen.add(file)
        await walk(path)
      } else if (stat.isFile()) out.push(path.join('/'))
    }
  }
  await walk([])
  return out.sort()
}
