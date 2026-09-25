import { aurora } from './aurora.js'
import type { Theme } from './theme.js'

export { CODE_TOKENS, REQUIRED_TOKENS, TOKEN_DEFAULTS, defineTheme, tokenProblems, type Theme, type ThemeDefinition, type ThemeFont } from './theme.js'
export { aurora }

/** Built-in themes by name. */
export const themes: Readonly<Record<string, Theme>> = { aurora }
