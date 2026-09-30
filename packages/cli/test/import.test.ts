import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KESTREL, makeTemplate } from '../../../scripts/potx.mjs'
import { importTheme, mix, ratio } from '../src/import.js'
import { readStylesheet } from '../src/stylesheet.js'

/** The generated template, written to a fresh folder. */
function template(options: { dark?: boolean; accent?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-import-'))
  const file = join(dir, 'kestrel.potx')
  writeFileSync(file, makeTemplate(options))
  return file
}

describe('theme import (docs/cli.md)', () => {
  it("carries the template's colours into tokens", async () => {
    const r = await importTheme(template())
    const lower = (c: string) => `#${c.toLowerCase()}`
    expect(r.tokens).toMatchObject({
      fg: lower(KESTREL.dk1), // from a system colour's last value
      bg: '#ffffff',
      accent: lower(KESTREL.accents[0]!),
      'accent-2': lower(KESTREL.accents[1]!),
      surface: lower(KESTREL.lt2),
      link: lower(KESTREL.hlink),
      'font-sans': '"Source Sans 3", system-ui, sans-serif',
    })
    for (let i = 1; i <= 6; i++) expect(r.tokens[`chart-${i}`]).toBe(lower(KESTREL.accents[i - 1]!))
    expect(r.tokens['chart-7']).toBe(mix(lower(KESTREL.accents[0]!), '#000000', 0.3))
    expect(r.tokens['fg-muted']).toBe(mix(lower(KESTREL.dk1), '#ffffff', 0.4))
  })

  it('follows the master\'s colour map: a dark template gets a dark `bg`', async () => {
    const r = await importTheme(template({ dark: true }))
    expect(r.tokens.bg).toBe(`#${KESTREL.dk1.toLowerCase()}`)
    expect(r.tokens.fg).toBe('#ffffff')
  })

  it('matches layouts by kind, then name, and lists what it could not carry', async () => {
    const r = await importTheme(template())
    expect(r.backgrounds).toEqual({ title: 'img/bg-title.png', section: '#085c58', default: 'img/bg-default.png' })
    expect(r.logo).toBe('img/logo.png')
    expect(r.notCarried).toEqual([
      'layout "Quote": matches no blitzstrahl layout (its background is img/layout-quote.png, to use by hand)',
      'layout "Closing": matches no blitzstrahl layout',
      "placeholders' positions and sizes, shapes and text boxes, text sizes and styles",
    ])
    for (const f of ['bg-title.png', 'bg-default.png', 'layout-quote.png', 'logo.png']) expect(existsSync(join(r.outDir, 'img', f)), f).toBe(true)
  })

  it('writes a CSS theme that loads cleanly, and a sample deck that uses it', async () => {
    const r = await importTheme(template())
    const sheet = readStylesheet(join(r.outDir, 'brand.css'))
    expect(sheet.problems).toEqual([])
    expect(sheet.tokens).toEqual(r.tokens)
    expect(sheet.files.map((f) => f.slice(r.outDir.length + 1)).sort()).toEqual(['img/bg-default.png', 'img/bg-title.png'])
    const css = readFileSync(join(r.outDir, 'brand.css'), 'utf8')
    // A solid background dark enough gets light text.
    expect(css).toContain('[data-layout="section"] { background-color: #085c58; color: #ffffff;')
    // Headings in the template's heading font; the logo where the master puts it; not on a layout that hides the master's pictures.
    expect(css).toContain('.blitz-slide :is(h1, h2, h3, h4) { font-family: "Source Serif 4", serif; }')
    expect(css).toContain('.blitz-chrome [data-chrome="logo"] { top: 20px; left: 1042px; right: auto; width: 150px; height: 50px;')
    expect(css).toContain('[data-layout="full-bleed"] .blitz-chrome [data-chrome="logo"] { display: none; }')
    const sample = readFileSync(join(r.outDir, 'sample.md'), 'utf8')
    expect(sample).toMatch(/^---\ntitle: "kestrel"\ntheme: \.\/brand\.css\n/)
    expect(sample).toContain('logo: ./img/logo.png')
    expect(sample).toContain('---\nlayout: section\n---\n')
  })

  it('never writes into a folder that has files, and says a non-template is one', async () => {
    const file = template()
    const out = join(file, '..', 'taken')
    mkdirSync(out)
    writeFileSync(join(out, 'keep.txt'), 'mine')
    await expect(importTheme(file, { out })).rejects.toThrow(/isn't empty; nothing was written/)
    expect(readFileSync(join(out, 'keep.txt'), 'utf8')).toBe('mine')
    const notZip = join(file, '..', 'notes.pptx')
    writeFileSync(notZip, 'hello')
    await expect(importTheme(notZip)).rejects.toThrow(/isn't a PowerPoint template/)
  })

  it('says when the accent is hard to read as text', async () => {
    expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    const r = await importTheme(template())
    // Kestrel's teal on white is 5.4:1: no note.
    expect(r.notes).toEqual([])
    const pale = await importTheme(template({ accent: '7CBDC1' }))
    expect(pale.notes).toEqual([expect.stringMatching(/^accent #7cbdc1 is hard to read as text on #ffffff \(2\.1:1/)])
    expect(readFileSync(join(pale.outDir, 'brand.css'), 'utf8')).toContain(' * Notes:\n *   - accent #7cbdc1 is hard to read')
  })
})
