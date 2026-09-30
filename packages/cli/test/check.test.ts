import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseDeck } from '@blitzstrahl/core'
import { specProblem } from '@blitzstrahl/renderers/specs'
import { mapNotes, probeEmbeds, probeGeometry, stepGaps, unusedClasses } from '../src/check.js'

describe('check: steps', () => {
  it('finds presses that change nothing', () => {
    const { deck } = parseDeck('# S\n\nA {@1}\n\nB {@3}\n\n[C]{.highlight @4-4}\n')
    const s = deck.slides[0]!
    // 1: A, 3: B, 4: C on, 5: C off. 2 is empty.
    expect(s.steps).toBe(5)
    expect(stepGaps(s.content, s.steps)).toEqual([2])
  })

  it('counts reveal=rows children and render blocks', () => {
    const src = '# S\n\n- a\n- b\n\n{reveal=items @1}\n\n```chart {@3}\ntype: bar\ndata: [{a: x, b: 1}]\n```\n'
    const { deck } = parseDeck(src)
    const s = deck.slides[0]!
    expect(stepGaps(s.content, s.steps)).toEqual([])
  })

  it('counts each group of a lines= walk-through as a press', () => {
    const { deck } = parseDeck('# S\n\n```js {lines="1|2|3"}\na\nb\nc\n```\n\nD {@3}\n')
    const s = deck.slides[0]!
    expect(s.steps).toBe(3)
    expect(stepGaps(s.content, s.steps)).toEqual([])
    const late = parseDeck('# S\n\n```js {lines="1|2" @2}\na\nb\n```\n').deck.slides[0]!
    expect(stepGaps(late.content, late.steps)).toEqual([1])
  })
})

describe('check: classes', () => {
  const css = '.blitz-slide .callout { color: red }'
  const run = (md: string) => {
    const { deck } = parseDeck(md, { file: 'deck.md' })
    return unusedClasses(deck, md, css)
  }

  it('suggests the effect a class was probably meant to be', () => {
    expect(run('# S\n\nHello {.fade-in @1}\n')).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'class/near-effect', message: expect.stringContaining('did you mean `.fade`?'), span: { start: { line: 3, column: 8 }, end: { line: 3, column: 8 } } }),
    ])
    expect(run('# S\n\nHello {.higlight @1}\n')[0]?.message).toContain('`.highlight`')
  })

  it('notes a class nothing styles, but not styled ones, <style> ones, or container names', () => {
    const md = '<style>.mine { color: blue }</style>\n\n# S\n\nA {.callout}\n\nB {.mine}\n\nC {.nothing}\n\n::: stat\n42\n:::\n\n| a |\n|---|\n| 1 |\n\n{.sortable}\n'
    expect(run(md)).toEqual([expect.objectContaining({ severity: 'info', code: 'class/unstyled', message: expect.stringContaining('`.nothing`') })])
  })
})

describe('check: render block specs', () => {
  it('catches what the renderer would, against the data', () => {
    expect(specProblem('chart', { type: 'bar', data: './d.csv', y: 'profit' }, () => 'q,revenue\nQ1,1\n')).toContain('no column `profit`')
    expect(specProblem('chart', { type: 'bar', data: './d.csv' }, () => undefined)).toBeUndefined()
    expect(specProblem('map', { center: [141.4, 2.2], zoom: 3 }, () => undefined)).toContain('latitude comes first')
    expect(specProblem('map', { markers: './m.csv' }, () => 'x,y\n1,2\n')).toContain('`lat` and `lng`')
    expect(specProblem('embed', { src: 'example.com' }, () => undefined)).toContain('http')
    expect(specProblem('embed', 'https://example.com', () => undefined)).toBeUndefined()
  })
})

describe('check: embedded sites', () => {
  let server: Server
  let base = ''
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/deny') res.setHeader('X-Frame-Options', 'DENY')
      if (req.url === '/self') res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'self'")
      if (req.url === '/anyone') res.setHeader('Content-Security-Policy', 'frame-ancestors *')
      if (req.url === '/gone') res.statusCode = 404
      if (req.url === '/no-head' && req.method === 'HEAD') res.statusCode = 405
      res.end('ok')
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const addr = server.address()
    base = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : ''
  })
  afterAll(() => server.close())

  it('warns about sites that refuse framing, are missing, or are down', async () => {
    const paths = ['ok', 'deny', 'self', 'anyone', 'gone', 'no-head']
    const md = paths.map((p) => `# ${p}\n\n\`\`\`embed\nsrc: ${base}/${p}\n\`\`\`\n`).join('\n---\n\n') + `\n---\n\n# down\n\n\`\`\`embed\nsrc: http://127.0.0.1:9/\n\`\`\`\n`
    const { deck } = parseDeck(md, { file: 'deck.md' })
    const found = await probeEmbeds(deck, 3000)
    const byPath = (p: string) => found.filter((d) => d.message.includes(`${base}/${p} `) || d.message.includes(`${base}/${p};`))
    expect(byPath('ok')).toEqual([])
    expect(byPath('anyone')).toEqual([])
    expect(byPath('no-head')).toEqual([])
    expect(byPath('deny')[0]).toMatchObject({ code: 'embed/refused', message: expect.stringContaining('X-Frame-Options: DENY') })
    expect(byPath('self')[0]).toMatchObject({ code: 'embed/refused', message: expect.stringContaining("pages other than 'self'") })
    expect(byPath('gone')[0]).toMatchObject({ code: 'embed/status', message: expect.stringContaining('404') })
    expect(found.find((d) => d.code === 'embed/unreachable')?.message).toContain('127.0.0.1:9')
    expect(found).toHaveLength(4)
  })
})

