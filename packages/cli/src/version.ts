import { readFileSync } from 'node:fs'

/** blitzstrahl's version, from its package.json. */
export const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version
