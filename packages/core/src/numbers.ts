/**
 * Numerals as decks write them (PLAN §15, M6.4): `1,234.5` in English,
 * `1.234,5` in German, `1 234,5` in French. Pure. The renderers use it for
 * data files and sortable tables, and the runtime for `count-up`, through
 * `@blitzstrahl/core/numbers`, which carries nothing else of core into the
 * page.
 *
 * The rule, from the chart docs (`1,200` is twelve hundred): a comma groups
 * thousands, unless the numerals can't be read that way (`3,5`, `12,25`, or
 * dots that group, `1.234.567`). Then the comma is the decimal mark. One
 * case stays ambiguous, `12,250`, and is read as twelve thousand two hundred
 * and fifty.
 */

/** The character between a numeral's whole part and its fraction. */
export type DecimalMark = '.' | ','

const SIGN = /^[-+−]/
/** Spaces that group digits: a space, no-break space, thin space and narrow no-break space. */
const SPACES = ' \\u00a0\\u2009\\u202f'

function body(text: string): string {
  return text.trim().replace(SIGN, '')
}

/** One separator between groups of three, then maybe a fraction after `mark`. */
function grouped(mark: DecimalMark): RegExp {
  const group = mark === '.' ? `,${SPACES}` : `.${SPACES}`
  return new RegExp(`^\\d{1,3}([${group}])\\d{3}(?:\\1\\d{3})*(?:\\${mark}\\d+)?$`)
}

const GROUPED = { '.': grouped('.'), ',': grouped(',') }
const PLAIN = {
  '.': /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i,
  ',': /^(?:\d+(?:,\d*)?|,\d+)$/,
}

/**
 * The decimal mark some numerals imply: `,` when some of them can only be
 * read that way and none can only be read the English way; `.` otherwise.
 */
export function decimalMark(values: Iterable<string>): DecimalMark {
  let comma = false
  let dot = false
  for (const v of values) {
    const b = body(v)
    if ((/^\d+,\d+$/.test(b) && !/^\d{1,3},\d{3}$/.test(b)) || /^\d{1,3}(\.\d{3}){2,}$/.test(b)) comma = true
    else if (new RegExp(`^\\d{1,3}([.${SPACES}])\\d{3}(?:\\1\\d{3})*,\\d+$`).test(b)) comma = true
    else if ((/^\d+\.\d+$/.test(b) && !/^\d{1,3}\.\d{3}$/.test(b)) || /^\d{1,3}(,\d{3}){2,}$/.test(b)) dot = true
    else if (new RegExp(`^\\d{1,3}([,${SPACES}])\\d{3}(?:\\1\\d{3})*\\.\\d+$`).test(b)) dot = true
  }
  return comma && !dot ? ',' : '.'
}

/** A numeral's value with `mark` as its decimal mark, or undefined if it isn't one. */
export function readNumber(text: string, mark: DecimalMark = '.'): number | undefined {
  const t = text.trim()
  let b = body(t)
  if (GROUPED[mark].test(b)) b = b.replace(new RegExp(`[${mark === '.' ? ',' : '.'}${SPACES}]`, 'g'), '')
  else if (!PLAIN[mark].test(b)) return undefined
  const n = Number(mark === ',' ? b.replace(',', '.') : b)
  if (!Number.isFinite(n)) return undefined
  return /^[-−]/.test(t) ? -n : n
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

export function numberStyle(numeral: string, mark: DecimalMark): NumberStyle {
  const t = numeral.trim()
  const b = body(t)
  const m = GROUPED[mark].exec(b)
  const at = b.indexOf(mark)
  return {
    mark,
    group: m ? m[1]! : '',
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
