// The public corporate example's theme (examples/corporate; PLAN §15, M9.5):
// the Kestrel Transit template (scripts/potx.mjs), and the theme
// `blitzstrahl theme import` makes of it. Run after `pnpm build` when the
// template or the importer changes; `corporate.test.ts` fails until you do.
//
//   node scripts/corporate.mjs
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeTemplate } from './potx.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Write the template and its imported theme into `dir` (template.potx, brand/). */
export async function corporate(dir) {
  const { importTheme } = await import(join(root, 'packages/cli/dist/import.js'))
  writeFileSync(join(dir, 'kestrel.potx'), makeTemplate())
  const tmp = mkdtempSync(join(tmpdir(), 'blitz-corporate-'))
  // Imported from the committed file's name, so brand.css says where it came from.
  writeFileSync(join(tmp, 'kestrel.potx'), makeTemplate())
  await importTheme(join(tmp, 'kestrel.potx'), { out: join(tmp, 'brand') })
  rmSync(join(dir, 'brand'), { recursive: true, force: true })
  cpSync(join(tmp, 'brand'), join(dir, 'brand'), { recursive: true, filter: (src) => !src.endsWith('sample.md') })
  rmSync(tmp, { recursive: true, force: true })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await corporate(join(root, 'examples', 'corporate'))
  process.stdout.write('wrote examples/corporate/kestrel.potx and examples/corporate/brand/\n')
}
