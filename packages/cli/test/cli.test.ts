import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { newer } from '../src/load.js'

const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'blitz-cli-'))
writeFileSync(join(dir, 'talk.md'), '# Hello\n')

function run(...args: string[]) {
  return runWith(undefined, ...args)
}

function runWith(input: string | undefined, ...args: string[]) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd: dir, input, encoding: 'utf8', env: { ...process.env, BLITZSTRAHL_SKIP_OVERFLOW_CHECK: '1' } })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

describe('the command line (M6.12)', () => {
  it('says what went wrong in one line, exit code 2, never a stack trace', () => {
    const cases: Array<[string[], string]> = [
      [['build', 'talk.md', '--outt', 'x'], 'unknown option `--outt`: did you mean `--out`?'],
      [['buld', 'talk.md'], 'unknown command `buld`: did you mean `build`?'],
      [['build', 'tlak.md'], "can't find tlak.md: did you mean talk.md?"],
      [['build', '.'], '. is a folder: name the deck\'s .md file, e.g. talk.md'],
      [['build', 'talk.md', '--steps'], '`--steps` is an option of `export`, not `build`'],
      [['dev', 'talk.md', '--port', 'abc'], '`--port` must be a number from 0 to 65535'],
      [['export', 'talk.md', '--out'], '`--out` needs a value'],
      [['export', 'talk.md', '--steps', '--notes'], "--steps and --notes don't go together"],
      [['build'], 'which deck?'],
    ]
    for (const [args, message] of cases) {
      const r = run(...args)
      expect(r.code, args.join(' ')).toBe(2)
      expect(r.err, args.join(' ')).toContain(message)
      expect(r.err.trim().split('\n'), args.join(' ')).toHaveLength(1)
      expect(r.err, args.join(' ')).not.toMatch(/\n\s+at /)
    }
  })

  it('--version, and each command has its own --help', () => {
    expect(run('--version')).toMatchObject({ code: 0, out: expect.stringMatching(/^blitzstrahl \d+\.\d+\.\d+(-[\w.]+)?\n$/) })
    const help = run('export', '--help')
    expect(help.code).toBe(0)
    expect(help.out).toContain('Usage: blitzstrahl export <deck.md>')
    expect(help.out).not.toContain('--standalone')
  })

  it('a deck with errors exits 1: the deck, not the command line, is the problem', () => {
    writeFileSync(join(dir, 'broken.md'), '# A\n\nText {colour=red}\n')
    const r = run('build', 'broken.md')
    expect(r.code).toBe(1)
  })

  // Playwright finds no Chromium in an empty folder; an installed Chrome or Edge it would still find.
  const systemBrowser = ['/opt/google/chrome/chrome', '/opt/microsoft/msedge/msedge'].some((f) => existsSync(f))
  it.skipIf(systemBrowser)('export with no browser exits 2: setup, not the deck, is the problem', () => {
    const empty = mkdtempSync(join(tmpdir(), 'blitz-no-browser-'))
    const r = spawnSync(process.execPath, [BIN, 'export', 'talk.md'], { cwd: dir, encoding: 'utf8', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: empty } })
    expect(r.stderr).toContain("can't export: no browser to run it in")
    expect(r.status).toBe(2)
  })
})

describe('blitzstrahl new (M8.2)', () => {
  it('writes a starter deck and its data, which check finds nothing wrong with', () => {
    const r = run('new', 'intro/start.md', '--theme', 'broadsheet')
    expect(r.code, r.err).toBe(0)
    expect(r.out).toContain('npx blitzstrahl dev intro/start.md')
    const deck = readFileSync(join(dir, 'intro/start.md'), 'utf8')
    expect(deck).toContain('theme: broadsheet\n')
    expect(deck).toMatch(/^---\nblitzstrahl: \d+\.\d+\n/)
    expect(deck).toContain('data: ./start-data.csv\n')
    expect(existsSync(join(dir, 'intro/start-data.csv'))).toBe(true)
    const c = run('check', 'intro/start.md', '--offline')
    expect(c.code, c.err).toBe(0)
    expect(c.out).toContain('no problems found')
  })

  it('defaults to talk.md, and quotes a theme YAML would misread', () => {
    const sub = mkdtempSync(join(tmpdir(), 'blitz-new-'))
    const r = spawnSync(process.execPath, [BIN, 'new', '--theme', '@acme/theme'], { cwd: sub, encoding: 'utf8' })
    expect(r.status, r.stderr).toBe(0)
    expect(readFileSync(join(sub, 'talk.md'), 'utf8')).toContain('theme: "@acme/theme"\n')
    expect(existsSync(join(sub, 'talk-data.csv'))).toBe(true)
  })

  it('never replaces a file: if the deck or its data is there, it writes neither', () => {
    writeFileSync(join(dir, 'taken-data.csv'), 'mine\n')
    const r = run('new', 'taken.md')
    expect(r.code).toBe(2)
    expect(r.err).toContain('taken-data.csv is already there; nothing was written')
    expect(existsSync(join(dir, 'taken.md'))).toBe(false)
    expect(readFileSync(join(dir, 'taken-data.csv'), 'utf8')).toBe('mine\n')
    const again = run('new', 'talk.md')
    expect(again.code).toBe(2)
    expect(readFileSync(join(dir, 'talk.md'), 'utf8')).toBe('# Hello\n')
    expect(run('new', 'talk.txt').err).toContain('a deck is a .md file')
  })
})

