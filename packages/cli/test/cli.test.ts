import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'blitz-cli-'))
writeFileSync(join(dir, 'talk.md'), '# Hello\n')

function run(...args: string[]) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, BLITZSTRAHL_SKIP_OVERFLOW_CHECK: '1' } })
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
    expect(run('--version')).toMatchObject({ code: 0, out: expect.stringMatching(/^blitzstrahl \d+\.\d+\.\d+\n$/) })
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
})

describe('blitzstrahl new (M8.2)', () => {
  it('writes a starter deck and its data, which check finds nothing wrong with', () => {
    const r = run('new', 'intro/start.md', '--theme', 'broadsheet')
    expect(r.code, r.err).toBe(0)
    expect(r.out).toContain('npx blitzstrahl dev intro/start.md')
    const deck = readFileSync(join(dir, 'intro/start.md'), 'utf8')
    expect(deck).toContain('theme: broadsheet\n')
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
