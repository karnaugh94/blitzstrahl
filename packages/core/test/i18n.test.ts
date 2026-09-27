import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fill, LANGUAGES, strings, uiLanguage } from '../src/i18n.js'
import { parseDeck } from '../src/index.js'

const dir = join(dirname(fileURLToPath(import.meta.url)), '../src/i18n')
const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>

/** Every leaf as `path → placeholders`, so translations can be compared with English. */
function leaves(o: Record<string, unknown>, at = ''): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string') out[at + k] = [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()
    else Object.assign(out, leaves(v as Record<string, unknown>, `${at}${k}.`))
  }
  return out
}

describe('i18n', () => {
  it('every translation has exactly the English keys, with the same placeholders', () => {
    const en = leaves(read('en.json'))
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
    expect(files.map((f) => f.replace('.json', '')).sort()).toEqual([...LANGUAGES].sort())
    for (const f of files) expect([f, leaves(read(f))]).toEqual([f, en])
  })

  it('looks a tag up by its language, and falls back to English', () => {
    expect(strings('de-AT').deck.footnotes).toBe('Fußnoten')
    expect(strings('PL').ui.keys.help).toBe('Ta pomoc')
    expect(strings('nl').deck.footnotes).toBe('Footnotes')
    expect(strings(undefined).ui.close).toBe('Close')
  })

  it("picks the first of the browser's languages it has", () => {
    expect(uiLanguage(['nl-NL', 'fr-CA', 'de'])).toBe('fr')
    expect(uiLanguage(['nl'])).toBe('en')
    expect(uiLanguage(undefined)).toBe('en')
  })

  it('fills placeholders, and leaves unknown ones', () => {
    expect(fill('Folie {n} von {total}', { n: 2, total: 5 })).toBe('Folie 2 von 5')
    expect(fill('{x}', {})).toBe('{x}')
  })

  it("writes the footnotes' labels, which screen readers read, in the deck's language", () => {
    const md = (lang: string) => `---\nlang: ${lang}\n---\n\n# Eins\n\nText[^a] und mehr[^a].\n\n[^a]: Eine Fußnote.\n`
    const tree = (lang: string) => JSON.stringify(parseDeck(md(lang), { file: 'deck.md' }).deck.slides[0]!.content)
    expect(tree('de')).toContain('"value":"Fußnoten"')
    expect(tree('de')).toContain('"ariaLabel":"Zurück zu Verweis 1"')
    expect(tree('de')).toContain('"ariaLabel":"Zurück zu Verweis 1-2"')
    expect(tree('en')).toContain('"value":"Footnotes"')
  })
})
