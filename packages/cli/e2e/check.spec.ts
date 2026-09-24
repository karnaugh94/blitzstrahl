/**
 * `blitzstrahl check` (PLAN §7), end to end: it needs a browser for the
 * overflow part, which is why it's here and not in the unit tests.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { check } from '../dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = join(here, 'fixtures/checkme.md')
const bin = join(here, '../dist/bin.js')

test('finds every kind of problem, each at its line', async () => {
  const r = await check(fixture, { offline: true })
  const at = (code: string) => r.diagnostics.filter((d) => d.code === code).map((d) => `${d.span.start.line}:${d.severity}`)
  expect(at('asset/missing')).toEqual(['11:warning'])
  expect(at('step/gap')).toEqual(['5:warning'])
  expect(at('class/near-effect')).toEqual(['9:warning'])
  expect(at('renderer/chart')).toEqual(['17:error'])
  expect(r.diagnostics.find((d) => d.code === 'renderer/chart')?.message).toContain('no column `profit`')
  expect(at('overflow/canvas')).toEqual(['25:warning'])
  expect(r.skipped).toEqual([])
})

test('the command exits 1 on errors, prints file:line:col, and --strict counts warnings', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [bin, 'check', ...args], { encoding: 'utf8' })
  const bad = run(fixture, '--offline')
  expect(bad.status).toBe(1)
  expect(bad.stderr).toMatch(/checkme\.md:17:1: error: `chart` block: no column `profit`/)

  const nav = join(here, 'fixtures/nav.md')
  expect(run(nav, '--offline').status).toBe(0)
  const clean = run(join(here, 'fixtures/minimal.md'), '--offline', '--strict')
  expect(clean.status).toBe(0)
  expect(clean.stdout).toContain('no problems found')
  expect(run(join(here, 'fixtures/overflow.md'), '--offline', '--strict').status).toBe(1)
})
