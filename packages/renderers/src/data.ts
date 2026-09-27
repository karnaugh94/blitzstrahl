/**
 * Tabular data for renderers: CSV/TSV/JSON parsing and shaping. Pure.
 */
import { readNumber, thousandsFor, type Thousands } from '@blitzstrahl/core/numbers'

export type Row = Record<string, string | number | null>

/**
 * A data cell's number, read the way the data is written (plain, or as
 * `thousands` says: `RenderCtx.number`), or undefined if it isn't one.
 */
export type ReadCell = (text: string) => number | undefined

export const DELIMITERS = [',', ';', '\t'] as const

/**
 * The separator a delimited file uses: `;` when its header has more
 * semicolons than commas (Excel's CSV where the comma is the decimal mark),
 * else `fallback`.
 */
export function delimiterOf(text: string, fallback = ','): string {
  const header = text.replace(/^\uFEFF/, '').split(/\r?\n/).find((l) => l.trim()) ?? ''
  const outside = header.replace(/"[^"]*"/g, '')
  const count = (c: string) => outside.split(c).length - 1
  return fallback === ',' && count(';') > count(',') ? ';' : fallback
}

/**
 * RFC 4180 CSV (quotes, doubled quotes, newlines in quotes). A cell that's
 * a number written some other way than `read` reads (`1,200` in plain
 * data) is an error at its line: reading it would be a guess (PLAN D3′).
 */
export function parseDelimited(text: string, delimiter = ',', read: ReadCell = readNumber, where = 'the data'): Row[] {
  const records: Array<{ cells: string[]; line: number }> = []
  let field = ''
  let cells: string[] = []
  let line = 1
  let start = 1
  let quoted = false
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!
    if (c === '\n') line++
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === delimiter) {
      cells.push(field)
      field = ''
    } else if (c === '\n') {
      cells.push(field)
      records.push({ cells, line: start })
      cells = []
      field = ''
      start = line
    } else field += c
  }
  if (field !== '' || cells.length) {
    cells.push(field)
    records.push({ cells, line: start })
  }
  const kept = records.filter(({ cells: r }) => r.length > 1 || r[0] !== '')
  const [header, ...body] = kept
  if (!header) return []
  const keys = header.cells.map((h) => h.trim())
  const prefer: Thousands | undefined = delimiter === ';' ? '.' : undefined
  const coerce = (v: string | undefined, key: string, at: number): string | number | null => {
    if (v === undefined) return null
    const t = v.trim()
    if (t === '') return null
    const n = read(t)
    if (n !== undefined) return n
    const hint = thousandsFor(t, prefer)
    if (hint === undefined) return t
    throw new Error(
      `${where}, line ${at}: \`${t}\` in \`${key}\` isn't a number as data writes them (a dot for decimals, nothing between the thousands: 1200.5). ` +
        `If the file is written that way, say so: \`thousands: "${hint}"\``,
    )
  }
  return body.map(({ cells: r, line: at }) => Object.fromEntries(keys.map((k, i) => [k, coerce(r[i], k, at)])))
}

/** How a block reads its data file: `delimiter` and `thousands` from its spec, applied. */
export interface DataOptions {
  read?: ReadCell
  delimiter?: string | undefined
}

/** Parse a data asset by its extension. */
export function parseData(path: string, text: string, opts: DataOptions = {}): Row[] {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase()
  const where = `\`${path}\``
  if (ext === 'csv') return parseDelimited(text, opts.delimiter ?? delimiterOf(text), opts.read, where)
  if (ext === 'tsv') return parseDelimited(text, opts.delimiter ?? '\t', opts.read, where)
  if (ext === 'json') return rowsFrom(JSON.parse(text), path)
  throw new Error(`can't read \`${path}\`: use .csv, .tsv or .json`)
}

/** Accept an array of objects (inline YAML or JSON). */
export function rowsFrom(value: unknown, what = 'data'): Row[] {
  if (!Array.isArray(value) || !value.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
    throw new Error(`${what} must be a list of rows, e.g. [{ quarter: Q1, revenue: 1.2 }]`)
  }
  return value as Row[]
}

/** Unique values of a column, in first-seen order. */
export function distinct(rows: Row[], key: string): Array<string | number> {
  const seen = new Set<string | number>()
  for (const r of rows) {
    const v = r[key]
    if (v !== null && v !== undefined) seen.add(v)
  }
  return [...seen]
}

/** How rows that share a category become one value (chart.md `aggregate`). */
export type Aggregate = 'sum' | 'mean' | 'min' | 'max' | 'count'
export const AGGREGATES: readonly Aggregate[] = ['sum', 'mean', 'min', 'max', 'count']

/** The rows' values as one number: null (a gap) when none is a number, except for `count`. */
export function aggregate(values: readonly unknown[], how: Aggregate = 'sum'): number | null {
  if (how === 'count') return values.length
  const nums = values.filter((v): v is number => typeof v === 'number')
  if (!nums.length) return null
  if (how === 'min') return Math.min(...nums)
  if (how === 'max') return Math.max(...nums)
  const sum = nums.reduce((a, v) => a + v, 0)
  return how === 'mean' ? sum / nums.length : sum
}

/**
 * Long → wide: one series per value of `by`, `how` (a sum) over `y` per
 * category. Missing combinations are null (a gap), not zero.
 */
export function pivot(rows: Row[], x: string, y: string, by: string, how: Aggregate = 'sum') {
  const categories = distinct(rows, x)
  const groups = distinct(rows, by)
  const series = groups.map((g) => ({
    name: String(g),
    data: categories.map((c) => {
      const hits = rows.filter((r) => r[x] === c && r[by] === g)
      return hits.length ? aggregate(hits.map((r) => r[y]), how) : null
    }),
  }))
  return { categories, series }
}
