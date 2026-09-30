/** `check` loads the deck once, and builds from it to measure overflow (PLAN §15, M8.6). */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { check } from '../src/check.js'
import { loadDeck } from '../src/load.js'

vi.mock('../src/load.js', async (actual) => {
  const m = await actual<typeof import('../src/load.js')>()
  return { ...m, loadDeck: vi.fn(m.loadDeck) }
})

describe('check (M8.6)', () => {
  it('loads the deck once, overflow build included', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'blitz-check-once-'))
    writeFileSync(join(dir, 'talk.md'), '# One\n\nText\n')
    const r = await check(join(dir, 'talk.md'), { offline: true })
    // Measured, or skipped for want of a browser: either way, built.
    expect(r.skipped.filter((s) => s.includes("couldn't be built"))).toEqual([])
    expect(vi.mocked(loadDeck)).toHaveBeenCalledTimes(1)
  }, 60_000)
})