describe('--format (M8.3)', () => {
  it('check --format json: one JSON document on stdout, the same exit code', () => {
    writeFileSync(join(dir, 'gap.md'), '# A\n\nOne {@1}\n\nThree {@3}\n')
    const r = run('check', 'gap.md', '--offline', '--format', 'json')
    expect(r.code).toBe(0)
    expect(r.err).toBe('')
    const doc = JSON.parse(r.out)
    expect(doc).toMatchObject({ version: 1, deck: 'gap.md', summary: { errors: 0, warnings: 1 } })
    expect(doc.diagnostics[0]).toMatchObject({ code: 'step/gap', file: 'gap.md', line: 1 })
    expect(run('check', 'gap.md', '--offline', '--strict', '--format', 'json').code).toBe(1)
  })

  it('check --format github: annotations on stdout', () => {
    const r = run('check', 'gap.md', '--offline', '--format', 'github')
    expect(r.out).toMatch(/^::warning file=gap\.md,line=1,col=1,endLine=1,endColumn=1,title=blitzstrahl step\/gap::slide `a`: step 2 changes nothing/)
  })

  it('build --format json says what it wrote, or null when errors stopped it', () => {
    const built = run('build', 'talk.md', '--standalone', '--out', 'fmt.html', '--format', 'json')
    expect(built.code, built.err).toBe(0)
    expect(JSON.parse(built.out)).toMatchObject({ output: 'fmt.html', diagnostics: [] })
    writeFileSync(join(dir, 'bad.md'), '# A\n\nText {colour=red}\n')
    const stopped = run('build', 'bad.md', '--format', 'json')
    expect(stopped.code).toBe(1)
    const doc = JSON.parse(stopped.out)
    expect(doc.output).toBeNull()
    expect(doc.summary.errors).toBeGreaterThan(0)
    expect(run('check', 'talk.md', '--format', 'xml').err).toContain('`--format` must be text, json, github')
  })
})

describe('for editors (M13)', () => {
  it('check --stdin checks the text given, finding files from the deck\'s folder', () => {
    writeFileSync(join(dir, 'unsaved.md'), '# Saved, and fine\n')
    writeFileSync(join(dir, 'unsaved.csv'), 'a,b\nx,1\n')
    const text = '# Unsaved\n\n```chart\ntype: bar\ndata: ./unsaved.csv\nx: a\ny: b\n```\n\n![](./nowhere.png)\n'
    const r = runWith(text, 'check', 'unsaved.md', '--offline', '--stdin', '--format', 'json')
    const doc = JSON.parse(r.out)
    expect(doc.deck).toBe('unsaved.md')
    // The data file is found beside the deck; the missing picture is reported at the unsaved text's line.
    expect(doc.diagnostics.map((d: { code: string; line: number }) => [d.code, d.line])).toContainEqual(['asset/missing', 10])
    expect(doc.diagnostics.filter((d: { severity: string }) => d.severity === 'error')).toEqual([])
    // Without --stdin, the file on disk.
    expect(JSON.parse(run('check', 'unsaved.md', '--offline', '--format', 'json').out).diagnostics).toEqual([])
  })

  it('`blitzstrahl:` later than the one running is a warning at the key', () => {
    const [major, minor] = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version.split('.').map(Number)
    writeFileSync(join(dir, 'marked.md'), `---\nblitzstrahl: ${major}.${minor}\n---\n\n# A\n`)
    expect(JSON.parse(run('check', 'marked.md', '--offline', '--format', 'json').out).diagnostics).toEqual([])
    writeFileSync(join(dir, 'marked.md'), `---\ntitle: T\nblitzstrahl: ${major}.${minor + 1}\n---\n\n# A\n`)
    const d = JSON.parse(run('check', 'marked.md', '--offline', '--format', 'json').out).diagnostics
    expect(d).toMatchObject([{ severity: 'warning', code: 'deck/newer', line: 3, column: 1 }])
  })

  it('newer(): major, then minor, numerically', () => {
    expect(newer('1.2', '1.1.0')).toBe(true)
    expect(newer('1.10', '1.9.3')).toBe(true)
    expect(newer('1.1', '1.1.7')).toBe(false)
    expect(newer('1.9', '2.0.0')).toBe(false)
    expect(newer('2.0', '1.12.0')).toBe(true)
  })

})
