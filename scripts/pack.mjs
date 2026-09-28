// Pack the one npm package, `blitzstrahl` (decisions.md: one package, the
// internals bundled in). Stages `.pack/blitzstrahl/`: the CLI's files, plus
// the workspace packages as bundled dependencies under
// node_modules/@blitzstrahl/*, so every import resolves exactly as it does
// in the repo. Third-party dependencies of all of them become the package's
// own. Then `npm pack` writes `.pack/blitzstrahl-<version>.tgz`.
//
// Usage: pnpm build && node scripts/pack.mjs
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, '.pack')
const stage = join(out, 'blitzstrahl')
const INTERNAL = ['core', 'runtime', 'renderers', 'themes']
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const cli = read(join(root, 'packages/cli/package.json'))
const version = cli.version

if (!existsSync(join(root, 'packages/cli/dist/bin.js'))) throw new Error('run `pnpm build` first')
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })

/** Copy a package's shippable files, and its sources (EUPL: the source travels with the work). */
function copyPackage(from, to, extra = []) {
  for (const f of ['dist', 'src', 'client', 'fonts', 'starter', 'schema', ...extra]) {
    if (existsSync(join(from, f))) cpSync(join(from, f), join(to, f), { recursive: true, filter: (p) => !p.endsWith('.tsbuildinfo') })
  }
  cpSync(join(root, 'LICENSE'), join(to, 'LICENSE'))
}

const deps = {}
const addDeps = (d = {}) => {
  for (const [name, range] of Object.entries(d)) {
    if (name.startsWith('@blitzstrahl/')) continue
    if (deps[name] && deps[name] !== range) throw new Error(`${name}: ${deps[name]} vs ${range}`)
    deps[name] = range
  }
}
addDeps(cli.dependencies)

for (const name of INTERNAL) {
  const dir = join(root, 'packages', name)
  const pkg = read(join(dir, 'package.json'))
  addDeps(pkg.dependencies)
  const to = join(stage, 'node_modules/@blitzstrahl', name)
  mkdirSync(to, { recursive: true })
  copyPackage(dir, to)
  delete pkg.private
  delete pkg.devDependencies
  pkg.version = version
  pkg.license = 'EUPL-1.2'
  pkg.dependencies = Object.fromEntries(Object.entries(pkg.dependencies ?? {}).map(([n, r]) => [n, n.startsWith('@blitzstrahl/') ? version : r]))
  pkg.files = [...(pkg.files ?? ['dist']), 'src', 'LICENSE']
  writeFileSync(join(to, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
}

copyPackage(join(root, 'packages/cli'), stage)
cpSync(join(root, 'README.md'), join(stage, 'README.md'))
cpSync(join(root, 'CHANGELOG.md'), join(stage, 'CHANGELOG.md'))
// The user docs the README links to. Never decisions.md or STATUS.md: those are local notes.
for (const doc of ['syntax.md', 'cli.md', 'presenting.md', 'plugins.md', 'themes.md', 'renderers']) {
  cpSync(join(root, 'docs', doc), join(stage, 'docs', doc), { recursive: true })
}

const pub = (n) => ({ types: `./dist/${n}.d.ts`, default: `./dist/${n}.js` })
const bundled = INTERNAL.map((n) => `@blitzstrahl/${n}`)
const pkg = {
  name: 'blitzstrahl',
  version,
  description: 'Markdown in, a deck worth watching out: interactive HTML slide decks with real charts, maps, motion and a presenter view.',
  keywords: ['slides', 'presentation', 'markdown', 'deck', 'charts', 'echarts', 'presenter'],
  license: 'EUPL-1.2',
  type: 'module',
  engines: { node: '>=22' },
  bin: { blitzstrahl: './dist/bin.js' },
  // Public entry points (docs/plugins.md §4). Everything else is internal.
  exports: {
    './plugin': pub('plugin'),
    './theme': pub('theme'),
    './renderer': pub('renderer'),
    // JSON Schemas for editors (syntax.md §3.5).
    './schema/*': './schema/*',
    './package.json': './package.json',
  },
  files: ['dist', 'src', 'client', 'starter', 'schema', 'docs', 'README.md', 'CHANGELOG.md', 'LICENSE', 'node_modules/@blitzstrahl'],
  dependencies: { ...Object.fromEntries(Object.entries(deps).sort()), ...Object.fromEntries(bundled.map((n) => [n, version])) },
  bundleDependencies: bundled,
}
writeFileSync(join(stage, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')

const tgz = execFileSync('npm', ['pack', '--pack-destination', out], { cwd: stage, encoding: 'utf8' }).trim().split('\n').pop()
process.stdout.write(`${join(out, tgz)}\n`)
