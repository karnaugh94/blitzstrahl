/**
 * Plugins and themes (docs/plugins.md): found from the deck's folder,
 * imported, and checked against the contract. What a plugin exports is
 * validated here, not by `definePlugin`, so a plugin written without it
 * gets the same checks.
 */
import { existsSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve as resolveModule } from 'import-meta-resolve'
import { DECK_KEYS, EFFECTS, RENDERERS, RESERVED_DECK_KEYS, cssRefs, isLocalRef, rewriteCss, type Deck, type Diagnostic, type Extensions, type PayloadPlugins, type SourceSpan } from '@blitzstrahl/core'
import { BUILTIN_RENDERERS } from '@blitzstrahl/renderers'
import { defineTheme, themes, tokenProblems, type Theme } from '@blitzstrahl/themes'
import type { CheckCtx, EffectDef, KeyDef } from './plugin.js'
import { readStylesheet, type Stylesheet } from './stylesheet.js'

export interface PluginRenderer {
  plugin: string
  body: 'yaml' | 'text'
  /** Absolute path of the browser module. */
  browser: string
  check?: (spec: unknown, ctx: CheckCtx) => string | undefined | Promise<string | undefined>
}

export interface ThemeFontFile {
  family: string
  file: string
  weight: string
  style: string
  /** CSS `unicode-range`: the characters this file covers, when a family comes in subsets. */
  unicodeRange?: string
}

/** Everything a deck's `theme` and `plugins` add. */
export interface Extras {
  theme: Theme
  fonts: ThemeFontFile[]
  /**
   * The local files the theme's CSS names in `url()`s (per-layout
   * backgrounds, say), by the URL as written: copied, served or inlined
   * like fonts (docs/themes.md, *Backgrounds by layout*).
   */
  themeFiles: Record<string, string>
  /** The deck's `css:` stylesheets, after the theme's (docs/themes.md, *Adding to a theme*). */
  extraCss: string
  /**
   * The stylesheets read for a CSS theme and `css:`, by the name diagnostics
   * give them: `dev` watches them, and opens them from the page.
   */
  stylesheets: Record<string, string>
  renderers: Record<string, PluginRenderer>
  effects: Record<string, EffectDef & { plugin: string }>
  keys: Record<string, KeyDef & { plugin: string }>
  /**
   * Files the dev server may serve besides blitzstrahl's own: plugins'
   * browser modules (Vite lets their imports through) and theme fonts.
   */
  served: string[]
  diagnostics: Diagnostic[]
}

const NAME = /^[a-z][a-z0-9-]*$/
const PLUGIN_FIELDS = new Set(['name', 'renderers', 'effects', 'frontmatter'])
const RENDERER_FIELDS = new Set(['body', 'browser', 'check'])
const THEME_FIELDS = new Set(['name', 'tokens', 'css', 'fonts', 'stylesheet'])

/** What the parser needs to know about the extras. */
export function toExtensions(x: Extras): Extensions {
  return {
    renderers: Object.fromEntries(Object.entries(x.renderers).map(([k, r]) => [k, { body: r.body }])),
    effects: Object.fromEntries(Object.entries(x.effects).map(([k, e]) => [k, e.kind])),
    keys: Object.keys(x.keys),
  }
}

/** A deck with no plugins and a built-in theme. */
export function builtinExtras(theme: Theme = themes.aurora!): Extras {
  return { theme, fonts: [], themeFiles: {}, extraCss: '', stylesheets: {}, renderers: {}, effects: {}, keys: {}, served: [], diagnostics: [] }
}

/**
 * Load the deck's theme and plugins. Never throws: a plugin that can't be
 * found, loaded or validated is an error diagnostic at its frontmatter key,
 * and a theme that fails falls back to aurora.
 */
