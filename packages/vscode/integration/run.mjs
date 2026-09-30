// The extension, end to end in a real editor (M13's exit: "installs from a
// .vsix and shows a deck's diagnostics and preview"). Local only: it opens
// an editor window. Needs `pnpm build` (the CLI) and VSCodium or VS Code:
//   node packages/vscode/integration/run.mjs [path/to/codium]
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const pkg = join(here, '..')
const cliBin = join(pkg, '..', 'cli', 'dist', 'bin.js')
if (!existsSync(cliBin)) throw new Error('run `pnpm build` first')
// The launcher, not the binary inside: a snap's binary run bare has no sandbox.
const args = process.argv.slice(2)
/** `--screenshot out.png`: the window with the preview open (X11 or XWayland, ImageMagick's `import`). */
const shotAt = args.indexOf('--screenshot')
const screenshot = shotAt >= 0 ? args.splice(shotAt, 2)[1] : undefined
const editor = args[0] ?? ['/snap/bin/codium', '/usr/bin/codium', '/snap/bin/code', '/usr/bin/code'].find(existsSync)
if (!editor) throw new Error('no VSCodium or VS Code found: pass its executable')

const tmp = mkdtempSync(join(tmpdir(), 'blitz-vscode-it-'))
const vsix = join(tmp, 'blitzstrahl.vsix')
execFileSync('pnpm', ['build'], { cwd: pkg, stdio: 'inherit' })
execFileSync('npx', ['vsce', 'package', '--no-dependencies', '--out', vsix], { cwd: pkg, stdio: 'inherit' })

const extensions = join(tmp, 'extensions')
const userData = join(tmp, 'user-data')
execFileSync(editor, ['--extensions-dir', extensions, '--user-data-dir', userData, '--install-extension', vsix], { stdio: 'inherit' })

// A deck whose line 9 has a step gap, a chart at 13–16, three slides; and a README.
const ws = join(tmp, 'workspace')
mkdirSync(join(ws, '.vscode'), { recursive: true })
writeFileSync(join(ws, 'talk.md'), ['---', 'blitzstrahl: 1.1', 'title: Test', '---', '', '# One', '', '---', '# Two {#two}', '', 'A {@1}', '', 'C {@3}', '```chart', 'type: bar', 'data: ./data.csv', 'x: a', 'y: b', '```', '---', '# Three {#three}', ''].join('\n'))
writeFileSync(join(ws, 'data.csv'), 'a,b\nx,1\ny,2\n')
writeFileSync(join(ws, 'README.md'), '# Not a deck\n\nSome text {@3}\n')
// The repository's CLI (1.0.1 until 1.1 is cut), so cliPath: it skips the version check.
writeFileSync(join(ws, '.vscode', 'settings.json'), JSON.stringify({ 'blitzstrahl.cliPath': cliBin, 'security.workspace.trust.enabled': false }))

const result = join(tmp, 'result.json')
const shot = join(tmp, 'shot')
if (screenshot) writeFileSync(shot, '')
const r = await run(editor, [
  ws,
  '--extensions-dir', extensions,
  '--user-data-dir', userData,
  '--extensionDevelopmentPath', join(here, 'runner'),
  '--extensionTestsPath', join(here, 'runner', 'suite.cjs'),
  '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--new-window', '--wait',
], { ...process.env, BLITZ_DECK: join(ws, 'talk.md'), BLITZ_README: join(ws, 'README.md'), BLITZ_RESULT: result, ...(screenshot ? { BLITZ_SHOT: shot } : {}) })
const out = existsSync(result) ? JSON.parse(readFileSync(result, 'utf8')) : { ok: false, error: `no result (exit ${r.status})` }
for (const s of out.done ?? []) console.log(`  ✓ ${s}`)
if (!out.ok) {
  console.error(`  ✗ ${out.error}`)
  process.exit(1)
}
console.log(`integration: ${out.done.length} checks passed (${readdirSync(extensions).filter((d) => d.startsWith('karnaugh94.')).join(', ')})`)

/** The editor, run until it exits; meanwhile, the screenshot when the suite is ready for it. */
function run(command, argv, env) {
  return new Promise((done) => {
    const child = spawn(command, argv, { stdio: 'inherit', env })
    const poll = screenshot
      ? setInterval(() => {
          if (readFileSync(shot, 'utf8') !== 'ready') return
          clearInterval(poll)
          setTimeout(() => {
            try {
              // The editor's own window: a Wayland session won't give the root window.
              const tree = execFileSync('xwininfo', ['-root', '-tree'], { encoding: 'utf8' })
              const id = /^\s+(0x[0-9a-f]+) "[^"]*talk\.md[^"]*":/im.exec(tree)?.[1]
              execFileSync('import', ['-window', id ?? 'root', screenshot])
            } catch (e) {
              console.error(`  (no screenshot: ${String(e.message).split('\n')[0]})`)
            }
            writeFileSync(shot, 'taken')
          }, 2500) // the deck's transition and chart animation
        }, 200)
      : undefined
    child.on('exit', (status) => {
      clearInterval(poll)
      done({ status })
    })
  })
}
