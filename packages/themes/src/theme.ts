import { layoutCss } from './layouts.js'

/**
 * A theme is tokens plus CSS (PLAN §5, layers 1 and 3), on top of the shared
 * layout geometry (layer 2, `layouts.ts`). Tokens become CSS
 * custom properties `--blitz-<name>`, and everything else — including the
 * chart palette (`chart-1` … `chart-8`) — reads them. That's what keeps
 * visualisations looking like part of the deck.
 */
export interface ThemeDefinition {
  name: string
  tokens: Record<string, string>
  /**
   * Styles for slide content. Scope every rule to `.blitz-slide` or a
   * `[data-layout]`: bare selectors like `h1` or `table` would also style
   * the overlays and the presenter view.
   */
  css: string
}

export interface Theme extends ThemeDefinition {
  /** Tokens as `:root` custom properties, the layout geometry, then the theme CSS. */
  stylesheet: string
}

export function defineTheme(def: ThemeDefinition): Theme {
  const vars = Object.entries(def.tokens)
    .map(([k, v]) => `  --blitz-${k}: ${v};`)
    .join('\n')
  return { ...def, stylesheet: `:root {\n${vars}\n}\n${layoutCss}\n${def.css}` }
}
