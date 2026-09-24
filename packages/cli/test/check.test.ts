import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseDeck } from '@blitzstrahl/core'
import { specProblem } from '@blitzstrahl/renderers/specs'
import { probeEmbeds, stepGaps, unusedClasses } from '../src/check.js'

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
