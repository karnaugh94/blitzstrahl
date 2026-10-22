import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { parseDeck } from '@blitzstrahl/core'
import { makePresentation } from '../../../scripts/pptx.mjs'
import { build } from '../src/build.js'
import { loadDeck } from '../src/load.js'
import { findSoffice, legacyToPptx, presetPath, pptxToMarkdown } from '../src/pptx.js'

const deck = () => pptxToMarkdown(makePresentation(), 'kestrel.pptx')
/** Each slide's markdown, in order (after the deck's frontmatter and its one `<style>`). */
const slides = (source: string) => source.slice(source.indexOf('</style>\n') + 9).split('\n\n---\n\n')

/** The generated presentation, written to a fresh folder. */
function presentation(name = 'kestrel.pptx'): string {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-pptx-'))
  const file = join(dir, name)
  writeFileSync(file, makePresentation())
  return file
}

describe('PowerPoint presentations as decks (docs/powerpoint.md)', () => {
  it('makes a deck that parses cleanly: one slide per shown slide, the title and author from the file', () => {
    const { source, notCarried } = deck()
    const parsed = parseDeck(source, { file: 'kestrel.pptx' })
    expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(parsed.deck.meta.title).toBe('Kestrel quarterly')
    expect(parsed.deck.meta.author).toBe('Ana Ruiz')
    // Four slides, one hidden.
    expect(parsed.deck.slides).toHaveLength(3)
    expect(notCarried).toContain('1 hidden slide (left out, as in a slide show)')
    expect(source).not.toContain('Backup slide')
  })

  it('places a placeholder where its layout or master does, styled by both', () => {
    const [title, agenda] = slides(deck().source)
    // The title slide's layout moves the title and centres it at 60pt (80px on a 16:9 slide).
    expect(title).toContain('left:160px;top:220px;width:960px;height:160px;')
    expect(title).toMatch(/text-align:center;font-size:80px"><span style="font-size:80px;color:#2c4a63;font-family:&quot;Source Serif 4&quot;, serif">Quarterly review</)
    // Text is escaped, and tint works in linear light as in Office: black at 75% is #898989.
    expect(title).toContain('color:#898989')
    expect(title).toContain('Where we are &amp; &lt;where&gt; we go')
    // Title and content: the layout's placeholders have no box, so the master's is used.
    expect(agenda).toContain('left:80px;top:200px;width:1120px;height:460px;')
  })

  it('carries bullets, levels, numbering and links from the master\'s body style', () => {
    const agenda = slides(deck().source)[1]!
    const bullets = [...agenda.matchAll(/white-space:pre">([^<]+)<\/span><(?:span|a)[^>]*>(?:<span[^>]*>)?([^<]+)</g)].map((m) => [m[1], m[2]])
    expect(bullets).toEqual([
      ['•', 'Revenue'],
      ['–', 'Europe grew fastest'],
      ['1.', 'First step'],
      ['2.', 'Second step'],
      ['•', 'Read the report'],
    ])
    // Level 2 indents further, and is smaller (24pt, 32px).
    expect(agenda).toContain('padding-left:72px;text-indent:-24px;font-size:32px')
    // The run's own colour and weight win over the master's.
    expect(agenda).toMatch(/color:#c23b4a;[^"]*font-weight:bold">Revenue/)
    // A link is in the theme's link colour, underlined, and opens elsewhere.
    expect(agenda).toMatch(/<a href="https:\/\/example.org\/report" target="_blank" rel="noopener"><span style="[^"]*color:#0b5f9a;[^"]*text-decoration:underline">Read the report/)
  })

  it('turns speaker notes into `::: notes`, with markdown characters kept as written', () => {
    const agenda = slides(deck().source)[1]!
    expect(agenda).toMatch(/::: notes\nPause \\\*here\\\*\n\n\\- then go on\n:::$/)
    const parsed = parseDeck(deck().source, { file: 'kestrel.pptx' })
    expect(parsed.deck.slides[1]!.notes).toBeDefined()
  })

  it('draws shapes in the theme\'s style colours, scales groups, crops pictures, and keeps master shapes off a layout that hides them', () => {
    const [title, , shapes] = slides(deck().source)
    // The master's teal band: on the title slide, not on the blank layout.
    expect(title).toContain('fill="#0b7a75"')
    expect(shapes).not.toContain('left:0px;top:700px')
    // fillRef idx 1 on accent2, outlined in its shade, with lt1 text from fontRef.
    expect(shapes).toMatch(/<path d="M16.67 0 H283.33 [^"]+" fill="#e07a1f" stroke="#[0-9a-f]{6}" stroke-width="1.33"\/>/)
    expect(shapes).toMatch(/color:#ffffff;[^"]*">Rounded/)
    // A freeform, scaled from its own path space to its box.
    expect(shapes).toContain('<path d="M50 0 L100 100 L0 100 Z" fill="#7a4fa0" stroke="none"/>')
    // A group at half scale: its 200px circle draws at 100px.
    expect(shapes).toMatch(/left:520px;top:40px;width:100px;height:100px;"><div style="position:absolute;left:0px;top:0px;width:100px;height:100px;"><svg/)
    // Cropped by a quarter on the left: the picture is a third wider than its frame, and shifted fully left.
    expect(shapes).toMatch(/role="img" aria-label="A teal square" style="[^"]*background:url\(&quot;data:image\/png;base64,[^&]+&quot;\) 100% 0% \/ 133.33% 100% no-repeat;/)
    // An arrowhead on the connector's end.
    expect(shapes).toMatch(/<marker id="[^"]+"[^>]*orient="auto"[^>]*><path d="M0 0 L10 5 L0 10 Z"\/><\/marker>/)
    expect(shapes).toContain('marker-end="url(#')
  })

  it("draws a table in PowerPoint's default style, though the file doesn't define it", () => {
    const shapes = slides(deck().source)[2]!
    const cells = [...shapes.matchAll(/<td style="background:(#[0-9a-f]{6})[^"]*"><div[^>]*><span style="[^"]*color:(#[0-9a-f]{6})[^"]*">([^<]+)</g)].map((m) => [m[3], m[1], m[2]])
    expect(cells).toEqual([
      // The header row: accent 1, white bold text.
      ['Region', '#0b7a75', '#ffffff'],
      ['Riders', '#0b7a75', '#ffffff'],
      // The first band: accent 1 tinted, dark text.
      ['North', expect.stringMatching(/^#[0-9a-f]{6}$/), '#000000'],
      ['1200', expect.stringMatching(/^#[0-9a-f]{6}$/), '#000000'],
    ])
    expect(shapes).toMatch(/<td style="[^"]*"><div[^>]*><span style="[^"]*font-weight:bold">Region/)
  })

  it('draws a chart with the chart renderer, from the values saved with it, in its own colours', () => {
    const { source } = deck()
    const parsed = parseDeck(source, { file: 'kestrel.pptx' })
    const block = parsed.deck.slides[2]!.blocks[0]!
    expect(block.renderer).toBe('chart')
    expect(block.spec).toEqual({
      type: 'bar',
      x: 'Category',
      y: ['Bus', 'Tram'],
      title: 'Riders by quarter',
      legend: true,
      data: [
        { Category: 'Q1', Bus: 120, Tram: 90 },
        { Category: 'Q2', Bus: 140, Tram: 95 },
        { Category: 'Q3', Bus: 160, Tram: 130 },
      ],
    })
    expect(source).toMatch(/left:480px;top:200px;width:600px;height:400px;--blitz-chart-1:#0b7a75;--blitz-chart-2:#e07a1f;/)
    expect(source).toContain('```chart {height=400 alt="Riders by quarter"}')
  })

  it('is read by loadDeck: a .pptx is a deck like any other, with what it leaves out as info', async () => {
    const file = presentation()
    const loaded = await loadDeck(file, 'kestrel.pptx')
    expect(loaded.deck.slides).toHaveLength(3)
    expect(loaded.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(loaded.diagnostics).toContainEqual(expect.objectContaining({ severity: 'info', code: 'pptx/not-shown', message: '1 hidden slide (left out, as in a slide show)' }))
  })

  it('builds to a single file', async () => {
    const file = presentation()
    const r = await build(file, { standalone: true, quiet: true, report: false })
    expect(r.ok).toBe(true)
    expect(r.index).toMatch(/kestrel\.html$/)
  }, 60_000)

  it("says what's wrong with a file that isn't a presentation", () => {
    expect(() => pptxToMarkdown(new TextEncoder().encode('# not a zip'), 'talk.pptx')).toThrow("talk.pptx isn't a PowerPoint presentation (.pptx): it has no ppt/presentation.xml")
  })

  it('draws preset shapes to their adjustments', () => {
    expect(presetPath('rect', 100, 50, {})).toBe('M0 0 L100 0 L100 50 L0 50 Z')
    expect(presetPath('triangle', 100, 50, { adj: 0 })).toBe('M0 0 L100 50 L0 50 Z')
    expect(presetPath('chevron', 100, 50, {})).toBe('M0 0 L75 0 L100 25 L75 50 L0 50 L25 25 Z')
    expect(presetPath('cloudCallout', 100, 50, {})).toBeUndefined()
  })

  it.skipIf(!findSoffice())('reads a legacy .ppt through LibreOffice', () => {
    const dir = mkdtempSync(join(tmpdir(), 'blitz-ppt-'))
    const pptx = join(dir, 'kestrel.pptx')
    writeFileSync(pptx, makePresentation())
    execFileSync(findSoffice()!, [`-env:UserInstallation=file://${join(dir, 'profile')}`, '--headless', '--convert-to', 'ppt', '--outdir', dir, pptx], { stdio: 'pipe', timeout: 180_000 })
    const back = pptxToMarkdown(legacyToPptx(join(dir, 'kestrel.ppt')), 'kestrel.ppt')
    expect(back.source).toContain('Quarterly review')
    expect(back.source).toContain('Europe grew fastest')
  }, 240_000)
})