export async function loadExtras(deck: Deck, dir: string, keySpans: Record<string, SourceSpan>, importModule?: (file: string) => Promise<unknown>): Promise<Extras> {
  const origin = { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } }
  const x = builtinExtras()
  const error = (key: string, code: string, message: string) =>
    x.diagnostics.push({ severity: 'error', code, message, file: deck.source, span: keySpans[key] ?? origin })
  const warn = (key: string, code: string, message: string) =>
    x.diagnostics.push({ severity: 'warning', code, message, file: deck.source, span: keySpans[key] ?? origin })

  // Theme.
  const themeName = deck.meta.theme
  const builtin = Object.hasOwn(themes, themeName) ? themes[themeName] : undefined
  if (builtin) {
    x.theme = builtin
    // Built-in themes' font paths are relative to the themes package's entry.
    const problems: string[] = []
    collectFonts(builtin.fonts ?? [], fileURLToPath(import.meta.resolve('@blitzstrahl/themes')), problems, x)
    if (problems.length) throw new Error(`built-in theme \`${themeName}\`: ${problems.join('; ')}`)
  } else if (cssTheme(themeName, dir)) {
    const file = cssTheme(themeName, dir)!
    const sheet = stylesheet(file)
    const { missing } = tokenProblems(sheet.tokens)
    if (missing.length) error('theme', 'theme/invalid', `theme \`${themeName}\`: missing required token${missing.length > 1 ? 's' : ''} ${missing.map((t) => `\`--blitz-${t}\``).join(', ')} in \`:root\` (docs/themes.md)`)
    if (!missing.length && !sheet.problems.some((p) => p.severity === 'error')) {
      x.theme = defineTheme({ name: basename(file, '.css'), tokens: sheet.tokens, css: sheet.css })
      addSheet(sheet)
    }
  } else {
    const loaded = await importFrom(themeCandidates(themeName), dir, importModule)
    if ('error' in loaded) error('theme', 'theme/load', `theme \`${themeName}\` ${loaded.error}; using aurora (built-in: ${Object.keys(themes).join(', ')})`)
    else {
      const problems: string[] = []
      const theme = validateTheme(loaded.value, loaded.file, problems, x)
      for (const p of problems) error('theme', 'theme/invalid', `theme \`${themeName}\`: ${p}`)
      if (theme) {
        const { unknown } = tokenProblems(theme.tokens)
        if (unknown.length) warn('theme', 'theme/unknown-token', `theme \`${themeName}\` sets unknown token${unknown.length > 1 ? 's' : ''} ${unknown.map((t) => `\`${t}\``).join(', ')} (docs/themes.md lists them)`)
        if (!problems.length) x.theme = theme
        else {
          x.fonts = []
          x.themeFiles = {}
        }
      }
    }
  }

  // The deck's own stylesheets, after the theme's. Their tokens change the theme's.
  for (const path of deck.meta.css ?? []) {
    const file = resolve(dir, path)
    if (!existsSync(file)) {
      error('css', 'css/missing', `\`${path}\` not found (looked for ${file})`)
      continue
    }
    const sheet = stylesheet(file)
    if (sheet.problems.some((p) => p.severity === 'error')) continue
    x.extraCss += `${x.extraCss ? '\n' : ''}${sheet.css}`
    x.theme = { ...x.theme, tokens: { ...x.theme.tokens, ...sheet.tokens } }
    addSheet(sheet)
  }

  // Plugins, in order.
  for (const spec of deck.meta.plugins) {
    const loaded = await importFrom([spec], dir, importModule)
    if ('error' in loaded) {
      error('plugins', 'plugin/load', `plugin \`${spec}\` ${loaded.error}`)
      continue
    }
    const problems: string[] = []
    addPlugin(loaded.value, loaded.file, spec, x, problems)
    for (const p of problems) error('plugins', 'plugin/invalid', `plugin \`${spec}\`: ${p}`)
  }
  return x

  /** Read a stylesheet, reporting its problems where they are in it. */
  function stylesheet(file: string): Stylesheet {
    const sheet = readStylesheet(file)
    for (const source of sheet.sources) x.stylesheets[showPath(source)] = source
    for (const p of sheet.problems) {
      const at = { line: p.line, column: p.column }
      x.diagnostics.push({ severity: p.severity, code: p.code, message: p.message, file: showPath(p.file), span: { start: at, end: at } })
    }
    return sheet
  }
  /** A stylesheet file as diagnostics name it: beside the deck's own name. */
  function showPath(file: string): string {
    return join(dirname(deck.source), relative(dir, file))
  }
  function addSheet(sheet: Stylesheet) {
    x.fonts.push(...sheet.fonts)
    for (const f of sheet.fonts) x.served.push(f.file)
    for (const f of sheet.files) {
      x.themeFiles[f] = f
      x.served.push(f)
    }
  }
}

