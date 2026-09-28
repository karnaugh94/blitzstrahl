/**
 * Stylesheets a deck names (docs/themes.md; PLAN §15, M9.3): a CSS theme
 * (`theme: ./brand.css`) and extra CSS (`css:`). Read with postcss, so every
 * problem points at `brand.css:line:col`.
 *
 * What comes out is what a JS theme gives: tokens (from `:root`), fonts (the
 * `@font-face` rules, taken out of the CSS so standalone files can pick the
 * subsets they need), and the CSS, with local `@import`s inlined and every
 * local `url()` replaced by its file's absolute path, which each output maps
 * to its own URL (`themeStylesheet` in extend.ts).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import postcss, { CssSyntaxError, type AtRule, type Node, type Root } from 'postcss'
import { isLocalRef, rewriteCss } from '@blitzstrahl/core'
import { CODE_TOKENS, REQUIRED_TOKENS, TOKEN_DEFAULTS } from '@blitzstrahl/themes'
import type { ThemeFontFile } from './extend.js'

export interface StyleProblem {
  severity: 'error' | 'warning'
  code: string
  message: string
  /** Absolute path of the stylesheet. */
  file: string
  line: number
  column: number
}

export interface Stylesheet {
  css: string
  /** `--blitz-<name>` values set in `:root`, by name. */
  tokens: Record<string, string>
  fonts: ThemeFontFile[]
  /** Absolute paths of the files its `url()`s name. */
  files: string[]
  /** Every stylesheet read: the file and what it imports. */
  sources: string[]
  problems: StyleProblem[]
}

