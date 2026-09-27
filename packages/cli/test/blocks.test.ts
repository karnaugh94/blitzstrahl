import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { build } from '../src/build.js'
import { loadDeck } from '../src/load.js'

function deck(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-blocks-'))
  const file = join(dir, 'deck.md')
  writeFileSync(file, `# Title\n\n---\n\n${body}`)
  return file
}

const BAD_CHART = '# Chart\n\n```chart\ntype: bar\ncolour: red\ndata:\n  - { q: Q1, v: 1 }\n```\n'

describe('render blocks are checked on every load (M6.6)', () => {
  it('loading a deck reports a broken built-in block, as check always did', async () => {
    const loaded = await loadDeck(deck(BAD_CHART), 'deck.md')
    expect(loaded.diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', code: 'renderer/chart', message: '`chart` block: unknown key `colour`', span: expect.objectContaining({ start: { line: 7, column: 1 } }) }),
    ])
  })

  it('build stops for it (1.0 shipped the error box), and --force still builds', async () => {
    const file = deck(BAD_CHART)
    const stopped = await build(file, { quiet: true, report: false, overflowCheck: false })
    expect(stopped.ok).toBe(false)
    expect(stopped.index).toBeUndefined()
    const forced = await build(file, { quiet: true, report: false, overflowCheck: false, force: true })
    expect(forced.index).toBeDefined()
  })

  it('a map, an embed and a mermaid diagram are checked too', async () => {
    const loaded = await loadDeck(deck('```map\nzoom: 3\n```\n\n```embed\nsrc: ftp://example.org\n```\n\n```mermaid\nflowchart LR\n  A --> \n```\n'), 'deck.md')
    expect(loaded.diagnostics.map((d) => d.code)).toEqual(['renderer/map', 'renderer/embed', 'renderer/mermaid'])
  })

  it('data with thousands marks stops build, and `thousands` reads it (D3′)', async () => {
    const file = deck('# Chart\n\n```chart\ntype: bar\ndata: ./d.csv\n```\n')
    writeFileSync(join(dirname(file), 'd.csv'), 'k,v\na,"1,200"\n')
    const loaded = await loadDeck(file, 'deck.md')
    expect(loaded.diagnostics.map((d) => d.message)).toEqual([
      expect.stringMatching(/^`chart` block: `d\.csv`, line 2: `1,200` in `v` isn't a number as data writes them .*`thousands: ","`$/),
    ])
    writeFileSync(file, `---\nthousands: ","\n---\n\n# Title\n\n---\n\n# Chart\n\n\`\`\`chart\ntype: bar\ndata: ./d.csv\n\`\`\`\n`)
    expect((await loadDeck(file, 'deck.md')).diagnostics).toEqual([])
  })
}, 60_000)
