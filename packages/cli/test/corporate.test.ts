/**
 * The public corporate example (PLAN §15, M9.5) is what `theme import` makes
 * of the generated Kestrel Transit template, byte for byte. After changing
 * the template or the importer: `pnpm build && node scripts/corporate.mjs`.
 */
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { corporate } from '../../../scripts/corporate.mjs'

const example = fileURLToPath(new URL('../../../examples/corporate/', import.meta.url))
const files = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)))
    .filter((f) => f === 'kestrel.potx' || f.startsWith('brand/'))
    .sort()

it("examples/corporate holds the generated template and the theme imported from it (else: node scripts/corporate.mjs)", async () => {
  const fresh = mkdtempSync(join(tmpdir(), 'blitz-corporate-check-'))
  await corporate(fresh)
  expect(files(example)).toEqual(files(fresh))
  for (const f of files(fresh)) expect(readFileSync(join(example, f)).equals(readFileSync(join(fresh, f))), f).toBe(true)
})
