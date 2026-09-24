import { aurora } from './aurora.js'
import type { Theme } from './theme.js'

export { defineTheme, type Theme, type ThemeDefinition } from './theme.js'
export { aurora }

/** Built-in themes by name. */
export const themes: Readonly<Record<string, Theme>> = { aurora }
