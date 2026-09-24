/**
 * Golden-file parser tests: `fixtures/<name>.md` → `fixtures/<name>.ir.json`.
 *
 * The JSON holds the IR and the diagnostics. Review diffs to it like code.
 * Regenerate after an intended change with `pnpm test -u`.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseDeck } from '../src/index.js'

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

describe('golden: markdown → IR', () => {
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    it(name, async () => {
      const result = parseDeck(readFileSync(join(dir, name), 'utf8'), { file: name })
      await expect(JSON.stringify(result, null, 2) + '\n').toMatchFileSnapshot(
        join(dir, name.replace(/\.md$/, '.ir.json')),
      )
    })
  }
})
