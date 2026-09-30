import type { Diagnostic } from '@blitzstrahl/core'
import { describe, expect, it } from 'vitest'
import { formatReport } from '../src/report.js'

const at = (line: number, column: number, endLine = line, endColumn = column + 1) => ({ start: { line, column }, end: { line: endLine, column: endColumn } })
const diagnostics: Diagnostic[] = [
  { severity: 'error', code: 'renderer/chart', message: '`chart` block: unknown key `colour`', file: 'slides/talk.md', span: at(12, 1, 17, 4) },
  { severity: 'warning', code: 'step/gap', message: 'step 2 changes nothing', file: 'slides/talk.md', span: at(30, 1) },
  { severity: 'info', code: 'fonts/not-shipped', message: '50% of it: a, b\nsecond line', file: 'a,b:c.md', span: at(1, 1) },
]

/**
 * GitHub's workflow command grammar, as its runner parses it: `::name
 * key=value,key=value::message`, where values may not hold `,` `:` or line
 * breaks, and the message no line breaks; `%` starts an escape everywhere.
 */
const COMMAND = /^::(error|warning|notice) ((?:[a-zA-Z]+=[^,:\r\n]*)(?:,[a-zA-Z]+=[^,:\r\n]*)*)::([^\r\n]*)$/
const unescape = (s: string) => s.replace(/%0D/g, '\r').replace(/%0A/g, '\n').replace(/%3A/g, ':').replace(/%2C/g, ',').replace(/%25/g, '%')

describe('--format github (M8.3)', () => {
  it('writes one annotation per finding, in the grammar GitHub parses', () => {
    const lines = formatReport('github', { deck: 'slides/talk.md', diagnostics, skipped: [] }).split('\n')
    expect(lines.pop()).toBe('')
    expect(lines).toHaveLength(3)
    const parsed = lines.map((l) => {
      const m = COMMAND.exec(l)
      expect(m, l).not.toBeNull()
      const props = Object.fromEntries(m![2]!.split(',').map((p) => p.split('=') as [string, string]).map(([k, v]) => [k, unescape(v)]))
      return { level: m![1], props, message: unescape(m![3]!) }
    })
    expect(parsed[0]).toEqual({
      level: 'error',
      props: { file: 'slides/talk.md', line: '12', col: '1', endLine: '17', endColumn: '4', title: 'blitzstrahl renderer/chart' },
      message: '`chart` block: unknown key `colour`',
    })
    expect(parsed[1]!.level).toBe('warning')
    // Infos are notices; `%`, commas, colons and line breaks survive the round trip.
    expect(parsed[2]).toMatchObject({ level: 'notice', props: { file: 'a,b:c.md' }, message: '50% of it: a, b\nsecond line' })
  })

  it('writes nothing when there is nothing to say', () => {
    expect(formatReport('github', { deck: 'talk.md', diagnostics: [], skipped: [] })).toBe('')
  })
})

describe('--format json (M8.3)', () => {
  it('flattens spans, counts by severity, and carries `output` only when given', () => {
    const doc = JSON.parse(formatReport('json', { deck: 'slides/talk.md', diagnostics, skipped: ['embedded sites (--offline)'] }))
    expect(doc).toEqual({
      version: 1,
      deck: 'slides/talk.md',
      diagnostics: [
        { severity: 'error', code: 'renderer/chart', message: '`chart` block: unknown key `colour`', file: 'slides/talk.md', line: 12, column: 1, endLine: 17, endColumn: 4 },
        expect.objectContaining({ code: 'step/gap', line: 30 }),
        expect.objectContaining({ severity: 'info' }),
      ],
      skipped: ['embedded sites (--offline)'],
      summary: { errors: 1, warnings: 1, infos: 1 },
    })
    expect(JSON.parse(formatReport('json', { deck: 'talk.md', diagnostics: [], skipped: [], output: null })).output).toBeNull()
  })
})
