/**
 * The words blitzstrahl itself puts on a page (PLAN §14 D9). Pure. Two
 * groups: `deck`, for the audience, follows the deck's `lang` (syntax.md
 * §3.3); `ui`, for whoever presents (overlays, presenter view), follows the
 * browser's language (docs/presenting.md). Reached from the browser
 * through `@blitzstrahl/core/i18n`, which carries nothing else of core.
 *
 * Translations are `i18n/<lang>.json`; anything missing falls back to
 * English, key by key.
 */
import de from './i18n/de.json' with { type: 'json' }
import en from './i18n/en.json' with { type: 'json' }
import es from './i18n/es.json' with { type: 'json' }
import fr from './i18n/fr.json' with { type: 'json' }
import it from './i18n/it.json' with { type: 'json' }
import pl from './i18n/pl.json' with { type: 'json' }
import sv from './i18n/sv.json' with { type: 'json' }

export type Strings = typeof en

type Partial2<T> = { [K in keyof T]?: T[K] extends string ? string : Partial2<T[K]> }

const TABLE: Record<string, Partial2<Strings>> = { en, de, fr, es, it, pl, sv }

/** The languages with a translation, English first. */
export const LANGUAGES: readonly string[] = Object.keys(TABLE)

/** `de-AT` → `de`. */
const primary = (tag: string | undefined) => (tag ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? ''

function merge<T extends Record<string, unknown>>(base: T, over: Partial2<T> | undefined): T {
  if (!over) return base
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(over)) {
    const b = base[k]
    if (typeof v === 'string' && typeof b === 'string') out[k] = v
    else if (v && typeof v === 'object' && b && typeof b === 'object') out[k] = merge(b as Record<string, unknown>, v as Partial2<Record<string, unknown>>)
  }
  return out as T
}

/** The strings for a BCP 47 tag: its language's, English wherever that has none. */
export function strings(lang: string | undefined): Strings {
  return merge(en, TABLE[primary(lang)])
}

/** The first of the browser's languages with a translation, else English. */
export function uiLanguage(preferred: readonly string[] | undefined): string {
  return preferred?.map(primary).find((l) => Object.hasOwn(TABLE, l)) ?? 'en'
}

/** `{name}` placeholders filled: `fill('Slide {n}', { n: 3 })`. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (Object.hasOwn(values, k) ? String(values[k]) : m))
}