/** A theme that's a CSS file: a `./path.css`, or a package whose entry is one (docs/plugins.md §1). */
function cssTheme(name: string, dir: string): string | undefined {
  if (isPath(name)) return name.endsWith('.css') ? resolve(dir, name) : undefined
  const parent = pathToFileURL(resolve(dir) + '/').href
  for (const spec of themeCandidates(name)) {
    try {
      const file = fileURLToPath(resolveModule(spec, parent))
      return file.endsWith('.css') ? file : undefined
    } catch {
      continue
    }
  }
  return undefined
}

/** The theme's CSS and the deck's `css:` after it, as one stylesheet: what the page carries, and what `check` reads. */
export function allCss(x: Extras): string {
  return x.extraCss ? `${x.theme.stylesheet}\n${x.extraCss}` : x.theme.stylesheet
}

/**
 * Run the plugins' frontmatter key checks, and collect what the page needs:
 * entrance keyframes and the registered keys' values.
 */
export function pluginPayload(x: Extras, deck: Deck, keySpans: Record<string, SourceSpan>): { payload: PayloadPlugins; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const meta: Record<string, unknown> = {}
  for (const [key, def] of Object.entries(x.keys)) {
    if (!Object.hasOwn(deck.meta.extra, key)) continue
    const value = deck.meta.extra[key]
    meta[key] = value
    let problem: string | undefined
    try {
      problem = def.check?.(value)
    } catch (err) {
      problem = `check failed: ${(err as Error).message}`
    }
    if (problem) {
      diagnostics.push({ severity: 'warning', code: 'frontmatter/plugin-key', message: `\`${key}\` (plugin \`${def.plugin}\`): ${problem}`, file: deck.source, span: keySpans[key]! })
    }
  }
  const effects: NonNullable<PayloadPlugins['effects']> = {}
  for (const [name, fx] of Object.entries(x.effects)) {
    if (fx.kind === 'entrance') effects[name] = { keyframes: fx.keyframes as never, ...(fx.box ? { box: true } : {}) }
  }
  const payload: PayloadPlugins = {}
  if (Object.keys(effects).length) payload.effects = effects
  if (Object.keys(meta).length) payload.meta = meta
  return { payload, diagnostics }
}