const KNOWN_TOKENS = new Set([...REQUIRED_TOKENS, ...Object.keys(TOKEN_DEFAULTS), ...CODE_TOKENS])
const FONT_FORMATS = new Set(['woff2', 'woff', 'ttf', 'otf'])
/** Selectors that reach only slides (docs/themes.md, *A theme in CSS*). */
const SCOPED = /\.blitz-slide|\[data-layout|\[data-slot|\.blitz-slot|\.blitz-chrome|\[data-chrome|^:root$/

export function readStylesheet(file: string): Stylesheet {
  const out: Stylesheet = { css: '', tokens: {}, fonts: [], files: [], sources: [], problems: [] }
  const at = (node: Node | undefined, from: string) => ({
    file: node?.source?.input.file ?? from,
    line: node?.source?.start?.line ?? 1,
    column: node?.source?.start?.column ?? 1,
  })
  const problem = (severity: StyleProblem['severity'], code: string, message: string, node: Node | undefined, from = file) =>
    out.problems.push({ severity, code, message, ...at(node, from) })
  /** A local `url()` or `@import`, as a file next to the stylesheet that names it. */
  const local = (url: string, node: Node): string | undefined => {
    const base = node.source?.input.file ?? file
    let path: string
    try {
      path = resolve(dirname(base), decodeURI(url.replace(/[?#].*$/, '')))
    } catch {
      path = resolve(dirname(base), url.replace(/[?#].*$/, ''))
    }
    if (existsSync(path)) return path
    problem('error', 'css/missing', `\`${url}\` not found (looked for ${path})`, node)
    return undefined
  }

  const read = (path: string, stack: string[]): Root | undefined => {
    out.sources.push(path)
    let root: Root
    try {
      root = postcss.parse(readFileSync(path, 'utf8'), { from: path })
    } catch (err) {
      if (!(err instanceof CssSyntaxError)) throw err
      out.problems.push({ severity: 'error', code: 'css/syntax', message: `isn't valid CSS: ${err.reason}`, file: path, line: err.line ?? 1, column: err.column ?? 1 })
      return undefined
    }
    root.walkAtRules('import', (rule) => {
      const m = /^\s*(?:url\(\s*(["']?)(.*?)\1\s*\)|(["'])(.*?)\3)\s*(.*)$/s.exec(rule.params)
      const url = m?.[2] ?? m?.[4]
      const media = m?.[5]?.trim() ?? ''
      if (!url) problem('error', 'css/import', '`@import` names no file', rule)
      else if (!isLocalRef(url)) {
        problem('error', 'css/remote-import', `\`@import\` of ${url}: stylesheets from other sites aren't loaded, since the deck would change or break when they do. Save the file beside yours and import that`, rule)
      } else if (/^(layer|supports)\b/.test(media)) {
        problem('error', 'css/import', `\`@import … ${media.split(/[\s(]/)[0]}\` isn't supported; \`@import\` a file, with a media query if you like`, rule)
      } else {
        const target = local(url, rule)
        if (target && stack.includes(target)) problem('error', 'css/import', `\`@import\` of ${url} imports itself`, rule)
        else if (target) {
          const child = read(target, [...stack, target])
          if (child) {
            const nodes = media ? [postcss.atRule({ name: 'media', params: media, nodes: child.nodes })] : child.nodes
            rule.replaceWith(...nodes)
            return
          }
        }
      }
      rule.remove()
    })
    return root
  }

  const root = read(file, [file])
  if (!root) return out

  root.walkAtRules('font-face', (rule) => fontFace(rule))
  root.walkDecls((decl) => {
    // Tokens: `--blitz-*` in a top-level `:root`.
    const parent = decl.parent
    if (decl.prop.startsWith('--blitz-') && parent?.type === 'rule' && parent.parent?.type === 'root' && (parent as postcss.Rule).selectors.includes(':root')) {
      const name = decl.prop.slice('--blitz-'.length)
      if (!KNOWN_TOKENS.has(name)) problem('warning', 'theme/unknown-token', `\`${decl.prop}\` isn't a token (docs/themes.md lists them)`, decl)
      out.tokens[name] = decl.value.trim()
    }
    if (!decl.value.includes('url(')) return
    decl.value = rewriteCss(decl.value, (url) => {
      if (!isLocalRef(url)) return undefined
      const path = local(url, decl)
      if (path && !out.files.includes(path)) out.files.push(path)
      return path
    })
  })
  root.walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && /keyframes$/i.test((rule.parent as AtRule).name)) return
    const loose = rule.selectors.filter((s) => !SCOPED.test(s.trim()))
    if (loose.length) {
      problem('warning', 'css/unscoped', `\`${loose[0]}\` isn't scoped to \`.blitz-slide\` or \`[data-layout]\`, so it also styles the overview and the presenter view`, rule)
    }
  })
  out.css = root.toString()
  return out

  /** An `@font-face` with a local file becomes one of the theme's fonts, and leaves the CSS. */
  function fontFace(rule: AtRule) {
    const get = (prop: string) => {
      let value: string | undefined
      rule.walkDecls(prop, (d) => {
        value = d.value.trim()
      })
      return value
    }
    const family = get('font-family')?.replace(/^(["'])(.*)\1$/, '$2')
    const src = get('src') ?? ''
    const urls = [...src.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/g)].map((m) => m[2]!)
    // A face written inline (data: URLs) stays as it is.
    if (urls.every((u) => u.startsWith('data:'))) return
    const remote = urls.find((u) => !isLocalRef(u) && !u.startsWith('data:'))
    if (remote) {
      problem('error', 'css/remote-font', `\`@font-face\` from ${remote}: fonts from other sites aren't loaded. Ship the file with the theme`, rule)
      rule.remove()
      return
    }
    const url = urls.find((u) => FONT_FORMATS.has(u.replace(/[?#].*$/, '').split('.').pop()!.toLowerCase()))
    if (!family || !url) {
      problem('error', 'css/font-face', '`@font-face` needs a `font-family` and a `src` with a .woff2, .woff, .ttf or .otf file', rule)
      rule.remove()
      return
    }
    const path = local(url, rule)
    rule.remove()
    if (!path) return
    const font: ThemeFontFile = { family, file: path, weight: get('font-weight') ?? '400', style: get('font-style') ?? 'normal' }
    const range = get('unicode-range')
    if (range) font.unicodeRange = range
    out.fonts.push(font)
  }
}
