/**
 * Numerals (PLAN D3′, user 2026-09-27). Pure. The renderers use it for
 * data files and sortable tables, and the runtime for `count-up`, through
 * `@blitzstrahl/core/numbers`, which carries nothing else of core into the
 * page.
 *
 * Two ways a number is written, and nothing is guessed between them:
 * - **data** is plain in every language (`1200`, `3.5`, and `2.000` is 2),
 *   unless the deck or the block says how it groups thousands
 *   (`thousands: "."` reads `1.200,5`);
 * - **text for the audience** (table cells, `count-up`) is read the way
 *   the deck's `lang` writes numbers (`1.200,5` in `de`).
 */

/** The character between a numeral's whole part and its fraction. */
export type DecimalMark = '.' | ','

/** How data may group thousands (syntax.md §3.1 `thousands`). */
export type Thousands = ',' | '.' | ' '
export const THOUSANDS: readonly Thousands[] = [',', '.', ' ']

/** How numerals are written: the decimal mark, and the characters that may group thousands ('' for none). */
export interface Numerals {
  decimal: DecimalMark
  group: string
}

const SIGN = /^[-+−]/
/** Spaces that group digits: a space, no-break space, thin space and narrow no-break space. */
const SPACES = ' \u00a0\u2009\u202f'

/** Data as written in every language: `.` decimal, no grouping. */
export const PLAIN: Numerals = { decimal: '.', group: '' }

/** How data declared with `thousands` is written; plain without it. */
export function dataNumerals(thousands?: Thousands): Numerals {
  if (thousands === ',') return { decimal: '.', group: ',' }
  if (thousands === '.') return { decimal: ',', group: '.' }
  if (thousands === ' ') return { decimal: ',', group: SPACES }
  return PLAIN
}

/** How `lang` writes numbers (`Intl`); English for a tag `Intl` doesn't know. */
export function langNumerals(lang: string | undefined): Numerals {
  let parts: Intl.NumberFormatPart[]
  try {
    parts = new Intl.NumberFormat(lang || 'en', { useGrouping: true }).formatToParts(1234567.5)
  } catch {
    parts = new Intl.NumberFormat('en').formatToParts(1234567.5)
  }
  const decimal = parts.find((p) => p.type === 'decimal')?.value === ',' ? ',' : '.'
  const g = parts.find((p) => p.type === 'group')?.value ?? ''
  // Spaces group digits in every language (the SI style), and a language that groups with one accepts any: authors type a plain one.
  const group = (/\s|\u202f/.test(g) || g === decimal ? '' : g) + SPACES
  return { decimal, group }
}

function body(text: string): string {
  return text.trim().replace(SIGN, '')
}

const escape = (chars: string) => chars.replace(/[\\\]^-]/g, '\\$&')

/** A numeral's value, written as `numerals` says, or undefined if it isn't one written that way. */
export function readNumber(text: string, numerals: Numerals = PLAIN): number | undefined {
  const t = text.trim()
  let b = body(t)
  const d = `\\${numerals.decimal}`
  const grouped = numerals.group && new RegExp(`^\\d{1,3}([${escape(numerals.group)}])\\d{3}(?:\\1\\d{3})*(?:${d}\\d+)?$`)
  if (grouped && grouped.test(b)) b = b.replace(new RegExp(`[${escape(numerals.group)}]`, 'g'), '')
  else if (!new RegExp(`^(?:\\d+(?:${d}\\d*)?|${d}\\d+)${numerals.decimal === '.' ? '(?:e[-+]?\\d+)?' : ''}$`, 'i').test(b)) return undefined
  const n = Number(numerals.decimal === ',' ? b.replace(',', '.') : b)
  if (!Number.isFinite(n)) return undefined
  return /^[-−]/.test(t) ? -n : n
}

/**
 * The `thousands` that would read a numeral that plain data doesn't
 * (`1,200` → `,`), for an error to suggest; undefined if none would.
 */
export function thousandsFor(text: string, prefer?: Thousands): Thousands | undefined {
  const order = prefer ? [prefer, ...THOUSANDS.filter((t) => t !== prefer)] : THOUSANDS
  return order.find((t) => readNumber(text, dataNumerals(t)) !== undefined)
}

/** How a numeral is written, to write other values the same way. */
export interface NumberStyle {
  mark: DecimalMark
  /** The character between groups of three, or '' for none. */
  group: string
  /** Digits after the decimal mark. */
  decimals: number
  /** `-` or `−`, whichever the numeral used (`-` if it had no sign). */
  minus: string
}

export function numberStyle(numeral: string, numerals: Numerals): NumberStyle {
  const t = numeral.trim()
  const b = body(t)
  const mark = numerals.decimal
  const at = b.indexOf(mark)
  const whole = at < 0 ? b : b.slice(0, at)
  return {
    mark,
    group: /\D/.exec(whole)?.[0] ?? '',
    decimals: at < 0 ? 0 : b.length - at - 1,
    minus: t.startsWith('−') ? '−' : '-',
  }
}

/** `n` written in `style`: its decimals, its grouping, its marks. */
export function formatNumber(n: number, style: NumberStyle): string {
  const [whole, fraction] = Math.abs(n).toFixed(style.decimals).split('.')
  const int = style.group ? whole!.replace(/\B(?=(\d{3})+(?!\d))/g, style.group) : whole!
  const sign = n < 0 && Number(Math.abs(n).toFixed(style.decimals)) !== 0 ? style.minus : ''
  return sign + int + (fraction ? style.mark + fraction : '')
}

/**
 * The first numeral in a text: grouped (`1,234.5`, `1.234.567`, `11 393`)
 * or plain (`4,2`, `2024`), with its sign.
 */
export function findNumeral(text: string): { index: number; text: string } | undefined {
  const m = new RegExp(`[-+\\u2212]?(?:\\d{1,3}([,.${SPACES}])\\d{3}(?!\\d)(?:\\1\\d{3}(?!\\d))*(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?)`).exec(text)
  return m ? { index: m.index, text: m[0] } : undefined
}
