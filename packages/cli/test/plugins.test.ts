import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadDeck } from '../src/load.js'

/** A deck folder in a temp dir: `files` by relative path. The deck is `deck.md`. */
function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-plugins-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return join(dir, 'deck.md')
}

const TOKENS = `{ bg: '#fff', fg: '#111', 'fg-muted': '#666', accent: '#c2410c', ${[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `'chart-${i}': '#00${i}'`).join(', ')} }`

// Written without `definePlugin`: a local plugin next to a deck can't import blitzstrahl.
const POLL = `export default {
  name: 'poll',
  renderers: {
    poll: { body: 'yaml', browser: './poll.browser.js', check: (spec) => (Array.isArray(spec?.options) ? undefined : '\`options\` must be a list') },
  },
  effects: {
    wobble: { kind: 'entrance', keyframes: [{ opacity: 0, transform: 'rotate(-8deg)' }, { opacity: 1, transform: 'none' }], box: true },
    glow: { kind: 'emphasis', active: 'color: var(--blitz-accent)' },
  },
  frontmatter: { 'poll-endpoint': { check: (v) => (String(v).startsWith('https://') ? undefined : 'must be an https URL') } },
}
`

const load = (files: Record<string, string>) => loadDeck(folder(files), 'deck.md')
const codes = (d: { diagnostics: { code: string }[] }) => d.diagnostics.map((x) => x.code)