/** The theme's `@font-face`s, each file at the URL `url` gives it (copied, served or inlined). */
export async function fontCss(fonts: ThemeFontFile[], url: (file: string) => string | Promise<string>): Promise<string> {
  const faces: string[] = []
  for (const f of fonts) {
    const ext = f.file.split('.').pop()!.toLowerCase()
    const format = ({ woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' } as Record<string, string>)[ext]
    const src = `url("${await url(f.file)}")${format ? ` format("${format}")` : ''}`
    faces.push(`@font-face { font-family: ${JSON.stringify(f.family)}; src: ${src}; font-weight: ${f.weight}; font-style: ${f.style};${f.unicodeRange ? ` unicode-range: ${f.unicodeRange};` : ''} font-display: block; }`)
  }
  return faces.join('\n')
}

/** The theme's stylesheet and the deck's `css:`, with each file they name at the URL `url` gives it (copied, served or inlined). */
export async function themeStylesheet(x: Extras, url: (file: string) => string | Promise<string>): Promise<string> {
  const urls = new Map<string, string>()
  for (const [ref, file] of Object.entries(x.themeFiles)) urls.set(ref, await url(file))
  return urls.size ? rewriteCss(allCss(x), (ref) => urls.get(ref)) : allCss(x)
}

/** CSS the page needs for the plugins' emphasis effects, after the theme's. */
export function pluginCss(x: Extras): string {
  return Object.entries(x.effects)
    .flatMap(([name, fx]) => {
      if (fx.kind !== 'emphasis') return []
      const sel = `.blitz-slide [data-blitz-fx="${name}"]`
      return [
        `${sel} { transition: all var(--blitz-fx-dur, 600ms) var(--blitz-fx-ease, cubic-bezier(.16,1,.3,1)) var(--blitz-fx-delay, 0ms); ${fx.base ?? ''} }`,
        `${sel}[data-blitz-active] { ${fx.active} }`,
      ]
    })
    .join('\n')
}

/** `theme: acme` finds `blitzstrahl-theme-acme`, then `acme` (docs/plugins.md §1). */
function themeCandidates(name: string): string[] {
  if (isPath(name) || name.includes('/') || name.startsWith('blitzstrahl-theme-')) return [name]
  return [`blitzstrahl-theme-${name}`, name]
}

function isPath(spec: string): boolean {
  return spec.startsWith('./') || spec.startsWith('../') || isAbsolute(spec)
}

/**
 * Import the first candidate that resolves from `dir` (as if written in a
 * module there). Local files go through `importModule` when given; packages
 * always load with Node's own `import()`.
 */
async function importFrom(candidates: string[], dir: string, importModule?: (file: string) => Promise<unknown>): Promise<{ value: unknown; file: string } | { error: string }> {
  const parent = pathToFileURL(resolve(dir) + '/').href
  for (const spec of candidates) {
    let url: string
    if (isPath(spec)) {
      const file = resolve(dir, spec)
      if (!existsSync(file)) continue
      if (importModule) {
        try {
          const mod = (await importModule(file)) as { default?: unknown }
          return { value: mod.default ?? mod, file }
        } catch (err) {
          return { error: `failed to load: ${(err as Error).message.split('\n')[0]}` }
        }
      }
      url = pathToFileURL(file).href
    } else {
      try {
        url = resolveModule(spec, parent)
      } catch {
        continue
      }
    }
    try {
      const mod = (await import(url)) as { default?: unknown }
      return { value: mod.default ?? mod, file: fileURLToPath(url) }
    } catch (err) {
      return { error: `failed to load: ${(err as Error).message.split('\n')[0]}` }
    }
  }
  const tried = candidates.map((c) => `\`${c}\``).join(' or ')
  return { error: `not found (looked for ${tried} from ${dir}${candidates.some((c) => !isPath(c)) ? '; is it installed?' : ''})` }
}

/** A `file:` URL or a path relative to the module `from`. */
function filePath(src: unknown, from: string): string | undefined {
  if (src instanceof URL || (typeof src === 'object' && src !== null && typeof (src as { href?: unknown }).href === 'string')) {
    const href = (src as { href: string }).href
    return href.startsWith('file:') ? fileURLToPath(href) : undefined
  }
  if (typeof src !== 'string' || !src) return undefined
  if (src.startsWith('file:')) return fileURLToPath(src)
  return resolve(dirname(from), src)
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function validateTheme(value: unknown, file: string, problems: string[], x: Extras): Theme | undefined {
  if (!isRecord(value)) {
    problems.push('its default export must be an object made with `defineTheme()`')
    return undefined
  }
  for (const k of Object.keys(value)) if (!THEME_FIELDS.has(k)) problems.push(`unknown field \`${k}\``)
  if (typeof value.name !== 'string' || !value.name) problems.push('`name` must be a string')
  if (!isRecord(value.tokens) || !Object.values(value.tokens).every((v) => typeof v === 'string')) {
    problems.push('`tokens` must map token names to strings')
    return undefined
  }
  if (typeof value.css !== 'string') problems.push('`css` must be a string')
  const tokens = value.tokens as Record<string, string>
  const { missing } = tokenProblems(tokens)
  if (missing.length) problems.push(`missing required token${missing.length > 1 ? 's' : ''} ${missing.map((t) => `\`${t}\``).join(', ')}`)

  collectFonts(value.fonts ?? [], file, problems, x)
  // Relative url()s in the CSS and tokens are relative to the theme module, like `fonts`.
  const css = typeof value.css === 'string' ? value.css : ''
  for (const ref of cssRefs([css, ...Object.values(tokens)].join('\n'))) {
    if (!isLocalRef(ref) || Object.hasOwn(x.themeFiles, ref)) continue
    const path = resolve(dirname(file), decodeURI(ref.replace(/[?#].*$/, '')))
    if (!existsSync(path)) problems.push(`file not found: ${ref} (${path})`)
    else {
      x.themeFiles[ref] = path
      x.served.push(path)
    }
  }
  return defineTheme({ name: String(value.name), tokens, css: typeof value.css === 'string' ? value.css : '' })
}

/** A theme's `fonts`, as files, into `x.fonts`; `from` is the theme module relative paths start from. */
function collectFonts(fonts: unknown, from: string, problems: string[], x: Extras): void {
  if (!Array.isArray(fonts)) {
    problems.push('`fonts` must be a list')
    return
  }
  for (const f of fonts) {
    const path = isRecord(f) ? filePath(f.src, from) : undefined
    if (!isRecord(f) || typeof f.family !== 'string' || !path) {
      problems.push('each font needs a `family` and a `src` (a file URL or a path)')
      continue
    }
    if (!existsSync(path)) {
      problems.push(`font file not found: ${path}`)
      continue
    }
    const font: ThemeFontFile = { family: f.family, file: path, weight: String(f.weight ?? 400), style: typeof f.style === 'string' ? f.style : 'normal' }
    if (f.unicodeRange !== undefined) {
      if (typeof f.unicodeRange === 'string' && /^\s*U\+[0-9A-F?]+(-[0-9A-F]+)?(\s*,\s*U\+[0-9A-F?]+(-[0-9A-F]+)?)*\s*$/i.test(f.unicodeRange)) font.unicodeRange = f.unicodeRange
      else problems.push(`font \`${f.family}\`: \`unicodeRange\` must be a CSS unicode-range, e.g. "U+0000-00FF, U+0131"`)
    }
    x.fonts.push(font)
    x.served.push(path)
  }
}

