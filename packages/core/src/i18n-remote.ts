/**
 * The phone remote's words (M12.6), apart from the rest (i18n.ts): only
 * `blitzstrahl present` serves the pages that use them, so they stay out
 * of every built deck and standalone file. Same languages, same rule: the
 * browser's language, English wherever a translation has none.
 */
import de from './i18n/remote/de.json' with { type: 'json' }
import en from './i18n/remote/en.json' with { type: 'json' }
import es from './i18n/remote/es.json' with { type: 'json' }
import fr from './i18n/remote/fr.json' with { type: 'json' }
import it from './i18n/remote/it.json' with { type: 'json' }
import pl from './i18n/remote/pl.json' with { type: 'json' }
import sv from './i18n/remote/sv.json' with { type: 'json' }
import { uiLanguage } from './i18n.js'

export type RemoteStrings = typeof en

const TABLE: Record<string, Partial<RemoteStrings>> = { en, de, fr, es, it, pl, sv }

/** The remote's words for the first of `preferred` languages blitzstrahl has. */
export function remoteWords(preferred: readonly string[] | undefined): RemoteStrings {
  return { ...en, ...TABLE[uiLanguage(preferred)] }
}
