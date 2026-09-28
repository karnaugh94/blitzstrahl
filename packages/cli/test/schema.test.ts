/**
 * The shipped JSON Schemas (M8.4): generated from the validators' tables,
 * written to packages/cli/schema by `pnpm test -u`, and checked against the
 * validators by trying every key with a pool of values in both.
 */
import { Ajv2020 } from 'ajv/dist/2020.js'
import { stringify } from 'yaml'
import { parseDeck } from '@blitzstrahl/core'
import { DECK_SCHEMA, SLIDE_SCHEMA, type KeyTable } from '@blitzstrahl/core/schema'
import { CHART_SCHEMA, EMBED_SCHEMA, MAP_SCHEMA, validateChart, validateEmbed, validateMap } from '@blitzstrahl/renderers/specs'
import { describe, expect, it } from 'vitest'
import { schemas } from '../src/schema.js'

const all = schemas()
const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, strictRequired: false, allErrors: true })
const valid = Object.fromEntries(Object.entries(all).map(([name, s]) => [name, ajv.compile(s)]))

/** Values of every kind, and the ones the tables single out. */
const POOL: unknown[] = [
  true, false, null, 0, 1, 0.05, 2.5, 4, 25, -1, 91, '', ' ', 'x', 'bar', 'pie', 'line', 'scatter', 'two-col', 'nope', 'fade', 'push-left',
  './a.csv', 'https://example.org/page', 'ftp://x', 'osm', 'none', 'https://t.org/{z}/{x}/{y}.png', 'compact', '0.0', '0%', '0.0.0',
  ',', '.', ';', '\t', 'sum', 'count', 'asc', 'desc', '1280x720', '0x720', '1280 x 720', '600', '600ms', 'fast', '1e3',
  [], ['a'], ['a', 'b'], [1, 2], [41.38, 2.17], [2.17, 141.38], [200, 10], [{ a: 1 }], [['a']], [''], {}, { a: 1 },
]

function agree(name: string, table: KeyTable, bases: Record<string, unknown>[], accepts: (spec: Record<string, unknown>) => boolean) {
  const disagreements: string[] = []
  const tried = (spec: Record<string, unknown>) => {
    const schema = valid[name]!(spec)
    if (schema !== accepts(spec)) disagreements.push(`${JSON.stringify(spec)}: schema ${schema ? 'accepts' : 'rejects'} it, the validator doesn't`)
  }
  for (const base of bases) {
    tried(base)
    tried({ ...base, notAKey: 1 })
    for (const key of Object.keys(table)) {
      const rest = { ...base }
      delete rest[key]
      tried(rest)
      for (const value of POOL) tried({ ...base, [key]: value })
    }
  }
  expect(disagreements.slice(0, 10)).toEqual([])
}

const passes = (validate: (spec: unknown) => unknown) => (spec: unknown) => {
  try {
    validate(spec)
    return true
  } catch {
    return false
  }
}

/** Frontmatter is accepted when the parser says nothing about its lines. */
function frontmatter(kind: 'deck' | 'slide') {
  return (fm: Record<string, unknown>) => {
    // A slide's block is frontmatter only if it has a slide key (syntax.md §2.3).
    const yaml = (Object.keys(fm).length ? stringify(fm) : '') + (kind === 'slide' && !('id' in fm) ? 'id: b\n' : '')
    const source = kind === 'deck' ? `---\n${yaml}---\n\n# A\n` : `# A\n\n---\n${yaml}---\n\n# B\n`
    const first = kind === 'deck' ? 2 : 4
    const last = first + yaml.split('\n').length - 2
    const { diagnostics } = parseDeck(source, { file: 'deck.md' })
    return !diagnostics.some((d) => d.span.start.line >= first && d.span.start.line <= last && d.code !== 'frontmatter/unknown-key')
  }
}

describe('the shipped JSON Schemas (M8.4)', () => {
  it.each(Object.keys(all))('%s.json is generated from the validators', async (name) => {
    await expect(JSON.stringify(all[name], null, 2) + '\n').toMatchFileSnapshot(`../schema/${name}.json`)
  })

  it('chart: schema and validator agree', () => {
    const bases = ['bar', 'line', 'pie', 'scatter'].flatMap((type) => [
      { type, data: './a.csv' },
      { type, data: [{ a: 1 }], x: 'a' },
    ])
    agree('chart', CHART_SCHEMA, [...bases, { type: 'bar', data: './a.csv', time: true }, { type: 'bar', data: './a.csv', sort: 'asc' }], passes(validateChart))
  })

  it('map: schema and validator agree', () => {
    const bases = [{ center: [41.38, 2.17], zoom: 5 }, { markers: './m.csv', size: 'n' }, { regions: './r.geojson', value: 'v' }]
    agree('map', MAP_SCHEMA, bases, passes(validateMap))
  })

  it('embed: schema and validator agree', () => {
    agree('embed', EMBED_SCHEMA, [{ src: 'https://example.org' }], passes(validateEmbed))
    for (const short of ['https://example.org/x', 'example.org', 5]) expect(valid.embed!(short)).toBe(passes(validateEmbed)(short))
  })

  it('deck and slide frontmatter: schema and parser agree', () => {
    agree('deck', DECK_SCHEMA, [{}, { title: 'T' }], frontmatter('deck'))
    agree('slide', SLIDE_SCHEMA, [{}, { layout: 'two-col' }], frontmatter('slide'))
  })

  it('frontmatter schemas allow unknown keys (plugins add their own); render blocks refuse them', () => {
    expect(valid.deck!({ 'my-plugin-key': 1 })).toBe(true)
    expect(valid.chart!({ type: 'bar', data: './a.csv', colour: 'red' })).toBe(false)
  })
})
