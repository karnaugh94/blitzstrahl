/**
 * A theme is tokens plus CSS (PLAN §5, layer 1 and 3). Tokens become CSS
 * custom properties `--blitz-<name>`, and everything else — including the
 * chart palette (`chart-1` … `chart-8`) — reads them. That's what keeps
 * visualisations looking like part of the deck.
 */
export interface ThemeDefinition {
  name: string
  tokens: Record<string, string>
  css: string
}

export interface Theme extends ThemeDefinition {
  /** Tokens as `:root` custom properties, followed by the theme CSS. */
  stylesheet: string
}

export function defineTheme(def: ThemeDefinition): Theme {
  const vars = Object.entries(def.tokens)
    .map(([k, v]) => `  --blitz-${k}: ${v};`)
    .join('\n')
  return { ...def, stylesheet: `:root {\n${vars}\n}\n${def.css}` }
}