describe('check: maps', () => {
  it('notes a map with no street map, and a provider with no credit', () => {
    const md = '# a\n\n```map\ncenter: [0, 0]\nzoom: 2\n```\n\n---\n\n# b\n\n```map\ncenter: [0, 0]\nzoom: 2\ntiles: https://t/{z}/{x}/{y}.png\n```\n\n---\n\n# c\n\n```map\ncenter: [0, 0]\nzoom: 2\ntiles: osm\n```\n'
    const { deck } = parseDeck(md, { file: 'deck.md' })
    expect(mapNotes(deck).map((d) => [d.severity, d.code, d.span.start.line])).toEqual([
      ['info', 'map/no-tiles', 3],
      ['warning', 'map/no-attribution', 12],
    ])
  })

  let server: Server
  let base = ''
  beforeAll(async () => {
    const geo = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [2, 41] } }] })
    server = createServer((req, res) => {
      if (req.url !== '/private') res.setHeader('Access-Control-Allow-Origin', req.url === '/mine' ? 'https://intranet.example' : '*')
      if (req.url === '/gone') res.statusCode = 404
      res.end(req.url === '/broken' ? '{"type": "Feature"' : req.url === '/regions' ? '{"type": "Nope"}' : geo)
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const addr = server.address()
    base = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : ''
  })
  afterAll(() => server.close())

  it('fetches map data from URLs as the page would: status, content and CORS', async () => {
    const map = (key: string, path: string) => `# ${path}\n\n\`\`\`map\n${key}: ${base}/${path}\ntiles: none\n\`\`\`\n`
    const md = [map('markers', 'ok'), map('markers', 'private'), map('markers', 'mine'), map('markers', 'gone'), map('markers', 'broken'), map('regions', 'regions')].join('\n---\n\n')
    const { deck } = parseDeck(md, { file: 'deck.md' })
    const found = (await probeGeometry(deck, 3000)).map((d) => [d.severity, d.code, d.message.replaceAll(base, '')])
    expect(found).toHaveLength(5)
    expect(found).toEqual(
      expect.arrayContaining([
        ['warning', 'map/cors', "/private doesn't let other pages read it (no Access-Control-Allow-Origin header), so the browser will refuse it"],
        ['warning', 'map/cors', "/mine only lets https://intranet.example read it (CORS), so the deck's page can't"],
        ['warning', 'map/status', '/gone answers 404 Not Found'],
        ['error', 'map/data', expect.stringContaining('`markers` from /broken: `/broken` is not valid JSON')],
        ['error', 'map/data', expect.stringContaining('`regions` from /regions:')],
      ]),
    )
  })
})

describe('check: chart notes', () => {
  it('says when a bar chart sums a category that repeats', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const { check } = await import('../src/check.js')
    const dir = mkdtempSync(join(tmpdir(), 'blitz-check-notes-'))
    const deck = join(dir, 'deck.md')
    writeFileSync(deck, '# S\n\n```chart {alt="Sales by region"}\ntype: bar\nx: region\ny: v\ndata:\n  - { region: North, v: 4 }\n  - { region: North, v: 5 }\n  - { region: South, v: 6 }\n```\n')
    const r = await check(deck, { offline: true, overflow: false })
    expect(r.diagnostics).toEqual([
      expect.objectContaining({ severity: 'info', code: 'renderer/chart-note', message: expect.stringContaining('`region` repeats (North is on 2 rows)'), span: expect.objectContaining({ start: { line: 3, column: 1 } }) }),
    ])
  })

  it('notes a chart, map or diagram without alt=, never an embed or one that has it (M11.5)', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const { check } = await import('../src/check.js')
    const dir = mkdtempSync(join(tmpdir(), 'blitz-check-alt-'))
    const deck = join(dir, 'deck.md')
    const chart = 'type: pie\nx: k\ny: v\ndata:\n  - { k: a, v: 1 }\n'
    writeFileSync(deck, `# S\n\n\`\`\`chart\n${chart}\`\`\`\n\n\`\`\`chart {alt="Mostly a"}\n${chart}\`\`\`\n\n\`\`\`mermaid\nflowchart LR\n  A --> B\n\`\`\`\n\n\`\`\`embed\nsrc: https://example.org/\n\`\`\`\n`)
    const r = await check(deck, { offline: true, overflow: false })
    const notes = r.diagnostics.filter((d) => d.code === 'block/no-alt')
    expect(notes.map((d) => [d.severity, d.span.start.line, d.message])).toEqual([
      ['info', 3, 'this chart has no `alt=`: say what it shows, for screen readers (syntax.md §8.2)'],
      ['info', 19, 'this mermaid has no `alt=`: say what it shows, for screen readers (syntax.md §8.2)'],
    ])
  })
})
