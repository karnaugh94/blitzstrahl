/**
 * The extension's pure parts (M13): which files are decks, where a deck
 * holds YAML, completion from the schemas, check's report, finding
 * blitzstrahl, and following the cursor.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { atLeast, findCli, nodeCommand } from '../src/cli.js'
import { isDeck, majorMinor, markerEdit } from '../src/decks.js'
import { devUrl, slideAt } from '../src/follow.js'
import { readReport } from '../src/report.js'
import { keyInfo, keysOf, yamlValue, type Schemas } from '../src/schemas.js'
import { SLIDE_KEY_NAMES } from '../../core/src/vocab.js'
import { completing, keyAt, SLIDE_KEYS, yamlBlocks } from '../src/yaml-context.js'

const at = (text: string) => {
  // `|` marks the cursor.
  const lines = text.split('\n')
  const line = lines.findIndex((l) => l.includes('|'))
  const character = lines[line]!.indexOf('|')
  lines[line] = lines[line]!.replace('|', '')
  return completing(lines, line, character)
}

describe('which files are decks', () => {
  it('only a deck frontmatter with `blitzstrahl:`', () => {
    expect(isDeck('---\nblitzstrahl: 1.1\ntitle: T\n---\n\n# A\n')).toBe(true)
    expect(isDeck('﻿---\r\ntitle: T\r\nblitzstrahl: 1.1\r\n---\r\n')).toBe(true)
    // Marp and site generators use `theme:` too.
    expect(isDeck('---\nmarp: true\ntheme: gaia\n---\n\n# A\n')).toBe(false)
    expect(isDeck('# README\n\nblitzstrahl: 1.1\n')).toBe(false)
    // In a slide's frontmatter, or after the deck's, it doesn't count.
    expect(isDeck('---\ntitle: T\n---\n\n# A\n\n---\nblitzstrahl: 1.1\n---\n')).toBe(false)
    expect(isDeck('---\ntitle: T\n')).toBe(false)
  })

  it('the marker goes first in the frontmatter, or a frontmatter is made for it', () => {
    expect(markerEdit('---\ntitle: T\n---\n', '1.1.0')).toEqual({ line: 1, insert: 'blitzstrahl: 1.1\n' })
    expect(markerEdit('# A\r\n', '1.2.0-rc.1')).toEqual({ line: 0, insert: '---\r\nblitzstrahl: 1.2\r\n---\r\n\r\n' })
    expect(majorMinor('1.10.3')).toBe('1.10')
  })
})

describe('where a deck holds YAML', () => {
  const deck = [
    '---', // 0
    'blitzstrahl: 1.1',
    'title: T',
    '---', // 3: closes the deck's, and is a separator
    'layout: title', // 4: the first slide's frontmatter
    '---', // 5: starts content, never another block
    'Agenda:', // 6: content
    '',
    '# One',
    '',
    '```chart', // 10
    'type: bar',
    '```',
    '',
    '```js', // 14
    '---',
    'layout: x',
    '```',
    '', // 18
    '---', // 19
    'layout: two-col', // 20
    'background: ./x.jpg',
    '---',
    '',
    '# Two',
    '',
    ':::: columns', // 26
    '---',
    'layout: in-a-container',
    '---',
    '::::',
    '',
    '~~~~ map {@1}', // 32
    'zoom: 3',
    '~~~~',
    '',
    '---', // 36
    'Q: why?', // 37: YAML (the heading is a comment), but no slide key: content
    '# Three',
    '---',
  ]

  it('finds the deck, slide and render blocks, and nothing in fences, containers or content', () => {
    expect(yamlBlocks(deck)).toEqual([
      { kind: 'deck', start: 1, end: 3 },
      { kind: 'slide', start: 4, end: 5 },
      { kind: 'chart', start: 11, end: 12 },
      { kind: 'slide', start: 20, end: 22 },
      { kind: 'map', start: 33, end: 34 },
    ])
  })

  it("knows the slide keys core does", () => {
    expect(SLIDE_KEYS).toEqual(SLIDE_KEY_NAMES)
  })

  it('completes top-level keys, without those already there, and values after `key:`', () => {
    expect(at('---\nblitzstrahl: 1.1\nth|\n---\n')).toEqual({ kind: 'deck', want: 'key', prefix: 'th', present: ['blitzstrahl'] })
    expect(at('---\ntitle: T\n---\n\n# A\n\n```chart\ntype: |\n```\n')).toEqual({ kind: 'chart', want: 'value', key: 'type', prefix: '' })
    expect(at('---\ntitle: T\n---\n\n# A\n\n```chart\ntype: ba|\n```\n')).toMatchObject({ want: 'value', prefix: 'ba' })
    // Nested keys are not the schema's top level.
    expect(at('---\ntitle: T\n---\n\n```chart\necharts:\n  gr|\n```\n')).toBeUndefined()
    // A key being typed straight after a separator is slide frontmatter to be.
    expect(at('# A\n\n---\nlay|\n\n# B\n')).toEqual({ kind: 'slide', want: 'key', prefix: 'lay', present: [] })
    expect(at('# A\n\n---\n# B|\n')).toBeUndefined()
    expect(at('# A\n\nsome te|xt\n')).toBeUndefined()
    expect(at('```js\n---\nlay|\n```\n')).toBeUndefined()
  })

  it('knows the key under the cursor, for hover', () => {
    expect(keyAt(deck, 20, 3)).toEqual({ kind: 'slide', key: 'layout' })
    expect(keyAt(deck, 20, 10)).toBeUndefined() // on the value
    expect(keyAt(deck, 8, 0)).toBeUndefined()
  })
})

describe('completion from the schemas', () => {
  const dir = new URL('../../cli/schema/', import.meta.url)
  const schemas: Schemas = Object.fromEntries(['deck', 'slide', 'chart', 'map', 'embed'].map((k) => [k, JSON.parse(readFileSync(new URL(`${k}.json`, dir), 'utf8'))]))

  it('each kind\'s keys with their descriptions, and the values a key lists', () => {
    expect(keysOf(schemas, 'deck').map((k) => k.name)).toContain('blitzstrahl')
    expect(keyInfo(schemas, 'deck', 'theme')?.description).toMatch(/aurora/)
    expect(keyInfo(schemas, 'slide', 'layout')?.values).toEqual(expect.arrayContaining(['title', 'two-col', 'stat-grid']))
    expect(keyInfo(schemas, 'slide', 'chrome')?.values).toEqual(['true', 'false'])
    expect(keyInfo(schemas, 'chart', 'type')?.values).toEqual(expect.arrayContaining(['bar', 'line', 'pie']))
    // YAML would misread these unquoted.
    expect(keyInfo(schemas, 'deck', 'thousands')?.values).toEqual(['","', '"."', '" "'])
    // An embed is a URL or a mapping: the mapping's keys.
    expect(keysOf(schemas, 'embed').map((k) => k.name)).toEqual(expect.arrayContaining(['src', 'fallback', 'zoom']))
    // Free text isn't offered true and false.
    expect(keyInfo(schemas, 'deck', 'title')?.values).toEqual([])
  })

  it('writes values as YAML reads them', () => {
    expect(['bar', 'push-left', './x.css', '../y', 'yes', 'on', '1:2', '', '.', ' ', 3].map(yamlValue)).toEqual(['bar', 'push-left', './x.css', '../y', '"yes"', '"on"', '"1:2"', '""', '"."', '" "', '3'])
  })
})

describe("check's report", () => {
  it('places each finding in its file, 0-based', () => {
    const json = JSON.stringify({
      version: 1,
      deck: 'talk.md',
      diagnostics: [
        { severity: 'warning', code: 'step/gap', message: 'm', file: 'talk.md', line: 42, column: 7, endLine: 42, endColumn: 9 },
        { severity: 'error', code: 'data/number', message: 'n', file: 'data/sales.csv', line: 3, column: 1 },
      ],
      skipped: ['embedded sites (--offline)'],
    })
    const r = readReport(json, '/work/deck')
    expect(r.skipped).toEqual(['embedded sites (--offline)'])
    expect(r.files.get('/work/deck/talk.md')).toEqual([{ severity: 'warning', code: 'step/gap', message: 'm', start: { line: 41, character: 6 }, end: { line: 41, character: 8 } }])
    expect(r.files.get('/work/deck/data/sales.csv')![0]).toMatchObject({ start: { line: 2, character: 0 }, end: { line: 2, character: 0 } })
    expect(() => readReport('{"version":2,"diagnostics":[]}', '/')).toThrow(/version 1/)
    expect(() => readReport('Error: boom', '/')).toThrow()
  })
})

describe('which blitzstrahl, and which Node', () => {
  it("the project's own, from the deck's folder upwards, or cliPath", () => {
    const root = mkdtempSync(join(tmpdir(), 'blitz-vscode-'))
    const pkg = join(root, 'node_modules', 'blitzstrahl')
    mkdirSync(join(pkg, 'dist'), { recursive: true })
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'blitzstrahl', version: '1.1.0', bin: { blitzstrahl: './dist/bin.js' } }))
    writeFileSync(join(pkg, 'dist', 'bin.js'), '')
    mkdirSync(join(root, 'talks', 'q3'), { recursive: true })
    expect(findCli(join(root, 'talks', 'q3'))).toEqual({ bin: join(pkg, 'dist', 'bin.js'), root: pkg, version: '1.1.0' })
    expect(findCli(tmpdir())).toBeUndefined()
    expect(findCli(join(root, 'talks'), '../node_modules/blitzstrahl/dist/bin.js')).toEqual({ bin: join(pkg, 'dist', 'bin.js'), root: pkg, version: '1.1.0' })
    expect(findCli(root, './nowhere.js')).toBeUndefined()
  })

  it('1.1 or later; a release candidate counts', () => {
    expect(['1.0.1', '1.1.0-rc.1', '1.1.0', '1.10.0', '2.0.0', '0.9.9'].map((v) => atLeast(v))).toEqual([false, true, true, true, true, false])
  })

  it("VS Code's own Node unless one is named", () => {
    expect(nodeCommand(undefined, {})).toEqual({ command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } })
    expect(nodeCommand('/usr/bin/node', { A: '1' })).toEqual({ command: '/usr/bin/node', env: { A: '1' } })
  })
})

describe('the preview', () => {
  it('reads the address dev prints, colours and all', () => {
    expect(devUrl('\n  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5199\x1b[22m/\x1b[39m\n')).toBe('http://localhost:5199/')
    expect(devUrl('  ➜  Network: use --host to expose\n')).toBeUndefined()
  })

  it('shows the slide the cursor is in: lines before the first are the first', () => {
    const slides = [
      { id: 'one', line: 4 },
      { id: 'two', line: 8 },
    ]
    expect([0, 3, 6, 7, 20].map((l) => slideAt(slides, l)?.id)).toEqual(['one', 'one', 'one', 'two', 'two'])
    expect(slideAt([], 3)).toBeUndefined()
  })
})

describe('snippets', () => {
  it('each one, as inserted, is a slide the parser takes without a complaint', async () => {
    const { parseDeck } = await import('../../core/src/index.js')
    const snippets = JSON.parse(readFileSync(new URL('../snippets/markdown.json', import.meta.url), 'utf8')) as Record<string, { prefix: string; body: string[] }>
    // As the editor fills them in: each placeholder's default, a choice's first option.
    const expand = (body: string[]) => body.join('\n').replace(/\$\{\d+\|([^,|]*)[^}]*\}/g, '$1').replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\d+/g, '')
    for (const [name, s] of Object.entries(snippets)) {
      const text = expand(s.body)
      // A snippet that makes its own slide brings its separator; the rest go on a slide of their own.
      const deck = `# Before\n\n${text.trimStart().startsWith('---') ? '' : '---\n\n# Slide\n\n'}${text}\n`
      const { deck: d, diagnostics } = parseDeck(deck, { file: 'deck.md' })
      expect(diagnostics.filter((x) => x.severity !== 'info'), `${name}:\n${deck}`).toEqual([])
      expect(d.slides.length, name).toBe(2)
    }
  })
})