function addPlugin(value: unknown, file: string, spec: string, x: Extras, problems: string[]): void {
  if (!isRecord(value)) {
    problems.push('its default export must be an object made with `definePlugin()`')
    return
  }
  for (const k of Object.keys(value)) if (!PLUGIN_FIELDS.has(k)) problems.push(`unknown field \`${k}\``)
  const name = typeof value.name === 'string' && value.name ? value.name : spec
  if (typeof value.name !== 'string' || !value.name) problems.push('`name` must be a string')

  const section = (field: string): Array<[string, Record<string, unknown>]> => {
    const v = value[field]
    if (v === undefined) return []
    if (!isRecord(v)) {
      problems.push(`\`${field}\` must be an object`)
      return []
    }
    return Object.entries(v).flatMap(([k, def]) => {
      if (!NAME.test(k)) problems.push(`\`${k}\` in \`${field}\`: names are lowercase kebab-case`)
      else if (!isRecord(def)) problems.push(`\`${field}.${k}\` must be an object`)
      else return [[k, def] as [string, Record<string, unknown>]]
      return []
    })
  }
  const taken = (what: string, n: string, builtin: boolean, owner: string | undefined) => {
    if (builtin) problems.push(`${what} \`${n}\` is built in`)
    else if (owner) problems.push(`${what} \`${n}\` is already registered by plugin \`${owner}\``)
    return builtin || !!owner
  }

  for (const [n, def] of section('renderers')) {
    for (const k of Object.keys(def)) if (!RENDERER_FIELDS.has(k)) problems.push(`renderer \`${n}\`: unknown field \`${k}\``)
    if (def.body !== 'yaml' && def.body !== 'text') problems.push(`renderer \`${n}\`: \`body\` must be \`yaml\` or \`text\``)
    const browser = filePath(def.browser, file)
    if (!browser) problems.push(`renderer \`${n}\`: \`browser\` must be a file URL or a path`)
    else if (!existsSync(browser)) problems.push(`renderer \`${n}\`: browser module not found: ${browser}`)
    if (def.check !== undefined && typeof def.check !== 'function') problems.push(`renderer \`${n}\`: \`check\` must be a function`)
    const builtin = Object.hasOwn(RENDERERS, n) || (BUILTIN_RENDERERS as readonly string[]).includes(n)
    if (taken('renderer', n, builtin, x.renderers[n]?.plugin) || !browser || !existsSync(browser) || (def.body !== 'yaml' && def.body !== 'text')) continue
    const r: PluginRenderer = { plugin: name, body: def.body, browser }
    if (typeof def.check === 'function') r.check = def.check as PluginRenderer['check'] & object
    x.renderers[n] = r
    x.served.push(browser)
  }

  for (const [n, def] of section('effects')) {
    if (taken('effect', n, Object.hasOwn(EFFECTS, n), x.effects[n]?.plugin)) continue
    if (def.kind === 'entrance') {
      const extra = Object.keys(def).filter((k) => !['kind', 'keyframes', 'box'].includes(k))
      if (extra.length) problems.push(`effect \`${n}\`: unknown field \`${extra[0]}\``)
      else if (!Array.isArray(def.keyframes) || def.keyframes.length === 0 || !def.keyframes.every(isRecord)) problems.push(`effect \`${n}\`: \`keyframes\` must be a list of keyframe objects`)
      else x.effects[n] = { kind: 'entrance', keyframes: def.keyframes as never, ...(def.box === true ? { box: true } : {}), plugin: name }
    } else if (def.kind === 'emphasis') {
      const extra = Object.keys(def).filter((k) => !['kind', 'active', 'base'].includes(k))
      if (extra.length) problems.push(`effect \`${n}\`: unknown field \`${extra[0]}\``)
      else if (typeof def.active !== 'string' || (def.base !== undefined && typeof def.base !== 'string')) problems.push(`effect \`${n}\`: \`active\` (and \`base\`) must be CSS declarations`)
      else x.effects[n] = { kind: 'emphasis', active: def.active, ...(def.base ? { base: def.base as string } : {}), plugin: name }
    } else problems.push(`effect \`${n}\`: \`kind\` must be \`entrance\` or \`emphasis\``)
  }

  for (const [n, def] of section('frontmatter')) {
    if (RESERVED_DECK_KEYS.has(n)) {
      problems.push(`frontmatter key \`${n}\` is reserved: blitzstrahl 1.1 uses it (docs/plugins.md §2.4)`)
      continue
    }
    if (taken('frontmatter key', n, DECK_KEYS.has(n), x.keys[n]?.plugin)) continue
    const extra = Object.keys(def).filter((k) => k !== 'check')
    if (extra.length) problems.push(`frontmatter key \`${n}\`: unknown field \`${extra[0]}\``)
    else if (def.check !== undefined && typeof def.check !== 'function') problems.push(`frontmatter key \`${n}\`: \`check\` must be a function`)
    else x.keys[n] = { ...(def.check ? { check: def.check as KeyDef['check'] & object } : {}), plugin: name }
  }
}