describe('plugins', () => {
  it('adds renderers, effects and frontmatter keys to the deck', async () => {
    const l = await load({
      'deck.md': '---\nplugins: [./plugins/poll.js]\npoll-endpoint: https://example.org/poll\n---\n\n# Vote\n\n```poll {@1}\noptions: [a, b]\n```\n\n[Hi]{.wobble @2} and [lit]{.glow @3}\n',
      'plugins/poll.js': POLL,
      'plugins/poll.browser.js': 'export default { mount() { return { update() {}, resize() {}, destroy() {} } } }\n',
    })
    expect(l.diagnostics).toEqual([])
    const slide = l.deck.slides[0]!
    expect(slide.blocks.map((b) => [b.renderer, b.spec, b.step])).toEqual([['poll', { options: ['a', 'b'] }, { in: 1 }]])
    expect(slide.anims.map((a) => [a.effect, a.kind])).toEqual([['fade', 'entrance'], ['wobble', 'entrance'], ['glow', 'emphasis']])
    expect(l.extras.renderers.poll?.browser).toBe(join(dirname(l.path), 'plugins', 'poll.browser.js'))
    expect(l.plugins).toEqual({
      effects: { wobble: { keyframes: [{ opacity: 0, transform: 'rotate(-8deg)' }, { opacity: 1, transform: 'none' }], box: true } },
      meta: { 'poll-endpoint': 'https://example.org/poll' },
    })
    expect(l.css).toContain('.blitz-slide [data-blitz-fx="glow"][data-blitz-active] { color: var(--blitz-accent) }')
  })

  it("reports a renderer's and a key's own checks where they're written", async () => {
    const l = await load({
      'deck.md': '---\nplugins:\n  - ./poll.js\npoll-endpoint: ftp://x\n---\n\n# Vote\n\n```poll\noptions: nope\n```\n',
      'poll.js': POLL,
      'poll.browser.js': 'export default {}\n',
    })
    expect(l.diagnostics.map((d) => [d.severity, d.code, d.message, d.span.start.line])).toEqual([
      ['warning', 'frontmatter/plugin-key', '`poll-endpoint` (plugin `poll`): must be an https URL', 4],
      ['error', 'renderer/poll', '`poll` block: `options` must be a list', 9],
    ])
  })

  it('resolves packages from the deck folder, ESM-only ones included', async () => {
    const l = await load({
      'deck.md': '---\ntheme: acme\nplugins: [blitzstrahl-plugin-poll]\n---\n\n# Hi\n\n```poll\noptions: [a]\n```\n',
      'node_modules/blitzstrahl-plugin-poll/package.json': JSON.stringify({ name: 'blitzstrahl-plugin-poll', type: 'module', exports: { '.': { import: './index.js' } } }),
      'node_modules/blitzstrahl-plugin-poll/index.js': POLL,
      'node_modules/blitzstrahl-plugin-poll/poll.browser.js': 'export default {}\n',
      'node_modules/blitzstrahl-theme-acme/package.json': JSON.stringify({ name: 'blitzstrahl-theme-acme', type: 'module', exports: './index.js' }),
      'node_modules/blitzstrahl-theme-acme/index.js': `export default { name: 'acme', tokens: ${TOKENS}, css: '.blitz-slide h1 { color: red }', fonts: [{ family: 'Acme', src: new URL('./acme.woff2', import.meta.url), weight: '300 900' }] }\n`,
      'node_modules/blitzstrahl-theme-acme/acme.woff2': 'not really a font',
    })
    expect(l.diagnostics).toEqual([])
    expect(l.extras.theme.name).toBe('acme')
    expect(l.extras.theme.stylesheet).toContain('--blitz-accent: #c2410c;')
    expect(l.extras.theme.stylesheet).toContain('--blitz-surface: var(--blitz-bg);') // a default
    expect(l.extras.fonts).toEqual([{ family: 'Acme', file: expect.stringMatching(/blitzstrahl-theme-acme\/acme\.woff2$/), weight: '300 900', style: 'normal' }])
    expect(l.deck.slides[0]!.blocks[0]!.renderer).toBe('poll')
  })

  it("makes CSS `@keyframes blitz-<name>` an entrance effect (syntax.md §6.3)", async () => {
    const l = await load({ 'deck.md': '<style>@keyframes blitz-spin { from { transform: rotate(0) } }</style>\n\n# S\n\nA {.spin @1}\n' })
    expect(l.deck.slides[0]!.anims).toEqual([{ effect: 'spin', kind: 'entrance', options: {} }])
    expect(codes(l)).toEqual([])
  })

  it('says what went wrong, at the frontmatter key', async () => {
    const bad = `export default { name: 'bad', colour: 1, renderers: { chart: { body: 'yaml', browser: './b.js' }, Poll: {} }, effects: { fade: { kind: 'entrance', keyframes: [{}] }, dup: { kind: 'bounce' } } }\n`
    const l = await load({
      'deck.md': '---\ntitle: T\nplugins: [./bad.js, ./missing.js, left-pad-for-decks]\n---\n\n# S\n',
      'bad.js': bad,
      'b.js': '',
    })
    const found = l.diagnostics.map((d) => `${d.span.start.line}: ${d.message}`)
    expect(found).toEqual([
      '3: plugin `./bad.js`: unknown field `colour`',
      '3: plugin `./bad.js`: `Poll` in `renderers`: names are lowercase kebab-case',
      '3: plugin `./bad.js`: renderer `chart` is built in',
      '3: plugin `./bad.js`: effect `fade` is built in',
      '3: plugin `./bad.js`: effect `dup`: `kind` must be `entrance` or `emphasis`',
      expect.stringMatching(/^3: plugin `\.\/missing\.js` not found \(looked for `\.\/missing\.js` from .+\)$/),
      expect.stringMatching(/^3: plugin `left-pad-for-decks` not found .+; is it installed\?\)$/),
    ])
    expect(l.diagnostics.every((d) => d.severity === 'error')).toBe(true)
  })

  it('refuses a second plugin registering the same name', async () => {
    const one = (n: string) => `export default { name: '${n}', effects: { wobble: { kind: 'emphasis', active: 'color: red' } } }\n`
    const l = await load({ 'deck.md': '---\nplugins: [./a.js, ./b.js]\n---\n\n# S\n', 'a.js': one('a'), 'b.js': one('b') })
    expect(l.diagnostics.map((d) => d.message)).toEqual(['plugin `./b.js`: effect `wobble` is already registered by plugin `a`'])
  })

  it("can't register a deck key that 1.1 reserves", async () => {
    const l = await load({
      'deck.md': '---\nplugins: [./p.js]\n---\n\n# S\n',
      'p.js': "export default { name: 'p', frontmatter: { footer: {}, 'poll-endpoint': {} } }\n",
    })
    expect(l.diagnostics.map((d) => d.message)).toEqual(['plugin `./p.js`: frontmatter key `footer` is reserved: blitzstrahl 1.1 uses it (docs/plugins.md §2.4)'])
  })

  it('falls back to aurora for a theme that is missing or incomplete', async () => {
    const missing = await load({ 'deck.md': '---\ntheme: nope\n---\n\n# S\n' })
    expect(missing.diagnostics.map((d) => [d.code, d.span.start.line])).toEqual([['theme/load', 2]])
    expect(missing.diagnostics[0]!.message).toMatch(/^theme `nope` not found \(looked for `blitzstrahl-theme-nope` or `nope` from .+\); using aurora/)
    expect(missing.extras.theme.name).toBe('aurora')

    const partial = await load({ 'deck.md': '---\ntheme: ./t.js\n---\n\n# S\n', 't.js': "export default { name: 't', tokens: { bg: '#fff', fg: '#000', sparkle: '1' }, css: '' }\n" })
    expect(partial.diagnostics.map((d) => [d.severity, d.message])).toEqual([
      ['error', 'theme `./t.js`: missing required tokens `fg-muted`, `accent`, `chart-1`, `chart-2`, `chart-3`, `chart-4`, `chart-5`, `chart-6`, `chart-7`, `chart-8`'],
      ['warning', 'theme `./t.js` sets unknown token `sparkle` (docs/themes.md lists them)'],
    ])
    expect(partial.extras.theme.name).toBe('aurora')
  })
})
