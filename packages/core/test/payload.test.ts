import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseDeck, toPayload } from '../src/index.js'

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'assets.md')

describe('payload', () => {
  it("hands renderers the URLs of the files their specs name, and nothing the page alone uses", () => {
    const { deck } = parseDeck(readFileSync(fixture, 'utf8'), { file: 'assets.md' })
    const payload = toPayload(deck, {}, (p) => `url:${p}`)
    // A standalone file would otherwise carry every image twice: in the page, and here.
    expect(payload.urls).toEqual({ 'img/fallback.png': 'url:img/fallback.png' })
  })
})
