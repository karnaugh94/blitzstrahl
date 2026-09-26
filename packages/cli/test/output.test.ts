import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { build } from '../src/build.js'
import { CliError } from '../src/errors.js'
import { exportPdf } from '../src/export.js'
import { MANIFEST } from '../src/output.js'

const quiet = { quiet: true, report: false, overflowCheck: false } as const

/** A deck folder with the deck, an image and a data file, as an author has it. */
function deckFolder() {
  const root = mkdtempSync(join(tmpdir(), 'blitz-out-'))
  const dir = join(root, 'talk')
  mkdirSync(dir)
  const deck = join(dir, 'talk.md')
  writeFileSync(deck, '# Hours of work\n\n![](./logo.svg)\n')
  writeFileSync(join(dir, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  writeFileSync(join(dir, 'sales.csv'), 'q,v\nQ1,1\n')
  return { root, dir, deck }
}

const listing = (dir: string) => readdirSync(dir).sort()

async function refused(p: Promise<unknown>): Promise<CliError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(CliError)
  return err as CliError
}

describe('output paths (M6.1)', () => {
  it("won't build into the deck's own folder, and leaves it as it was", async () => {
    const { dir, deck } = deckFolder()
    const before = listing(dir)
    const err = await refused(build(deck, { ...quiet, outDir: dir }))
    expect(err.message).toContain('holds the deck itself')
    expect(listing(dir)).toEqual(before)
    expect(readFileSync(deck, 'utf8')).toContain('Hours of work')
  })

  it("won't build into a folder that contains the deck's", async () => {
    const { root, deck } = deckFolder()
    await refused(build(deck, { ...quiet, outDir: root }))
    expect(existsSync(deck)).toBe(true)
  })

  it("won't build into a folder with someone else's files, and changes nothing", async () => {
    const { root, deck } = deckFolder()
    const docs = join(root, 'Documents')
    mkdirSync(join(docs, 'photos'), { recursive: true })
    writeFileSync(join(docs, 'report.txt'), 'precious')
    writeFileSync(join(docs, 'photos', 'a.jpg'), 'jpg')
    const err = await refused(build(deck, { ...quiet, outDir: docs }))
    expect(err.message).toContain("blitzstrahl didn't make it")
    expect(listing(docs)).toEqual(['photos', 'report.txt'])
    expect(readFileSync(join(docs, 'report.txt'), 'utf8')).toBe('precious')
  })

  it('builds into a new or empty folder and lists what it wrote', async () => {
    const { root, deck } = deckFolder()
    const out = join(root, 'site')
    mkdirSync(out)
    const r = await build(deck, { ...quiet, outDir: out })
    expect(r.ok).toBe(true)
    const manifest = JSON.parse(readFileSync(join(out, MANIFEST), 'utf8')) as { files: string[] }
    expect(manifest.files).toContain('index.html')
    expect(manifest.files.some((f) => /^assets\/logo-[0-9a-f]{8}\.svg$/.test(f))).toBe(true)
    expect(manifest.files.some((f) => /^assets\/deck-.+\.js$/.test(f))).toBe(true)
    for (const f of manifest.files) expect(existsSync(join(out, f)), f).toBe(true)
  })

  it('rebuilding removes only what the last build wrote', async () => {
    const { root, deck } = deckFolder()
    const out = join(root, 'dist')
    await build(deck, { ...quiet, outDir: out })
    // A file the last build wrote that this one won't, and the author's own files.
    writeFileSync(join(out, 'assets', 'stale-00000000.js'), '// old')
    const m = JSON.parse(readFileSync(join(out, MANIFEST), 'utf8')) as { files: string[] }
    writeFileSync(join(out, MANIFEST), JSON.stringify({ ...m, files: [...m.files, 'assets/stale-00000000.js', '../talk/talk.md'] }))
    writeFileSync(join(out, 'CNAME'), 'slides.example.org')
    writeFileSync(join(out, '.nojekyll'), '')
    const r = await build(deck, { ...quiet, outDir: out })
    expect(r.ok).toBe(true)
    expect(existsSync(join(out, 'assets', 'stale-00000000.js'))).toBe(false)
    expect(readFileSync(join(out, 'CNAME'), 'utf8')).toBe('slides.example.org')
    expect(existsSync(join(out, '.nojekyll'))).toBe(true)
    // A manifest can't reach outside its folder.
    expect(existsSync(deck)).toBe(true)
  })

  it("accepts a 1.0 build's folder, which has no manifest", async () => {
    const { root, deck } = deckFolder()
    const out = join(root, 'dist')
    mkdirSync(join(out, 'assets'), { recursive: true })
    writeFileSync(join(out, 'index.html'), '<!doctype html>\n<meta name="generator" content="blitzstrahl">\n')
    writeFileSync(join(out, 'assets', 'deck-OLD.js'), '// 1.0')
    const r = await build(deck, { ...quiet, outDir: out })
    expect(r.ok).toBe(true)
    expect(existsSync(join(out, 'assets', 'deck-OLD.js'))).toBe(false)
    expect(existsSync(join(out, MANIFEST))).toBe(true)
  })

  it('a standalone file never replaces the deck, a .md, or a page blitzstrahl didn\'t make', async () => {
    const { dir, deck } = deckFolder()
    await refused(build(deck, { ...quiet, standalone: true, outFile: deck }))
    expect(readFileSync(deck, 'utf8')).toContain('Hours of work')
    await refused(build(deck, { ...quiet, standalone: true, outFile: join(dir, 'notes.md') }))
    expect(existsSync(join(dir, 'notes.md'))).toBe(false)
    const page = join(dir, 'index.html')
    writeFileSync(page, '<!doctype html><title>My site</title>')
    await refused(build(deck, { ...quiet, standalone: true, outFile: page }))
    expect(readFileSync(page, 'utf8')).toBe('<!doctype html><title>My site</title>')
  })

  it('a standalone file replaces its own earlier build', async () => {
    const { dir, deck } = deckFolder()
    const out = join(dir, 'talk.html')
    await build(deck, { ...quiet, standalone: true, outFile: out })
    writeFileSync(deck, '# Revised\n')
    const r = await build(deck, { ...quiet, standalone: true, outFile: out })
    expect(r.ok).toBe(true)
    expect(readFileSync(out, 'utf8')).toContain('Revised')
  })

  it('export never writes over the deck, and only writes a .pdf', async () => {
    const { dir, deck } = deckFolder()
    await refused(exportPdf(deck, { outFile: deck }))
    expect(readFileSync(deck, 'utf8')).toContain('Hours of work')
    await refused(exportPdf(deck, { outFile: join(dir, 'talk.html') }))
  })
}, 60_000)
