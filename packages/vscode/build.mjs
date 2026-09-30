// The extension as one CommonJS file (VS Code loads it with require), plus
// what the .vsix carries beside it: the schemas (completion when a project's
// blitzstrahl can't be read) and the licence.
import { copyFileSync, cpSync, mkdirSync } from 'node:fs'
import { build } from 'esbuild'

const here = (p) => new URL(p, import.meta.url)
await build({
  entryPoints: [here('src/extension.ts').pathname],
  outfile: here('dist/extension.cjs').pathname,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'warning',
})
mkdirSync(here('schema'), { recursive: true })
cpSync(here('../cli/schema'), here('schema'), { recursive: true })
copyFileSync(here('../../LICENSE'), here('LICENSE'))
