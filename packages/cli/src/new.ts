/**
 * `blitzstrahl new` (PLAN §15, M8.2): a starter deck to edit or delete, with
 * the data file its chart reads. Like every command that writes, it never
 * replaces anything: if either file is there, it writes neither.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, relative, resolve } from 'node:path'
import { CliError } from './errors.js'

export interface NewOptions {
  /** The deck's `theme:`, as written. Default `aurora`. */
  theme?: string
}

export interface NewResult {
  deck: string
  data: string
}

const STARTER = new URL('../starter/', import.meta.url)
const show = (path: string) => relative(process.cwd(), path) || path

/** A YAML scalar: plain when it can be, quoted otherwise. */
const scalar = (s: string) => (/^(\.{1,2}\/)?\w[\w./-]*$/.test(s) ? s : JSON.stringify(s))

export async function newDeck(path = 'talk.md', options: NewOptions = {}): Promise<NewResult> {
  if (!/\.(md|markdown)$/i.test(path)) throw new CliError(`a deck is a .md file: \`blitzstrahl new ${path}.md\``)
  const deck = resolve(path)
  const data = resolve(dirname(deck), `${basename(deck, extname(deck))}-data.csv`)
  const taken = [deck, data].filter((f) => existsSync(f))
  if (taken.length) {
    throw new CliError(`${taken.map(show).join(' and ')} ${taken.length === 1 ? 'is' : 'are'} already there; nothing was written (name another deck: \`blitzstrahl new other.md\`)`)
  }
  const theme = options.theme?.trim() || 'aurora'
  const text = (await readFile(new URL('talk.md', STARTER), 'utf8')).replaceAll('{{data}}', basename(data)).replaceAll('{{theme}}', scalar(theme))
  await mkdir(dirname(deck), { recursive: true })
  // `wx`: should a file appear between the check and the write, fail rather than replace it.
  await writeFile(data, await readFile(new URL('data.csv', STARTER)), { flag: 'wx' })
  await writeFile(deck, text, { flag: 'wx' })
  return { deck, data }
}
