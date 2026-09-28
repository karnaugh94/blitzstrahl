import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readStylesheet } from '../src/stylesheet.js'

/** Files in a fresh folder; returns the folder. */
function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-css-'))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), text)
  }
  return dir
}

const problems = (s: ReturnType<typeof readStylesheet>) => s.problems.map((p) => [p.severity, p.code, p.file.split('/').pop(), p.line, p.column])

describe('CSS themes and `css:` files (docs/themes.md)', () => {
  it('tokens come from a top-level `:root`; unknown `--blitz-` names are warnings where they are', () => {
    const dir = folder({
      'brand.css': ':root {\n  --blitz-bg: #fff;\n  --blitz-accent: #3c7d22;\n  --blitz-acent: red;\n  --brand: blue;\n}\n@media print { :root { --blitz-fg: #000; } }\n',
    })
    const s = readStylesheet(join(dir, 'brand.css'))
    expect(s.tokens).toEqual({ bg: '#fff', accent: '#3c7d22', acent: 'red' })
    expect(problems(s)).toEqual([['warning', 'theme/unknown-token', 'brand.css', 4, 3]])
  })

  it("inlines local `@import`s, in place, a media query kept, and each file's url()s relative to it", () => {
    const dir = folder({
      'brand.css': '@import "./parts/colours.css";\n@import url(./parts/print.css) print;\n.blitz-slide { background: url(./img/a.png); }\n',
      'parts/colours.css': '[data-layout="title"] { background-image: url("../img/title.png"); }\n',
      'parts/print.css': '.blitz-slide h1 { color: black; }\n',
      'img/a.png': 'a',
      'img/title.png': 't',
    })
    const s = readStylesheet(join(dir, 'brand.css'))
    expect(s.problems).toEqual([])
    expect(s.css).toContain(`[data-layout="title"] { background-image: url("${join(dir, 'img/title.png')}"); }`)
    expect(s.css).toMatch(/@media print\s*\{\s*\.blitz-slide h1/)
    expect(s.css.indexOf('title.png')).toBeLessThan(s.css.indexOf('a.png'))
    expect(s.files).toEqual([join(dir, 'img/title.png'), join(dir, 'img/a.png')])
    expect(s.sources.map((f) => f.slice(dir.length + 1))).toEqual(['brand.css', 'parts/colours.css', 'parts/print.css'])
  })

  it('refuses stylesheets and fonts from other sites, and says where', () => {
    const dir = folder({
      'brand.css': '@import url("https://fonts.googleapis.com/css2?family=Inter");\n@font-face { font-family: X; src: url(https://example.org/x.woff2); }\n.blitz-slide { color: red; }\n',
    })
    const s = readStylesheet(join(dir, 'brand.css'))
    expect(problems(s)).toEqual([
      ['error', 'css/remote-import', 'brand.css', 1, 1],
      ['error', 'css/remote-font', 'brand.css', 2, 1],
    ])
    expect(s.css).not.toContain('@import')
  })

  it('`@font-face` with a local file becomes a font, and leaves the CSS', () => {
    const dir = folder({
      'brand.css': '@font-face {\n  font-family: "Acme Sans";\n  src: url("./fonts/acme.woff2") format("woff2");\n  font-weight: 300 800;\n  font-style: italic;\n  unicode-range: U+0000-00FF;\n}\n.blitz-slide { font-family: "Acme Sans"; }\n',
      'fonts/acme.woff2': 'w',
    })
    const s = readStylesheet(join(dir, 'brand.css'))
    expect(s.problems).toEqual([])
    expect(s.fonts).toEqual([{ family: 'Acme Sans', file: join(dir, 'fonts/acme.woff2'), weight: '300 800', style: 'italic', unicodeRange: 'U+0000-00FF' }])
    expect(s.css).not.toContain('@font-face')
  })

  it('a missing file, a missing import, an import cycle and bad CSS are errors at their place', () => {
    const dir = folder({
      'brand.css': '@import "./a.css";\n@import "./nope.css";\n.blitz-slide { background: url(./img/nope.png); }\n',
      'a.css': '@import "./brand.css";\n',
      'bad.css': '.blitz-slide { color: red;\n',
    })
    expect(problems(readStylesheet(join(dir, 'brand.css')))).toEqual([
      ['error', 'css/import', 'a.css', 1, 1],
      ['error', 'css/missing', 'brand.css', 2, 1],
      ['error', 'css/missing', 'brand.css', 3, 16],
    ])
    expect(problems(readStylesheet(join(dir, 'bad.css')))).toEqual([['error', 'css/syntax', 'bad.css', 1, 1]])
  })

  it('warns about rules that would also style the overview and the presenter view', () => {
    const dir = folder({
      'brand.css': 'h1 { color: red; }\n.blitz-slide h2, [data-layout="title"], .blitz-chrome::after, :root { color: red; }\n@keyframes blitz-rise { from { opacity: 0; } to { opacity: 1; } }\n',
    })
    expect(problems(readStylesheet(join(dir, 'brand.css')))).toEqual([['warning', 'css/unscoped', 'brand.css', 1, 1]])
  })
})
