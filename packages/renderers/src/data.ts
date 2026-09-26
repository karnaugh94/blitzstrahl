/**
 * Tabular data for renderers: CSV/TSV/JSON parsing and shaping. Pure.
 */
import { decimalMark, readNumber, type DecimalMark } from '@blitzstrahl/core/numbers'

export type Row = Record<string, string | number | null>

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

/** RFC 4180 CSV (quotes, doubled quotes, newlines in quotes). */
export function parseDelimited(text: string, delimiter = ','): Row[] {
  const records: string[][] = []
  let field = ''
  let record: string[] = []
  let quoted = false
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === delimiter) {
      record.push(field)
      field = ''
    } else if (c === '\n') {
      record.push(field)
      records.push(record)
      record = []
      field = ''
    } else field += c
  }
  if (field !== '' || record.length) {
    record.push(field)
    records.push(record)
  }
  const [header, ...body] = records.filter((r) => r.length > 1 || r[0] !== '')
  if (!header) return []
  const keys = header.map((h) => h.trim())
  // Each column reads its numbers one way: `3,5` makes a column's commas decimal marks.
  const marks = keys.map((_, i) => decimalMark(body.map((r) => r[i] ?? '')))
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, coerce(r[i], marks[i]!)])))
}

function coerce(v: string | undefined, mark: DecimalMark): string | number | null {
  if (v === undefined) return null
  const t = v.trim()
  if (t === '') return null
  return readNumber(t, mark) ?? t
}

/** Parse a data asset by its extension. */
export function parseData(path: string, text: string): Row[] {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase()
  if (ext === 'csv') return parseDelimited(text, delimiterOf(text))
  if (ext === 'tsv') return parseDelimited(text, '\t')
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

/**
 * Long → wide: one series per value of `by`, summing `y` per category.
 * Missing combinations are null (a gap), not zero.
 */
export function pivot(rows: Row[], x: string, y: string, by: string) {
  const categories = distinct(rows, x)
  const groups = distinct(rows, by)
  const series = groups.map((g) => ({
    name: String(g),
    data: categories.map((c) => {
      const hits = rows.filter((r) => r[x] === c && r[by] === g)
      return hits.length ? hits.reduce((a, r) => a + (typeof r[y] === 'number' ? r[y] : 0), 0) : null
    }),
  }))
  return { categories, series }
}
