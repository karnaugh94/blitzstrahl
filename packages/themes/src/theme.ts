import { layoutCss } from './layouts.js'

/**
 * A theme is tokens plus CSS (PLAN §5, layers 1 and 3), on top of the shared
 * layout geometry (layer 2, `layouts.ts`). Tokens become CSS
 * custom properties `--blitz-<name>`, and everything else — including the
 * chart palette (`chart-1` … `chart-8`) — reads them. That's what keeps
 * visualisations looking like part of the deck.
 *
 * The token names are the public contract (docs/themes.md).
 */
export interface ThemeDefinition {
  name: string
  /** `--blitz-<name>` values. Tokens left out take their default (`TOKEN_DEFAULTS`). */
  tokens: Record<string, string>
  /**
   * Styles for slide content. Scope every rule to `.blitz-slide` or a
   * `[data-layout]`: bare selectors like `h1` or `table` would also style
   * the overlays and the presenter view.
   */
  css: string
  /** Font files the theme ships, as `@font-face`s. The build copies or inlines them. */
  fonts?: ThemeFont[]
}

export interface ThemeFont {
  family: string
  /** A `file:` URL (`new URL('./x.woff2', import.meta.url)`) or a path relative to the theme module. */
  src: string | { href: string }
  /** CSS `font-weight`, e.g. `400` or a variable range `300 900`. Default `400`. */
  weight?: string | number
  /** CSS `font-style`. Default `normal`. */
  style?: string
  /**
   * CSS `unicode-range`: the characters this file covers, when a family
   * comes in subsets (docs/plugins.md §3.2). Standalone files carry only
   * the subsets their text uses. Default: every character. *(1.1)*
   */
  unicodeRange?: string
}

export interface Theme extends ThemeDefinition {
  /** Tokens as `:root` custom properties, the layout geometry, then the theme CSS. */
  stylesheet: string
}

/**
 * Tokens a theme must define. Renderers read these from script (ECharts,
 * Mermaid and maps need real colours), so there's no sensible default.
 */
export const REQUIRED_TOKENS: readonly string[] = [
  'bg', 'fg', 'fg-muted', 'accent',
  'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6', 'chart-7', 'chart-8',
]

/**
 * Every other token, with its default. A default that refers to another
 * token is a plain `var()`, which computed styles resolve, so script that
 * reads the token still gets a real value (`color-mix()` would not).
 * `code-token-*` have no default: code without them is shown plain.
 */
export const TOKEN_DEFAULTS: Readonly<Record<string, string>> = {
  'bg-glow-1': 'transparent',
  'bg-glow-2': 'transparent',
  'surface': 'var(--blitz-bg)',
  'surface-2': 'var(--blitz-surface)',
  'rule': 'var(--blitz-fg-muted)',
  'accent-2': 'var(--blitz-accent)',
  'link': 'var(--blitz-accent)',
  'highlight': 'var(--blitz-surface-2)',
  'letterbox': '#000',
  'ink': 'var(--blitz-accent)',
  'laser': '#ff3344',
  'font-sans': 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  'font-serif': 'Charter, "Iowan Old Style", "Palatino Linotype", Georgia, serif',
  'font-mono': 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  'text': '30px',
  'text-small': '22px',
  'h1': '60px',
  'h2': '46px',
  'h3': '34px',
  'title': '84px',
  'pad-x': '88px',
  'pad-y': '64px',
  'gap': '26px',
  'radius': '12px',
  'block-height': '420px',
  'transition-dur': '550ms',
  'code-foreground': 'var(--blitz-fg)',
  'map-tiles': 'none',
}

export const CODE_TOKENS: readonly string[] = [
  'keyword', 'string', 'string-expression', 'function', 'constant', 'parameter', 'punctuation', 'comment', 'link',
].map((t) => `code-token-${t}`)

/** Problems with a theme's tokens: missing required ones (errors) and unknown names (warnings). */
export function tokenProblems(tokens: Record<string, string>): { missing: string[]; unknown: string[] } {
  const known = new Set([...REQUIRED_TOKENS, ...Object.keys(TOKEN_DEFAULTS), ...CODE_TOKENS])
  return {
    missing: REQUIRED_TOKENS.filter((t) => typeof tokens[t] !== 'string' || !tokens[t].trim()),
    unknown: Object.keys(tokens).filter((t) => !known.has(t)),
  }
}

/** What every theme gets before its own CSS: the required tokens applied, and render blocks sized. */
const baseCss = /* css */ `
.blitz-slide {
  color: var(--blitz-fg);
  background-color: var(--blitz-bg);
  font: 400 var(--blitz-text)/1.45 var(--blitz-font-sans);
}
/* Links in the link token, as docs/themes.md says; any theme rule wins. */
:where(.blitz-slide) a { color: var(--blitz-link); }
/* Render blocks have no intrinsic size: ECharts, maps and embeds fill the box they're given. */
.blitz-slide [data-blitz-block] { width: 100%; height: var(--blitz-block-height); flex: none; }

/*
 * Utility classes every theme has (docs/themes.md, syntax.md §5.2). Zero
 * specificity: any theme rule wins, even an element rule. The built-in
 * themes restate them as .blitz-slide .x, so they beat the theme's own h3 etc.
 */
:where(.blitz-slide .columns) { display: flex; gap: 48px; align-items: flex-start; }
:where(.blitz-slide .columns > *) { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: var(--blitz-gap); }
:where(.blitz-slide .callout) {
  padding: 20px 26px; border-radius: var(--blitz-radius);
  background: color-mix(in srgb, var(--blitz-accent) 8%, var(--blitz-surface));
  border-left: 4px solid var(--blitz-accent);
}
:where(.blitz-slide .muted) { color: var(--blitz-fg-muted); }
:where(.blitz-slide .accent) { color: var(--blitz-accent); }
:where(.blitz-slide .small) { font-size: var(--blitz-text-small); }
:where(.blitz-slide .big) { font-size: 1.6em; }
:where(.blitz-slide .center) { text-align: center; align-self: center; }
:where(.blitz-slide table.zebra tbody tr:nth-child(odd)) { background: color-mix(in srgb, var(--blitz-fg) 6%, transparent); }
`

export function defineTheme(def: ThemeDefinition): Theme {
  const vars = Object.entries({ ...TOKEN_DEFAULTS, ...def.tokens })
    .map(([k, v]) => `  --blitz-${k}: ${v};`)
    .join('\n')
  return { ...def, stylesheet: `:root {\n${vars}\n}\n${layoutCss}\n${baseCss}\n${def.css}` }
}
