/**
 * Frontmatter keys (syntax.md §3): validation and defaults.
 */
import type { DeckMeta, SourceSpan, TransitionName, TransitionSpec } from './ir.js'
import type { Diagnostics } from './diagnostics.js'
import { keySpan, type Frontmatter } from './split.js'
import type { Thousands } from './numbers.js'
import { normalizeRelative } from './assets.js'
import { DECK_SCHEMA, keyProblem, matches, MS } from './schema.js'
import { LAYOUTS, SLIDE_KEYS, SUPPORTED_MILESTONES, TRANSITIONS } from './vocab.js'

export const DECK_KEYS: ReadonlySet<string> = new Set(Object.keys(DECK_SCHEMA))
export { SLIDE_KEYS }

export function resolveDeckMeta(fm: Frontmatter | undefined, diags: Diagnostics, pluginKeys: readonly string[] = []): Omit<DeckMeta, 'title'> & { title?: string } {
  const data = fm?.data ?? {}
  const none = { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } }
  const meta: Omit<DeckMeta, 'title'> & { title?: string } = {
    lang: 'en',
    theme: 'aurora',
    canvas: { width: 1280, height: 720 },
    transition: { name: 'fade' },
    plugins: [],
    extra: {},
  }
  for (const [key, value] of Object.entries(data)) {
    const span = keySpan(fm, key, none)
    switch (key) {
      case 'title':
      case 'author':
      case 'date':
      case 'lang':
      case 'theme': {
        const s = scalarString(value)
        if (s === undefined) diags.warn('frontmatter/type', `\`${key}\` should be a string`, span)
        else meta[key] = s
        break
      }
      case 'thousands': {
        const problem = keyProblem(DECK_SCHEMA, key, value)
        if (problem) diags.error('frontmatter/thousands', problem, span)
        else meta.thousands = value as Thousands
        break
      }
      case 'canvas': {
        const problem = keyProblem(DECK_SCHEMA, key, value)
        if (problem) diags.error('frontmatter/canvas', problem, span)
        else {
          const [w, h] = String(value).split('x').map(Number)
          meta.canvas = { width: w!, height: h! }
        }
        break
      }
      case 'transition': {
        const t = transitionName(value, diags, span)
        if (t) meta.transition.name = t
        break
      }
      case 'transition-dur': {
        const d = milliseconds(value, key, diags, span)
        if (d !== undefined) meta.transition.dur = d
        break
      }
      case 'public': {
        const problem = keyProblem(DECK_SCHEMA, key, value)
        if (problem) diags.error('frontmatter/public', problem, span)
        else meta.public = normalizeRelative(value as string)
        break
      }
      case 'background': {
        // Layout names first, for a message that names the one that's wrong.
        let v = value
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const known = Object.entries(v).filter(([layout]) => {
            if (layout in LAYOUTS) return true
            diags.warn('layout/unknown', `\`background\` names an unknown layout \`${layout}\` (built-in: ${Object.keys(LAYOUTS).join(', ')})`, span)
            return false
          })
          v = Object.fromEntries(known)
        }
        const problem = keyProblem(DECK_SCHEMA, key, v)
        if (problem) diags.warn('frontmatter/type', problem, span)
        else if (typeof v === 'object' && v !== null) meta.background = Object.fromEntries(Object.entries(v).map(([l, bg]) => [l, scalarString(bg)!]))
        else meta.background = scalarString(v)!
        break
      }
      case 'plugins': {
        const problem = keyProblem(DECK_SCHEMA, key, value)
        if (problem) diags.error('frontmatter/plugins', problem, span)
        else meta.plugins = (typeof value === 'string' ? [value] : (value as string[])).map((p) => p.trim())
        break
      }
      default:
        if (!DECK_KEYS.has(key)) {
          if (!pluginKeys.includes(key)) diags.warn('frontmatter/unknown-key', `unknown deck frontmatter key \`${key}\``, span)
          meta.extra[key] = value
        }
    }
  }
  return meta
}

export function transitionName(value: unknown, diags: Diagnostics, span: SourceSpan | undefined): TransitionName | undefined {
  const s = String(value)
  if (!TRANSITIONS.has(s as TransitionName)) {
    diags.error('transition/unknown', `unknown transition \`${s}\``, span)
    return undefined
  }
  return s as TransitionName
}

export function milliseconds(value: unknown, key: string, diags: Diagnostics, span: SourceSpan | undefined): number | undefined {
  const n = typeof value === 'number' ? value : Number(String(value).replace(/ms$/, ''))
  if (!matches(MS.schema, value)) {
    diags.error('attr/bad-value', `\`${key}\` must be a duration in milliseconds`, span)
    return undefined
  }
  return n
}

/** An unknown layout falls back to `default`, so the slide still gets a working layout. */
export function layoutName(value: unknown, diags: Diagnostics, span: SourceSpan | undefined): string {
  const s = String(value)
  if (s in LAYOUTS) return s
  diags.warn('layout/unknown', `unknown layout \`${s}\`; using \`default\` (built-in: ${Object.keys(LAYOUTS).join(', ')})`, span)
  return 'default'
}

export function notYet(what: string, milestone: string, diags: Diagnostics, span: SourceSpan | undefined): void {
  if (SUPPORTED_MILESTONES.has(milestone)) return
  diags.warn('not-yet-supported', `${what} not yet supported (arrives in ${milestone}); ignored for now`, span)
}

function scalarString(v: unknown): string | undefined {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return undefined
}

export { scalarString }

export function mergeTransition(base: TransitionSpec, name?: TransitionName, dur?: number): TransitionSpec {
  const t: TransitionSpec = { name: name ?? base.name }
  const d = dur ?? base.dur
  if (d !== undefined) t.dur = d
  return t
}
